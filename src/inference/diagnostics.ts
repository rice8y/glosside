import { validMetric, type MetricName } from '../shared/metrics';

export class Diagnostics {
  private samples = new Map<MetricName, number[]>();
  private cache = { hits: 0, misses: 0 };
  record(name: unknown, ms: unknown) {
    if (!validMetric(name, ms)) return;
    const values = this.samples.get(name) ?? [];
    values.push(ms as number);
    if (values.length > 64) values.shift();
    this.samples.set(name, values);
  }
  result(timings: Record<string, number> = {}, hit = false) {
    this.cache[hit ? 'hits' : 'misses']++;
    for (const [name, ms] of Object.entries(timings)) this.record(name, ms);
  }
  snapshot() {
    return {
      cache: { ...this.cache },
      durations: Object.fromEntries(
        [...this.samples].map(([name, values]) => {
          const sorted = [...values].sort((a, b) => a - b);
          const at = (p: number) =>
            Math.round(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]);
          return [name, { samples: sorted.length, medianMs: at(0.5), p95Ms: at(0.95) }];
        }),
      ),
    };
  }
}
