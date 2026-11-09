import { mathSource, mathMetadata } from './math-elements';

const MML = 'http://www.w3.org/1998/Math/MathML';
const SVG = 'http://www.w3.org/2000/svg';
const mathTags = new Set(
  'math mrow mi mn mo mtext mspace ms mfrac msqrt mroot mstyle merror mpadded mphantom msub msup msubsup munder mover munderover mmultiscripts mprescripts none mtable mtr mtd semantics'.split(
    ' ',
  ),
);
const mathAttrs = new Set(
  'display mathvariant mathsize mathcolor mathbackground dir scriptlevel displaystyle scriptsizemultiplier scriptminsize stretchy symmetric fence separator lspace rspace minsize maxsize largeop movablelimits accent accentunder form linethickness bevelled numalign denomalign subscriptshift superscriptshift columnalign rowalign columnspacing rowspacing columnlines rowlines frame framespacing equalrows equalcolumns columnspan rowspan width height depth lquote rquote open close separators notation'.split(
    ' ',
  ),
);
const svgTags = new Set(
  'svg g path rect line circle ellipse polygon polyline text tspan defs'.split(' '),
);
const svgAttrs = new Set(
  'viewBox width height x y x1 x2 y1 y2 cx cy r rx ry d points transform preserveAspectRatio fill-rule stroke-width stroke-linecap stroke-linejoin font-size font-family text-anchor dominant-baseline'.split(
    ' ',
  ),
);
const styleNames =
  'display position top right bottom left width height min-width max-width padding-top padding-right padding-bottom padding-left margin-top margin-right margin-bottom margin-left vertical-align font-family font-size font-style font-weight line-height letter-spacing text-align white-space overflow overflow-x overflow-y clip clip-path border-top-width border-top-style border-right-width border-right-style border-bottom-width border-bottom-style border-left-width border-left-style transform transform-origin box-sizing'.split(
    ' ',
  );

function safeValue(value: string) {
  return value.length < 2000 && !/url\s*\(|expression|[<>]/i.test(value);
}
function paint(value: string) {
  if (/^(?:none|transparent)$/i.test(value)) return value;
  // Monochrome math follows the popup's text color, including dark/forced colors.
  if (
    /^(?:currentcolor|black|white|#(?:000(?:000)?|fff(?:fff)?)|rgb\(\s*(?:0,\s*0,\s*0|255,\s*255,\s*255)\s*\))$/i.test(
      value,
    )
  )
    return 'currentColor';
  return /^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]+)$/i.test(value) ? value : 'currentColor';
}

function copyStyles(
  target: HTMLElement | SVGElement,
  style: CSSStyleDeclaration,
  parentSize: number,
) {
  const size = Number.parseFloat(style.fontSize) || parentSize;
  for (const name of styleNames) {
    let value = style.getPropertyValue(name);
    if (!value || !safeValue(value) || /^(fixed|sticky)$/.test(value)) continue;
    // Computed pixel metrics become font-relative, so copied CommonHTML scales
    // with the popup text while preserving fractions, scripts and glyph offsets.
    const basis = name === 'font-size' ? parentSize : size;
    value = value.replace(/(-?[\d.]+)px/g, (_, pixels) => `${Number(pixels) / basis}em`);
    target.style.setProperty(name, value);
  }
}

