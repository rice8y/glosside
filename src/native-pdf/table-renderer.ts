import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfImage } from '../shared/pdf-equations';
import type { TableRegion } from './table-alignment';

// Cell ownership is uncertain, but the selected region is exact. Preserve the
// original table as one image, including rules, shading, and all cell positions.
export async function renderTableRegion(
  pdf: PDFDocumentProxy,
  region: TableRegion,
  signal: AbortSignal,
): Promise<PdfImage> {
  signal.throwIfAborted();
  const page = await pdf.getPage(region.page),
    scale = 2;
  const viewport = page.getViewport({ scale });
  const a = viewport.convertToViewportPoint(region.box[0], region.box[1]);
  const b = viewport.convertToViewportPoint(region.box[2], region.box[3]);
  const x = Math.floor(Math.min(a[0], b[0])) - 3,
    y = Math.floor(Math.min(a[1], b[1])) - 3;
  const width = Math.ceil(Math.max(a[0], b[0])) - x + 3;
  const height = Math.ceil(Math.max(a[1], b[1])) - y + 3;
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096 || width * height > 2_000_000)
    throw Error('Table image limit');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const task = page.render({
    canvas,
    viewport,
    intent: 'print',
    annotationMode: 0,
    transform: [1, 0, 0, 1, -x, -y],
    background: '#ffffff',
  });
  const cancel = () => task.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    await task.promise;
    signal.throwIfAborted();
    return {
      data: canvas.toDataURL('image/png'),
      width,
      height,
      widthEm: width / (scale * region.fontSize),
    };
  } finally {
    signal.removeEventListener('abort', cancel);
    canvas.width = canvas.height = 0;
  }
}
