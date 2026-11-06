import type { TextEdit } from '../shared/types';
import { joinedPdfWord } from '../shared/pdf-words';

const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f]/u;
const terminal = /[.!?。！？]["'”’»）)\]]*$/u;
const list = /^(?:[•●▪◦‣*+-]\s|(?:\d+[.)]|\([\da-zA-Z]+\)|[a-zA-Z][.)])\s|\[\d+\]\s)/u;
function structured(line: string) {
  // Text-only native selection has no reliable cell/paragraph geometry. Keep
  // ambiguous tables, formulas, code, headings and list boundaries intact.
  if (/\t|\S {2,}\S|[=∑∫{}]|^(?:```|~~~|#|>|\$)/u.test(line) || list.test(line.trim())) return true;
  const text = line.trim();
  if (/^\d+(?:\.\d+)*\.?\s+\p{Lu}/u.test(text)) return true;
  const words = text.split(/\s+/u);
  return (
    text.length <= 65 &&
    words.length <= 8 &&
    words.every((w) => /^(?:\p{Lu}[\p{L}\d-]*|of|the|and|in|for|to)$/u.test(w))
  );
}
function prose(line: string) {
  return line.length >= 30 && (line.match(/\p{L}/gu)?.length ?? 0) >= 15;
}
// A full-width sentence-ending line inside a run of similarly wrapped prose is
// evidence of a physical wrap. Isolated sentence/paragraph boundaries stay intact.
function sentenceWrap(lines: string[], i: number) {
  const left = lines[i].trim(),
    right = lines[i + 1].trim();
  if (left.length < 70 || !prose(right)) return false;
  if (/^[ \t]+/u.test(lines[i]) !== /^[ \t]+/u.test(lines[i + 1])) return false;
  const before = lines[i - 1]?.trim() ?? '';
  const after = lines[i + 2]?.trim() ?? '';
  if (!prose(before) || !prose(after) || [before, after].some(structured)) return false;
  if (terminal.test(before) || terminal.test(right)) return false;
  const widths = [before.length, left.length, right.length];
  return Math.min(...widths) >= Math.max(...widths) * 0.8;
}
export function applyTextEdits(source: string, edits: TextEdit[]): string {
  let result = '',
    cursor = 0;
  for (const edit of edits) {
    result += source.slice(cursor, edit.startUtf16) + edit.replacement;
    cursor = edit.endUtf16;
  }
  return result + source.slice(cursor);
}
export function preparePdfText(source: string): { text: string; edits: TextEdit[] } {
  const edits: TextEdit[] = [];
  const lines = source.split(/\r\n|\n|\r/u);
  const boundaries = [...source.matchAll(/\r\n|\n|\r/gu)];
  let fenced = false;
  for (let i = 0; i < boundaries.length; i++) {
    const before = lines[i],
      after = lines[i + 1];
    if (/^\s*(?:```|~~~)/u.test(before)) fenced = !fenced;
    const left = before.trim(),
      right = after.trim();
    if (fenced || !left || !right || structured(before) || structured(after)) continue;
    // Increased indentation can be a new paragraph/list/code block. Preserve it.
    if (/^\s{2,}\S/u.test(after) && !/^\s{2,}\S/u.test(before)) continue;
    if (terminal.test(left) && !sentenceWrap(lines, i)) continue;
    if (
      left.length <= 65 &&
      left.split(/\s+/u).length <= 8 &&
      /^\p{Lu}/u.test(right) &&
      !/[,;]$/u.test(left)
    )
      continue;
    if (!prose(left) && !prose(right) && !(cjk.test(left) && left.length >= 10)) continue;
    let start = boundaries[i].index! - (before.match(/[ \t]*$/u)?.[0].length ?? 0);
    const end =
      boundaries[i].index! + boundaries[i][0].length + (after.match(/^[ \t]*/u)?.[0].length ?? 0);
    let replacement = cjk.test(left.at(-1)!) || cjk.test(right[0]) ? '' : ' ';
    let reason: TextEdit['reason'] = 'line-wrap';
    if (left.endsWith('\u00ad') && /^\p{Ll}/u.test(right)) {
      start--; // Only an explicit discretionary soft hyphen is removed.
      replacement = '';
      reason = 'soft-hyphen';
    } else if (/\p{L}-$/u.test(left) && /^\p{L}/u.test(right)) {
      replacement = '';
      if (
        joinedPdfWord(
          source,
          left.match(/([a-z]+)-$/u)?.[1] ?? '',
          right.match(/^[a-z]+/u)?.[0] ?? '',
        )
      ) {
        start--;
        reason = 'word-hyphen';
      }
    }
    edits.push({ startUtf16: start, endUtf16: end, replacement, reason });
  }
  return { text: applyTextEdits(source, edits), edits };
}
