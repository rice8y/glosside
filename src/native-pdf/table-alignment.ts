import type { StructTreeNode } from 'pdfjs-dist/types/src/display/api';
import type { PdfTextItem, PdfTextPage } from './equation-alignment';
import type { PdfTable } from '../shared/pdf-equations';

export const PDF_TABLE_WARNING = '行と列を安全に保持できない表は、原文のまま表示しています。';
export interface TableCandidate {
  items: PdfTextItem[];
  rows?: { header: boolean; items: PdfTextItem[] }[][];
}
export interface TablePage extends PdfTextPage {
  tables: TableCandidate[];
}
const visible = (i: PdfTextItem) => !!i.str.trim();
const ordered = (items: PdfTextItem[]) =>
  items.toSorted((a, b) =>
    Math.abs(a.y - b.y) > Math.min(a.size, b.size) * 0.4 ? b.y - a.y : a.x - b.x,
  );
const cellText = (items: PdfTextItem[]) =>
  ordered(items)
    .map((i) => i.str)
    .join(' ')
    .trim();

// Only rectangular, unmerged tables are authorized. Unsupported tagged tables
// remain candidates so that their text cannot accidentally enter prose inference.
export function taggedTables(root: StructTreeNode | null, items: PdfTextItem[]): TableCandidate[] {
  const out: TableCandidate[] = [];
  const ids = (node: StructTreeNode): string[] =>
    node.children.flatMap((child) =>
      'role' in child ? ids(child) : child.type === 'content' ? [child.id] : [],
    );
  const members = (node: StructTreeNode) => {
    const selected = new Set(ids(node));
    return items.filter((i) => i.markedId && selected.has(i.markedId) && visible(i));
  };
  const walk = (node: StructTreeNode) => {
    if (node.role !== 'Table') {
      for (const child of node.children) if ('role' in child) walk(child);
      return;
    }
    const all = members(node);
    if (!all.length) return;
    const rowNodes: StructTreeNode[] = [];
    let safe = ids(node).every((id) => items.some((i) => i.markedId === id));
    const rows = (n: StructTreeNode) => {
      for (const child of n.children) {
        if (!('role' in child)) {
          safe = false;
          continue;
        }
        if (child.role === 'TR') rowNodes.push(child);
        else if (['THead', 'TBody', 'TFoot'].includes(child.role)) rows(child);
        else safe = false;
      }
    };
    rows(node);
    const grid = rowNodes.map((row) =>
      row.children.flatMap((cell) => {
        if (!('role' in cell) || !['TH', 'TD'].includes(cell.role)) {
          safe = false;
          return [];
        }
        if ((cell.rowSpan ?? 1) !== 1 || (cell.colSpan ?? 1) !== 1) safe = false;
        return [{ header: cell.role === 'TH', items: members(cell) }];
      }),
    );
    const flat = grid.flatMap((r) => r.flatMap((c) => c.items));
    if (
      grid.length < 2 ||
      grid.length > 40 ||
      !grid[0]?.length ||
      grid[0].length > 12 ||
      grid.some((r) => r.length !== grid[0].length) ||
      flat.length !== all.length ||
      new Set(flat).size !== all.length ||
      all.some((i) => i.rotated)
    )
      safe = false;
    out.push({ items: all, ...(safe ? { rows: grid } : {}) });
  };
  if (root) walk(root);
  return out;
}

