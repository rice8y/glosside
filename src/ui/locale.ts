import translations from './translations.json';
export type UiLocale = 'ja' | 'en';
export type MessageKey = keyof typeof translations;
export function resolveLocale(language: string): UiLocale {
  return /^ja(?:[-_]|$)/i.test(language) ? 'ja' : 'en';
}
function browserLanguage() {
  try {
    return chrome.i18n.getUILanguage();
  } catch {
    return navigator.language;
  }
}
export const locale = resolveLocale(browserLanguage());
export function t(
  key: MessageKey,
  values: Record<string, string | number> = {},
  language = locale,
) {
  const message = language === 'ja' ? translations[key] : key;
  return message.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
}
export function localizePage() {
  document.documentElement.lang = locale;
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]'))
    node.textContent = t(node.dataset.i18n as MessageKey);
  for (const attribute of ['title', 'aria-label', 'placeholder'])
    for (const node of document.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`))
      node.setAttribute(attribute, t(node.getAttribute(`data-i18n-${attribute}`) as MessageKey));
  // The same license is available in both supported languages.
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href$="plamo-en.txt"]'))
    if (locale === 'ja') link.href = link.href.replace('plamo-en.txt', 'plamo-ja.txt');
  document.documentElement.dataset.localized = 'true';
}
export function backendLabel(backend: string) {
  return backend === 'CPU 互換モード' ? t('CPU compatibility mode') : backend;
}
