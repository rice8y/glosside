import { EXCLUDED } from './blocks';
import { mathRoot, mathSource, blockMath } from './math-elements';
import { mathView } from './math-view';
import { protectedTokens, protectedPositions } from '../shared/protected-tokens';
import { makeRequest } from '../shared/protocol';
import type { Client } from '../shared/client';
import type { Request, TranslationEvent } from '../shared/types';
import { explain, errorCode } from '../shared/errors';

export type HtmlRun =
  | { kind: 'text'; text: string; node?: Text }
  | { kind: 'math'; source: string; element: Element; block: boolean; view?: HTMLElement };
export interface HtmlPlan {
  runs: HtmlRun[];
  source: string;
}
export const htmlPlainText = (runs: HtmlRun[]) =>
  runs.map((r) => (r.kind === 'text' ? r.text : r.source)).join('');

// Read the live range, not Selection.toString(): images may have no selectable
// text, and accessibility MathML may duplicate the visual equation. A selection
// intersecting part of a formula preserves the entire formula atomically.
export function htmlMathPlan(
  range: Range,
  read = (node: Text) => node.data,
  snapshot = true,
): HtmlPlan | undefined {
  if (range.collapsed || !range.commonAncestorContainer.isConnected) return;
  const runs: HtmlRun[] = [];
  let count = 0;
  const append = (text: string, node?: Text) => {
    if (text) runs.push({ kind: 'text', text, node });
  };
  const visit = (node: Node) => {
    if (!range.intersectsNode(node)) return;
    const math = mathRoot(node);
    if (math) {
      if (math.parentElement?.closest(EXCLUDED)) return;
      if (
        math.matches('[hidden],[aria-hidden="true"]') ||
        getComputedStyle(math).display === 'none' ||
        getComputedStyle(math).visibility === 'hidden'
      )
        return;
      // intersectsNode includes a boundary touching an element. Require overlap.
      const bounds = document.createRange();
      bounds.selectNode(math);
      if (
        range.compareBoundaryPoints(Range.END_TO_START, bounds) >= 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, bounds) <= 0
      )
        return;
      count++;
      runs.push({
        kind: 'math',
        element: math,
        source: mathSource(math),
        block: blockMath(math),
        ...(snapshot && count <= 96 ? { view: mathView(math) } : {}),
      });
      return;
    }
    if (node instanceof Text) {
      if (node.parentElement?.closest(EXCLUDED)) return;
      const value = read(node);
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : value.length;
      append(value.slice(start, end), node);
      return;
    }
    if (node instanceof Element) {
      if (node.closest(EXCLUDED)) return;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      if (node.localName === 'br') {
        append('\n');
        return;
      }
      const block = /^(block|list-item|table-row|flex|grid)/.test(style.display);
      if (block && runs.length && !htmlPlainText(runs.slice(-1)).endsWith('\n')) append('\n');
      for (const child of node.childNodes) visit(child);
      if (block && runs.length && !htmlPlainText(runs.slice(-1)).endsWith('\n')) append('\n');
    }
  };
  visit(mathRoot(range.commonAncestorContainer) ?? range.commonAncestorContainer);
  if (!count) return;
  while (runs[0]?.kind === 'text' && !runs[0].node && !runs[0].text.trim()) runs.shift();
  while (runs.at(-1)?.kind === 'text') {
    const last = runs.at(-1) as Extract<HtmlRun, { kind: 'text' }>;
    if (last.node || last.text.trim()) break;
    runs.pop();
  }
  return { runs, source: htmlPlainText(runs) };
}

