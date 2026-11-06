import { EventListeners } from './listeners';
import { el, button, copy, isExtensionNode } from './dom';
import { icon, copyIcon } from './icons';
import { selectionStyle } from './selection-style';
import { t } from './locale';

interface Anchor {
  node: Text;
  rect: DOMRect;
  x: number;
}

// A read-only companion to SelectionUI. It does not wrap text, capture the pointer,
// or cancel page clicks. Its only DOM is the isolated popup host.
export class OriginalPopup {
  private host = el('div', { 'data-local-translator': 'original', hidden: '' });
  private shadow = this.host.attachShadow({ mode: 'open' });
  private output = el('p', { class: 'output', dir: 'auto' });
  private title = el('span', { class: 'title', role: 'status' }, t('Original text'));
  private body = el('div', { class: 'body' }, this.output);
  private candidate?: Anchor;
  private current?: Anchor;
  private dismissed?: Text;
  private openTimer?: ReturnType<typeof setTimeout>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private copyTimer?: ReturnType<typeof setTimeout>;
  private frame?: number;
  private lastClose = -Infinity;
  private version = 0;
  private listeners = new EventListeners();

  constructor(
    private lookup: (node: Text) => string | undefined,
    private language: () => string,
  ) {
    const close = button('', () => this.dismiss(), {
      class: 'icon-button',
      'aria-label': t('Close original text'),
      title: t('Close'),
    });
    close.append(icon(['M6 6l12 12M18 6 6 18']));
    const copyButton = button(
      '',
      () => {
        const version = this.version;
        void copy(this.output.textContent ?? '')
          .then(() => this.copied(version, t('Copied')))
          .catch(() => this.copied(version, t('Could not copy')));
      },
      {
        class: 'icon-button',
        'aria-label': t('Copy original text'),
        title: t('Copy original text'),
      },
    );
    copyButton.append(copyIcon());
    this.shadow.append(
      el('style', {}, selectionStyle + '\n:host { z-index: 2147483646; }'),
      el(
        'section',
        { role: 'region', 'aria-label': t('Original text') },
        el(
          'div',
          { class: 'heading' },
          this.title,
          el('div', { class: 'controls' }, copyButton, close),
        ),
        this.body,
      ),
    );
    document.documentElement.append(this.host);
    const on = (target: EventTarget, type: string, listener: EventListener, capture = false) => {
      this.listeners.on(target, type, listener, { capture, passive: type !== 'keydown' });
    };
    on(document, 'pointermove', (event) => this.pointer(event as PointerEvent), true);
    on(
      document,
      'pointerdown',
      (event) => {
        if (!event.composedPath().includes(this.host)) this.dismiss();
      },
      true,
    );
    on(
      document,
      'pointerout',
      (event) => {
        if (!(event as PointerEvent).relatedTarget) this.hide();
      },
      true,
    );
    on(
      document,
      'keydown',
      (event) => {
        if ((event as KeyboardEvent).key === 'Escape') this.dismiss();
      },
      true,
    );
    on(document, 'selectionchange', () => {
      const selection = document.getSelection();
      if (!selection?.isCollapsed && !isExtensionNode(selection?.anchorNode ?? null)) this.hide();
    });
    on(document, 'focusin', (event) => this.focus(event), true);
    on(
      document,
      'focusout',
      () => {
        // Wait until focus has moved; focus inside the popup keeps it open.
        queueMicrotask(() => {
          const focused = document.activeElement;
          if (focused !== this.host && !(this.current && focused?.contains(this.current.node)))
            this.leave();
        });
      },
      true,
    );
    on(
      window,
      'scroll',
      (event) => {
        if (!event.composedPath().includes(this.host)) this.hide();
      },
      true,
    );
    on(window, 'resize', () => this.hide());
    on(window, 'blur', () => this.hide());
    on(document, 'visibilitychange', () => {
      if (document.hidden) this.hide();
    });
    if (window.visualViewport) {
      on(window.visualViewport, 'resize', () => this.hide());
      on(window.visualViewport, 'scroll', () => this.hide());
    }
  }

  private copied(version: number, message: string) {
    if (version !== this.version || this.host.hidden) return;
    clearTimeout(this.copyTimer);
    this.title.textContent = message;
    this.copyTimer = setTimeout(() => {
      this.title.textContent = t('Original text');
    }, 1600);
  }

