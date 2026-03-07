export interface VirtualTerminalSessionOptions {
  participantKey: string;
  channelId: number;
  kind?: 'pty' | 'exec';
  command?: string;
  cols?: number;
  rows?: number;
  shellFactory: () => Promise<unknown>;
  sendControl: (msg: Record<string, unknown>) => Promise<void>;
  replayLimit?: number;
}

export declare class VirtualTerminalSession {
  constructor(opts: VirtualTerminalSessionOptions);
  onClose: (() => void) | null;
  readonly participantKey: string;
  readonly channelId: number;
  readonly kind: 'pty' | 'exec';
  readonly command: string;
  readonly cols: number;
  readonly rows: number;
  readonly shell: unknown;
  readonly replay: string;
  readonly stateSnapshot: Record<string, unknown> | null;
  readonly closed: boolean;
  start(): Promise<void>;
  write(data: Uint8Array | string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  replayToRemote(opts?: { cols?: number; rows?: number }): Promise<void>;
  signal(signal: string): Promise<void>;
  close(opts?: { exitCode?: number; notifyRemote?: boolean }): Promise<void>;
}
