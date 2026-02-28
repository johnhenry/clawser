export function percentile(sorted: number[], p: number): number;

export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, {
    count: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  }>;
  timestamp: number;
}

export class MetricsCollector {
  constructor(opts?: { histogramCapacity?: number });
  increment(name: string, value?: number): void;
  gauge(name: string, value: number): void;
  observe(name: string, value: number): void;
  counter(name: string): number;
  getGauge(name: string): number | undefined;
  histogram(name: string): number[];
  snapshot(): MetricsSnapshot;
  reset(): void;
}

export const LOG_LEVELS: Readonly<{ debug: 0; info: 1; warn: 2; error: 3 }>;

export interface LogEntry {
  level?: number;
  source?: string;
  message?: string;
  data?: unknown;
  timestamp?: number;
  seq?: number;
}

export class RingBufferLog {
  constructor(capacity?: number);
  push(entry: Omit<LogEntry, 'timestamp' | 'seq'>): void;
  query(opts?: { level?: number; source?: string; pattern?: string; limit?: number }): LogEntry[];
  toArray(): LogEntry[];
  get size(): number;
  get capacity(): number;
  clear(): void;
}

export function exportMetricsJSON(snapshot: MetricsSnapshot): string;
export function exportMetricsOTLP(snapshot: MetricsSnapshot, serviceName?: string): object;
