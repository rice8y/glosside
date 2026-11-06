import { registerSites } from './site-access';
import { currentSettings } from '../shared/settings';
import { validMetric } from '../shared/metrics';
import { errorCode } from '../shared/errors';
import {
  startPdfWatch,
  stopPdfWatch,
  stopAllPdfWatches,
  openPanel,
  initializeBrowser,
} from './browser';
import { pendingKey, trusted, settings, host } from './runtime';
import { ports, acceptPort, deliverHostEvent } from './connections';
import { handleUI } from './ui-actions';

chrome.runtime.onConnect.addListener(acceptPort);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.channel === 'metric') {
    if (
      validMetric(message.name, message.ms) &&
      (trusted(sender) || (sender.tab && /^https?:/.test(sender.url ?? '')))
    )
      void host('metric', { name: message.name, ms: message.ms });
    return;
  }
  if (message?.channel === 'native-pdf-watch') {
    if (!sender.tab?.id || sender.frameId !== 0 || !sender.documentId) return;
    void (async () => {
      if (message.action === 'stop') {
        await stopPdfWatch(sender.tab!.id!, sender.documentId, message.token);
        return { ok: true };
      }
      const config = await settings();
      if (message.action !== 'start' || !config.nativePdfPosition || config.panelOnly)
        return { ok: false };
      return startPdfWatch(sender, message.token, message.explicit === true);
    })()
      .then(reply)
      .catch(() => reply({ ok: false }));
    return true;
  }
  if (message?.channel === 'host-event') {
    if (sender.url !== chrome.runtime.getURL('offscreen/index.html')) return;
    deliverHostEvent(message);
    return;
  }
  if (message?.channel !== 'ui' || !trusted(sender)) return;
  void handleUI(message, sender)
    .then(reply)
    .catch((e) => reply({ ok: false, code: errorCode(e) }));
  return true;
});
chrome.permissions.onRemoved.addListener(() => {
  void stopAllPdfWatches();
  void registerSites();
  for (const [owner, p] of ports)
    if (!trusted(p.sender!)) {
      try {
        p.postMessage({ type: 'revoked' });
      } catch {}
      void host('disconnect', { owner });
      p.disconnect();
    }
});
chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await initializeBrowser();
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: 'translate-selection',
      title: '選択した文字列を翻訳',
      contexts: ['selection'],
    });
    const previous = await chrome.storage.local.get('settings');
    // Reinstalling an unpacked build can report "install" with existing storage.
    // Normalize every installation without resetting consent or reading preferences.
    await chrome.storage.local.set({ settings: currentSettings(previous.settings) });
    await navigator.storage
      .getDirectory()
      .then((root) => root.removeEntry('pdf-temp', { recursive: true }))
      .catch(() => {});
    if (details.reason === 'install' && previous.settings === undefined)
      await chrome.runtime.openOptionsPage();
    await registerSites();
  })();
});
// The action popup receives activeTab and activates the current document on open.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'translate-selection' || !tab?.id || !info.selectionText) return;
  // Start opening in the gesture's synchronous call stack, before persistence/model work.
  void openPanel(tab.id).catch(() => {});
  void chrome.storage.session
    .set({
      [pendingKey()]: {
        text: info.selectionText,
        expires: Date.now() + 120000,
        incognito: !!tab.incognito,
        id: crypto.randomUUID(),
      },
    })
    .then(() => {
      for (const p of ports.values()) if (trusted(p.sender!)) p.postMessage({ type: 'pending' });
    });
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'translate-selection' || !tab?.id) return;
  void openPanel(tab.id).catch(() => {});
  void chrome.tabs
    .sendMessage(tab.id, { channel: 'page-command', action: 'selection' })
    .catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [owner, p] of ports)
    if (p.sender?.tab?.id === tabId) {
      void host('disconnect', { owner });
      ports.delete(owner);
    }
});
chrome.runtime.onStartup.addListener(() => {
  void registerSites();
});
