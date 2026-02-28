// clawser-oauth.js — OAuth App Integrations
//
// OAUTH_PROVIDERS: provider registry (Google, GitHub, Notion, Slack, etc.)
// OAuthConnection: per-provider authenticated fetch with auto-refresh & CORS fallback
// OAuthManager: popup auth flow, token lifecycle, vault storage
// Agent tools: oauth_list, oauth_connect, oauth_disconnect, oauth_api

import { BrowserTool } from './clawser-tools.js';

// ── Constants ───────────────────────────────────────────────────

export const OAUTH_PROVIDERS = Object.freeze({
  google: {
    name: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    baseUrl: 'https://www.googleapis.com',
    scopes: {
      calendar: ['https://www.googleapis.com/auth/calendar'],
      gmail: ['https://www.googleapis.com/auth/gmail.modify'],
      drive: ['https://www.googleapis.com/auth/drive'],
      tasks: ['https://www.googleapis.com/auth/tasks'],
    },
    requiresClientId: true,
  },
  github: {
    name: 'GitHub',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    baseUrl: 'https://api.github.com',
    scopes: {
      repo: ['repo'],
      issues: ['repo'],
      actions: ['repo', 'workflow'],
    },
    requiresClientId: true,
  },
  notion: {
    name: 'Notion',
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    baseUrl: 'https://api.notion.com/v1',
    scopes: {},
    requiresClientId: true,
  },
  slack: {
    name: 'Slack',
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    baseUrl: 'https://slack.com/api',
    scopes: {
      channels: ['channels:read', 'channels:history'],
      chat: ['chat:write'],
    },
    requiresClientId: true,
  },
  linear: {
    name: 'Linear',
    authUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    baseUrl: 'https://api.linear.app',
    scopes: {
      read: ['read'],
      write: ['read', 'write'],
    },
    requiresClientId: true,
  },
});

// ── OAuthConnection ─────────────────────────────────────────────

/**
 * An authenticated connection to an OAuth provider.
 * Wraps fetch with Bearer token.
 */
export class OAuthConnection {
  #provider;
  #tokens;
  #baseUrl;
  #fetchFn;