// Source edits can retain protected formulas when their original spelling is
// still unambiguous. Modified formulas are treated as edited plain text.
export function editHtmlPlan(plan: HtmlPlan, source: string): HtmlPlan | undefined {
  if (source === plan.source) return plan;
  const maths = plan.runs.filter((r): r is Extract<HtmlRun, { kind: 'math' }> => r.kind === 'math');
  const positions = maths.map((math) => ({ math, start: source.indexOf(math.source) }));
  if (
    positions.some(({ math, start }) => start < 0 || source.indexOf(math.source, start + 1) !== -1)
  )
    return;
  positions.sort((a, b) => a.start - b.start);
  const runs: HtmlRun[] = [];
  let cursor = 0;
  for (const { math, start } of positions) {
    if (start < cursor) return;
    runs.push({ kind: 'text', text: source.slice(cursor, start) }, math);
    cursor = start + math.source.length;
  }
  runs.push({ kind: 'text', text: source.slice(cursor) });
  return { runs, source };
}

export async function translateHtmlPlan(
  plan: HtmlPlan,
  client: Client,
  init: Partial<Request>,
  signal: AbortSignal,
  started: (id: string) => void,
): Promise<{ event: TranslationEvent; runs: HtmlRun[] }> {
  signal.throwIfAborted();
  const maths = plan.runs.filter((r): r is Extract<HtmlRun, { kind: 'math' }> => r.kind === 'math');
  if (maths.length > 96)
    return {
      event: {
        type: 'incomplete',
        requestId: 'html-math',
        sequence: 1,
        text: plan.source,
        warnings: ['数式が多いため、原文を表示しています。翻訳する範囲を小さくしてください。'],
      },
      runs: plan.runs,
    };
  const { prefix, tokens } = protectedTokens(plan.source, maths.length);
  let index = 0;
  const input = plan.runs.map((r) => (r.kind === 'text' ? r.text : tokens[index++])).join('');
  if (!plan.runs.some((r) => r.kind === 'text' && r.text.trim()))
    return {
      event: { type: 'complete', requestId: 'html-math', sequence: 1, text: plan.source },
      runs: plan.runs,
    };
  const request = await makeRequest(input, client.settings, {
    ...init,
    surface: 'html',
    translationText: input,
    glossary: [
      ...tokens.map((token) => ({ source: token, target: token })),
      ...client.settings.glossary
        .filter((term) => !term.source.includes(prefix) && !term.target.includes(prefix))
        .slice(0, 100 - tokens.length),
    ],
  });
  signal.throwIfAborted();
  started(request.requestId);
  try {
    const result = await client.result(request, signal);
    signal.throwIfAborted();
    const positions = result.text && protectedPositions(result.text, prefix, tokens);
    if (
      result.type !== 'complete' ||
      !result.text?.trim() ||
      result.text.includes('<|plamo:') ||
      !positions
    )
      return {
        event: {
          ...result,
          type: 'incomplete',
          text: plan.source,
          warnings: ['数式を安全に保持できなかったため、この範囲は原文を表示しています。'],
        },
        runs: plan.runs,
      };
    const runs: HtmlRun[] = [];
    let cursor = 0;
    for (const position of positions) {
      runs.push(
        { kind: 'text', text: result.text.slice(cursor, position.start) },
        maths[position.index],
      );
      cursor = position.start + position.token.length;
    }
    runs.push({ kind: 'text', text: result.text.slice(cursor) });
    return { event: { ...result, text: htmlPlainText(runs) }, runs };
  } catch (error) {
    signal.throwIfAborted();
    return {
      event: {
        type: 'incomplete',
        requestId: request.requestId,
        sequence: 1,
        text: plan.source,
        warnings: [explain(errorCode(error))],
      },
      runs: plan.runs,
    };
  }
}

export function renderHtmlMath(runs: HtmlRun[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const run of runs) {
    if (run.kind === 'text') {
      fragment.append(document.createTextNode(run.text));
      continue;
    }
    const view = run.view ?? document.createElement('span');
    if (!run.view) {
      view.className = 'html-math';
      view.textContent = run.source;
    }
    if (run.block) {
      const block = document.createElement('div');
      block.className = 'html-math-block';
      block.tabIndex = 0;
      block.append(view);
      fragment.append(block);
    } else fragment.append(view);
  }
  return fragment;
}
