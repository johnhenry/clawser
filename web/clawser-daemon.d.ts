/**
 * Type definitions for clawser-daemon.js
 * — Daemon Mode: Background Execution, Multi-Tab, Checkpoint/Resume.
 */

import type { ToolResult } from './types.d.ts';

// ── DaemonPhase ──────────────────────────────────────────────

export declare const DaemonPhase: Readonly<{
  STOPPED: 'stopped';
  STARTING: 'starting';
  RUNNING: 'running';
  CHECKPOINTING: 'checkpointing';
  PAUSED: 'paused';
  RECOVERING: 'recovering';
  ERROR: 'error';
}>;

export type DaemonPhaseValue =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'checkpointing'
  | 'paused'
  | 'recovering'
  | 'error';

// ── DaemonState ──────────────────────────────────────────────

export interface DaemonTransition {
  from: DaemonPhaseValue;
  to: DaemonPhaseValue;
  timestamp: number;
}

export declare class DaemonState {
  constructor(opts?: {
    onChange?: (newPhase: DaemonPhaseValue, oldPhase: DaemonPhaseValue) => void;
  });

  get phase(): DaemonPhaseValue;
  get isRunning(): boolean;

  /**
   * Transition to a new phase.
   * @returns Whether the transition succeeded.
   */
  transition(newPhase: DaemonPhaseValue): boolean;

  /** Get transition history. */
  get history(): DaemonTransition[];

  /** Reset to stopped. */
  reset(): void;
}

// ── CheckpointManager ────────────────────────────────────────

export interface CheckpointMeta {
  id: string;
  timestamp: number;
  reason: string;
  size: number;
}

export interface CheckpointRestoreResult {
  meta: CheckpointMeta;
  state: unknown;
}

export declare class CheckpointManager {
  constructor(opts?: {
    maxCheckpoints?: number;
    writeFn?: (key: string, data: unknown) => Promise<void>;
    readFn?: (key: string) => Promise<unknown | null>;
  });

  /**
   * Create a checkpoint from agent state.
   */
  createCheckpoint(
    agentState: unknown,
    reason?: string,
  ): Promise<CheckpointMeta>;

  /**
   * Restore the latest checkpoint.
   */
  restoreLatest(): Promise<CheckpointRestoreResult | null>;

  /**
   * Restore a specific checkpoint by ID.
   */
  restore(id: string): Promise<CheckpointRestoreResult | null>;

  /**
   * Load checkpoint index from storage.
   */
  loadIndex(): Promise<void>;

  /** List checkpoint metadata. */
  get checkpoints(): CheckpointMeta[];

  /** Number of stored checkpoints. */
  get size(): number;

  /** Clear all checkpoint metadata. */
  clear(): void;
}

// ── TabCoordinator ───────────────────────────────────────────

export interface TabInfo {
  tabId: string;
  lastSeen: number;
}

export declare class TabCoordinator {
  constructor(opts?: {
    channelName?: string;
    channel?: unknown;
    heartbeatMs?: number;
    onMessage?: (msg: unknown) => void;
  });

  get tabId(): string;
  get tabCount(): number;

  /** Start heartbeat broadcasting. */
  start(): void;

  /** Stop heartbeat and announce departure. */
  stop(): void;

  /** Broadcast a message to all tabs. */
  broadcast(msg: unknown): void;

  /** Get list of known active tabs. */
  get activeTabs(): TabInfo[];

  /**
   * Check if this tab is the leader (first tab).
   */
  get isLeader(): boolean;
}

// ── DaemonController ─────────────────────────────────────────

export declare class DaemonController {
  constructor(opts?: {
    state?: DaemonState;
    checkpoints?: CheckpointManager;
    coordinator?: TabCoordinator;
    autoCheckpointMs?: number;
    getStateFn?: () => unknown;
  });

  /** Start the daemon. */
  start(): Promise<boolean>;

  /** Stop the daemon. */
  stop(): Promise<boolean>;

  /** Pause the daemon. */
  pause(): boolean;

  /** Resume from paused state. */
  resume(): boolean;

  /**
   * Create a checkpoint.
   */
  checkpoint(reason?: string): Promise<CheckpointMeta | null>;

  /**
   * Restore from the latest checkpoint.
   */
  restore(): Promise<CheckpointRestoreResult | null>;

  /** Daemon state. */
  get daemonState(): DaemonState;

  /** Current phase. */
  get phase(): DaemonPhaseValue;

  /** Whether running. */
  get isRunning(): boolean;

  /** Checkpoint manager. */
  get checkpointManager(): CheckpointManager;

  /** Tab coordinator. */
  get tabCoordinator(): TabCoordinator | null;

  /**
   * Build system prompt section.
   */
  buildPrompt(): string;
}

// ── Agent Tools ──────────────────────────────────────────────

export declare class DaemonStatusTool {
  constructor(controller: DaemonController);
  get name(): 'daemon_status';
  get description(): string;
  get parameters(): object;
  get permission(): 'read';
  execute(): Promise<ToolResult>;
}

export declare class DaemonCheckpointTool {
  constructor(controller: DaemonController);
  get name(): 'daemon_checkpoint';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params?: { reason?: string }): Promise<ToolResult>;
}
