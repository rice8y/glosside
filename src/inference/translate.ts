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
  // Longer decode contexts cost more on CPU; keep its measured 600-character
  // ceiling while both backends honor the complete prompt/output byte budget.
  const chunks = translationPlan(r, runtime.backend === 'GPU' ? Infinity : 600);
  const planned = performance.now();
  let firstToken: number | undefined;
  for (const [index, chunk] of chunks.entries()) {
    signal.throwIfAborted();
    let part = '',
      finish: string | null = null;
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
      totalMs: ended - started,
    },
    chunks: chunks.length,
  };
}
