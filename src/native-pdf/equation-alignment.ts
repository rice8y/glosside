// Conservative display-equation detection. Inputs never include fixture coordinates.
export interface PdfTextItem {
  index: number;
  markedId?: string;
  rotated?: boolean;
  str: string;
  x: number;
  y: number;
  width: number;
  size: number;
  fontLabel?: string;
  fontName?: string;
  ascent?: number;
  descent?: number;
}
export interface PdfGlyphCode {
  font: string;
  unicode: string;
  code: number;
  decoded?: string;
}
export interface PdfTextPage {
  glyphs?: PdfGlyphCode[];
  number: number;
  view: number[];
  items: PdfTextItem[];
}
export interface EquationCandidate {
  id: string;
  page: number;
  box: number[];
  before: string;
  after: string;
  beforeY: number;
  afterY: number;
  text: string;
  items: number[];
  fontSize: number;
}
export interface EquationMatch extends EquationCandidate {
  start: number;
  end: number;
  raw: string;
}

export const normalize = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
const prose = (i: PdfTextItem) =>
  i.width > 0 && i.str.length >= 18 && (i.str.match(/[a-zA-Z]{2,}/g) || []).length >= 3;
export function candidates(pages: PdfTextPage[]) {
  const found: EquationCandidate[] = [];
  for (const page of pages) {
    const visible = page.items.filter((i) => i.width > 0 && i.str.trim());
    const center = (page.view[0] + page.view[2]) / 2;
    const leftLines = visible.filter((i) => prose(i) && i.x + i.width < center);
    const rightLines = visible.filter((i) => prose(i) && i.x > center);
    if (
      leftLines.length > 5 &&
      rightLines.length > 5 &&
      !visible.some((i) => prose(i) && i.width > (page.view[2] - page.view[0]) * 0.55)
    )
      continue;
    const rows: { y: number; items: PdfTextItem[] }[] = [];
    for (const item of visible.filter(prose).sort((a, b) => b.y - a.y)) {
      let row = rows.find((r) => Math.abs(r.y - item.y) < 2);
      if (!row) {
        row = { y: item.y, items: [] };
        rows.push(row);
      }
      row.items.push(item);
    }
    for (let n = 0; n < rows.length - 1; n++) {
      const upper = rows[n],
        lower = rows[n + 1],
        gap = upper.y - lower.y;
      if (gap < 25 || gap > 150) continue;
      const math = visible.filter((i) => i.y < upper.y - 10 && i.y > lower.y + 10);
      if (math.length < 4 || !math.some((i) => /[=∝≈≤≥]/u.test(i.str))) continue;
      // Only single-column candidates are supported. A prose item overlapping
      // another column/band is reason to reject, not to expand a crop across it.
      const left = Math.min(...math.map((i) => i.x)),
        right = Math.max(...math.map((i) => i.x + i.width));
      if (left < Math.min(...upper.items.map((i) => i.x), ...lower.items.map((i) => i.x)) + 12)
        continue;
      const top = Math.max(...math.map((i) => i.y + i.size * (i.ascent ?? 1)));
      const bottom = Math.min(...math.map((i) => i.y + i.size * (i.descent ?? -0.25)));
      if (top >= upper.y - 1 || bottom <= lower.y + 8) continue;
      const before = upper.items.toSorted((a, b) => b.str.length - a.str.length)[0];
      const after = lower.items.toSorted((a, b) => b.str.length - a.str.length)[0];
      found.push({
        fontSize: Math.max(before.size, after.size),
        id: `p${page.number}-y${Math.round(upper.y)}`,
        page: page.number,
        box: [
          Math.max(0, left - 5),
          Math.max(lower.y + 10, bottom - 5),
          Math.min(page.view[2], right + 5),
          Math.min(upper.y - 5, top + 5),
        ],
        before: before.str,
        after: after.str,
        beforeY: upper.y,
        afterY: lower.y,
        text: math.map((i) => i.str).join(''),
        items: math.map((i) => i.index),
      });
    }
  }
  return found;
}
function normalizedMap(text: string) {
  let normalized = '',
    map: number[] = [];
  for (let i = 0; i < text.length;) {
    const cp = String.fromCodePoint(text.codePointAt(i)!),
      s = normalize(cp);
    normalized += s;
    for (let k = 0; k < s.length; k++) map.push(i);
    i += cp.length;
  }
  return { normalized, map };
}
export function align(pages: PdfTextPage[], text: string) {
  const { normalized, map } = normalizedMap(text),
    matches: EquationMatch[] = [];
  for (const c of candidates(pages)) {
    const a = normalize(c.before).slice(-48),
      b = normalize(c.after).slice(0, 48),
      first = normalized.indexOf(a),
      last = normalized.indexOf(b, first + a.length);
    if (
      first < 0 ||
      last < 0 ||
      normalized.indexOf(a, first + 1) >= 0 ||
      normalized.indexOf(b, last + 1) >= 0
    )
      continue;
    // Keep the full native prose lines, including their inline math, outside the image.
    const start = text.indexOf('\n', map[first + a.length - 1]) + 1;
    const end = text.lastIndexOf('\n', map[last]);
    if (start <= 0 || end <= start || start > map[last]) continue;
    const raw = text.slice(start, end).trim();
    if (!/[=∝≈≤≥]/u.test(raw) || normalize(raw).length < 4 || !sameFormula(c.text, raw)) continue;
    matches.push({ ...c, start, end, raw });
  }
  // Identical surrounding text on different pages has no safe textual resolution.
  if (matches.some((m, i) => matches.some((n, j) => i !== j && m.start < n.end && n.start < m.end)))
    return { status: 'ambiguous', matches: [] };
  return { status: matches.length ? 'matched' : 'unresolved', matches };
}

// Whitespace and known sum/product/root extraction artifacts may differ between
// PDFium and PDF.js. Preserve letter case, operand order, digits and operators;
// a different formula with the same surrounding prose must never match.
export function sameFormula(expected: string, actual: string, inline = false): boolean {
  if (inline) {
    const exact = (s: string) => s.normalize('NFKC').replace(/−/gu, '-').replace(/\s/gu, '');
    return exact(expected) === exact(actual);
  }
  const signature = (s: string) =>
    s
      .normalize('NFKC')
      .replace(/−/gu, '-')
      .replace(/[^\p{L}\p{N}=+\-<>≤≥≈≠∝.,/:*]/gu, '');
  const wanted = signature(expected);
  const artifacts: Record<string, number> = {
    X: (expected.match(/∑/g) ?? []).length,
    Y: (expected.match(/∏/g) ?? []).length,
    p: (expected.match(/√/g) ?? []).length,
  };
  let index = 0;
  for (const char of signature(actual)) {
    if (char === wanted[index]) index++;
    else if (artifacts[char] > 0) artifacts[char]--;
    else return false;
  }
  return index === wanted.length;
}
