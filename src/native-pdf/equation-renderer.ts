import { horizontalTables } from './horizontal-tables';
import { renderTableRegion } from './table-renderer';
import {
  alignTables,
  taggedTables,
  ruledTables,
  tableLines,
  PDF_TABLE_WARNING,
  type TablePage,
} from './table-alignment';
import { equationColors } from './image-colors';
import { sameGlyphLayout, sameRaster } from './image-comparison';
import { getDocument, PDFWorker, OPS, type PDFDocumentProxy } from 'pdfjs-dist';
import { readGlyphCodes, glyphRight } from './glyph-mapping';
import { alignSelection, type MathRange, type ProseRange } from './range-alignment';
import { analyzeInline } from './inline-alignment';
import { align, normalize, type PdfTextPage, type PdfTextItem } from './equation-alignment';
import {
  mayContainMath,
  originalPdf,
  PDF_ORIGINAL_WARNING,
  validPdfPlan,
  type PdfPlan,
  type PdfImage,
} from '../shared/pdf-equations';
import { preparePdfText } from './reflow';

const assets = chrome.runtime.getURL('vendor/pdfjs/');
const MAX_BYTES = 24 * 1024 * 1024;

async function pdfBytes(url: string, signal: AbortSignal) {
  // Only the current document URL, checked by the background, reaches this code.
  // No cookies or redirects: authenticated/redirected documents keep their source.
  const response = await fetch(url, {
    credentials: 'omit',
    redirect: 'error',
    signal,
    referrerPolicy: 'no-referrer',
  });
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get('content-type')?.includes('application/pdf') ||
    Number(response.headers.get('content-length')) > MAX_BYTES
  )
    throw Error('Unavailable PDF');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw Error('PDF size limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-'))
    throw Error('Not a PDF');
  return bytes;
}

