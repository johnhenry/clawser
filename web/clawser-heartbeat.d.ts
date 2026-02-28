import type { ToolResult } from './types.d.ts';
import { BrowserTool } from './clawser-tools.js';

export const INTERVAL_WAKE: 'wake';
export const DEFAULT_HEARTBEAT: string;

export interface CheckItem {
  description: string;
  code: string | null;
  interval: number | 'wake';
  lastRun: number | null;
  lastResult: boolean | null;
  consecutiveFailures: number;
}

export interface CheckStatus {
  description: string;
  interval: number | 'wake';
  lastRun: number | null;
  passed: boolean | null;
  consecutiveFailures: number;
}

export function parseChecklist(md: string): CheckItem[];

export const ALERT_STRATEGIES: Readonly<{
  log(failures: CheckItem[]): void;
  format(failures: CheckItem[]): string;
}>;

export class HeartbeatRunner {
  constructor(opts?: { onAlert?: (failures: CheckItem[]) => void; evalFn?: (code: string) => Promise<boolean> });
  loadChecklist(md: string): void;
  loadDefault(): void;
  get running(): boolean;
  get checkCount(): number;
  get checks(): CheckItem[];
  get status(): CheckStatus[];
  runGroup(interval: number | 'wake'): Promise<CheckItem[]>;
  runAll(): Promise<CheckItem[]>;
  onWake(): Promise<CheckItem[]>;
  stop(): void;
  clear(): void;
}

export class HeartbeatStatusTool extends BrowserTool {
  constructor(runner: HeartbeatRunner);
  execute(): Promise<ToolResult>;
}

export class HeartbeatRunTool extends BrowserTool {
  constructor(runner: HeartbeatRunner);
  execute(params?: { group?: string }): Promise<ToolResult>;
}
