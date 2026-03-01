/**
 * Type definitions for clawser-skills.js
 * Agent Skills system (agentskills.io standard)
 */

import type { ToolResult, SkillManifest } from './types.d.ts';
import type { BrowserTool, BrowserToolRegistry } from './clawser-tools.d.ts';

// ── SkillParser ────────────────────────────────────────────────

export interface ParsedFrontmatter {
  metadata: Record<string, unknown>;
  body: string;
}

export interface MetadataValidation {
  valid: boolean;
  errors: string[];
}

export interface ScriptValidation {
  safe: boolean;
  warnings: string[];
}

export declare class SkillParser {
  static parseFrontmatter(text: string): ParsedFrontmatter;
  static validateMetadata(meta: Record<string, unknown>): MetadataValidation;
  static validateScript(content: string): ScriptValidation;
  static escAttr(str: string): string;
  static substituteArguments(body: string, args?: string): string;
}

// ── SkillStorage ───────────────────────────────────────────────

export declare class SkillStorage {
  static getGlobalSkillsDir(create?: boolean): Promise<FileSystemDirectoryHandle>;
  static getWorkspaceSkillsDir(wsId: string, create?: boolean): Promise<FileSystemDirectoryHandle>;
  static listSkillDirs(scope: 'global' | 'workspace', wsId?: string): Promise<string[]>;
  static readFile(dirHandle: FileSystemDirectoryHandle, path: string): Promise<string>;
  static listSubdir(dirHandle: FileSystemDirectoryHandle, subdir: string): Promise<string[]>;
  static writeSkill(
    scope: 'global' | 'workspace',
    wsId: string | null,
    name: string,
    files: Map<string, string>,
  ): Promise<void>;
  static deleteSkill(
    scope: 'global' | 'workspace',
    wsId: string | null,
    name: string,
  ): Promise<void>;
  static importFromZip(blob: Blob): Promise<Map<string, string>>;
  static exportToZip(dirHandle: FileSystemDirectoryHandle): Promise<Blob>;
}

// ── Skill Entry / Activation Types ─────────────────────────────

export interface SkillEntry {
  name: string;
  dirName: string;
  description: string;
  metadata: Record<string, unknown>;
  scope: 'global' | 'workspace';
  enabled: boolean;
  bodyLength: number;
}

export interface SkillActivation {
  name: string;
  body: string;
  scripts: Array<{ name: string; content: string }>;
  references: string[];
  registeredTools: string[];
}

// ── SkillRegistry ──────────────────────────────────────────────

export interface SkillRegistryOptions {
  browserTools?: BrowserToolRegistry;
  mcpManager?: unknown;
  onLog?: (level: number, msg: string) => void;
  onActivationChange?: (name: string, active: boolean, toolNames: string[]) => void;
}

export interface ActivateOpts {
  force?: boolean;
}

export declare class SkillRegistry {
  constructor(opts?: SkillRegistryOptions);

  get skills(): Map<string, SkillEntry>;
  get activeSkills(): Map<string, SkillActivation>;

  discover(wsId: string): Promise<void>;
  activate(name: string, args?: string, opts?: ActivateOpts): Promise<SkillActivation | null>;
  deactivate(name: string): void;
  buildRequirementsContext(): RequirementsContext;
  setEnabled(name: string, enabled: boolean): void;
  persistEnabledState(wsId: string): void;
  buildMetadataPrompt(): string;
  buildActivationPrompt(name: string): string;
  install(
    scope: 'global' | 'workspace',
    wsId: string | null,
    files: Map<string, string>,
  ): Promise<{ name: string; metadata: Record<string, unknown> }>;
  installFromZip(
    scope: 'global' | 'workspace',
    wsId: string | null,
    blob: Blob,
  ): Promise<{ name: string; metadata: Record<string, unknown> }>;
  uninstall(name: string, wsId: string): Promise<void>;
  getSlashCommandNames(): string[];
}

// ── Skill Tools ────────────────────────────────────────────────

export declare class ActivateSkillTool extends BrowserTool {
  constructor(registry: SkillRegistry, onActivate?: (name: string, activation: SkillActivation) => void);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { name: string; arguments?: string; force?: boolean }): Promise<ToolResult>;
}

