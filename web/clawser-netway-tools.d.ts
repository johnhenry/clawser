/**
 * Type definitions for clawser-netway-tools.js
 * — BrowserTool subclasses for virtual networking: TCP/UDP sockets,
 *   listeners, DNS resolution via the netway library.
 */

import type { ToolResult } from './types.d.ts';

// ── Tool Classes ──────────────────────────────────────────────

export declare class NetwayConnectTool {
  get name(): 'netway_connect';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: { address: string }): Promise<ToolResult>;
}

export declare class NetwayListenTool {
  get name(): 'netway_listen';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: { address: string }): Promise<ToolResult>;
}

export declare class NetwaySendTool {
  get name(): 'netway_send';
  get description(): string;
  get parameters(): object;
  get permission(): 'auto';
  execute(params: {
    handle: string;
    data: string;
    encoding?: 'utf8' | 'base64';
  }): Promise<ToolResult>;
}

export declare class NetwayReadTool {
  get name(): 'netway_read';
  get description(): string;
  get parameters(): object;
  get permission(): 'auto';
  execute(params: {
    handle: string;
    encoding?: 'utf8' | 'base64';
  }): Promise<ToolResult>;
}

export declare class NetwayCloseTool {
  get name(): 'netway_close';
  get description(): string;
  get parameters(): object;
  get permission(): 'auto';
  execute(params: { handle: string }): Promise<ToolResult>;
}

export declare class NetwayResolveTool {
  get name(): 'netway_resolve';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: {
    name: string;
    type?: 'A' | 'AAAA';
  }): Promise<ToolResult>;
}

export declare class NetwayStatusTool {
  get name(): 'netway_status';
  get description(): string;
  get parameters(): object;
  get permission(): 'auto';
  execute(): Promise<ToolResult>;
}

export declare class NetwayUdpSendTool {
  get name(): 'netway_udp_send';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: {
    address: string;
    data: string;
  }): Promise<ToolResult>;
}

// ── Registration Helper ───────────────────────────────────────

/**
 * Register all netway browser tools with the given tool registry.
 */
export declare function registerNetwayTools(registry: unknown): void;

/**
 * Public accessor for the shared VirtualNetwork singleton.
 */
export declare function getVirtualNetwork(): unknown;
