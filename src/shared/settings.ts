import { defaults, type Settings } from './types';

export function glossaryStateKey(state: Pick<Settings, 'glossaries' | 'activeGlossaryId'>) {
  return JSON.stringify([
    state.activeGlossaryId,
    state.glossaries.map((g) => [
      g.id,
      g.name,
      g.description,
      g.terms.map((t) => [t.source, t.target]),
    ]),
  ]);
}

// Keep only settings supported by this build when loading or saving older profiles.
export function currentSettings(stored: unknown): Settings {
  const values = stored && typeof stored === 'object' ? (stored as Partial<Settings>) : {};
  const settings = Object.fromEntries(
    (Object.keys(defaults) as (keyof Settings)[]).map((key) => [
      key,
      values[key] === undefined ? defaults[key] : values[key],
    ]),
  ) as unknown as Settings;
  if (values.glossaries === undefined && Array.isArray(values.glossary) && values.glossary.length) {
    settings.glossaries = [
      { id: 'legacy', name: '用語集', description: '', terms: values.glossary },
    ];
    settings.activeGlossaryId = 'legacy';
  }
  settings.glossary = Array.isArray(settings.glossaries)
    ? (settings.glossaries.find((g) => g?.id === settings.activeGlossaryId)?.terms ?? [])
    : [];
  return settings;
}
