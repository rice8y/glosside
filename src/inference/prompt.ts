import { validateRequest, checkText } from '../shared/protocol';
import type { Request } from '../shared/types';
export const PROMPT_VERSION = 'pfml3-cc8e8816-v1';
export function buildPrompt(
  request: Request,
  history: { source: string; target: string }[] = [],
): string {
  const r = validateRequest(request);
  const tag = '<|plamo:tag|>',
    msg = '<|plamo:msg|>',
    key = '<|plamo:key|>',
    val = '<|plamo:val|>';
  const input = tag + 'input' + (r.sourceLanguage ? key + 'lang' + val + r.sourceLanguage : '');
  const output = tag + 'output' + key + 'lang' + val + r.targetLanguage;
  let p = '<|plamo:bos|>' + tag + 'dataset' + msg + 'translation';
  if (r.context) p += tag + 'context' + msg + r.context;
  for (const pair of history) {
    checkText(pair.source);
    checkText(pair.target);
    p += input + msg + pair.source + output + msg + pair.target;
  }
  if (r.glossary?.length)
    p +=
      tag +
      'glossary' +
      r.glossary.map((t) => '<|plamo:index|>' + t.source + '<|plamo:item|>' + t.target).join('');
  return (
    p +
    input +
    msg +
    r.translationText +
    output +
    (r.japaneseForm ? key + 'form' + val + r.japaneseForm : '') +
    msg
  );
}
export function qualityWarnings(source: string, result: string): string[] {
  const warnings: string[] = [];
  if (!result.trim()) warnings.push('空の訳文です。再試行してください。');
  if (result.includes('<|plamo:')) warnings.push('訳文に予約トークンが含まれています。');
  const identifiers = source.match(/https?:\/\/[^\s]+|\b\d+(?:[.,]\d+)*\b/g) ?? [];
  if (identifiers.some((t) => !result.includes(t)))
    warnings.push(
      '原文にあるURLや数値が訳文に含まれていない可能性があります。原文と見比べて確認してください。',
    );
  if (/(.{20,})\1\1/u.test(result)) warnings.push('訳文に反復が見つかりました。');
  return warnings;
}
