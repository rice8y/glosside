import { el, button } from '../ui/dom';
import { brandIcon } from '../ui/brand';
import { t } from '../ui/locale';
import { explain } from '../shared/errors';
import { progressStyle } from './full-page-style';

interface Progress {
  total: number;
  done: number;
  failed: number;
  error?: string;
  capped: boolean;
}

export class PageProgress {
  private host: HTMLElement;
  private label: HTMLElement;
  private detail: HTMLElement;
  private progress: HTMLProgressElement;
  private retry: HTMLButtonElement;

  constructor(retry: () => void, restore: () => void) {
    this.host = el('div', { 'data-local-translator': 'progress' });
    const shadow = this.host.attachShadow({ mode: 'closed' });
    shadow.append(el('style', {}, progressStyle));
    this.label = el('div', { class: 'label' }, t('Checking page text…'));
    this.detail = el('div', { class: 'detail', hidden: '' });
    this.progress = el('progress', { 'aria-label': t('Page translation'), max: '1', value: '0' });
    this.retry = button(t('Retry'), retry, {
      hidden: '',
      'aria-label': t('Retry unfinished translations'),
    });
    shadow.append(
      el(
        'section',
        {},
        brandIcon(),
        el(
          'div',
          { class: 'status', role: 'status', 'aria-atomic': 'true' },
          this.label,
          this.detail,
        ),
        this.retry,
        button(t('Restore original'), restore),
        this.progress,
      ),
    );
    document.documentElement.append(this.host);
  }
  update({ total, done, failed, error, capped }: Progress) {
    const pending = total - done - failed;
    if (this.label)
      this.label.textContent = !total
        ? t('No text to translate')
        : pending
          ? t('Translating {done} / {total}', { done, total: total })
          : failed || capped
            ? t('Partially translated')
            : t('Translated');
    if (this.detail) {
      this.detail.textContent = [
        failed ? t('{count} unfinished', { count: failed }) : '',
        !pending && error ? explain(error) : '',
        capped ? t('Page translation limit reached') : '',
      ]
        .filter(Boolean)
        .join('\n');
      this.detail.hidden = !this.detail.textContent;
    }
    if (this.retry) this.retry.hidden = !failed || !!pending;
    if (this.progress) {
      this.progress.max = Math.max(1, total);
      this.progress.value = done + failed;
      this.progress.hidden = !pending;
    }
  }

  destroy() {
    this.host.remove();
  }
}
