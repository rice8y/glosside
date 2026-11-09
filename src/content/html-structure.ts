import type { HtmlRun } from './math-plan';

export type HtmlBlock =
  | { kind: 'paragraph'; runs: HtmlRun[]; owner?: Element }
  | {
      kind: 'list';
      ordered: boolean;
      reversed: boolean;
      start: number;
      type?: string;
      element: Element;
      items: { element: Element; value: number; blocks: HtmlBlock[] }[];
    };

function ordinal(list: Element, item: Element) {
  const children = [...list.children].filter((child) => child.localName === 'li');
  const reversed = list.hasAttribute('reversed');
  let value = list.hasAttribute('start')
    ? Number(list.getAttribute('start'))
    : reversed
      ? children.length
      : 1;
  if (!Number.isSafeInteger(value)) value = 1;
  for (const child of children) {
    if (child.hasAttribute('value')) {
      const explicit = Number(child.getAttribute('value'));
      if (Number.isSafeInteger(explicit)) value = explicit;
    }
    if (child === item) return value;
    value += reversed ? -1 : 1;
  }
  return value;
}

// Retain list ancestry and paragraph boundaries without cloning arbitrary page
// markup. Each translated paragraph stays in its own original list item.
export function htmlStructure(runs: HtmlRun[]): HtmlBlock[] | undefined {
  const blocks: HtmlBlock[] = [];
  let hasList = false;
  for (const run of runs) {
    if (run.kind === 'text' && run.boundary) continue;
    const node = run.kind === 'math' ? run.element : (run.node ?? run.element);
    const element = node instanceof Element ? node : node?.parentElement;
    if (!element) continue;
    const path: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement)
      if (current.localName === 'li' && current.parentElement?.matches('ul,ol'))
        path.unshift(current);
    let target = blocks;
    for (const item of path) {
      hasList = true;
      const list = item.parentElement!;
      let block = target.at(-1);
      if (block?.kind !== 'list' || block.element !== list) {
        block = {
          kind: 'list',
          element: list,
          ordered: list.localName === 'ol',
          reversed: list.hasAttribute('reversed'),
          start: ordinal(list, item),
          type: /^[1aAiI]$/.test(list.getAttribute('type') ?? '')
            ? list.getAttribute('type')!
            : undefined,
          items: [],
        };
        target.push(block);
      }
      let entry = block.items.at(-1);
      if (entry?.element !== item) {
        entry = { element: item, value: ordinal(list, item), blocks: [] };
        block.items.push(entry);
      }
      target = entry.blocks;
    }
    const owner = element.closest('p,div,li,dd,dt,blockquote,h1,h2,h3,h4,h5,h6') ?? undefined;
    let paragraph = target.at(-1);
    if (
      run.kind === 'text' &&
      !run.element &&
      !run.text.trim() &&
      (paragraph?.kind !== 'paragraph' || paragraph.owner !== owner)
    )
      continue;
    if (paragraph?.kind !== 'paragraph' || paragraph.owner !== owner) {
      paragraph = { kind: 'paragraph', owner, runs: [] };
      target.push(paragraph);
    }
    paragraph.runs.push(run);
  }
  return hasList ? blocks : undefined;
}

export function structureText(blocks: HtmlBlock[], depth = 0): string {
  return blocks
    .map((block) => {
      if (block.kind === 'paragraph')
        return block.runs
          .map((run) => (run.kind === 'text' ? run.text : run.source))
          .join('')
          .trim();
      return block.items
        .map((item) => {
          const prefix = '  '.repeat(depth) + (block.ordered ? item.value + '. ' : '• ');
          return prefix + structureText(item.blocks, depth + 1);
        })
        .join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

export function structureRuns(blocks: HtmlBlock[]): HtmlRun[] {
  return blocks.flatMap((block) =>
    block.kind === 'paragraph'
      ? [...block.runs, { kind: 'text' as const, text: '\n\n', boundary: true }]
      : block.items.flatMap((item) => structureRuns(item.blocks)),
  );
}
