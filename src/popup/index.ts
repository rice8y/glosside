import { Client, ui } from '../shared/client';
import { defaults, type Settings, type ModelState } from '../shared/types';
import {
  settingsModelLabel as modelLabel,
  explainSettingsError as explain,
} from '../options/messages';
import { localizePage, t, backendLabel } from '../ui/locale';
import { errorCode } from '../shared/errors';
import { deviceKey, runtimeConfig, type DeviceProfile } from '../inference/device-profile';

import { mountSiteAccess } from '../ui/site-access';

import { byId as $ } from '../ui/dom';

localizePage();
const client = new Client();
let current = { ...defaults };
let tab: {
  tabId?: number;
  supported?: boolean;
  pdf?: boolean;
  origin?: string;
  persistent?: boolean;
} = {};
let model: ModelState = { state: 'CHECKING' };
let optimizing = false;
let profiles: Partial<Record<Settings['backend'], DeviceProfile>> = {};
const pending = new Map<string, unknown>();
const controls = [
  ...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]'),
];
const showError = (text = '') => {
  $('error').textContent = text;
  $('error').hidden = !text;
};
const guard = (fn: () => Promise<unknown>) => {
  showError();
  void fn().catch((e) => {
    const code = errorCode(e);
    if (code === 'CANCELLED') return;
    showError(explain(code));
  });
};
function populate(s: Settings) {
  current = s;
  const glossarySelect = $<HTMLSelectElement>('activeGlossaryId');
  glossarySelect.replaceChildren(
    new Option(t('None'), ''),
    ...s.glossaries.map((g) => new Option(g.name, g.id)),
  );
  for (const control of controls) {
    const value = pending.has(control.id)
      ? pending.get(control.id)
      : s[control.id as keyof Settings];
    if (control instanceof HTMLInputElement) control.checked = value === true;
    else control.value = String(value);
    control.disabled = false;
  }
  $<HTMLSelectElement>('japaneseForm').disabled = s.targetLanguage !== 'ja';
  updateActions();
}
for (const control of controls) {
  control.disabled = true;
  control.addEventListener('change', () => {
    const value = control instanceof HTMLInputElement ? control.checked : control.value;
    pending.set(control.id, value);
    guard(async () => {
      try {
        await ui('save-settings', { settings: { [control.id]: value } });
      } finally {
        if (pending.get(control.id) === value) pending.delete(control.id);
        populate((await ui('settings')).settings);
      }
    });
  });
}
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
function selectTab(index: number) {
  tabs.forEach((button, i) => {
    button.setAttribute('aria-selected', String(index === i));
    button.tabIndex = index === i ? 0 : -1;
    $(button.getAttribute('aria-controls')!).hidden = index !== i;
  });
  document.querySelector('main')!.scrollTop = 0;
}
tabs.forEach((button, index) => {
  button.onclick = () => selectTab(index);
  button.onkeydown = (event) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : undefined;
    if (next !== undefined) {
      event.preventDefault();
      selectTab(next);
      tabs[next].focus();
    }
  };
});
function updateActions() {
  const ready =
    current.modelConsent &&
    ['READY_ON_DISK', 'LOADING', 'WARMING', 'READY', 'RUNNING', 'RECOVERING'].includes(model.state);
  $<HTMLButtonElement>('translate-page').disabled =
    !tab.supported || tab.pdf === true || !ready || current.panelOnly;
  $<HTMLButtonElement>('restore').disabled = !tab.supported || tab.pdf === true;
  $<HTMLButtonElement>('panel').disabled = tab.tabId === undefined;
  const tuning = optimizing || model.state === 'TUNING';
  $<HTMLSelectElement>('backend').disabled = tuning;
  $<HTMLButtonElement>('optimize').disabled = !ready || tuning;
  $('optimize').hidden = tuning;
  $('cancel-optimize').hidden = !tuning;
  $('setup').hidden = ready || tuning;
  $('optimization-progress').hidden = !tuning;
  const label = modelLabel(model);
  $('model-detail').hidden = tuning || !label;
  $('model-detail').textContent = label;
  const profile = profiles[current.backend];
  const config = runtimeConfig(profile, current.backend === 'cpu');
  const valid =
    profile &&
    profile.preference === current.backend &&
    profile.key === deviceKey(current.backend === 'cpu') &&
    profile.threads === config.threads &&
    profile.batch === config.batch;
  $('optimization-result').hidden = tuning || !valid;
  if (valid) {
    $('optimized-backend').textContent = backendLabel(profile.backend);
    $('optimized-threads').textContent = String(profile.threads);
    $('optimized-batch').textContent = String(profile.batch);
  }
  let reason = '';
  if (tab.supported === undefined) reason = t('Checking page access…');
  else if (!tab.supported) reason = t('Page translation is unavailable on this page.');
  else if (tab.pdf) reason = t('Select text in the PDF to translate it.');
  else if (current.panelOnly) {
    reason = t('Turn off “Show translations only in the side panel” to translate this page.');
  } else if (model.state === 'CHECKING') reason = t('Checking model…');
  else if (tuning) reason = t('Wait for processing optimization to finish.');
  else if (!ready) {
    reason = !current.modelConsent
      ? t('Model setup requires your consent in Settings.')
      : modelLabel(model);
  }
  $('translate-page').title = reason;
}
client.onSettings = populate;
client.onModel = (s) => {
  model = s;
  updateActions();
};
for (const id of ['options', 'setup'])
  $(id).onclick = () =>
    guard(async () => {
      await chrome.runtime.openOptionsPage();
      window.close();
    });
