export interface PdfImage {
  data: string;
  // Colored glyphs have a dark-popup variant and an original-color variant for
  // the white background used in forced-colors mode. Monochrome images omit it.
  lightData?: string;
  width: number;
  height: number;
  // CSS size at the surrounding text's font size, independent of render resolution.
  widthEm: number;
  baselineEm?: number;
}
export type PdfInlineRun =
  | { kind: 'text'; text: string }
  | { kind: 'equation'; source: string; image: PdfImage }
  | { kind: 'original'; source: string };
export interface PdfTable {
  kind: 'table';
  source: string;
  columns: number;
  rows: {
    header: boolean;
    colSpan?: number;
    bold?: boolean;
    underline?: boolean;
    source: string;
    text: string;
  }[][];
}
export type PdfPart =
  | PdfTable
  | { kind: 'table-image'; source: string; image: PdfImage }
  | { kind: 'paragraph'; source: string; runs: PdfInlineRun[] }
  | { kind: 'text'; source: string; text: string }
  | { kind: 'original'; source: string }
  | { kind: 'equation'; source: string; image: PdfImage };
export interface PdfPlan {
  parts: PdfPart[];
  warning?: string;
}
export const PDF_ORIGINAL_WARNING = '数式を安全に保持できない部分は、原文のまま表示しています。';
export const originalPdf = (source: string): PdfPlan => ({
  parts: [{ kind: 'original', source }],
  warning: PDF_ORIGINAL_WARNING,
});
// This is a conservative routing check, not an equation detector. False positives
// preserve source; only geometric alignment can authorize an image replacement.
export function mayContainMath(source: string): boolean {
  return (
    /(?<![\p{L}\p{N}'’])(?:[B-HJ-Zb-z]|[A-Za-z][0-9]+)(?![\p{L}\p{N}'’])/u.test(source) ||
    /[=+−*/<>∑∏∫√∝≈≠≤≥∞∂∇∈∉⊂⊆±×÷^_{}\p{Script=Greek}]/u.test(source) ||
    source.split(/\r\n|\n|\r/).some((line) => {
      const s = line.trim();
      return /^(?:\([0-9]+[a-z]?\)|[A-Za-z]{1,20}\([^)]*\)|[A-Za-z][A-Za-z0-9]*(?:\([^)]*\))?\s*[+−*/]\s*\S.*)$/u.test(
        s,
      );
    })
  );
}
export function pdfPlainText(parts: PdfPart[]): string {
  return parts
    .map((p) =>
      p.kind === 'table'
        ? '\n' +
          p.rows
            .map((row) =>
              row
                .flatMap((c) => [
                  c.text.replace(/\s+/gu, ' '),
                  ...Array<string>((c.colSpan ?? 1) - 1).fill(''),
                ])
                .join('\t'),
            )
            .join('\n') +
          '\n'
        : p.kind === 'paragraph'
          ? p.runs.map((r) => (r.kind === 'text' ? r.text : r.source)).join('')
          : p.kind === 'text'
            ? p.text
            : p.source,
    )
    .join('');
}
export function validPdfPlan(value: unknown, source: string): value is PdfPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as PdfPlan;
  if (
    plan.warning !== undefined &&
    (typeof plan.warning !== 'string' || plan.warning.length > 1000)
  )
    return false;
  if (!Array.isArray(plan.parts) || !plan.parts.length || plan.parts.length > 129) return false;
  let bytes = 0,
    images = 0,
    cells = 0;
  const validImage = (i: PdfImage) => {
    if (
      !i ||
      typeof i.data !== 'string' ||
      !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(i.data) ||
      (i.lightData !== undefined &&
        (typeof i.lightData !== 'string' ||
          !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(i.lightData))) ||
      ![i.width, i.height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 4096) ||
      !Number.isFinite(i.widthEm) ||
      i.widthEm <= 0 ||
      i.widthEm > 200 ||
      (i.baselineEm !== undefined &&
        (!Number.isFinite(i.baselineEm) || Math.abs(i.baselineEm) > 10))
    )
      return false;
    bytes += i.data.length + (i.lightData?.length ?? 0);
    images++;
    return true;
  };
  for (const p of plan.parts) {
    if (!p || typeof p.source !== 'string') return false;
    if (p.kind === 'table') {
      if (
        !Number.isInteger(p.columns) ||
        p.columns < 1 ||
        p.columns > 12 ||
        !Array.isArray(p.rows) ||
        p.rows.length < 2 ||
        p.rows.length > 40 ||
        p.rows.some(
          (row) =>
            !Array.isArray(row) ||
            row.length > p.columns ||
            row.some(
              (c) =>
                !c ||
                typeof c.header !== 'boolean' ||
                (c.bold !== undefined && typeof c.bold !== 'boolean') ||
                (c.underline !== undefined && typeof c.underline !== 'boolean') ||
                (c.colSpan !== undefined &&
                  (!Number.isInteger(c.colSpan) || c.colSpan < 1 || c.colSpan > p.columns)) ||
                typeof c.source !== 'string' ||
                typeof c.text !== 'string' ||
                c.text !== c.source ||
                c.source.length > 16000,
            ),
        )
      )
        return false;
      if (p.rows.some((row) => row.reduce((n, c) => n + (c.colSpan ?? 1), 0) !== p.columns))
        return false;
      cells += p.rows.length * p.columns;
      if (cells > 256) return false;
      const compact = (text: string) => text.normalize('NFKC').replace(/\s/gu, '');
      if (compact(p.rows.flatMap((row) => row.map((c) => c.source)).join('')) !== compact(p.source))
        return false;
    } else if (p.kind === 'paragraph') {
      if (!Array.isArray(p.runs) || !p.runs.length || p.runs.length > 65) return false;
      for (const r of p.runs) {
        if (r?.kind === 'text') {
          if (typeof r.text !== 'string' || r.text.length > 16000) return false;
        } else if (r?.kind === 'original') {
          if (typeof r.source !== 'string') return false;
        } else if (
          r?.kind !== 'equation' ||
          typeof r.source !== 'string' ||
          !validImage(r.image) ||
          r.image.baselineEm === undefined
        )
          return false;
      }
      if (p.runs.map((r) => (r.kind === 'text' ? r.text : r.source)).join('') !== p.source)
        return false;
    } else if (p.kind === 'text') {
      if (typeof p.text !== 'string' || p.text.length > 16000) return false;
    } else if (p.kind === 'equation' || p.kind === 'table-image') {
      if (!validImage(p.image)) return false;
    } else if (p.kind !== 'original') return false;
  }
  return images <= 96 && bytes <= 512 * 1024 && plan.parts.map((p) => p.source).join('') === source;
}
