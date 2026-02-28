/**
 * Type definitions for clawser-agent.js — Pure JavaScript agent core.
 */

import type {
  ChatMessage,
  ChatResponse,
  ToolSpec,
  ToolResult,
  ToolCall,
  TokenUsage,
  MemoryCategory,
  MemoryEntry,
  AutonomyLevel,
  AutonomyConfig,
  HookPoint,
  HookDefinition,
  StreamEvent,
  ScheduleType,
} from './types.d.ts';

// ── HookPipeline ──────────────────────────────────────────────

export type HookAction = 'continue' | 'block' | 'modify' | 'skip';

export interface HookResult {
  action: HookAction;
  reason?: string;
  data?: Record<string, unknown>;
}

export interface HookEntry {
  name: string;
  point: HookPoint;
  priority: number;
  enabled: boolean;
}

export interface HookRunResult {
  blocked: boolean;
  reason?: string;
  ctx: Record<string, unknown>;
}

export declare const HOOK_POINTS: readonly [
  'beforeInbound',
  'beforeToolCall',
  'beforeOutbound',
  'transformResponse',
  'onSessionStart',
  'onSessionEnd',
];

export declare class HookPipeline {
  register(hook: HookDefinition): void;
  unregister(name: string, point: HookPoint): void;
  setEnabled(name: string, enabled: boolean): void;
  run(point: HookPoint, ctx: Record<string, unknown>): Promise<HookRunResult>;
  list(): HookEntry[];
  get size(): number;
}

// ── createAuditLoggerHook ─────────────────────────────────────

export declare function createAuditLoggerHook(
  onLog: (toolName: string, args: Record<string, unknown>, timestamp: number) => void,
): HookDefinition;

// ── AutonomyController ────────────────────────────────────────

export interface AutonomyStats {
  level: AutonomyLevel;
  actionsThisHour: number;
  maxActionsPerHour: number;
  costTodayCents: number;
  maxCostPerDayCents: number;
}

export interface LimitCheckResult {
  blocked: boolean;
  reason?: string;
  stats?: AutonomyStats;
}

export declare class AutonomyController {
  constructor(opts?: AutonomyConfig);

  get level(): AutonomyLevel;
  set level(v: AutonomyLevel);

  get maxActionsPerHour(): number;
  set maxActionsPerHour(v: number);

  get maxCostPerDayCents(): number;
  set maxCostPerDayCents(v: number);

  canExecuteTool(tool: { permission: string }): boolean;
  needsApproval(tool: { permission: string }): boolean;
  checkLimits(): LimitCheckResult;
  recordAction(): void;
  recordCost(cents: number): void;

  get stats(): AutonomyStats;
  reset(): void;
}

// ── ClawserAgent ──────────────────────────────────────────────

export interface AgentCreateOptions {
  browserTools?: unknown;
  workspaceFs?: unknown;
  providers?: unknown;
  mcpManager?: unknown;
  responseCache?: unknown;
  autonomy?: AutonomyController;
  hooks?: HookPipeline;
  safety?: unknown;
  safetyPipeline?: unknown;
  memory?: unknown;
  fallbackExecutor?: unknown;
  selfRepairEngine?: unknown;
  undoManager?: unknown;
  maxResultLength?: number;
  onEvent?: (topic: string, payload: unknown) => void;
  onLog?: (level: number, msg: string) => void;
  onToolCall?: (name: string, params: Record<string, unknown>, result: ToolResult | null) => void;
}

export interface AgentRunResult {
  status: number;
  data: string;
  usage?: TokenUsage;
  model?: string;
  cached?: boolean;
}

export interface AgentState {
  agent_state: string;
  history_len: number;
  goals: AgentGoal[];
  memory_count: number;
  scheduler_jobs: number;
}

export interface AgentGoal {
  id: string;
  description: string;
  status: 'active' | 'completed' | 'failed';
  created_at: number;
  updated_at: number;
  sub_goals: unknown[];
  artifacts: unknown[];
}

export interface CheckpointJSON {
  id: string;
  timestamp: number;
  agent_state: string;
  session_history: ChatMessage[];
  active_goals: AgentGoal[];
  scheduler_snapshot: unknown[];
  version: string;
}

export interface CronParsed {
  minute: Set<number> | null;
  hour: Set<number> | null;
  dayOfMonth: Set<number> | null;
  month: Set<number> | null;
  dayOfWeek: Set<number> | null;
}

