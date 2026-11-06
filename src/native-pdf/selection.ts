// Chrome's outer PDF document accepts content scripts; the protected viewer does not.
// The dom API is public, but getSelectedText is a viewer protocol, so keep this bridge
// optional and fail closed if Chrome changes it. Never fetch or replace the PDF.
import { extensionContextAlive } from '../shared/runtime-context';
import { measure, reportMetric } from '../shared/metrics';
export const PDF_VIEWER_ORIGIN = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai';
export class NativePdfSelection {
  private frame?: Window;
  private pending = false;
  private explicit = false;
  private stopped = false;
  private previous?: string;
  private delivered?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private timeout?: ReturnType<typeof setTimeout>;
  private positionEnabled = false;
  private positionToken?: string;
  private sequence = 0;
  private dragging = false;
  private observerReady = false;
  private settleStart?: number;
  private generation = 0;
  private pendingGeneration = 0;
  private point?: { x: number; y: number };
  constructor(
    private receive: (
      text: string,
      settled: boolean,
      explicit: boolean,
      point?: { x: number; y: number },
    ) => void,
  ) {
    window.addEventListener('message', this.message);
    document.addEventListener('visibilitychange', this.visibility);
    this.poll();
  }
  configurePosition(enabled: boolean, explicit = false) {
    if (this.stopped) return;
    this.positionEnabled = enabled;
    if (enabled && !document.hidden) this.watchPosition(explicit);
    else this.unwatchPosition();
  }
  private watchPosition(explicit = false) {
    if (this.stopped) return;
    if (!extensionContextAlive()) {
      this.destroy();
      return;
    }
    if (this.positionToken && !explicit) return;
    this.positionToken = crypto.randomUUID();
    this.sequence = 0;
    try {
      chrome.runtime.onMessage.removeListener(this.positionMessage);
      chrome.runtime.onMessage.addListener(this.positionMessage);
      void chrome.runtime
        .sendMessage({
          channel: 'native-pdf-watch',
          action: 'start',
          token: this.positionToken,
          explicit,
        })
        .catch(() => {
          if (!extensionContextAlive()) this.destroy();
        });
    } catch {
      this.destroy();
    }
  }
  private unwatchPosition() {
    if (!this.positionToken) return;
    const token = this.positionToken;
    this.positionToken = undefined;
    this.observerReady = false;
    this.point = undefined;
    this.dragging = false;
    try {
      chrome.runtime.onMessage.removeListener(this.positionMessage);
    } catch {}
    if (extensionContextAlive()) {
      try {
        void chrome.runtime
          .sendMessage({ channel: 'native-pdf-watch', action: 'stop', token })
          .catch(() => {});
      } catch {
        /* API can be invalidated before returning a Promise. */
      }
    }
  }
  private positionMessage = (message: any, sender: chrome.runtime.MessageSender) => {
    if (
      sender.id !== chrome.runtime.id ||
      message?.channel !== 'native-pdf-position' ||
      message.token !== this.positionToken ||
      !Number.isSafeInteger(message.sequence) ||
      message.sequence <= this.sequence
    )
      return;
    this.sequence = message.sequence;
    if (['down', 'up', 'keyboard'].includes(message.kind)) this.generation++;
    if (message.kind === 'attached') this.observerReady = true;
    if (message.kind === 'detached') this.observerReady = false;
    if (message.kind === 'up') {
      reportMetric('pdfGeometryMs', message.geometryMs);
      this.settleStart = performance.now();
      this.dragging = false;
      this.point =
        message.point && Number.isFinite(message.point.x) && Number.isFinite(message.point.y)
          ? message.point
          : undefined;
      this.previous = this.delivered = undefined;
      this.receive('', false, false);
      if (!this.pending) this.poll();
    } else if (
      ['down', 'cancel', 'viewport', 'keyboard', 'detached', 'attached'].includes(message.kind)
    ) {
      // Autoscroll can happen while the mouse is still held. Only release/cancel ends that drag.
      if (message.kind === 'down') this.dragging = true;
      else if (message.kind !== 'viewport') this.dragging = false;
      this.point = undefined;
      // Keep unchanged selections dismissed after scrolling/zooming or detachment.
      this.receive('', false, false);
    }
  };
  refresh(explicit = false) {
    if (this.stopped) return;
    this.explicit ||= explicit;
    this.delivered = undefined;
    if (!this.pending) this.poll();
  }
  private visibility = () => {
    if (this.stopped) return;
    if (document.hidden) {
      clearTimeout(this.timer);
      this.unwatchPosition();
      this.receive('', false, false);
    } else {
      if (this.positionEnabled) this.watchPosition();
      if (!this.pending) this.poll();
    }
  };
  private later(delay = 250) {
    clearTimeout(this.timer);
    if (!this.stopped && !document.hidden) this.timer = setTimeout(() => this.poll(), delay);
  }
  private poll() {
    clearTimeout(this.timer);
    if (this.stopped || this.pending || document.hidden) return;
    if (!extensionContextAlive()) {
      this.destroy();
      return;
    }
    let frame: Window | null | undefined;
    try {
      frame = chrome.dom
        ?.openOrClosedShadowRoot(document.body)
        ?.querySelector('iframe')?.contentWindow;
    } catch {
      /* Unsupported browser/viewer: context-menu translation remains available. */
    }
    if (frame !== this.frame) {
      this.frame = frame ?? undefined;
      this.previous = this.delivered = undefined;
      this.receive('', false, false);
    }
    if (!frame) {
      this.later(1000);
      return;
    }
    this.pending = true;
    this.pendingGeneration = this.generation;
    this.timeout = setTimeout(() => {
      this.pending = false;
      this.previous = this.delivered = undefined;
      this.receive('', false, false);
      this.later(2000);
    }, 1500);
    try {
      // The native frame can still have the PDF site's inherited origin during
      // initialization. This payload contains no text, IDs, or other private data.
      // Accept replies only from the exact native viewer origin AND frame below.
      frame.postMessage({ type: 'getSelectedText' }, '*');
    } catch {
      clearTimeout(this.timeout);
      this.pending = false;
      this.later(2000);
    }
  }
  private message = (event: MessageEvent) => {
    if (
      this.stopped ||
      !this.pending ||
      event.origin !== PDF_VIEWER_ORIGIN ||
      event.source !== this.frame ||
      event.data?.type !== 'getSelectedTextReply' ||
      typeof event.data.selectedText !== 'string'
    )
      return;
    clearTimeout(this.timeout);
    this.pending = false;
    if (this.pendingGeneration !== this.generation) {
      this.later(0);
      return;
    }
    // Preserve normal input-limit feedback without retaining unbounded PDF selections.
    const text = event.data.selectedText.slice(0, 16001);
    if (document.hidden) {
      this.previous = undefined;
      return;
    }
    if (this.dragging) {
      this.later();
      return;
    }
    const settled = this.previous === text;
    if (!settled) {
      this.settleStart ??= performance.now();
      this.receive(text, false, false); // Cancel stale work immediately.
    }
    this.previous = text;
    if (this.explicit || (settled && this.delivered !== text)) {
      const explicit = this.explicit;
      this.explicit = false;
      this.delivered = text;
      if (text.trim() && this.settleStart !== undefined)
        measure('pdfSelectionMs', this.settleStart);
      this.settleStart = undefined;
      this.receive(text, true, explicit, this.point);
    }
    // A changed sample gets a quick confirmation. With passive event observation,
    // idle polling is only a safety net; unsupported observers keep the old cadence.
    this.later(!settled ? 50 : this.observerReady ? 1000 : 250);
  };
  destroy() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.timeout);
    this.pending = false;
    window.removeEventListener('message', this.message);
    document.removeEventListener('visibilitychange', this.visibility);
    this.unwatchPosition();
    this.receive('', false, false);
  }
}
