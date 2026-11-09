// Opaque markers are unique to the input. Only a complete, one-to-one mapping
// may restore protected content; model output is never interpreted as markup.
export function protectedTokens(source: string, count: number) {
  let prefix = 'ZXQ';
  while (source.includes(prefix)) prefix += 'Z';
  const tokens = Array.from({ length: count }, (_, index) => {
    const label =
      (index < 26 ? '' : String.fromCharCode(64 + Math.floor(index / 26))) +
      String.fromCharCode(65 + (index % 26));
    return prefix + label + prefix;
  });
  return { prefix, tokens };
}

export function protectedPositions(text: string, prefix: string, tokens: string[]) {
  if (tokens.some((token) => text.split(token).length !== 2)) return;
  let remainder = text;
  for (const token of tokens) remainder = remainder.replace(token, '');
  if (remainder.includes(prefix)) return;
  return tokens
    .map((token, index) => ({ start: text.indexOf(token), token, index }))
    .sort((a, b) => a.start - b.start);
}
