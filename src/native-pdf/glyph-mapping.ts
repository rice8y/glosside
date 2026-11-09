import type { PdfGlyphCode, PdfTextItem, PdfTextPage } from './equation-alignment';

// PDFium may expose an embedded symbol font's character code while PDF.js uses
// its glyph name. Derive alternatives from this document, not a symbol whitelist.
export function readGlyphCodes(
  list: { fnArray: ArrayLike<number>; argsArray: any[] },
  ops: { setFont: number; save: number; restore: number; showText: number },
  embedded?: (font: string) => { code: number; unicode?: string }[] | undefined,
): PdfGlyphCode[] {
  let font = '';
  const stack: string[] = [],
    codes = new Map<string, PdfGlyphCode>();
  const embeddedFonts = new Map<string, Map<number, string | undefined>>();
  for (let n = 0; n < list.fnArray.length; n++) {
    const op = list.fnArray[n],
      args = list.argsArray[n];
    if (op === ops.setFont) font = args[0];
    else if (op === ops.save) stack.push(font);
    else if (op === ops.restore) font = stack.pop() ?? font;
    else if (op === ops.showText) {
      for (const glyph of args[0]) {
        if (typeof glyph !== 'object' || !glyph || !Number.isInteger(glyph.originalCharCode))
          continue;
        const code = glyph.originalCharCode,
          unicode = glyph.unicode;
        if (!embeddedFonts.has(font))
          embeddedFonts.set(
            font,
            new Map((embedded?.(font) ?? []).map((g) => [g.code, g.unicode])),
          );
        const decoded = embeddedFonts.get(font)!.get(code);
        if (
          typeof unicode !== 'string' ||
          code < 0 ||
          code > 255 ||
          (!decoded && !/^[\p{S}\p{M}\p{P}\p{Diacritic}]+$/u.test(unicode))
        )
          continue;
        const entry = { font, unicode, code, ...(decoded ? { decoded } : {}) };
        codes.set(JSON.stringify(entry), entry);
      }
    }
  }
  return [...codes.values()];
}
export const compactGlyphText = (text: string) =>
  text.normalize('NFKC').replace(/−/gu, '-').replace(/\s/gu, '');
// An incorrectly mapped single glyph can expand under NFKC (for example a
// fraction character whose embedded glyph is actually a bracket). Keep its
// verified decoded glyph atomic, rather than allowing independent substitutions
// for each character of the normalization expansion.
export function compactItemText(page: PdfTextPage, item: PdfTextItem, raw = item.str): string {
  return [...raw]
    .map((char) => {
      const normalized = compactGlyphText(char);
      if (normalized.length <= 1) return normalized;
      const evidence = (page.glyphs ?? []).filter(
        (g) => g.font === item.fontName && g.unicode === char,
      );
      const decoded = [...new Set(evidence.map((g) => g.decoded && compactGlyphText(g.decoded)))];
      return decoded.length === 1 && decoded[0]?.length === 1 ? decoded[0] : normalized;
    })
    .join('');
}
export function glyphAlternatives(page: PdfTextPage, item: PdfTextItem, text: string): string[][] {
  return text
    .split('')
    .map((char) => [
      ...new Set([
        char,
        ...(page.glyphs ?? [])
          .filter(
            (g) =>
              g.font === item.fontName &&
              (compactGlyphText(g.unicode) === char ||
                (compactGlyphText(g.unicode).length > 1 &&
                  g.decoded &&
                  compactGlyphText(g.decoded) === char &&
                  item.str.includes(g.unicode))) &&
              (g.decoded || /^[\p{S}\p{M}\p{P}\p{Diacritic}]+$/u.test(g.unicode)) &&
              g.code >= 0 &&
              g.code <= 255,
          )
          .flatMap((g) => [
            compactGlyphText(g.unicode),
            ...(g.decoded ? [compactGlyphText(g.decoded)] : []),
            ...(/^[\p{S}\p{M}\p{P}\p{Diacritic}]+$/u.test(g.unicode)
              ? g.code === 0
                ? ['', String.fromCharCode(0)]
                : /\s/u.test(String.fromCharCode(g.code))
                  ? ['']
                  : [String.fromCharCode(g.code)]
              : []),
          ]),
      ]),
    ]);
}
export function orderOverlaidAccents(items: PdfTextItem[]): PdfTextItem[] {
  const ordered = [...items];
  for (let n = 0; n + 1 < ordered.length; n++) {
    const accent = ordered[n],
      base = ordered[n + 1];
    if (
      !/^[\p{M}\p{Diacritic}~]+$/u.test(compactGlyphText(accent.str)) ||
      !/^\p{L}$/u.test(compactGlyphText(base.str))
    )
      continue;
    if (
      accent.x < base.x + base.width &&
      accent.x + (accent.width || base.size * 0.5) > base.x &&
      Math.abs(accent.y - base.y) < base.size
    ) {
      ordered[n] = base;
      ordered[n + 1] = accent;
      n++;
    }
  }
  return ordered;
}

