// Sprint 18 — jq + Passphrase Strength + Cost Ledger + Browser Select/Scroll + Local Embeddings + Web Locks
// RED phase: 30 tests, all expected to fail initially.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ── 1. jq shell builtin (5 tests) ──────────────────────────────

describe('jq shell builtin', () => {
  let ClawserShell;

  before(async () => {
    const mod = await import('../clawser-shell.js');
    ClawserShell = mod.ClawserShell;
  });

  it('jq . returns identity', async () => {
    const shell = new ClawserShell();
    // echo '{"a":1}' | jq .
    shell.registry.register('echo-json', async () => ({
      stdout: '{"a":1}', stderr: '', exitCode: 0,
    }), { description: 'Test' });
    const result = await shell.exec('echo-json | jq .');
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.a, 1);
  });

  it('jq .key extracts field', async () => {
    const shell = new ClawserShell();
    shell.registry.register('data', async () => ({
      stdout: '{"name":"Alice","age":30}', stderr: '', exitCode: 0,
    }), { description: 'Test' });
    const result = await shell.exec('data | jq .name');
    assert.equal(result.stdout.trim(), '"Alice"');
  });

  it('jq .[] iterates array', async () => {
    const shell = new ClawserShell();
    shell.registry.register('arr', async () => ({
      stdout: '[1,2,3]', stderr: '', exitCode: 0,
    }), { description: 'Test' });
    const result = await shell.exec('arr | jq .[]');
    assert.ok(result.stdout.includes('1'));
    assert.ok(result.stdout.includes('2'));
    assert.ok(result.stdout.includes('3'));
  });

  it('jq keys returns object keys', async () => {
    const shell = new ClawserShell();
    shell.registry.register('obj', async () => ({
      stdout: '{"x":1,"y":2}', stderr: '', exitCode: 0,
    }), { description: 'Test' });
    const result = await shell.exec('obj | jq keys');
    const keys = JSON.parse(result.stdout);
    assert.ok(keys.includes('x'));
    assert.ok(keys.includes('y'));
  });

  it('jq length returns length', async () => {
    const shell = new ClawserShell();
    shell.registry.register('items', async () => ({
      stdout: '[10,20,30,40]', stderr: '', exitCode: 0,
    }), { description: 'Test' });
    const result = await shell.exec('items | jq length');
    assert.equal(result.stdout.trim(), '4');
  });
});

// ── 2. Passphrase strength (5 tests) ───────────────────────────

describe('Passphrase strength', () => {
  let measurePassphraseStrength;

  before(async () => {
    const mod = await import('../clawser-vault.js');
    measurePassphraseStrength = mod.measurePassphraseStrength;
  });

  it('function exists', () => {
    assert.equal(typeof measurePassphraseStrength, 'function');
  });

  it('empty string scores 0', () => {
    const result = measurePassphraseStrength('');
    assert.equal(result.score, 0);
    assert.equal(result.label, 'none');
  });

  it('short password scores low', () => {
    const result = measurePassphraseStrength('abc');
    assert.ok(result.score <= 1);
    assert.ok(result.entropy < 20);
  });

  it('long mixed password scores high', () => {
    const result = measurePassphraseStrength('Tr0ub4dor&3!xYz');
    assert.ok(result.score >= 3);
    assert.ok(result.entropy > 40);
  });

  it('common password penalized', () => {
    const weak = measurePassphraseStrength('password123');
    const strong = measurePassphraseStrength('xK9#mP2$vL');
    assert.ok(weak.score < strong.score);
  });
});

// ── 3. Cost ledger (5 tests) ───────────────────────────────────

describe('Cost ledger', () => {
  let CostLedger;

  before(async () => {
    const mod = await import('../clawser-providers.js');
    CostLedger = mod.CostLedger;
  });

  it('CostLedger class exists', () => {
    assert.ok(CostLedger);
    const ledger = new CostLedger();
    assert.ok(ledger);
  });

  it('record adds an entry', () => {
    const ledger = new CostLedger();
    ledger.record({
      model: 'gpt-4o',
      provider: 'openai',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.0075,
    });
    assert.equal(ledger.entries.length, 1);
  });

  it('totalByModel returns per-model totals', () => {
    const ledger = new CostLedger();
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 200, outputTokens: 100, costUsd: 0.02 });
    ledger.record({ model: 'claude-sonnet-4-6', provider: 'anthropic', inputTokens: 300, outputTokens: 150, costUsd: 0.05 });
    const byModel = ledger.totalByModel();
    assert.equal(byModel['gpt-4o'].costUsd, 0.03);
    assert.equal(byModel['claude-sonnet-4-6'].costUsd, 0.05);
  });

  it('totalByProvider returns per-provider totals', () => {
    const ledger = new CostLedger();
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    ledger.record({ model: 'gpt-4o-mini', provider: 'openai', inputTokens: 200, outputTokens: 100, costUsd: 0.005 });
    ledger.record({ model: 'claude-sonnet-4-6', provider: 'anthropic', inputTokens: 300, outputTokens: 150, costUsd: 0.05 });
    const byProvider = ledger.totalByProvider();
    assert.ok(Math.abs(byProvider.openai.costUsd - 0.015) < 0.0001);
    assert.equal(byProvider.anthropic.costUsd, 0.05);
  });

  it('summary returns total cost and call count', () => {
    const ledger = new CostLedger();
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 200, outputTokens: 100, costUsd: 0.02 });
    const sum = ledger.summary();
    assert.equal(sum.totalCalls, 2);
    assert.ok(Math.abs(sum.totalCostUsd - 0.03) < 0.0001);
  });
});

