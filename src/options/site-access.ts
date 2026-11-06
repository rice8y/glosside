import { ui } from '../shared/client';
import { t } from '../ui/locale';
import { el, button } from '../ui/dom';
const allOrigins = ['https://*/*', 'http://*/*'];

export function mountSiteAccess(reportError: (error: unknown) => void) {
  const toggle = document.getElementById('all-sites') as HTMLInputElement;
  const list = document.getElementById('sites')!;
  const heading = document.getElementById('sites-heading')!;
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
    toggle.checked = all;
    toggle.disabled = busy;
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
    toggle.disabled = true;
    for (const control of list.querySelectorAll('button')) control.disabled = true;
    // Start permission requests in the user gesture's synchronous call stack.
    void operation()
      .catch(reportError)
      .finally(async () => {
        busy = false;
        await refresh().catch(reportError);
      });
  }
  toggle.onchange = () => {
    const enabled = toggle.checked;
    run(async () => {
      const granted = enabled
        ? await chrome.permissions.request({ origins: allOrigins })
        : await chrome.permissions.remove({ origins: allOrigins });
      if (!granted) return;
      const { sites = [] } = await chrome.storage.local.get<{ sites?: string[] }>('sites');
      await chrome.storage.local.set({
        sites: enabled
          ? [...new Set([...sites, ...allOrigins])]
          : sites.filter((origin) => !allOrigins.includes(origin)),
      });
      await ui('register-sites');
    });
  };
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
      toggle.onchange = null;
      chrome.permissions.onAdded.removeListener(permissionChanged);
      chrome.permissions.onRemoved.removeListener(permissionChanged);
      chrome.storage.onChanged.removeListener(storageChanged);
    },
  };
}
