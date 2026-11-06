export type Surface = 'html' | 'native-selection';
export type Mode = 'selection' | 'paragraph' | 'page';
export type Trigger = 'Auto' | 'Button' | 'Shortcut';
export interface TextEdit {
  startUtf16: number;
  endUtf16: number;
  replacement: string;
  reason: 'line-wrap' | 'soft-hyphen' | 'word-hyphen';
}
export interface Request {
  protocolVersion: 1;
  requestId: string;
  sessionId: string;
  documentEpoch: string;
  selectionVersion: number;
  surface: Surface;
  mode: Mode;
  extractedText: string;
  translationText: string;
  textEdits?: TextEdit[];
  targetLanguage: string;
  sourceLanguage?: string;
  context?: string;
  japaneseForm?: 'plain' | 'polite';
  glossary?: { source: string; target: string }[];
  sourceContentHash: string;
  priority: number;
  pinned?: boolean;
}
export interface TranslationEvent {
  type: 'accepted' | 'status' | 'snapshot' | 'complete' | 'incomplete' | 'error';
  requestId: string;
  sequence: number;
  text?: string;
  state?: string;
  code?: string;
  reason?: string;
  warnings?: string[];
}
export interface ModelState {
  state: string;
  received?: number;
  total?: number;
  backend?: string;
  code?: string;
}
export interface Glossary {
  id: string;
  name: string;
  description: string;
  terms: { source: string; target: string }[];
}
export interface Settings {
  targetLanguage: string;
  sourceLanguage: string;
  japaneseForm: 'plain' | 'polite';
  htmlMode: Trigger;
  pdfMode: Trigger;
  nativePdfPosition: boolean;
  panelOnly: boolean;
  includeNavigation: boolean;
  backend: 'auto' | 'cpu';
  memoryMode: 'economy' | 'balanced' | 'reading';
  glossary: { source: string; target: string }[];
  glossaries: Glossary[];
  activeGlossaryId: string;
  modelConsent: boolean;
}
export const defaults: Settings = {
  targetLanguage: 'ja',
  sourceLanguage: '',
  japaneseForm: 'polite',
  htmlMode: 'Button',
  pdfMode: 'Button',
  nativePdfPosition: true,
  panelOnly: false,
  includeNavigation: false,
  backend: 'auto',
  memoryMode: 'balanced',
  glossary: [],
  glossaries: [],
  activeGlossaryId: '',
  modelConsent: false,
};
export const terminal = (e: TranslationEvent) =>
  ['complete', 'incomplete', 'error'].includes(e.type);
