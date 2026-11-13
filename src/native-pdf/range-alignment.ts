import { classifyItems, inferMathFonts, proseItem } from './item-classification';
import { alignLocal } from './local-alignment';
import {
  compactGlyphText,
  compactItemText,
  glyphAlternatives,
  orderOverlaidAccents,
  orderOperatorLimits,
  visibleGlyphItem,
  matchesGlyphText,
  matchesFormulaLayout,
} from './glyph-mapping';
import type { PdfTextItem, PdfTextPage } from './equation-alignment';

export interface MathRange {
  // Repeated passages are usable only if every candidate renders identically.
  alternatives?: MathRange[];
  legacyBox?: number[];
  unresolved?: boolean;
  start: number;
  end: number;
  page: number;
  items: PdfTextItem[];
  display: boolean;
  fontSize: number;
  fragments: { items: PdfTextItem[]; baseline: number }[];
}
const canonical = (text: string) =>
  text
    .normalize('NFKC')
    .replace(/−/gu, '-')
    .replace(/∑/gu, 'P')
    .replace(/∏/gu, 'Y')
    .replace(/\s/gu, '');
export interface ProseRange {
  start: number;
  end: number;
}
export interface RangeSelection {
  ranges: MathRange[];
  prose: ProseRange[];
}
const words = proseItem;
// Tall operators have an elevated text origin. Use the next regular glyph's
// baseline to recognize a wrapped inline row without detaching its limits.
function formulaFragments(
  math: PdfTextItem[],
  display: boolean,
  fontSize: number,
): MathRange['fragments'] {
  const fragments: MathRange['fragments'] = [];
  for (let n = 0; n < math.length; n++) {
    const item = math[n];
    const following = /CMEX/.test(item.fontLabel ?? '')
      ? math
          .slice(n + 1)
          .find(
            (i) =>
              i.size >= fontSize * 0.9 &&
              !/CMEX/.test(i.fontLabel ?? '') &&
              i.x >= item.x &&
              i.x < item.x + fontSize * 4 &&
              i.y <= item.y &&
              i.y > item.y - fontSize * 1.5,
          )
      : undefined;
    const baseline = following?.y ?? item.y;
    let row = fragments.at(-1);
    if (
      !row ||
      (!display &&
        item.x < row.items.at(-1)!.x - fontSize &&
        baseline < row.baseline - fontSize * 0.5)
    ) {
      row = { items: [], baseline };
      fragments.push(row);
    }
    row.items.push(item);
    if (item.size >= fontSize * 0.9 && !/CMEX/.test(item.fontLabel ?? ''))
      row.baseline = Math.min(row.baseline, item.y);
  }
  return fragments;
}

function bodyBaselines(items: PdfTextItem[], size: number): number[] {
  const regular = items.filter(
    (i) =>
      i.size >= size * 0.85 &&
      !/^[∑∏∫⋃⋂][\uFE00-\uFE0F]*$/u.test(i.str.trim()) &&
      !/CMEX/.test(i.fontLabel ?? ''),
  );
  return (regular.length ? regular : items).map((i) => i.y);
}

