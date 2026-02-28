/**
 * Type definitions for clawser-wsh-tools.js
 * — BrowserTool subclasses for remote command execution, file transfer,
 *   and PTY management over the wsh protocol.
 */

import type { ToolResult } from './types.d.ts';

// ── Tool Classes ──────────────────────────────────────────────

export declare class WshConnectTool {
  get name(): 'wsh_connect';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: {
    host: string;
    user: string;
    key_name?: string;
    expose?: { shell?: boolean; tools?: boolean; fs?: boolean };
  }): Promise<ToolResult>;
}

export declare class WshExecTool {
  get name(): 'wsh_exec';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: {
    command: string;
    host?: string;
    timeout_ms?: number;
  }): Promise<ToolResult>;
}

export declare class WshPtyOpenTool {
  get name(): 'wsh_pty_open';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: {
    host?: string;
    command?: string;
    cols?: number;
    rows?: number;
  }): Promise<ToolResult>;
}

export declare class WshPtyWriteTool {
  get name(): 'wsh_pty_write';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: {
    session_id: string;
    data: string;
  }): Promise<ToolResult>;
}

export declare class WshUploadTool {
  get name(): 'wsh_upload';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: {
    local_path: string;
    remote_path: string;
    host?: string;
  }): Promise<ToolResult>;
}

export declare class WshDownloadTool {
  get name(): 'wsh_download';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: {
    remote_path: string;
    local_path: string;
    host?: string;
  }): Promise<ToolResult>;
}

export declare class WshDisconnectTool {
  get name(): 'wsh_disconnect';
  get description(): string;
  get parameters(): object;
  get permission(): 'auto';
  execute(params?: { host?: string }): Promise<ToolResult>;
}

export declare class WshSessionsTool {
  get name(): 'wsh_sessions';
  get description(): string;
  get parameters(): object;
  get permission(): 'read';
  execute(): Promise<ToolResult>;
}

export declare class WshMcpCallTool {
  get name(): 'wsh_mcp_call';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: {
    host?: string;
    tool: string;
    arguments?: Record<string, unknown>;
  }): Promise<ToolResult>;
}

export declare class WshFetchTool {
  get name(): 'wsh_fetch';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    host?: string;
    timeout_ms?: number;
  }): Promise<ToolResult>;
}

// ── Registration Helper ───────────────────────────────────────

/**
 * Register all wsh tools with a BrowserToolRegistry.
 */
export declare function registerWshTools(registry: unknown): void;

/**
 * Get the shared connections map (for CLI integration).
 */
export declare function getWshConnections(): Map<string, unknown>;
