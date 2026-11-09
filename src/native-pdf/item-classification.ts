import type { PdfTextItem } from './equation-alignment';
import { mayContainMath } from '../shared/pdf-equations';

const mathFont = (name = '') =>
  /(?:^|[+\-])(?:CM(?:MI|SY|EX|R|B|TI)\w*\d|MS[AB]M\d|STIX.*Math|.*Math(?:Italic|Symbol)|CambriaMath)/i.test(
    name,
  );
const identifier = /^[\p{L}][\p{L}\p{N}_-]*$/u;
const numbered = (i: PdfTextItem) => /^\d{1,3}:$/.test(i.str.trim());
const mathSymbol = /[=+−*/<>∑∏∫√∝≈≠≤≥∞∂∇∈∉⊂⊆±×÷^_{}\p{Script=Greek}]/u;
const mathematicalAlphabet = /[\u{1D400}-\u{1D7FF}]/u;
const referenceText = (text: string) =>
  /(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/u.test(text);
const symbolItem = (i: PdfTextItem) =>
  !referenceText(i.str) &&
  (mathSymbol.test(i.str.normalize('NFKC')) || mathematicalAlphabet.test(i.str));
const callItem = (text: string) =>
  /^\(*[\p{L}][\p{L}\p{N}_]*\([^\n]*$/u.test(text.trim()) &&
  !/[\p{L}\p{N}_)\]]\s+[\p{L}_]/u.test(text);
export const proseItem = (i: PdfTextItem) =>
  !callItem(i.str) &&
  (i.str.match(/[A-Za-z]{3,}/g)?.length ?? 0) >= 2 &&
  /[A-Za-z]{2,}[,;:.!?)]?\s+[A-Za-z]{2,}/.test(
    i.str.replace(/([A-Za-z]{2,})-[A-Za-z0-9]+/gu, '$1'),
  );

// A matched section label or a hyphenated acronym is ordinary prose. This is
// only used after exact source alignment; it does not exempt unknown math.
export const safeProseItem = (i: PdfTextItem) =>
  proseItem(i) &&
  !mayContainMath(
    i.str
      .replace(/^\s*\([A-Za-z0-9]+\)(?=\s+[A-Z])/u, '')
      .replace(/\b[A-Z]{2,}(?:-[A-Za-z0-9]+)+\b/gu, '')
      .replace(
        /\b(?:Section|Appendix|Figure|Table|Algorithm|Theorem|Lemma|Proposition|Equation|Corollary|Definition|Assumption)s?\s+\(?[A-Z0-9]+(?:\.[A-Z0-9]+)*\)?/giu,
        '',
      )
      .replace(/\b[Vv]\d+(?:\.\d+)*\b/gu, ''),
  );

// Font names are hints, not a closed list. Learn symbol/variable faces from
// their use throughout this document, excluding faces also used for prose.
export function inferMathFonts(items: PdfTextItem[]): Set<string> {
  const faces = new Map<
    string,
    { tokens: number; symbols: number; prose: number; short: number; links: number }
  >();
  for (const i of items) {
    if (!i.fontName || !i.str.trim()) continue;
    const stats = faces.get(i.fontName) ?? { tokens: 0, symbols: 0, prose: 0, short: 0, links: 0 };
    if (proseItem(i) || referenceText(i.str)) stats.prose += i.str.length;
    else if (i.str.trim().length <= 32) {
      stats.tokens++;
      if (symbolItem(i)) stats.symbols++;
      if (/^[\p{L}\p{N}]{1,3}$/u.test(i.str.trim())) stats.short++;
    }
    faces.set(i.fontName, stats);
  }
  const visible = items.filter((i) => i.str.trim());
  for (let n = 0; n < visible.length; n++) {
    const i = visible[n],
      stats = faces.get(i.fontName ?? '');
    if (!stats || stats.prose || !/^[\p{L}\p{N}]{1,3}$/u.test(i.str.trim())) continue;
    if (
      [visible[n - 1], visible[n + 1]].some(
        (j) =>
          j &&
          symbolItem(j) &&
          !proseItem(j) &&
          Math.abs(i.y - j.y) < Math.max(i.size, j.size) &&
          Math.abs(i.x - j.x) < Math.max(i.width, j.width) + i.size * 2,
      )
    )
      stats.links++;
  }
  return new Set(
    [...faces]
      .filter(
        ([, s]) =>
          s.prose === 0 &&
          s.tokens >= 3 &&
          (s.symbols >= 2 || (s.short >= s.tokens * 0.8 && s.links >= 3)),
      )
      .map(([name]) => name),
  );
}

