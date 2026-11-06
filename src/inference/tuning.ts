import type { ModelRuntime } from './runtime';
import {
  defaultConfig,
  deviceKey,
  tuningCandidates,
  type DeviceProfile,
  type RuntimeConfig,
} from './device-profile';
import { AppError } from '../shared/errors';

export async function tune(
  runtime: ModelRuntime,
  cpu: boolean,
  signal: AbortSignal,
): Promise<DeviceProfile> {
  const previous = runtime.profile;
  runtime.profile = undefined;
  await runtime.prepare(cpu);
  const candidates = tuningCandidates(runtime.backend === 'GPU');
  const fixtures = [
    'The original document stays on this device.',
    'The researchers evaluated the model on a separate dataset. The method improves accuracy without increasing computational cost.',
  ];
  const request = (text: string) =>
    runtime.prompt(
      '<|plamo:bos|><|plamo:tag|>dataset<|plamo:msg|>translation<|plamo:tag|>input<|plamo:key|>lang<|plamo:val|>en<|plamo:msg|>' +
        text +
        '<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>ja<|plamo:msg|>',
    );
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  let reference: string[] | undefined;
  const samples: { config: RuntimeConfig; ms: number; backend: string }[] = [];
  try {
    // Repeat the baseline last to guard against a lucky cold/JIT/thermal sample.
    for (const [index, config] of [...candidates, defaultConfig()].entries()) {
      signal.throwIfAborted();
      await runtime.unload();
      await runtime.load(cpu, config);
      signal.throwIfAborted();
      runtime.state('TUNING');
      const durations: number[] = [],
        outputs: string[] = [];
      for (let round = 0; round < 3; round++) {
        const start = performance.now();
        for (const text of fixtures) {
          signal.throwIfAborted();
          const result = await runtime.model.createCompletion({
            prompt: request(text),
            max_tokens: 160,
            temperature: 0,
            seed: 0,
            abortSignal: signal,
            stop: ['<|plamo:bos|>', '<|plamo:eos|>', '<|plamo:tag|>'],
          });
          const choice = result.choices[0];
          if (!choice?.text.trim() || choice.finish_reason !== 'stop')
            throw new AppError('MODEL_INCOMPATIBLE');
          outputs.push(choice.text);
        }
        if (round > 0) durations.push(performance.now() - start);
      }
      reference ??= outputs;
      const matches = outputs.every((v, i) => v === reference![i]);
      if (index === candidates.length && (!matches || runtime.backend !== samples[0].backend))
        throw new AppError('TUNING_UNSTABLE');
      if (matches) samples.push({ config, ms: median(durations), backend: runtime.backend });
    }
    const base = samples[0];
    const repeat = samples.at(-1)!;
    const baselineMs = Math.min(base.ms, repeat.ms);
    const best = samples
      .filter((s) => s.backend === base.backend && s.ms < baselineMs * 0.92)
      .sort((a, b) => a.ms - b.ms)[0];
    const selected = best ?? base;
    return {
      ...selected.config,
      key: deviceKey(cpu),
      preference: cpu ? 'cpu' : 'auto',
      backend: selected.backend,
      measuredAt: new Date().toISOString(),
      baselineMs,
      selectedMs: best ? best.ms : baselineMs,
    };
  } finally {
    runtime.profile = previous;
    await runtime.unload();
  }
}
