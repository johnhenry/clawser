import type { ToolResult } from './types.d.ts';
import { BrowserTool } from './clawser-tools.js';

export interface TurnCheckpoint {
  turnId: string;
  timestamp: number;
  snapshot: {
    historyLength: number;
    memoryOps: Array<Record<string, unknown>>;
    fileOps: Array<Record<string, unknown>>;
    goalOps: Array<Record<string, unknown>>;
  };
}

export interface UndoResult {
  turnId: string;
  reverted: boolean;
  details: {
    messagesRemoved: number;
    memoryOpsReverted: number;
    fileOpsReverted: number;
    goalOpsReverted: number;
  };
}

export interface UndoHandlers {
  revertHistory?: (historyLength: number) => Promise<number>;
  revertMemory?: (op: Record<string, unknown>) => Promise<void>;
  revertFile?: (op: Record<string, unknown>) => Promise<void>;
  revertGoal?: (op: Record<string, unknown>) => Promise<void>;
  applyMemory?: (op: Record<string, unknown>) => Promise<void>;
  applyFile?: (op: Record<string, unknown>) => Promise<void>;
  applyGoal?: (op: Record<string, unknown>) => Promise<void>;
}

export function resetTurnCounter(): void;
export function createCheckpoint(opts?: Partial<TurnCheckpoint>): TurnCheckpoint;

export class UndoManager {
  constructor(opts?: { maxHistory?: number; handlers?: UndoHandlers });
  beginTurn(opts?: { historyLength?: number }): TurnCheckpoint;
  recordMemoryOp(op: Record<string, unknown>): void;
  recordFileOp(op: Record<string, unknown>): void;
  recordGoalOp(op: Record<string, unknown>): void;
  undo(turns?: number): Promise<UndoResult[]>;
  get canUndo(): boolean;
  get undoDepth(): number;
  get currentCheckpoint(): TurnCheckpoint | null;
  get checkpoints(): Array<{ turnId: string; timestamp: number; memoryOps: number; fileOps: number; goalOps: number }>;
  clear(): void;
  get maxHistory(): number;
  set maxHistory(n: number);
  previewUndo(turns?: number): string;
  get canRedo(): boolean;
  get redoDepth(): number;
  previewRedo(): { id: string; ops: number } | null;
  redo(turns?: number): Promise<TurnCheckpoint[]>;
}

export class UndoTool extends BrowserTool {
  constructor(manager: UndoManager);
  execute(params?: { turns?: number }): Promise<ToolResult>;
}

export class UndoStatusTool extends BrowserTool {
  constructor(manager: UndoManager);
  execute(params?: { preview_turns?: number }): Promise<ToolResult>;
}

export class RedoTool extends BrowserTool {
  constructor(manager: UndoManager);
  execute(params?: { turns?: number }): Promise<ToolResult>;
}
