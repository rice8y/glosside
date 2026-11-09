import { selectionAccess, matchesNativeSelection } from './selection-content';
import { htmlStructure, structureText, structureRuns, type HtmlBlock } from './html-structure';
import { EXCLUDED } from './blocks';
import { mathRoot, mathSource, blockMath } from './math-elements';
import { mathView } from './math-view';
import { literalRoot, literalText } from './literal-text';
import { flowBlock, flowText } from './html-layout';
import { protectedTokens, protectedPositions } from '../shared/protected-tokens';
import { makeRequest } from '../shared/protocol';
import type { Client } from '../shared/client';
import type { Request, TranslationEvent } from '../shared/types';
import { explain, errorCode } from '../shared/errors';

export type HtmlRun =
  | {
      kind: 'text';
      text: string;
      node?: Text;
      element?: Element;
      boundary?: boolean;
      lineBreak?: boolean;
      preserveWhitespace?: boolean;
    }
  | { kind: 'literal'; source: string; element: Element; block: boolean }
  | { kind: 'math'; source: string; element: Element; block: boolean; view?: HTMLElement };
export interface HtmlPlan {
  runs: HtmlRun[];
  source: string;
  blocks?: HtmlBlock[];
  flow?: boolean;
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
  nativeSelection?: string,
): HtmlPlan | undefined {
  if (range.collapsed || !range.commonAncestorContainer.isConnected) return;
  const runs: HtmlRun[] = [];
  const access = snapshot ? selectionAccess() : undefined;
  let count = 0;
  const append = (text: string, node: Text) => {
    if (!text) return;
    if (!snapshot) {
      runs.push({ kind: 'text', text, node });
      return;
    }
    const normalized = flowText(node, text);
    for (const part of normalized.lines ? normalized.text.split(/(\n)/) : [normalized.text])
      if (part)
        runs.push({
          kind: 'text',
          text: part,
          node,
          ...(part === '\n' ? { lineBreak: true } : {}),
          ...(normalized.preserve ? { preserveWhitespace: true } : {}),
        });
  };
  const boundary = () => {
    const last = runs.at(-1);
    if (last && !(last.kind === 'text' && last.boundary))
      runs.push({ kind: 'text', text: '\n', boundary: true });
  };
  const visit = (node: Node) => {
    if (!range.intersectsNode(node)) return;
    const literal = literalRoot(node);
    if (literal) {
      const bounds = document.createRange();
      bounds.selectNode(literal);
      if (
        range.compareBoundaryPoints(Range.END_TO_START, bounds) >= 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, bounds) <= 0
      )
        return;
      const source = literalText(literal, range, read, access?.text);
      if (source) {
        count++;
        runs.push({
          kind: 'literal',
          source,
          element: literal,
          block: literal.localName === 'pre' || flowBlock(literal),
        });
      }
      return;
    }
    const math = mathRoot(node);
    if (math) {
      if (math.parentElement?.closest(EXCLUDED) || (access && !access.visible(math))) return;
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
      if (node.parentElement?.closest(EXCLUDED) || (access && !access.text(node))) return;
      const value = read(node);
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : value.length;
      append(value.slice(start, end), node);
      return;
    }
    if (node instanceof Element) {
      if (node.closest(EXCLUDED) || (access && !access.visible(node))) return;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      if (node.matches('td,th,tr,caption')) {
        const bounds = document.createRange();
        bounds.selectNode(node);
        if (
          range.compareBoundaryPoints(Range.END_TO_START, bounds) >= 0 ||
          range.compareBoundaryPoints(Range.START_TO_END, bounds) <= 0
        )
          return;
        // Empty selected cells still occupy a position in the table.
        runs.push({ kind: 'text', text: '', element: node });
      }
      if (node.localName === 'br') {
        runs.push({ kind: 'text', text: '\n', element: node, lineBreak: true });
        return;
      }
      const block = flowBlock(node);
      if (block) boundary();
      for (const child of node.childNodes) visit(child);
      if (block) boundary();
    }
  };
  visit(mathRoot(range.commonAncestorContainer) ?? range.commonAncestorContainer);
  while (runs[0]?.kind === 'text' && !runs[0].node && !runs[0].element && !runs[0].text.trim())
    runs.shift();
  while (runs.at(-1)?.kind === 'text') {
    const last = runs.at(-1) as Extract<HtmlRun, { kind: 'text' }>;
    if (last.node || last.element || last.text.trim()) break;
    runs.pop();
  }
  if (snapshot && nativeSelection !== undefined && !matchesNativeSelection(runs, nativeSelection)) {
    if (!nativeSelection.trim()) return;
    // CSS can hide/select text in ways a DOM walk cannot reproduce. The native
    // string is the authority; do not send extra page text to the model.
    return {
      source: nativeSelection,
      runs: nativeSelection
        .split(/(\r?\n)/)
        .filter(Boolean)
        .map((text) => ({
          kind: 'text',
          text,
          ...(/^\r?\n$/.test(text) ? { lineBreak: true } : {}),
        })),
      flow: true,
    };
  }
  const blocks = snapshot ? htmlStructure(runs) : undefined;
  if (!count && !blocks) return;
  return {
    runs,
    source: blocks ? structureText(blocks) : htmlPlainText(runs),
    ...(blocks ? { blocks } : {}),
    ...(snapshot ? { flow: true } : {}),
  };
}

