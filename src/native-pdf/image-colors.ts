// The renderer starts with a transparent canvas, retaining the actual glyph
// color and coverage. Only neutral ink is adapted to the popup foreground.
// Increase existing edge coverage without spreading ink to adjacent pixels.
// This keeps small counters, fraction gaps and superscripts intact, unlike a
// shadow/stroke-based synthetic bold effect. Fully transparent pixels stay so.
export const equationInkAlpha = (alpha: number) =>
  Math.round(255 * (1 - Math.pow(1 - alpha / 255, 1.35)));

export function equationColors(pixels: Uint8ClampedArray) {
  let colored = false;
  for (let i = 0; i < pixels.length; i += 4) {
    if (
      pixels[i + 3] &&
      Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
        Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >
        20
    ) {
      colored = true;
      break;
    }
  }
  const light = colored ? new Uint8ClampedArray(pixels.length) : undefined;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i],
      g = pixels[i + 1],
      b = pixels[i + 2];
    const neutral = Math.max(r, g, b) - Math.min(r, g, b) <= 20;
    const alpha = neutral
      ? equationInkAlpha(pixels[i + 3] * (1 - (r + g + b) / 765))
      : pixels[i + 3];
    if (light) {
      light[i] = neutral ? 0 : r;
      light[i + 1] = neutral ? 0 : g;
      light[i + 2] = neutral ? 0 : b;
      light[i + 3] = alpha;
    }
    pixels[i] = neutral ? (colored ? 244 : 0) : r;
    pixels[i + 1] = neutral ? (colored ? 246 : 0) : g;
    pixels[i + 2] = neutral ? (colored ? 250 : 0) : b;
    pixels[i + 3] = alpha;
  }
  return light;
}
