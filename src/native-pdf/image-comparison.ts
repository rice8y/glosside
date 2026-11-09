import type { MathRange } from './range-alignment';

export function sameGlyphLayout(a: MathRange, b: MathRange): boolean {
  if (
    !a.items.length ||
    a.items.length !== b.items.length ||
    a.fragments.length !== b.fragments.length
  )
    return false;
  const originA = a.items[0],
    originB = b.items[0];
  return a.items.every((i, n) => {
    const j = b.items[n];
    return (
      !!i.fontName &&
      i.fontName === j.fontName &&
      i.str === j.str &&
      Math.abs(i.size - j.size) < 0.0001 &&
      Math.abs(i.width - j.width) < 0.01 &&
      Math.abs(i.x - originA.x - (j.x - originB.x)) < 0.01 &&
      Math.abs(i.y - originA.y - (j.y - originB.y)) < 0.01
    );
  });
}

// Called only after identical glyphs/fonts and relative layout are established.
// PDF decimal rounding can change edge coverage by a few alpha levels. Missing
// strokes, different marks or a changed rule must fail this pixel comparison.
export function sameRaster(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length || !a.length) return false;
  let difference = 0;
  for (let n = 0; n < a.length; n += 4)
    for (let channel = 0; channel < 4; channel++) {
      const x = channel === 3 ? a[n + 3] : (a[n + channel] * a[n + 3]) / 255;
      const y = channel === 3 ? b[n + 3] : (b[n + channel] * b[n + 3]) / 255;
      const delta = Math.abs(x - y);
      if (delta > 8) return false;
      difference += delta;
    }
  return difference / a.length <= 0.1;
}