// Source edits can retain protected formulas when their original spelling is
// still unambiguous. Modified formulas are treated as edited plain text.
export function editHtmlPlan(plan: HtmlPlan, source: string): HtmlPlan | undefined {
  if (source === plan.source) return plan;
  const protectedRuns = plan.runs.filter((r) => r.kind !== 'text');
  const positions = protectedRuns.map((math) => ({ math, start: source.indexOf(math.source) }));
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
): Promise<{ event: TranslationEvent; runs: HtmlRun[]; blocks?: HtmlBlock[] }> {
  signal.throwIfAborted();
  const protectedRuns = plan.runs.filter((r) => r.kind !== 'text');
  const hasLiterals = protectedRuns.some((r) => r.kind === 'literal');
  if (protectedRuns.length > 96)
    return {
      event: {
        type: 'incomplete',
        requestId: 'html-math',
        sequence: 1,
        text: plan.source,
        warnings: [
          hasLiterals
            ? '数式やコードが多いため、原文を表示しています。翻訳する範囲を小さくしてください。'
            : '数式が多いため、原文を表示しています。翻訳する範囲を小さくしてください。',
        ],
      },
      runs: plan.runs,
      blocks: plan.blocks,
    };
  if (plan.blocks && init.mode !== 'page') {
    const warnings = new Set<string>();
    let complete = true;
    let requestId = 'html-structure';
    const translateBlocks = async (blocks: HtmlBlock[]): Promise<HtmlBlock[]> => {
      const output: HtmlBlock[] = [];
      for (const [index, block] of blocks.entries()) {
        signal.throwIfAborted();
        if (block.kind === 'table') {
          const caption = await translateBlocks(block.caption);
          const rows = [];
          for (const row of block.rows) {
            const cells = [];
            for (const cell of row.cells)
              cells.push({ ...cell, blocks: await translateBlocks(cell.blocks) });
            rows.push({ ...row, cells });
          }
          output.push({ ...block, caption, rows });
        } else if (block.kind === 'list') {
          const items = [];
          for (const item of block.items)
            items.push({ ...item, blocks: await translateBlocks(item.blocks) });
          output.push({ ...block, items });
        } else {
          // A sentence can lead into an equation in the next block. Supply
          // neighbouring selected paragraphs as context, never as output slots.
          const neighbours = [blocks[index - 1], block, blocks[index + 1]].filter(
            (part) => part?.kind === 'paragraph',
          );
          const context = neighbours.length > 1 ? structureText(neighbours) : undefined;
          const result = await translateHtmlPlan(
            { runs: block.runs, source: htmlPlainText(block.runs), flow: true },
            client,
            context && context.length <= 4000 && !context.includes('<|plamo:')
              ? { ...init, context }
              : init,
            signal,
            started,
          );
          requestId = result.event.requestId;
          complete &&= result.event.type === 'complete';
          for (const warning of result.event.warnings ?? []) warnings.add(warning);
          output.push({ ...block, runs: result.runs });
        }
      }
      return output;
    };
    const blocks = await translateBlocks(plan.blocks);
    return {
      event: {
        type: complete ? 'complete' : 'incomplete',
        requestId,
        sequence: 1,
        text: structureText(blocks),
        warnings: [...warnings],
      },
      runs: structureRuns(blocks),
      blocks,
    };
  }
  if (init.mode !== 'page' && plan.runs.some((run) => run.kind === 'text' && run.lineBreak)) {
    const runs: HtmlRun[] = [];
    let line: HtmlRun[] = [];
    let complete = true;
    let requestId = 'html-lines';
    const warnings = new Set<string>();
    const flush = async () => {
      if (!line.length) return;
      const result = await translateHtmlPlan(
        { runs: line, source: htmlPlainText(line), flow: plan.flow },
        client,
        init,
        signal,
        started,
      );
      runs.push(...result.runs);
      complete &&= result.event.type === 'complete';
      requestId = result.event.requestId;
      for (const warning of result.event.warnings ?? []) warnings.add(warning);
      line = [];
    };
    for (const run of plan.runs) {
      signal.throwIfAborted();
      if (run.kind === 'text' && run.lineBreak) {
        await flush();
        runs.push(run);
      } else line.push(run);
    }
    await flush();
    return {
      event: {
        type: complete ? 'complete' : 'incomplete',
        requestId,
        sequence: 1,
        text: htmlPlainText(runs),
        warnings: [...warnings],
      },
      runs,
    };
  }
  const { prefix, tokens } = protectedTokens(plan.source, protectedRuns.length);
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
    // A model may add line breaks even to one source paragraph. Only DOM-authored
    // boundaries control layout; explicit breaks are restored outside inference.
    const text = plan.flow ? result.text?.replace(/[\t ]*[\r\n]+[\t ]*/g, ' ').trim() : result.text;
    const positions = text && protectedPositions(text, prefix, tokens);
    if (result.type !== 'complete' || !text?.trim() || text.includes('<|plamo:') || !positions)
      return {
        event: {
          ...result,
          type: 'incomplete',
          text: plan.source,
          warnings: [
            hasLiterals
              ? 'コードを安全に保持できなかったため、この範囲は原文を表示しています。'
              : '数式を安全に保持できなかったため、この範囲は原文を表示しています。',
          ],
        },
        runs: plan.runs,
      };
    const runs: HtmlRun[] = [];
    let cursor = 0;
    for (const position of positions) {
      runs.push(
        { kind: 'text', text: text.slice(cursor, position.start) },
        protectedRuns[position.index],
      );
      cursor = position.start + position.token.length;
    }
    runs.push({ kind: 'text', text: text.slice(cursor) });
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

export function renderHtmlMath(runs: HtmlRun[], blocks?: HtmlBlock[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (blocks) {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        const paragraph = document.createElement('div');
        paragraph.className = 'html-paragraph';
        if (block.runs.some((run) => run.kind === 'math')) {
          paragraph.classList.add('html-math-paragraph');
          paragraph.tabIndex = 0;
        }
        paragraph.append(renderHtmlMath(block.runs));
        fragment.append(paragraph);
      } else if (block.kind === 'table') {
        const scroll = document.createElement('div');
        scroll.className = 'html-table-scroll';
        scroll.tabIndex = 0;
        const table = document.createElement('table');
        table.className = 'html-table';
        if (block.caption.length) {
          const caption = document.createElement('caption');
          caption.append(renderHtmlMath([], block.caption));
          table.append(caption);
        }
        let previous: Element | undefined;
        let group: HTMLTableSectionElement | undefined;
        for (const row of block.rows) {
          if (row.group !== previous) {
            group = document.createElement(
              row.group.localName === 'thead'
                ? 'thead'
                : row.group.localName === 'tfoot'
                  ? 'tfoot'
                  : 'tbody',
            );
            table.append(group);
            previous = row.group;
          }
          const tr = document.createElement('tr');
          for (const cell of row.cells) {
            const td = document.createElement(cell.header ? 'th' : 'td');
            td.colSpan = cell.colSpan;
            td.rowSpan = cell.rowSpan;
            if (cell.scope) td.scope = cell.scope;
            td.append(renderHtmlMath([], cell.blocks));
            tr.append(td);
          }
          group!.append(tr);
        }
        scroll.append(table);
        fragment.append(scroll);
      } else {
        const list = document.createElement(block.ordered ? 'ol' : 'ul');
        list.className = 'html-list';
        if (list instanceof HTMLOListElement) {
          list.start = block.start;
          list.reversed = block.reversed;
          if (block.type) list.type = block.type;
        }
        for (const item of block.items) {
          const li = document.createElement('li');
          if (block.ordered) li.value = item.value;
          li.append(renderHtmlMath([], item.blocks));
          list.append(li);
        }
        fragment.append(list);
      }
    }
    return fragment;
  }
  for (const run of runs) {
    if (run.kind === 'text') {
      fragment.append(document.createTextNode(run.text));
      continue;
    }
    if (run.kind === 'literal') {
      const code = document.createElement('code');
      code.className = 'html-literal';
      code.textContent = run.source;
      if (run.block) {
        const pre = document.createElement('pre');
        pre.className = 'html-literal-block';
        pre.tabIndex = 0;
        pre.append(code);
        fragment.append(pre);
      } else fragment.append(code);
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