// A combining mark has no advance width, but still has a visible glyph outline.
export const visibleGlyphItem = (i: PdfTextItem) =>
  !!i.str.trim() &&
  (i.width > 0 || (i.width === 0 && /^[\p{M}\p{Diacritic}]+$/u.test(compactGlyphText(i.str))));
export const glyphRight = (i: PdfTextItem) => i.x + (i.width || i.size);

export function orderOperatorLimits(
  items: PdfTextItem[],
  isMath: (i: PdfTextItem) => boolean,
  size: number,
) {
  for (let n = 1; n < items.length; n++) {
    const op = items[n];
    if (!/^[∑∏⋃⋂]$/u.test(op.str.replace(/[\uFE00-\uFE0F]/gu, '').trim())) continue;
    let start = n;
    while (start > 0 && n - start < 16) {
      const upper = items[start - 1];
      if (
        !isMath(upper) ||
        upper.size >= op.size * 0.9 ||
        upper.y <= op.y ||
        upper.y > op.y + size * 1.5 ||
        upper.x < op.x - size * 0.5 ||
        upper.x + upper.width > op.x + op.width + size * 0.5
      )
        break;
      start--;
    }
    if (start < n) {
      items.splice(n, 1);
      items.splice(start, 0, op);
    }
  }
}

// Exact matching of document-derived extraction alternatives. Empty alternatives
// are allowed only for symbol glyphs encoded as NUL/whitespace by that PDF font.
export function matchesGlyphText(alternatives: string[][], actual: string): boolean {
  if (alternatives.length === actual.length && alternatives.every((a, n) => a.includes(actual[n])))
    return true;
  if (alternatives.length > 2048 || (alternatives.length + 1) * (actual.length + 1) > 1_000_000)
    return false;
  let positions = new Set([0]);
  for (const options of alternatives) {
    const next = new Set<number>();
    for (const position of positions)
      for (const value of options)
        if (actual.startsWith(value, position)) next.add(position + value.length);
    if (!next.size) return false;
    positions = next;
  }
  return positions.has(actual.length);
}

// A tall operator at the beginning of a wrapped row can be extracted before the
// preceding row by PDFium. Permit that geometry-derived order only within one
// formula; operands and ordinary binary operators must retain their order.
export function matchesFormulaLayout(
  page: PdfTextPage,
  items: PdfTextItem[],
  actual: string,
  size: number,
): boolean {
  const matches = (order: PdfTextItem[]) =>
    matchesGlyphText(
      order.flatMap((i) => glyphAlternatives(page, i, compactItemText(page, i))),
      actual,
    );
  if (matches(items)) return true;
  let attempts = 0;
  for (let n = 1; n < items.length && attempts < 8; n++) {
    const op = items[n],
      previous = items[n - 1];
    if (
      !/^\p{Sm}$/u.test(compactGlyphText(op.str)) ||
      op.size < size * 0.85 ||
      op.x >= previous.x - size ||
      op.y >= previous.y ||
      op.y < previous.y - size * 1.5
    )
      continue;
    const base = items
      .slice(n + 1)
      .find((i) => i.size >= size * 0.9 && /^\p{L}/u.test(compactGlyphText(i.str)));
    if (!base || op.y < base.y + size * 0.4) continue;
    attempts++;
    if (matches([op, ...items.slice(0, n), ...items.slice(n + 1)])) return true;
  }
  return false;
}
