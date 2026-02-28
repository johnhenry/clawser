/**
 * Type definitions for clawser-safety.js
 * Defense-in-depth safety pipeline
 */

// ── InputSanitizer ─────────────────────────────────────────────

export interface SanitizeResult {
  content: string;
  flags: string[];
  warning?: string;
}

export declare class InputSanitizer {
  sanitize(message: string): SanitizeResult;
}

// ── ToolCallValidator ──────────────────────────────────────────

export interface ValidationIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  msg: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export declare class ToolCallValidator {
  validate(toolName: string, args: Record<string, unknown>): ValidationResult;
}

// ── LeakDetector ───────────────────────────────────────────────

export interface LeakPattern {
  name: string;
  regex: RegExp;
  action: 'redact' | 'warn' | 'block';
}

export interface LeakFinding {
  name: string;
  action: 'redact' | 'warn' | 'block';
  count: number;
}

export declare class LeakDetector {
  constructor(patterns?: LeakPattern[]);
  scan(content: string): LeakFinding[];
  redact(content: string): string;
  hasBlockingFindings(findings: LeakFinding[]): boolean;
}

// ── SafetyPipeline ─────────────────────────────────────────────

export interface SafetyPipelineOptions {
  sanitizer?: InputSanitizer;
  validator?: ToolCallValidator;
  leakDetector?: LeakDetector;
}

export interface ScanOutputResult {
  content: string;
  findings: LeakFinding[];
  blocked: boolean;
}

export declare class SafetyPipeline {
  constructor(opts?: SafetyPipelineOptions);

  /** Get whether the pipeline is enabled. */
  get enabled(): boolean;
  /** Set enabled state. Throws if disabling without calling confirmDisable() first. */
  set enabled(v: boolean);
  confirmDisable(): void;
  get sanitizer(): InputSanitizer;
  get validator(): ToolCallValidator;
  get leakDetector(): LeakDetector;

  sanitizeInput(message: string): SanitizeResult;
  validateToolCall(toolName: string, args: Record<string, unknown>): ValidationResult;
  scanOutput(content: string): ScanOutputResult;
}
