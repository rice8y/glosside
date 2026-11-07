// Only named durations cross this boundary. Never accept text, URLs or document IDs.
export const metricNames = [
  'pdfSelectionMs',
  'pdfGeometryMs',
  'pdfReflowMs',
  'clickToResultMs',
  'queueMs',
  'prepareMs',
  'planMs',
  'firstTokenMs',
  'generationMs',
  'prefillMs',
  'decodeMs',
  'totalMs',
] as const;
export type MetricName = (typeof metricNames)[number];
export function validMetric(name: unknown, ms: unknown): name is MetricName {
  return (
    metricNames.includes(name as MetricName) &&
    typeof ms === 'number' &&
    Number.isFinite(ms) &&
    ms >= 0 &&
    ms <= 600000
  );
}
export function measure(name: MetricName, start: number) {
  reportMetric(name, performance.now() - start);
}
export function reportMetric(name: MetricName, ms: number) {
  if (!validMetric(name, ms)) return;
  try {
    void chrome.runtime.sendMessage({ channel: 'metric', name, ms }).catch(() => {});
  } catch {
    /* Reloaded extension. */
  }
}
