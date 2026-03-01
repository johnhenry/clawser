// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-accounts.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../clawser-state.js';
import {
  SERVICES,
  ACCT_KEY,
  loadAccounts,
  saveAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
} from '../clawser-accounts.js';

// Ensure vault is null so createAccount takes the plaintext path
state.services.vault = null;

// ── SERVICES constant (3 tests) ─────────────────────────────────

describe('SERVICES', () => {
  it('has expected provider keys', () => {
    const expected = [
      'openai', 'anthropic', 'groq', 'openrouter', 'together',
      'fireworks', 'mistral', 'deepseek', 'xai', 'perplexity',
      'ollama', 'lmstudio',
    ];
    for (const key of expected) {
      assert.ok(key in SERVICES, `missing provider: ${key}`);
    }
  });

  it('each provider has name, defaultModel, and models array', () => {
    for (const [key, svc] of Object.entries(SERVICES)) {
      assert.ok(typeof svc.name === 'string', `${key}.name should be string`);
      assert.ok(typeof svc.defaultModel === 'string', `${key}.defaultModel should be string`);
      assert.ok(Array.isArray(svc.models), `${key}.models should be array`);
    }
  });

  it('models array is non-empty for each provider', () => {
    for (const [key, svc] of Object.entries(SERVICES)) {
      assert.ok(svc.models.length > 0, `${key}.models should not be empty`);
    }
  });
});

// ── ACCT_KEY (1 test) ───────────────────────────────────────────

describe('ACCT_KEY', () => {
  it('equals "clawser_accounts"', () => {
    assert.equal(ACCT_KEY, 'clawser_accounts');
  });
});

// ── loadAccounts (2 tests) ──────────────────────────────────────

describe('loadAccounts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns empty array when nothing stored', () => {
    assert.deepEqual(loadAccounts(), []);
  });

  it('returns parsed accounts from localStorage', () => {
    const accts = [{ id: 'a1', name: 'Test', service: 'openai', apiKey: 'sk-x', model: 'gpt-4o' }];
    localStorage.setItem(ACCT_KEY, JSON.stringify(accts));
    const loaded = loadAccounts();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, 'a1');
    assert.equal(loaded[0].name, 'Test');
  });
});

// ── saveAccounts (2 tests) ──────────────────────────────────────

describe('saveAccounts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists to localStorage', () => {
    const list = [{ id: 'b1', name: 'Acme' }];
    saveAccounts(list);
    const raw = localStorage.getItem(ACCT_KEY);
    assert.ok(raw);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'b1');
  });

  it('round-trips with loadAccounts', () => {
    const original = [
      { id: 'c1', name: 'One', service: 'anthropic', apiKey: 'key1', model: 'claude-sonnet-4-6' },
      { id: 'c2', name: 'Two', service: 'groq', apiKey: 'key2', model: 'llama-3.3-70b-versatile' },
    ];
    saveAccounts(original);
    const loaded = loadAccounts();
    assert.deepEqual(loaded, original);
  });
});

// ── createAccount (3 tests) ─────────────────────────────────────

describe('createAccount', () => {
  beforeEach(() => {
    localStorage.clear();
    // Ensure vault is null so we take the plaintext path
    state.services.vault = null;
  });

  it('returns an id string', async () => {
    const id = await createAccount({ name: 'Test', service: 'openai', apiKey: 'sk-test', model: 'gpt-4o' });
    assert.ok(typeof id === 'string');
    assert.ok(id.length > 0);
  });

  it('persists new account to localStorage', async () => {
    await createAccount({ name: 'New', service: 'anthropic', apiKey: 'sk-a', model: 'claude-sonnet-4-6' });
    const loaded = loadAccounts();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].name, 'New');
    assert.equal(loaded[0].service, 'anthropic');
  });

  it('saved account has correct fields', async () => {
    const id = await createAccount({ name: 'Full', service: 'groq', apiKey: 'gsk-x', model: 'llama-3.3-70b-versatile' });
    const list = loadAccounts();
    const acct = list.find(a => a.id === id);
    assert.ok(acct);
    assert.equal(acct.name, 'Full');
    assert.equal(acct.service, 'groq');
    assert.equal(acct.apiKey, 'gsk-x');
    assert.equal(acct.model, 'llama-3.3-70b-versatile');
  });
});

// ── updateAccount (2 tests) ─────────────────────────────────────

describe('updateAccount', () => {
  beforeEach(() => {
    localStorage.clear();
    state.services.vault = null;
  });

  it('updates fields on existing account', async () => {
    const id = await createAccount({ name: 'Old', service: 'openai', apiKey: 'sk-1', model: 'gpt-4o' });
    updateAccount(id, { name: 'Updated', model: 'gpt-4o-mini' });
    const list = loadAccounts();
    const acct = list.find(a => a.id === id);
    assert.equal(acct.name, 'Updated');
    assert.equal(acct.model, 'gpt-4o-mini');
    // Unchanged fields remain
    assert.equal(acct.service, 'openai');
    assert.equal(acct.apiKey, 'sk-1');
  });

  it('does nothing for non-existent id', async () => {
    await createAccount({ name: 'Keep', service: 'openai', apiKey: 'sk-2', model: 'gpt-4o' });
    updateAccount('nonexistent', { name: 'Ghost' });
    const list = loadAccounts();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Keep');
  });
});

// ── deleteAccount (2 tests) ─────────────────────────────────────

describe('deleteAccount', () => {
  beforeEach(() => {
    localStorage.clear();
    state.services.vault = null;
  });

  it('removes account from list', async () => {
    const id1 = await createAccount({ name: 'A', service: 'openai', apiKey: 'k1', model: 'gpt-4o' });
    const id2 = await createAccount({ name: 'B', service: 'groq', apiKey: 'k2', model: 'llama-3.3-70b-versatile' });
    deleteAccount(id1);
    const list = loadAccounts();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, id2);
    assert.equal(list[0].name, 'B');
  });

  it('does nothing for non-existent id', async () => {
    await createAccount({ name: 'Stay', service: 'openai', apiKey: 'k3', model: 'gpt-4o' });
    deleteAccount('does-not-exist');
    const list = loadAccounts();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Stay');
  });
});
