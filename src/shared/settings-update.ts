import type { Settings, Glossary } from './types';
import { currentSettings, glossaryStateKey } from './settings';
import { language, checkText } from './protocol';
import { AppError } from './errors';

// Validate the complete result before storage or browser side effects.
export function updateSettings(
  previous: Settings,
  changes: Partial<Settings> = {},
  expectedGlossaries?: Glossary[],
): Settings {
  if (
    expectedGlossaries !== undefined &&
    glossaryStateKey({ glossaries: expectedGlossaries, activeGlossaryId: '' }) !==
      glossaryStateKey({ glossaries: previous.glossaries, activeGlossaryId: '' })
  )
    throw new AppError('GLOSSARY_CHANGED');
  const patch = { ...previous, ...changes };
  if (
    Array.isArray(changes?.glossaries) &&
    changes.activeGlossaryId === undefined &&
    !changes.glossaries.some((g) => g?.id === previous.activeGlossaryId)
  )
    patch.activeGlossaryId = '';
  const next = currentSettings(patch);
  if (
    !Array.isArray(next.glossaries) ||
    next.glossaries.length > 100 ||
    typeof next.activeGlossaryId !== 'string' ||
    (next.activeGlossaryId && !next.glossaries.some((g) => g?.id === next.activeGlossaryId))
  )
    throw new AppError('INVALID_REQUEST');
  const glossaryIds = new Set<string>();
  for (const glossary of next.glossaries) {
    if (
      !glossary ||
      typeof glossary.id !== 'string' ||
      !/^[\w-]{1,64}$/.test(glossary.id) ||
      glossaryIds.has(glossary.id) ||
      typeof glossary.name !== 'string' ||
      !glossary.name.trim() ||
      glossary.name.length > 100 ||
      typeof glossary.description !== 'string' ||
      glossary.description.length > 500 ||
      !Array.isArray(glossary.terms) ||
      glossary.terms.length > 100
    )
      throw new AppError('INVALID_REQUEST');
    glossaryIds.add(glossary.id);
    for (const term of glossary.terms) {
      checkText(term?.source, 200);
      checkText(term?.target, 200);
    }
  }
  if (
    !language(next.targetLanguage) ||
    (next.sourceLanguage && !language(next.sourceLanguage)) ||
    !['plain', 'polite'].includes(next.japaneseForm) ||
    !['Auto', 'Button', 'Shortcut'].includes(next.htmlMode) ||
    !['Auto', 'Button', 'Shortcut'].includes(next.pdfMode) ||
    !['economy', 'balanced', 'reading'].includes(next.memoryMode) ||
    !['auto', 'cpu'].includes(next.backend) ||
    !Array.isArray(next.glossary) ||
    next.glossary.length > 100
  )
    throw new AppError('INVALID_REQUEST');
  for (const term of next.glossary) {
    checkText(term.source, 200);
    checkText(term.target, 200);
  }
  for (const k of ['nativePdfPosition', 'panelOnly', 'includeNavigation', 'modelConsent'] as const)
    if (typeof next[k] !== 'boolean') throw new AppError('INVALID_REQUEST');
  return next;
}
