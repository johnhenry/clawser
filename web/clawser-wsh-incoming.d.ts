import type { KernelWshBridge } from './clawser-kernel-wsh-bridge.d.ts';
import type { VirtualTerminalManager } from './clawser-wsh-virtual-terminal-manager.d.ts';

export interface ReverseConnectMessage {
  target_fingerprint: string;
  username: string;
  [key: string]: unknown;
}

export interface IncomingSessionInfo {
  participantKey: string;
  username: string;
  fingerprint: string;
  createdAt: number;
  state: string;
}

export declare function setKernelBridge(bridge: KernelWshBridge | null): void;
export declare function getKernelBridge(): KernelWshBridge | null;
export declare function setToolRegistry(registry: unknown): void;
export declare function setMcpClient(client: unknown): void;
export declare function setAgentGateway(gateway: unknown): void;
export declare function setVirtualTerminalManager(manager: VirtualTerminalManager | null): void;
export declare function handleReverseConnect(msg: ReverseConnectMessage): Promise<void>;
export declare function listIncomingSessions(): IncomingSessionInfo[];
export declare function getIncomingSession(prefix: string): {
  participantKey: string;
  username: string;
  targetFingerprint: string;
  client: unknown;
  capabilities: { shell: boolean; tools: boolean; fs: boolean };
  tenantId: string | null;
  createdAt: number;
  state: string;
  startListening(): void;
  stopListening(): void;
  handleRelayMessage(msg: Record<string, unknown>): Promise<void>;
  handleToolCall(tool: string, args: Record<string, unknown>): Promise<unknown>;
  handleMcpCall(tool: string, args: Record<string, unknown>): Promise<unknown>;
  close(opts?: { notifyRemote?: boolean }): Promise<void>;
} | null;
