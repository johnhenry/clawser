// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-auth-profiles.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { AuthProfileManager } from '../clawser-auth-profiles.js';

const mockVault = () => {
  const data = new Map();
  return {
    data,
    isLocked: false,
    async store(name, secret) { data.set(name, secret); },
    async retrieve(name) {
      if (!data.has(name)) throw new Error(`Secret not found: ${name}`);
      return data.get(name);
    },
    async delete(name) { data.delete(name); },
  };
};

describe('AuthProfileManager.updateCredentials', () => {
  let vault, mgr, profile;

  beforeEach(async () => {
    vault = mockVault();
    mgr = new AuthProfileManager({ vault });
    // "+ New Profile" pattern: created with empty credentials
    profile = await mgr.addProfile('openai', 'Work Key', {});
  });

  it('stores credentials for an existing profile via the vault', async () => {
    const ok = await mgr.updateCredentials(profile.id, { apiKey: 'sk-live-123' });
    assert.equal(ok, true);
    assert.equal(vault.data.get(`auth_${profile.id}`), JSON.stringify({ apiKey: 'sk-live-123' }));
  });

  it('accepts string credentials verbatim', async () => {
    await mgr.updateCredentials(profile.id, 'raw-token');
    assert.equal(vault.data.get(`auth_${profile.id}`), 'raw-token');
  });

  it('returns false for an unknown profile', async () => {
    assert.equal(await mgr.updateCredentials('nope', { apiKey: 'x' }), false);
  });

  it('records credentialsSetAt metadata', async () => {
    await mgr.updateCredentials(profile.id, { apiKey: 'x' });
    const got = mgr.getProfile?.(profile.id) ?? mgr.listProfiles('openai')[0];
    assert.ok(got.metadata.credentialsSetAt > 0);
  });
});

describe('AuthProfileManager.hasCredentials', () => {
  it('false for empty credentials, true after updateCredentials', async () => {
    const vault = mockVault();
    const mgr = new AuthProfileManager({ vault });
    const p = await mgr.addProfile('openai', 'Empty', {});
    assert.equal(await mgr.hasCredentials(p.id), false); // '{}' counts as empty

    await mgr.updateCredentials(p.id, { apiKey: 'sk-x' });
    assert.equal(await mgr.hasCredentials(p.id), true);
  });

  it('false for unknown profile or when vault is absent', async () => {
    const mgr = new AuthProfileManager();
    assert.equal(await mgr.hasCredentials('nope'), false);
  });
});
