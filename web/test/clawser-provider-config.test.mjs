// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-provider-config.test.mjs
//
// Block 52: Tests for the Agent→Provider simplification (providerConfig)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../clawser-state.js';
import {
  BUILTIN_AGENTS,
  AgentStorage,
  resolveAgentProvider,
  toProviderConfig,
  migrateToProviderConfig,
  migrateAllToProviderConfig,
} from '../clawser-agent-storage.js';
import { loadAccounts, saveAccounts, seedBuiltinAccounts } from '../clawser-accounts.js';

// Ensure vault is null so tests use plaintext path
state.services.vault = null;

// ── toProviderConfig ────────────────────────────────────────────

describe('toProviderConfig()', () => {
  it('returns existing providerConfig when present', () => {
    const agent = {
      provider: 'openai',
      model: 'gpt-4o',
      accountId: 'acct_old',
      providerConfig: { provider: 'anthropic', model: 'claude-sonnet-4-6', accountId: 'acct_new' },
    };
    const cfg = toProviderConfig(agent);
    assert.equal(cfg.provider, 'anthropic');
    assert.equal(cfg.model, 'claude-sonnet-4-6');
    assert.equal(cfg.accountId, 'acct_new');
  });

  it('returns a copy, not a reference', () => {
    const agent = {
      providerConfig: { provider: 'openai', model: 'gpt-4o' },
    };
    const cfg = toProviderConfig(agent);
    cfg.provider = 'anthropic';
    assert.equal(agent.providerConfig.provider, 'openai', 'original should be unchanged');
  });

  it('synthesizes from legacy fields when no providerConfig', () => {
    const agent = { provider: 'openai', model: 'gpt-4o', accountId: 'acct_1' };
    const cfg = toProviderConfig(agent);
    assert.equal(cfg.provider, 'openai');
    assert.equal(cfg.model, 'gpt-4o');
    assert.equal(cfg.accountId, 'acct_1');
  });

  it('omits accountId when null', () => {
    const agent = { provider: 'anthropic', model: 'claude-sonnet-4-6', accountId: null };
    const cfg = toProviderConfig(agent);
    assert.equal(cfg.provider, 'anthropic');
    assert.equal(cfg.model, 'claude-sonnet-4-6');
    assert.equal(cfg.accountId, undefined);
  });

  it('handles empty legacy fields gracefully', () => {
    const agent = { provider: '', model: '', accountId: null };
    const cfg = toProviderConfig(agent);
    assert.equal(cfg.provider, '');
    assert.equal(cfg.model, '');
  });
});

// ── migrateToProviderConfig ──────────────────────────────────────

describe('migrateToProviderConfig()', () => {
  it('adds providerConfig from legacy fields', () => {
    const agent = { provider: 'openai', model: 'gpt-4o', accountId: 'acct_1' };
    const result = migrateToProviderConfig(agent);
    assert.deepStrictEqual(result.providerConfig, {
      provider: 'openai',
      model: 'gpt-4o',
      accountId: 'acct_1',
    });
    // Should return the same object (mutated in place)
    assert.equal(result, agent);
  });

  it('is idempotent — does not overwrite existing providerConfig', () => {
    const agent = {
      provider: 'openai',
      model: 'gpt-4o',
      accountId: null,
      providerConfig: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    };
    migrateToProviderConfig(agent);
    assert.equal(agent.providerConfig.provider, 'anthropic', 'should not overwrite');
  });

  it('preserves legacy fields for backward compat', () => {
    const agent = { provider: 'groq', model: 'llama-3.3-70b-versatile', accountId: null };
    migrateToProviderConfig(agent);
    assert.equal(agent.provider, 'groq', 'legacy provider preserved');
    assert.equal(agent.model, 'llama-3.3-70b-versatile', 'legacy model preserved');
  });
});

// ── Built-in agents have providerConfig ──────────────────────────

describe('BUILTIN_AGENTS providerConfig', () => {
  it('all built-in agents have providerConfig', () => {
    for (const agent of BUILTIN_AGENTS) {
      assert.ok(agent.providerConfig, `${agent.name} should have providerConfig`);
      assert.equal(agent.providerConfig.provider, agent.provider,
        `${agent.name} providerConfig.provider should match legacy provider`);
    }
  });

  it('echo agent providerConfig has accountId', () => {
    const echo = BUILTIN_AGENTS.find(a => a.id === 'agt_builtin_echo');
    assert.equal(echo.providerConfig.accountId, 'acct_builtin_echo');
  });

  it('Claude Sonnet providerConfig has no accountId', () => {
    const sonnet = BUILTIN_AGENTS.find(a => a.id === 'agt_builtin_sonnet');
    assert.equal(sonnet.providerConfig.accountId, undefined);
    assert.equal(sonnet.providerConfig.provider, 'anthropic');
    assert.equal(sonnet.providerConfig.model, 'claude-sonnet-4-6');
  });
});

