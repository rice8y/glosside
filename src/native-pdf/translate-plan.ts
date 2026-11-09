import { protectedTokens, protectedPositions } from '../shared/protected-tokens';
import { makeRequest } from '../shared/protocol';
import { explain, errorCode } from '../shared/errors';
import type { Client } from '../shared/client';
import type { Request, TranslationEvent } from '../shared/types';
import { preparePdfText } from './reflow';
import {
  pdfPlainText,
  mayContainMath,
  type PdfInlineRun,
  type PdfPlan,
  type PdfPart,
} from '../shared/pdf-equations';

// Display equations stay between prose requests. Inline equations use validated
// opaque identifiers so the model can translate the surrounding sentence together.
export async function translatePdfPlan(
  plan: PdfPlan,
  client: Client,
  init: Partial<Request>,
  signal: AbortSignal,
  started: (id: string) => void,
): Promise<TranslationEvent> {
  const parts: PdfPart[] = [],
    warnings = new Set<string>(plan.warning ? [plan.warning] : []);
  const translatedCells = new Map<string, string>();
  let complete = true,
    requestId = 'pdf-result',
    failed = false;
  for (const part of plan.parts) {
    signal.throwIfAborted();
    if (part.kind === 'table') {
      const table = { ...part, rows: part.rows.map((row) => row.map((cell) => ({ ...cell }))) };
      for (const row of table.rows)
        for (const cell of row) {
          signal.throwIfAborted();
          // Numeric values, uppercase identifiers, and formula-like cells stay literal.
          if (
            failed ||
            !/[\p{L}]/u.test(cell.source) ||
            /[\p{N}]/u.test(cell.source) ||
            /^[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*$/u.test(cell.source.trim()) ||
            mayContainMath(cell.source)
          )
            continue;
          const cached = translatedCells.get(cell.source);
          if (cached !== undefined) {
            cell.text = cached;
            continue;
          }
          const result = await translatePdfPlan(
            {
              parts: [
                { kind: 'text', source: cell.source, text: preparePdfText(cell.source).text },
              ],
            },
            client,
            init,
            signal,
            (id) => {
              requestId = id;
              started(id);
            },
          );
          cell.text = result.text ?? cell.source;
          if (result.type === 'complete') translatedCells.set(cell.source, cell.text);
          for (const warning of result.warnings ?? []) warnings.add(warning);
          if (result.type !== 'complete') {
            complete = false;
            failed = true;
          }
        }
      parts.push(table);
      continue;
    }
    if (
      (part.kind !== 'text' && part.kind !== 'paragraph') ||
      (part.kind === 'text' && !part.text.trim())
    ) {
      parts.push(part);
      continue;
    }
    if (failed) {
      parts.push({ kind: 'original', source: part.source });
      continue;
    }
    const equations: Exclude<PdfInlineRun, { kind: 'text' }>[] = [];
    const count = part.kind === 'paragraph' ? part.runs.filter((r) => r.kind !== 'text').length : 0;
    const { prefix, tokens } = protectedTokens(part.source, count);
    let input =
      part.kind === 'paragraph'
        ? preparePdfText(
            part.runs
              .map((r) => {
                if (r.kind === 'text') return r.text;
                const token = tokens[equations.length];
                equations.push(r);
                return token;
              })
              .join(''),
          ).text
        : part.text;
    const linePrefix = input.match(/^\d{1,3}:\s*/u)?.[0] ?? '';
    if (linePrefix) input = input.slice(linePrefix.length);
    if (!input.trim()) {
      parts.push(part);
      continue;
    }
    const request = await makeRequest(input, client.settings, {
      ...init,
      extractedText: input,
      translationText: input,
      ...(tokens.length
        ? {
            glossary: [
              ...tokens.map((t) => ({ source: t, target: t })),
              ...(client.settings.glossary ?? [])
                .filter((t) => !t.source.includes(prefix) && !t.target.includes(prefix))
                .slice(0, 100 - tokens.length),
            ],
          }
        : {}),
      textEdits: undefined,
    });
    signal.throwIfAborted();
    requestId = request.requestId;
    started(requestId);
    try {
      const result = await client.result(request, signal);
      signal.throwIfAborted();
      const restored =
        result.text && part.kind === 'paragraph'
          ? restoreInline(result.text.trim(), prefix, tokens, equations)
          : undefined;
      if (
        result.type !== 'complete' ||
        !result.text?.trim() ||
        (part.kind === 'paragraph' && !restored)
      ) {
        complete = false;
        failed = result.type !== 'complete';
        parts.push({ kind: 'original', source: part.source });
        warnings.add('翻訳が完了しなかった部分は、原文のまま表示しています。');
      } else {
        // Keep separators outside the model's output, as with equation placement.
        const before = part.source.match(/^\s*/u)![0] + linePrefix,
          after = part.source.match(/\s*$/u)![0];
        if (part.kind === 'paragraph' && restored) {
          (restored[0] as Extract<PdfInlineRun, { kind: 'text' }>).text =
            before + (restored[0] as Extract<PdfInlineRun, { kind: 'text' }>).text;
          (restored.at(-1) as Extract<PdfInlineRun, { kind: 'text' }>).text += after;
          parts.push({ ...part, runs: restored });
        } else
          parts.push({
            kind: 'text',
            source: part.source,
            text: before + result.text.trim() + after,
          });
        for (const warning of result.warnings ?? []) warnings.add(warning);
      }
    } catch (error) {
      signal.throwIfAborted();
      complete = false;
      failed = true;
      parts.push({ kind: 'original', source: part.source });
      warnings.add(explain(errorCode(error)));
    }
  }
  return {
    type: complete ? 'complete' : 'incomplete',
    requestId,
    sequence: 1,
    text: pdfPlainText(parts),
    parts,
    warnings: [...warnings],
  };
}

// Every identifier must occur exactly once; reject partial/unknown identifiers too.
// A valid permutation is allowed because the target language may reorder clauses.
export function restoreInline(
  text: string,
  prefix: string,
  tokens: string[],
  equations: Exclude<PdfInlineRun, { kind: 'text' }>[],
): PdfInlineRun[] | undefined {
  const positions = protectedPositions(text, prefix, tokens);
  if (!positions) return;
  const runs: PdfInlineRun[] = [];
  let cursor = 0;
  for (const p of positions) {
    runs.push({ kind: 'text', text: text.slice(cursor, p.start) });
    runs.push(equations[p.index]);
    cursor = p.start + p.token.length;
  }
  runs.push({ kind: 'text', text: text.slice(cursor) });
  return runs;
}
