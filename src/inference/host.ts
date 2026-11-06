import { Scheduler } from './scheduler';
import { InferenceSession } from './session';
import { deleteModel, diskState, downloadModel } from './model-store';
import { AppError, errorCode } from '../shared/errors';
import type { Request, ModelState } from '../shared/types';
import { Diagnostics } from './diagnostics';
export function createInferenceHost(
  send: (message: { owner?: string; event?: unknown; model?: ModelState }) => void,
) {
  let download: AbortController | undefined,
    model: ModelState = { state: 'ABSENT' };
  let memoryMode = 'balanced',
    backend = 'auto';
  let tuning: Promise<unknown> | undefined;
  let tuneAbort: AbortController | undefined;
  const leases = new Map<string, number>();
  const update = (value: ModelState) => {
    model = value;
    void send({ model });
  };
  const inference = new InferenceSession(
    () => new Worker(chrome.runtime.getURL('workers/inference.js'), { type: 'module' }),
    update,
  );
  const diagnostics = new Diagnostics();
  const scheduler = new Scheduler(
    inference,
    (owner, event) => void send({ owner, event }),
    (timings, hit) => diagnostics.result(timings, hit),
  );
  const command = async (message: Record<string, any>) => {
    try {
      const { owner, action } = message;
      if (action === 'metric') diagnostics.record(message.name, message.ms);
      else if (action === 'diagnostics') {
        return { ok: true, performance: diagnostics.snapshot() };
      } else if (action === 'optimize') {
        if (tuning || scheduler.busy() || download) throw new AppError('ENGINE_BUSY');
        tuneAbort = new AbortController();
        const task = inference.optimize(tuneAbort.signal);
        tuning = task;
        try {
          return { ok: true, profile: await task };
        } finally {
          if (tuning === task) {
            tuning = undefined;
            tuneAbort = undefined;
          }
        }
      } else if (action === 'cancel-optimize') tuneAbort?.abort();
      else if (action === 'prepare') {
        if (tuning) {
          return { ok: true };
        }
        if (memoryMode !== 'economy' && (await diskState()).state === 'READY_ON_DISK')
          await inference.prepare();
      } else if (action === 'submit') {
        if (tuning) {
          tuneAbort?.abort();
          await tuning.catch(() => {});
        }
        leases.set(owner, Date.now());
        await scheduler.submit(owner, message.request as Request);
      } else if (action === 'lease') {
        leases.set(owner, Date.now());
        scheduler.snapshot(owner);
        return {
          ok: true,
          requests: [...scheduler.jobs.values()]
            .filter((j) => j.owner === owner)
            .map((j) => j.r.requestId),
        };
      } else if (action === 'cancel') scheduler.cancel(owner, message.id);
      else if (action === 'disconnect') {
        leases.delete(owner);
        scheduler.cancelOwner(owner);
      } else if (action === 'pin') scheduler.pin(owner, message.id, message.pinned);
      else if (action === 'state') {
        if (model.state === 'ABSENT') model = await diskState();
        void send({ owner, model });
      } else if (action === 'configure') {
        memoryMode = message.memoryMode;
        backend = message.backend ?? 'auto';
        inference.configure(
          memoryMode as 'economy' | 'balanced' | 'reading',
          backend as 'auto' | 'cpu',
          message.profile,
        );
      } else if (action === 'download') {
        if (tuning) throw new AppError('ENGINE_BUSY');
        if (!download) {
          download = new AbortController();
          void downloadModel(download.signal, update)
            .catch((e) =>
              update({
                state: 'FAILED',
                code: download?.signal.aborted ? 'PAUSED' : errorCode(e, 'DOWNLOAD_FAILED'),
              }),
            )
            .finally(() => {
              download = undefined;
            });
        }
      } else if (action === 'pause-download') download?.abort();
      else if (action === 'delete-model') {
        if (tuning) {
          tuneAbort?.abort();
          await tuning.catch(() => {});
        }
        download?.abort();
        if (download) throw new AppError('INVALID_REQUEST');
        for (const owner of leases.keys()) scheduler.cancelOwner(owner);
        scheduler.clearCache();
        inference.dispose();
        await deleteModel();
        update({ state: 'ABSENT' });
      } else if (action === 'unload') {
        if (tuning) {
          tuneAbort?.abort();
          await tuning.catch(() => {});
        }
        if (scheduler.busy()) throw new AppError('INVALID_REQUEST');
        inference.dispose();
        update(await diskState());
      } else if (action === 'clear-cache') scheduler.clearCache();
      return { ok: true };
    } catch (e) {
      return { ok: false, code: errorCode(e) };
    }
  };
  setInterval(() => {
    scheduler.prune();
    for (const [owner, time] of leases)
      if (Date.now() - time > 45000) {
        leases.delete(owner);
        scheduler.cancelOwner(owner);
      }
  }, 15000);

  return { command };
}
