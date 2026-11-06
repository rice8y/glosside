import { ui } from '../shared/client';
import { errorCode, explain } from '../shared/errors';
import { currentSettings, glossaryStateKey } from '../shared/settings';
import type { Glossary, Settings } from '../shared/types';
import { byId as $ } from '../ui/dom';

let state: Pick<Settings, 'glossaries' | 'activeGlossaryId'> = {
  glossaries: [],
  activeGlossaryId: '',
};
let editing: string | undefined;
let dirty = false;
let saving = false;
const rows = $('rows');
const input = (id: string) => $<HTMLInputElement>(id);
function error(text = '') {
  $('error').textContent = text;
  $('error').hidden = !text;
}
function fail(e: unknown) {
  error(
    errorCode(e) === 'GLOSSARY_CHANGED'
      ? '用語集が別の画面で更新されました。「変更を破棄」で最新の内容を読み込んでください。'
      : explain(errorCode(e)),
  );
}
function update() {
  $('count').textContent = `${rows.children.length} / 100`;
  $('empty').hidden = rows.children.length !== 0;
  $<HTMLButtonElement>('add').disabled = rows.children.length >= 100;
  $<HTMLButtonElement>('create').disabled = state.glossaries.length >= 100;
  $<HTMLButtonElement>('save').disabled = !dirty || saving;
  $<HTMLButtonElement>('reset').disabled = !dirty || saving;
  $<HTMLButtonElement>('delete').hidden = !state.glossaries.some((g) => g.id === editing);
  $<HTMLButtonElement>('delete').disabled = saving;
  $<HTMLFieldSetElement>('fields').disabled = saving;
  $<HTMLFieldSetElement>('library-fields').disabled = saving;
}
function changed() {
  dirty = true;
  error();
  update();
}
function add(term: Glossary['terms'][number], focus = false) {
  const row = document.createElement('div');
  row.className = 'term-row';
  for (const [key, label] of [
    ['source', '用語'],
    ['target', '訳語'],
  ] as const) {
    const field = document.createElement('input');
    field.value = term[key];
    field.required = true;
    field.maxLength = 200;
    field.setAttribute('aria-label', label);
    field.autocomplete = 'off';
    field.oninput = () => {
      field.setCustomValidity('');
      changed();
    };
    row.append(field);
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = '削除';
  remove.onclick = () => {
    const next = row.nextElementSibling ?? row.previousElementSibling;
    row.remove();
    changed();
    (next?.querySelector('input') ?? $('add')).focus();
  };
  row.append(remove);
  rows.append(row);
  if (focus) row.querySelector('input')!.focus();
}
function renderList() {
  $('collections').replaceChildren();
  $('library-empty').hidden = state.glossaries.length !== 0;
  for (const glossary of state.glossaries) {
    const row = document.createElement('div');
    row.className = 'collection';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'collection-open';
    const name = document.createElement('strong');
    name.textContent = glossary.name;
    const description = document.createElement('span');
    description.textContent = glossary.description;
    description.className = 'collection-description';
    open.append(name);
    open.onclick = () => openEditor(glossary);
    const count = document.createElement('span');
    count.className = 'term-count';
    count.textContent = String(glossary.terms.length);
    row.append(open, description, count);
    $('collections').append(row);
  }
  update();
}
function openEditor(glossary: Glossary, fresh = false) {
  editing = glossary.id;
  input('name').value = glossary.name;
  $<HTMLTextAreaElement>('description').value = glossary.description;
  rows.replaceChildren();
  glossary.terms.forEach((term) => add(term));
  dirty = fresh;
  error();
  $('library').hidden = true;
  $('editor').hidden = false;
  update();
  input('name').focus();
}
function showList() {
  editing = undefined;
  dirty = false;
  error();
  $('editor').hidden = true;
  $('library').hidden = false;
  renderList();
}
function accept(settings: Settings) {
  state = { glossaries: settings.glossaries, activeGlossaryId: settings.activeGlossaryId };
}
async function reload() {
  accept((await ui('settings')).settings);
  const glossary = state.glossaries.find((g) => g.id === editing);
  if (glossary) openEditor(glossary);
  else showList();
}
async function persist(next: typeof state) {
  saving = true;
  error();
  update();
  try {
    await ui('save-settings', {
      settings: { glossaries: next.glossaries },
      expectedGlossaries: state.glossaries,
    });
    accept((await ui('settings')).settings);
    dirty = false;
    renderList();
  } finally {
    saving = false;
    update();
  }
}
$('create').onclick = () => {
  if (state.glossaries.length >= 100) return;
  openEditor({ id: crypto.randomUUID(), name: '', description: '', terms: [] }, true);
};
$('back').onclick = () => {
  if (dirty && !confirm('保存していない変更を破棄しますか？')) return;
  editing = undefined;
  dirty = false;
  void reload().catch(fail);
};
$('add').onclick = () => {
  if (rows.children.length >= 100) return;
  add({ source: '', target: '' }, true);
  changed();
};
for (const id of ['name', 'description'])
  $(id).oninput = () => {
    input('name').setCustomValidity('');
    changed();
  };
$('reset').onclick = () => {
  void reload().catch(fail);
};
$('delete').onclick = () => {
  const glossary = state.glossaries.find((g) => g.id === editing);
  if (!glossary || !confirm(`「${glossary.name}」を削除しますか？`)) return;
  void persist({
    glossaries: state.glossaries.filter((g) => g.id !== editing),
    activeGlossaryId: state.activeGlossaryId === editing ? '' : state.activeGlossaryId,
  })
    .then(showList)
    .catch(fail);
};
$<HTMLFormElement>('editor').onsubmit = (event) => {
  event.preventDefault();
  if (saving || !editing) return;
  for (const field of [input('name'), ...rows.querySelectorAll('input')]) {
    field.setCustomValidity(field.value.trim() ? '' : '入力してください。');
    if (!field.reportValidity()) return;
  }
  const glossary: Glossary = {
    id: editing,
    name: input('name').value.trim(),
    description: $<HTMLTextAreaElement>('description').value.trim(),
    terms: [...rows.children].map((row) => {
      const fields = row.querySelectorAll('input');
      return { source: fields[0].value.trim(), target: fields[1].value.trim() };
    }),
  };
  const exists = state.glossaries.some((g) => g.id === editing);
  const next = {
    glossaries: exists
      ? state.glossaries.map((g) => (g.id === editing ? glossary : g))
      : [...state.glossaries, glossary],
    activeGlossaryId: state.activeGlossaryId,
  };
  void persist(next).then(showList).catch(fail);
};
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings || saving || dirty) return;
  const next = currentSettings(changes.settings.newValue);
  if (glossaryStateKey(state) === glossaryStateKey(next)) return;
  accept(next);
  const glossary = state.glossaries.find((g) => g.id === editing);
  if (glossary) openEditor(glossary);
  else showList();
});
addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
void reload().catch(fail);
