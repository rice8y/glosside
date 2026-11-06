// Preserve all source characters while preferring paragraph/sentence boundaries.
// A hard split is only used for an overlong token, never inside a surrogate pair.
export function translationChunks(text: string, max = 600): string[] {
  if (!Number.isSafeInteger(max) || max < 2) throw new RangeError('Invalid chunk limit');
  const result: string[] = [];
  while (text) {
    const part = firstTranslationChunk(text, max);
    result.push(part);
    text = text.slice(part.length);
  }
  return result;
}
const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
export function firstTranslationChunk(text: string, max: number): string {
  if (!Number.isSafeInteger(max) || max < 2) throw new RangeError('Invalid chunk limit');
  if (text.length <= max) return text;
  let cut = 0;
  const prefix = text.slice(0, max + 1);
  for (const match of prefix.matchAll(/\n[ \t]*\n+/gu)) {
    const end = match.index! + match[0].length;
    if (end <= max && text.slice(0, end).trim()) cut = end;
  }
  if (!cut)
    for (const sentence of segmenter.segment(text)) {
      const end = sentence.index + sentence.segment.length;
      if (end > max) break;
      if (text.slice(0, end).trim()) cut = end;
    }
  if (!cut)
    for (const match of prefix.matchAll(/\s+/gu)) {
      const end = match.index! + match[0].length;
      if (end <= max && text.slice(0, match.index!).trim()) cut = end;
    }
  if (!cut) {
    cut = max;
    if (/[\uD800-\uDBFF]/u.test(text[cut - 1]) && /[\uDC00-\uDFFF]/u.test(text[cut])) cut--;
  }
  return text.slice(0, cut);
}
export function translationSeparator(before: string, after: string, targetLanguage: string) {
  const boundary = (before.match(/\s*$/u)?.[0] ?? '') + (after.match(/^\s*/u)?.[0] ?? '');
  const breaks = boundary.replace(/\r\n?/gu, '\n').match(/\n/gu)?.length ?? 0;
  if (breaks) return breaks > 1 ? '\n\n' : '\n';
  return /^(?:ja|zh)(?:\b|\()/u.test(targetLanguage) ? '' : ' ';
}
