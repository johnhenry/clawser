/**
 * Shared type aliases used across Clawser modules.
 */

// ── Chat & LLM ──────────────────────────────────────────────────────

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; [key: string]: unknown }>;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatResponse {
  content: string;
  tool_calls?: ToolCall[];
  usage?: TokenUsage;
  model: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  max_tokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

// ── Tools ────────────────────────────────────────────────────────────

export interface ToolSpec {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
  required_permission?: ToolPermissionLevel;
}

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: ToolParameter;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export type ToolPermissionLevel = 'auto' | 'approve' | 'denied';

// ── Memory ───────────────────────────────────────────────────────────

export type MemoryCategory = 'core' | 'learned' | 'user' | 'context';

export interface MemoryEntry {
  id: string;
  key: string;
  content: string;
  category: MemoryCategory;
  timestamp: number;
  meta?: Record<string, unknown>;
  embedding?: Float32Array | null;
}

// ── Provider ─────────────────────────────────────────────────────────

export interface ProviderConfig {
  name: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  description?: string;
}

export interface ModelPricing {
  input: number;
  output: number;
  cached_input?: number;
}

// ── Workspace ────────────────────────────────────────────────────────

export interface WorkspaceConfig {
  id: string;
  name: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  systemPrompt?: string;
  createdAt?: number;
  updatedAt?: number;
}

// ── Skills ───────────────────────────────────────────────────────────

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  tags?: string[];
  requires?: Record<string, string>;
  arguments?: SkillArgument[];
  tools?: string[];
  capabilities?: string[];
}

export interface SkillArgument {
  name: string;
  description?: string;
  required?: boolean;
  default?: string;
}

export interface Skill {
  name: string;
  metadata: SkillManifest;
  body: string;
  scope: 'global' | 'workspace';
  enabled: boolean;
  scripts?: Map<string, string>;
  references?: Map<string, string>;
}

// ── Event Log ────────────────────────────────────────────────────────

export interface EventLogEntry {
  type: string;
  data: unknown;
  source?: string;
  timestamp: number;
}

// ── Scheduler ────────────────────────────────────────────────────────

export type ScheduleType = 'once' | 'interval' | 'cron';

export interface SchedulerJob {
  id: string;
  description: string;
  schedule: string;
  scheduleType: ScheduleType;
  timezone?: string;
  nextRun?: number;
  lastRun?: number;
  createdAt: number;
}

// ── Stream Events ────────────────────────────────────────────────────

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_start'; name: string; id: string }
  | { type: 'tool_delta'; content: string }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'done'; response: ChatResponse }
  | { type: 'error'; error: Error };

// ── Error Classification ─────────────────────────────────────────────

export interface ErrorClassification {
  category: string;
  retryable: boolean;
  message: string;
}

// ── Autonomy ─────────────────────────────────────────────────────────

export type AutonomyLevel = 'readonly' | 'supervised' | 'full';

export interface AutonomyConfig {
  level?: AutonomyLevel;
  maxActionsPerHour?: number;
  maxCostPerDayCents?: number;
}

// ── Hook System ──────────────────────────────────────────────────────

export type HookPoint =
  | 'beforeInbound'
  | 'beforeToolCall'
  | 'beforeOutbound'
  | 'transformResponse'
  | 'onSessionStart'
  | 'onSessionEnd';

export interface HookDefinition {
  name: string;
  point: HookPoint;
  priority?: number;
  enabled?: boolean;
  execute: (ctx: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

// ── Utility ──────────────────────────────────────────────────────────

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface LeakFinding {
  pattern: string;
  match: string;
  index: number;
  severity: 'block' | 'warn';
}
