import { activateTab, registerSites } from './site-access';
import { stopAllPdfWatches } from './browser';
import { ports } from './connections';
import { host, settings, pendingKey } from './runtime';
import { updateSettings } from '../shared/settings-update';
import { AppError } from '../shared/errors';

let settingsWrite: Promise<unknown> = Promise.resolve();
let profileEpoch = 0;

// Serialize patches so concurrent settings/glossary editors cannot lose updates.
export function handleUI(message: Record<string, any>, sender: chrome.runtime.MessageSender) {
  return message.action === 'save-settings'
    ? (settingsWrite = settingsWrite.catch(() => {}).then(() => handleAction(message, sender)))
    : handleAction(message, sender);
}

async function handleAction(m: Record<string, any>, sender: chrome.runtime.MessageSender) {
  switch (m.action) {
    case 'popup-context': {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id || !/^https?:/.test(tab.url ?? ''))
        return { ok: true, tabId: tab?.id, supported: false };
      try {
        await activateTab(tab.id);
        await chrome.tabs.sendMessage(tab.id, { channel: 'page-command', action: 'activate-tab' });
        const [info] = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          func: () => document.contentType,
        });
        const origin = new URL(tab.url!).origin;
        const persistent = await chrome.permissions.contains({ origins: [origin + '/*'] });
        return {
          ok: true,
          tabId: tab.id,
          origin,
          persistent,
          supported: true,
          pdf: info?.result === 'application/pdf',
        };
      } catch {
        return { ok: true, tabId: tab.id, supported: false };
      }
    }
    case 'save-site': {
      if (typeof m.origin !== 'string') throw new AppError('INVALID_REQUEST');
      const url = new URL(m.origin);
      if (!/^https?:$/.test(url.protocol) || url.origin !== m.origin)
        throw new AppError('INVALID_REQUEST');
      const pattern = url.origin + '/*';
      if (!(await chrome.permissions.contains({ origins: [pattern] })))
        throw new AppError('PERMISSION_REQUIRED');
      const { sites = [] } = await chrome.storage.local.get<{ sites: string[] }>('sites');
      await chrome.storage.local.set({ sites: [...new Set([...sites, pattern])] });
      await registerSites();
      return { ok: true };
    }
    case 'diagnostics':
      return {
        ...(await host('diagnostics')),
        ...(await chrome.storage.local.get('deviceProfiles')),
      };
    case 'optimize': {
      await settingsWrite.catch(() => {});
      if (!(await settings()).modelConsent) throw new AppError('PERMISSION_REQUIRED');
      const epoch = profileEpoch;
      const result = await host('optimize');
      if (epoch !== profileEpoch) throw new AppError('CANCELLED');
      const { deviceProfiles = {} } = await chrome.storage.local.get('deviceProfiles');
      if (epoch !== profileEpoch) throw new AppError('CANCELLED');
      (deviceProfiles as Record<string, unknown>)[result.profile.preference] = result.profile;
      await chrome.storage.local.set({ deviceProfiles });
      const config = await settings();
      if (epoch !== profileEpoch) throw new AppError('CANCELLED');
      await host('configure', {
        memoryMode: config.memoryMode,
        backend: config.backend,
        profile: (deviceProfiles as Record<string, unknown>)[config.backend],
      });
      return result;
    }
    case 'cancel-optimize':
      return host('cancel-optimize');
    case 'reset-device-profile': {
      profileEpoch++;
      await host('cancel-optimize');
      await chrome.storage.local.remove('deviceProfiles');
      const config = await settings();
      await host('configure', { memoryMode: config.memoryMode, backend: config.backend });
      return { ok: true };
    }
    case 'settings':
      return { ok: true, settings: await settings() };
    case 'save-settings': {
      const previous = await settings();
      const next = updateSettings(previous, m.settings, m.expectedGlossaries);
      await chrome.storage.local.set({ settings: next });
      if (!next.nativePdfPosition || next.panelOnly) await stopAllPdfWatches();
      for (const p of ports.values()) {
        try {
          p.postMessage({ type: 'settings', settings: next });
        } catch {}
      }
      const { deviceProfiles = {} } = await chrome.storage.local.get('deviceProfiles');
      await host('configure', {
        memoryMode: next.memoryMode,
        backend: next.backend,
        profile: (deviceProfiles as Record<string, unknown>)[next.backend],
      });
      return { ok: true };
    }
    case 'model': {
      if (
        !['download', 'pause-download', 'delete-model', 'state', 'unload', 'clear-cache'].includes(
          m.command,
        )
      )
        throw new AppError('INVALID_REQUEST');
      if (m.command === 'download' && !(await settings()).modelConsent)
        throw new AppError('PERMISSION_REQUIRED');
      return host(m.command);
    }
    case 'pending': {
      const stored = await chrome.storage.session.get(pendingKey());
      const pending = stored[pendingKey()] as
        { expires: number; incognito: boolean; text: string; id: string } | undefined;
      return {
        ok: true,
        pending:
          pending &&
          pending.expires > Date.now() &&
          pending.incognito === !!(sender.tab?.incognito ?? chrome.extension.inIncognitoContext)
            ? pending
            : undefined,
      };
    }
    case 'clear-pending':
      await chrome.storage.session.remove(pendingKey());
      return { ok: true };
    case 'register-sites':
      return { ok: true, ...(await registerSites()) };
    case 'activate-tab':
    case 'page':
    case 'restore':
    case 'selection': {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) throw new AppError('UNSUPPORTED_SURFACE');
      try {
        await activateTab(tab.id);
      } catch {
        throw new AppError('UNSUPPORTED_SURFACE');
      }
      await chrome.tabs.sendMessage(tab.id, { channel: 'page-command', action: m.action });
      return { ok: true };
    }
    case 'open-options':
      await chrome.runtime.openOptionsPage();
      return { ok: true };
  }
}
