/**
 * Type definitions for clawser-wsh-incoming.js
 * — Incoming reverse-connect session handler for wsh.
 */

import type { KernelWshBridge } from './clawser-kernel-wsh-bridge.d.ts';
import type { ToolResult } from './types.d.ts';

/**
 * Set the kernel-wsh bridge for tenant lifecycle.
 */
export declare function setKernelBridge(bridge: KernelWshBridge | null): void;

/**
 * Get the current kernel-wsh bridge.
 */
export declare function getKernelBridge(): KernelWshBridge | null;

export interface ReverseConnectMessage {
  target_fingerprint: string;
  username: string;
  [key: string]: unknown;
}

/**
 * Handle an incoming ReverseConnect message.
 * Called by the WshClient's onReverseConnect callback.
 *
 * Creates an IncomingSession and wires up relay message listening so
 * the browser can receive and respond to Open/McpCall/McpDiscover etc.
 * from the remote CLI peer.
 */
export declare function handleReverseConnect(msg: ReverseConnectMessage): void;

export interface IncomingSessionInfo {
  username: string;
  fingerprint: string;
  createdAt: number;
  state: string;
}

/**
 * List active incoming sessions.
 */
export declare function listIncomingSessions(): IncomingSessionInfo[];

/**
 * Get an incoming session by username or fingerprint prefix.
 *
 * Returns the IncomingSession instance (non-exported class), or null.
 */
export declare function getIncomingSession(prefix: string): {
  username: string;
  targetFingerprint: string;
  client: unknown;
  createdAt: number;
  state: string;
  tenantId: string | null;
  startListening(): void;
  stopListening(): void;
  handleRelayMessage(msg: unknown): Promise<void>;
  handleToolCall(tool: string, args: Record<string, unknown>): Promise<ToolResult>;
  handleExec(command: string): Promise<ToolResult>;
  handleMcpCall(tool: string, args: Record<string, unknown>): Promise<ToolResult>;
  close(): void;
} | null;
