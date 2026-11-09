import type { HtmlRun } from './math-plan';

// Range.intersectsNode describes DOM boundaries, not what the browser painted
// as selected. Chat apps commonly keep timestamps/toolbars inside that range.
export function selectionAccess() {
  const styles = new Map<Element, CSSStyleDeclaration>();
  const style = (element: Element) => {
    let value = styles.get(element);
    if (!value) {
      value = getComputedStyle(element);
      styles.set(element, value);
    }
    return value;
  };
  const visible = (node: Node): boolean => {
    const element = node instanceof Element ? node : node.parentElement;
    if (!element || /^(hidden|collapse)$/.test(style(element).visibility)) return false;
    for (let current: Element | null = element; current; current = current.parentElement) {
      const s = style(current);
      if (
        current.matches('[hidden],[aria-hidden="true"],[inert]') ||
        s.display === 'none' ||
        s.contentVisibility === 'hidden' ||
        s.opacity === '0'
      )
        return false;
      // Screen-reader-only labels can have client rectangles despite being
      // completely clipped. Do not infer visibility from a nonempty rect alone.
      const clip = s.clip
        .match(/^rect\((.*)\)$/)?.[1]
        .split(/[,\s]+/)
        .filter(Boolean)
        .map(Number.parseFloat);
      if (clip?.length === 4 && (clip[2] <= clip[0] || clip[1] <= clip[3])) return false;
      if (/^inset\(50%\)$/.test(s.clipPath)) return false;
      if (
        /hidden|clip/.test(s.overflow + s.overflowX + s.overflowY) &&
        /absolute|fixed/.test(s.position) &&
        parseFloat(s.width) <= 1 &&
        parseFloat(s.height) <= 1
      )
        return false;
    }
    return true;
  };
  const text = (node: Text): boolean => {
    if (!visible(node)) return false;
    // Descendants may explicitly restore user-select:text under an app-wide
    // user-select:none. Never prune the entire ancestor subtree on this basis.
    for (let element = node.parentElement; element; element = element.parentElement) {
      const select =
        style(element).userSelect || style(element).getPropertyValue('-webkit-user-select');
      if (select === 'none') return false;
      if (select === 'text' || select === 'all') return true;
    }
    return true;
  };
  return { visible, text };
}

// Check ordinary selected text against the browser's own selection. Math is
// atomic and can have an empty/different native spelling; literal code is exact.
// Ordered substring checks avoid regex backtracking for long math-heavy ranges.
export function matchesNativeSelection(runs: HtmlRun[], native: string): boolean {
  const compact = (text: string) => text.normalize('NFKC').replace(/\s/gu, '');
  const segments = [''];
  for (const run of runs) {
    if (run.kind === 'math') segments.push('');
    else segments[segments.length - 1] += run.kind === 'text' ? run.text : run.source;
  }
  const chunks = segments.map(compact),
    selected = compact(native);
  if (chunks.length === 1) return chunks[0] === selected;
  if (!selected.startsWith(chunks[0])) return false;
  let cursor = chunks[0].length;
  for (const chunk of chunks.slice(1, -1)) {
    const index = selected.indexOf(chunk, cursor);
    if (index < 0) return false;
    cursor = index + chunk.length;
  }
  const last = chunks.at(-1)!;
  return selected.endsWith(last) && selected.length - last.length >= cursor;
}
