import type { ToolResult } from './types.d.ts';
import { BrowserTool } from './clawser-tools.js';

export const TRIGGER_TYPES: Readonly<{ CRON: 'cron'; EVENT: 'event'; WEBHOOK: 'webhook' }>;
export const ACTION_TYPES: Readonly<{ PROMPT: 'prompt'; TOOL: 'tool'; CHAIN: 'chain' }>;
export const DEFAULT_GUARDRAILS: Readonly<{
  maxRunsPerHour: number;
  maxCostPerRun: number;
  timeoutMs: number;
  requireApproval: boolean;
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
  retryOnFailure: number;
}>;
export const AUTO_DISABLE_THRESHOLD: number;

export function resetRoutineCounter(): void;

export interface RoutineDefinition {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { type: string; cron: string | null; event: string | null; filter: Record<string, unknown> | null; webhookPath: string | null };
  action: { type: string; prompt: string | null; tool: string | null; args: unknown | null; steps: unknown | null };
  guardrails: Record<string, unknown>;
  state: { lastRun: number | null; lastResult: string | null; runCount: number; consecutiveFailures: number; runsThisHour: number; hourStart: number | null; history: unknown[] };
}

export function createRoutine(opts?: Partial<RoutineDefinition>): RoutineDefinition;
export function matchFilter(filter: Record<string, unknown> | null, payload: Record<string, unknown> | null): boolean;

export class RoutineEngine {
  constructor(opts?: { executeFn?: (routine: RoutineDefinition, triggerEvent: unknown) => Promise<unknown>; onNotify?: (routine: RoutineDefinition, message: string) => void; onLog?: (message: string) => void; tickInterval?: number });
  get running(): boolean;
  get routineCount(): number;
  addRoutine(opts: Partial<RoutineDefinition>): RoutineDefinition;
  getRoutine(id: string): RoutineDefinition | undefined;
  listRoutines(): RoutineDefinition[];
  removeRoutine(id: string): boolean;
  setEnabled(id: string, enabled: boolean): boolean;
  enableRoutine(id: string): boolean;
  disableRoutine(id: string): boolean;
  start(): void;
  stop(): void;
  handleEvent(eventType: string, payload?: Record<string, unknown>): Promise<Array<{ routineId: string; result: string }>>;
  handleWebhook(path: string, payload?: Record<string, unknown>): Promise<{ routineId: string; result: string } | null>;
  triggerManual(id: string): Promise<string>;
  tickCron(now?: Date): Promise<Array<{ routineId: string; result: string }>>;
  connectEventBus(bus: EventTarget): void;
  disconnectEventBus(): void;
  updateRoutine(id: string, updates: Partial<Pick<RoutineDefinition, 'name' | 'trigger' | 'action' | 'enabled' | 'guardrails'>>): boolean;
  toJSON(): RoutineDefinition[];
  fromJSON(data: RoutineDefinition[]): void;
}

export class RoutineCreateTool extends BrowserTool {
  constructor(engine: RoutineEngine);
  execute(params: { name: string; trigger_type?: string; cron?: string; event?: string; prompt?: string; max_runs_per_hour?: number }): Promise<ToolResult>;
}

export class RoutineListTool extends BrowserTool {
  constructor(engine: RoutineEngine);
  execute(): Promise<ToolResult>;
}

export class RoutineDeleteTool extends BrowserTool {
  constructor(engine: RoutineEngine);
  execute(params: { id: string }): Promise<ToolResult>;
}

export class RoutineHistoryTool extends BrowserTool {
  constructor(engine: RoutineEngine);
  execute(params: { id: string; limit?: number }): Promise<ToolResult>;
}

export class RoutineRunTool extends BrowserTool {
  constructor(engine: RoutineEngine);
  execute(params: { id: string }): Promise<ToolResult>;
}

export class RoutineToggleTool extends BrowserTool {
  constructor(engine: RoutineEngine);
  execute(params: { routine_id: string; enabled: boolean }): Promise<ToolResult>;
}

export class RoutineUpdateTool extends BrowserTool {
  constructor(engine: RoutineEngine);
  execute(params: { routine_id: string; name?: string; trigger?: object; action?: object }): Promise<ToolResult>;
}
