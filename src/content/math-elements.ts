// Accessibility copies can sit beside (rather than inside) the visible equation.
// Keep their metadata available, but never extract them as separate page content.
export const MATH_ACCESSIBILITY_SELECTOR =
  '.mwe-math-mathml-a11y,mjx-assistive-mml,.MJX_Assistive_MathML,.katex-mathml';

// Outermost containers take precedence over their visual and accessibility
// representations, so KaTeX/MathJax equations are never extracted twice.
export const MATH_SELECTOR = [
  'math',
  'mjx-container',
  '.MathJax',
  '.MathJax_Display',
  '.MathJax_SVG',
  '.MathJax_SVG_Display',
  '.katex',
  '.katex-display',
  '[role="math"]',
  '.mwe-math-element',
  'img.latex',
  'img.tex',
  'img.math',
  'img.equation',
  'img[data-tex]',
  'img[alt^="\\\\("]',
  'img[alt^="\\\\["]',
  'img[alt^="\\\\displaystyle"]',
].join(',');

export function mathRoot(node: Node): Element | undefined {
  let current = node instanceof Element ? node : node.parentElement;
  let root: Element | undefined;
  while (current) {
    if (current.matches(MATH_SELECTOR)) root = current;
    current = current.parentElement;
  }
  return root;
}

function mathText(node: Node, depth = 0): string {
  if (depth > 128) return '…';
  if (node instanceof Text) return node.data;
  if (!(node instanceof Element)) return '';
  const structured = [
    'semantics',
    'msup',
    'msub',
    'msubsup',
    'mfrac',
    'msqrt',
    'mroot',
    'munder',
    'mover',
    'munderover',
    'mtable',
    'mtr',
    'mlabeledtr',
    'mfenced',
    'menclose',
  ];
  const parts = structured.includes(node.localName)
    ? [...node.children].map((child) => mathText(child, depth + 1))
    : [];
  switch (node.localName) {
    case 'annotation':
    case 'annotation-xml':
      return '';
    case 'semantics':
      return parts[0] ?? '';
    case 'msup':
      return `${parts[0]}^{${parts[1]}}`;
    case 'msub':
      return `${parts[0]}_{${parts[1]}}`;
    case 'msubsup':
      return `${parts[0]}_{${parts[1]}}^{${parts[2]}}`;
    case 'mfrac':
      return `(${parts[0]})/(${parts[1]})`;
    case 'msqrt':
      return `√(${parts.join('')})`;
    case 'mroot':
      return `root(${parts[0]}, ${parts[1]})`;
    case 'munder':
      return `${parts[0]}_{${parts[1]}}`;
    case 'mover':
      return `${parts[0]}^{${parts[1]}}`;
    case 'munderover':
      return `${parts[0]}_{${parts[1]}}^{${parts[2]}}`;
    case 'mtable':
      return `[${parts.join('; ')}]`;
    case 'mtr':
    case 'mlabeledtr':
      return parts.join(', ');
    case 'mspace':
      return ' ';
    case 'menclose':
      return `${node.getAttribute('notation') || 'longdiv'}(${parts.join('')})`;
    case 'mfenced':
      return (
        (node.getAttribute('open') ?? '(') +
        parts.join(node.getAttribute('separators') ?? ',') +
        (node.getAttribute('close') ?? ')')
      );
    default:
      return [...node.childNodes].map((child) => mathText(child, depth + 1)).join('');
  }
}

export function mathMetadata(element: Element): Element | undefined {
  if (element.matches('math')) return element;
  const contained = element.querySelector('math');
  if (contained) return contained;
  // MediaWiki's MathJax enhancement leaves the original MathML in a clipped
  // accessibility sibling and copies its identity onto the rendered equation.
  const previous = element.previousElementSibling;
  if (
    element.matches('mjx-container,.MathJax,.MathJax_SVG') &&
    previous?.matches(MATH_ACCESSIBILITY_SELECTOR)
  ) {
    const math = previous.querySelector('math');
    const rendered = element.querySelector('[data-mml-node="math"]');
    const sourceId = math?.getAttribute('about') ?? math?.id;
    const renderedId = rendered?.getAttribute('about') ?? rendered?.id;
    if (math && (!sourceId || !renderedId || sourceId === renderedId)) return math;
  }
}

export function mathSource(element: Element): string {
  const math = mathMetadata(element);
  const annotation =
    math?.querySelector('annotation[encoding="application/x-tex"]') ??
    element.querySelector('annotation[encoding="application/x-tex"]');
  const image = element.matches('img') ? element : element.querySelector('img');
  const source =
    annotation?.textContent ||
    math?.getAttribute('alttext') ||
    element.getAttribute('data-tex') ||
    image?.getAttribute('alt') ||
    element.getAttribute('aria-label') ||
    (math ? mathText(math) : element.textContent);
  return source?.trim() || '［数式］';
}

export function blockMath(element: Element): boolean {
  return (
    element.matches(
      '.katex-display,.MathJax_Display,.MathJax_SVG_Display,[display="block"],[display="true"]',
    ) || !!element.querySelector('math[display="block"]')
  );
}