type Line = { x1: number; y1: number; x2: number; y2: number };
type Matrix = number[];
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
// PDF.js 6.5's constructPath contains packed DrawOPS, not public OPS codes.
// Decode straight strokes only; curves and fill-only artwork cannot define cells.
export function tableLines(
  list: { fnArray: number[]; argsArray: any[][] },
  ops: Record<string, number>,
): Line[] {
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [],
    lines: Line[] = [];
  const point = (x: number, y: number) => [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ];
  for (let n = 0; n < list.fnArray.length; n++) {
    const op = list.fnArray[n],
      args = list.argsArray[n];
    if (op === ops.save || op === ops.paintFormXObjectBegin) {
      stack.push([...matrix]);
      if (op === ops.paintFormXObjectBegin && args[0]) matrix = multiply(matrix, args[0]);
    } else if (op === ops.restore || op === ops.paintFormXObjectEnd)
      matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (op === ops.transform) matrix = multiply(matrix, args);
    else if (op === ops.constructPath && [ops.stroke, ops.closeStroke].includes(args[0])) {
      const data: ArrayLike<number> | undefined = args[1]?.[0];
      if (!data || data.length > 20000) continue;
      let last: number[] | undefined, first: number[] | undefined;
      const local: Line[] = [];
      const line = (next: number[]) => {
        if (last && next.every(Number.isFinite) && last.every(Number.isFinite)) {
          const [x1, y1] = last,
            [x2, y2] = next;
          if (
            (Math.abs(x1 - x2) < 0.1 && Math.abs(y1 - y2) > 5) ||
            (Math.abs(y1 - y2) < 0.1 && Math.abs(x1 - x2) > 5)
          )
            local.push({ x1, y1, x2, y2 });
        }
        last = next;
      };
      let safe = true;
      for (let k = 0; k < data.length;) {
        const code = data[k++];
        if (code === 0) first = last = point(data[k++], data[k++]);
        else if (code === 1) line(point(data[k++], data[k++]));
        else if (code === 4 && first) line(first);
        else {
          safe = false;
          break;
        }
      }
      if (safe) {
        if (args[0] === ops.closeStroke && first) line(first);
        lines.push(...local);
      }
      if (lines.length > 2000) return [];
    }
  }
  return lines;
}
const near = (a: number, b: number) => Math.abs(a - b) <= 0.6;
const unique = (ns: number[]) =>
  ns.sort((a, b) => a - b).filter((v, i, a) => !i || !near(v, a[i - 1]));
export function ruledTables(lines: Line[], items: PdfTextItem[]): TableCandidate[] {
  const remaining = new Set(lines),
    out: TableCandidate[] = [];
  const touches = (a: Line, b: Line) =>
    Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2)) <=
      Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2)) + 0.6 &&
    Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2)) <=
      Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2)) + 0.6;
  while (remaining.size) {
    const group = [remaining.values().next().value!];
    remaining.delete(group[0]);
    for (let n = 0; n < group.length; n++)
      for (const line of remaining)
        if (touches(group[n], line)) {
          group.push(line);
          remaining.delete(line);
        }
    const hs = group.filter((l) => near(l.y1, l.y2)),
      vs = group.filter((l) => near(l.x1, l.x2));
    const xs = unique(vs.map((l) => l.x1)),
      ys = unique(hs.map((l) => l.y1)).reverse();
    if (xs.length < 3 || ys.length < 3) continue;
    const left = xs[0],
      right = xs.at(-1)!,
      top = ys[0],
      bottom = ys.at(-1)!;
    const all = items.filter(
      (i) =>
        visible(i) && i.x < right && i.x + i.width > left && i.y < top && i.y + i.size > bottom,
    );
    if (!all.length) continue;
    const covers = (segments: [number, number][], min: number, max: number) => {
      let end = min;
      for (const [a, b] of segments.sort((a, b) => a[0] - b[0])) {
        if (a > end + 0.6) return false;
        end = Math.max(end, b);
      }
      return end >= max - 0.6;
    };
    if (xs.length > 13 || ys.length > 41) {
      out.push({ items: all });
      continue;
    }
    let safe =
      xs.every((x) =>
        covers(
          vs.filter((l) => near(l.x1, x)).map((l) => [Math.min(l.y1, l.y2), Math.max(l.y1, l.y2)]),
          bottom,
          top,
        ),
      ) &&
      ys.every((y) =>
        covers(
          hs.filter((l) => near(l.y1, y)).map((l) => [Math.min(l.x1, l.x2), Math.max(l.x1, l.x2)]),
          left,
          right,
        ),
      );
    const rows = ys
      .slice(1)
      .map(() => xs.slice(1).map(() => ({ header: false, items: [] as PdfTextItem[] })));
    for (const item of all) {
      const c = xs.findIndex(
        (x, k) => k < xs.length - 1 && item.x >= x + 0.5 && item.x + item.width <= xs[k + 1] - 0.5,
      );
      const r = ys.findIndex(
        (y, k) =>
          k < ys.length - 1 &&
          item.y + item.size * (item.ascent ?? 0.9) <= y - 0.5 &&
          item.y + item.size * (item.descent ?? -0.2) >= ys[k + 1] + 0.5,
      );
      if (c < 0 || r < 0 || item.rotated) safe = false;
      else rows[r][c].items.push(item);
    }
    out.push({ items: all, ...(safe ? { rows } : {}) });
  }
  return out;
}

