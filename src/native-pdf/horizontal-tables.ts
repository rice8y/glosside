import type { PdfTextItem } from './equation-alignment';
import type { Line, TableCandidate } from './table-alignment';

const visible = (i: PdfTextItem) => i.str.trim() && i.width > 0;
const median = (values: number[]) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
interface Row {
  y: number;
  items: PdfTextItem[];
}
function textRows(items: PdfTextItem[], size: number): Row[] {
  const rows: Row[] = [];
  for (const item of items.toSorted((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - item.y) < size * 0.35);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  return rows;
}
function intervals(items: PdfTextItem[], gap: number): [number, number][] {
  const spans: [number, number][] = [];
  for (const item of items.toSorted((a, b) => a.x - b.x)) {
    const previous = spans.at(-1);
    if (previous && item.x - previous[1] < gap)
      previous[1] = Math.max(previous[1], item.x + item.width);
    else spans.push([item.x, item.x + item.width]);
  }
  return spans;
}

// Booktabs-style tables have a top rule, a header rule, and a bottom rule.
// Column boundaries must be whitespace corridors shared by the header and all
// body rows. This does not infer column ownership from language or model output.
export function horizontalTables(lines: Line[], items: PdfTextItem[]): TableCandidate[] {
  const groups: Line[][] = [];
  for (const line of lines) {
    if (Math.abs(line.y1 - line.y2) > 0.1 || Math.abs(line.x2 - line.x1) < 60) continue;
    const normalized = {
      x1: Math.min(line.x1, line.x2),
      x2: Math.max(line.x1, line.x2),
      y1: line.y1,
      y2: line.y1,
    };
    const group = groups.find(
      (g) => Math.abs(g[0].x1 - normalized.x1) < 1 && Math.abs(g[0].x2 - normalized.x2) < 1,
    );
    if (group) group.push(normalized);
    else groups.push([normalized]);
  }
  const out: TableCandidate[] = [];
  for (const group of groups) {
    const rules = group
      .sort((a, b) => b.y1 - a.y1)
      .filter((l, n, a) => !n || Math.abs(l.y1 - a[n - 1].y1) > 1);
    if (rules.length < 3 || rules.length > 40) continue;
    // Try short regions first: separate tables in the same column can have the
    // same rule width. A caption between them must never become a table row.
    let consumed = -1;
    for (let topIndex = 0; topIndex < rules.length - 2; topIndex++) {
      if (topIndex <= consumed) continue;
      for (let bottomIndex = topIndex + 2; bottomIndex < rules.length; bottomIndex++) {
        const left = rules[topIndex].x1,
          right = rules[topIndex].x2;
        const top = rules[topIndex].y1,
          bottom = rules[bottomIndex].y1;
        if (top - bottom > 600) break;
        const all = items.filter(
          (i) => visible(i) && i.x < right && i.x + i.width > left && i.y < top && i.y > bottom,
        );
        if (all.length < 6 || all.length > 1500) continue;
        const size = median(all.map((i) => i.size));
        if (!Number.isFinite(size) || size <= 0) continue;
        const rows = textRows(all, size);
        if (rows.length < 3 || rows.length > 40) continue;
        const headerRule = rules[topIndex + 1].y1;
        const headers = rows.filter((r) => r.y > headerRule);
        const body = rows.filter((r) => r.y < headerRule);
        if (headers.length !== 1 || body.length < 2) continue;
        const headerSpans = intervals(headers[0].items, size * 0.6);
        if (headerSpans.length < 2 || headerSpans.length > 12) continue;
        // A lone, left-aligned label immediately below a rule is a row-group
        // heading. Exclude it when measuring column gaps; retain it as a span.
        const sections = new Set(
          rows.filter(
            (row, n) =>
              n > 0 &&
              intervals(row.items, size * 0.6).length === 1 &&
              Math.abs(row.items[0].x - headers[0].items[0].x) < size * 0.5 &&
              rules
                .slice(topIndex + 1, bottomIndex)
                .some((rule) => rule.y1 > row.y && rule.y1 < rows[n - 1].y) &&
              rows[n + 1] &&
              intervals(rows[n + 1].items, size * 0.6).length >= 2,
          ),
        );
        const regular = rows.filter((row) => !sections.has(row));
        if (regular.length < 3) continue;
        const spans = intervals(
          regular.flatMap((r) => r.items),
          size * 0.45,
        );
        // Independent row evidence is required even for the image fallback.
        // Equations, diagrams, prose columns and page headers are not tables.
        const counts = regular
          .slice(1)
          .map((row) => intervals(row.items, size * 0.6).length)
          .filter((n) => n >= 2 && n <= 12);
        const columnCount = [...new Set(counts)].sort(
          (a, b) => counts.filter((n) => n === b).length - counts.filter((n) => n === a).length,
        )[0];
        const repeated = regular
          .slice(1)
          .filter((row) => intervals(row.items, size * 0.6).length === columnCount);
        if (
          repeated.length < 2 ||
          regular.some((row) => row.items.some((i) => i.width > (right - left) * 0.8))
        )
          continue;
        const dense = repeated.slice(0, 2);
        const aligned = intervals(dense[0].items, size * 0.6).every(([a, b]) =>
          dense.every((row) =>
            intervals(row.items, size * 0.6).some(
              ([x, y]) => Math.max(a, x) < Math.min(b, y) + size * 0.3,
            ),
          ),
        );
        if (!aligned) continue;
        // Do not stop at an internal group separator if another aligned table
        // row follows it. The last rule must actually end the table.
        const below = items.filter(
          (i) =>
            visible(i) &&
            i.x >= left &&
            i.x + i.width <= right &&
            i.y < bottom &&
            i.y > bottom - size * 2.8,
        );
        if (bottomIndex < rules.length - 1 && below.length) {
          const nextRows = textRows(below, size);
          if (
            nextRows.some((r) => intervals(r.items, size * 0.6).length === columnCount) ||
            nextRows.some(
              (r) =>
                intervals(r.items, size * 0.6).length === 1 &&
                r.items.reduce((n, i) => n + i.width, 0) < (right - left) * 0.5,
            )
          )
            continue;
        }
        const bounds = [
          left,
          ...spans.slice(0, -1).map((s, n) => (s[1] + spans[n + 1][0]) / 2),
          right,
        ];
        let safe =
          spans.length === columnCount &&
          headerSpans.length === columnCount &&
          all.every(
            (i) =>
              !i.rotated &&
              i.x >= left - 0.5 &&
              i.x + i.width <= right + 0.5 &&
              i.y + i.size * (i.ascent ?? 0.9) <= top + 0.5 &&
              i.y + i.size * (i.descent ?? -0.2) >= bottom - 0.5,
          );
        const grid = rows.map((row, n) => {
          if (sections.has(row)) return [{ header: true, colSpan: spans.length, items: row.items }];
          const cells = spans.map(() => ({
            header: n === 0,
            colSpan: 1,
            items: [] as PdfTextItem[],
          }));
          for (const item of row.items) {
            const c = bounds.findIndex(
              (x, k) =>
                k < bounds.length - 1 &&
                item.x >= x - 0.1 &&
                item.x + item.width <= bounds[k + 1] + 0.1,
            );
            if (c < 0) safe = false;
            else cells[c].items.push(item);
          }
          if (n === 0 && cells.some((c) => !c.items.length)) safe = false;
          return cells;
        });
        out.push({
          items: all,
          box: [left, bottom, right, top],
          fontSize: size,
          ...(safe ? { rows: grid } : {}),
        });
        consumed = bottomIndex;
        break;
      }
    }
  }
  return out;
}
