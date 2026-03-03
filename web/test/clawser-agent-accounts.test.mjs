// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-agent-accounts.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../clawser-state.js';
import {
  SERVICES,
  BUILTIN_ACCOUNTS,
  loadAccounts,
  saveAccounts,
  seedBuiltinAccounts,
  deleteAccount,
  createAccount,
} from '../clawser-accounts.js';
import {
  BUILTIN_AGENTS,
  AgentStorage,
  resolveAgentProvider,
  migrateAgentAccounts,
} from '../clawser-agent-storage.js';

// Ensure vault is null so createAccount takes the plaintext path
state.services.vault = null;

// ── Phase 1: Built-in Services & Accounts ────────────────────────

describe('SERVICES: echo and chrome-ai entries', () => {
  it('has echo service', () => {
    assert.ok('echo' in SERVICES, 'SERVICES should include echo');
    assert.equal(SERVICES.echo.name, 'Echo (Test)');
  });

  it('has chrome-ai service', () => {
    assert.ok('chrome-ai' in SERVICES, 'SERVICES should include chrome-ai');
    assert.equal(SERVICES['chrome-ai'].name, 'Chrome AI');
    assert.equal(SERVICES['chrome-ai'].defaultModel, 'gemini-nano');
  });
});

describe('BUILTIN_ACCOUNTS', () => {
  it('has two built-in accounts', () => {
    assert.equal(BUILTIN_ACCOUNTS.length, 2);
    assert.equal(BUILTIN_ACCOUNTS[0].id, 'acct_builtin_echo');
    assert.equal(BUILTIN_ACCOUNTS[1].id, 'acct_builtin_chrome_ai');
  });

  it('built-in accounts have correct services', () => {
    assert.equal(BUILTIN_ACCOUNTS[0].service, 'echo');
    assert.equal(BUILTIN_ACCOUNTS[1].service, 'chrome-ai');
  });
});

describe('seedBuiltinAccounts()', () => {
  beforeEach(() => { localStorage.clear(); });

  it('seeds built-in accounts into empty list', () => {
    seedBuiltinAccounts();
    const accts = loadAccounts();
    assert.ok(accts.some(a => a.id === 'acct_builtin_echo'));
    assert.ok(accts.some(a => a.id === 'acct_builtin_chrome_ai'));
  });

  it('is idempotent — does not duplicate built-ins', () => {
    seedBuiltinAccounts();
    seedBuiltinAccounts();
    seedBuiltinAccounts();
    const accts = loadAccounts();
    const echoCount = accts.filter(a => a.id === 'acct_builtin_echo').length;
    assert.equal(echoCount, 1, 'should only have one echo account');
  });

  it('preserves existing user accounts', async () => {
    const id = await createAccount({ name: 'User Acct', service: 'openai', apiKey: 'sk-test', model: 'gpt-4o' });
    seedBuiltinAccounts();
    const accts = loadAccounts();
    assert.ok(accts.some(a => a.id === id), 'user account preserved');
    assert.ok(accts.some(a => a.id === 'acct_builtin_echo'), 'built-in seeded');
  });
});

describe('deleteAccount() protection', () => {
  beforeEach(() => { localStorage.clear(); });

  it('cannot delete built-in accounts', () => {
    seedBuiltinAccounts();
    deleteAccount('acct_builtin_echo');
    const accts = loadAccounts();
    assert.ok(accts.some(a => a.id === 'acct_builtin_echo'), 'echo account still exists');
  });

  it('can still delete user accounts', async () => {
    const id = await createAccount({ name: 'Temp', service: 'openai', apiKey: 'sk-t', model: 'gpt-4o' });
    deleteAccount(id);
    const accts = loadAccounts();
    assert.ok(!accts.some(a => a.id === id), 'user account deleted');
  });
});

// ── Phase 2: resolveAgentProvider ────────────────────────────────