$('translator').onclick = () =>
  guard(async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('translate/index.html') });
    window.close();
  });
$('panel').onclick = () => {
  if (tab.tabId === undefined) return;
  // Call directly in the click stack; opening the panel requires a user gesture.
  const opening = chrome.sidePanel.open({ tabId: tab.tabId });
  guard(async () => {
    await opening;
    window.close();
  });
};
for (const [id, action] of [
  ['translate-page', 'page'],
  ['restore', 'restore'],
])
  $(id).onclick = () =>
    guard(async () => {
      await ui(action);
      window.close();
    });
$('allow-site').onclick = () => {
  if (!tab.origin) return;
  const origin = tab.origin;
  const permission = chrome.permissions.request({ origins: [origin + '/*'] });
  guard(async () => {
    if (!(await permission)) {
      showError(t('Website access was not allowed.'));
      return;
    }
    await ui('save-site', { origin });
    $('site-state').textContent = t('Enabled on this website');
    $('allow-site').hidden = true;
  });
};
for (const [id, command] of [
  ['unload', 'unload'],
  ['clear-cache', 'clear-cache'],
])
  $(id).onclick = () =>
    guard(async () => {
      await ui('model', { command });
    });
$('optimize').onclick = () =>
  guard(async () => {
    optimizing = true;
    updateActions();
    try {
      const { profile } = await ui('optimize');
      profiles[profile.preference as Settings['backend']] = profile;
    } finally {
      optimizing = false;
      updateActions();
      if (!$('optimization-result').hidden)
        $('optimization-result').scrollIntoView({ block: 'nearest' });
    }
  });
$('cancel-optimize').onclick = () =>
  guard(async () => {
    await ui('cancel-optimize');
  });
const siteAccess = mountSiteAccess((e) => showError(explain(errorCode(e))));
guard(() => siteAccess.refresh());
async function refreshTab() {
  tab = await ui('popup-context');
  $('site').hidden = !tab.supported;
  $('site-name').textContent = tab.origin ? new URL(tab.origin).hostname : '';
  $('site-state').textContent = tab.supported
    ? tab.pdf
      ? t('Text selection is available in the native PDF viewer')
      : tab.persistent
        ? t('Enabled on this website')
        : t('Enabled in this tab')
    : '';
  $('allow-site').hidden = !tab.supported || !!tab.persistent;
  updateActions();
}
guard(async () => {
  populate((await ui('settings')).settings);
  await refreshTab();
});
const permissionChanged = () => guard(refreshTab);
chrome.permissions.onAdded.addListener(permissionChanged);
chrome.permissions.onRemoved.addListener(permissionChanged);
addEventListener('pagehide', () => {
  client.close();
  siteAccess.destroy();
  chrome.permissions.onAdded.removeListener(permissionChanged);
  chrome.permissions.onRemoved.removeListener(permissionChanged);
});
const profileChanges = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
  if (area !== 'local' || !changes.deviceProfiles) return;
  profiles = (changes.deviceProfiles.newValue ?? {}) as typeof profiles;
  updateActions();
};
chrome.storage.onChanged.addListener(profileChanges);
addEventListener('pagehide', () => chrome.storage.onChanged.removeListener(profileChanges), {
  once: true,
});
guard(async () => {
  const stored = await chrome.storage.local.get('deviceProfiles');
  profiles = (stored.deviceProfiles ?? {}) as typeof profiles;
  updateActions();
});
