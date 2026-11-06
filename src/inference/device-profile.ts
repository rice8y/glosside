import { MODEL } from './catalog';
export interface RuntimeConfig {
  threads: number;
  batch: 256 | 512;
}
export interface DeviceProfile extends RuntimeConfig {
  key: string;
  preference: 'auto' | 'cpu';
  backend: string;
  measuredAt: string;
  baselineMs: number;
  selectedMs: number;
}
export function defaultConfig(): RuntimeConfig {
  return {
    threads:
      globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
        ? Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 1))
        : 1,
    batch: 256,
  };
}
export function deviceKey(cpu: boolean) {
  return [
    MODEL.sha256,
    MODEL.runtime,
    'device-v1',
    cpu,
    navigator.hardwareConcurrency,
    globalThis.crossOriginIsolated,
    navigator.userAgent,
  ].join('|');
}
export function runtimeConfig(profile: DeviceProfile | undefined, cpu: boolean): RuntimeConfig {
  const fallback = defaultConfig();
  return profile?.key === deviceKey(cpu) &&
    Number.isInteger(profile.threads) &&
    profile.threads >= 1 &&
    profile.threads <= fallback.threads &&
    [256, 512].includes(profile.batch)
    ? { threads: profile.threads, batch: profile.batch }
    : fallback;
}
export function tuningCandidates(gpu: boolean): RuntimeConfig[] {
  const base = defaultConfig();
  return [
    base,
    ...(!gpu
      ? [2, 4].filter((n) => n < base.threads).map((threads) => ({ threads, batch: 256 as const }))
      : []),
    { ...base, batch: 512 as const },
  ];
}
