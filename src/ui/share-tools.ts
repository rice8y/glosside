import { shareStyle } from './share-style';
import { el, button, copy, download } from './dom';
import { t, type UiLocale } from './locale';
import { outputNotice, outputWithNotice, type ShareOutput } from '../shared/output-notice';

// A separate disclosure keeps sharing notices out of everyday reading and copying.
export function shareTools(
  read: () => ShareOutput,
  language?: UiLocale,
  documentationUrl = chrome.runtime.getURL('docs/license-notices.html'),
) {
  const label = (key: Parameters<typeof t>[0]) => t(key, {}, language);
  const feedback = el('p', { class: 'share-feedback', role: 'status', 'aria-live': 'polite' });
  let revision = 0;
  let disposed = false;
  let previous: ShareOutput | undefined;
  const copyButton = button(
    label('Copy with notice'),
    () => {
      const output = read();
      if (!output.text || disposed) return;
      const current = revision;
      void copy(outputWithNotice(output))
        .then(() => {
          if (!disposed && current === revision) feedback.textContent = label('Copied with notice');
        })
        .catch(() => {
          if (!disposed && current === revision)
            feedback.textContent = label('Could not copy. Try saving the text file instead.');
        });
    },
    { 'data-share-copy': '' },
  );
  const saveButton = button(
    label('Save with notice'),
    () => {
      const output = read();
      if (!output.text || disposed) return;
      download(
        new Blob([outputWithNotice(output)], { type: 'text/plain;charset=utf-8' }),
        'glosside-translation-with-notice.txt',
      );
      feedback.textContent = label('Saved with notice');
    },
    { 'data-share-save': '' },
  );
  const link = el(
    'a',
    {
      href: documentationUrl,
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    label('License details'),
  );
  const element = el(
    'details',
    { class: 'share-tools' },
    el('summary', {}, label('Publishing and sharing')),
    el(
      'p',
      {},
      label(
        'When sharing a translation with others, include the training-use notice. Plain copy and save do not include it.',
      ),
    ),
    el(
      'p',
      {},
      label(
        'For a book, paper, or similar long-form publication substantially using the translation, also credit PLaMo in an appropriate location.',
      ),
    ),
    el('div', { class: 'share-actions' }, copyButton, saveButton, link),
    el(
      'details',
      { class: 'share-preview' },
      el('summary', {}, label('Notice to include')),
      el('pre', {}, outputNotice),
    ),
    feedback,
  );
  element.prepend(el('style', {}, shareStyle));
  function update() {
    const output = read();
    if (!previous || previous.text !== output.text || previous.complete !== output.complete) {
      revision++;
      feedback.textContent = '';
      previous = output;
    }
    copyButton.disabled = saveButton.disabled = disposed || !output.text;
  }
  update();
  return {
    element,
    update,
    dispose() {
      disposed = true;
      update();
    },
  };
}
