/**
 * Flat provider configuration embedded directly in an agent definition.
 * Replaces the old Agent → Account → Provider indirection chain.
 * An agent carries everything needed to reach its provider in one object.
 */
export interface ProviderConfig {
  /** Provider/service identifier, e.g. 'openai', 'anthropic', 'echo' */
  provider: string;
  /** Model identifier, e.g. 'gpt-4o', 'claude-sonnet-4-6' */
  model: string;
  /** Account ID for credential lookup (vault/localStorage). Null for no-key providers. */
  accountId?: string | null;
  /** Optional base URL override (CORS proxy, custom endpoint) */
  baseUrl?: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  /** @deprecated Use providerConfig.provider instead. Kept for backward compat. */
  provider: string;
  /** @deprecated Use providerConfig.model instead. Kept for backward compat. */
  model: string;
  /** @deprecated Use providerConfig.accountId instead. Kept for backward compat. */
  accountId: string | null;
  /** Flat provider configuration — the canonical source for provider/model/credentials */
  providerConfig?: ProviderConfig;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  contextWindow: number | null;
  autonomy: string;
  tools: { mode: string; list: string[]; permissionOverrides: Record<string, string> };
  domainAllowlist: string[];
  maxCostPerTurn: number | null;
  maxTurnsPerRun: number;
  scope: 'builtin' | 'global' | 'workspace';
  workspaceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export class AgentStorage {
  constructor(opts: {
    globalDir?: FileSystemDirectoryHandle;
    wsDir?: FileSystemDirectoryHandle;
    wsId: string;
  });
  listGlobal(): Promise<AgentDefinition[]>;
  listWorkspace(): Promise<AgentDefinition[]>;
  listAll(): Promise<AgentDefinition[]>;
  save(agent: AgentDefinition): Promise<void>;
  load(id: string): Promise<AgentDefinition | null>;
  delete(id: string): Promise<void>;
  getActive(): Promise<AgentDefinition | null>;
  setActive(agentId: string): void;
  seedBuiltins(): Promise<void>;
  exportAgent(agent: AgentDefinition): string;
  importAgent(json: string): Promise<AgentDefinition>;
}

export const BUILTIN_AGENTS: AgentDefinition[];
export function generateAgentId(): string;
export function resolveAgentProvider(agent: AgentDefinition, accounts: import('./clawser-accounts.d.ts').Account[]): string;
export function migrateAgentAccounts(accounts: import('./clawser-accounts.d.ts').Account[], storage: AgentStorage): Promise<number>;

/**
 * Build a flat ProviderConfig from an AgentDefinition, resolving legacy fields.
 * New agents should use providerConfig directly; this normalizes old agents.
 */
export function toProviderConfig(agent: AgentDefinition): ProviderConfig;

/**
 * Migrate an AgentDefinition from legacy provider/model/accountId fields
 * to the flat providerConfig object. Idempotent — skips agents that already have providerConfig.
 */
export function migrateToProviderConfig(agent: AgentDefinition): AgentDefinition;

/**
 * Batch-migrate all persisted agents to providerConfig format.
 * Returns the number of agents migrated.
 */
export function migrateAllToProviderConfig(storage: AgentStorage): Promise<number>;
