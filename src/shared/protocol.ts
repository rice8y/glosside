import { AppError } from './errors';
import type { Request, Settings } from './types';
import { joinedPdfWord } from './pdf-words';
export const MAX_MESSAGE = 256 * 1024;
const id = (s: unknown) => typeof s === 'string' && /^[\w:-]{1,128}$/.test(s);
export const language = (s: unknown): s is string =>
  typeof s === 'string' && (/^[a-z]{2,3}(?:-[a-z]{4})?$/.test(s) || s === 'ja(easy)');
export function checkText(s: unknown, max = 16000, empty = false): asserts s is string {
  if (typeof s !== 'string' || s.length > max || (!empty && !s.trim()))
    throw new AppError('INPUT_LIMIT');
  if (s.includes('<|plamo:')) throw new AppError('RESERVED_TOKEN');
}
export function validateRequest(value: unknown): Request {
  if (
    !value ||
    typeof value !== 'object' ||
    new TextEncoder().encode(JSON.stringify(value)).length > MAX_MESSAGE
  )
    throw new AppError('INVALID_REQUEST');
  const r = value as Request;
  if (
    r.protocolVersion !== 1 ||
    ![r.requestId, r.sessionId, r.documentEpoch].every(id) ||
    !Number.isSafeInteger(r.selectionVersion) ||
    r.selectionVersion < 0 ||
    !['html', 'native-selection'].includes(r.surface) ||
    !['selection', 'paragraph', 'page'].includes(r.mode) ||
    !language(r.targetLanguage) ||
    (r.sourceLanguage !== undefined && !language(r.sourceLanguage)) ||
    !/^([a-f0-9]{64})$/.test(r.sourceContentHash)
  )
    throw new AppError('INVALID_REQUEST');
  checkText(r.translationText);
  checkText(r.extractedText);
  if (r.textEdits !== undefined) {
    if (!Array.isArray(r.textEdits) || r.textEdits.length > r.extractedText.length)
      throw new AppError('INVALID_REQUEST');
    let cursor = 0,
      prepared = '';
    for (const edit of r.textEdits) {
      if (
        !edit ||
        !Number.isSafeInteger(edit.startUtf16) ||
        !Number.isSafeInteger(edit.endUtf16) ||
        edit.startUtf16 < cursor ||
        edit.endUtf16 <= edit.startUtf16 ||
        edit.endUtf16 > r.extractedText.length ||
        !['', ' '].includes(edit.replacement) ||
        !['line-wrap', 'soft-hyphen', 'word-hyphen'].includes(edit.reason)
      )
        throw new AppError('INVALID_REQUEST');
      const removed = r.extractedText.slice(edit.startUtf16, edit.endUtf16);
      if (
        !(
          edit.reason === 'soft-hyphen'
            ? /^\u00ad[ \t]*(?:\r\n|\n|\r)[ \t]*$/u
            : edit.reason === 'word-hyphen'
              ? /^-[ \t]*(?:\r\n|\n|\r)[ \t]*$/u
              : /^[ \t]*(?:\r\n|\n|\r)[ \t]*$/u
        ).test(removed)
      )
        throw new AppError('INVALID_REQUEST');
      if (
        edit.reason === 'word-hyphen' &&
        (edit.replacement !== '' ||
          !joinedPdfWord(
            r.extractedText,
            r.extractedText.slice(0, edit.startUtf16).match(/[a-z]+$/u)?.[0] ?? '',
            r.extractedText.slice(edit.endUtf16).match(/^[a-z]+/u)?.[0] ?? '',
          ))
      )
        throw new AppError('INVALID_REQUEST');
      prepared += r.extractedText.slice(cursor, edit.startUtf16) + edit.replacement;
      cursor = edit.endUtf16;
    }
    if (prepared + r.extractedText.slice(cursor) !== r.translationText)
      throw new AppError('INVALID_REQUEST');
  }
  if (r.context !== undefined) checkText(r.context, 4000, true);
  if (
    r.japaneseForm !== undefined &&
    (!['plain', 'polite'].includes(r.japaneseForm) || r.targetLanguage !== 'ja')
  )
    throw new AppError('INVALID_REQUEST');
  if (r.glossary !== undefined) {
    if (!Array.isArray(r.glossary) || r.glossary.length > 100)
      throw new AppError('INVALID_REQUEST');
    for (const term of r.glossary) {
      checkText(term?.source, 200);
      checkText(term?.target, 200);
    }
  }
  // Client supplied scheduling values never grant a higher class of service.
  return {
    ...r,
    priority: r.mode === 'selection' ? 0 : r.mode === 'paragraph' ? 1 : r.priority === 2 ? 2 : 3,
    pinned: r.pinned === true,
  };
}
export async function hash(text: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export async function makeRequest(
  text: string,
  settings: Settings,
  init: Partial<Request> = {},
): Promise<Request> {
  return {
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    documentEpoch: crypto.randomUUID(),
    selectionVersion: 0,
    surface: 'native-selection',
    mode: 'selection',
    extractedText: text,
    translationText: text,
    targetLanguage: settings.targetLanguage,
    ...(settings.sourceLanguage ? { sourceLanguage: settings.sourceLanguage } : {}),
    ...(settings.targetLanguage === 'ja' ? { japaneseForm: settings.japaneseForm } : {}),
    glossary: settings.glossary,
    sourceContentHash: await hash(text),
    priority: 0,
    ...init,
  };
}
export function splitText(text: string, max = 1200): string[] {
  const chunks: string[] = [];
  let buf = '';
  // UTF-16 boundaries are never allowed to split a surrogate pair. No text is discarded.
  for (const point of text) {
    if (buf.length + point.length > max) {
      chunks.push(buf);
      buf = '';
    }
    buf += point;
  }
  if (buf) chunks.push(buf);
  return chunks;
}
