import type { ToolResult } from './types.d.ts';
import { BrowserTool } from './clawser-tools.js';

export function validateToolCode(code: string): { safe: boolean; issues: string[] };

export interface DynamicToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  code: string;
  author: string;
  created: number;
  version: number;
  trusted: boolean;
}

export class DynamicTool extends BrowserTool {
  constructor(spec: Partial<DynamicToolSpec> & { name: string }, sandbox?: (code: string, params: unknown) => Promise<unknown>);
  get rawSpec(): DynamicToolSpec;
  get code(): string;
  get version(): number;
  get author(): string;
  get trusted(): boolean;
  set trusted(v: boolean);
  set sandbox(fn: (code: string, params: unknown) => Promise<unknown>);
  execute(params: Record<string, unknown>): Promise<ToolResult>;
}

export class ToolBuilder {
  constructor(registry: unknown, sandbox?: (code: string, params?: unknown) => Promise<unknown>);
  get history(): Map<string, DynamicToolSpec[]>;
  buildTool(spec: Partial<DynamicToolSpec> & { name: string; code: string; testInput?: unknown }): Promise<{ success: boolean; tool?: string; version?: number; error?: string }>;
  testTool(spec: { code: string; testInput?: unknown }): Promise<{ success: boolean; output?: string; error?: string }>;
  editTool(name: string, updates: Partial<DynamicToolSpec>): Promise<{ success: boolean; version?: number; error?: string }>;
  removeTool(name: string): { success: boolean; error?: string };
  listTools(): Array<{ name: string; description: string; version: number; author: string; trusted: boolean }>;
  getHistory(name: string): DynamicToolSpec[];
  rollback(name: string, targetVersion: number): { success: boolean; version?: number; error?: string };
  promoteTool(name: string): { success: boolean; error?: string };
  demoteTool(name: string): { success: boolean; error?: string };
  exportAll(): DynamicToolSpec[];
  importAll(data: DynamicToolSpec[]): number;
}

export class ToolBuildTool extends BrowserTool {
  constructor(builder: ToolBuilder);
  execute(params: { name: string; description: string; code: string; parameters_schema?: string; test_input?: string }): Promise<ToolResult>;
}

export class ToolTestTool extends BrowserTool {
  constructor(builder: ToolBuilder);
  execute(params: { code: string; test_input?: string }): Promise<ToolResult>;
}

export class ToolListCustomTool extends BrowserTool {
  constructor(builder: ToolBuilder);
  execute(): Promise<ToolResult>;
}

export class ToolEditTool extends BrowserTool {
  constructor(builder: ToolBuilder);
  execute(params: { name: string; code: string; description?: string }): Promise<ToolResult>;
}

export class ToolRemoveTool extends BrowserTool {
  constructor(builder: ToolBuilder);
  execute(params: { name: string }): Promise<ToolResult>;
}
