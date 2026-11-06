import { AppError } from '../shared/errors';
import type { ModelState, Request, Settings } from '../shared/types';
import type { Runner } from './scheduler';
import type { DeviceProfile } from './device-profile';
type Result = Awaited<ReturnType<Runner['run']>>;

// One worker owns both preparation and translation. A click during preparation
// joins that work rather than allocating a second model or issuing concurrent loads.
export class InferenceSession implements Runner {
  private worker?: Worker;
  private preparing?: Promise<void>;
  private running = false;
  private interrupt?: () => void;
  private idle?: ReturnType<typeof setTimeout>;
  private backend: Settings['backend'] = 'auto';
  private memoryMode: Settings['memoryMode'] = 'balanced';
  private profile?: DeviceProfile;
  constructor(
    private create: () => Worker,
    private update: (state: ModelState) => void,
  ) {}
  configure(
    memoryMode: Settings['memoryMode'],
    backend: Settings['backend'],
    profile?: DeviceProfile,
  ) {
    this.memoryMode = memoryMode;
    this.backend = backend;
    this.profile = profile;
    if (!this.running && !this.preparing) this.scheduleIdle();
  }
  prepare(): Promise<void> {
    if (this.memoryMode === 'economy' || this.running) return Promise.resolve();
    if (this.preparing) return this.preparing;
    clearTimeout(this.idle);
    const task = this.invoke({
      type: 'prepare',
      cpu: this.backend === 'cpu',
      profile: this.profile,
    }).then(() => {});
    this.preparing = task;
    void task
      .finally(() => {
        if (this.preparing === task) this.preparing = undefined;
        this.scheduleIdle();
      })
      .catch(() => {});
    return task;
  }
  async run(r: Request, signal: AbortSignal, emit: (text: string) => void): Promise<Result> {
    const started = performance.now();
    this.running = true;
    clearTimeout(this.idle);
    try {
      // Preparation failure is not a translation failure: explicit translation
      // can retry after a model download or a transient runtime failure.
      if (this.preparing) {
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(new AppError('CANCELLED'));
          signal.addEventListener('abort', abort, { once: true });
          void this.preparing!.catch(() => {}).then(() => {
            signal.removeEventListener('abort', abort);
            resolve();
          });
          if (signal.aborted) abort();
        });
      }
      if (signal.aborted) throw new AppError('CANCELLED');
      const waited = performance.now() - started;
      const result = (await this.invoke(
        { type: 'run', request: r, cpu: this.backend === 'cpu', profile: this.profile },
        signal,
        emit,
      )) as Result;
      if (result.timings)
        result.timings = {
          ...result.timings,
          prepareMs: (result.timings.prepareMs ?? 0) + waited,
          totalMs: performance.now() - started,
        };
      return result;
    } finally {
      this.running = false;
      this.scheduleIdle();
    }
  }
  async optimize(signal: AbortSignal): Promise<DeviceProfile> {
    if (this.running) throw new AppError('ENGINE_BUSY');
    this.running = true;
    clearTimeout(this.idle);
    try {
      if (this.preparing) await this.preparing;
      if (signal.aborted) throw new AppError('CANCELLED');
      return (await this.invoke<DeviceProfile>(
        { type: 'tune', cpu: this.backend === 'cpu' },
        signal,
      )) as DeviceProfile;
    } finally {
      this.running = false;
      this.scheduleIdle();
    }
  }
  dispose() {
    clearTimeout(this.idle);
    this.interrupt?.();
    this.worker?.terminate();
    this.worker = undefined;
  }
  private scheduleIdle() {
    clearTimeout(this.idle);
    if (!this.worker || this.running || this.preparing) return;
    this.idle = setTimeout(
      () => {
        this.dispose();
        this.update({ state: 'READY_ON_DISK' });
      },
      this.memoryMode === 'economy' ? 30000 : this.memoryMode === 'reading' ? 3600000 : 600000,
    );
  }
  private invoke<T = Result>(message: object, signal?: AbortSignal, emit?: (text: string) => void) {
    return new Promise<T | void>((resolve, reject) => {
      const w = (this.worker ??= this.create());
      let watchdog: ReturnType<typeof setTimeout>;
      let cancelTimer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const cleanup = () => {
        clearTimeout(watchdog);
        clearTimeout(cancelTimer);
        w.removeEventListener('message', receive);
        w.removeEventListener('error', failure);
        signal?.removeEventListener('abort', cancel);
        if (this.interrupt === interrupted) this.interrupt = undefined;
      };
      const finish = (error?: AppError, value?: T) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(value);
      };
      const terminate = (code: string) => {
        w.terminate();
        if (this.worker === w) this.worker = undefined;
        if (code === 'CANCELLED') this.update({ state: 'READY_ON_DISK' });
        finish(new AppError(code));
      };
      const interrupted = () => terminate('HOST_INTERRUPTED');
      const failure = () => terminate('HOST_INTERRUPTED');
      const arm = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(failure, 120000);
      };
      const receive = ({ data }: MessageEvent) => {
        if (settled) return;
        arm();
        if (data.type === 'model') this.update(data.value);
        else if (data.type === 'snapshot') emit?.(data.text);
        else if (data.type === 'result') finish(undefined, data.result);
        else if (data.type === 'tuned') finish(undefined, data.profile);
        else if (data.type === 'prepared') finish();
        else if (data.type === 'error') finish(new AppError(data.code));
      };
      const cancel = () => {
        w.postMessage({ type: 'cancel' });
        cancelTimer = setTimeout(() => terminate('CANCELLED'), 3000);
      };
      this.interrupt = interrupted;
      arm();
      w.addEventListener('message', receive);
      w.addEventListener('error', failure);
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        w.postMessage(message);
        if (signal?.aborted) cancel();
      } catch {
        failure();
      }
    });
  }
}
