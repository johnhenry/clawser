export interface TerminalSessionEvent {
  type: string;
  data: Record<string, unknown>;
  source: string;
  timestamp: number;
}

export interface TerminalSessionMeta {
  id?: string;
  name?: string;
  created?: number;
  lastUsed?: number;
  commandCount?: number;
}

export interface TerminalSessionStoreOptions {
  shell?: { state?: unknown } | null;
  stdoutCap?: number;
  stderrCap?: number;
}

export declare function serializeTerminalSessionEvents(events: TerminalSessionEvent[]): string;
export declare function parseTerminalSessionEvents(raw: string | null | undefined): TerminalSessionEvent[];

export declare class TerminalSessionStore {
  constructor(opts?: TerminalSessionStoreOptions);
  setShell(shell: { state?: unknown } | null): void;
  clear(): void;
  markClean(): void;
  setEvents(events: TerminalSessionEvent[], opts?: { dirty?: boolean }): void;
  cloneEvents(): TerminalSessionEvent[];
  serializeShellState(): Record<string, unknown>;
  applyShellState(stateObj: Record<string, unknown>): void;
  resetShellState(): void;
  rebuildHistoryFromEvents(events?: TerminalSessionEvent[]): void;
  recordCommand(command: string): TerminalSessionEvent;
  recordResult(stdout: string, stderr: string, exitCode: number): TerminalSessionEvent;
  recordAgentPrompt(content: string): TerminalSessionEvent;
  recordAgentResponse(content: string): TerminalSessionEvent;
  recordStateSnapshot(): TerminalSessionEvent | null;
  exportAsScript(): string;
  exportAsLog(format?: string): string;
  exportAsMarkdown(meta?: TerminalSessionMeta | null): string;
  get events(): TerminalSessionEvent[];
  get dirty(): boolean;
}