async function crop(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  box: number[],
  fontSize: number,
  signal: AbortSignal,
  baseline?: number,
  glyphItems?: PdfTextItem[],
): Promise<PdfImage> {
  const page = await pdf.getPage(pageNumber);
  // Display equations use 16px text in the popup. Four source pixels per PDF
  // point avoid upscaling their fine strokes on a 2x-density display.
  const scale = baseline === undefined ? 4 : 3,
    viewport = page.getViewport({ scale });
  const a = viewport.convertToViewportPoint(box[0], box[1]),
    b = viewport.convertToViewportPoint(box[2], box[3]);
  // Keep the glyph origin relative to the crop, independent of its absolute
  // subpixel position on the page. Repeated formulas can then be compared.
  const x = glyphItems ? Math.min(a[0], b[0]) : Math.floor(Math.min(a[0], b[0])),
    y = glyphItems ? Math.min(a[1], b[1]) : Math.floor(Math.min(a[1], b[1]));
  const width = Math.ceil(Math.max(a[0], b[0]) - x),
    height = Math.ceil(Math.max(a[1], b[1]) - y);
  if (width <= 0 || height <= 0 || width > 4096 || height > 2048 || width * height > 2_000_000)
    throw Error('Image limit');
  if (
    baseline !== undefined &&
    !glyphItems &&
    (width / (scale * fontSize) > 16 || height / (scale * fontSize) > 3)
  )
    throw Error('Inline image limit');
  // Render directly into a bounded crop canvas; never allocate a full-page bitmap.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // Offscreen documents do not receive animation frames. The print render path
  // runs without rAF; annotations and scripting are never rendered or executed.
  // Keep PDF.js's text layout and glyph outlines, but suppress neighboring text
  // while painting a selected formula. Skipping text operators themselves would
  // alter the text cursor and displace later glyphs, so only paint calls are gated.
  const seen = new Set<number>();
  let textOperation = false,
    activeFont = '',
    vectorPaint = true;
  const fontStack: string[] = [];
  let operationsFilter:
    ((index: number, list?: { fnArray: number[]; argsArray: any[] }) => boolean) | undefined;
  if (glyphItems) {
    const ops = await page.getOperatorList({ intent: 'print', annotationMode: 0 });
    const textOps = new Set([
      OPS.showText,
      OPS.showSpacedText,
      OPS.nextLineShowText,
      OPS.nextLineSetSpacingShowText,
    ]);
    operationsFilter = (index, list) => {
      // Rendering can optimize its operator list differently from extraction.
      // Read the list executing this index, not a separately requested copy.
      const currentOps = list ?? ops;
      const op = currentOps.fnArray[index];
      textOperation = textOps.has(op);
      vectorPaint = true;
      if (op === OPS.constructPath) {
        const bounds = currentOps.argsArray[index][2] as number[] | undefined;
        if (bounds) {
          const transform = ctx.getTransform();
          const corners = [
            [bounds[0], bounds[1]],
            [bounds[0], bounds[3]],
            [bounds[2], bounds[1]],
            [bounds[2], bounds[3]],
          ].map(([px, py]) => new DOMPoint(px, py).matrixTransform(transform));
          // A fraction bar/brace is contained by the formula. A table or
          // algorithm rule crossing the crop belongs to the surrounding layout.
          vectorPaint = corners.every(
            (p) => p.x >= 1 && p.x <= width - 1 && p.y >= 1 && p.y <= height - 1,
          );
        }
      }
      if (op === OPS.setFont) activeFont = currentOps.argsArray[index][0];
      else if (op === OPS.save) fontStack.push(activeFont);
      else if (op === OPS.restore) activeFont = fontStack.pop() ?? activeFont;
      return true;
    };
    const allowed = () => {
      if (!textOperation) return vectorPaint;
      const t = ctx.getTransform(),
        [px, py] = viewport.convertToPdfPoint(t.e + x, t.f + y);
      const item = glyphItems.find(
        (i) =>
          activeFont === i.fontName &&
          Math.abs(py - i.y) < 0.35 &&
          px >= i.x - 0.15 &&
          (i.width === 0 ? Math.abs(px - i.x) < 0.25 : px < i.x + i.width - 0.05),
      );
      if (item) seen.add(item.index);
      return !!item;
    };
    const fill = ctx.fill.bind(ctx),
      stroke = ctx.stroke.bind(ctx);
    ctx.fill = ((...args: any[]) => {
      if (allowed()) (fill as any)(...args);
    }) as typeof ctx.fill;
    ctx.stroke = ((...args: any[]) => {
      if (allowed()) (stroke as any)(...args);
    }) as typeof ctx.stroke;
    ctx.fillText = () => {
      throw Error('Unresolved glyph outline');
    };
    ctx.strokeText = () => {
      throw Error('Unresolved glyph outline');
    };
  }
  const task = page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    intent: 'print',
    annotationMode: 0,
    operationsFilter,
    transform: [1, 0, 0, 1, -x, -y],
    background: 'rgba(0, 0, 0, 0)',
  });
  const cancel = () => task.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    await task.promise;
    signal.throwIfAborted();
    if (glyphItems?.some((i) => !seen.has(i.index))) throw Error('Missing formula glyphs');
    const pixels = ctx.getImageData(0, 0, width, height);
    const light = equationColors(pixels.data);
    let minX = width,
      maxX = -1,
      minY = height,
      maxY = -1;
    for (let row = 0; row < height; row++)
      for (let col = 0; col < width; col++) {
        const i = (row * width + col) * 4;
        const alpha = pixels.data[i + 3];
        if (alpha > 55) {
          minX = Math.min(minX, col);
          maxX = Math.max(maxX, col);
          minY = Math.min(minY, row);
          maxY = Math.max(maxY, row);
        }
      }
    if (
      maxX < 0 ||
      Math.min(minX, minY, width - 1 - maxX, height - 1 - maxY) < (baseline === undefined ? 3 : 1)
    )
      throw Error('Unsafe crop boundary');
    let outputWidth = width,
      outputHeight = height,
      top = 0,
      left = 0;
    if (glyphItems) {
      left = Math.max(0, minX - 2);
      top = Math.max(0, minY - 2);
      outputWidth = Math.min(width, maxX + 3) - left;
      outputHeight = Math.min(height, maxY + 3) - top;
    }
    const output = document.createElement('canvas');
    output.width = outputWidth;
    output.height = outputHeight;
    try {
      output.getContext('2d')!.putImageData(pixels, -left, -top);
      const data = output.toDataURL('image/png');
      let lightData: string | undefined;
      if (light) {
        pixels.data.set(light);
        output.getContext('2d')!.putImageData(pixels, -left, -top);
        lightData = output.toDataURL('image/png');
      }
      return {
        data,
        ...(lightData ? { lightData } : {}),
        width: outputWidth,
        height: outputHeight,
        widthEm: outputWidth / (scale * fontSize),
        ...(baseline === undefined
          ? {}
          : {
              baselineEm:
                (outputHeight - (viewport.convertToViewportPoint(0, baseline)[1] - y - top)) /
                (scale * fontSize),
            }),
      };
    } finally {
      output.width = output.height = 0;
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    canvas.width = canvas.height = 0;
    page.cleanup();
  }
}

