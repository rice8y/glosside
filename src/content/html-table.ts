import type { HtmlBlock } from './html-structure';

export interface HtmlCell {
  element?: HTMLTableCellElement;
  header: boolean;
  scope?: string;
  column: number;
  colSpan: number;
  rowSpan: number;
  blocks: HtmlBlock[];
}
export interface HtmlTable {
  kind: 'table';
  element: HTMLTableElement;
  caption: HtmlBlock[];
  rows: { group: Element; cells: HtmlCell[] }[];
  columns: number;
}

// Copy geometry, not page markup or unselected text. Blank cells keep a partial
// selection in its original columns, including spans starting above it.
export function tableStructure(table: HTMLTableElement, selected: Set<Element>): HtmlTable {
  const rows = [...table.rows].filter((row) => getComputedStyle(row).display !== 'none');
  const grid: (HtmlCell | undefined)[][] = rows.map(() => []);
  const starts: { row: number; cell: HtmlCell }[] = [];
  const groupEnds = new Map<Element, number>();
  rows.forEach((row, index) => groupEnds.set(row.parentElement!, index + 1));
  let columns = 0;
  rows.forEach((row, index) => {
    let column = 0;
    for (const element of row.cells) {
      if (getComputedStyle(element).display === 'none') continue;
      while (grid[index][column]) column++;
      const groupEnd = groupEnds.get(row.parentElement!)!;
      const rowSpan = Math.min(element.rowSpan || groupEnd - index, groupEnd - index);
      const scope = element.getAttribute('scope') ?? '';
      const cell: HtmlCell = {
        element,
        header: element.localName === 'th',
        scope: /^(row|col|rowgroup|colgroup)$/.test(scope) ? scope : undefined,
        column,
        colSpan: element.colSpan,
        rowSpan,
        blocks: [],
      };
      starts.push({ row: index, cell });
      for (let r = index; r < index + rowSpan; r++)
        for (let c = column; c < column + cell.colSpan; c++) grid[r][c] = cell;
      column += cell.colSpan;
      columns = Math.max(columns, column);
    }
  });
  const chosen = starts.filter(({ cell }) => selected.has(cell.element!)).map(({ row }) => row);
  rows.forEach((row, index) => {
    if (selected.has(row)) chosen.push(index);
  });
  const first = chosen.length ? Math.min(...chosen) : 0;
  const last = chosen.length ? Math.max(...chosen) : -1;
  const output: HtmlTable = { kind: 'table', element: table, caption: [], columns, rows: [] };
  for (let r = first; r <= last; r++) {
    const cells: HtmlCell[] = [];
    for (let c = 0; c < columns;) {
      const cell = grid[r][c];
      if (!cell) {
        cells.push({ header: false, column: c, colSpan: 1, rowSpan: 1, blocks: [] });
        c++;
        continue;
      }
      if (r === first || grid[r - 1][c] !== cell) {
        let end = r + 1;
        while (end <= last && grid[end][c] === cell) end++;
        cells.push({ ...cell, rowSpan: end - r, blocks: [] });
      }
      c += cell.colSpan;
    }
    output.rows.push({ group: rows[r].parentElement!, cells });
  }
  return output;
}

export function tableText(table: HtmlTable, text: (blocks: HtmlBlock[]) => string): string {
  const rows = table.rows.map((row) => {
    const values = Array<string>(table.columns).fill('');
    for (const cell of row.cells)
      values[cell.column] = text(cell.blocks)
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\t/g, ' ');
    return values.join('\t');
  });
  return [text(table.caption), rows.join('\n')].filter(Boolean).join('\n');
}
