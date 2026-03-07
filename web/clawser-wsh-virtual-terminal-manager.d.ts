import type { VirtualTerminalSession } from './clawser-wsh-virtual-terminal-session.d.ts';

export interface ReversePeerContext {
  participantKey: string;
  username: string;
  targetFingerprint: string;
  client: { sendRelayControl(msg: Record<string, unknown>): Promise<void> };
  capabilities: { shell: boolean; tools: boolean; fs: boolean };
  tenantId: string | null;
  state: string;
  channels: Map<number, VirtualTerminalSession>;
}

export declare function buildReverseParticipantKey(parts?: {
  username?: string;
  targetFingerprint?: string;
}): string;

export declare class VirtualTerminalManager {
  constructor(opts: { shellFactory: (context?: Record<string, unknown>) => Promise<unknown> });
  registerPeerContext(opts: {
    participantKey: string;
    username?: string;
    targetFingerprint?: string;
    client: { sendRelayControl(msg: Record<string, unknown>): Promise<void> };
    capabilities?: string[] | { shell?: boolean; tools?: boolean; fs?: boolean };
    tenantId?: string | null;
  }): Promise<ReversePeerContext>;
  getPeerContext(participantKey: string): ReversePeerContext | null;
  listPeerContexts(): Array<{
    participantKey: string;
    username: string;
    targetFingerprint: string;
    tenantId: string | null;
    state: string;
    capabilities: { shell: boolean; tools: boolean; fs: boolean };
    channelIds: number[];
  }>;
  hasCapability(participantKey: string, capability: 'shell' | 'tools' | 'fs'): boolean;
  openChannel(
    participantKey: string,
    opts: {
      channelId: number;
      kind?: 'pty' | 'exec';
      command?: string;
      cols?: number;
      rows?: number;
    },
  ): Promise<VirtualTerminalSession>;
  getChannel(participantKey: string, channelId: number): VirtualTerminalSession | null;
  writeToChannel(participantKey: string, channelId: number, data: Uint8Array | string): Promise<VirtualTerminalSession>;
  resizeChannel(participantKey: string, channelId: number, cols: number, rows: number): Promise<VirtualTerminalSession>;
  signalChannel(participantKey: string, channelId: number, signal: string): Promise<VirtualTerminalSession>;
  closeChannel(participantKey: string, channelId: number, opts?: { notifyRemote?: boolean }): Promise<void>;
  closePeerContext(participantKey: string, opts?: { notifyRemote?: boolean }): Promise<void>;
  close(): Promise<void>;
}