async function renderRange(
  pdf: PDFDocumentProxy,
  m: MathRange,
  signal: AbortSignal,
): Promise<PdfImage> {
  if (m.alternatives?.length) {
    const image = await renderRange(pdf, { ...m, alternatives: undefined }, signal);
    for (const candidate of m.alternatives) {
      if (!sameGlyphLayout(m, candidate)) throw Error('Ambiguous formula layout');
      const other = await renderRange(pdf, candidate, signal);
      if (
        !(await equivalentImages(image, other)) ||
        Math.abs(image.widthEm - other.widthEm) > 0.0001 ||
        Math.abs((image.baselineEm ?? 0) - (other.baselineEm ?? 0)) > 0.0001
      )
        throw Error('Ambiguous formula appearance');
    }
    return image;
  }
  if (m.legacyBox) return crop(pdf, m.page, m.legacyBox, m.fontSize, signal);
  const images: PdfImage[] = [];
  for (const f of m.fragments) {
    const render = (padding: number) =>
      crop(
        pdf,
        m.page,
        [
          Math.min(...f.items.map((i) => i.x)) - padding,
          Math.min(...f.items.map((i) => i.y + i.size * (i.descent ?? -0.3))) - padding,
          Math.max(...f.items.map(glyphRight)) + padding,
          Math.max(...f.items.map((i) => i.y + i.size * (i.ascent ?? 1))) + padding,
        ],
        m.fontSize,
        signal,
        m.display ? undefined : f.baseline,
        f.items,
      );
    try {
      images.push(await render(2));
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof Error) || error.message !== 'Unsafe crop boundary') throw error;
      // Retry overhanging radicals/italics with more room. Keep the tighter crop
      // when possible so nearby algorithm/table rules do not enter the image.
      images.push(await render(Math.max(3, m.fontSize * 0.5)));
    }
  }
  if (images.length === 1) return images[0];
  const scale = 3 * m.fontSize;
  const top = Math.ceil(Math.max(...images.map((i) => i.height - i.baselineEm! * scale)));
  const bottom = Math.ceil(Math.max(...images.map((i) => i.baselineEm! * scale)));
  const canvas = document.createElement('canvas');
  canvas.width = images.reduce((n, i) => n + i.width, 0) + 4 * (images.length - 1);
  canvas.height = top + bottom;
  if (canvas.width > 2048 || canvas.height > 1024) throw Error('Combined formula limit');
  const ctx = canvas.getContext('2d')!;
  const colored = images.some((i) => i.lightData);
  const composite = async (light: boolean) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let x = 0;
    for (const image of images) {
      signal.throwIfAborted();
      const data = light ? (image.lightData ?? image.data) : image.data;
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(atob(data.split(',')[1]), (c) => c.charCodeAt(0))], {
          type: 'image/png',
        }),
      );
      try {
        ctx.filter = colored && !light && !image.lightData ? 'invert(1) brightness(.96)' : 'none';
        ctx.drawImage(bitmap, x, top - (image.height - image.baselineEm! * scale));
      } finally {
        bitmap.close();
      }
      x += image.width + 4;
    }
    return canvas.toDataURL('image/png');
  };
  try {
    const data = await composite(false);
    const lightData = colored ? await composite(true) : undefined;
    return {
      data,
      ...(lightData ? { lightData } : {}),
      width: canvas.width,
      height: canvas.height,
      widthEm: canvas.width / scale,
      baselineEm: bottom / scale,
    };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

async function equivalentImages(a: PdfImage, b: PdfImage) {
  if (a.width !== b.width || a.height !== b.height || !!a.lightData !== !!b.lightData) return false;
  if (a.data === b.data && a.lightData === b.lightData) return true;
  const canvas = document.createElement('canvas');
  canvas.width = a.width;
  canvas.height = a.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const pixels = async (data: string) => {
    const bitmap = await createImageBitmap(
      new Blob([Uint8Array.from(atob(data.split(',')[1]), (c) => c.charCodeAt(0))], {
        type: 'image/png',
      }),
    );
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    } finally {
      bitmap.close();
    }
  };
  try {
    if (!sameRaster(await pixels(a.data), await pixels(b.data))) return false;
    return !a.lightData || sameRaster(await pixels(a.lightData), await pixels(b.lightData!));
  } finally {
    canvas.width = canvas.height = 0;
  }
}