  /**
   * @param {string} provider - Provider key from OAUTH_PROVIDERS
   * @param {object} tokens - { access_token, refresh_token, expires_at, scope }
   * @param {object} [opts]
   * @param {Function} [opts.fetchFn] - Injectable fetch
   */
  constructor(provider, tokens, opts = {}) {
    this.#provider = provider;
    this.#tokens = { ...tokens };
    this.#baseUrl = (OAUTH_PROVIDERS[provider]?.baseUrl || '').replace(/\/+$/, '');
    this.#fetchFn = opts.fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  }

  get provider() { return this.#provider; }
  get accessToken() { return this.#tokens.access_token; }
  get refreshToken() { return this.#tokens.refresh_token; }
  get expiresAt() { return this.#tokens.expires_at || 0; }
  get scope() { return this.#tokens.scope || ''; }
  get expired() { return Date.now() > this.expiresAt; }

  /**
   * Update tokens (e.g. after refresh).
   * @param {object} tokens
   */
  updateTokens(tokens) {
    Object.assign(this.#tokens, tokens);
  }

  /**
   * Fetch an API endpoint with auth headers.
   * @param {string} path - API path (e.g. /calendar/v3/events)
   * @param {object} [options] - Fetch options
   * @returns {Promise<Response>}
   */
  async fetch(path, options = {}) {
    const headers = {
      Authorization: `Bearer ${this.#tokens.access_token}`,
      ...(options.headers || {}),
    };

    const url = `${this.#baseUrl}${path}`;
    const resp = await this.#fetchFn(url, { ...options, headers });
    return resp;
  }
}

// ── OAuthManager ────────────────────────────────────────────────

/**
 * Manages OAuth connections: popup auth, token exchange, vault storage, auto-refresh.
 */
export class OAuthManager {
  /** @type {Map<string, OAuthConnection>} */
  #connections = new Map();

  /** @type {Map<string, { clientId: string, clientSecret?: string }>} */
  #clientConfigs = new Map();

  /** @type {object|null} SecretVault instance */
  #vault;

  /** @type {string} */
  #redirectUri;

  /** @type {Function|null} */
  #onLog;

  /** @type {Function|null} Injectable popup opener for testing */
  #openPopupFn;

  /** @type {Function|null} Injectable token exchanger for testing */
  #exchangeCodeFn;

  /** @type {Function|null} Injectable token refresher for testing */
  #refreshTokenFn;

  /** @type {Function|null} Injectable fetch */
  #fetchFn;

  /**
   * @param {object} [opts]
   * @param {object} [opts.vault] - SecretVault instance
   * @param {string} [opts.redirectUri] - OAuth callback URI
   * @param {Function} [opts.onLog]
   * @param {Function} [opts.openPopupFn] - (url) => Promise<{ code }>
   * @param {Function} [opts.exchangeCodeFn] - (provider, code, config) => Promise<tokens>
   * @param {Function} [opts.refreshTokenFn] - (provider, refreshToken, config) => Promise<tokens>
   * @param {Function} [opts.fetchFn]
   */
  constructor(opts = {}) {
    this.#vault = opts.vault || null;
    this.#redirectUri = opts.redirectUri || '';
    this.#onLog = opts.onLog || null;
    this.#openPopupFn = opts.openPopupFn || null;
    this.#exchangeCodeFn = opts.exchangeCodeFn || null;
    this.#refreshTokenFn = opts.refreshTokenFn || null;
    this.#fetchFn = opts.fetchFn || null;
  }

  /** Number of active connections. */
  get connectionCount() { return this.#connections.size; }

  // ── Client Configuration ───────────────────────────────

  /**
   * Set OAuth client credentials for a provider.
   * @param {string} provider
   * @param {string} clientId
   * @param {string} [clientSecret]
   */
  setClientConfig(provider, clientId, clientSecret) {
    this.#clientConfigs.set(provider, { clientId, clientSecret });
  }

  /**
   * Get client config for a provider.
   * @param {string} provider
   * @returns {{ clientId: string, clientSecret?: string }|null}
   */
  getClientConfig(provider) {
    return this.#clientConfigs.get(provider) || null;
  }

  // ── Connection Lifecycle ───────────────────────────────

  /**
   * Initiate OAuth flow for a provider.
   * @param {string} provider - Key in OAUTH_PROVIDERS
   * @param {string[]} [scopes] - Specific scopes to request
   * @returns {Promise<boolean>}
   */
  async connect(provider, scopes = []) {
    const config = OAUTH_PROVIDERS[provider];
    if (!config) throw new Error(`Unknown provider: ${provider}`);

    const clientConfig = this.#clientConfigs.get(provider);
    if (!clientConfig) throw new Error(`No client config for ${provider}. Set client ID first.`);

    // Build auth URL
    const scopeList = scopes.length > 0
      ? scopes
      : Object.values(config.scopes).flat();

    const authUrl = this.#buildAuthUrl(config, clientConfig, scopeList);

    // Open popup for auth
    let code;
    if (this.#openPopupFn) {
      const result = await this.#openPopupFn(authUrl);
      // Validate CSRF state parameter
      if (this._pendingState && result.state !== this._pendingState) {
        this._pendingState = null;
        throw new Error('OAuth state mismatch — possible CSRF attack');
      }
      this._pendingState = null;
      code = result.code;
    } else {
      throw new Error('No popup handler configured');
    }

    if (!code) throw new Error('No authorization code received');

    // Exchange code for tokens
    let tokens;
    if (this.#exchangeCodeFn) {
      tokens = await this.#exchangeCodeFn(provider, code, clientConfig);
    } else {
      throw new Error('No code exchange handler configured');
    }

    // Store in vault
    if (this.#vault) {
      await this.#vault.store(`oauth_${provider}`, JSON.stringify(tokens));
    }

    // Create connection
    const conn = new OAuthConnection(provider, tokens, {
      fetchFn: this.#fetchFn,
    });
    this.#connections.set(provider, conn);
    this.#log(`Connected to ${config.name}`);

    return true;
  }

  /**
   * Disconnect from a provider.
   * @param {string} provider
   * @returns {Promise<boolean>}
   */
  async disconnect(provider) {
    if (!this.#connections.has(provider)) return false;

    if (this.#vault) {
      await this.#vault.delete(`oauth_${provider}`);
    }

    this.#connections.delete(provider);
    this.#log(`Disconnected from ${provider}`);
    return true;
  }

  /**
   * Get or refresh a connection.
   * @param {string} provider
   * @returns {Promise<OAuthConnection|null>}
   */
  async getClient(provider) {
    const conn = this.#connections.get(provider);
    if (!conn) return null;

    // Auto-refresh if expired
    if (conn.expired && conn.refreshToken) {
      const clientConfig = this.#clientConfigs.get(provider);
      if (this.#refreshTokenFn && clientConfig) {
        try {
          const newTokens = await this.#refreshTokenFn(provider, conn.refreshToken, clientConfig);
          conn.updateTokens(newTokens);
          if (this.#vault) {
            await this.#vault.store(`oauth_${provider}`, JSON.stringify(newTokens));
          }
          this.#log(`Refreshed token for ${provider}`);
        } catch (e) {
          this.#log(`Token refresh failed for ${provider}: ${e.message}`);
          return null;
        }
      }
    }

    return conn;
  }

  /**
   * List connected providers.
   * @returns {Array<{ provider: string, name: string, expired: boolean }>}
   */
  listConnections() {
    return [...this.#connections.entries()].map(([key, conn]) => ({
      provider: key,
      name: OAUTH_PROVIDERS[key]?.name || key,
      expired: conn.expired,
    }));
  }

  /**
   * Check if a provider is connected.
   * @param {string} provider
   * @returns {boolean}
   */
  isConnected(provider) {
    return this.#connections.has(provider);
  }

  /**
   * Restore connections from vault on startup.
   * @param {string[]} providers - Provider keys to try restoring
   * @returns {Promise<string[]>} Successfully restored providers
   */
  async restoreFromVault(providers) {
    const restored = [];
    if (!this.#vault) return restored;

    for (const provider of providers) {
      try {
        const raw = await this.#vault.retrieve(`oauth_${provider}`);
        if (raw) {
          const tokens = JSON.parse(raw);
          const conn = new OAuthConnection(provider, tokens, {
            fetchFn: this.#fetchFn,
          });
          this.#connections.set(provider, conn);
          restored.push(provider);
        }
      } catch {
        // Skip failed restores
      }
    }

    return restored;
  }

  // ── Internal ──────────────────────────────────────────

  #buildAuthUrl(config, clientConfig, scopes) {
    // Generate CSRF state token
    const stateBytes = new Uint8Array(16);
    crypto.getRandomValues(stateBytes);
    const state = Array.from(stateBytes, b => b.toString(16).padStart(2, '0')).join('');
    this._pendingState = state;

    const params = new URLSearchParams({
      client_id: clientConfig.clientId,
      redirect_uri: this.#redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${config.authUrl}?${params.toString()}`;
  }

  #log(msg) {
    if (this.#onLog) this.#onLog(msg);
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

export class OAuthListTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'oauth_list'; }
  get description() { return 'List OAuth-connected apps and available providers.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    const connections = this.#manager.listConnections();
    const available = Object.entries(OAUTH_PROVIDERS)
      .filter(([key]) => !this.#manager.isConnected(key))
      .map(([key, cfg]) => `  ${key}: ${cfg.name} (not connected)`);

    const connected = connections.map(c =>
      `  ${c.provider}: ${c.name} (${c.expired ? 'expired' : 'active'})`
    );

    const lines = [];
    if (connected.length > 0) {
      lines.push(`Connected (${connected.length}):`, ...connected);
    }
    if (available.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push(`Available (${available.length}):`, ...available);
    }
    if (lines.length === 0) {
      lines.push('No providers configured.');
    }

    return { success: true, output: lines.join('\n') };
  }
}

export class OAuthConnectTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'oauth_connect'; }
  get description() { return 'Connect to an OAuth provider (starts auth flow).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Provider key (google, github, notion, slack, linear)' },
        scopes: { type: 'array', items: { type: 'string' }, description: 'Optional specific scopes to request' },
      },
      required: ['provider'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ provider, scopes }) {
    try {
      await this.#manager.connect(provider, scopes || []);
      return { success: true, output: `Connected to ${provider}.` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class OAuthDisconnectTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'oauth_disconnect'; }
  get description() { return 'Disconnect from an OAuth provider.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Provider key to disconnect' },
      },
      required: ['provider'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ provider }) {
    const ok = await this.#manager.disconnect(provider);
    if (ok) return { success: true, output: `Disconnected from ${provider}.` };
    return { success: false, output: '', error: `Not connected to ${provider}` };
  }
}

export class OAuthApiTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'oauth_api'; }
  get description() { return 'Make an API call to a connected OAuth provider.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Provider key' },
        path: { type: 'string', description: 'API path (e.g. /repos/user/repo)' },
        method: { type: 'string', description: 'HTTP method (default GET)' },
        body: { type: 'string', description: 'Request body (JSON string)' },
      },
      required: ['provider', 'path'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ provider, path, method, body }) {
    try {
      const client = await this.#manager.getClient(provider);
      if (!client) return { success: false, output: '', error: `Not connected to ${provider}` };

      const options = { method: method || 'GET' };
      if (body) {
        options.body = body;
        options.headers = { 'Content-Type': 'application/json' };
      }

      const resp = await client.fetch(path, options);
      if (!resp.ok) {
        return { success: false, output: '', error: `API error: ${resp.status}` };
      }

      const data = await resp.json();
      return { success: true, output: JSON.stringify(data, null, 2) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}
