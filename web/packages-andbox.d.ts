export interface SandboxOptions {
  mode?: 'worker' | 'inline' | 'data-uri';
  globals?: Record<string, unknown>;
  capabilities?: Record<string, Function>;
  importMap?: {
    imports?: Record<string, string>;
    scopes?: Record<string, Record<string, string>>;
  };
  defaultTimeoutMs?: number;
  baseURL?: string;
  policy?: import('./packages/andbox/src/capability-gate.mjs').GatePolicy;
  onConsole?: (level: string, ...args: string[]) => void;
}

export interface ExecuteResult {
  success: boolean;
  output: string;
  returnValue?: unknown;
  error?: string;
}

export interface InlineSandbox {
  execute(code: string, opts?: { timeout?: number }): Promise<ExecuteResult>;
  terminate(): void;
}

export interface WorkerSandbox {
  evaluate(code: string, opts?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    onConsole?: (level: string, ...args: string[]) => void;
  }): Promise<unknown>;
  defineModule(name: string, source: string): Promise<void>;
  dispose(): Promise<void>;
  stats(): {
    disposed: boolean;
    pendingEvaluations: number;
    virtualModules: string[];
    gate: Record<string, unknown>;
  };
  isDisposed(): boolean;
}

export type Sandbox = InlineSandbox | WorkerSandbox;

export declare function createSandbox(opts: SandboxOptions & { mode: 'inline' }): InlineSandbox;
export declare function createSandbox(opts: SandboxOptions & { mode: 'data-uri' }): InlineSandbox;
export declare function createSandbox(opts?: SandboxOptions): Promise<WorkerSandbox>;

export { resolveWithImportMap } from './packages/andbox/src/import-map-resolver.mjs';
export { gateCapabilities } from './packages/andbox/src/capability-gate.mjs';
export { createStdio } from './packages/andbox/src/stdio.mjs';
export { createNetworkFetch } from './packages/andbox/src/network-policy.mjs';
export { makeDeferred, makeAbortError, makeTimeoutError } from './packages/andbox/src/deferred.mjs';
export { makeWorkerSource } from './packages/andbox/src/worker-source.mjs';
export { DEFAULT_TIMEOUT_MS, DEFAULT_LIMITS, DEFAULT_CAPABILITY_LIMITS } from './packages/andbox/src/constants.mjs';
