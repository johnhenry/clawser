export interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  provider: string;
  model: string;
  accountId: string | null;
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
