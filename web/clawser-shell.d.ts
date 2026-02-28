/**
 * Type definitions for clawser-shell.js
 * Browser shell emulation layer
 */

import type { ToolResult } from './types.d.ts';
import type { BrowserTool, WorkspaceFs } from './clawser-tools.d.ts';

// ── Token Types ────────────────────────────────────────────────

export interface ShellToken {
  type: string;
  value: string;
}

// ── AST Node Types ─────────────────────────────────────────────

export interface CommandNode {
  type: 'command';
  name: string;
  args: string[];
}

export interface PipelineNode {
  type: 'pipeline';
  commands: ASTNode[];
  redirect?: RedirectInfo | null;
}

export interface ListNode {
  type: 'list';
  commands: ASTNode[];
  operators: string[];
}

export interface RedirectInfo {
  type: 'write' | 'append' | null;
  path?: string;
  stderr?: StderrRedirectInfo;
}

export interface StderrRedirectInfo {
  type: 'err_write' | 'err_append' | 'err_to_out';
  path?: string;
}

export type ASTNode = CommandNode | PipelineNode | ListNode;

// ── Shell Execution Result ─────────────────────────────────────

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ── Tokenizer & Parser ─────────────────────────────────────────

export declare function tokenize(input: string): ShellToken[];
export declare function parse(input: string | ShellToken[]): ASTNode | null;

// ── Variable & Glob Expansion ──────────────────────────────────

export declare function expandVariables(token: string, env: Map<string, string> | Record<string, string>): string;
export declare function expandGlobs(
  token: string,
  fs: { listDir(path: string): Promise<Array<{ name: string }>> },
  cwd: string,
): Promise<string[]>;

// ── Path Utilities ─────────────────────────────────────────────

export declare function normalizePath(p: string): string;

// ── ShellState ─────────────────────────────────────────────────

export declare class ShellState {
  cwd: string;
  env: Map<string, string>;
  history: string[];
  lastExitCode: number;
  pipefail: boolean;
  aliases: Map<string, string>;

  constructor();
  resolvePath(path: string): string;
}

// ── CommandRegistry ────────────────────────────────────────────

export interface CommandHandler {
  (ctx: {
    args: string[];
    stdin: string;
    state: ShellState;
    registry: CommandRegistry;
    fs: ShellFsLike | null;
  }): ShellResult | Promise<ShellResult>;
}

export interface CommandMeta {
  description?: string;
  category?: string;
  usage?: string;
  flags?: Record<string, string>;
}

export interface CommandEntry {
  name: string;
  description?: string;
  category?: string;
  usage?: string;
  flags?: Record<string, string>;
}

export declare class CommandRegistry {
  register(name: string, handler: CommandHandler, meta?: CommandMeta): void;
  get(name: string): CommandHandler | null;
  has(name: string): boolean;
  names(): string[];
  getMeta(name: string): CommandMeta | null;
  allEntries(): CommandEntry[];
}

// ── Executor ───────────────────────────────────────────────────

export interface ExecuteOptions {
  stdin?: string;
  fs?: ShellFsLike;
}

export declare function execute(
  node: ASTNode | null,
  state: ShellState,
  registry: CommandRegistry,
  opts?: ExecuteOptions,
): Promise<ShellResult>;

// ── Filesystem Interfaces ──────────────────────────────────────

export interface ShellFsLike {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<Array<{ name: string; kind: string }>>;
  mkdir(path: string): Promise<void>;
  delete(path: string, recursive?: boolean): Promise<void>;
  copy(src: string, dst: string): Promise<void>;
  move(src: string, dst: string): Promise<void>;
  stat(path: string): Promise<{ kind: string; size?: number; lastModified?: number } | null>;
}

export declare class ShellFs implements ShellFsLike {
  constructor(ws: WorkspaceFs);
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<Array<{ name: string; kind: string }>>;
  mkdir(path: string): Promise<void>;
  delete(path: string, recursive?: boolean): Promise<void>;
  copy(src: string, dst: string): Promise<void>;
  move(src: string, dst: string): Promise<void>;
  stat(path: string): Promise<{ kind: string; size?: number; lastModified?: number } | null>;
}

export declare class MemoryFs implements ShellFsLike {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<Array<{ name: string; kind: string }>>;
  mkdir(path: string): Promise<void>;
  delete(path: string, recursive?: boolean): Promise<void>;
  copy(src: string, dst: string): Promise<void>;
  move(src: string, dst: string): Promise<void>;
  stat(path: string): Promise<{ kind: string; size?: number } | null>;
}

// ── Built-in Commands ──────────────────────────────────────────

export declare function registerBuiltins(registry: CommandRegistry): void;

// ── ClawserShell ───────────────────────────────────────────────

export interface ClawserShellOptions {
  workspaceFs?: WorkspaceFs;
  fs?: ShellFsLike;
  registry?: CommandRegistry;
}

export declare class ClawserShell {
  state: ShellState;
  registry: CommandRegistry;
  fs: ShellFsLike | null;

  constructor(opts?: ClawserShellOptions);
  exec(command: string): Promise<ShellResult>;
}

// ── ShellTool ──────────────────────────────────────────────────

export declare class ShellTool extends BrowserTool {
  constructor(getShell: () => ClawserShell | null);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { command: string }): Promise<ToolResult>;
}
