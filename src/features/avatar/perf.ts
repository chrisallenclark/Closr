/**
 * Layer load timings measured on the device (what a TestFlight tester actually experiences):
 * how long each mannequin layer takes to appear after a switch, and whether it came from the
 * on-device cache. Shown on Profile in diagnostics builds (EXPO_PUBLIC_CLOSR_DIAGNOSTICS=1).
 */
export interface LayerLoad {
  ms: number;
  cache: 'none' | 'disk' | 'memory';
}

const loads: LayerLoad[] = [];
const listeners = new Set<() => void>();
let version = 0;
let snapshot: { version: number; summary: ReturnType<typeof summarize> } = { version: -1, summary: null };

export const diagnosticsEnabled = process.env.EXPO_PUBLIC_CLOSR_DIAGNOSTICS === '1';

export function recordLayerLoad(load: LayerLoad): void {
  loads.push(load);
  if (loads.length > 300) loads.shift();
  version++;
  listeners.forEach((l) => l());
}

export function subscribeLayerLoads(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A stable snapshot for useSyncExternalStore: the same object until another load is recorded. */
export function layerLoadSummary() {
  if (snapshot.version !== version) snapshot = { version, summary: summarize() };
  return snapshot.summary;
}

function summarize() {
  if (!loads.length) return null;
  const sorted = loads.map((l) => l.ms).sort((a, b) => a - b);
  const pct = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!);
  const cached = loads.filter((l) => l.cache !== 'none').length;
  return { count: loads.length, medianMs: pct(0.5), p90Ms: pct(0.9), cachedShare: cached / loads.length };
}
