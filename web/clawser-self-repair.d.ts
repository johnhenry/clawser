import type { ToolResult } from './types.d.ts';
import { BrowserTool } from './clawser-tools.js';

export const DEFAULT_THRESHOLDS: Readonly<{
  toolTimeout: number;
  noProgress: number;
  loopDetection: number;
  contextPressure: number;
  consecutiveErrors: number;
  costRunaway: number;
}>;

export const ISSUE_TYPES: Readonly<{
  TOOL_TIMEOUT: 'tool_timeout';
  NO_PROGRESS: 'no_progress';
  LOOP_DETECTED: 'loop_detected';
  CONTEXT_PRESSURE: 'context_pressure';
  CONSECUTIVE_ERRORS: 'consecutive_errors';
  COST_RUNAWAY: 'cost_runaway';
}>;

export const RECOVERY_STRATEGIES: Readonly<Record<string, Array<{ action: string; description?: string; prompt?: string; maxRetries?: number }>>>;

export function findDuplicateSequences(calls: Array<{ name: string; arguments?: string }>): Array<{ name: string; arguments?: string }>;

export interface JobState {
  activeToolStart?: number;
  activeTool?: string;
  lastActivityAt?: number;
  recentToolCalls?: Array<{ name: string; arguments?: string }>;
  tokenUsage?: number;
  contextLimit?: number;
  consecutiveErrors?: number;
  turnCost?: number;
}

export interface DetectedIssue {
  type: string;
  [key: string]: unknown;
}

export class StuckDetector {
  constructor(thresholds?: Partial<typeof DEFAULT_THRESHOLDS>);
  detect(jobState: JobState): DetectedIssue[];
  get thresholds(): Record<string, number>;
  setThresholds(updates: Partial<typeof DEFAULT_THRESHOLDS>): void;
}

export class SelfRepairEngine {
  constructor(opts?: {
    detector?: StuckDetector;
    handlers?: Record<string, (strategy: unknown, issue: DetectedIssue, jobState: JobState) => Promise<boolean>>;
    onLog?: (level: number, msg: string) => void;
  });
  check(jobState: JobState): Promise<Array<{ issue: DetectedIssue; strategy: unknown; success: boolean }>>;
  set enabled(value: boolean);
  get enabled(): boolean;
  get detector(): StuckDetector;
  get repairLog(): Array<{ issue: DetectedIssue; strategy: unknown; success: boolean; timestamp: number }>;
  clearLog(): void;
  registerHandler(action: string, handler: (strategy: unknown, issue: DetectedIssue, jobState: JobState) => Promise<boolean>): void;
  hasHandler(action: string): boolean;
  unregisterHandler(action: string): boolean;
  getSummary(): { totalDetections: number; totalRecoveries: number; successRate: number; byType: Record<string, { detected: number; recovered: number }> };
}

export class SelfRepairStatusTool extends BrowserTool {
  constructor(engine: SelfRepairEngine);
  execute(): Promise<ToolResult>;
}

export class SelfRepairConfigureTool extends BrowserTool {
  constructor(engine: SelfRepairEngine);
  execute(params: { enabled?: boolean; toolTimeout?: number; noProgress?: number; loopDetection?: number; contextPressure?: number; consecutiveErrors?: number; costRunaway?: number }): Promise<ToolResult>;
}
