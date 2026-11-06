import { AppError } from '../shared/errors';
import { MODEL } from '../inference/catalog';
import { PROMPT_VERSION } from '../inference/prompt';
import { hash } from '../shared/protocol';
import type { Request, TranslationEvent } from '../shared/types';
export interface Runner {
  run(
    r: Request,
    signal: AbortSignal,
    emit: (text: string) => void,
  ): Promise<{
    text: string;
    complete: boolean;
    warnings?: string[];
    timings?: Record<string, number>;
  }>;
}
interface Job {
  owner: string;
  r: Request;
  seq: number;
  text: string;
  event: TranslationEvent;
  abort: AbortController;
  preempted: boolean;
  created: number;
}
export class Scheduler {
  jobs = new Map<string, Job>();
  queue: Job[] = [];
  active?: Job;
  private cache = new Map<string, { text: string; owner: string; expires: number }>();
  private cacheBytes = 0;
  constructor(
    private runner: Runner,
    private send: (owner: string, event: TranslationEvent) => void,
    private measured: (timings: Record<string, number>, hit: boolean) => void = () => {},
  ) {}
  private emit(j: Job, event: Omit<TranslationEvent, 'requestId' | 'sequence'>) {
    j.event = { ...event, requestId: j.r.requestId, sequence: ++j.seq };
    this.send(j.owner, j.event);
  }
  async submit(owner: string, r: Request) {
    const existing = this.jobs.get(r.requestId);
    if (existing) {
      if (
        existing.owner !== owner ||
        existing.r.documentEpoch !== r.documentEpoch ||
        existing.r.sourceContentHash !== r.sourceContentHash
      )
        throw new AppError('INVALID_REQUEST');
      this.send(owner, existing.event);
      return;
    }
    if (
      this.queue.length >= 128 ||
      [...this.jobs.values()].filter((j) => j.owner === owner && !this.isDone(j)).length >= 32
    )
      throw new AppError('QUEUE_FULL');
    for (const j of this.jobs.values())
      if (
        j.owner === owner &&
        r.mode === 'selection' &&
        j.r.mode === 'selection' &&
        !j.r.pinned &&
        !this.isDone(j)
      )
        this.cancel(owner, j.r.requestId, 'superseded');
    const j: Job = {
      owner,
      r,
      seq: 0,
      text: '',
      event: { type: 'accepted', requestId: r.requestId, sequence: 0 },
      abort: new AbortController(),
      preempted: false,
      created: Date.now(),
    };
    this.jobs.set(r.requestId, j);
    this.emit(j, { type: 'accepted' });
    this.queue.push(j);
    this.queue.sort((a, b) => a.r.priority - b.r.priority || a.created - b.created);
    if (this.active && r.priority < this.active.r.priority) {
      this.active.preempted = true;
      this.active.abort.abort();
    }
    void this.drain();
    this.prune();
  }
  private isDone(j: Job) {
    return ['complete', 'incomplete', 'error'].includes(j.event.type);
  }
  cancel(owner: string, id: string, reason = 'cancelled') {
    const j = this.jobs.get(id);
    if (!j || j.owner !== owner || this.isDone(j)) return;
    j.preempted = false;
    j.abort.abort();
    this.queue = this.queue.filter((q) => q !== j);
    this.emit(j, { type: 'incomplete', text: j.text, reason });
  }
  cancelOwner(owner: string) {
    for (const j of this.jobs.values()) if (j.owner === owner) this.cancel(owner, j.r.requestId);
    for (const [id, j] of this.jobs) if (j.owner === owner) this.jobs.delete(id);
    for (const [key, entry] of this.cache) if (entry.owner === owner) this.removeCached(key);
  }
  snapshot(owner: string) {
    for (const j of this.jobs.values()) if (j.owner === owner) this.send(owner, j.event);
  }
  pin(owner: string, id: string, pinned: boolean) {
    const j = this.jobs.get(id);
    if (j?.owner === owner) j.r.pinned = pinned;
  }
  clearCache() {
    this.cache.clear();
    this.cacheBytes = 0;
  }
  busy() {
    return !!this.active || this.queue.length > 0;
  }
  prune() {
    for (const [key, entry] of this.cache) if (entry.expires <= Date.now()) this.removeCached(key);
    for (const [id, j] of this.jobs)
      if (this.isDone(j) && (Date.now() - j.created > 120000 || this.jobs.size > 256))
        this.jobs.delete(id);
  }
  private removeCached(key: string) {
    const entry = this.cache.get(key);
    if (entry) this.cacheBytes -= entry.text.length * 2;
    this.cache.delete(key);
  }
  private async key(r: Request) {
    return hash(
      JSON.stringify([
        MODEL.sha256,
        PROMPT_VERSION,
        MODEL.runtime,
        'budget-reflow-v2',
        r.translationText,
        r.context,
        r.sourceLanguage,
        r.targetLanguage,
        r.japaneseForm,
        r.glossary,
      ]),
    );
  }
  private async drain() {
    if (this.active) return;
    const j = this.queue.shift();
    if (!j) return;
    this.active = j;
    try {
      this.prune();
      // Cache stays within a client/document, including incognito identity.
      const key = j.owner + ':' + (await this.key(j.r));
      if (j.abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const cached = this.cache.get(key);
      if (cached !== undefined) {
        this.cache.delete(key);
        this.cache.set(key, cached); // LRU; fixed expiry is deliberately not extended.
        j.text = cached.text;
        this.measured({ queueMs: Date.now() - j.created }, true);
        this.emit(j, { type: 'complete', text: cached.text });
      } else {
        const queueMs = Date.now() - j.created;
        this.emit(j, { type: 'status', state: 'PREFILL' });
        const result = await this.runner.run(j.r, j.abort.signal, (text) => {
          if (!j.abort.signal.aborted) {
            j.text = text;
            this.emit(j, { type: 'snapshot', text });
          }
        });
        if (!j.abort.signal.aborted) {
          this.measured({ ...result.timings, queueMs }, false);
          j.text = result.text;
          this.emit(j, {
            type: result.complete ? 'complete' : 'incomplete',
            text: result.text,
            reason: result.complete ? undefined : 'output-limit',
            warnings: result.warnings,
          });
          if (result.complete && !result.warnings?.length) {
            this.removeCached(key);
            this.cache.set(key, {
              text: result.text,
              owner: j.owner,
              expires: Date.now() + 600000,
            });
            this.cacheBytes += result.text.length * 2;
            while (this.cache.size > 256 || this.cacheBytes > 2 * 1024 * 1024) {
              const first = this.cache.keys().next().value!;
              this.removeCached(first);
            }
          }
        }
      }
    } catch (e) {
      if (j.preempted && !this.isDone(j)) {
        j.preempted = false;
        j.abort = new AbortController();
        j.text = '';
        this.emit(j, { type: 'status', state: 'QUEUED' });
        this.queue.push(j);
        this.queue.sort((a, b) => a.r.priority - b.r.priority || a.created - b.created);
      } else if (!this.isDone(j))
        this.emit(j, { type: 'error', code: e instanceof AppError ? e.code : 'HOST_INTERRUPTED' });
    } finally {
      this.active = undefined;
      this.prune();
      void this.drain();
    }
  }
}
