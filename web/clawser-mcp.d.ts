/**
 * Type definitions for clawser-mcp.js
 * MCP (Model Context Protocol) client
 */

import type { ToolSpec, ToolResult } from './types.d.ts';

// ── MCP Tool Shape ─────────────────────────────────────────────

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: object;
}

// ── McpClient ──────────────────────────────────────────────────

export interface McpClientOptions {
  onLog?: (level: number, msg: string) => void;
  timeoutMs?: number;
}

export interface McpInitResult {
  serverInfo?: { name: string; version?: string };
  capabilities?: object;
  [key: string]: unknown;
}

export declare class McpClient {
  constructor(endpoint: string, opts?: McpClientOptions);

  get endpoint(): string;
  get connected(): boolean;
  get tools(): McpTool[];
  get sessionId(): string | null;
  get toolSpecs(): ToolSpec[];

  connect(): Promise<McpInitResult | undefined>;
  disconnect(): Promise<void>;
  discoverTools(): Promise<McpTool[]>;
  callTool(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  handlesTool(fullName: string): boolean;
  mcpName(fullName: string): string;
}

// ── McpManager ─────────────────────────────────────────────────

export interface McpManagerOptions {
  onLog?: (level: number, msg: string) => void;
}

export declare class McpManager {
  constructor(opts?: McpManagerOptions);

  /** Kernel integration hook for svc:// registration */
  _kernelIntegration: unknown | null;

  addServer(name: string, endpoint: string): Promise<McpClient>;
  removeServer(name: string): void;
  allToolSpecs(): ToolSpec[];
  findClient(toolName: string): McpClient | null;
  executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
  get serverNames(): string[];
  get serverCount(): number;
  getClient(name: string): McpClient | undefined;
}

// ── WebMCPDiscovery ─────────────────────────────────────────────

export interface WebMCPToolDescriptor {
  name: string;
  description: string;
  parameters?: object;
  source?: string;
  discoveredAt?: number;
}

export declare class WebMCPDiscovery {
  parseToolDescriptors(metadata: { tools: WebMCPToolDescriptor[] }): WebMCPToolDescriptor[];
  isValidTool(tool: unknown): boolean;
  addDiscovered(tools: WebMCPToolDescriptor[]): void;
  listDiscovered(): WebMCPToolDescriptor[];
  clearDiscovered(): void;
  get size(): number;
}
