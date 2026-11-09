import { EXCLUDED } from './blocks';
import { htmlMathPlan, type HtmlPlan, type HtmlRun } from './math-plan';
import { mathRoot, MATH_SELECTOR, MATH_ACCESSIBILITY_SELECTOR } from './math-elements';

export interface PageMath {
  container: Element;
  plan: HtmlPlan;
  slots: Text[][];
  structure: Node[];
  formulas: string[];
}
function structure(root: Element) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  const result: Node[] = [];
  while (walker.nextNode()) result.push(walker.currentNode);
  return result;
}

// Group ordinary prose surrounding formulas without moving elements. Rich
// interactive/semantic markup keeps the existing per-node translation path.
export function pageMath(node: Text, read: (node: Text) => string): PageMath | undefined {
  let container = node.parentElement;
  while (container && container !== document.body) {
    const display = getComputedStyle(container).display;
    if (display && display !== 'contents' && !/^(inline|ruby)/.test(display)) break;
    container = container.parentElement;
  }
  if (
    !container ||
    container === document.body ||
    !container.matches('p,div,li,td,th,dd,dt,h1,h2,h3,h4,h5,h6')
  )
    return;
  if (!container.querySelector(MATH_SELECTOR)) return;
  for (const element of container.querySelectorAll('*')) {
    if (mathRoot(element) || element.closest(MATH_ACCESSIBILITY_SELECTOR)) continue;
    if (
      !element.matches('span') ||
      element.hasAttribute('role') ||
      element.hasAttribute('tabindex')
    )
      return;
    const style = getComputedStyle(element);
    if (style.display && !/^(inline|contents)/.test(style.display)) return;
  }
  const range = document.createRange();
  range.selectNodeContents(container);
  const plan = htmlMathPlan(range, read, false);
  if (!plan || plan.source.length > 12000) return;
  const slots: Text[][] = [[]];
  for (const run of plan.runs) {
    if (run.kind === 'math') slots.push([]);
    else if (run.node) slots.at(-1)!.push(run.node);
    else if (run.text.trim()) return;
  }
  // Each translated clause needs a single owning text node. Do not flatten
  // differently styled prose across several text nodes into one of them.
  if (slots.some((slot) => slot.filter((text) => read(text).trim()).length > 1)) return;
  return {
    container,
    plan,
    slots,
    structure: structure(container),
    formulas: plan.runs.filter((r) => r.kind === 'math').map((r) => r.element.outerHTML),
  };
}

export function pageMathCurrent(group: PageMath) {
  const nodes = structure(group.container);
  return (
    group.container.isConnected &&
    group.slots.flat().every((node) => {
      if (node.parentElement?.closest(EXCLUDED)) return false;
      for (let element = node.parentElement; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.contentVisibility === 'hidden'
        )
          return false;
        if (element === group.container) break;
      }
      return true;
    }) &&
    nodes.length === group.structure.length &&
    nodes.every((node, index) => node === group.structure[index]) &&
    group.plan.runs
      .filter((r) => r.kind === 'math')
      .every((r, index) => r.element.outerHTML === group.formulas[index])
  );
}

// DOM math stays in its original position. Reordered formulas or text with no
// corresponding slot cannot be safely applied to a live page and are rejected.
export function pageMathWrites(group: PageMath, runs: HtmlRun[]): Map<Text, string> | undefined {
  const expected = group.plan.runs.filter((r) => r.kind === 'math');
  const values = [''];
  let index = 0;
  for (const run of runs) {
    if (run.kind === 'text') values[index] += run.text;
    else {
      if (run !== expected[index]) return;
      index++;
      values.push('');
    }
  }
  if (index !== expected.length) return;
  const writes = new Map<Text, string>();
  for (const [i, slot] of group.slots.entries()) {
    if (!slot.length) {
      if (values[i].trim()) return;
      continue;
    }
    const owner = slot.find((node) => node.data.trim()) ?? slot[0];
    for (const node of slot) writes.set(node, node === owner ? values[i] : '');
  }
  return writes;
}
