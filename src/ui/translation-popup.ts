import { shareTools } from './share-tools';
import type { TranslationEvent } from '../shared/types';
import { translationStatus } from './translation-status';
import { el, button, copy } from './dom';
import { icon, copyIcon } from './icons';
import { pdfPlainText, type PdfPart, type PdfImage } from '../shared/pdf-equations';

function imageElement(image: HTMLImageElement, data: PdfImage): HTMLElement {
  if (!data.lightData) return image;
  image.classList.add('colored-equation');
  return el(
    'picture',
    { class: 'equation-picture' },
    el('source', { media: '(forced-colors: active)', srcset: data.lightData }),
    image,
  );
}

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
  private output = el('div', { class: 'output', 'aria-live': 'polite' });
  private copyText = '';
  private copyButton: HTMLButtonElement;
  private copyTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private complete = false;
  private sharing: ReturnType<typeof shareTools>;

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
        void copy(this.copyText)
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
    this.sharing = shareTools(
      () => ({ text: this.copyText, complete: this.complete }),
      'ja',
      'https://plamo.preferredai.jp/info/plamo-community-license-ja',
    );
    tools.append(this.sharing.element);
    this.sharing.element.addEventListener('toggle', () => actions.position());
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
    if (this.disposed) return;
    if (e.parts) {
      this.copyText = pdfPlainText(e.parts);
      this.renderParts(e.parts);
      this.copyButton.title = '訳文をコピー（数式は原文の文字列）';
    } else if (e.text !== undefined) {
      this.output.textContent = e.text;
      this.copyText = e.text;
    }
    this.complete = e.type === 'complete';
    this.sharing.update();
    this.copyButton.disabled = !this.copyText;
    this.state.classList.toggle('quiet', e.type === 'complete' && !e.warnings?.length);
    this.state.textContent =
      e.type === 'complete' && e.warnings?.length ? e.warnings.join(' ') : translationStatus(e);
    if (e.type !== 'complete' && e.warnings?.length)
      this.state.textContent += '\n' + e.warnings.join(' ');
  }
  // Only locally constructed, inert math views enter this path. Translation
  // messages still contain plain text; they can never supply arbitrary HTML.
  updateHtml(event: TranslationEvent, content: DocumentFragment) {
    this.update(event);
    if (this.disposed) return;
    const fallback = !!content.querySelector('[data-math-fallback]');
    this.output.replaceChildren(content);
    this.copyButton.title = '訳文をコピー（数式は原文の文字列）';
    const warn = () => {
      this.state.classList.remove('quiet');
      this.state.textContent = '一部の数式は原文の文字列で表示しています。';
    };
    this.output.addEventListener('math-render-error', warn, { once: true });
    if (fallback) warn();
  }
  private renderParts(parts: PdfPart[]) {
    this.output.replaceChildren();
    for (const part of parts) {
      if (part.kind === 'paragraph') {
        const paragraph = el('div', { class: 'output-prose output-inline' });
        for (const run of part.runs) {
          if (run.kind === 'text') {
            paragraph.append(document.createTextNode(run.text));
            continue;
          }
          if (run.kind === 'original') {
            paragraph.append(el('span', { class: 'inline-original' }, run.source));
            continue;
          }
          const image = el('img', {
            class: 'equation-image inline-equation',
            src: run.image.data,
            alt: run.source,
            width: String(run.image.width),
            height: String(run.image.height),
            draggable: 'false',
          });
          image.style.width = run.image.widthEm + 'em';
          image.style.verticalAlign = -(run.image.baselineEm ?? 0) + 'em';
          image.addEventListener(
            'error',
            () => {
              if (this.disposed || !this.output.contains(paragraph)) return;
              paragraph.replaceWith(
                el('div', { class: 'output-prose output-original' }, part.source),
              );
              // The copy representation must follow the visible fallback too.
              part.runs = [{ kind: 'text', text: part.source }];
              this.copyText = pdfPlainText(parts);
              this.sharing.update();
              this.state.classList.remove('quiet');
              this.state.textContent = '数式画像を表示できないため、この文は原文を表示しています。';
            },
            { once: true },
          );
          paragraph.append(imageElement(image, run.image));
        }
        this.output.append(paragraph);
        continue;
      }
      if (part.kind !== 'equation') {
        const text = part.kind === 'text' ? part.text : part.source;
        if (text.trim())
          this.output.append(
            el(
              'div',
              { class: part.kind === 'original' ? 'output-prose output-original' : 'output-prose' },
              text.trim(),
            ),
          );
        continue;
      }
      const image = el('img', {
        class: 'equation-image',
        src: part.image.data,
        alt: part.source,
        width: String(part.image.width),
        height: String(part.image.height),
        draggable: 'false',
      });
      image.style.width = part.image.widthEm + 'em';
      const figure = el(
        'figure',
        {
          class: 'equation',
          tabindex: '0',
          'aria-label': '原文の数式（横にスクロールできます）',
        },
        imageElement(image, part.image),
      );
      image.addEventListener(
        'error',
        () => {
          if (this.disposed || !this.output.contains(figure)) return;
          figure.replaceWith(el('div', { class: 'output-prose output-original' }, part.source));
          this.state.classList.remove('quiet');
          this.state.textContent = '数式画像を表示できないため、この部分は原文を表示しています。';
        },
        { once: true },
      );
      this.output.append(figure);
    }
  }
  showError(message: string) {
    this.state.classList.remove('quiet');
    this.state.textContent = message;
  }
  dispose() {
    this.disposed = true;
    this.sharing.dispose();
    clearTimeout(this.copyTimer);
    this.output.replaceChildren();
    this.copyText = '';
  }
}