// ── resolveAgentProvider still works ─────────────────────────────

describe('resolveAgentProvider() backward compat', () => {
  const accounts = [
    { id: 'acct_1', name: 'My OpenAI', service: 'openai', apiKey: 'sk-x', model: 'gpt-4o' },
  ];

  it('still resolves from accountId (legacy path)', () => {
    const agent = { accountId: 'acct_1', provider: 'anthropic' };
    assert.equal(resolveAgentProvider(agent, accounts), 'openai');
  });

  it('still falls back to agent.provider when no accountId', () => {
    const agent = { accountId: null, provider: 'anthropic' };
    assert.equal(resolveAgentProvider(agent, accounts), 'anthropic');
  });
});

// ── migrateAllToProviderConfig ───────────────────────────────────

describe('migrateAllToProviderConfig()', () => {
  beforeEach(() => { localStorage.clear(); });

  it('migrates legacy agents to providerConfig', async () => {
    const storage = new AgentStorage({ wsId: 'test_migrate' });
    const agent = {
      id: 'agt_migrate_1', name: 'Legacy Agent', provider: 'openai', model: 'gpt-4o',
      accountId: 'acct_100', scope: 'global', tools: { mode: 'all', list: [], permissionOverrides: {} },
      domainAllowlist: [], maxTurnsPerRun: 20, autonomy: 'balanced', systemPrompt: '',
      temperature: 0.7, maxTokens: 4096, contextWindow: null, maxCostPerTurn: null,
    };
    await storage.save(agent);

    const count = await migrateAllToProviderConfig(storage);
    assert.equal(count, 1);

    const migrated = await storage.load('agt_migrate_1');
    assert.deepStrictEqual(migrated.providerConfig, {
      provider: 'openai',
      model: 'gpt-4o',
      accountId: 'acct_100',
    });
    // Legacy fields preserved
    assert.equal(migrated.provider, 'openai');
    assert.equal(migrated.model, 'gpt-4o');
    assert.equal(migrated.accountId, 'acct_100');
  });

  it('skips agents that already have providerConfig', async () => {
    const storage = new AgentStorage({ wsId: 'test_skip' });
    const agent = {
      id: 'agt_skip_1', name: 'Already Migrated', provider: 'openai', model: 'gpt-4o',
      accountId: null, scope: 'global', tools: { mode: 'all', list: [], permissionOverrides: {} },
      domainAllowlist: [], maxTurnsPerRun: 20, autonomy: 'balanced', systemPrompt: '',
      temperature: 0.7, maxTokens: 4096, contextWindow: null, maxCostPerTurn: null,
      providerConfig: { provider: 'openai', model: 'gpt-4o' },
    };
    await storage.save(agent);

    const count = await migrateAllToProviderConfig(storage);
    assert.equal(count, 0);
  });

  it('does not touch built-in agents', async () => {
    const storage = new AgentStorage({ wsId: 'test_builtin' });
    // Built-ins already have providerConfig from the const, but even without,
    // the migration should skip scope=builtin
    const count = await migrateAllToProviderConfig(storage);
    assert.equal(count, 0);
  });
});

// ── Export/Import with providerConfig ────────────────────────────

describe('AgentStorage export/import with providerConfig', () => {
  beforeEach(() => { localStorage.clear(); });

  it('export strips accountId from providerConfig', () => {
    const storage = new AgentStorage({ wsId: 'test_export' });
    const agent = {
      id: 'agt_exp_1', name: 'Export Test', provider: 'openai', model: 'gpt-4o',
      accountId: 'acct_secret',
      providerConfig: { provider: 'openai', model: 'gpt-4o', accountId: 'acct_secret' },
      scope: 'global',
    };
    const json = storage.exportAgent(agent);
    const parsed = JSON.parse(json);
    assert.equal(parsed.accountId, undefined, 'top-level accountId stripped');
    assert.equal(parsed.providerConfig.accountId, undefined, 'providerConfig.accountId stripped');
    assert.equal(parsed.providerConfig.provider, 'openai', 'provider preserved');
  });

  it('import normalizes legacy agent to providerConfig', async () => {
    const storage = new AgentStorage({ wsId: 'test_import' });
    const legacy = JSON.stringify({
      name: 'Imported Legacy', provider: 'anthropic', model: 'claude-sonnet-4-6',
      accountId: 'acct_foreign', scope: 'global', systemPrompt: 'hello',
      temperature: 0.7, maxTokens: 4096, autonomy: 'balanced',
      tools: { mode: 'all', list: [], permissionOverrides: {} },
    });

    const imported = await storage.importAgent(legacy);
    assert.ok(imported.providerConfig, 'should have providerConfig after import');
    assert.equal(imported.providerConfig.provider, 'anthropic');
    assert.equal(imported.providerConfig.accountId, undefined, 'foreign accountId cleared');
    assert.equal(imported.accountId, null, 'top-level accountId cleared');
  });
});
