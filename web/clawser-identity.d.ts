export interface AIEOSIdentity {
  version: string;
  names: { display: string; full: string; aliases: string[] };
  bio: string;
  psychology: {
    mbti: string | null;
    ocean: Record<string, number> | null;
    moral_compass: string | null;
    neural_matrix: Record<string, number> | null;
  };
  linguistics: {
    formality: number;
    verbosity: number;
    catchphrases: string[];
    forbidden_words: string[];
    vocabulary_level: string;
    tone: string;
  };
  motivations: { core_drive: string; goals: string[]; fears: string[] };
  capabilities: { skills: string[]; tools: string[]; knowledge_domains: string[] };
  physicality: { avatar_description: string; avatar_url: string | null };
  history: unknown[];
}

export const DEFAULT_IDENTITY: Readonly<AIEOSIdentity>;

export function detectIdentityFormat(source: unknown): 'plain' | 'aieos' | 'openclaw';
export function validateAIEOS(raw: unknown): { valid: boolean; identity: AIEOSIdentity; errors: string[] };
export function compileSystemPrompt(identitySource: string | AIEOSIdentity | unknown, context?: Record<string, unknown>): string;

export class IdentityManager {
  constructor(identity?: unknown);
  load(source: unknown): void;
  get identity(): unknown;
  get format(): 'plain' | 'aieos' | 'openclaw';
  get displayName(): string;
  compile(context?: Record<string, unknown>): string;
  reset(): void;
  toJSON(): { format: string; identity: unknown };
  static fromJSON(data: { format?: string; identity?: unknown }): IdentityManager;
}