function sourceMap(source: string, symbols = false) {
  let text = '';
  const map: number[] = [];
  for (let n = 0; n < source.length;) {
    const cp = String.fromCodePoint(source.codePointAt(n)!);
    if (
      cp === '-' &&
      /[a-z]/i.test(source[n - 1] ?? '') &&
      /^\r?\n[a-z]/.test(source.slice(n + 1))
    ) {
      n++;
      continue;
    }
    const c = symbols ? compactGlyphText(cp) : canonical(cp);
    text += c;
    for (let k = 0; k < c.length; k++) map.push(n);
    n += cp.length;
  }
  return { text, map };
}
// Match the complete selected range in PDF reading order. Formula characters are
// checked along with prose, so short repeated variables need no independent anchor.
function alignExactRange(
  pages: PdfTextPage[],
  source: string,
  learned: Set<string>,
): RangeSelection | undefined {
  const selected = sourceMap(source);
  if (selected.text.length < 24) return;
  const hits: { page: PdfTextPage; items: PdfTextItem[]; first: number; offsets: number[][] }[] =
    [];
  for (const page of pages) {
    const items = page.items.filter(visibleGlyphItem);
    let text = '';
    const offsets: number[][] = [];
    for (let n = 0; n < items.length; n++) {
      let raw = items[n].str;
      if (
        /[a-z]-$/i.test(raw) &&
        items[n + 1]?.y < items[n].y - items[n].size * 0.5 &&
        /^[a-z]/.test(items[n + 1].str)
      )
        raw = raw.slice(0, -1);
      const part = canonical(raw);
      offsets.push([text.length, text.length + part.length]);
      text += part;
    }
    let from = 0;
    for (;;) {
      const first = text.indexOf(selected.text, from);
      if (first < 0) break;
      hits.push({ page, items, first, offsets });
      from = first + 1;
      if (hits.length > 1) return;
    }
  }
  if (hits.length !== 1) return;
  const { page, items, first, offsets } = hits[0],
    last = first + selected.text.length;
  const included = items.filter((_, n) => offsets[n][0] >= first && offsets[n][1] <= last);
  if (!included.length) return;
  const prose = included.filter(words);
  if (prose.length < 2) return;
  const { fontSize, isMath, isProse } = classifyItems(items, learned);
  const verified: ProseRange[] = [];
  for (let n = 0; n < items.length; n++) {
    if (!isProse(items[n])) continue;
    const start = Math.max(first, offsets[n][0]) - first,
      end = Math.min(last, offsets[n][1]) - first;
    if (end > start)
      verified.push({
        start: selected.map[start],
        end:
          selected.map[end - 1] +
          String.fromCodePoint(source.codePointAt(selected.map[end - 1])!).length,
      });
  }
  if (
    items.some(
      (item, n) =>
        offsets[n][0] < last &&
        offsets[n][1] > first &&
        (offsets[n][0] < first || offsets[n][1] > last) &&
        isMath(item),
    )
  )
    return;
  const ranges: MathRange[] = [];
  for (let n = 0; n < included.length; n++) {
    if (!isMath(included[n])) continue;
    const start = n;
    while (n + 1 < included.length && isMath(included[n + 1])) n++;
    let math = included.slice(start, n + 1);
    const ys = bodyBaselines(math, fontSize);
    const nearProse = included.filter(
      (i) =>
        !isMath(i) &&
        !/^\(\d+\)$/.test(i.str) &&
        i.y >= Math.min(...ys) - fontSize * 0.6 &&
        i.y <= Math.max(...ys) + fontSize * 0.6 &&
        i.x < Math.max(...math.map((i) => i.x + i.width)) + fontSize * 6,
    );
    const display = nearProse.length === 0;
    if (
      display &&
      included[n + 1] &&
      /^\(\d+\)$/.test(included[n + 1].str.trim()) &&
      included[n + 1].y <= Math.max(...math.map((i) => i.y)) + fontSize * 0.5 &&
      included[n + 1].y >= Math.min(...math.map((i) => i.y)) - fontSize * 2
    )
      math = [...math, included[++n]];
    const a = items.indexOf(math[0]),
      b = items.indexOf(math.at(-1)!);
    const s = offsets[a][0] - first,
      e = offsets[b][1] - first;
    const sourceStart = selected.map[s],
      sourceEnd =
        selected.map[e - 1] + String.fromCodePoint(source.codePointAt(selected.map[e - 1])!).length;
    // Partial text items at the selection boundary are never authorized as images.
    if (sourceStart === undefined || sourceEnd > source.length) return;
    const fragments = formulaFragments(math, display, fontSize);
    ranges.push({
      start: sourceStart,
      end: sourceEnd,
      page: page.number,
      items: math,
      display,
      fontSize,
      fragments,
    });
  }

  // A uniquely matched prose-only selection is evidence too. Do not discard it
  // and let unrelated math glyphs elsewhere in the PDF veto ordinary prose.
  return ranges.length || verified.length ? { ranges, prose: verified } : undefined;
}

