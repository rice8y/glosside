import { ui } from '../shared/client';
import { t } from './locale';
import { el, button } from './dom';
const allOrigins = ['https://*/*', 'http://*/*'];

export function mountSiteAccess(reportError: (error: unknown) => void) {
  const toggle = document.getElementById('all-sites') as HTMLInputElement | null;
  const enable = document.getElementById('enable-all-sites') as HTMLButtonElement;
  const card = document.getElementById('access-onboarding')!;
  const state = document.getElementById('access-state')!;
  const message = document.getElementById('access-message')!;
  const list = document.getElementById('sites');
  const heading = document.getElementById('sites-heading');
  let busy = false,
    destroyed = false,
    revision = 0;
  async function refresh() {
    const version = ++revision;
    const { sites = [] } = await chrome.storage.local.get<{ sites?: string[] }>('sites');
    const checks = await Promise.all(
      sites.map(async (origin) => ({
        origin,
        allowed: await chrome.permissions.contains({ origins: [origin] }),
      })),
    );
    if (destroyed || version !== revision) return;
    const allowed = checks.filter((site) => site.allowed).map((site) => site.origin);
    const all = allOrigins.every((origin) => allowed.includes(origin));
    if (toggle) {
      toggle.checked = all;
      toggle.disabled = busy;
    }
    card.hidden = false;
    card.classList.toggle('access-enabled', all);
    enable.hidden = all;
    enable.disabled = busy;
    document.getElementById('access-intro')!.hidden = all;
    document.getElementById('access-alternative')!.hidden = all;
    state.textContent = all
      ? t('All websites enabled')
      : t('On websites you have not allowed, open Glosside from the toolbar before selecting text.');
    if (!list || !heading) return;
    const shown = all ? [] : allowed;
    list.hidden = heading.hidden = !shown.length;
    list.replaceChildren(
      ...shown.map((origin) => {
        const name =
          origin === 'https://*/*'
            ? t('HTTPS websites')
            : origin === 'http://*/*'
              ? t('HTTP websites')
              : origin.replace(/\/\*$/, '');
        const remove = button(t('Remove'), () =>
          run(async () => {
            if (!(await chrome.permissions.remove({ origins: [origin] }))) return;
            const latest = await chrome.storage.local.get<{ sites?: string[] }>('sites');
            await chrome.storage.local.set({
              sites: (latest.sites ?? []).filter((site) => site !== origin),
            });
            await ui('register-sites');
          }),
        );
        remove.disabled = busy;
        remove.setAttribute('aria-label', `${t('Remove')}: ${name}`);
        return el('div', { class: 'row' }, el('small', {}, name), remove);
      }),
    );
  }
  function run(operation: () => Promise<void>) {
    if (busy || destroyed) return;
    busy = true;
    if (toggle) toggle.disabled = true;
    enable.disabled = true;
    message.hidden = true;
    for (const control of list?.querySelectorAll('button') ?? []) control.disabled = true;
    // Start permission requests in the user gesture's synchronous call stack.
    void operation()
      .catch(reportError)
      .finally(async () => {
        busy = false;
        await refresh().catch(reportError);
      });
  }
  function setAll(enabled: boolean) {
    run(async () => {
      const granted = enabled
        ? await chrome.permissions.request({ origins: allOrigins })
        : await chrome.permissions.remove({ origins: allOrigins });
      if (!granted) {
        message.textContent = t(
          'Website access was not allowed. Click the extension toolbar icon to enable only the current tab.',
        );
        message.hidden = false;
        return;
      }
      const { sites = [] } = await chrome.storage.local.get<{ sites?: string[] }>('sites');
      await chrome.storage.local.set({
        sites: enabled
          ? [...new Set([...sites, ...allOrigins])]
          : sites.filter((origin) => !allOrigins.includes(origin)),
      });
      await ui('register-sites');
    });
  }
  if (toggle) toggle.onchange = () => setAll(toggle.checked);
  enable.onclick = () => setAll(true);
  const permissionChanged = () => {
    void refresh().catch(reportError);
  };
  const storageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes.sites) permissionChanged();
  };
  chrome.permissions.onAdded.addListener(permissionChanged);
  chrome.permissions.onRemoved.addListener(permissionChanged);
  chrome.storage.onChanged.addListener(storageChanged);
  return {
    refresh,
    destroy() {
      destroyed = true;
      revision++;
      if (toggle) toggle.onchange = null;
      enable.onclick = null;
      chrome.permissions.onAdded.removeListener(permissionChanged);
      chrome.permissions.onRemoved.removeListener(permissionChanged);
      chrome.storage.onChanged.removeListener(storageChanged);
    },
  };
}
