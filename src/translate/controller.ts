import { Client } from '../shared/client';
import { checkText, makeRequest } from '../shared/protocol';
import { errorCode } from '../shared/errors';
import { terminal, type ModelState, type Settings, type TranslationEvent } from '../shared/types';
import { copy, download } from '../ui/dom';
import { t, type MessageKey } from '../ui/locale';
import { explainSettingsError as explain, settingsModelLabel } from '../options/messages';

import { shareTools } from '../ui/share-tools';

export interface TextDraft {
  source: string;
  output: string;
  complete: boolean;
  interrupted: boolean;
  fields: Record<string, string>;
  configuration: string;
}
export const popupDraftKey = () =>
  'popupTextDraft:' + (chrome.extension.inIncognitoContext ? 'private' : 'normal');
export function mountTextTranslator(
  root: ParentNode = document,
  draft?: { read: string; write?: string },
) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const source = $<HTMLTextAreaElement>('source');
  const output = $('result');
  const select = (id: string) => $<HTMLSelectElement>(id);
  const button = (id: string) => $<HTMLButtonElement>(id);
  const languages: [string, MessageKey][] = [
    ['en', 'English'],
    ['ja', 'Japanese'],
    ['zh-hans', 'Chinese (Simplified)'],
    ['ko', 'Korean'],
    ['fr', 'French'],
    ['de', 'German'],
    ['es', 'Spanish'],
  ];
  for (const id of ['source-lang', 'target-lang']) {
    if (id === 'source-lang') select(id).add(new Option(t('Detect automatically'), ''));
    for (const [value, label] of languages) select(id).add(new Option(t(label), value));
  }
  const client = new Client();
  let ready = false;
  let closed = false;
  let busy = false;
  let swapping = false;
  let pastePending = false;
  let complete = false;
  let active = '';
  let version = 0;
  let configuration = '';
  let hydrated = !draft;
  let touched = false;
  let saved = '';
  let saving: Promise<void> = Promise.resolve();
  function snapshot(): TextDraft {
    return {
      source: source.value,
      output: busy ? '' : (output.textContent ?? ''),
      complete: complete && !busy,
      interrupted: busy,
      fields: Object.fromEntries(Object.keys(fields).map((id) => [id, select(id).value])),
      configuration,
    };
  }
  function persist() {
    if (!draft?.write || !hydrated || !ready || closed) return saving;
    const value = snapshot(),
      serialized = JSON.stringify(value);
    if (serialized === saved) return saving;
    saved = serialized;
    const key = draft.write;
    saving = saving
      .catch(() => {})
      .then(() =>
        value.source || value.output
          ? chrome.storage.session.set({ [key]: value })
          : chrome.storage.session.remove(key),
      );
    void saving.catch(() => {
      saved = '';
    });
    return saving;
  }

  function configurationKey() {
    const s = settings();
    return JSON.stringify([s.sourceLanguage, s.targetLanguage, s.japaneseForm, s.glossary]);
  }
  let model: ModelState = { state: 'CHECKING' };
  const sharing = shareTools(() => ({ text: output.textContent ?? '', complete }));
  $('share-container').append(sharing.element);
  const local = new Set<string>();
  const fields = {
    'source-lang': 'sourceLanguage',
    'target-lang': 'targetLanguage',
    'japanese-form': 'japaneseForm',
    glossary: 'activeGlossaryId',
  } as const;
  function settings(): Settings {
    return {
      ...client.settings,
      sourceLanguage: select('source-lang').value,
      targetLanguage: select('target-lang').value,
      japaneseForm: select('japanese-form').value as Settings['japaneseForm'],
      glossary:
        client.settings.glossaries.find((g) => g.id === select('glossary').value)?.terms ?? [],
    };
  }
  function message(text = '', error = false) {
    $('status').textContent = text;
    $('status').dataset.error = String(error);
  }
  function modelReady() {
    return (
      ready &&
      hydrated &&
      !closed &&
      client.settings.modelConsent &&
      ['READY_ON_DISK', 'LOADING', 'WARMING', 'READY', 'RUNNING', 'RECOVERING'].includes(
        model.state,
      )
    );
  }
  function update() {
    sharing.update();
    void persist();
    const length = source.value.length;
    $('count').textContent = t('{count} / 16,000 characters', { count: length.toLocaleString() });
    $('count').dataset.error = String(length > 16000);
    source.setAttribute('aria-invalid', String(length > 16000));
    $('result-count').textContent = output.textContent
      ? t('{count} characters', { count: output.textContent.length.toLocaleString() })
      : '';
    const placeholder = $('placeholder');
    if (placeholder) placeholder.hidden = !!output.textContent || busy;
    output.setAttribute('aria-busy', String(busy));
    button('translate').hidden = busy;
    button('translate').disabled = !modelReady() || !source.value.trim() || length > 16000;
    button('cancel').hidden = !busy;
    button('clear').disabled = !length && !output.textContent;
    button('copy').disabled = !output.textContent;
    button('export').disabled = !output.textContent;
    button('swap').disabled =
      !ready ||
      closed ||
      busy ||
      swapping ||
      (!select('source-lang').value && !source.value.trim()) ||
      (complete && (output.textContent?.length ?? 0) > 16000);
    button('swap').title = t('Swap source and translation');
    $('style-field').hidden = select('target-lang').value !== 'ja';
    for (const id of Object.keys(fields)) select(id).disabled = !ready || closed;
    const needsModel = ready && !modelReady();
    $('model-notice').hidden = !needsModel;
    $('model-message').textContent = closed
      ? explain('HOST_INTERRUPTED')
      : !client.settings.modelConsent
        ? t('Download the model in Settings to start translating.')
        : settingsModelLabel(model);
    if (pastePending && ready && hydrated && model.state !== 'CHECKING') {
      pastePending = false;
      void translate();
    }
  }
  function cancel() {
    version++;
    pastePending = false;
    if (active) client.cancel(active);
    active = '';
    busy = false;
    complete = false;
  }
  function invalidate(fromPaste = false) {
    touched = true;
    cancel();
    pastePending = fromPaste && !!source.value.trim();
    output.textContent = '';
    configuration = configurationKey();
    message();
    update();
  }
  let loadingDraft = false;
  async function restoreDraft() {
    if (!draft || hydrated || loadingDraft || !ready) return;
    loadingDraft = true;
    try {
      const value: unknown = (await chrome.storage.session.get(draft.read))[draft.read];
      if (touched || closed || !value || typeof value !== 'object') return;
      const d = value as TextDraft;
      if (
        typeof d.source !== 'string' ||
        d.source.length > 1_000_000 ||
        typeof d.output !== 'string' ||
        d.output.length > 256_000 ||
        !d.fields ||
        typeof d.fields !== 'object' ||
        typeof d.complete !== 'boolean' ||
        typeof d.interrupted !== 'boolean' ||
        typeof d.configuration !== 'string'
      )
        return;
      source.value = d.source;
      for (const id of Object.keys(fields)) {
        const value = d.fields[id];
        if (
          typeof value === 'string' &&
          [...select(id).options].some((option) => option.value === value)
        ) {
          select(id).value = value;
          local.add(id);
        }
      }
      configuration = configurationKey();
      if (d.configuration === configuration) {
        output.textContent = d.output;
        complete = d.complete;
        if (d.output || d.interrupted)
          message(
            t(
              d.complete
                ? 'Translation complete'
                : 'Translation stopped. The displayed text is incomplete.',
            ),
          );
      }
    } catch {
      // Session storage is a convenience; an unavailable draft must not disable translation.
    } finally {
      hydrated = true;
      if (!closed) update();
    }
  }
  client.onSettings = (s) => {
    const before = ready ? configuration : '';
    const glossary = local.has('glossary') ? select('glossary').value : s.activeGlossaryId;
    select('glossary').replaceChildren(new Option(t('No glossary'), ''));
    for (const g of s.glossaries) select('glossary').add(new Option(g.name, g.id));
    select('glossary').value = s.glossaries.some((g) => g.id === glossary) ? glossary : '';
    for (const [id, key] of Object.entries(fields)) {
      if (id === 'glossary' || local.has(id)) continue;
      const value = String(s[key as keyof Settings]);
      // Preserve languages configured in an older profile, even if not in the short list.
      if (![...select(id).options].some((option) => option.value === value))
        select(id).add(new Option(value, value));
      select(id).value = value;
    }
    ready = true;
    configuration = configurationKey();
    if (before && before !== configuration) invalidate();
    if (!s.modelConsent && busy) invalidate();
    update();
    if (!document.hidden) client.prepare();
    void restoreDraft();
  };
  client.onModel = (state) => {
    model = state;
    update();
  };
  client.onRevoked = () => {
    cancel();
    closed = true;
    message(explain('HOST_INTERRUPTED'), true);
    update();
  };
  for (const id of Object.keys(fields))
    select(id).onchange = () => {
      local.add(id);
      invalidate();
    };
  source.oninput = (event) => invalidate(event.inputType === 'insertFromPaste');

  function eventStatus(event: TranslationEvent) {
    switch (event.type) {
      case 'complete':
        return t('Translation complete');
      case 'incomplete':
        return event.reason === 'output-limit'
          ? explain('OUTPUT_LIMIT')
          : t('Translation stopped. The displayed text is incomplete.');
      case 'error':
        return explain(event.code ?? 'HOST_INTERRUPTED');
      case 'accepted':
        return t('Waiting to translate…');
      default:
        return t('Translating…');
    }
  }
  async function translate() {
    if (busy || !modelReady() || !source.value.trim()) return;
    cancel();
    const v = version;
    try {
      checkText(source.value);
      const config = settings();
      busy = true;
      output.textContent = '';
      message(t('Waiting to translate…'));
      update();
      const request = await makeRequest(source.value, config, { sessionId: client.id });
      if (v !== version) return;
      active = request.requestId;
      client.translate(request, (event) => {
        if (v !== version) return;
        if (event.text !== undefined) output.textContent = event.text;
        message(eventStatus(event), event.type === 'error' || event.type === 'incomplete');
        if (event.warnings?.length)
          message(eventStatus(event) + ' · ' + event.warnings.join(' '), true);
        if (terminal(event)) {
          active = '';
          busy = false;
          complete = event.type === 'complete';
        }
        update();
      });
    } catch (error) {
      if (v !== version) return;
      busy = false;
      message(explain(errorCode(error)), true);
      update();
    }
  }
  button('translate').onclick = () => void translate();
  source.onkeydown = (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
      event.preventDefault();
      void translate();
    }
  };
  button('cancel').onclick = () => {
    cancel();
    message(t('Translation stopped. The displayed text is incomplete.'));
    update();
    source.focus();
  };
  button('clear').onclick = () => {
    source.value = '';
    invalidate();
    source.focus();
  };
  button('swap').onclick = () => void swap();
  async function swap() {
    if (button('swap').disabled) return;
    let from = select('source-lang').value;
    const to = select('target-lang').value;
    const v = version;
    if (!from) {
      swapping = true;
      update();
      try {
        const detection = await chrome.i18n.detectLanguage(source.value);
        if (v !== version || closed) return;
        const candidate = detection.languages[0];
        if (
          detection.isReliable &&
          candidate?.percentage >= 70 &&
          languages.some(([code]) => code === candidate.language)
        )
          from = candidate.language;
        if (!from) {
          message(t('Choose a source language to swap'), true);
          select('source-lang').focus();
          return;
        }
      } catch {
        if (v === version && !closed) message(t('Choose a source language to swap'), true);
        return;
      } finally {
        swapping = false;
        if (!closed) update();
      }
    }
    if (![...select('source-lang').options].some((option) => option.value === to))
      select('source-lang').add(new Option(to, to));
    if (![...select('target-lang').options].some((option) => option.value === from))
      select('target-lang').add(new Option(from, from));
    select('source-lang').value = to;
    select('target-lang').value = from;
    local.add('source-lang');
    local.add('target-lang');
    const original = source.value;
    const translated = output.textContent ?? '';
    const exchange = complete && !!translated;
    touched = true;
    cancel();
    if (exchange) {
      source.value = translated;
      output.textContent = original;
      complete = true;
    } else {
      output.textContent = '';
    }
    configuration = configurationKey();
    message();
    update();
    source.focus();
  }
  button('copy').onclick = () => {
    const v = version;
    void copy(output.textContent ?? '')
      .then(() => {
        if (v === version) message(t('Translation copied'));
      })
      .catch(() => {
        if (v === version)
          message(t('Could not copy. Select the translation and copy it manually.'), true);
      });
  };
  button('export').onclick = () =>
    download(
      new Blob(
        [
          `Built with PLaMo.\n${t(complete ? 'Translation complete' : 'Incomplete translation')}\n\n${t('Source')}\n${source.value}\n\n${t('Translated text')}\n${output.textContent ?? ''}\n`,
        ],
        { type: 'text/plain;charset=utf-8' },
      ),
      'glosside-translation.txt',
    );
  const visible = () => {
    if (!document.hidden) client.prepare();
  };
  const dispose = () => {
    void persist();
    cancel();
    closed = true;
    client.close();
    sharing.dispose();
    removeEventListener('visibilitychange', visible);
    removeEventListener('pagehide', dispose);
  };
  addEventListener('visibilitychange', visible);
  addEventListener('pagehide', dispose, { once: true });
  update();
  return { focus: () => source.focus(), save: persist, dispose };
}
