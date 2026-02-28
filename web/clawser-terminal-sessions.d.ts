export function createTerminalSessionId(): string;

export interface TerminalSessionMeta {
  id: string;
  name: string;
  created: number;
  lastUsed: number;
  commandCount: number;
  preview: string;
  version: number;
  workspaceId: string;
}

export interface TerminalEvent {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

export class TerminalSessionManager {
  constructor(opts: { wsId: string; shell: unknown });
  init(): Promise<{ restored: boolean; events?: TerminalEvent[] }>;
  setShell(shell: unknown): void;
  create(name?: string): Promise<TerminalSessionMeta>;
  switchTo(sessionId: string): Promise<TerminalSessionMeta>;
  persist(): Promise<void>;
  restore(termId: string): Promise<{ events: TerminalEvent[] }>;
  delete(sessionId: string): Promise<void>;
  rename(sessionId: string, newName: string): Promise<void>;
  fork(newName?: string): Promise<TerminalSessionMeta>;
  forkFromEvent(eventIndex: number, newName?: string): Promise<TerminalSessionMeta>;
  recordCommand(cmd: string, result?: string): void;
  recordResult(output: string, exitCode?: number): void;
  recordAgentPrompt(prompt: string): void;
  recordAgentResponse(response: string): void;
  recordStateSnapshot(state: Record<string, unknown>): void;
  list(): TerminalSessionMeta[];
  get activeId(): string | null;
  get activeName(): string;
  get events(): TerminalEvent[];
  get dirty(): boolean;
  exportAsScript(): string;
  exportAsLog(): string;
  exportAsMarkdown(): string;
}
