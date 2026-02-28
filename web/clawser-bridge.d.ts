/**
 * Type definitions for clawser-bridge.js
 * — External Tool Integration: LocalServer, Extension, and BridgeManager.
 */

import type { ToolResult } from './types.d.ts';

// ── Constants ────────────────────────────────────────────────

export declare const BRIDGE_TYPES: Readonly<{
  LOCAL_SERVER: 'local_server';
  EXTENSION: 'extension';
  NONE: 'none';
}>;

export type BridgeType = 'local_server' | 'extension' | 'none';

export declare const DEFAULT_BRIDGE_URL: string;
export declare const BRIDGE_HEALTH_PATH: string;
export declare const BRIDGE_TOOLS_PATH: string;
export declare const BRIDGE_CALL_PATH: string;
export declare const BRIDGE_PROXY_PATH: string;
export declare const EXTENSION_MARKER: string;

// ── ExternalBridge (Abstract) ────────────────────────────────

export interface BridgeToolSpec {
  name: string;
  description: string;
  parameters: object;
}

export interface ProxyFetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  error?: string;
}

export declare class ExternalBridge {
  /** Check if this bridge is available. */
  isAvailable(): Promise<boolean>;

  /** Get bridge type identifier. */
  get type(): BridgeType;

  /** List available tools from this bridge. */
  listTools(): Promise<BridgeToolSpec[]>;

  /** Call a tool by name. */
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;

  /** Proxy a fetch request through the bridge (bypasses CORS). */
  proxyFetch(
    url: string,
    opts?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<ProxyFetchResult>;

  /** Disconnect / cleanup. */
  disconnect(): Promise<void>;
}

// ── LocalServerBridge ────────────────────────────────────────

export declare class LocalServerBridge extends ExternalBridge {
  constructor(opts?: {
    baseUrl?: string;
    apiKey?: string;
    fetchFn?: typeof fetch;
  });

  get type(): 'local_server';
  get baseUrl(): string;

  isAvailable(): Promise<boolean>;
  listTools(): Promise<BridgeToolSpec[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  proxyFetch(
    url: string,
    opts?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<ProxyFetchResult>;
}

// ── ExtensionBridge ──────────────────────────────────────────

export declare class ExtensionBridge extends ExternalBridge {
  constructor(opts?: { timeout?: number });

  get type(): 'extension';

  isAvailable(): Promise<boolean>;
  listTools(): Promise<BridgeToolSpec[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  proxyFetch(
    url: string,
    opts?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<ProxyFetchResult>;
  disconnect(): Promise<void>;
}

// ── BridgeManager ────────────────────────────────────────────

export declare class BridgeManager {
  constructor(opts?: {
    localBridge?: LocalServerBridge;
    extensionBridge?: ExtensionBridge;
    onStatusChange?: (bridgeType: BridgeType, available: boolean) => void;
  });

  /**
   * Auto-detect available bridges. Prefers extension, falls back to local server.
   */
  detect(): Promise<BridgeType>;

  /** Whether any bridge is active. */
  get isConnected(): boolean;

  /** Active bridge type. */
  get activeType(): BridgeType;

  /** Active bridge instance (or null). */
  get bridge(): ExternalBridge | null;

  /** List tools from the active bridge. */
  listTools(): Promise<BridgeToolSpec[]>;

  /** Call a tool on the active bridge. */
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;

  /** Proxy a fetch through the active bridge. */
  proxyFetch(
    url: string,
    opts?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<ProxyFetchResult>;

  /** Disconnect the active bridge. */
  disconnect(): Promise<void>;

  /** Force-set a specific bridge as active. */
  setActive(type: 'local_server' | 'extension'): Promise<boolean>;

  /** Build system prompt section describing bridge status. */
  buildPrompt(): string;
}

// ── Agent Tools ──────────────────────────────────────────────

export declare class BridgeStatusTool {
  constructor(manager: BridgeManager);
  get name(): 'bridge_status';
  get description(): string;
  get parameters(): object;
  get permission(): 'read';
  execute(): Promise<ToolResult>;
}

export declare class BridgeListToolsTool {
  constructor(manager: BridgeManager);
  get name(): 'bridge_list_tools';
  get description(): string;
  get parameters(): object;
  get permission(): 'read';
  execute(): Promise<ToolResult>;
}

export declare class BridgeFetchTool {
  constructor(manager: BridgeManager);
  get name(): 'bridge_fetch';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<ToolResult>;
}
