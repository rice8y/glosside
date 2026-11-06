import brand from './brand.json';
// The build uses these same shapes for the toolbar icons and page favicons.
export function brandIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  const circle = document.createElementNS(ns, 'circle');
  for (const [key, value] of Object.entries({
    cx: 50,
    cy: 50,
    r: brand.radius * 100,
    fill: `rgb(${brand.background.join(',')})`,
  }))
    circle.setAttribute(key, String(value));
  svg.append(circle);
  for (const glyph of brand.glyphs) {
    const polygon = document.createElementNS(ns, 'polygon');
    for (const [key, value] of Object.entries({
      points: glyph.points.map(([x, y]) => `${x * 100},${y * 100}`).join(' '),
      fill: `rgb(${glyph.color.join(',')})`,
    }))
      polygon.setAttribute(key, String(value));
    svg.append(polygon);
  }
  return svg;
}
