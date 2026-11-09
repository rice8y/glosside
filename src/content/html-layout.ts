// Preserve authored layout boundaries, not incidental source-code indentation.
// display:contents and inline wrappers must not split a translated sentence.
export function flowBlock(element: Element): boolean {
  const display = getComputedStyle(element).display;
  if (display) return /^(block|flow-root|list-item|table|flex|grid)(\s|-|$)/.test(display);
  return element.matches(
    'body,main,article,section,div,p,blockquote,figure,figcaption,ul,ol,li,dl,dt,dd,table,thead,tbody,tfoot,tr,td,th,caption,h1,h2,h3,h4,h5,h6',
  );
}

export function flowOwner(element: Element): Element | undefined {
  for (let current: Element | null = element; current; current = current.parentElement)
    if (flowBlock(current)) return current;
}

export function flowText(node: Text, value: string) {
  const style = node.parentElement && getComputedStyle(node.parentElement);
  const whiteSpace = style?.whiteSpace ?? 'normal';
  const collapse = style?.whiteSpaceCollapse;
  const preserve =
    /^(pre|pre-wrap|break-spaces)$/.test(whiteSpace) ||
    collapse === 'preserve' ||
    collapse === 'break-spaces';
  const lines = preserve || whiteSpace === 'pre-line' || collapse === 'preserve-breaks';
  const text = value.replace(/\r\n?/g, '\n');
  return {
    text: preserve ? text : text.replace(lines ? /[\t\f ]+/g : /[\t\f\n ]+/g, ' '),
    lines,
    preserve,
  };
}
