import type { ToolResult } from './types.d.ts';
import { BrowserTool } from './clawser-tools.js';

export const COMMIT_TYPES: Readonly<Record<string, string>>;
export const COMMIT_PREFIX_RE: RegExp;
export const TRAILER_RE: RegExp;

export function formatCommitMessage(opts: {
  type?: string;
  scope?: string;
  subject: string;
  body?: string;
  trailers?: Record<string, string>;
}): string;

export function parseCommitMessage(message: string): {
  type: string | null;
  scope: string | null;
  subject: string;
  body: string;
  trailers: Record<string, string>;
};

export class GitBehavior {
  constructor(opts?: { onLog?: (msg: string) => void; execFn?: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }> });
  exec(cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  status(): Promise<string>;
  diff(staged?: boolean): Promise<string>;
  log(count?: number): Promise<string>;
  commit(message: string): Promise<string>;
  branch(name?: string): Promise<string>;
  checkout(ref: string): Promise<string>;
  stash(action?: string): Promise<string>;
  get available(): boolean;
}

export class GitEpisodicMemory {
  constructor(git: GitBehavior, opts?: { maxEntries?: number });
  record(event: { type: string; summary: string; data?: unknown }): void;
  recall(query?: string): Array<{ type: string; summary: string; timestamp: number; data?: unknown }>;
  get entries(): Array<{ type: string; summary: string; timestamp: number; data?: unknown }>;
  clear(): void;
}

export class GitStatusTool extends BrowserTool {
  constructor(git: GitBehavior);
  execute(): Promise<ToolResult>;
}

export class GitDiffTool extends BrowserTool {
  constructor(git: GitBehavior);
  execute(params: { staged?: boolean; file?: string }): Promise<ToolResult>;
}

export class GitLogTool extends BrowserTool {
  constructor(git: GitBehavior);
  execute(params?: { count?: number; format?: string }): Promise<ToolResult>;
}

export class GitCommitTool extends BrowserTool {
  constructor(git: GitBehavior);
  execute(params: { message: string; type?: string; scope?: string }): Promise<ToolResult>;
}

export class GitBranchTool extends BrowserTool {
  constructor(git: GitBehavior);
  execute(params?: { name?: string; delete_branch?: boolean; checkout?: boolean }): Promise<ToolResult>;
}

export class GitRecallTool extends BrowserTool {
  constructor(memory: GitEpisodicMemory);
  execute(params?: { query?: string }): Promise<ToolResult>;
}

export class CommitSearchIndex {
  add(entry: { oid: string; message: string; timestamp: number }): void;
  readonly size: number;
  clear(): void;
  search(query: string): Array<{ oid: string; message: string; timestamp: number; score: number }>;
}
