import type { ToolResult } from './types.d.ts';
import { BrowserTool } from './clawser-tools.js';

export interface AuthProfile {
  id: string;
  name: string;
  provider: string;
  authType: 'api_key' | 'oauth' | 'token' | 'none';
  baseUrl: string | null;
  defaultModel: string | null;
  metadata: {
    organization?: string | null;
    project?: string | null;
    created: number;
    lastUsed: number | null;
    [key: string]: unknown;
  };
}

export function createAuthProfile(opts: Partial<AuthProfile> & { provider: string }): AuthProfile;

export class AuthProfileManager {
  constructor(opts?: { vault?: unknown; onProfileChanged?: (provider: string, profileId: string) => void });
  addProfile(provider: string, name: string, credentials: unknown, opts?: Partial<AuthProfile>): Promise<AuthProfile>;
  removeProfile(id: string): Promise<boolean>;
  switchProfile(provider: string, profileId: string): boolean;
  getActiveCredentials(provider: string): Promise<unknown | null>;
  getActiveProfile(provider: string): AuthProfile | null;
  listProfiles(provider?: string): AuthProfile[];
  isActive(profileId: string): boolean;
  getActiveMap(): Record<string, string>;
  setActiveMap(map: Record<string, string>): void;
  get size(): number;
  buildPrompt(): string;
  toJSON(): { profiles: AuthProfile[]; active: Record<string, string> };
  fromJSON(data: { profiles?: AuthProfile[]; active?: Record<string, string> }): void;
}

export class AuthListProfilesTool extends BrowserTool {
  constructor(manager: AuthProfileManager);
  execute(params?: { provider?: string }): Promise<ToolResult>;
}

export class AuthSwitchProfileTool extends BrowserTool {
  constructor(manager: AuthProfileManager);
  execute(params: { provider: string; profile_id: string }): Promise<ToolResult>;
}

export class AuthStatusTool extends BrowserTool {
  constructor(manager: AuthProfileManager);
  execute(): Promise<ToolResult>;
}