async function rangePlan(
  pdf: PDFDocumentProxy,
  ranges: MathRange[],
  source: string,
  signal: AbortSignal,
  verified: ProseRange[] = [],
): Promise<PdfPlan> {
  const plan: PdfPlan = { parts: [] };
  let cursor = 0,
    imageCount = 0,
    imageBytes = 0;
  let runs: import('../shared/pdf-equations').PdfInlineRun[] = [];
  let paragraphSource = '';
  const flush = () => {
    if (!paragraphSource) return;
    plan.parts.push({ kind: 'paragraph', source: paragraphSource, runs });
    paragraphSource = '';
    runs = [];
  };
  const append = (run: import('../shared/pdf-equations').PdfInlineRun) => {
    const last = runs.at(-1);
    if (run.kind === 'text' && last?.kind === 'text') {
      last.text += run.text;
      paragraphSource += run.text;
      return;
    }
    if (runs.length >= 49) flush();
    runs.push(run);
    paragraphSource += run.kind === 'text' ? run.text : run.source;
  };
  const proseChunk = (text: string, safe: boolean) => {
    for (const chunk of text.split(/(?<=\n)(?=•|\d{1,3}:)/u)) {
      if (/^(?:•|\d{1,3}:)/u.test(chunk)) flush();
      if (!chunk) continue;
      if (safe || !mayContainMath(chunk)) {
        append({ kind: 'text', text: chunk });
        continue;
      }
      const proseContext = ((paragraphSource + chunk).match(/[A-Za-z]{3,}/gu)?.length ?? 0) >= 2;
      for (const token of chunk.split(/(\s+)/u).filter(Boolean)) {
        // Initialisms inside matched prose are punctuation, not separate variables.
        const abbreviation =
          proseContext &&
          /^(?:[A-Za-z]\.){2,}$/u.test(token.replace(/^[^A-Za-z]+|[^A-Za-z.]+$/gu, ''));
        if (!abbreviation && (mayContainMath(token) || /[A-Za-z_]\w*\(/u.test(token))) {
          append({ kind: 'original', source: token });
          plan.warning = PDF_ORIGINAL_WARNING;
        } else append({ kind: 'text', text: token });
      }
    }
  };
  const prose = (text: string, offset: number) => {
    const boundaries = [
      0,
      text.length,
      ...verified.flatMap((r) => [
        Math.max(0, r.start - offset),
        Math.min(text.length, r.end - offset),
      ]),
    ].filter((n) => n >= 0 && n <= text.length);
    const cuts = [...new Set(boundaries)].sort((a, b) => a - b);
    for (let n = 1; n < cuts.length; n++) {
      const a = offset + cuts[n - 1],
        b = offset + cuts[n];
      proseChunk(
        text.slice(cuts[n - 1], cuts[n]),
        verified.some((r) => r.start <= a && r.end >= b),
      );
    }
  };
  for (const m of ranges) {
    const text = source.slice(cursor, m.start),
      raw = source.slice(m.start, m.end);
    prose(text, cursor);
    if (runs.length > 49) flush();
    if (m.display) flush();
    try {
      if (m.unresolved || imageCount >= 96) throw Error('Unresolved formula');
      const image = await renderRange(pdf, m, signal);
      if (imageBytes + image.data.length + (image.lightData?.length ?? 0) > 512 * 1024)
        throw Error('Image budget');
      imageBytes += image.data.length + (image.lightData?.length ?? 0);
      imageCount++;
      if (m.display) plan.parts.push({ kind: 'equation', source: raw, image });
      else {
        runs.push({ kind: 'equation', source: raw, image });
        paragraphSource += raw;
      }
    } catch {
      signal.throwIfAborted();
      plan.warning = PDF_ORIGINAL_WARNING;
      if (m.display) plan.parts.push({ kind: 'original', source: raw });
      else {
        runs.push({ kind: 'original', source: raw });
        paragraphSource += raw;
      }
    }
    cursor = m.end;
  }
  prose(source.slice(cursor), cursor);
  flush();
  return validPdfPlan(plan, source) ? plan : originalPdf(source);
}

export async function prepareEquations(
  url: string,
  source: string,
  signal: AbortSignal,
): Promise<PdfPlan> {
  const data = await pdfBytes(url, signal);
  signal.throwIfAborted();
  // Explicit static worker avoids PDF.js's cross-origin blob wrapper/fake worker.
  const port = new Worker(chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs'), {
    type: 'module',
  });
  const worker = PDFWorker.create({ port });
  const loading = getDocument({
    data,
    worker,
    cMapUrl: assets + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: assets + 'standard_fonts/',
    wasmUrl: assets + 'wasm/',
    fontExtraProperties: true,
    disableFontFace: true,
    useSystemFonts: false,
    disableWorkerRendering: true,
    maxImageSize: 2_000_000,
    canvasMaxAreaInBytes: 8_000_000,
  });
  const cancel = () => void loading.destroy();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const pdf = await loading.promise;
    if (pdf.numPages > 100) return originalPdf(source);
    const selected = normalize(source);
    const textPages = [];
    let count = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(number);
      const text = await page.getTextContent({
        disableNormalization: true,
        includeMarkedContent: true,
      });
      const pageText = normalize(text.items.map((i) => ('str' in i ? i.str : '')).join(''));
      const relevant =
        (selected.length < 24
          ? pageText.includes(selected)
          : pageText.includes(selected.slice(0, 24)) || pageText.includes(selected.slice(-24))) ||
        text.items.some((item) => {
          if (!('str' in item)) return false;
          const value = normalize(item.str);
          for (let n = 0; n + 24 <= value.length; n += 12)
            if (selected.includes(value.slice(n, n + 24))) return true;
          return false;
        });
      // A rotated appendix page must not block a selection on another page.
      // Keep the conservative fallback if the selection could belong to it.
      if (page.rotate !== 0) {
        if (relevant) return originalPdf(source);
        continue;
      }
      count += text.items.filter((item) => 'str' in item).length;
      if (count > 200_000) return originalPdf(source);
      textPages.push({
        number,
        page,
        text,
        relevant,
        full: selected.length >= 24 && pageText.includes(selected),
      });
    }
    // Repeated phrases can make many pages look relevant to a prose selection.
    // Use whole-selection matches to budget operator extraction in that case;
    // alignment still checks the text of every unrotated page.
    const narrow = textPages.filter((entry) => entry.relevant).length > 8;
    if (narrow) {
      const fullMatches = textPages.filter((entry) => entry.full).length;
      if (mayContainMath(source) || fullMatches === 0 || fullMatches > 8)
        return originalPdf(source);
    }
    const pages: TablePage[] = [];
    for (const { number, page, text, relevant: partial, full } of textPages) {
      signal.throwIfAborted();
      const relevant = narrow ? full : partial;
      const operators = relevant ? await page.getOperatorList() : undefined;
      const glyphs = operators
        ? readGlyphCodes(operators, OPS, (name) =>
            page.commonObjs.has(name) ? page.commonObjs.get(name).embeddedGlyphs : undefined,
          )
        : [];
      const marked: (string | undefined)[] = [];
      const items = text.items.flatMap((item, index) => {
        if (!('str' in item)) {
          if (item.type === 'endMarkedContent') marked.pop();
          else marked.push('id' in item ? item.id : marked.at(-1));
          return [];
        }
        const style = text.styles[item.fontName];
        return [
          {
            index,
            markedId: marked.at(-1),
            rotated:
              Math.abs(item.transform[1]) > 0.01 ||
              Math.abs(item.transform[2]) > 0.01 ||
              item.transform[0] <= 0 ||
              item.transform[3] <= 0,
            fontName: item.fontName,
            fontLabel:
              relevant && page.commonObjs.has(item.fontName)
                ? page.commonObjs.get(item.fontName).name
                : undefined,
            str: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width,
            size: Math.hypot(item.transform[2], item.transform[3]),
            ascent: style?.ascent,
            descent: style?.descent,
          },
        ];
      });
      const tagged = relevant ? taggedTables(await page.getStructTree(), items) : [];
      const lines = operators ? tableLines(operators, OPS) : [];
      const ruled = ruledTables(lines, items);
      const horizontal = horizontalTables(lines, items).filter(
        (table) => !ruled.some((t) => t.items.some((i) => table.items.includes(i))),
      );
      // Tagged ownership wins; never reinterpret an unsupported tagged table as a grid.
      const tables = [
        ...tagged,
        ...[...ruled, ...horizontal].filter(
          (table) => !tagged.some((t) => t.items.some((i) => table.items.includes(i))),
        ),
      ];
      pages.push({
        number,
        view: page.view,
        items,
        glyphs,
        tables: tables.map((table) => ({ ...table, rules: lines })),
      });
    }
    const tables = alignTables(pages, source);
    if (!tables) return { parts: [{ kind: 'original', source }], warning: PDF_TABLE_WARNING };
    if (!tables.length) return await textPlan(pdf, pages, source, signal);
    const plan: PdfPlan = { parts: [] };
    let cursor = 0;
    const prose = async (value: string) => {
      if (!value) return;
      const result = await textPlan(pdf, pages, value, signal);
      plan.parts.push(...result.parts);
      if (result.warning) plan.warning = result.warning;
    };
    for (const match of tables) {
      await prose(source.slice(cursor, match.start));
      if (match.table.kind === 'table') plan.parts.push(match.table);
      else {
        try {
          plan.parts.push({
            kind: 'table-image',
            source: match.table.source,
            image: await renderTableRegion(pdf, match.table, signal),
          });
          plan.warning = PDF_TABLE_WARNING;
        } catch {
          signal.throwIfAborted();
          plan.parts.push({ kind: 'original', source: match.table.source });
          plan.warning = PDF_TABLE_WARNING;
        }
      }
      cursor = match.end;
    }
    await prose(source.slice(cursor));
    return validPdfPlan(plan, source)
      ? plan
      : { parts: [{ kind: 'original', source }], warning: PDF_TABLE_WARNING };
  } finally {
    signal.removeEventListener('abort', cancel);
    try {
      await loading.destroy();
    } finally {
      worker.destroy();
      port.terminate();
    }
  }
}

