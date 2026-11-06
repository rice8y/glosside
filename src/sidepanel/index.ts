import { translationStatus } from '../ui/translation-status';
import { Client, ui } from '../shared/client';
import { makeRequest } from '../shared/protocol';
import { explain, errorCode } from '../shared/errors';
import { terminal, type TranslationEvent } from '../shared/types';
import { copy, download, status, byId as $ } from '../ui/dom';
import { modelLabel } from '../ui/model-label';
const source = $<HTMLTextAreaElement>('source'),
  output = $('result'),
  client = new Client();
let active = '',
  version = 0,
  lastPending = '',
  finished = false;
const guard = (fn: () => Promise<unknown>) => void fn().catch((e) => status(explain(errorCode(e))));
client.onSettings = (s) => {
  if (!document.hidden) client.prepare();
  $<HTMLSelectElement>('target-lang').value = s.targetLanguage;
  $<HTMLSelectElement>('source-lang').value = s.sourceLanguage;
};
client.onModel = (s) => {
  $('model').textContent = modelLabel(s);
};
function reset() {
  version++;
  if (active) client.cancel(active);
  active = '';
  $<HTMLButtonElement>('cancel').hidden = true;
  $<HTMLButtonElement>('translate').disabled = false;
}
source.addEventListener('input', () => {
  $('count').textContent = `${source.value.length.toLocaleString()} / 16,000文字`;
  reset();
  status('');
  output.textContent = '';
  $<HTMLButtonElement>('copy').disabled = true;
  $<HTMLButtonElement>('export').disabled = true;
  finished = false;
});
async function translate() {
  reset();
  const v = version;
  const text = source.value;
  if (!text.trim()) {
    status('翻訳する文章を入力してください。');
    return;
  }
  const settings = {
    ...client.settings,
    targetLanguage: $<HTMLSelectElement>('target-lang').value,
    sourceLanguage: $<HTMLSelectElement>('source-lang').value,
  };
  output.textContent = '';
  finished = false;
  $<HTMLButtonElement>('copy').disabled = true;
  $<HTMLButtonElement>('export').disabled = true;
  status('処理待ち');
  const r = await makeRequest(text, settings, { sessionId: client.id });
  if (v !== version) return;
  active = r.requestId;
  $<HTMLButtonElement>('translate').disabled = true;
  $<HTMLButtonElement>('cancel').hidden = false;
  client.translate(r, (e: TranslationEvent) => {
    if (v !== version) return;
    if (e.text !== undefined) output.textContent = e.text;
    status(translationStatus(e));
    if (e.warnings?.length) status('要確認：' + e.warnings.join(' '));
    if (terminal(e)) {
      active = '';
      $<HTMLButtonElement>('translate').disabled = false;
      $<HTMLButtonElement>('cancel').hidden = true;
      finished = e.type === 'complete';
    }
    $<HTMLButtonElement>('copy').disabled = !output.textContent;
    $<HTMLButtonElement>('export').disabled = !output.textContent;
  });
}
$('translate').onclick = () => guard(translate);
$('cancel').onclick = () => {
  reset();
  status('翻訳を中止しました。');
};
$('clear').onclick = () => {
  reset();
  source.value = '';
  output.textContent = '';
  $('count').textContent = '0 / 16,000文字';
  status('消去しました。');
  $<HTMLButtonElement>('copy').disabled = true;
  $<HTMLButtonElement>('export').disabled = true;
};
$('copy').onclick = () =>
  guard(async () => {
    await copy(output.textContent ?? '');
    status('コピーしました。');
  });
$('export').onclick = () =>
  download(
    new Blob(
      [
        `Built with PLaMo.\n${finished ? '翻訳完了' : '未完了の訳文'}\n\n原文\n${source.value}\n\n訳文\n${output.textContent}`,
      ],
      { type: 'text/plain;charset=utf-8' },
    ),
    'translation.txt',
  );
for (const [id, action] of [
  ['settings', 'open-options'],
  ['activate', 'activate-tab'],
  ['page', 'page'],
  ['restore', 'restore'],
])
  $(id).onclick = () =>
    guard(async () => {
      await ui(action);
    });
$('site').onclick = () =>
  guard(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url || !/^https?:/.test(tab.url)) {
      status(explain('UNSUPPORTED_SURFACE'));
      return;
    }
    const origin = new URL(tab.url).origin + '/*';
    if (!(await chrome.permissions.request({ origins: [origin] }))) {
      status('サイトへのアクセスは許可されませんでした。');
      return;
    }
    const { sites = [] } = await chrome.storage.local.get<{ sites?: string[] }>('sites');
    await chrome.storage.local.set({ sites: [...new Set([...sites, origin])] });
    await ui('register-sites');
    await ui('activate-tab');
    status('このサイトで常に使えるようになりました。');
  });
async function pending() {
  const { pending } = await ui('pending');
  if (!pending || pending.id === lastPending) return;
  lastPending = pending.id;
  reset();
  source.value = pending.text;
  $('count').textContent = `${source.value.length.toLocaleString()} / 16,000文字`;
  await ui('clear-pending');
  await translate();
}
client.onPending = () => guard(pending);
guard(pending);
addEventListener('pagehide', () => client.close());
