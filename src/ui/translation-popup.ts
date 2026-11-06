import type { TranslationEvent } from '../shared/types';
import { translationStatus } from './translation-status';
import { el, button, copy } from './dom';
import { icon, copyIcon } from './icons';

interface PopupText {
  originalText: string;
  translationText: string;
  pdf: boolean;
  edited: boolean;
}
interface PopupActions {
  togglePin: () => boolean;
  paragraph?: () => void;
  retry: (source: string) => void;
  close: () => void;
  position: () => void;
}

// This view can be prepared while inference is running, then mounted on completion.
export class TranslationPopup {
  readonly element: HTMLElement;
  private state = el('p', { class: 'state', role: 'status' }, '準備中');
  private output = el('p', { class: 'output', 'aria-live': 'polite' });
  private copyButton: HTMLButtonElement;
  private copyTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(data: PopupText, actions: PopupActions) {
    const state = this.state,
      output = this.output;
    const headingLabel = el('span', { class: 'title', role: 'status' }, '翻訳');
    let copyAttempt = 0;
    const copied = (attempt: number, message: string) => {
      if (this.disposed || attempt !== copyAttempt) return;
      clearTimeout(this.copyTimer);
      headingLabel.textContent = message;
      this.copyTimer = setTimeout(() => {
        headingLabel.textContent = '翻訳';
      }, 2000);
    };
    const source = el('textarea', { 'aria-label': '翻訳する原文' });
    source.value = data.translationText;
    const details = el('details', {}, el('summary', {}, '原文を編集'), source);
    if (data.pdf && data.translationText !== data.originalText) {
      details.append(
        el('small', {}, data.edited ? '編集後の原文です。' : 'PDFの改行を整えた原文です。'),
      );
      const extracted = el('textarea', { 'aria-label': 'PDFから抽出した原文', readonly: '' });
      extracted.value = data.originalText;
      details.append(el('details', {}, el('summary', {}, 'PDFから取得した原文'), extracted));
    }
    const pin = button('ピン留め', () => {
      pin.textContent = actions.togglePin() ? 'ピン解除' : 'ピン留め';
    });
    const copyButton = button(
      '',
      () => {
        const attempt = ++copyAttempt;
        void copy(output.textContent ?? '')
          .then(() => copied(attempt, 'コピーしました'))
          .catch(() => copied(attempt, 'コピーできませんでした'));
      },
      { class: 'icon-button', 'aria-label': '訳文をコピー', title: '訳文をコピー' },
    );
    copyButton.disabled = true;
    copyButton.append(copyIcon());
    const tools = el(
      'div',
      { class: 'tools', id: 'translation-tools', hidden: '' },
      details,
      el(
        'div',
        { class: 'actions' },
        ...(actions.paragraph !== undefined
          ? [button('段落全体を翻訳', () => actions.paragraph!())]
          : []),
        pin,
        button('翻訳し直す', () => {
          actions.retry(source.value);
        }),
        button('閉じる', actions.close, { 'aria-label': '翻訳を閉じる' }),
      ),
    );
    // Keep expanded controls in view even when the translation fills the scroll area.
    const body = el('div', { class: 'body' }, tools, output, state);
    let readingScrollTop = 0;
    const more = button(
      '',
      () => {
        if (tools.hidden) readingScrollTop = body.scrollTop;
        tools.hidden = !tools.hidden;
        more.setAttribute('aria-expanded', String(!tools.hidden));
        actions.position();
        body.scrollTop = tools.hidden ? readingScrollTop : 0;
      },
      {
        class: 'icon-button',
        'aria-label': '翻訳のその他の操作',
        title: 'その他の操作',
        'aria-expanded': 'false',
        'aria-controls': 'translation-tools',
      },
    );
    more.append(icon(['M5 11.5v1M12 11.5v1M19 11.5v1']));
    this.element = el(
      'section',
      { role: 'region', 'aria-label': '選択翻訳' },
      el(
        'div',
        { class: 'heading' },
        headingLabel,
        el('div', { class: 'controls' }, copyButton, more),
      ),
      body,
    );
    this.copyButton = copyButton;
  }
  update(e: TranslationEvent) {
    if (e.text !== undefined) this.output.textContent = e.text;
    this.copyButton.disabled = !this.output.textContent;
    this.state.classList.toggle('quiet', e.type === 'complete' && !e.warnings?.length);
    this.state.textContent =
      e.type === 'complete' && e.warnings?.length ? e.warnings.join(' ') : translationStatus(e);
    if (e.type !== 'complete' && e.warnings?.length)
      this.state.textContent += '\n' + e.warnings.join(' ');
  }
  showError(message: string) {
    this.state.classList.remove('quiet');
    this.state.textContent = message;
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.copyTimer);
  }
}
