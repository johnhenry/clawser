/**
 * Type definitions for clawser-goals.js
 * Goal Artifacts & Sub-goals
 */

import type { ToolResult } from './types.d.ts';

// ── Types ──────────────────────────────────────────────────────

export type GoalStatus = 'active' | 'paused' | 'completed' | 'failed';
export type GoalPriority = 'low' | 'medium' | 'high' | 'critical';

export interface ProgressLogEntry {
  timestamp: number;
  note: string;
}

export interface GoalJSON {
  id: string;
  description: string;
  status: GoalStatus;
  priority: GoalPriority;
  parentId: string | null;
  subGoalIds: string[];
  artifacts: string[];
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  progressLog: ProgressLogEntry[];
}

export interface GoalOpts {
  id?: string;
  description?: string;
  status?: GoalStatus;
  priority?: GoalPriority;
  parentId?: string | null;
  subGoalIds?: string[];
  artifacts?: string[];
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number | null;
  progressLog?: ProgressLogEntry[];
}

// ── Goal ───────────────────────────────────────────────────────

export declare function resetGoalIdCounter(): void;

export declare class Goal {
  id: string;
  description: string;
  status: GoalStatus;
  priority: GoalPriority;
  parentId: string | null;
  subGoalIds: string[];
  artifacts: string[];
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  progressLog: ProgressLogEntry[];

  constructor(opts?: GoalOpts);

  get isLeaf(): boolean;
  get isRoot(): boolean;

  toJSON(): GoalJSON;
  static fromJSON(data: GoalJSON | GoalOpts): Goal;
}

// ── GoalManager ────────────────────────────────────────────────

export interface GoalListOptions {
  status?: GoalStatus | 'all';
  parentId?: string;
  rootOnly?: boolean;
}

export declare class GoalManager {
  addGoal(description: string, opts?: { parentId?: string; priority?: GoalPriority }): Goal;
  get(id: string): Goal | null;
  updateStatus(id: string, status: GoalStatus, progressNote?: string): Goal | null;
  addSubGoal(parentId: string, description: string, opts?: { priority?: GoalPriority }): Goal | null;
  decompose(goalId: string, subtasks: string[]): Goal[];
  onCompletion(fn: (goal: Goal) => void): () => void;
  addArtifact(goalId: string, filePath: string): boolean;
  removeArtifact(goalId: string, filePath: string): boolean;
  logProgress(goalId: string, note: string): boolean;
  progress(goalId: string): number;
  depth(goalId: string): number;
  list(opts?: GoalListOptions): Goal[];
  remove(id: string): boolean;
  get size(): number;
  buildPrompt(): string;
  addDependency(goalId: string, dependsOnId: string): boolean;
  removeDependency(goalId: string, dependsOnId: string): boolean;
  isBlocked(goalId: string): boolean;
  toMarkdown(): string;
  static fromMarkdown(md: string): GoalManager;
  toJSON(): GoalJSON[];
  fromJSON(data: GoalJSON[]): void;
}

// ── Agent Tools ────────────────────────────────────────────────

import type { BrowserTool } from './clawser-tools.d.ts';

export declare class GoalAddTool extends BrowserTool {
  constructor(manager: GoalManager);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { description: string; parent_id?: string; priority?: GoalPriority }): Promise<ToolResult>;
}

export declare class GoalUpdateTool extends BrowserTool {
  constructor(manager: GoalManager);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { goal_id: string; status: GoalStatus; progress_note?: string }): Promise<ToolResult>;
}

export declare class GoalAddArtifactTool extends BrowserTool {
  constructor(manager: GoalManager);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { goal_id: string; file_path: string }): Promise<ToolResult>;
}

export declare class GoalRemoveArtifactTool extends BrowserTool {
  constructor(manager: GoalManager);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { goal_id: string; file_path: string }): Promise<ToolResult>;
}

export declare class GoalListTool extends BrowserTool {
  constructor(manager: GoalManager);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params?: { status?: GoalStatus | 'all'; parent_id?: string }): Promise<ToolResult>;
}

export declare class GoalDecomposeTool extends BrowserTool {
  constructor(manager: GoalManager);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { goal_id: string; subtasks: string[] }): Promise<ToolResult>;
}
