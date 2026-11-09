// Applies only to the explicitly selected sharing actions. Plain copying stays unchanged.
export const outputNotice = [
  'Translated with PLaMo 3 Translate via Glosside.',
  'この訳文を利用して学習したモデルには、PLaMoコミュニティライセンス契約の条件が適用されます（第5条3項・4項）。',
  'Any model trained using this translation is subject to the PLaMo Community License Agreement (Article 5(3)–(4)).',
  'https://plamo.preferredai.jp/info/plamo-community-license-ja',
  'https://plamo.preferredai.jp/info/plamo-community-license-en',
].join('\n');

export interface ShareOutput {
  text: string;
  complete: boolean;
}
export function outputWithNotice(output: ShareOutput): string {
  if (!output.text) return '';
  const state = output.complete ? '' : '[未完了の訳文 / Incomplete translation]\n\n';
  return `${state}${output.text}\n\n---\n${outputNotice}\n`;
}
