export interface FallbackEntry {
  providerId: string;
  model: string;
  priority: number;
  maxTokens?: number;
  enabled: boolean;
}

export function createFallbackEntry(opts: Partial<FallbackEntry> & { providerId: string; model: string }): FallbackEntry;

export class FallbackChain {
  constructor(opts?: { entries?: FallbackEntry[]; maxRetries?: number; retryableStatuses?: number[] });
  get maxRetries(): number;
  get entries(): FallbackEntry[];
  enabledEntries(): FallbackEntry[];
  add(entry: FallbackEntry): void;
  remove(providerId: string, model: string): void;
  toggle(providerId: string, model: string, enabled: boolean): void;
  isRetryable(err: Error): boolean;
  get length(): number;
  toJSON(): { entries: FallbackEntry[]; maxRetries: number; retryableStatuses: number[] };
  static fromJSON(data: { entries?: FallbackEntry[]; maxRetries?: number; retryableStatuses?: number[] }): FallbackChain;
}

export function backoff(attempt: number, base?: number, max?: number): number;
export function sleep(ms: number): Promise<void>;

export class FallbackExecutor {
  constructor(chain: FallbackChain, opts?: { health?: ProviderHealth; onLog?: (level: number, message: string) => void });
  execute<T>(fn: (providerId: string, model: string, maxTokens?: number) => Promise<T>): Promise<{ result: T; providerId: string; model: string }>;
  executeStream<T>(fn: (providerId: string, model: string, maxTokens?: number) => AsyncGenerator<T>): AsyncGenerator<{ chunk: T; providerId: string; model: string }>;
}

export interface HealthRecord {
  providerId: string;
  model: string;
  successCount: number;
  failureCount: number;
  lastFailure: number;
  avgLatencyMs: number;
  circuitOpen: boolean;
}

export class ProviderHealth {
  constructor(opts?: { failureThreshold?: number; failureWindow?: number; cooldown?: number });
  recordSuccess(providerId: string, model: string, durationMs: number): void;
  recordFailure(providerId: string, model: string, durationMs?: number): void;
  isCircuitOpen(providerId: string, model: string): boolean;
  getHealth(providerId: string, model: string): HealthRecord | null;
  reorder(entries: FallbackEntry[]): FallbackEntry[];
  reset(): void;
}

export const HINT_MODELS: Record<string, Record<string, string>>;

export class ModelRouter {
  setChain(hint: string, chain: FallbackChain): void;
  getChain(hint?: string): FallbackChain | null;
  set defaultChain(chain: FallbackChain | null);
  get defaultChain(): FallbackChain | null;
  get hints(): string[];
  buildDefaults(providerIds: string[]): void;
  toJSON(): Record<string, object>;
  static fromJSON(data: Record<string, object>): ModelRouter;
}

export function costAwareSort(entries: FallbackEntry[]): FallbackEntry[];
