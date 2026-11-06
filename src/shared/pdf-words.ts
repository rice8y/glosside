// Deliberately small, reviewed vocabulary. Ambiguous compounds stay hyphenated.
// Other words need an intact occurrence in the selected source as evidence.
const words = new Set(
  `architecture architectures architectural autoregressive
attention computation computational computing configuration configurations
contribution contributions demonstrate demonstrated demonstrates demonstrating
description descriptions development developments different differences
distribution distributions efficient efficiency evaluation evaluations
experiment experiments experimental generation generations implementation
implementations information introduction language languages learning
likelihood mathematical mathematics mechanism mechanisms methodology
optimization optimizations parameter parameters performance prediction
predictions probability probabilities representation representations
research researchers respectively sequence sequences sequential significant
significantly specification specifications standard standards structure
structures structural technique techniques technology technologies
theoretical training translation translations vocabulary vocabularies`.split(/\s+/u),
);
const compoundPrefix =
  /^(?:non|re|pre|post|co|self|cross|multi|semi|anti|bi|inter|intra|sub|super|trans)$/u;
export function joinedPdfWord(source: string, left: string, right: string) {
  if (!/^[a-z]{2,}$/u.test(left) || !/^[a-z]{2,}$/u.test(right) || compoundPrefix.test(left))
    return false;
  if (new RegExp(`\\b${left}-${right}\\b`, 'iu').test(source)) return false;
  const joined = left + right;
  return words.has(joined) || new RegExp(`\\b${joined}\\b`, 'iu').test(source);
}
