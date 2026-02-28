import type { ToolResult } from './types.d.ts';
import { BrowserTool } from './clawser-tools.js';

export interface OAuthProviderDef {
  name: string;
  authUrl: string;
  tokenUrl: string;
  baseUrl: string;
  scopes: Record<string, string[]>;
  requiresClientId: boolean;
}

export const OAUTH_PROVIDERS: Readonly<Record<string, OAuthProviderDef>>;

export class OAuthConnection {
  constructor(provider: string, tokens: { access_token: string; refresh_token?: string; expires_at?: number; scope?: string }, opts?: { fetchFn?: typeof fetch });
  get provider(): string;
  get accessToken(): string;
  get refreshToken(): string | undefined;
  get expiresAt(): number;
  get scope(): string;
  get expired(): boolean;
  updateTokens(tokens: Record<string, unknown>): void;
  fetch(path: string, options?: RequestInit): Promise<Response>;
}

export class OAuthManager {
  constructor(opts?: {
    vault?: unknown;
    redirectUri?: string;
    onLog?: (msg: string) => void;
    openPopupFn?: (url: string) => Promise<{ code: string }>;
    exchangeCodeFn?: (provider: string, code: string, config: unknown) => Promise<unknown>;
    refreshTokenFn?: (provider: string, refreshToken: string, config: unknown) => Promise<unknown>;
    fetchFn?: typeof fetch;
  });
  get connectionCount(): number;
  setClientConfig(provider: string, clientId: string, clientSecret?: string): void;
  getClientConfig(provider: string): { clientId: string; clientSecret?: string } | null;
  connect(provider: string, scopes?: string[]): Promise<boolean>;
  disconnect(provider: string): Promise<boolean>;
  getClient(provider: string): Promise<OAuthConnection | null>;
  listConnections(): Array<{ provider: string; name: string; expired: boolean }>;
  isConnected(provider: string): boolean;
  restoreFromVault(providers: string[]): Promise<string[]>;
}

export class OAuthListTool extends BrowserTool {
  constructor(manager: OAuthManager);
  execute(): Promise<ToolResult>;
}

export class OAuthConnectTool extends BrowserTool {
  constructor(manager: OAuthManager);
  execute(params: { provider: string; scopes?: string[] }): Promise<ToolResult>;
}

export class OAuthDisconnectTool extends BrowserTool {
  constructor(manager: OAuthManager);
  execute(params: { provider: string }): Promise<ToolResult>;
}

export class OAuthApiTool extends BrowserTool {
  constructor(manager: OAuthManager);
  execute(params: { provider: string; path: string; method?: string; body?: string }): Promise<ToolResult>;
}