async function textPlan(
  pdf: PDFDocumentProxy,
  pages: PdfTextPage[],
  source: string,
  signal: AbortSignal,
): Promise<PdfPlan> {
  const { matches } = align(pages, source);
  const selection = alignSelection(pages, source);
  if (selection) {
    const ranges = selection.ranges;
    const merged: MathRange[] = ranges.flatMap((range) => {
      const overlaps = matches
        .filter((m) => range.start < m.end && m.start < range.end)
        .sort((a, b) => a.start - b.start);
      if (!overlaps.length) return [range];
      // A legacy display match can cover only part of an unresolved gap.
      // Keep its unmatched remainder protected rather than treating it as prose.
      const remaining: MathRange[] = [];
      let start = range.start;
      for (const match of overlaps) {
        if (start < match.start)
          remaining.push({
            ...range,
            start,
            end: match.start,
            unresolved: true,
            display: false,
            items: [],
            fragments: [],
          });
        start = Math.max(start, match.end);
      }
      if (start < range.end)
        remaining.push({
          ...range,
          start,
          unresolved: true,
          display: false,
          items: [],
          fragments: [],
        });
      return remaining;
    });
    for (const m of matches)
      merged.push({
        start: m.start,
        end: m.end,
        page: m.page,
        items: [],
        display: true,
        fontSize: m.fontSize,
        fragments: [],
        legacyBox: m.box,
      });
    return await rangePlan(
      pdf,
      merged.sort((a, b) => a.start - b.start),
      source,
      signal,
      selection.prose,
    );
  }
  const analyzed = analyzeInline(pages, source);
  const inline = analyzed.matches.filter(
    (i) => !matches.some((m) => i.start < m.end && m.start < i.end),
  );
  if (matches.length > 8 || inline.length > 24) return originalPdf(source);
  const plan: PdfPlan = { parts: [] };
  let cursor = 0;
  const prose = async (text: string, offset: number) => {
    if (!text) return;
    if (analyzed.unresolved.some((m) => m.start < offset + text.length && offset < m.end)) {
      plan.parts.push({ kind: 'original', source: text });
      plan.warning = PDF_ORIGINAL_WARNING;
      return;
    }
    const found = inline.filter((m) => m.start >= offset && m.end <= offset + text.length);
    if (found.length) {
      const runs: import('../shared/pdf-equations').PdfInlineRun[] = [];
      let pos = 0;
      try {
        for (const m of found.sort((a, b) => a.start - b.start)) {
          const chunk = text.slice(pos, m.start - offset);
          if (mayContainMath(chunk)) throw Error('Unresolved inline math');
          runs.push({ kind: 'text', text: chunk });
          runs.push({
            kind: 'equation',
            source: source.slice(m.start, m.end),
            image: await crop(pdf, m.page, m.box, m.fontSize, signal, m.beforeY),
          });
          pos = m.end - offset;
        }
        const tail = text.slice(pos);
        if (mayContainMath(tail)) throw Error('Unresolved inline math');
        runs.push({ kind: 'text', text: tail });
        plan.parts.push({ kind: 'paragraph', source: text, runs });
        return;
      } catch {
        signal.throwIfAborted();
      }
      plan.parts.push({ kind: 'original', source: text });
      plan.warning = PDF_ORIGINAL_WARNING;
    } else if (mayContainMath(text)) {
      plan.parts.push({ kind: 'original', source: text });
      plan.warning = PDF_ORIGINAL_WARNING;
    } else plan.parts.push({ kind: 'text', source: text, text: preparePdfText(text).text });
  };
  for (const m of matches.sort((a, b) => a.start - b.start)) {
    await prose(source.slice(cursor, m.start), cursor);
    try {
      plan.parts.push({
        kind: 'equation',
        source: source.slice(m.start, m.end),
        image: await crop(pdf, m.page, m.box, m.fontSize, signal),
      });
    } catch {
      signal.throwIfAborted();
      plan.parts.push({ kind: 'original', source: source.slice(m.start, m.end) });
      plan.warning = PDF_ORIGINAL_WARNING;
    }
    cursor = m.end;
  }
  await prose(source.slice(cursor), cursor);
  return validPdfPlan(plan, source) ? plan : originalPdf(source);
}

