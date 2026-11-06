import type { Settings } from '../shared/types';
export { startPdfWatch, stopPdfWatch, stopAllPdfWatches } from '../native-pdf/debugger';
let creating: Promise<void> | undefined;
export function ensureHost(settings: () => Promise<Settings>) {
  if (creating) return creating;
  creating = (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      incognito: chrome.extension.inIncognitoContext,
    });
    if (!contexts.length) {
      await chrome.offscreen.createDocument({
        url: 'offscreen/index.html',
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: '端末内の翻訳推論Workerとモデル管理を所有するため',
      });
      const s = await settings();
      const { deviceProfiles = {} } = await chrome.storage.local.get('deviceProfiles');
      await hostCommand('configure', {
        memoryMode: s.memoryMode,
        backend: s.backend,
        profile: (deviceProfiles as Record<string, unknown>)[s.backend],
      });
    }
  })().finally(() => {
    creating = undefined;
  });
  return creating;
}
export const hostCommand = (action: string, extra: object = {}) =>
  chrome.runtime.sendMessage({ channel: 'host-command', action, ...extra });
export const openPanel = (tabId: number) => chrome.sidePanel.open({ tabId });
export async function initializeBrowser() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
}
