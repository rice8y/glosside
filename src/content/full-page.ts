import type { Client } from '../shared/client';
import { makeRequest } from '../shared/protocol';
import { translationChunks, translationSeparator } from '../inference/chunks';
import { AppError, errorCode } from '../shared/errors';
import { pageTextNodes, textContext } from './blocks';
import { isExtensionNode } from '../ui/dom';
import { t } from '../ui/locale';
import { OriginalPopup } from '../ui/original-popup';
import { PageProgress } from './page-progress';

interface Passage {
  node: Text;
  source: string;
  translated?: string;
  context?: string;
  state: 'queued' | 'running' | 'done' | 'error';
  error?: string;
  controller?: AbortController;
}
const LIMIT = 2000;

export class FullPage {
  private passages = new Map<Text, Passage>();
  private ownWrites = new WeakMap<Text, string[]>();
  private observer?: MutationObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private enabled = false;
  private epoch = crypto.randomUUID();
  private url = location.href;
  private progress?: PageProgress;
  private original?: OriginalPopup;
  private capped = false;
  constructor(private client: Client) {}

  start() {
    if (this.client.settings.panelOnly) {
      window.alert(
        t('Turn off “Show translations only in the side panel” to translate this page.'),
      );
      return;
    }
    if (this.enabled) {
      this.scan();
      return;
    }
    this.enabled = true;
    this.url = location.href;
    this.epoch = crypto.randomUUID();
    this.progress = new PageProgress(
      () => this.retryFailed(),
      () => this.restore(),
    );
    this.original = new OriginalPopup(
      (node) => {
        const passage = this.passages.get(node);
        return passage?.state === 'done' && node.isConnected && node.data === passage.translated
          ? passage.source
          : undefined;
      },
      () => this.client.settings.sourceLanguage || document.documentElement.lang,
    );
    this.observer = new MutationObserver((records) => this.mutations(records));
    this.observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      characterDataOldValue: true,
      attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'translate', 'contenteditable', 'class', 'style'],
    });
    window.addEventListener('popstate', this.navigation);
    window.addEventListener('hashchange', this.navigation);
    this.scan();
  }

  private navigation = () => this.scan();

  private mutations(records: MutationRecord[]) {
    let changed = false;
    for (const record of records) {
      if (isExtensionNode(record.target)) continue;
      if (record.type === 'characterData' && record.target instanceof Text) {
        const node = record.target;
        const writes = this.ownWrites.get(node);
        if (writes?.length && writes[0] === record.oldValue) {
          writes.shift();
          if (!writes.length) this.ownWrites.delete(node);
          continue;
        }
        // The page now owns this text. Never restore an older original over its update.
        this.passages.get(node)?.controller?.abort();
        this.passages.delete(node);
      } else if (record.type === 'childList') {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        if (nodes.length && nodes.every(isExtensionNode)) continue;
      }
      changed = true;
    }
    if (!changed) return;
    this.original?.refresh();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.scan(), 300);
  }

  private write(node: Text, value: string) {
    if (node.data === value) return;
    const writes = this.ownWrites.get(node) ?? [];
    writes.push(node.data);
    this.ownWrites.set(node, writes);
    node.data = value;
  }

  private release(passage: Passage) {
    passage.controller?.abort();
    if (passage.translated !== undefined && passage.node.data === passage.translated) {
      if (passage.node.isConnected) this.write(passage.node, passage.source);
      else {
        passage.node.data = passage.source;
        this.ownWrites.delete(passage.node);
      }
    }
    this.passages.delete(passage.node);
  }

  private readOriginal = (node: Text) => {
    const passage = this.passages.get(node);
    return passage?.translated === node.data ? passage.source : node.data;
  };

  private scan() {
    if (!this.enabled) return;
    clearTimeout(this.timer);
    // Consume pending page mutations before comparing or writing Text.data.
    this.mutations(this.observer?.takeRecords() ?? []);
    if (this.url !== location.href) {
      this.url = location.href;
      this.epoch = crypto.randomUUID();
      for (const passage of this.passages.values()) this.release(passage);
      this.original?.hide();
    }
    for (const passage of this.passages.values()) {
      if (!passage.node.isConnected || passage.node.data !== (passage.translated ?? passage.source))
        this.release(passage);
    }
    const candidates = pageTextNodes(
      this.client.settings.includeNavigation,
      this.readOriginal,
      LIMIT + 1,
    );
    const accepted = new Set(candidates.slice(0, LIMIT));
    for (const passage of this.passages.values())
      if (!accepted.has(passage.node)) this.release(passage);
    const contexts = new Map<Element, string>();
    for (const node of accepted) {
      if (this.passages.has(node)) continue;
      this.passages.set(node, {
        node,
        source: node.data,
        context: textContext(node, this.readOriginal, contexts),
        state: 'queued',
      });
    }
    this.capped = candidates.length > LIMIT;
    this.original?.refresh();
    this.update();
    void this.drain();
  }

  private retryFailed() {
    for (const passage of this.passages.values()) {
      if (passage.state !== 'error') continue;
      passage.state = 'queued';
      passage.error = undefined;
    }
    this.update();
    void this.drain();
  }

  private update() {
    const passages = [...this.passages.values()];
    const failures = passages.filter((passage) => passage.state === 'error');
    this.progress?.update({
      total: passages.length,
      done: passages.filter((passage) => passage.state === 'done').length,
      failed: failures.length,
      error: failures[0]?.error,
      capped: this.capped,
    });
  }

  private current(passage: Passage) {
    return (
      this.enabled &&
      !passage.controller?.signal.aborted &&
      this.passages.get(passage.node) === passage &&
      passage.node.isConnected &&
      passage.node.data === passage.source
    );
  }

  private async drain() {
    if (this.running || !this.enabled) return;
    this.running = true;
    try {
      while (this.enabled) {
        const pending = [...this.passages.values()].filter((passage) => passage.state === 'queued');
        const visible = (node: Text) => {
          const rect = node.parentElement?.getBoundingClientRect();
          return rect && rect.bottom > 0 && rect.top < innerHeight;
        };
        pending.sort((a, b) => Number(visible(b.node)) - Number(visible(a.node)));
        const passage = pending[0];
        if (!passage) break;
        passage.state = 'running';
        passage.controller = new AbortController();
        try {
          let translated = '';
          const parts = translationChunks(passage.source.trim(), 16000);
          for (const [index, part] of parts.entries()) {
            const request = await makeRequest(part, this.client.settings, {
              sessionId: this.client.id,
              documentEpoch: this.epoch,
              mode: 'page',
              surface: 'html',
              priority: visible(passage.node) ? 2 : 3,
              ...(passage.context ? { context: passage.context } : {}),
            });
            if (!this.current(passage)) break;
            const result = await this.client.result(request, passage.controller.signal);
            if (result.type !== 'complete') throw new AppError('OUTPUT_LIMIT');
            if (!result.text?.trim() || result.text.includes('<|plamo:'))
              throw new AppError('INVALID_TRANSLATION');
            translated += result.text.trim();
            if (index + 1 < parts.length)
              translated += translationSeparator(
                part,
                parts[index + 1],
                this.client.settings.targetLanguage,
              );
          }
          this.mutations(this.observer?.takeRecords() ?? []);
          if (!this.current(passage)) continue;
          // Preserve exact whitespace around each node, along with element identity,
          // attributes, listeners and form state. Model output never becomes markup.
          const prefix = passage.source.match(/^\s*/u)![0];
          const suffix = passage.source.match(/\s*$/u)![0];
          passage.translated = prefix + translated + suffix;
          this.write(passage.node, passage.translated);
          passage.state = 'done';
        } catch (error) {
          if (!this.current(passage)) continue;
          passage.state = 'error';
          passage.error = errorCode(error);
        }
        this.update();
      }
    } finally {
      this.running = false;
      // A restore/start sequence can enqueue work while a cancelled request settles.
      if (this.enabled && [...this.passages.values()].some((passage) => passage.state === 'queued'))
        void this.drain();
    }
  }

  restore() {
    this.enabled = false;
    this.epoch = crypto.randomUUID();
    this.mutations(this.observer?.takeRecords() ?? []);
    this.observer?.disconnect();
    clearTimeout(this.timer);
    window.removeEventListener('popstate', this.navigation);
    window.removeEventListener('hashchange', this.navigation);
    for (const passage of this.passages.values()) this.release(passage);
    this.ownWrites = new WeakMap();
    this.original?.destroy();
    this.original = undefined;
    this.progress?.destroy();
    this.progress = undefined;
  }
}
