import type { ToolResult, ChatMessage, ToolSpec } from './types.d.ts';
import { BrowserTool } from './clawser-tools.js';

export const MAX_DELEGATION_DEPTH: number;
export const DEFAULT_MAX_ITERATIONS: number;
export const DEFAULT_MAX_CONCURRENCY: number;

export interface SubAgentResult {
  success: boolean;
  summary: string;
  iterations: number;
  toolCalls: number;
}

export class SubAgent {
  constructor(opts: {
    goal: string;
    chatFn: (messages: ChatMessage[], tools: ToolSpec[], opts: Record<string, unknown>) => Promise<{ content: string; tool_calls?: unknown[] }>;
    executeFn: (toolName: string, params: Record<string, unknown>) => Promise<unknown>;
    toolSpecs: ToolSpec[];
    maxIterations?: number;
    allowedTools?: string[];
    depth?: number;
    systemPrompt?: string;
    onEvent?: (type: string, data: unknown) => void;
  });
  get id(): string;
  get goal(): string;
  get status(): 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  get depth(): number;
  get iterations(): number;
  get toolCallCount(): number;
  get result(): SubAgentResult | null;
  get allowedTools(): string[];
  run(): Promise<SubAgentResult>;
}

export interface SubAgentSummary {
  id: string;
  goal: string;
  status: string;
  depth: number;
  iterations: number;
  toolCalls: number;
}

export class DelegateManager {
  constructor(opts?: { maxConcurrency?: number });
  create(opts: ConstructorParameters<typeof SubAgent>[0]): SubAgent;
  run(id: string): Promise<SubAgentResult>;
  delegate(opts: ConstructorParameters<typeof SubAgent>[0]): Promise<SubAgentResult>;
  delegateAll(optsList: Array<ConstructorParameters<typeof SubAgent>[0]>): Promise<SubAgentResult[]>;
  get(id: string): SubAgent | null;
  list(): SubAgentSummary[];
  get running(): number;
  get size(): number;
  cleanup(): void;
}

export class DelegateTool extends BrowserTool {
  constructor(manager: DelegateManager, opts: {
    chatFn: unknown;
    executeFn: unknown;
    toolSpecs: ToolSpec[];
    systemPrompt?: string;
    currentDepth?: number;
  });
  execute(params: { task: string; tools?: string[]; max_iterations?: number }): Promise<ToolResult>;
}
