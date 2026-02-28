/**
 * Type definitions for clawser-state.js
 * Shared state singleton, DOM helpers, event bus
 */

// ── Configurable Defaults ──────────────────────────────────────

export declare const DEFAULTS: Readonly<{
  maxResultLength: number;
  maxHistoryTokens: number;
  contextCompactThreshold: number;
  maxTokens: number;
  costTrackingPrecision: number;
  memoryRecallCacheSize: number;
  memoryRecallCacheTTL: number;
  configCacheDebounceMs: number;
  codeExecTimeoutMs: number;
  mcpTimeoutMs: number;
  maxSchedulerJobs: number;
  filePageSize: number;
  debugMode: boolean;
  maxToolIterations: number;
  cacheMaxEntries: number;
  cacheTtlMs: number;
  maxFileWriteSize: number;
}>;

// ── Debug logging ──────────────────────────────────────────────

export declare const clawserDebug: {
  readonly enabled: boolean;
  enable(): void;
  disable(): void;
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
};

// ── localStorage key builders ──────────────────────────────────

export declare const lsKey: {
  memories(wsId: string): string;
  config(wsId: string): string;
  toolPerms(wsId: string): string;
  security(wsId: string): string;
  skillsEnabled(wsId: string): string;
  autonomy(wsId: string): string;
  identity(wsId: string): string;
  selfRepair(wsId: string): string;
  sandbox(wsId: string): string;
  heartbeat(wsId: string): string;
  routines(wsId: string): string;
  termSessions(wsId: string): string;
};

// ── DOM helpers ────────────────────────────────────────────────

export declare function $(id: string): HTMLElement | null;
export declare function esc(s: string): string;

// ── Migration ──────────────────────────────────────────────────

export declare function migrateLocalStorageKeys(): void;

// ── State singleton ────────────────────────────────────────────

export declare const state: {
  ui: {
    isSending: boolean;
    currentRoute: string | null;
    switchingViaRouter: boolean;
    slashSelectedIdx: number;
    pendingImportBlob: Blob | null;
    cmdSelectedSpec: object | null;
  };
  services: {
    agent: unknown | null;
    providers: unknown | null;
    browserTools: unknown | null;
    mcpManager: unknown | null;
    vault: unknown | null;
    workspaceFs: unknown | null;
    responseCache: unknown | null;
    shell: unknown | null;
    skillRegistry: unknown | null;
  };
  features: {
    toolBuilder: unknown | null;
    channelManager: unknown | null;
    delegateManager: unknown | null;
    gitBehavior: unknown | null;
    gitMemory: unknown | null;
    automationManager: unknown | null;
    sandboxManager: unknown | null;
    peripheralManager: unknown | null;
    pairingManager: unknown | null;
    bridgeManager: unknown | null;
    goalManager: unknown | null;
    skillRegistryClient: unknown | null;
    terminalSessions: unknown | null;
    agentStorage: unknown | null;
  };
  session: {
    sessionCost: number;
    activeConversationId: string | null;
    activeConversationName: string | null;
    activeSkillPrompts: Map<string, string>;
    toolCallLog: unknown[];
    eventLog: unknown[];
    eventCount: number;
    pendingInlineTools: Map<string, unknown>;
  };
  agentInitialized: boolean;
  identityManager: unknown | null;
  toolUsageStats: Record<string, unknown>;
  toolLastUsed: Record<string, unknown>;
  /** Backward-compatible flat aliases (deprecated) */
  [key: string]: unknown;
};

// ── State transition helpers ───────────────────────────────────

export declare function setSending(value: boolean): void;
export declare function setConversation(id: string | null, name: string | null): void;
export declare function resetConversationState(): void;

// ── Event bus ──────────────────────────────────────────────────

export declare function on(event: string, fn: (...args: unknown[]) => void): void;
export declare function off(event: string, fn: (...args: unknown[]) => void): void;
export declare function emit(event: string, ...args: unknown[]): void;

// ── ConfigCache ────────────────────────────────────────────────

export declare class ConfigCache {
  constructor(debounceMs?: number);
  get(key: string): string | null;
  set(key: string, value: string | null): void;
  remove(key: string): void;
  flush(): void;
  invalidate(key: string): void;
  clear(): void;
}

export declare const configCache: ConfigCache;