  private pointer(event: PointerEvent) {
    if (event.composedPath().includes(this.host)) {
      if (this.frame !== undefined) cancelAnimationFrame(this.frame);
      this.frame = undefined;
      clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
      return;
    }
    if (
      event.pointerType === 'touch' ||
      event.buttons ||
      (document.getSelection()?.isCollapsed === false &&
        !isExtensionNode(document.getSelection()?.anchorNode ?? null)) ||
      document.querySelector('[data-local-translator="selection"]:not([hidden])')
    ) {
      this.hide();
      return;
    }
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    const { clientX: x, clientY: y, target } = event;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      const caret = document.caretRangeFromPoint?.(x, y);
      const node = caret?.startContainer;
      if (
        !(node instanceof Text) ||
        !(target instanceof Element) ||
        !target.contains(node) ||
        this.lookup(node) === undefined
      ) {
        this.dismissed = undefined;
        this.leave();
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = [...range.getClientRects()].find(
        (rect) =>
          x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1,
      );
      if (!rect) {
        this.dismissed = undefined;
        this.leave();
        return;
      }
      this.enter({ node, rect, x });
    });
  }

  private focus(event: Event) {
    if (event.composedPath().includes(this.host)) {
      clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
      return;
    }
    const element = event.target;
    if (!(element instanceof Element) || isExtensionNode(element)) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (this.lookup(node) === undefined) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getClientRects()[0];
      if (rect) {
        this.dismissed = undefined;
        this.enter({ node, rect, x: rect.left + 20 }, true);
        return;
      }
    }
    this.leave();
  }

  private enter(anchor: Anchor, immediate = false) {
    clearTimeout(this.closeTimer);
    this.closeTimer = undefined;
    if (anchor.node === this.dismissed) return;
    this.dismissed = undefined;
    if (anchor.node === this.current?.node) return;
    if (anchor.node === this.candidate?.node) {
      this.candidate = anchor;
      return;
    }
    clearTimeout(this.openTimer);
    this.candidate = anchor;
    const delay =
      immediate || !this.host.hidden || performance.now() - this.lastClose < 350 ? 0 : 300;
    if (!delay) this.show();
    else this.openTimer = setTimeout(() => this.show(), delay);
  }

  private show() {
    const anchor = this.candidate;
    if (!anchor) return;
    const source = this.lookup(anchor.node);
    if (source === undefined) {
      this.hide();
      return;
    }
    clearTimeout(this.copyTimer);
    this.version++;
    this.current = anchor;
    this.candidate = undefined;
    this.title.textContent = t('Original text');
    this.output.textContent = source.trim();
    this.output.lang = this.language();
    this.body.scrollTop = 0;
    this.host.hidden = false;
    this.position(anchor);
  }

  private position({ rect, x }: Anchor) {
    const view = window.visualViewport;
    const leftEdge = (view?.offsetLeft ?? 0) + 12;
    const topEdge = (view?.offsetTop ?? 0) + 12;
    const rightEdge = leftEdge + (view?.width ?? innerWidth) - 24;
    const bottomEdge = topEdge + (view?.height ?? innerHeight) - 24;
    const below = Math.max(0, bottomEdge - rect.bottom - 10);
    const above = Math.max(0, rect.top - topEdge - 10);
    const placement =
      below >= Math.min(220, (bottomEdge - topEdge) * 0.6) || below >= above ? 'below' : 'above';
    this.host.dataset.placement = placement;
    this.host.style.setProperty(
      '--popover-max-height',
      Math.max(80, Math.min(420, placement === 'below' ? below : above)) + 'px',
    );
    const panel = this.shadow.querySelector('section')!;
    panel.style.width = Math.max(80, Math.min(532, rightEdge - leftEdge)) + 'px';
    const left = Math.max(leftEdge, Math.min(x - 24, rightEdge - this.host.offsetWidth));
    const top = placement === 'below' ? rect.bottom + 10 : rect.top - 10 - this.host.offsetHeight;
    this.host.style.left = left + 'px';
    this.host.style.top =
      Math.max(topEdge, Math.min(top, bottomEdge - this.host.offsetHeight)) + 'px';
    this.host.style.setProperty(
      '--arrow-x',
      Math.max(14, Math.min(x - left, this.host.offsetWidth - 24)) + 'px',
    );
  }

  private leave() {
    clearTimeout(this.openTimer);
    this.candidate = undefined;
    if (document.activeElement === this.host) return;
    if (this.closeTimer === undefined) this.closeTimer = setTimeout(() => this.hide(), 180);
  }

  private dismiss() {
    this.dismissed = this.current?.node ?? this.candidate?.node;
    this.hide();
  }

  refresh() {
    if (
      (this.current && this.lookup(this.current.node) === undefined) ||
      (this.candidate && this.lookup(this.candidate.node) === undefined)
    )
      this.hide();
  }

  hide() {
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    clearTimeout(this.copyTimer);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.closeTimer = undefined;
    this.candidate = this.current = undefined;
    this.version++;
    if (!this.host.hidden) this.lastClose = performance.now();
    this.host.hidden = true;
    this.output.textContent = '';
  }

  destroy() {
    this.hide();
    this.listeners.clear();
    this.host.remove();
  }
}
