import { EventListeners } from './listeners';
import { Client } from '../shared/client';
import { makeRequest, checkText } from '../shared/protocol';
import { explain, errorCode } from '../shared/errors';
import { terminal, type Mode } from '../shared/types';
import { el, button, isExtensionNode } from './dom';
import { TranslationPopup } from './translation-popup';
import { selectionStyle } from './selection-style';
import { brandIcon } from './brand';
import { preparePdfText } from '../native-pdf/reflow';
import { measure } from '../shared/metrics';
import { paragraphText, paragraphRange } from '../content/paragraph';
import {
  htmlMathPlan,
  editHtmlPlan,
  translateHtmlPlan,
  renderHtmlMath,
  type HtmlPlan,
} from '../content/math-plan';
import { mayContainMath, originalPdf } from '../shared/pdf-equations';
import { translatePdfPlan } from '../native-pdf/translate-plan';
export interface SelectionOptions {
  surface: 'html' | 'native-selection';
  epoch: () => string;
}
export class SelectionUI {
  private host = el('div', { 'data-local-translator': 'selection' });
  // Shadow DOM isolates styles. Page-visible translations are not a confidentiality boundary.
  private shadow = this.host.attachShadow({ mode: 'open' });
  private version = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private result?: TranslationPopup;
  private range?: Range;
  private htmlPlan?: HtmlPlan;
  private text = '';
  private selectedText = '';
  private translationOverride?: string;
  private inputRect?: DOMRect;
  private placement?: 'above' | 'below';
  private mode: Mode = 'selection';
  private active?: string;
  private translationAbort?: AbortController;
  private pinned = false;
  private composing = false;
  private dragging = false;
  private listeners = new EventListeners();
  constructor(
    private client: Client,
    private options: SelectionOptions,
  ) {
    this.shadow.append(el('style', {}, selectionStyle));
    this.host.hidden = true;
    document.body.append(this.host);
    const on = this.listeners.on;
    on(document, 'compositionstart', () => {
      this.composing = true;
    });
    on(document, 'compositionend', () => {
      this.composing = false;
    });
    on(document, 'pointerdown', (e) => {
      if (!e.composedPath().includes(this.host)) this.dragging = true;
    });
    on(document, 'pointerup', (e) => {
      this.dragging = false;
      if (!e.composedPath().includes(this.host)) this.schedule();
    });
    on(document, 'selectionchange', () => {
      if (!this.dragging) this.schedule();
    });
    on(document, 'keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') this.close();
    });
    on(window, 'scroll', () => this.position(), true);
    on(window, 'resize', () => this.position());
    this.shadow.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('button, summary')) e.preventDefault();
    });
  }
  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.capture(false), 160);
  }
  private editable(node: Node | null) {
    const e = node instanceof Element ? node : node?.parentElement;
    return e?.closest('input,textarea,[contenteditable]:not([contenteditable="false"])');
  }
  capture(explicit: boolean) {
    if (this.options.surface === 'native-selection') return;
    if (this.composing) return;
    const active = document.activeElement;
    // Editing the source or using keyboard controls inside the popup is not a new page selection.
    if (active === this.host) return;
    if (explicit && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
      if (active instanceof HTMLInputElement && active.type === 'password') return;
      const begin = active.selectionStart,
        end = active.selectionEnd;
      if (begin === null || end === null || begin === end) return;
      this.close();
      this.text = active.value.slice(begin, end);
      this.inputRect = active.getBoundingClientRect();
      this.range = undefined;
      this.mode = 'selection';
      void this.translate();
      return;
    }
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      if (!this.pinned) this.close();
      return;
    }
    if (isExtensionNode(selection.anchorNode)) return;
    const edit = this.editable(selection.anchorNode);
    if (edit?.matches('input[type="password"]') || (!explicit && edit)) return;
    const text = selection.toString();
    const selectedRange = selection.getRangeAt(0);
    if (
      !explicit &&
      this.selectedText === text &&
      this.range &&
      this.range.startContainer === selectedRange.startContainer &&
      this.range.startOffset === selectedRange.startOffset &&
      this.range.endContainer === selectedRange.endContainer &&
      this.range.endOffset === selectedRange.endOffset
    )
      return;
    if (this.pinned && !explicit) return;
    const plan = !edit ? htmlMathPlan(selectedRange, undefined, true, text) : undefined;
    if (!text.trim() && !plan) return;
    this.close();
    this.htmlPlan = plan;
    this.text = plan?.source ?? text;
    this.selectedText = text;
    this.mode = 'selection';
    this.inputRect = undefined;
    this.range = selection.getRangeAt(0).cloneRange();
    this.version++;
    const mode =
      this.options.surface === 'html'
        ? this.client.settings.htmlMode
        : this.client.settings.pdfMode;
    if (!explicit && mode === 'Shortcut') return;
    if (this.client.settings.panelOnly) {
      if (explicit)
        this.showNotice(
          'サイドパネルのみに表示する設定です。右クリックの「選択した文字列を翻訳」を使ってください。',
        );
      return;
    }
    if (explicit || mode === 'Auto') void this.translate();
    else this.showButton();
  }
  captureNative(
    text: string,
    settled: boolean,
    explicit = false,
    point?: { x: number; y: number },
  ) {
    if (this.options.surface !== 'native-selection') return;
    if (!explicit && (this.pinned || document.activeElement === this.host)) return;
    if (!settled || !text.trim()) {
      this.close();
      return;
    }
    this.close();
    this.text = text;
    this.mode = 'selection';
    this.range = undefined;
    this.inputRect = point ? new DOMRect(point.x, point.y, 0, 0) : undefined;
    if (!explicit && this.client.settings.pdfMode === 'Shortcut') return;
    if (this.client.settings.panelOnly) {
      if (explicit)
        this.showNotice(
          'サイドパネルのみに表示する設定です。右クリックの「選択した文字列を翻訳」を使ってください。',
        );
      return;
    }
    if (explicit || this.client.settings.pdfMode === 'Auto') void this.translate();
    else this.showButton();
  }
  private clear() {
    for (const n of [...this.shadow.children]) if (n.tagName !== 'STYLE') n.remove();
    this.host.hidden = false;
    this.placement = undefined;
  }
  private showNotice(text: string) {
    this.clear();
    this.shadow.append(
      el(
        'section',
        { class: 'notice' },
        el('p', {}, text),
        button('閉じる', () => this.close()),
      ),
    );
    this.position();
  }
  private showButton(busy = false) {
    if (!busy) this.client.prepare();
    this.clear();
    const label = busy ? '翻訳中（クリックで中止）' : '選択した文字列を翻訳';
    const trigger = button('', () => (busy ? this.close() : void this.translate()), {
      class: busy ? 'trigger busy' : 'trigger',
      'aria-label': label,
      'aria-busy': String(busy),
      title: label,
    });
    trigger.append(brandIcon());
    this.shadow.append(trigger);
    if (busy) this.shadow.append(el('span', { class: 'sr-only', role: 'status' }, '翻訳中'));
    this.position();
  }
  private async translate() {
    const clicked = performance.now();
    const version = this.version;
    this.translationAbort?.abort();
    const pdfSource = this.translationOverride ?? this.text;
    const protectMath = this.options.surface === 'native-selection';
    this.result?.dispose();
    this.result = undefined;
    this.showButton(true);
    const reflowStart = performance.now();
    const prepared =
      protectMath && mayContainMath(pdfSource)
        ? { text: pdfSource, edits: undefined }
        : this.options.surface === 'html' || this.translationOverride !== undefined
          ? { text: this.translationOverride ?? this.text, edits: undefined }
          : preparePdfText(this.text);
    if (this.options.surface !== 'html') measure('pdfReflowMs', reflowStart);
    const popup = (this.result = new TranslationPopup(
      {
        originalText: this.text,
        translationText: prepared.text,
        pdf: this.options.surface !== 'html',
        edited: this.translationOverride !== undefined,
      },
      {
        togglePin: () => {
          this.pinned = !this.pinned;
          if (this.active) this.client.pin(this.active, this.pinned);
          return this.pinned;
        },
        ...(this.options.surface === 'html' &&
        this.range &&
        paragraphRange(this.range) !== undefined
          ? { paragraph: () => this.paragraph() }
          : {}),
        retry: (source) => {
          this.translationOverride = source;
          if (this.active) this.client.cancel(this.active);
          this.version++;
          void this.translate();
        },
        close: () => this.close(),
        position: () => this.position(),
      },
    ));
    const reveal = () => {
      this.clear();
      this.shadow.append(popup.element);
      this.position();
    };
    try {
      const htmlPlan = this.htmlPlan && editHtmlPlan(this.htmlPlan, prepared.text);
      if (this.options.surface === 'html' && htmlPlan) {
        checkText(htmlPlan.source);
        const controller = (this.translationAbort = new AbortController());
        const { event, runs, blocks } = await translateHtmlPlan(
          htmlPlan,
          this.client,
          {
            sessionId: this.client.id,
            documentEpoch: this.options.epoch(),
            selectionVersion: version,
            surface: 'html',
            mode: this.mode,
            pinned: this.pinned,
          },
          controller.signal,
          (id) => {
            this.active = id;
          },
        );
        if (version !== this.version || controller.signal.aborted) return;
        popup.updateHtml(event, renderHtmlMath(runs, blocks));
        reveal();
        measure('clickToResultMs', clicked);
        return;
      }
      if (protectMath) {
        checkText(pdfSource);
        const controller = (this.translationAbort = new AbortController());
        let plan;
        try {
          plan = await this.client.preparePdf(pdfSource, controller.signal);
        } catch {
          plan = originalPdf(pdfSource);
        }
        if (version !== this.version || controller.signal.aborted) return;
        if (!(plan.parts.length === 1 && plan.parts[0].kind === 'text')) {
          const event = await translatePdfPlan(
            plan,
            this.client,
            {
              sessionId: this.client.id,
              documentEpoch: this.options.epoch(),
              selectionVersion: version,
              surface: 'native-selection',
              mode: 'selection',
              pinned: this.pinned,
            },
            controller.signal,
            (id) => {
              this.active = id;
            },
          );
          if (version !== this.version || controller.signal.aborted) return;
          popup.update(event);
          reveal();
          measure('clickToResultMs', clicked);
          return;
        }
      }
      const r = await makeRequest(this.text, this.client.settings, {
        sessionId: this.client.id,
        documentEpoch: this.options.epoch(),
        selectionVersion: version,
        surface: this.options.surface,
        translationText: prepared.text,
        ...(prepared.edits?.length ? { textEdits: prepared.edits } : {}),
        mode: this.mode,
        pinned: this.pinned,
      });
      if (version !== this.version) return;
      this.active = r.requestId;
      this.client.translate(r, (e) => {
        if (version !== this.version || e.requestId !== this.active) return;
        popup.update(e);
        if (terminal(e)) {
          reveal();
          if (e.type === 'complete')
            requestAnimationFrame(() => {
              if (version === this.version) measure('clickToResultMs', clicked);
            });
        }
      });
    } catch (e) {
      if (version !== this.version) return;
      popup.showError(explain(errorCode(e)));
      reveal();
    }
  }
  private paragraph() {
    if (this.options.surface !== 'html' || !this.range) return;
    const expanded = paragraphRange(this.range);
    const plan = expanded && htmlMathPlan(expanded);
    const text = plan?.source ?? paragraphText(this.range);
    if (text === undefined) {
      const state = this.shadow.querySelector('.state');
      if (state) {
        state.classList.remove('quiet');
        state.textContent = '段落を特定できませんでした。翻訳する範囲を選び直してください。';
        this.position();
      }
      return;
    }
    if (this.active) this.client.cancel(this.active);
    this.version++;
    this.mode = 'paragraph';
    this.htmlPlan = plan;
    this.text = text;
    this.translationOverride = undefined;
    void this.translate();
  }
  position() {
    if (this.host.hidden) return;
    if (
      this.range &&
      (!this.range.startContainer.isConnected || !this.range.endContainer.isConnected)
    ) {
      this.close();
      return;
    }
    if (this.options.surface === 'native-selection' && !this.inputRect && !this.range) {
      // Native PDF messages expose text, not selection geometry. Keep Chrome's toolbar clear.
      this.host.dataset.placement = 'native';
      this.host.style.left = Math.max(12, innerWidth - this.host.offsetWidth - 24) + 'px';
      this.host.style.top =
        Math.max(12, Math.min(80, innerHeight - this.host.offsetHeight - 12)) + 'px';
      this.host.style.setProperty('--popover-max-height', Math.max(80, innerHeight - 104) + 'px');
      return;
    }
    const rects = this.range ? Array.from(this.range.getClientRects()) : [];
    const end = rects.at(-1) ?? this.inputRect;
    if (!end) return;
    const start = rects[0] ?? end;
    const selectionLeft = rects.length ? Math.min(...rects.map((r) => r.left)) : end.left;
    const panel = this.shadow.querySelector('section');
    const margin = 12;
    const below = Math.max(0, innerHeight - end.bottom - 10 - margin);
    const above = Math.max(0, start.top - 10 - margin);
    if (panel) {
      // Pick a side once so streaming text grows away from the selection without jumping.
      this.placement ??=
        below >= Math.min(240, innerHeight * 0.6) || below >= above ? 'below' : 'above';
      const available = this.placement === 'below' ? below : above;
      this.host.style.setProperty(
        '--popover-max-height',
        Math.max(80, Math.min(innerHeight * 0.6, available)) + 'px',
      );
    }
    const placement = panel ? this.placement! : below >= 28 ? 'below' : 'above';
    this.host.dataset.placement = placement;
    const left = Math.max(
      margin,
      Math.min(selectionLeft, innerWidth - this.host.offsetWidth - margin),
    );
    const desiredTop =
      placement === 'below' ? end.bottom + 10 : start.top - this.host.offsetHeight - 10;
    this.host.style.left = left + 'px';
    this.host.style.top =
      Math.max(margin, Math.min(desiredTop, innerHeight - this.host.offsetHeight - margin)) + 'px';
    this.host.style.setProperty(
      '--arrow-x',
      Math.max(14, Math.min(selectionLeft + 20 - left, this.host.offsetWidth - 24)) + 'px',
    );
  }

  close() {
    clearTimeout(this.timer);
    this.translationAbort?.abort();
    this.translationAbort = undefined;
    this.result?.dispose();
    this.result = undefined;
    this.version++;
    if (this.active) this.client.cancel(this.active);
    this.active = undefined;
    this.pinned = false;
    this.host.hidden = true;
    this.text = '';
    this.selectedText = '';
    this.htmlPlan = undefined;
    this.translationOverride = undefined;
  }
  destroy() {
    this.close();
    clearTimeout(this.timer);
    this.listeners.clear();
    this.host.remove();
  }
}
