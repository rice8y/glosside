import { sameFormula, type PdfTextPage, type EquationMatch } from './equation-alignment';

// Require an explicit mathematical font, not merely italics or a short word.
const mathFont = (name = '') =>
  /(?:^|[+\-])(?:CM(?:MI|SY|EX)\d|MS[AB]M\d|STIX.*Math|.*Math(?:Italic|Symbol)|CambriaMath)/i.test(
    name,
  );
const compact = (s: string) => s.normalize('NFKC').replace(/\s/gu, '');
export function analyzeInline(pages: PdfTextPage[], source: string) {
  let text = '';
  const offsets: number[] = [];
  for (let n = 0; n < source.length;) {
    const cp = String.fromCodePoint(source.codePointAt(n)!);
    const normalized = compact(cp);
    text += normalized;
    for (let i = 0; i < normalized.length; i++) offsets.push(n);
    n += cp.length;
  }
  if (pages.reduce((n, p) => n + p.items.filter((i) => mathFont(i.fontLabel)).length, 0) > 4096)
    return { matches: [] as EquationMatch[], unresolved: [{ start: 0, end: source.length }] };
  const matches: EquationMatch[] = [];
  const unresolved: { start: number; end: number }[] = [];
  for (const page of pages) {
    const items = page.items.filter((i) => i.width > 0 && i.str.trim());
    for (let a = 0; a < items.length; a++) {
      if (!mathFont(items[a].fontLabel)) continue;
      let b = a + 1;
      while (
        b < items.length &&
        (mathFont(items[b].fontLabel) ||
          /^[\d=+−*/()[\]<>≤≥.,:]+$/.test(items[b].str.replace(/\s/gu, ''))) &&
        Math.abs(items[b].y - items[a].y) < items[a].size * 1.4 &&
        items[b].x >= items[a].x - 2
      )
        b++;
      // Trailing punctuation belongs to the prose unless it is in a math font.
      while (
        b > a + 1 &&
        !mathFont(items[b - 1].fontLabel) &&
        /^[.,:]+$/.test(items[b - 1].str.trim())
      )
        b--;
      const math = items.slice(a, b),
        before = items[a - 1],
        after = items[b];
      a = b - 1;
      if (!before || !after || mathFont(before.fontLabel) || mathFont(after.fontLabel)) continue;
      const baseline = before.y,
        size = before.size;
      if (
        Math.abs(after.y - baseline) > 1 ||
        Math.abs(math[0].y - baseline) > size ||
        before.x >= math[0].x ||
        after.x <= math[0].x
      )
        continue;
      // Anchor in the same physical line; do not cross columns or line wraps.
      let beforeText = before.str,
        afterText = after.str;
      for (
        let n = b - math.length - 2;
        n >= 0 && compact(beforeText).length < 24 && Math.abs(items[n].y - baseline) < 1;
        n--
      )
        beforeText = items[n].str + beforeText;
      for (
        let n = b + 1;
        n < items.length && compact(afterText).length < 24 && Math.abs(items[n].y - baseline) < 1;
        n++
      )
        afterText += items[n].str;
      const leftAnchor = compact(beforeText).slice(-24),
        rightAnchor = compact(afterText).slice(0, 24);
      if (leftAnchor.length < 8 || rightAnchor.length < 8) continue;
      const left = text.indexOf(leftAnchor),
        right = text.indexOf(rightAnchor, left + leftAnchor.length);
      if (
        left < 0 ||
        right < 0 ||
        text.indexOf(leftAnchor, left + 1) >= 0 ||
        text.indexOf(rightAnchor, right + 1) >= 0
      )
        continue;
      let start =
        offsets[left + leftAnchor.length - 1] +
        String.fromCodePoint(source.codePointAt(offsets[left + leftAnchor.length - 1])!).length;
      let end = offsets[right];
      while (/\s/u.test(source[start] ?? '') && start < end) start++;
      while (end > start && /\s/u.test(source[end - 1])) end--;
      const raw = source.slice(start, end),
        expected = math.map((i) => i.str).join('');
      if (!raw) continue;
      const pending = { start, end };
      unresolved.push(pending);
      if (!sameFormula(expected, raw, true)) continue;
      if (
        ['()', '[]'].some(
          ([open, close]) =>
            [...expected].reduce((n, c) => n + (c === open ? 1 : c === close ? -1 : 0), 0) !== 0,
        )
      )
        continue;
      const x0 = Math.min(...math.map((i) => i.x)),
        x1 = Math.max(...math.map((i) => i.x + i.width));
      const y0 = Math.min(...math.map((i) => i.y + i.size * (i.descent ?? -0.25)));
      const y1 = Math.max(...math.map((i) => i.y + i.size * (i.ascent ?? 1)));
      const pad = 1.5;
      const box = [
        Math.max(x0 - pad, (before.x + before.width + x0) / 2),
        y0 - 0.75,
        Math.min(x1 + pad, (after.x + x1) / 2),
        y1 + 0.75,
      ];
      if (box[0] < before.x + before.width - 0.1 || box[2] > after.x + 0.1) continue;
      // Reject any crop intersecting another text item's ink bounds.
      if (
        items.some(
          (i) =>
            !math.includes(i) &&
            i.x < box[2] - 0.05 &&
            i.x + i.width > box[0] + 0.05 &&
            i.y + i.size * (i.ascent ?? 1) > box[1] &&
            i.y + i.size * (i.descent ?? -0.25) < box[3],
        )
      )
        continue;
      unresolved.splice(unresolved.indexOf(pending), 1);
      matches.push({
        id: `inline-${page.number}-${math[0].index}`,
        page: page.number,
        box,
        before: beforeText,
        after: afterText,
        beforeY: baseline,
        afterY: baseline,
        text: expected,
        items: math.map((i) => i.index),
        fontSize: size,
        start,
        end,
        raw,
      });
    }
  }
  // Repeated passages/pages cannot be disambiguated from selected text alone.
  const safe = matches.filter(
    (m) => !matches.some((n) => n !== m && n.start < m.end && m.start < n.end),
  );
  unresolved.push(...matches.filter((m) => !safe.includes(m)));
  // Selections can start/end inside the anchors. Recognized math-font words in
  // the remaining source must not silently go through the language model.
  const checked = new Set<string>();
  for (const page of pages) {
    const visible = page.items.filter((i) => i.width > 0 && i.str.trim());
    for (let i = 0; i < visible.length; i++) {
      if (!mathFont(visible[i].fontLabel)) continue;
      let raw = visible[i].str;
      const words = [raw];
      while (
        i + 1 < visible.length &&
        mathFont(visible[i + 1].fontLabel) &&
        Math.abs(visible[i + 1].y - visible[i].y) < visible[i].size * 1.4 &&
        visible[i + 1].x >= visible[i].x
      ) {
        raw += visible[++i].str;
        words.push(visible[i].str);
      }
      for (const value of new Set([...words, raw])) {
        const word = compact(value);
        if (!word || word.length > 60 || checked.has(word)) continue;
        checked.add(word);
        // A punctuation glyph in a math font elsewhere in the document does
        // not establish that the same punctuation in this selection is math.
        // Keep punctuation within anchored formulas, but never use it alone
        // to reject prose such as a sentence ending in a numeric citation.
        if (/^[.,;:!?()[\]{}]+$/u.test(word)) continue;
        const escaped = [...word].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
        const pattern = new RegExp('(?<![\\p{L}\\p{N}])' + escaped + '(?![\\p{L}\\p{N}])', 'gu');
        for (const found of source.matchAll(pattern)) {
          const start = found.index!,
            end = start + found[0].length;
          if (!safe.some((m) => m.start <= start && m.end >= end)) unresolved.push({ start, end });
        }
      }
    }
  }
  return { matches: safe, unresolved };
}

export const alignInline = (pages: PdfTextPage[], source: string) =>
  analyzeInline(pages, source).matches;