export interface SchedulerJobSpec {
  schedule_type: ScheduleType;
  prompt: string;
  fire_at?: number;
  delay_ms?: number;
  interval_ms?: number;
  cron_expr?: string;
}

export interface SchedulerJobInfo {
  id: string;
  schedule_type: ScheduleType;
  prompt: string;
  paused: boolean;
  fired: boolean;
  cron_expr: string | null;
  interval_ms: number | null;
}

export interface CompactContextOptions {
  maxTokens?: number;
  keepRecent?: number;
  summaryProvider?: unknown;
}

export interface MemoryRecallOptions {
  limit?: number;
  category?: MemoryCategory;
  minScore?: number;
  vectorWeight?: number;
  keywordWeight?: number;
}

export interface MemoryRecallResult {
  id: string;
  key: string;
  content: string;
  category: MemoryCategory;
  timestamp: number;
  score: number;
}

export interface AgentDefinition {
  provider?: string;
  model?: string;
  systemPrompt?: string;
  maxTurnsPerRun?: number;
  [key: string]: unknown;
}

export declare class ClawserAgent {
  private constructor();

  static create(opts: AgentCreateOptions): Promise<ClawserAgent>;
  static estimateTokens(text: string): number;
  static parseCron(expr: string): CronParsed | null;

  init(config?: Record<string, unknown>): number;
  reinit(config?: Record<string, unknown>): number;

  registerToolSpec(spec: ToolSpec): number;
  unregisterToolSpec(name: string): boolean;
  refreshToolSpecs(): void;

  setProvider(name: string): void;
  setApiKey(key: string): void;
  setModel(model: string | null): void;
  getModel(): string | null;

  get autonomy(): AutonomyController;
  get hooks(): HookPipeline;
  get safety(): unknown;
  get codex(): unknown;
  get activeAgent(): AgentDefinition | null;
  get memory(): unknown;
  get eventLog(): unknown;

  applyAutonomyConfig(cfg: AutonomyConfig): void;
  setFallbackExecutor(executor: unknown): void;
  applyAgent(agentDef: AgentDefinition): void;
  setMaxToolIterations(n: number): void;

  getProviders(): Promise<unknown[]>;

  setSystemPrompt(prompt: string): void;
  sendMessage(text: string): void;
  getCodexPrompt(): string | null;
  isToolExternal(name: string): boolean;

  run(): Promise<AgentRunResult>;
  runStream(options?: {
    max_tokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<StreamEvent, void, unknown>;

  estimateHistoryTokens(): number;
  compactContext(opts?: CompactContextOptions): Promise<boolean>;

  getState(): AgentState;
  getCheckpointJSON(): CheckpointJSON;
  truncateHistory(len: number): number;

  memoryStore(entry: {
    key: string;
    content: string;
    category?: MemoryCategory;
    id?: string;
    timestamp?: number;
  }): string;
  memoryRecall(query: string, opts?: MemoryRecallOptions): MemoryRecallResult[];
  memoryRecallAsync(query: string, opts?: MemoryRecallOptions): Promise<MemoryRecallResult[]>;
  memoryForget(id: string): number;
  memoryHygiene(opts?: { maxAge?: number; maxEntries?: number }): number;

  addGoal(description: string): string;
  completeGoal(id: string): boolean;
  updateGoal(id: string, status: 'active' | 'completed' | 'failed'): boolean;

  tick(nowMs?: number): number;
  addSchedulerJob(spec: SchedulerJobSpec): string;
  listSchedulerJobs(): SchedulerJobInfo[];
  removeSchedulerJob(id: string): boolean;

  recordEvent(type: string, data: unknown, source?: string): unknown;
  getEventLog(): unknown;
  clearEventLog(): void;

  executeToolDirect(name: string, params: Record<string, unknown>): Promise<ToolResult>;

  checkpoint(): Uint8Array;
  restore(bytes: Uint8Array): number;

  setWorkspace(id: string): void;
  getWorkspace(): string;

  persistMemories(): void;
  restoreMemories(): number;
  persistCheckpoint(): Promise<void>;
  restoreCheckpoint(): Promise<boolean>;

  persistConfig(): void;
  restoreConfig(): Record<string, unknown> | null;

  persistConversation(conversationId: string): Promise<void>;
  restoreConversation(conversationId: string): Promise<boolean>;

  /** Kernel integration adapter. Set by workspace lifecycle. */
  _kernelIntegration: unknown;
}
