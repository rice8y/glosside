import {
  defaults,
  type Settings,
  type Request,
  type TranslationEvent,
  type ModelState,
  terminal,
} from './types';
import { AppError } from './errors';
import { extensionContextAlive } from './runtime-context';
import { originalPdf, validPdfPlan, type PdfPlan } from './pdf-equations';
export class Client {
  settings: Settings = { ...defaults };
  readonly id = crypto.randomUUID();
  private port?: chrome.runtime.Port;
  private closed = false;
  private retry = 0;
  private reconnect?: ReturnType<typeof setTimeout>;
  private lastPrepare = -Infinity;
  private callbacks = new Map<string, (e: TranslationEvent) => void>();
  private sequences = new Map<string, number>();
  private submitted = new Map<string, number>();
  private pdfJobs = new Map<string, { source: string; finish: (plan: PdfPlan) => void }>();
  onModel: (state: ModelState) => void = () => {};
  onSettings: (s: Settings) => void = () => {};
  onPending: () => void = () => {};
  onRevoked: () => void = () => {};
  private lease: ReturnType<typeof setInterval>;
  constructor() {
    this.lease = setInterval(() => this.send({ type: 'lease' }), 15000);
    this.connect();
  }
  private invalidate() {
    if (this.closed) return;
    this.close();
    this.onRevoked();
  }
  private retryConnection(delay: number) {
    clearTimeout(this.reconnect);
    if (!this.closed) this.reconnect = setTimeout(() => this.connect(), delay);
  }
  private connect() {
    if (this.closed) return;
    if (!extensionContextAlive()) {
      this.invalidate();
      return;
    }
    try {
      const port = (this.port = chrome.runtime.connect({ name: 'translator-v1' }));
      this.port.postMessage({ type: 'hello', client: this.id });
      this.port.onMessage.addListener((m) => {
        if (this.closed || this.port !== port) return;
        this.retry = 0;
        if (m.type === 'pdf-plan') {
          const job = this.pdfJobs.get(m.id);
          if (job) job.finish(validPdfPlan(m.plan, job.source) ? m.plan : originalPdf(job.source));
        } else if (m.type === 'settings') {
          this.settings = m.settings;
          this.onSettings(m.settings);
        } else if (m.type === 'model') this.onModel(m.model);
        else if (m.type === 'reconcile') {
          for (const [id, cb] of this.callbacks)
            if (!m.ids.includes(id) && Date.now() - (this.submitted.get(id) ?? 0) > 5000) {
              cb({ type: 'error', requestId: id, sequence: 2147483647, code: 'HOST_INTERRUPTED' });
              this.callbacks.delete(id);
              this.sequences.delete(id);
              this.submitted.delete(id);
            }
        } else if (m.type === 'pending') this.onPending();
        else if (m.type === 'revoked') {
          this.onRevoked();
          this.close();
        } else if (m.type === 'event') {
          const e = m.event as TranslationEvent;
          if (e.sequence <= (this.sequences.get(e.requestId) ?? -1)) return;
          this.sequences.set(e.requestId, e.sequence);
          this.callbacks.get(e.requestId)?.(e);
          if (terminal(e)) {
            this.callbacks.delete(e.requestId);
            this.sequences.delete(e.requestId);
            this.submitted.delete(e.requestId);
          }
        }
      });
      this.port.onDisconnect.addListener(() => {
        // Consume the callback-only error, including a missing background listener.
        try {
          void chrome.runtime.lastError;
        } catch {}
        if (this.port !== port || this.closed) return;
        this.port = undefined;
        for (const job of this.pdfJobs.values()) job.finish(originalPdf(job.source));
        if (!extensionContextAlive()) {
          this.invalidate();
          return;
        }
        this.retryConnection(Math.min(5000, 250 * 2 ** this.retry++));
      });
    } catch (error) {
      if (!extensionContextAlive() || String(error).includes('Extension context invalidated'))
        this.invalidate();
      else this.retryConnection(2000);
    }
  }
  send(m: unknown) {
    if (this.closed) return;
    if (!extensionContextAlive()) {
      this.invalidate();
      return;
    }
    try {
      this.port?.postMessage(m);
    } catch (error) {
      if (!extensionContextAlive() || String(error).includes('Extension context invalidated'))
        this.invalidate();
    }
  }
  prepare() {
    if (!this.settings.modelConsent || this.settings.memoryMode === 'economy') return;
    if (Date.now() - this.lastPrepare < 30000) return;
    this.lastPrepare = Date.now();
    this.send({ type: 'prepare' });
  }
  preparePdf(source: string, signal: AbortSignal): Promise<PdfPlan> {
    if (this.closed || signal.aborted) return Promise.resolve(originalPdf(source));
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const abort = () => {
        this.send({ type: 'pdf-cancel', id });
        finish(originalPdf(source));
      };
      const timer = setTimeout(abort, 23000);
      const finish = (plan: PdfPlan) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.pdfJobs.delete(id);
        resolve(plan);
      };
      this.pdfJobs.set(id, { source, finish });
      signal.addEventListener('abort', abort, { once: true });
      this.send({ type: 'pdf-prepare', id, source });
    });
  }
  translate(r: Request, cb: (e: TranslationEvent) => void) {
    this.callbacks.set(r.requestId, cb);
    this.submitted.set(r.requestId, Date.now());
    this.send({ type: 'translate', request: r });
    return r.requestId;
  }
  cancel(id: string) {
    this.send({ type: 'cancel', id });
    this.callbacks.delete(id);
    this.sequences.delete(id);
    this.submitted.delete(id);
  }
  pin(id: string, pinned: boolean) {
    this.send({ type: 'pin', id, pinned });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.reconnect);
    clearInterval(this.lease);
    const port = this.port;
    for (const [id, job] of this.pdfJobs) {
      try {
        port?.postMessage({ type: 'pdf-cancel', id });
      } catch {}
      job.finish(originalPdf(job.source));
    }
    this.port = undefined;
    for (const id of this.callbacks.keys()) {
      try {
        port?.postMessage({ type: 'cancel', id });
      } catch {}
    }
    this.callbacks.clear();
    this.sequences.clear();
    this.submitted.clear();
    try {
      port?.disconnect();
    } catch {
      /* Reload already invalidated this port. */
    }
  }
  async result(r: Request, signal?: AbortSignal): Promise<TranslationEvent> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const abort = () => {
        this.cancel(r.requestId);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.translate(r, (e) => {
        if (terminal(e)) {
          signal?.removeEventListener('abort', abort);
          if (e.type === 'error') reject(new AppError(e.code!));
          else resolve(e);
        }
      });
    });
  }
}
export async function ui(action: string, data: object = {}) {
  const result = await chrome.runtime.sendMessage({ channel: 'ui', action, ...data });
  if (!result?.ok) throw new AppError(result?.code ?? 'HOST_INTERRUPTED');
  return result;
}
