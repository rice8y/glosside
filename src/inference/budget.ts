import { AppError } from '../shared/errors';
import type { Request } from '../shared/types';
import { buildPrompt } from './prompt';
import { firstTranslationChunk } from './chunks';

export const CONTEXT_TOKENS = 4096;
export const OUTPUT_TOKENS = 1200;
const MARGIN = 128;
const encoder = new TextEncoder();
// The pinned tokenizer has byte fallback. UTF-8 bytes are a conservative input
// token upper bound, not an estimate of actual token count. Special tags are
// over-counted deliberately; reserve BOS and output before choosing boundaries.
export function translationPlan(r: Request, maxChars = Infinity) {
  const prompt = (text: string) =>
    buildPrompt({ ...r, translationText: text, textEdits: undefined });
  const overhead = encoder.encode(prompt('x')).length - 1;
  const available = Math.min(1800, CONTEXT_TOKENS - OUTPUT_TOKENS - MARGIN - overhead);
  if (available < 4) throw new AppError('INPUT_LIMIT');
  const parts: string[] = [];
  let remaining = r.translationText;
  while (remaining) {
    let chars = 0,
      bytes = 0;
    for (const point of remaining) {
      const cp = point.codePointAt(0)!;
      bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      if (bytes > available || chars + point.length > maxChars) break;
      chars += point.length;
    }
    if (!chars) throw new AppError('INPUT_LIMIT');
    const text =
      remaining.length <= chars || chars < 2
        ? remaining.slice(0, chars)
        : firstTranslationChunk(remaining, chars);
    parts.push(text);
    remaining = remaining.slice(text.length);
  }
  return parts.map((text) => ({ text, prompt: prompt(text), maxTokens: OUTPUT_TOKENS }));
}