function mapped(text: string) {
  let value = '';
  const offsets: number[] = [];
  for (let n = 0; n < text.length;) {
    const cp = String.fromCodePoint(text.codePointAt(n)!);
    const part = cp.normalize('NFKC').replace(/\s/gu, '');
    value += part;
    for (let k = 0; k < part.length; k++) offsets.push(n);
    n += cp.length;
  }
  offsets.push(text.length);
  return { value, offsets };
}
export function alignTables(
  pages: TablePage[],
  source: string,
): { start: number; end: number; table: PdfTable }[] | undefined {
  const selected = mapped(source);
  const matches: { start: number; end: number; table: PdfTable }[] = [];
  if (!selected.value) return [];
  for (const page of pages)
    for (const candidate of page.tables) {
      const content =
        candidate.rows?.flatMap((r) => r.flatMap((c) => ordered(c.items))) ?? candidate.items;
      const value = mapped(content.map((i) => i.str).join('')).value;
      if (!value) continue;
      const start = selected.value.indexOf(value);
      if (start >= 0) {
        if (!candidate.rows || selected.value.indexOf(value, start + 1) >= 0) return;
        let occurrences = 0;
        for (const p of pages) {
          const stream = mapped(p.items.map((i) => i.str).join('')).value;
          for (let at = stream.indexOf(value); at >= 0; at = stream.indexOf(value, at + 1))
            occurrences++;
        }
        if (occurrences > 1) return;
        const a = selected.offsets[start];
        const last = selected.offsets[start + value.length - 1];
        const b = last + String.fromCodePoint(source.codePointAt(last)!).length;
        matches.push({
          start: a,
          end: b,
          table: {
            kind: 'table',
            source: source.slice(a, b),
            columns: candidate.rows[0].length,
            rows: candidate.rows.map((row) =>
              row.map((cell) => ({
                header: cell.header,
                source: cellText(cell.items),
                text: cellText(cell.items),
              })),
            ),
          },
        });
        continue;
      }
      // Detect partial selections and alternate extraction order in the page stream.
      // No substring matching of isolated common cells: the whole selection must align.
      const pageText = mapped(page.items.map((i) => i.str).join('')).value;
      let offset = 0;
      const spans = new Map<PdfTextItem, [number, number]>();
      for (const item of page.items) {
        const end = offset + mapped(item.str).value.length;
        spans.set(item, [offset, end]);
        offset = end;
      }
      const min = Math.min(...candidate.items.map((i) => spans.get(i)![0]));
      const max = Math.max(...candidate.items.map((i) => spans.get(i)![1]));
      for (
        let at = pageText.indexOf(selected.value);
        at >= 0;
        at = pageText.indexOf(selected.value, at + 1)
      )
        if (at < max && at + selected.value.length > min) return;
      // A selection spanning pages cannot match a single page stream. Its edge
      // anchors can still prove that an incomplete table was selected.
      if (selected.value.length >= 24) {
        const first = pageText.indexOf(selected.value.slice(0, 24));
        const last = pageText.indexOf(selected.value.slice(-24));
        if (
          (first >= 0 && first < max && first + selected.value.length > min) ||
          (last >= 0 && last + 24 > min && last + 24 - selected.value.length < max)
        )
          return;
      }
      if (value.includes(selected.value)) return;
    }
  matches.sort((a, b) => a.start - b.start);
  if (
    matches.reduce((sum, m) => sum + m.table.rows.length * m.table.columns, 0) > 256 ||
    matches.length > 16 ||
    matches.some((m, i) => i > 0 && m.start < matches[i - 1].end)
  )
    return;
  return matches;
}