// Rebuild inert, allowlisted display nodes. No source HTML, event handlers,
// custom elements, stylesheets, links, or external SVG references are imported.
export function mathView(root: Element): HTMLElement {
  const source = mathSource(root);
  const host = document.createElement('span');
  host.className = 'html-math';
  host.setAttribute('role', 'math');
  host.setAttribute('aria-label', source);
  let remaining = 4096;
  const math = mathMetadata(root);
  const copyMath = (node: Node): Node | undefined => {
    if (--remaining < 0) throw new Error('Math node limit');
    if (node instanceof Text) return document.createTextNode(node.data);
    if (!(node instanceof Element)) return;
    if (node.matches('annotation,annotation-xml')) return;
    if (node.namespaceURI !== MML || !mathTags.has(node.localName))
      throw new Error('Unsupported MathML');
    const copy = document.createElementNS(MML, node.localName);
    for (const attr of node.attributes)
      if (mathAttrs.has(attr.name) && safeValue(attr.value))
        copy.setAttribute(attr.name, attr.value);
    copy.removeAttribute('mathcolor');
    copy.removeAttribute('mathbackground');
    for (const child of node.childNodes) {
      const next = copyMath(child);
      if (next) copy.append(next);
    }
    return copy;
  };
  const copySvg = (node: Node, seen = new Set<Element>()): Node | undefined => {
    if (--remaining < 0) throw new Error('Math node limit');
    if (node instanceof Text) return document.createTextNode(node.data);
    if (!(node instanceof Element) || seen.has(node)) return;
    if (node.localName === 'use') {
      const href = node.getAttribute('href') || node.getAttribute('xlink:href');
      if (!href?.startsWith('#')) throw new Error('External SVG reference');
      const target = node.ownerDocument.getElementById(href.slice(1));
      if (!target || target.namespaceURI !== SVG) throw new Error('Missing SVG glyph');
      const group = document.createElementNS(SVG, 'g');
      const transform = node.getAttribute('transform');
      if (transform && safeValue(transform)) group.setAttribute('transform', transform);
      const offset = document.createElementNS(SVG, 'g');
      const x = Number.parseFloat(node.getAttribute('x') || '0');
      const y = Number.parseFloat(node.getAttribute('y') || '0');
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid SVG position');
      offset.setAttribute('transform', `translate(${x} ${y})`);
      const child = copySvg(target, new Set([...seen, node]));
      if (!child) throw new Error('Cyclic SVG glyph');
      offset.append(child);
      group.append(offset);
      return group;
    }
    if (node.matches('title,desc,metadata,style,script')) return;
    if (!svgTags.has(node.localName)) throw new Error('Unsupported SVG');
    const copy = document.createElementNS(SVG, node.localName);
    for (const attr of node.attributes)
      if (svgAttrs.has(attr.name) && safeValue(attr.value))
        copy.setAttribute(attr.name, attr.value);
    for (const name of ['fill', 'stroke']) {
      const value = getComputedStyle(node).getPropertyValue(name) || node.getAttribute(name);
      if (value) copy.setAttribute(name, paint(value));
    }
    for (const child of node.childNodes) {
      const next = copySvg(child, new Set([...seen, node]));
      if (next) copy.append(next);
    }
    return copy;
  };
  const copyLayout = (node: Node): Node | undefined => {
    if (--remaining < 0) throw new Error('Math node limit');
    if (node instanceof Text) return document.createTextNode(node.data);
    if (
      !(node instanceof Element) ||
      node.matches(
        'script,style,iframe,object,embed,annotation,annotation-xml,mjx-assistive-mml,.katex-mathml,.MJX_Assistive_MathML,[hidden]',
      )
    )
      return;
    if (node instanceof HTMLImageElement) throw new Error('Composite math image');
    if (node.namespaceURI === SVG) {
      const copy = copySvg(node);
      if (copy instanceof SVGElement)
        copyStyles(
          copy,
          getComputedStyle(node),
          Number.parseFloat(
            node.parentElement ? getComputedStyle(node.parentElement).fontSize : '',
          ) || 16,
        );
      return copy;
    }
    if (node.namespaceURI === MML) return copyMath(node);
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const copy = document.createElement('span');
    const parentSize =
      Number.parseFloat(node.parentElement ? getComputedStyle(node.parentElement).fontSize : '') ||
      16;
    copyStyles(copy, style, parentSize);
    const after: Node[] = [];
    // MathJax CommonHTML emits glyphs through ::before, rather than text nodes.
    for (const pseudo of ['::before', '::after']) {
      const computed = getComputedStyle(node, pseudo);
      const content = computed.content;
      if (!content || content === 'none' || content === 'normal') continue;
      let text: string;
      try {
        text = JSON.parse(content);
      } catch {
        throw new Error('Unsupported math glyph');
      }
      if (typeof text !== 'string') throw new Error('Unsupported math glyph');
      const glyph = document.createElement('span');
      glyph.textContent = text;
      copyStyles(glyph, computed, Number.parseFloat(style.fontSize) || parentSize);
      if (pseudo === '::before') copy.append(glyph);
      else after.push(glyph);
    }
    for (const child of node.childNodes) {
      const next = copyLayout(child);
      if (next) copy.append(next);
    }
    copy.append(...after);
    return copy;
  };
  // Only use the native MathML Core subset. Non-core notation and font
  // variants can silently lose meaning; use the site's visual rendering then.
  // https://www.w3.org/TR/mathml-core/
  const nativeMath =
    math &&
    [math, ...math.querySelectorAll('*')].every(
      (node) =>
        node.closest('annotation,annotation-xml') ||
        (mathTags.has(node.localName) &&
          (!node.hasAttribute('mathvariant') || node.getAttribute('mathvariant') === 'normal')),
    );
  try {
    if (math && nativeMath) {
      const copy = copyMath(math);
      if (!copy || !copy.textContent?.trim()) throw new Error('Missing MathML');
      // Native MathML already exposes a structured equation to accessibility.
      // Do not wrap it in a second, separately labelled ARIA math object.
      host.removeAttribute('role');
      host.removeAttribute('aria-label');
      host.append(copy);
    } else {
      const svg = root.matches('svg')
        ? root
        : root.matches('mjx-container[jax="SVG"],.MathJax_SVG,.MathJax_SVG_Display')
          ? root.querySelector('svg')
          : root.children.length === 1 && root.firstElementChild?.namespaceURI === SVG
            ? root.firstElementChild
            : undefined;
      const image =
        root instanceof HTMLImageElement
          ? root
          : root.querySelectorAll('img').length === 1
            ? root.querySelector('img')
            : undefined;
      if (svg) {
        const copy = copySvg(svg);
        if (!copy) throw new Error('Missing SVG');
        if (copy instanceof Element) copy.setAttribute('aria-hidden', 'true');
        if (copy instanceof SVGElement) {
          const style = getComputedStyle(svg);
          const size = Number.parseFloat(style.fontSize) || 16;
          const align = style.verticalAlign;
          if (align && safeValue(align))
            copy.style.verticalAlign = align.replace(
              /(-?[\d.]+)px/g,
              (_, pixels) => `${Number(pixels) / size}em`,
            );
        }
        host.append(copy);
      } else if (image instanceof HTMLImageElement) {
        const url = new URL(image.currentSrc || image.src, document.baseURI);
        if (
          !['http:', 'https:', 'blob:'].includes(url.protocol) &&
          !/^data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,]/i.test(url.href)
        )
          throw new Error('Invalid image URL');
        const copy = document.createElement('img');
        copy.setAttribute('aria-hidden', 'true');
        copy.referrerPolicy = 'no-referrer';
        copy.alt = source;
        copy.src = url.href;
        copy.draggable = false;
        const rect = image.getBoundingClientRect();
        const size = Number.parseFloat(getComputedStyle(image).fontSize) || 16;
        const width = rect.width || image.width;
        if (width > 0) copy.style.width = Math.min(200, width / size) + 'em';
        copy.addEventListener(
          'error',
          () => {
            host.textContent = source;
            host.removeAttribute('role');
            host.removeAttribute('aria-label');
            host.dataset.mathFallback = 'true';
            host.dispatchEvent(new Event('math-render-error', { bubbles: true }));
          },
          { once: true },
        );
        host.append(copy);
      } else {
        if (root.namespaceURI === MML) throw new Error('Unsupported MathML');
        const copy = copyLayout(root);
        if (!copy) throw new Error('Missing math layout');
        if (copy instanceof Element) copy.setAttribute('aria-hidden', 'true');
        host.append(copy);
      }
    }
  } catch {
    host.textContent = source;
    host.removeAttribute('role');
    host.removeAttribute('aria-label');
    host.dataset.mathFallback = 'true';
  }
  return host;
}
