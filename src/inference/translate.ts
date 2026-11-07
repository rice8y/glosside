import type { ModelRuntime } from './runtime';
import type { Request } from '../shared/types';
import { qualityWarnings } from './prompt';
import { translationSeparator } from './chunks';
import { translationPlan } from './budget';

export async function translate(
  runtime: ModelRuntime,
  r: Request,
  signal: AbortSignal,
  cpu: boolean,
  snapshot: (text: string) => void,
) {
  const started = performance.now();
  await runtime.prepare(cpu);
  const prepared = performance.now();
  signal.throwIfAborted();
  runtime.state('RUNNING');
  let text = '',
    complete = true,
    last = 0;
  // Preserve paragraph context on both validated SIMD paths while reserving
  // the full output budget and enforcing the conservative UTF-8 input bound.
  const chunks = translationPlan(r);
  const planned = performance.now();
  let firstToken: number | undefined;
  let prefillMs = 0,
    decodeMs = 0,
    hasEngineTimings = true;
  for (const [index, chunk] of chunks.entries()) {
    signal.throwIfAborted();
    let part = '',
      finish: string | null = null;
    let engineTimings: { prompt_ms: number; predicted_ms: number } | undefined;
    const stream = await runtime.model.createCompletion({
      prompt: runtime.prompt(chunk.prompt),
      temperature: 0,
      seed: 0,
      max_tokens: chunk.maxTokens,
      stream: true,
      abortSignal: signal,
      stop: ['<|plamo:bos|>', '<|plamo:eos|>', '<|plamo:tag|>'],
    });
    for await (const item of stream) {
      signal.throwIfAborted();
      if (item.timings) engineTimings = item.timings;
      const choice = item.choices[0];
      if (!choice) continue;
      if (choice.text) firstToken ??= performance.now();
      part += choice.text;
      finish = choice.finish_reason ?? finish;
      if (performance.now() - last > 50) {
        snapshot(text + part);
        last = performance.now();
      }
    }
    if (
      engineTimings &&
      [engineTimings.prompt_ms, engineTimings.predicted_ms].every(
        (ms) => Number.isFinite(ms) && ms >= 0,
      )
    ) {
      prefillMs += engineTimings.prompt_ms;
      decodeMs += engineTimings.predicted_ms;
    } else hasEngineTimings = false;
    text += part.trimEnd();
    if (finish !== 'stop') {
      complete = false;
      break;
    }
    if (index + 1 < chunks.length)
      text += translationSeparator(chunk.text, chunks[index + 1].text, r.targetLanguage);
  }
  runtime.state('READY');
  const ended = performance.now();
  return {
    text: text.trimEnd(),
    complete,
    warnings: qualityWarnings(r.translationText, text),
    timings: {
      prepareMs: prepared - started,
      planMs: planned - prepared,
      ...(firstToken === undefined ? {} : { firstTokenMs: firstToken - planned }),
      generationMs: ended - planned,
      ...(hasEngineTimings ? { prefillMs, decodeMs } : {}),
      totalMs: ended - started,
    },
    chunks: chunks.length,
  };
}