// ── 4. Browser select/scroll tools (5 tests) ───────────────────

describe('Browser select/scroll tools', () => {
  let BrowserSelectTool, BrowserScrollTool;

  before(async () => {
    const mod = await import('../clawser-browser-auto.js');
    BrowserSelectTool = mod.BrowserSelectTool;
    BrowserScrollTool = mod.BrowserScrollTool;
  });

  it('BrowserSelectTool exists', () => {
    assert.ok(BrowserSelectTool);
  });

  it('BrowserSelectTool has correct name', () => {
    const mockManager = { getSession: () => null };
    const tool = new BrowserSelectTool(mockManager);
    assert.equal(tool.name, 'browser_select');
  });

  it('BrowserSelectTool requires session_id and selector', () => {
    const mockManager = { getSession: () => null };
    const tool = new BrowserSelectTool(mockManager);
    assert.ok(tool.parameters.required.includes('session_id'));
    assert.ok(tool.parameters.required.includes('selector'));
  });

  it('BrowserScrollTool exists and has correct name', () => {
    const mockManager = { getSession: () => null };
    const tool = new BrowserScrollTool(mockManager);
    assert.equal(tool.name, 'browser_scroll');
  });

  it('BrowserScrollTool accepts direction parameter', () => {
    const mockManager = { getSession: () => null };
    const tool = new BrowserScrollTool(mockManager);
    assert.ok(tool.parameters.properties.direction);
  });
});

// ── 5. Local embeddings provider (5 tests) ──────────────────────

describe('Local embeddings provider', () => {
  let TransformersEmbeddingProvider, EmbeddingProvider;

  before(async () => {
    const mod = await import('../clawser-memory.js');
    TransformersEmbeddingProvider = mod.TransformersEmbeddingProvider;
    EmbeddingProvider = mod.EmbeddingProvider;
  });

  it('TransformersEmbeddingProvider class exists', () => {
    assert.ok(TransformersEmbeddingProvider);
  });

  it('is an EmbeddingProvider subclass', () => {
    const provider = new TransformersEmbeddingProvider();
    assert.ok(provider instanceof EmbeddingProvider);
  });

  it('has name "transformers"', () => {
    const provider = new TransformersEmbeddingProvider();
    assert.equal(provider.name, 'transformers');
  });

  it('has 384 dimensions (MiniLM-L6)', () => {
    const provider = new TransformersEmbeddingProvider();
    assert.equal(provider.dimensions, 384);
  });

  it('isAvailable returns false without runtime', async () => {
    const provider = new TransformersEmbeddingProvider();
    const available = await provider.isAvailable();
    assert.equal(available, false);
  });
});

// ── 6. Web Locks for input arbitration (5 tests) ───────────────

describe('Web Locks input arbitration', () => {
  let InputLockManager;

  before(async () => {
    // Polyfill browser globals
    if (typeof globalThis.BroadcastChannel === 'undefined') {
      globalThis.BroadcastChannel = class {
        onmessage = null;
        postMessage() {}
        close() {}
      };
    }
    if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
      globalThis.crypto = globalThis.crypto || {};
      globalThis.crypto.randomUUID = () => 'test-uuid-1234';
    }
    const mod = await import('../clawser-daemon.js');
    InputLockManager = mod.InputLockManager;
  });

  it('InputLockManager class exists', () => {
    assert.ok(InputLockManager);
  });

  it('can be instantiated', () => {
    const lm = new InputLockManager();
    assert.ok(lm);
  });

  it('tryAcquire returns lock result', async () => {
    const lm = new InputLockManager();
    const result = await lm.tryAcquire('test-resource');
    assert.equal(typeof result.acquired, 'boolean');
  });

  it('release releases a held lock', async () => {
    const lm = new InputLockManager();
    const result = await lm.tryAcquire('test-resource');
    if (result.acquired) {
      lm.release('test-resource');
    }
    // Should not throw
    assert.ok(true);
  });

  it('isHeld checks lock status', () => {
    const lm = new InputLockManager();
    assert.equal(typeof lm.isHeld, 'function');
    const held = lm.isHeld('test-resource');
    assert.equal(typeof held, 'boolean');
  });
});
