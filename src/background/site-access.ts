// Keep persistent registration and already-open documents in sync with explicit site grants.
const scriptId = 'allowed-sites';
const injection = { files: ['content/index.js'], world: 'ISOLATED' as const };
export async function activateTab(tabId: number) {
  // A cross-origin frame without permission must not prevent the main page from working.
  await chrome.scripting.executeScript({ ...injection, target: { tabId, frameIds: [0] } });
  await chrome.scripting
    .executeScript({ ...injection, target: { tabId, allFrames: true } })
    .catch(() => {});
}
let updating: Promise<{ activatedTabs: number }> = Promise.resolve({ activatedTabs: 0 });
export function registerSites() {
  const next = updating.catch(() => ({ activatedTabs: 0 })).then(synchronize);
  updating = next;
  return next;
}
async function synchronize() {
  const { sites = [] } = await chrome.storage.local.get<{ sites?: string[] }>('sites');
  const requested = [...new Set(sites)].filter((s) => /^https?:\/\//.test(s));
  const permissions = await Promise.all(
    requested.map(async (site) => ({
      site,
      allowed: await chrome.permissions.contains({ origins: [site] }),
    })),
  );
  const matches = permissions.filter((p) => p.allowed).map((p) => p.site);
  const registered =
    (await chrome.scripting.getRegisteredContentScripts({ ids: [scriptId] })).length > 0;
  if (!matches.length) {
    if (registered) await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
    return { activatedTabs: 0 };
  }
  const script: chrome.scripting.RegisteredContentScript = {
    id: scriptId,
    matches,
    js: injection.files,
    allFrames: true,
    persistAcrossSessions: true,
    runAt: 'document_idle',
    world: 'ISOLATED',
  };
  if (registered) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
  // Registration applies to future documents. Explicit injection covers existing tabs.
  const tabs = await chrome.tabs.query({ url: matches });
  const results = await Promise.allSettled(
    tabs.filter((t) => t.id !== undefined && !t.discarded).map((t) => activateTab(t.id!)),
  );
  return { activatedTabs: results.filter((r) => r.status === 'fulfilled').length };
}