export function classifyItems(items: PdfTextItem[], learned: Set<string> = new Set()) {
  const prose = items.filter(proseItem);
  const sizes = prose.map((i) => i.size).sort((a, b) => a - b);
  const fontSize = sizes[Math.floor(sizes.length / 2)] ?? 10;
  const bodyFonts = new Set(
    prose.filter((i) => i.str.length >= 16).map((i) => i.fontName ?? i.fontLabel),
  );
  const numbers = new Set(
    items.filter(
      (i) => numbered(i) && items.filter((j) => numbered(j) && Math.abs(j.x - i.x) < 3).length >= 3,
    ),
  );
  const math = new Set(
    items.filter(
      (i) =>
        !numbers.has(i) &&
        !proseItem(i) &&
        !referenceText(i.str) &&
        (((mathFont(i.fontLabel) || learned.has(i.fontName ?? '')) &&
          !bodyFonts.has(i.fontName ?? i.fontLabel)) ||
          symbolItem(i) ||
          (i.size < fontSize * 0.85 && /^[\p{L}\p{N},†‡*]+$/u.test(i.str.trim()))),
    ),
  );

  const adjacent = (a: PdfTextItem, b: PdfTextItem) =>
    Math.abs(a.y - b.y) < Math.max(a.size, b.size) * 0.2 &&
    b.x >= a.x &&
    b.x - a.x - a.width < Math.max(a.size, b.size) * 0.2;
  // A function identifier may be split into several text items (small caps),
  // and its ordinary roman font may also be used for the surrounding prose.
  for (let n = 0; n < items.length; n++) {
    if (!identifier.test(items[n].str.trim())) continue;
    let end = n;
    while (
      end + 1 < items.length &&
      identifier.test(items[end + 1].str.trim()) &&
      adjacent(items[end], items[end + 1])
    )
      end++;
    const next = items[end + 1];
    if (next && /^[([]/.test(next.str.trim()) && math.has(next) && adjacent(items[end], next))
      for (let k = n; k <= end; k++) math.add(items[k]);
    n = end;
  }
  // Recognize a call even when its function name and arguments are in one text
  // item. Whitespace-separated words are excluded, so prose parentheticals stay
  // translatable. No function-name dictionary is involved.
  for (const i of items) {
    const value = i.str.trim();
    if (callItem(value)) math.add(i);
  }
  // Extend bracketed expressions over roman identifiers and literal tokens.
  // Only a balanced, compact group containing a math seed is eligible.
  const stack: { start: number; close: string; valid: boolean }[] = [];
  const close: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  for (let n = 0; n < items.length; n++) {
    const i = items[n];
    if (numbers.has(i) || proseItem(i)) {
      stack.length = 0;
      continue;
    }
    for (const c of i.str) {
      if (close[c]) stack.push({ start: n, close: close[c], valid: true });
      else if (/[)\]}]/u.test(c)) {
        const group = stack.pop();
        if (!group || group.close !== c) {
          stack.length = 0;
          continue;
        }
        const inside = items.slice(group.start, n + 1);
        if (
          inside.length <= 128 &&
          inside.some((i) => math.has(i)) &&
          inside.reduce((s, i) => s + i.str.length, 0) <= 512
        )
          for (const i of inside) math.add(i);
      }
    }
  }
  // Attached roman prefixes such as a hyphenated operator name belong to the
  // same expression, rather than becoming words submitted to the translator.
  for (let n = 0; n + 1 < items.length; n++) {
    const i = items[n],
      next = items[n + 1];
    if (/^[\p{L}]+-$/u.test(i.str.trim()) && math.has(next) && adjacent(i, next)) math.add(i);
  }
  // Text under an underbrace (or above an overbrace) is an equation annotation,
  // even when it uses the body font. Small prose elsewhere remains prose.
  for (let n = 0; n < items.length; n++) {
    const label = items[n];
    if (!proseItem(label) || label.size >= fontSize * 0.9) continue;
    let start = n - 1;
    while (start >= 0 && math.has(items[start])) start--;
    const prior = items.slice(start + 1, n);
    const braces = prior.filter((i) => /[︷︸⏞⏟]/u.test(i.str));
    if (
      braces.length &&
      label.x >= Math.min(...braces.map((i) => i.x)) - fontSize &&
      label.x + label.width <= Math.max(...braces.map((i) => i.x + i.width)) + fontSize &&
      braces.some((i) => Math.abs(label.y - i.y) < fontSize * 1.5)
    )
      math.add(label);
  }
  const proseParts = new Set(items.filter((i) => safeProseItem(i) && !math.has(i)));
  // Small-cap headings may split the initial letter from the rest of a word.
  // A section label is prose only next to a same-baseline heading, never merely
  // because a token happens to look like an algebraic identifier.
  for (let n = 0; n + 1 < items.length; n++) {
    const i = items[n],
      next = items[n + 1];
    if (
      !math.has(i) &&
      proseParts.has(next) &&
      /^[A-Z]$/.test(i.str) &&
      /^[A-Z]{2}/.test(next.str) &&
      adjacent(i, next)
    )
      proseParts.add(i);
  }
  for (let n = 0; n + 1 < items.length; n++) {
    const i = items[n],
      next = items[n + 1];
    if (
      !math.has(i) &&
      /^[A-Z0-9]+(?:\.\d+)+$/.test(i.str.trim()) &&
      proseParts.has(next) &&
      Math.abs(i.y - next.y) < fontSize * 0.2 &&
      next.x >= i.x + i.width &&
      next.x - i.x - i.width < fontSize * 2
    )
      proseParts.add(i);
  }
  return {
    fontSize,
    math,
    numbers,
    isMath: (i: PdfTextItem) => math.has(i),
    isProse: (i: PdfTextItem) => proseParts.has(i),
  };
}
