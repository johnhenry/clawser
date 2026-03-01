// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-oauth.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Polyfills ────────────────────────────────────────────────────
globalThis.BrowserTool = class { constructor() {} };

// crypto.getRandomValues is needed by OAuthManager#buildAuthUrl
if (!globalThis.crypto?.getRandomValues) {
  globalThis.crypto = globalThis.crypto || {};
  globalThis.crypto.getRandomValues = (arr) => {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    return arr;
  };
}

// ── Dynamic import (after polyfills) ─────────────────────────────
const { OAUTH_PROVIDERS, OAuthConnection, OAuthManager } = await import('../clawser-oauth.js');

// ── 1. OAUTH_PROVIDERS ───────────────────────────────────────────

describe('OAUTH_PROVIDERS', () => {
  it('is a frozen object', () => {
    assert.ok(Object.isFrozen(OAUTH_PROVIDERS));
  });

  it('has expected provider keys', () => {
    const keys = Object.keys(OAUTH_PROVIDERS);
    for (const expected of ['google', 'github', 'notion', 'slack', 'linear']) {
      assert.ok(keys.includes(expected), `missing provider: ${expected}`);
    }
  });

  it('each provider has name, authUrl, tokenUrl, baseUrl, scopes', () => {
    for (const [key, provider] of Object.entries(OAUTH_PROVIDERS)) {
      assert.equal(typeof provider.name, 'string', `${key}.name`);
      assert.equal(typeof provider.authUrl, 'string', `${key}.authUrl`);
      assert.equal(typeof provider.tokenUrl, 'string', `${key}.tokenUrl`);
      assert.equal(typeof provider.baseUrl, 'string', `${key}.baseUrl`);
      assert.equal(typeof provider.scopes, 'object', `${key}.scopes`);
    }
  });

  it('each provider has requiresClientId true', () => {
    for (const [key, provider] of Object.entries(OAUTH_PROVIDERS)) {
      assert.equal(provider.requiresClientId, true, `${key}.requiresClientId`);
    }
  });

  it('google authUrl points to accounts.google.com', () => {
    assert.ok(OAUTH_PROVIDERS.google.authUrl.includes('accounts.google.com'));
  });
});

// ── 2. OAuthConnection ──────────────────────────────────────────

describe('OAuthConnection', () => {
  let conn;

  beforeEach(() => {
    conn = new OAuthConnection('github', {
      access_token: 'test_access',
      refresh_token: 'test_refresh',
      expires_at: Date.now() + 60_000,
      scope: 'repo',
    });
  });

  it('constructor stores provider', () => {
    assert.equal(conn.provider, 'github');
  });

  it('accessToken getter returns token', () => {
    assert.equal(conn.accessToken, 'test_access');
  });

  it('refreshToken getter returns refresh token', () => {
    assert.equal(conn.refreshToken, 'test_refresh');
  });

  it('expired returns false when before expiry', () => {
    assert.equal(conn.expired, false);
  });

  it('expired returns true when past expiry', () => {
    const expired = new OAuthConnection('github', {
      access_token: 'tok',
      refresh_token: 'rt',
      expires_at: Date.now() - 1000,
      scope: 'repo',
    });
    assert.equal(expired.expired, true);
  });

  it('updateTokens updates stored tokens', () => {
    conn.updateTokens({ access_token: 'new_access' });
    assert.equal(conn.accessToken, 'new_access');
    // refresh token should remain unchanged
    assert.equal(conn.refreshToken, 'test_refresh');
  });

  it('scope getter returns scope string', () => {
    assert.equal(conn.scope, 'repo');
  });

  it('expiresAt returns a number', () => {
    assert.equal(typeof conn.expiresAt, 'number');
    assert.ok(conn.expiresAt > 0);
  });
});

// ── 3. OAuthManager ──────────────────────────────────────────────

describe('OAuthManager', () => {
  let manager;

  beforeEach(() => {
    manager = new OAuthManager();
  });

  it('constructor defaults connectionCount to 0', () => {
    assert.equal(manager.connectionCount, 0);
  });

  it('setClientConfig stores config', () => {
    manager.setClientConfig('github', 'my-client-id', 'my-secret');
    const cfg = manager.getClientConfig('github');
    assert.deepStrictEqual(cfg, { clientId: 'my-client-id', clientSecret: 'my-secret' });
  });

  it('getClientConfig retrieves stored config', () => {
    manager.setClientConfig('google', 'gid');
    const cfg = manager.getClientConfig('google');
    assert.equal(cfg.clientId, 'gid');
  });

  it('getClientConfig returns null for unknown provider', () => {
    assert.equal(manager.getClientConfig('unknown_provider'), null);
  });

  it('connect throws for unknown provider', async () => {
    await assert.rejects(
      () => manager.connect('nonexistent'),
      { message: /Unknown provider/ },
    );
  });

  it('connect throws without client config', async () => {
    await assert.rejects(
      () => manager.connect('github'),
      { message: /No client config/ },
    );
  });

  it('isConnected returns false for unconnected provider', () => {
    assert.equal(manager.isConnected('github'), false);
  });

  it('listConnections returns empty array initially', () => {
    assert.deepStrictEqual(manager.listConnections(), []);
  });

  it('disconnect returns false for unconnected provider', async () => {
    const result = await manager.disconnect('github');
    assert.equal(result, false);
  });
});