// Separate from inference so a cancelled selection can tear down PDF.js without
// unloading the local language model. At most two bounded parsers may coexist.
export class EquationJobs {
  private jobs = new Map<string, AbortController>();
  private cancelled = new Map<string, number>();
  cancel(owner: string, id?: string) {
    if (id) {
      this.cancelled.set(owner + '|' + id, Date.now() + 30000);
      if (this.cancelled.size > 128) this.cancelled.delete(this.cancelled.keys().next().value!);
    }
    for (const [key, controller] of this.jobs)
      if (key.startsWith(owner + '|') && (!id || key === owner + '|' + id)) controller.abort();
  }
  async prepare(owner: string, id: string, url: string, source: string): Promise<PdfPlan> {
    for (const [key, expires] of this.cancelled)
      if (expires < Date.now()) this.cancelled.delete(key);
    if (this.cancelled.has(owner + '|' + id)) return originalPdf(source);
    this.cancel(owner);
    if (this.jobs.size >= 2) return originalPdf(source);
    const controller = new AbortController(),
      key = owner + '|' + id;
    this.jobs.set(key, controller);
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      return await prepareEquations(url, source, controller.signal);
    } catch {
      return originalPdf(source);
    } finally {
      clearTimeout(timer);
      if (this.jobs.get(key) === controller) this.jobs.delete(key);
    }
  }
}
