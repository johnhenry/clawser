/**
 * Type definitions for clawser-codex.js
 * Code-based tool execution via sandbox
 */

import type { BrowserToolRegistry } from './clawser-tools.d.ts';
import type { ToolResult } from './types.d.ts';

// ── Code Block Extraction ──────────────────────────────────────

export interface CodeBlock {
  lang: string;
  code: string;
}

export declare function extractCodeBlocks(text: string): CodeBlock[];
export declare function stripCodeBlocks(text: string): string;
export declare function adaptPythonisms(code: string): string;
export declare function autoAwait(code: string): string;

// ── Codex Execution Results ────────────────────────────────────

export interface CodexResult {
  code: string;
  output: string;
  error?: string;
}

export interface CodexToolCall {
  id: string;
  name: '_codex_eval';
  arguments: string;
  _result: ToolResult;
}

export interface CodexExecutionResult {
  text: string;
  results: CodexResult[];
  toolCalls: CodexToolCall[];
}

// ── Codex ──────────────────────────────────────────────────────

export interface CodexOptions {
  onLog?: (level: number, msg: string) => void;
}

export declare class Codex {
  constructor(browserTools: BrowserToolRegistry, opts?: CodexOptions);

  execute(llmResponse: string): Promise<CodexExecutionResult>;
  buildToolPrompt(): string;
  get _sandbox(): unknown | null;
  dispose(): Promise<void>;
}
