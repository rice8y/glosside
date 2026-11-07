import { Wllama } from '@wllama/wllama';
import { modelFile } from './model-store';
import { AppError } from '../shared/errors';
import { supportsRelaxedSIMD } from './wasm-features';
import {
  defaultConfig,
  deviceKey,
  runtimeConfig,
  type DeviceProfile,
  type RuntimeConfig,
} from './device-profile';
import type { ModelState } from '../shared/types';

// Owns one model instance; worker message handling does not touch engine state.
export class ModelRuntime {
  private engine?: Wllama;
  private offloadedLayers = 0;
  private requestedCpu?: boolean;
  private loadedConfig = '';
  private usePlainWasm = false;
  backend = '';
  profile?: DeviceProfile;
  constructor(private onState: (state: ModelState) => void) {}
  get model(): Wllama {
    if (!this.engine) throw new AppError('MODEL_INCOMPATIBLE');
    return this.engine;
  }
  get loaded() {
    return !!this.engine;
  }
  retainFallbackPreference(cpu: boolean) {
    this.requestedCpu = cpu;
  }
  private observeBackend = (...args: unknown[]) => {
    for (const value of args) {
      if (typeof value !== 'string') continue;
      const match = /offloaded (\d+)\/\d+ layers to GPU/.exec(value);
      if (match) this.offloadedLayers = Number(match[1]);
    }
  };
  prompt(prompt: string) {
    return this.engine!.mustAddBosToken() && prompt.startsWith('<|plamo:bos|>')
      ? prompt.slice('<|plamo:bos|>'.length)
      : prompt;
  }
  state(state: string) {
    this.onState({ state, backend: this.backend });
  }
  async unload() {
    if (this.engine) await this.engine.exit().catch(() => {});
    this.engine = undefined;
    this.backend = '';
    this.requestedCpu = undefined;
    this.loadedConfig = '';
    this.state('READY_ON_DISK');
  }
  async load(cpu = false, config: RuntimeConfig = runtimeConfig(this.profile, cpu)) {
    if (this.engine) return;
    this.offloadedLayers = 0;
    this.state('VERIFYING');
    const file = await modelFile();
    this.state('LOADING');
    const threads = config.threads;
    const relaxed = !this.usePlainWasm && supportsRelaxedSIMD();
    this.engine = new Wllama(
      {
        default: new URL(`../vendor/wllama/${relaxed ? 'relaxed/' : ''}wllama.wasm`, location.href)
          .href,
      },
      {
        suppressNativeLog: false,
        logger: { log: this.observeBackend, debug: this.observeBackend, warn() {}, error() {} },
      },
    );
    try {
      await this.engine.loadModel([file], {
        n_ctx: 4096,
        n_batch: config.batch,
        n_threads: threads,
        n_gpu_layers: cpu ? 0 : 99,
        n_parallel: 1,
        n_cache_reuse: 0,
        cache_idle_slots: false,
      });
      if (this.engine.getBOS() !== 1) throw new AppError('MODEL_INCOMPATIBLE');
      this.backend = cpu ? (threads > 1 ? 'CPU' : 'CPU 互換モード') : 'GPU';
      this.state('WARMING');
      const probe = await this.engine.createCompletion({
        prompt: this.prompt(
          '<|plamo:bos|><|plamo:tag|>dataset<|plamo:msg|>translation<|plamo:tag|>input<|plamo:key|>lang<|plamo:val|>en<|plamo:msg|>Hello.<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>ja<|plamo:msg|>',
        ),
        temperature: 0,
        max_tokens: 24,
        stop: ['<|plamo:bos|>', '<|plamo:eos|>', '<|plamo:tag|>'],
      });
      if (!probe.choices[0]?.text.trim()) throw new AppError('MODEL_INCOMPATIBLE');
      // Native metadata, not navigator.gpu presence, decides whether offload actually happened.
      this.backend = this.offloadedLayers > 0 ? 'GPU' : threads > 1 ? 'CPU' : 'CPU 互換モード';
      if (this.engine.getEOS() !== 1 || ![1, 2, 16].every((id) => this.engine!.isTokenEOG(id)))
        throw new AppError('MODEL_INCOMPATIBLE');
      this.state('READY');
    } catch (e) {
      await this.unload();
      if (relaxed) {
        this.usePlainWasm = true;
        this.state('RECOVERING');
        await this.load(cpu, config);
        return;
      }
      if (!cpu) {
        this.state('RECOVERING');
        await this.load(true, config);
      } else throw e;
    }
  }
  async prepare(cpu: boolean) {
    const key = JSON.stringify(runtimeConfig(this.profile, cpu));
    if (this.engine && (this.requestedCpu !== cpu || this.loadedConfig !== key))
      await this.unload();
    const fresh = !this.engine;
    await this.load(cpu);
    // A GPU-tuned batch must not silently become the CPU fallback configuration.
    if (
      fresh &&
      this.profile?.key === deviceKey(cpu) &&
      this.profile.backend !== this.backend &&
      key !== JSON.stringify(defaultConfig())
    ) {
      await this.unload();
      await this.load(cpu, defaultConfig());
    }
    this.requestedCpu = cpu;
    this.loadedConfig = key;
  }
}
