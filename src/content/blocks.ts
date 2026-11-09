import { MATH_SELECTOR, MATH_ACCESSIBILITY_SELECTOR, mathSource } from './math-elements';
export const EXCLUDED =
  'script,style,noscript,code,pre,math,svg,canvas,textarea,input,select,[contenteditable]:not([contenteditable="false"]),[translate="no"],[hidden],[aria-hidden="true"],[data-local-translator],' +
  MATH_SELECTOR +
  ',' +
  MATH_ACCESSIBILITY_SELECTOR;
export function sourceText(
  element: Element,
  read: (node: Text) => string = (node) => node.data,
  includeMath = false,
): string {
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node instanceof Element) {
          if (node.parentElement?.closest(EXCLUDED)) return NodeFilter.FILTER_REJECT;
          if (includeMath && node.matches(MATH_SELECTOR)) {
            for (let current: Element | null = node; current; current = current.parentElement) {
              const style = getComputedStyle(current);
              if (
                current.matches('[hidden],[aria-hidden="true"]') ||
                style.display === 'none' ||
                style.visibility === 'hidden'
              )
                return NodeFilter.FILTER_REJECT;
              if (current === element) break;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
          return node.matches(EXCLUDED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        }
        return node.parentElement?.closest(EXCLUDED)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  let text = '';
  while (walker.nextNode())
    text +=
      walker.currentNode instanceof Element
        ? mathSource(walker.currentNode)
        : read(walker.currentNode as Text);
  return text;
}

const NAVIGATION = 'nav,header,footer,[role="navigation"]';

// Read live Text nodes without wrapping or rebuilding their owning elements.
// Reject whole protected subtrees, including editors and extension UI.
export function pageTextNodes(
  includeNavigation = false,
  read: (node: Text) => string = (node) => node.data,
  limit = 2001,
): Text[] {
  if (!document.body) return [];
  const nodes: Text[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node instanceof Element) {
          if (node.matches(EXCLUDED) || (!includeNavigation && node.matches(NAVIGATION)))
            return NodeFilter.FILTER_REJECT;
          const style = getComputedStyle(node);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.contentVisibility === 'hidden'
          )
            return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
        if (!(node instanceof Text) || !/\p{L}/u.test(read(node))) return NodeFilter.FILTER_REJECT;
        range.selectNodeContents(node);
        return range.getClientRects().length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    },
  );
  if (document.body.matches(EXCLUDED)) return [];
  while (nodes.length < limit && walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

export function textContext(
  node: Text,
  read: (node: Text) => string,
  cache = new Map<Element, string>(),
): string | undefined {
  let parent = node.parentElement;
  while (parent && parent !== document.body) {
    const display = getComputedStyle(parent).display;
    if (display && display !== 'contents' && !/^(inline|ruby)/.test(display)) break;
    parent = parent.parentElement;
  }
  if (!parent || parent === document.body) return;
  let text = cache.get(parent);
  if (text === undefined) {
    const container = parent;
    text = sourceText(
      container,
      (textNode) => {
        for (
          let element = textNode.parentElement;
          element && element !== container;
          element = element.parentElement
        ) {
          const style = getComputedStyle(element);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.contentVisibility === 'hidden'
          )
            return '';
        }
        return read(textNode);
      },
      true,
    ).trim();
    cache.set(container, text);
  }
  // Context is optional; never trim the actual translation input to make it fit.
  if (text !== read(node).trim() && text.length <= 4000 && !text.includes('<|plamo:')) return text;
}
export function extractBlocks(
  root: ParentNode = document,
  includeNavigation = false,
): HTMLElement[] {
  const candidates = [
    ...root.querySelectorAll<HTMLElement>(
      'h1,h2,h3,h4,h5,h6,p,li,td,th,blockquote,figcaption,dt,dd',
    ),
  ];
  return candidates.filter((e) => {
    if (
      e.closest(EXCLUDED) ||
      (!includeNavigation && e.closest('nav,header,footer,[role="navigation"]'))
    )
      return false;
    if (e.querySelector('p,li,td,th,blockquote,dt,dd')) return false;
    const style = getComputedStyle(e);
    if (style.display === 'none' || style.visibility === 'hidden' || !e.getClientRects().length)
      return false;
    return sourceText(e).trim().length > 1;
  });
}
