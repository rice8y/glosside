import { EXCLUDED, sourceText } from './blocks';

function isBlock(element: Element) {
  if (element.matches('br,hr')) return true;
  const display = getComputedStyle(element).display;
  if (display)
    return display !== 'none' && display !== 'contents' && !/^(inline|ruby)/.test(display);
  return element.matches(
    'body,main,article,section,div,p,li,td,th,blockquote,figcaption,dt,dd,h1,h2,h3,h4,h5,h6',
  );
}

// A paragraph can be an inline run inside a div, not necessarily a <p>.
// Expand only within one run; never collect neighbouring headings or paragraphs.
export function paragraphText(selection: Range): string | undefined {
  if (selection.collapsed || !selection.commonAncestorContainer.isConnected) return;
  let container =
    selection.commonAncestorContainer instanceof Element
      ? selection.commonAncestorContainer
      : selection.commonAncestorContainer.parentElement;
  while (container && !isBlock(container)) container = container.parentElement;
  if (!container || container.closest(EXCLUDED)) return;
  let run: Node[] = [];
  const read = () => {
    if (!run.length) return;
    const range = document.createRange();
    range.setStartBefore(run[0]);
    range.setEndAfter(run[run.length - 1]);
    if (
      selection.compareBoundaryPoints(Range.START_TO_START, range) < 0 ||
      selection.compareBoundaryPoints(Range.END_TO_END, range) > 0
    )
      return;
    const fragment = document.createElement('div');
    fragment.append(range.cloneContents());
    const text = sourceText(fragment);
    return text.trim() ? text : undefined;
  };
  for (const node of container.childNodes) {
    const boundary =
      node instanceof Element && (isBlock(node) || [...node.querySelectorAll('*')].some(isBlock));
    if (boundary) {
      const text = read();
      if (text !== undefined) return text;
      run = [];
    } else run.push(node);
  }
  return read();
}
