import type { ToolResult } from './types.d.ts';
import { BrowserTool } from './clawser-tools.js';

export const SANDBOX_TIERS: Readonly<{ TRUSTED: 0; WORKER: 1; WASM: 2 }>;
export const CAPABILITIES: Readonly<Record<string, { description: string; tier: number }>>;
export const SANDBOX_LIMITS: Readonly<Record<number, { timeout: number; maxMemory: number; maxOutputSize: number; fuelLimit?: number }>>;

export class CapabilityGate {
  constructor(capabilities?: string[]);
  get allowed(): string[];
  get size(): number;
  has(capability: string): boolean;
  check(capability: string): void;
  grant(capability: string): void;
  revoke(capability: string): void;
  validateForTier(tier: number): { valid: boolean; denied: string[] };
  createProxy(apis: Record<string, (...args: unknown[]) => unknown>): Record<string, (...args: unknown[]) => unknown>;
}

export const WORKER_CODE: string;

export class WorkerSandbox {
  constructor(opts?: { timeout?: number; createWorkerFn?: () => unknown });
  get active(): boolean;
  get pendingCount(): number;
  get execCount(): number;
  execute(code: string, args?: Record<string, unknown>, opts?: { timeout?: number }): Promise<unknown>;
  getLog(): Array<Record<string, unknown>>;
  clearLog(): void;
  terminate(): void;
}

export class WasmSandbox {
  constructor(opts?: { fuelLimit?: number; maxMemory?: number; timeout?: number; evalFn?: (code: string, args: Record<string, unknown>) => Promise<unknown> });
  get active(): boolean;
  get fuelConsumed(): number;
  get fuelLimit(): number;
  get fuelRemaining(): number;
  get maxMemory(): number;
  get execCount(): number;
  execute(code: string, args?: Record<string, unknown>): Promise<unknown>;
  resetFuel(): void;
  getLog(): Array<Record<string, unknown>>;
  clearLog(): void;
  terminate(): void;
}

export class SandboxManager {
  constructor(opts?: { onLog?: (msg: string) => void; createWorkerFn?: () => unknown; wasmEvalFn?: (code: string, args: Record<string, unknown>) => Promise<unknown> });
  get count(): number;
  create(name: string, opts?: { tier?: number; capabilities?: string[]; timeout?: number; fuelLimit?: number }): { sandbox: WorkerSandbox | WasmSandbox; gate: CapabilityGate };
  get(name: string): { sandbox: WorkerSandbox | WasmSandbox; tier: number; gate: CapabilityGate } | undefined;
  execute(name: string, code: string, args?: Record<string, unknown>): Promise<unknown>;
  terminate(name: string): boolean;
  terminateAll(): void;
  list(): Array<{ name: string; tier: number; active: boolean; execCount: number; capabilities: string[] }>;
}

export class SandboxRunTool extends BrowserTool {
  constructor(manager: SandboxManager);
  execute(params: { sandbox: string; code: string; args?: Record<string, unknown> }): Promise<ToolResult>;
}

export class SandboxStatusTool extends BrowserTool {
  constructor(manager: SandboxManager);
  execute(): Promise<ToolResult>;
}