export declare class DeactivateSkillTool extends BrowserTool {
  constructor(registry: SkillRegistry, onDeactivate?: (name: string) => void);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { name: string }): Promise<ToolResult>;
}

// ── Semver Utilities ───────────────────────────────────────────

export declare function semverCompare(a: string, b: string): -1 | 0 | 1;
export declare function semverGt(a: string, b: string): boolean;

// ── Requirements Validation ────────────────────────────────────

export interface RequirementsContext {
  tools?: string[];
  permissions?: string[];
}

export interface RequirementsResult {
  satisfied: boolean;
  missing: {
    tools: string[];
    permissions: string[];
  };
}

export declare function validateRequirements(
  metadata: Record<string, unknown>,
  context?: RequirementsContext,
): RequirementsResult;

// ── Skill Integrity & Dependencies ─────────────────────────────

export declare function computeSkillHash(content: string): string;
export declare function verifySkillIntegrity(content: string, expectedHash: string): boolean;

export interface DependencyResolution {
  resolved: boolean;
  missing: string[];
}

export declare function resolveDependencies(
  metadata: Record<string, unknown>,
  available?: { skills?: string[]; tools?: string[] },
): DependencyResolution;

// ── Skill Templates ────────────────────────────────────────────

export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  files(): Map<string, string>;
}

export declare const SKILL_TEMPLATES: SkillTemplate[];

// ── Simple Diff ────────────────────────────────────────────────

export interface DiffLine {
  type: 'same' | 'add' | 'remove';
  line: string;
}

export declare function simpleDiff(oldText: string, newText: string): DiffLine[];

// ── SkillRegistryClient ────────────────────────────────────────

export interface RegistryIndexEntry {
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  path: string;
}

export interface SkillRegistryClientOptions {
  registryUrl?: string;
  cacheTTL?: number;
}

export interface RegistrySearchOptions {
  tags?: string[];
  limit?: number;
}

export interface FetchedSkill {
  content: string;
  metadata: Record<string, unknown>;
  body: string;
}

export interface UpdateCheckResult {
  available: boolean;
  latest: string | null;
  error: string | null;
}

export declare class SkillRegistryClient {
  constructor(opts?: SkillRegistryClientOptions);

  get registryUrl(): string;
  set registryUrl(url: string);

  fetchIndex(): Promise<RegistryIndexEntry[]>;
  search(query: string, opts?: RegistrySearchOptions): Promise<RegistryIndexEntry[]>;
  getSkill(name: string): Promise<FetchedSkill>;
  installFromUrl(
    url: string,
    registry: SkillRegistry,
    scope?: 'global' | 'workspace',
    wsId?: string | null,
  ): Promise<{ name: string; metadata: Record<string, unknown> }>;
  installFromRegistry(
    name: string,
    registry: SkillRegistry,
    scope?: 'global' | 'workspace',
    wsId?: string | null,
    context?: RequirementsContext,
  ): Promise<{ name: string; metadata: Record<string, unknown>; warnings: string[] }>;
  checkUpdate(name: string, currentVersion: string): Promise<UpdateCheckResult>;
  clearCache(): void;
}

// ── Registry Agent Tools ───────────────────────────────────────

export declare class SkillSearchTool extends BrowserTool {
  constructor(client: SkillRegistryClient);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { query: string; tags?: string }): Promise<ToolResult>;
}

export declare class SkillInstallTool extends BrowserTool {
  constructor(client: SkillRegistryClient, registry: SkillRegistry, wsId?: string);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { name: string; scope?: string }): Promise<ToolResult>;
}

export declare class SkillUpdateTool extends BrowserTool {
  constructor(client: SkillRegistryClient, registry: SkillRegistry, wsId?: string);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { name: string }): Promise<ToolResult>;
}

export declare class SkillRemoveTool extends BrowserTool {
  constructor(registry: SkillRegistry, wsId?: string);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(params: { name: string }): Promise<ToolResult>;
}

export declare class SkillListTool extends BrowserTool {
  constructor(registry: SkillRegistry);
  get name(): string;
  get description(): string;
  get parameters(): object;
  get permission(): string;
  execute(): Promise<ToolResult>;
}