// Prose anchors locate the selection independently of the formula extraction.
// Only exact local formula matches authorize images; a mismatch affects that gap.
export function alignSelection(pages: PdfTextPage[], source: string): RangeSelection | undefined {
  const learned = inferMathFonts(pages.flatMap((p) => p.items));
  const exact = alignExactRange(pages, source, learned);
  if (exact) return exact;
  const selected = sourceMap(source, true);
  if (selected.text.length < 24) return;
  let candidates: (RangeSelection & { score: number; complete: boolean })[] = [];
  for (const page of pages) {
    const items = orderOverlaidAccents(page.items.filter(visibleGlyphItem));
    const prose = items.filter(words);
    if (!prose.length) continue;
    const { fontSize, isMath, isProse } = classifyItems(items, learned);
    // Keep all upper-limit items together, including multi-glyph limits.
    orderOperatorLimits(items, isMath, fontSize);
    let text = '';
    const offsets: number[][] = [];
    for (let n = 0; n < items.length; n++) {
      let raw = items[n].str;
      if (
        /[a-z]-$/i.test(raw) &&
        items[n + 1]?.y < items[n].y - items[n].size * 0.5 &&
        /^[a-z]/.test(items[n + 1].str)
      )
        raw = raw.slice(0, -1);
      // Keep operators distinct from ordinary letters until comparison.
      const value = compactItemText(page, items[n], raw);
      offsets.push([text.length, text.length + value.length]);
      text += value;
    }
    type Anchor = { s: number; e: number; a: number; b: number };
    const anchors: Anchor[] = [];
    const repeated: Anchor[] = [];
    for (let n = 0; n < items.length; n++) {
      if (isMath(items[n])) continue;
      const [a, b] = offsets[n],
        value = text.slice(a, b);
      if (value.length < 8) continue;
      // Extend exact seeds, including prose selected halfway through an item.
      for (let k = 0; k + 8 <= value.length; k += 4) {
        const seed = value.slice(k, k + 8),
          at = selected.text.indexOf(seed);
        if (at < 0 || selected.text.indexOf(seed, at + 1) >= 0) continue;
        const unique = text.indexOf(seed) === a + k && text.indexOf(seed, a + k + 1) < 0;
        let s = at,
          e = at + 8,
          l = a + k,
          r = l + 8;
        while (s > 0 && l > a && selected.text[s - 1] === text[l - 1]) {
          s--;
          l--;
        }
        while (e < selected.text.length && r < b && selected.text[e] === text[r]) {
          e++;
          r++;
        }
        const target = unique ? anchors : repeated;
        if (!target.some((x) => x.s === s && x.a === l)) target.push({ s, e, a: l, b: r });
      }
    }
    anchors.sort((a, b) => a.s - b.s || b.e - a.e);
    const chain: Anchor[] = [];
    let ambiguous = false;
    for (const anchor of anchors) {
      const prev = chain.at(-1);
      if (prev && anchor.s < prev.e) {
        if (anchor.a - anchor.s !== prev.a - prev.s) {
          ambiguous = true;
          break;
        }
        if (anchor.e > prev.e) {
          prev.e = anchor.e;
          prev.b = anchor.b;
        }
      } else if (prev && anchor.a < prev.b) {
        ambiguous = true;
        break;
      } else chain.push({ ...anchor });
    }
    if (
      ambiguous ||
      chain.length < 1 ||
      chain.reduce((n, a) => n + a.e - a.s, 0) < Math.max(16, selected.text.length * 0.2)
    )
      continue;
    // Repeated prose cannot locate a page by itself. Once unique anchors have
    // established a region, accept a repeated phrase only at a single compatible
    // location between those anchors (including a bounded selection edge).
    const compatible = repeated.filter((r) => {
      if (r.e - r.s < 12) return false;
      const before = chain.filter((x) => x.e <= r.s).at(-1);
      const after = chain.find((x) => x.s >= r.e);
      if (!before && !after) return false;
      if (chain.some((x) => r.s < x.e && r.e > x.s && r.a - r.s !== x.a - x.s)) return false;
      return (
        (!before || (r.a >= before.b && Math.abs(r.a - before.b - (r.s - before.e)) <= 64)) &&
        (!after || (r.b <= after.a && Math.abs(after.a - r.b - (after.s - r.e)) <= 64))
      );
    });
    for (const r of compatible) {
      if (compatible.some((x) => x.s < r.e && x.e > r.s && x.a - x.s !== r.a - r.s)) continue;
      if (chain.some((x) => x.s <= r.s && x.e >= r.e)) continue;
      chain.push({ ...r });
    }
    chain.sort((a, b) => a.s - b.s || b.e - a.e);
    for (let n = 1; n < chain.length;) {
      const prev = chain[n - 1],
        curr = chain[n];
      if (curr.s <= prev.e && curr.a - curr.s === prev.a - prev.s) {
        if (curr.e > prev.e) {
          prev.e = curr.e;
          prev.b = curr.b;
        }
        chain.splice(n, 1);
      } else n++;
    }
    // Pages without a viable anchor chain never compare glyph alternatives.
    const alternatives = items.flatMap((item, n) =>
      glyphAlternatives(page, item, text.slice(offsets[n][0], offsets[n][1])),
    );
    const same = (a: number, b: number, actual: string) =>
      matchesGlyphText(alternatives.slice(a, b), actual);
    const rangeStart = chain[0].a - chain[0].s;
    const lastAnchor = chain.at(-1)!;
    const rangeEnd = lastAnchor.b + selected.text.length - lastAnchor.e;
    const selectedItems = items.filter(
      (_, n) => offsets[n][0] < rangeEnd && offsets[n][1] > rangeStart,
    );
    const ranges: MathRange[] = [];
    const verified: ProseRange[] = [];
    const verifyProse = (a: number, b: number, s: number, e: number) => {
      if (e <= s || !same(a, b, selected.text.slice(s, e))) return;
      verified.push({
        start: selected.map[s],
        end:
          selected.map[e - 1] +
          String.fromCodePoint(source.codePointAt(selected.map[e - 1])!).length,
      });
    };
    for (let n = 0; n < items.length; n++)
      if (isProse(items[n]))
        for (const anchor of chain) {
          const a = Math.max(offsets[n][0], anchor.a),
            b = Math.min(offsets[n][1], anchor.b);
          if (b > a) verifyProse(a, b, anchor.s + a - anchor.a, anchor.s + b - anchor.a);
        }
    const original = (s: number, e: number) => {
      if (e <= s) return;
      ranges.push({
        start: selected.map[s],
        end:
          selected.map[e - 1] +
          String.fromCodePoint(source.codePointAt(selected.map[e - 1])!).length,
        page: page.number,
        items: [],
        display: false,
        fontSize,
        fragments: [],
        unresolved: true,
      });
    };
    const gap = (s: number, e: number, a: number, b: number) => {
      if (e <= s) return;
      if (a < 0 || b > text.length) {
        original(s, e);
        return;
      }
      const actual = selected.text.slice(s, e);
      const inside = items
        .map((item, n) => ({ item, n }))
        .filter(({ n }) => offsets[n][0] < b && offsets[n][1] > a);
      const layoutSame = () => {
        if (b - a !== actual.length) return false;
        let cursor = a;
        for (let k = 0; k < inside.length; k++) {
          if (!isMath(inside[k].item)) continue;
          const start = k;
          while (k + 1 < inside.length && isMath(inside[k + 1].item)) k++;
          const group = inside.slice(start, k + 1),
            lo = offsets[group[0].n][0],
            hi = offsets[group.at(-1)!.n][1];
          if (
            lo < a ||
            hi > b ||
            !same(cursor, lo, actual.slice(cursor - a, lo - a)) ||
            !matchesFormulaLayout(
              page,
              group.map((g) => g.item),
              actual.slice(lo - a, hi - a),
              fontSize,
            )
          )
            return false;
          cursor = hi;
        }
        return same(cursor, b, actual.slice(cursor - a));
      };
      const exact = b - a === actual.length && (same(a, b, actual) || layoutSame());
      const aligned = exact
        ? { boundaries: Array.from({ length: b - a + 1 }, (_, n) => n), changed: [] }
        : alignLocal(alternatives.slice(a, b), actual);
      if (!aligned) {
        original(s, e);
        return;
      }
      const covered: { start: number; end: number }[] = [];
      const project = (offset: number) =>
        aligned.boundaries[Math.max(0, Math.min(b - a, offset - a))];
      for (const { item, n } of inside)
        if (isProse(item)) {
          const lo = Math.max(a, offsets[n][0]),
            hi = Math.min(b, offsets[n][1]);
          verifyProse(lo, hi, s + project(lo), s + project(hi));
        }
      for (let k = 0; k < inside.length; k++) {
        if (!isMath(inside[k].item)) continue;
        const start = k;
        while (k + 1 < inside.length && isMath(inside[k + 1].item)) k++;
        const group = inside.slice(start, k + 1),
          lo = offsets[group[0].n][0];
        let hi = offsets[group.at(-1)!.n][1];
        if (lo < a || hi > b) {
          const start = project(lo),
            end = project(hi);
          original(s + start, s + end);
          covered.push({ start, end });
          continue;
        }
        const math = group.map((x) => x.item),
          ys = bodyBaselines(math, fontSize);
        const nearProse = selectedItems.filter(
          (i) =>
            !isMath(i) &&
            !/^\(\d+\)$/.test(i.str) &&
            i.y >= Math.min(...ys) - fontSize * 0.6 &&
            i.y <= Math.max(...ys) + fontSize * 0.6 &&
            i.x < Math.max(...math.map((i) => i.x + i.width)) + fontSize * 6 &&
            i.x + i.width > Math.min(...math.map((i) => i.x)) - fontSize * 6,
        );
        const display = nearProse.length === 0;
        const label = inside[k + 1];
        if (
          display &&
          label &&
          /^\(\d+\)$/.test(label.item.str.trim()) &&
          offsets[label.n][1] <= b &&
          label.item.y <= Math.max(...math.map((i) => i.y)) + fontSize * 0.5 &&
          label.item.y >= Math.min(...math.map((i) => i.y)) - fontSize * 2
        ) {
          math.push(label.item);
          hi = offsets[label.n][1];
          k++;
        }
        const fragments = formulaFragments(math, display, fontSize);
        const startAt = project(lo),
          endAt = project(hi);
        if (endAt <= startAt) continue;
        covered.push({ start: startAt, end: endAt });
        const begin = s + startAt,
          end = s + endAt;
        const boundaryGlyph =
          actual.slice(startAt, endAt) === '\uFFFD' &&
          math.length === 1 &&
          [...math[0].str].length === 1 &&
          math[0].str.codePointAt(0)! > 0xffff &&
          compactItemText(page, math[0]).length === 1 &&
          ((begin === 0 && chain[0].s <= 8) ||
            (end === selected.text.length && selected.text.length - chain.at(-1)!.e <= 8));
        ranges.push({
          unresolved:
            !(
              boundaryGlyph ||
              same(lo, hi, actual.slice(startAt, endAt)) ||
              matchesFormulaLayout(page, math, actual.slice(startAt, endAt), fontSize)
            ) || undefined,
          start: selected.map[begin],
          end:
            selected.map[end - 1] +
            String.fromCodePoint(source.codePointAt(selected.map[end - 1])!).length,
          page: page.number,
          items: math,
          display,
          fontSize,
          fragments,
        });
      }
      // Protect changed characters outside formulas too; none may leak into prose.
      for (const change of aligned.changed) {
        let cursor = change.start;
        for (const span of covered) {
          if (span.end <= cursor || span.start >= change.end) continue;
          if (cursor < span.start) original(s + cursor, s + span.start);
          cursor = Math.max(cursor, span.end);
        }
        if (cursor < change.end) original(s + cursor, s + change.end);
      }
    };
    const first = chain[0],
      last = chain.at(-1)!;
    gap(0, first.s, first.a - first.s, first.a);
    for (let n = 1; n < chain.length; n++)
      gap(chain[n - 1].e, chain[n].s, chain[n - 1].b, chain[n].a);
    gap(last.e, selected.text.length, last.b, last.b + selected.text.length - last.e);
    ranges.sort((a, b) => a.start - b.start);
    if (ranges.length)
      candidates.push({
        ranges,
        prose: verified,
        score: chain.reduce((n, a) => n + a.e - a.s, 0),
        complete:
          rangeStart >= 0 && rangeEnd <= text.length && same(rangeStart, rangeEnd, selected.text),
      });
  }
  // A complete exact match is stronger evidence than a similar passage that
  // contradicts the selected operands or prose, regardless of anchor length.
  if (candidates.some((c) => c.complete)) candidates = candidates.filter((c) => c.complete);
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) return;
  if (!candidates[1] || candidates[0].score > candidates[1].score * 1.5) return candidates[0];
  const competing = candidates.filter((c) => c.score >= candidates[0].score / 1.5);
  const best = competing[0];
  if (
    competing.length <= 3 &&
    competing.every(
      (c) =>
        c.ranges.length === best.ranges.length &&
        c.ranges.every(
          (r, n) =>
            !r.unresolved &&
            r.start === best.ranges[n].start &&
            r.end === best.ranges[n].end &&
            r.display === best.ranges[n].display,
        ),
    )
  ) {
    return {
      ranges: best.ranges.map((r, n) => ({
        ...r,
        alternatives: competing.slice(1).map((c) => c.ranges[n]),
      })),
      prose: best.prose.filter((r) =>
        competing.every((c) => c.prose.some((p) => p.start <= r.start && p.end >= r.end)),
      ),
    };
  }
  // Ambiguous locations never authorize images, but still isolate possible math
  // so a repeated passage does not prevent all surrounding prose translation.
  const uncertain = candidates
    .filter((c) => c.score >= candidates[0].score / 1.5)
    .flatMap((c) => c.ranges)
    .sort((a, b) => a.start - b.start);
  const protectedRanges: MathRange[] = [];
  for (const r of uncertain) {
    const previous = protectedRanges.at(-1);
    if (previous && r.start < previous.end) {
      previous.end = Math.max(previous.end, r.end);
      previous.display = previous.display && r.display;
    } else protectedRanges.push({ ...r, unresolved: true, items: [], fragments: [] });
  }
  return { ranges: protectedRanges, prose: candidates[0].prose };
}

export function alignRange(pages: PdfTextPage[], source: string): MathRange[] | undefined {
  return alignSelection(pages, source)?.ranges;
}
