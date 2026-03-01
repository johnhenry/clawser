import type { ToolResult } from './types.d.ts';
import { BrowserTool } from './clawser-tools.js';

export const MessageIntent: Readonly<{
  COMMAND: 'command';
  QUERY: 'query';
  TASK: 'task';
  CHAT: 'chat';
  SYSTEM: 'system';
}>;

export interface PipelineConfig {
  useMemory: boolean;
  useTools: boolean;
  useLLM: boolean;
  modelHint: string | null;
  maxTokens: number;
  useGoals: boolean;
  skipUI: boolean;
}

export const PIPELINE_CONFIG: Readonly<Record<string, PipelineConfig>>;

export class IntentRouter {
  constructor();
  classify(message: string, meta?: Record<string, unknown>): string;
  getPipelineConfig(intent: string): PipelineConfig;
  route(message: string, meta?: Record<string, unknown>): { intent: string; config: PipelineConfig };
  addPattern(intent: string, testFn: (message: string, meta?: Record<string, unknown>) => boolean): void;
  addOverride(prefix: string, intent: string): void;
  removeOverride(prefix: string): boolean;
  resetPatterns(): void;
  stripOverride(message: string): string;
  get patternCount(): number;
  get overrideCount(): number;
}

export function classifyWithLLM(
  router: IntentRouter,
  chatFn: (messages: unknown[], opts?: Record<string, unknown>) => Promise<{ content: string }>,
  message: string,
  meta?: Record<string, unknown>,
): Promise<string>;

export class IntentClassifyTool extends BrowserTool {
  constructor(router: IntentRouter);
  execute(params: { message: string; source?: string }): Promise<ToolResult>;
}

export class IntentOverrideTool extends BrowserTool {
  constructor(router: IntentRouter);
  execute(params: { prefix: string; intent: string }): Promise<ToolResult>;
}