describe('resolveAgentProvider()', () => {
  const accounts = [
    { id: 'acct_1', name: 'My OpenAI', service: 'openai', apiKey: 'sk-x', model: 'gpt-4o' },
    { id: 'acct_builtin_echo', name: 'Echo', service: 'echo', apiKey: '', model: '' },
  ];

  it('returns account service when accountId is set', () => {
    const agent = { accountId: 'acct_1', provider: 'anthropic' };
    assert.equal(resolveAgentProvider(agent, accounts), 'openai');
  });

  it('falls back to agent.provider when no accountId', () => {
    const agent = { accountId: null, provider: 'anthropic' };
    assert.equal(resolveAgentProvider(agent, accounts), 'anthropic');
  });

  it('falls back to agent.provider when account not found', () => {
    const agent = { accountId: 'nonexistent', provider: 'groq' };
    assert.equal(resolveAgentProvider(agent, accounts), 'groq');
  });
});

describe('BUILTIN_AGENTS accountIds', () => {
  it('echo agent has acct_builtin_echo', () => {
    const echo = BUILTIN_AGENTS.find(a => a.id === 'agt_builtin_echo');
    assert.equal(echo.accountId, 'acct_builtin_echo');
  });

  it('chrome-ai agent has acct_builtin_chrome_ai', () => {
    const chromeAi = BUILTIN_AGENTS.find(a => a.id === 'agt_builtin_chrome_ai');
    assert.equal(chromeAi.accountId, 'acct_builtin_chrome_ai');
  });

  it('Claude Sonnet has accountId: null', () => {
    const sonnet = BUILTIN_AGENTS.find(a => a.id === 'agt_builtin_sonnet');
    assert.equal(sonnet.accountId, null);
  });
});

// ── Phase 5: Fallback chain providerId ───────────────────────────

describe('FallbackEntry uses providerId (not provider)', () => {
  it('createFallbackEntry has providerId field', async () => {
    const { createFallbackEntry } = await import('../clawser-fallback.js');
    const entry = createFallbackEntry({ providerId: 'openai', model: 'gpt-4o' });
    assert.equal(entry.providerId, 'openai');
    assert.equal(entry.provider, undefined, 'should not have provider field');
  });
});

// ── Phase 6: migrateAgentAccounts ────────────────────────────────

describe('migrateAgentAccounts()', () => {
  beforeEach(() => { localStorage.clear(); });

  it('links agent to matching account', async () => {
    // Create a minimal AgentStorage backed by localStorage
    const storage = new AgentStorage({ wsId: 'test' });
    const agent = {
      id: 'agt_test_1', name: 'Test Agent', provider: 'openai', model: 'gpt-4o',
      accountId: null, scope: 'global', tools: { mode: 'all', list: [], permissionOverrides: {} },
      domainAllowlist: [], maxTurnsPerRun: 20, autonomy: 'balanced', systemPrompt: '',
      temperature: 0.7, maxTokens: 4096, contextWindow: null, maxCostPerTurn: null,
    };
    await storage.save(agent);

    const accounts = [
      { id: 'acct_100', name: 'OpenAI Acct', service: 'openai', apiKey: 'sk-x', model: 'gpt-4o' },
    ];

    const count = await migrateAgentAccounts(accounts, storage);
    assert.equal(count, 1);

    const migrated = await storage.load('agt_test_1');
    assert.equal(migrated.accountId, 'acct_100');
  });

  it('does not touch agents that already have accountId', async () => {
    const storage = new AgentStorage({ wsId: 'test2' });
    const agent = {
      id: 'agt_test_2', name: 'Already Linked', provider: 'openai', model: 'gpt-4o',
      accountId: 'acct_existing', scope: 'global', tools: { mode: 'all', list: [], permissionOverrides: {} },
      domainAllowlist: [], maxTurnsPerRun: 20, autonomy: 'balanced', systemPrompt: '',
      temperature: 0.7, maxTokens: 4096, contextWindow: null, maxCostPerTurn: null,
    };
    await storage.save(agent);

    const accounts = [
      { id: 'acct_200', name: 'Other Acct', service: 'openai', apiKey: 'sk-y', model: 'gpt-4o' },
    ];

    const count = await migrateAgentAccounts(accounts, storage);
    assert.equal(count, 0);
    const loaded = await storage.load('agt_test_2');
    assert.equal(loaded.accountId, 'acct_existing', 'should keep original accountId');
  });
});
