import type { Settings } from '../shared/types';
import { currentSettings } from '../shared/settings';
import { AppError } from '../shared/errors';
import { ensureHost, hostCommand } from './browser';
export const pendingKey = () =>
  chrome.extension.inIncognitoContext ? 'pending-private' : 'pending-normal';

const trustedPaths = [
  'sidepanel/index.html',
  'options/index.html',
  'popup/index.html',
  'glossary/index.html',
];
export const trusted = (s: chrome.runtime.MessageSender) =>
  s.id === chrome.runtime.id &&
  trustedPaths.some((p) => s.url?.split('?')[0] === chrome.runtime.getURL(p));
export async function settings(): Promise<Settings> {
  const v = await chrome.storage.local.get('settings');
  return currentSettings(v.settings);
}
export async function host(action: string, extra: object = {}) {
  await ensureHost(settings);
  const result = await hostCommand(action, extra);
  if (result?.ok === false) throw new AppError(result.code);
  return result;
}
