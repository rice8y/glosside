import { EXCLUDED } from './blocks';

export const LITERAL_SELECTOR = 'code,pre,kbd,samp';

export function literalRoot(node: Node): Element | undefined {
  let root = (node instanceof Element ? node : node.parentElement)?.closest(LITERAL_SELECTOR);
  if (!root) return;
  for (let parent = root.parentElement?.closest(LITERAL_SELECTOR); parent;) {
    root = parent;
    parent = root.parentElement?.closest(LITERAL_SELECTOR);
  }
  return root;
}

// Read only the selected, visible text. Syntax highlighting is flattened to
// literal text; page markup, handlers and hidden copy controls are not cloned.
export function literalText(root: Element, range: Range, read: (node: Text) => string): string {
  if (root.parentElement?.closest(EXCLUDED)) return '';
  for (let parent: Element | null = root; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (
      parent.matches('[hidden],[aria-hidden="true"]') ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.contentVisibility === 'hidden'
    )
      return '';
  }
  const visit = (node: Node): string => {
    if (!range.intersectsNode(node)) return '';
    if (node instanceof Text) {
      const text = read(node);
      return text.slice(
        node === range.startContainer ? range.startOffset : 0,
        node === range.endContainer ? range.endOffset : text.length,
      );
    }
    if (!(node instanceof Element)) return '';
    if (node.matches(EXCLUDED) && !node.matches(LITERAL_SELECTOR)) return '';
    if (
      node.matches(
        '[hidden],[aria-hidden="true"],[translate="no"],[data-local-translator],[contenteditable]:not([contenteditable="false"])',
      )
    )
      return '';
    const style = getComputedStyle(node);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.contentVisibility === 'hidden'
    )
      return '';
    if (node.localName === 'br') return '\n';
    return [...node.childNodes].map(visit).join('');
  };
  return visit(root);
}
