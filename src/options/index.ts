import { localizePage, t, backendLabel } from '../ui/locale';
import { Client, ui } from '../shared/client';
import { defaults, type Settings, type ModelState } from '../shared/types';
import { MODEL, MODEL_ORIGINS } from '../inference/catalog';
import { settingsModelLabel, explainSettingsError } from './messages';
import { errorCode } from '../shared/errors';
import { status, download, byId as $ } from '../ui/dom';
import { mountSiteAccess } from '../ui/site-access';
localizePage();
const client = new Client();
let current: Settings = { ...defaults },
  model: ModelState = { state: 'ABSENT' };
const guard = (fn: () => Promise<unknown>) =>
  void fn().catch((e) => status(explainSettingsError(errorCode(e))));
function populate(s: Settings) {
  current = s;
  for (const key of [
    'targetLanguage',
    'sourceLanguage',
    'japaneseForm',
    'htmlMode',
    'pdfMode',
    'memoryMode',
    'backend',
  ] as const)
    $<HTMLSelectElement>(key).value = s[key];
  for (const key of ['nativePdfPosition', 'panelOnly', 'includeNavigation'] as const)
    $<HTMLInputElement>(key).checked = s[key];
  $<HTMLInputElement>('consent').checked = s.modelConsent;
}
client.onSettings = populate;
client.onModel = (s) => {
  model = s;
  const label = settingsModelLabel(s);
  $('model-state').textContent = label;
  $('model-state').hidden = !label;
  $('model-download').hidden = [
    'READY_ON_DISK',
    'LOADING',
    'WARMING',
    'READY',
    'RUNNING',
    'TUNING',
    'RECOVERING',
    'UNLOADING',
  ].includes(s.state);
  $('pause').hidden = s.state !== 'DOWNLOADING';
  $('progress').hidden = !['DOWNLOADING', 'VERIFYING'].includes(s.state);
  $('download').textContent = ['PAUSED', 'FAILED'].includes(s.state)
    ? t('Resume download')
    : t('Download model');
  $<HTMLButtonElement>('download').disabled = ['DOWNLOADING', 'VERIFYING'].includes(s.state);
  $<HTMLProgressElement>('progress').value =
    s.received ?? (s.state === 'READY_ON_DISK' || s.state === 'READY' ? MODEL.bytes : 0);
};
function values(): Settings {
  const s = { ...current };
  for (const key of [
    'targetLanguage',
    'sourceLanguage',
    'japaneseForm',
    'htmlMode',
    'pdfMode',
    'memoryMode',
    'backend',
  ] as const)
    (s as any)[key] = $<HTMLSelectElement>(key).value;
  for (const key of ['nativePdfPosition', 'panelOnly', 'includeNavigation'] as const)
    s[key] = $<HTMLInputElement>(key).checked;
  s.modelConsent = $<HTMLInputElement>('consent').checked;
  return s;
}
$('save').onclick = () =>
  guard(async () => {
    const {
      glossary: _glossary,
      glossaries: _glossaries,
      activeGlossaryId: _active,
      ...next
    } = values();
    await ui('save-settings', { settings: next });
    status(t('Changes saved.'));
  });
$('download').onclick = () => {
  if (!$<HTMLInputElement>('consent').checked) {
    status(
      t('Read the license and privacy policy, then check the consent box before downloading.'),
    );
    return;
  }
  // Permission request starts directly from this click, before any storage awaits.
  const request = chrome.permissions.request({ origins: MODEL_ORIGINS });
  guard(async () => {
    if (!(await request)) {
      status(t('Access to the model download hosts was not allowed.'));
      return;
    }
    await ui('save-settings', { settings: { modelConsent: true } });
    await ui('model', { command: 'download' });
  });
};
for (const [id, command] of [
  ['pause', 'pause-download'],
  ['unload', 'unload'],
  ['clear-cache', 'clear-cache'],
])
  $(id).onclick = () =>
    guard(async () => {
      await ui('model', { command });
      status(
        command === 'unload'
          ? t('Model memory released.')
          : command === 'pause-download'
            ? t('Download paused.')
            : t('Translation cache cleared.'),
      );
    });
$('delete-model').onclick = () =>
  guard(async () => {
    if (!confirm(t('Delete the model? You will need to download it again to translate.'))) return;
    await ui('model', { command: 'delete-model' });
    status(t('Model deleted.'));
  });
const siteAccess = mountSiteAccess((e) => status(explainSettingsError(errorCode(e))));
$('reset').onclick = () =>
  guard(async () => {
    if (
      !confirm(
        t(
          'Reset settings and delete all glossaries? The downloaded model and website permissions will be kept.',
        ),
      )
    )
      return;
    await ui('reset-device-profile');
    await ui('save-settings', { settings: defaults });
    status(t('Settings reset.'));
  });
$('diagnostics').onclick = () =>
  guard(async () => {
    const diagnostics = await ui('diagnostics');
    download(
      new Blob(
        [
          JSON.stringify(
            {
              version: chrome.runtime.getManifest().version,
              runtime: MODEL.runtime,
              model: MODEL.sha256,
              state: model.state,
              errorCode: model.code,
              backend: model.backend ?? 'Not measured',
              crossOriginIsolated,
              hardwareConcurrency: navigator.hardwareConcurrency,
              generatedAt: new Date().toISOString(),
              performance: diagnostics.performance,
              deviceProfiles: diagnostics.deviceProfiles,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
      'glosside-diagnostics.json',
    );
  });
$('optimize').onclick = () =>
  guard(async () => {
    $<HTMLButtonElement>('optimize').disabled = true;
    $('cancel-optimize').hidden = false;
    $('optimization-status').textContent = t(
      'Measuring with built-in sample text. Page text is not used. New translations interrupt the measurement.',
    );
    try {
      const { profile } = await ui('optimize');
      const reduction = Math.round((1 - profile.selectedMs / profile.baselineMs) * 100);
      $('optimization-status').textContent =
        reduction > 0
          ? t('Saved for this device. Sample latency decreased by {reduction}% ({backend}).', {
              reduction,
              backend: backendLabel(profile.backend),
            })
          : t('The default settings were fastest within measurement tolerance. Kept the defaults.');
    } catch (e) {
      $('optimization-status').textContent = t(
        'Measurement did not finish. Existing processing settings were kept.',
      );
      throw e;
    } finally {
      $<HTMLButtonElement>('optimize').disabled = false;
      $('cancel-optimize').hidden = true;
    }
  });
$('cancel-optimize').onclick = () =>
  guard(async () => {
    await ui('cancel-optimize');
    status(t('Measurement cancelled.'));
  });
guard(async () => {
  populate((await ui('settings')).settings);
  await siteAccess.refresh();
});
addEventListener('pagehide', () => {
  client.close();
  siteAccess.destroy();
});
