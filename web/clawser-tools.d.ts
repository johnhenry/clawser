/**
 * Type definitions for clawser-tools.js
 * Browser tools: base classes, registry, individual tool implementations
 */

import type { ToolSpec, ToolResult, ToolPermissionLevel } from './types.d.ts';

// ── WorkspaceFs ────────────────────────────────────────────────

export declare class WorkspaceFs {
  setWorkspace(id: string): void;
  getWorkspace(): string;
  get homePath(): string;
  resolve(userPath: string): string;
}

// ── Base Classes ───────────────────────────────────────────────

export declare class BrowserTool {
  get spec(): ToolSpec;
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: Record<string, unknown>): Promise<ToolResult>;
}

export declare const TOOL_PERMISSION_LEVELS: readonly ['auto', 'approve', 'denied'];

export declare class BrowserToolRegistry {
  register(tool: BrowserTool): void;
  get(name: string): BrowserTool | null;
  has(name: string): boolean;
  unregister(name: string): boolean;
  setApprovalHandler(handler: ((name: string, params: Record<string, unknown>) => Promise<boolean>) | null): void;
  setPermission(name: string, level: ToolPermissionLevel): void;
  getPermission(name: string): ToolPermissionLevel;
  getAllPermissions(): Record<string, string>;
  loadPermissions(perms: Record<string, string> | null): void;
  resetAllPermissions(): void;
  getSpec(name: string): ToolSpec | null;
  allSpecs(): ToolSpec[];
  names(): string[];
  execute(name: string, params: Record<string, unknown>): Promise<ToolResult>;
}

// ── Browser Tools ──────────────────────────────────────────────

export declare class FetchTool extends BrowserTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  setDomainAllowlist(domains: string[] | null): void;
  execute(params: { url: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<ToolResult>;
}

export declare class DomQueryTool extends BrowserTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { selector: string; limit?: number; include_html?: boolean }): Promise<ToolResult>;
}

export declare class DomModifyTool extends BrowserTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { selector: string; action: string; value?: string; attribute?: string }): Promise<ToolResult>;
}

export declare class FsReadTool extends BrowserTool {
  constructor(ws: WorkspaceFs);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { path: string }): Promise<ToolResult>;
}

export declare class FsWriteTool extends BrowserTool {
  constructor(ws: WorkspaceFs);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  setMaxFileSize(bytes: number): void;
  execute(params: { path: string; content: string }): Promise<ToolResult>;
}

export declare class FsListTool extends BrowserTool {
  constructor(ws: WorkspaceFs);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { path?: string }): Promise<ToolResult>;
}

export declare class FsDeleteTool extends BrowserTool {
  constructor(ws: WorkspaceFs);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { path: string; recursive?: boolean }): Promise<ToolResult>;
}

export declare class StorageGetTool extends BrowserTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { key: string }): Promise<ToolResult>;
}

export declare class StorageSetTool extends BrowserTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { key: string; value: string }): Promise<ToolResult>;
}

export declare class StorageListTool extends BrowserTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(): Promise<ToolResult>;
}

export declare class ClipboardReadTool extends BrowserTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(): Promise<ToolResult>;
}

export declare class ClipboardWriteTool extends BrowserTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { text: string }): Promise<ToolResult>;
}

export declare class NavigateTool extends BrowserTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { url: string; new_tab?: boolean }): Promise<ToolResult>;
}

export declare class NotifyTool extends BrowserTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { title: string; body?: string; icon?: string }): Promise<ToolResult>;
}

export declare class EvalJsTool extends BrowserTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { code: string }): Promise<ToolResult>;
}

export declare class ScreenInfoTool extends BrowserTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(): Promise<ToolResult>;
}

// ── Agent Tools ────────────────────────────────────────────────

export declare class AgentTool extends BrowserTool {
  constructor(agent: unknown);
  protected _agent: unknown;
  get permission(): string;
}

export declare class AgentMemoryStoreTool extends AgentTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  execute(params: { key: string; content: string; category?: string }): Promise<ToolResult>;
}

export declare class AgentMemoryRecallTool extends AgentTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  execute(params: { query: string }): Promise<ToolResult>;
}

export declare class AgentMemoryForgetTool extends AgentTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  execute(params: { id: string }): Promise<ToolResult>;
}

export declare class AgentScheduleAddTool extends AgentTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  execute(params: {
    schedule_type: 'once' | 'interval' | 'cron';
    prompt: string;
    delay_ms?: number;
    interval_ms?: number;
    cron_expr?: string;
  }): Promise<ToolResult>;
}

export declare class AgentScheduleListTool extends AgentTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  execute(): Promise<ToolResult>;
}

export declare class AgentScheduleRemoveTool extends AgentTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  execute(params: { id: string }): Promise<ToolResult>;
}

// ── Web Search & Screenshot Tools ──────────────────────────────

export declare class WebSearchTool extends BrowserTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { query: string; limit?: number }): Promise<ToolResult>;
}

export declare class ScreenshotTool extends BrowserTool {
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { selector?: string }): Promise<ToolResult>;
}

// ── registerAgentTools ─────────────────────────────────────────

export declare function registerAgentTools(registry: BrowserToolRegistry, agent: unknown): void;

// ── AskUserQuestion Tool ───────────────────────────────────────

export interface AskUserQuestion {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect?: boolean;
}

export declare class AskUserQuestionTool extends BrowserTool {
  constructor(onAskUser: (questions: AskUserQuestion[]) => Promise<Record<string, string>>);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { questions: AskUserQuestion[] }): Promise<ToolResult>;
}

// ── SwitchAgent / ConsultAgent Tools ───────────────────────────

export declare class SwitchAgentTool extends BrowserTool {
  constructor(storage: unknown, engine: unknown);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { agent?: string; reason?: string }): Promise<ToolResult>;
}

export declare class ConsultAgentTool extends BrowserTool {
  constructor(storage: unknown, opts: unknown);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { agent: string; message: string }): Promise<ToolResult>;
}

// ── Storage Quota ──────────────────────────────────────────────

export interface QuotaInfo {
  usage: number;
  quota: number;
  percent: number;
  warning: boolean;
  critical: boolean;
}

export declare function checkQuota(): Promise<QuotaInfo>;

// ── createDefaultRegistry ──────────────────────────────────────

export declare function createDefaultRegistry(workspaceFs: WorkspaceFs): BrowserToolRegistry;
