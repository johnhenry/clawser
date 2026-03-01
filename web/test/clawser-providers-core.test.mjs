// Tests for clawser-providers.js — cost estimation, response validation, cache, error classification
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── 1. MODEL_PRICING & estimateCost (6 tests) ─────────────────

describe('estimateCost', () => {
  let estimateCost, MODEL_PRICING;

  it('loads exports', async () => {
    const mod = await import('../clawser-providers.js');
    estimateCost = mod.estimateCost;
    MODEL_PRICING = mod.MODEL_PRICING;
    assert.ok(estimateCost);
    assert.ok(MODEL_PRICING);
  });

  it('returns 0 for null usage', async () => {
    const mod = await import('../clawser-providers.js');
    assert.equal(mod.estimateCost('gpt-4o', null), 0);
  });

  it('returns 0 for unknown model', async () => {
    const mod = await import('../clawser-providers.js');
    assert.equal(mod.estimateCost('imaginary-model', { input_tokens: 1000, output_tokens: 500 }), 0);
  });

  it('calculates cost for gpt-4o correctly', async () => {
    const mod = await import('../clawser-providers.js');
    const cost = mod.estimateCost('gpt-4o', { input_tokens: 1000, output_tokens: 500 });
    // input: 1000/1000 * 0.0025 = 0.0025, output: 500/1000 * 0.010 = 0.005
    assert.ok(Math.abs(cost - 0.0075) < 0.0001);
  });

  it('handles cached input tokens', async () => {
    const mod = await import('../clawser-providers.js');
    const cost = mod.estimateCost('gpt-4o', {
      input_tokens: 1000,
      output_tokens: 0,
      cache_read_input_tokens: 800,
    });
    // regular: (1000-800)/1000 * 0.0025 = 0.0005, cached: 800/1000 * 0.00125 = 0.001
    assert.ok(cost > 0);
    assert.ok(cost < 0.0025); // cheaper than all regular
  });

  it('returns 0 for free models (echo, chrome-ai)', async () => {
    const mod = await import('../clawser-providers.js');
    assert.equal(mod.estimateCost('echo', { input_tokens: 10000, output_tokens: 5000 }), 0);
    assert.equal(mod.estimateCost('chrome-ai', { input_tokens: 10000, output_tokens: 5000 }), 0);
  });
});

// ── 2. CostLedger (6 tests) ───────────────────────────────────

describe('CostLedger', () => {
  let CostLedger;

  it('loads class', async () => {
    const mod = await import('../clawser-providers.js');
    CostLedger = mod.CostLedger;
    assert.ok(CostLedger);
  });

  it('records entries and tracks them', () => {
    const ledger = new CostLedger();
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    assert.equal(ledger.entries.length, 1);
  });

  it('totalByModel groups correctly', () => {
    const ledger = new CostLedger();
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 200, outputTokens: 100, costUsd: 0.02 });
    ledger.record({ model: 'claude-sonnet-4-6', provider: 'anthropic', inputTokens: 50, outputTokens: 25, costUsd: 0.005 });
    const byModel = ledger.totalByModel();
    assert.equal(byModel['gpt-4o'].calls, 2);
    assert.ok(Math.abs(byModel['gpt-4o'].costUsd - 0.03) < 0.001);
    assert.equal(byModel['claude-sonnet-4-6'].calls, 1);
  });

  it('totalByProvider groups correctly', () => {
    const ledger = new CostLedger();
    ledger.record({ model: 'a', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    ledger.record({ model: 'b', provider: 'anthropic', inputTokens: 100, outputTokens: 50, costUsd: 0.02 });
    const byProvider = ledger.totalByProvider();
    assert.ok(byProvider.openai);
    assert.ok(byProvider.anthropic);
  });

  it('summary returns total', () => {
    const ledger = new CostLedger();
    ledger.record({ model: 'a', provider: 'p', inputTokens: 100, outputTokens: 50, costUsd: 0.05 });
    ledger.record({ model: 'b', provider: 'p', inputTokens: 200, outputTokens: 100, costUsd: 0.10 });
    const s = ledger.summary();
    assert.equal(s.totalCalls, 2);
    assert.ok(Math.abs(s.totalCostUsd - 0.15) < 0.001);
  });

  it('threshold detection works', () => {
    const ledger = new CostLedger({ thresholdUsd: 0.1 });
    ledger.record({ model: 'a', provider: 'p', inputTokens: 0, outputTokens: 0, costUsd: 0.05 });
    assert.equal(ledger.isOverThreshold(), false);
    ledger.record({ model: 'a', provider: 'p', inputTokens: 0, outputTokens: 0, costUsd: 0.06 });
    assert.equal(ledger.isOverThreshold(), true);
  });

  it('clear() removes all entries', () => {
    const ledger = new CostLedger();
    ledger.record({ model: 'a', provider: 'p', inputTokens: 100, outputTokens: 50, costUsd: 0.05 });
    ledger.record({ model: 'b', provider: 'p', inputTokens: 200, outputTokens: 100, costUsd: 0.10 });
    assert.equal(ledger.summary().totalCalls, 2);
    ledger.clear();
    assert.equal(ledger.summary().totalCalls, 0);
    assert.equal(ledger.summary().totalCostUsd, 0);
  });
});

// ── 3. validateChatResponse (5 tests) ──────────────────────────

describe('validateChatResponse', () => {
  let validateChatResponse;

  it('loads function', async () => {
    const mod = await import('../clawser-providers.js');
    validateChatResponse = mod.validateChatResponse;
    assert.ok(validateChatResponse);
  });

  it('normalizes a valid response', () => {
    const result = validateChatResponse({
      content: 'Hello',
      tool_calls: [{ id: 't1', name: 'search', arguments: '{"q":"test"}' }],
      usage: { input_tokens: 100, output_tokens: 50 },
      model: 'gpt-4o',
    });
    assert.equal(result.content, 'Hello');
    assert.equal(result.tool_calls.length, 1);
    assert.equal(result.tool_calls[0].name, 'search');
    assert.equal(result.model, 'gpt-4o');
  });

  it('fills defaults for missing fields', () => {
    const result = validateChatResponse({});
    assert.equal(result.content, '');
    assert.deepEqual(result.tool_calls, []);
    assert.equal(result.usage.input_tokens, 0);
    assert.equal(result.model, 'unknown');
  });

  it('uses fallback model name', () => {
    const result = validateChatResponse({}, 'test-model');
    assert.equal(result.model, 'test-model');
  });

  it('normalizes malformed tool_calls', () => {
    const result = validateChatResponse({
      content: 'Hi',
      tool_calls: [null, { name: 123 }, { id: 'ok', name: 'test', arguments: '{}' }],
      model: 'm',
    });
    assert.equal(result.tool_calls.length, 3);
    assert.equal(result.tool_calls[0].name, '');
    assert.equal(result.tool_calls[1].name, '');
    assert.equal(result.tool_calls[2].name, 'test');
  });
});

// ── 4. classifyError (5 tests) ─────────────────────────────────

describe('classifyError', () => {
  let classifyError;

  it('loads function', async () => {
    const mod = await import('../clawser-providers.js');
    classifyError = mod.classifyError;
    assert.ok(classifyError);
  });

  it('classifies rate limit errors', () => {
    const result = classifyError(new Error('429 Rate limit exceeded'));
    assert.equal(result.category, 'rate_limit');
    assert.equal(result.retryable, true);
  });

  it('classifies auth errors', () => {
    const result = classifyError('401 Unauthorized');
    assert.equal(result.category, 'auth');
    assert.equal(result.retryable, false);
  });

  it('classifies unknown errors', () => {
    const result = classifyError('Something weird happened');
    assert.equal(result.category, 'unknown');
    assert.equal(result.retryable, false);
  });

  it('handles non-string input', () => {
    const result = classifyError(42);
    assert.ok(result.category);
    assert.equal(typeof result.message, 'string');
  });
});

// ── 5. ResponseCache (6 tests) ─────────────────────────────────

describe('ResponseCache', () => {
  let ResponseCache;

  it('loads class', async () => {
    const mod = await import('../clawser-providers.js');
    ResponseCache = mod.ResponseCache;
    assert.ok(ResponseCache);
  });

  it('hash returns consistent values', () => {
    const h1 = ResponseCache.hash('hello world');
    const h2 = ResponseCache.hash('hello world');
    assert.equal(h1, h2);
    assert.notEqual(h1, ResponseCache.hash('different'));
  });

  it('starts empty', () => {
    const cache = new ResponseCache();
    assert.equal(cache.size, 0);
  });

  it('can be enabled/disabled', () => {
    const cache = new ResponseCache();
    assert.equal(cache.enabled, true);
    cache.enabled = false;
    assert.equal(cache.enabled, false);
  });

  it('respects maxEntries config', () => {
    const cache = new ResponseCache({ maxEntries: 10, ttlMs: 60000 });
    assert.equal(cache.maxEntries, 10);
  });

  it('ttl config works', () => {
    const cache = new ResponseCache({ ttlMs: 5000 });
    assert.equal(cache.ttl, 5000);
    cache.ttl = 10000;
    assert.equal(cache.ttl, 10000);
  });
});

// ── 6. EchoProvider (4 tests) ──────────────────────────────────

describe('EchoProvider', () => {
  let EchoProvider;

  it('loads class', async () => {
    const mod = await import('../clawser-providers.js');
    EchoProvider = mod.EchoProvider;
    assert.ok(EchoProvider);
  });

  it('echoes last user message content', async () => {
    const echo = new EchoProvider();
    const response = await echo.chat({
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello world' },
      ],
    });
    assert.equal(response.model, 'echo');
    assert.ok(response.content.includes('Hello world'));
  });

  it('does not support native tools', () => {
    const echo = new EchoProvider();
    assert.equal(echo.supportsNativeTools, false);
  });

  it('does not support streaming', () => {
    const echo = new EchoProvider();
    assert.equal(echo.supportsStreaming, false);
  });
});

// ── 7. ProviderRegistry (4 tests) ──────────────────────────────

describe('ProviderRegistry', () => {
  let ProviderRegistry, EchoProvider;

  it('loads class', async () => {
    const mod = await import('../clawser-providers.js');
    ProviderRegistry = mod.ProviderRegistry;
    EchoProvider = mod.EchoProvider;
    assert.ok(ProviderRegistry);
  });

  it('registers and retrieves providers', () => {
    const reg = new ProviderRegistry();
    const echo = new EchoProvider();
    reg.register(echo);
    assert.equal(reg.get('echo'), echo);
  });

  it('returns null for unregistered', () => {
    const reg = new ProviderRegistry();
    assert.equal(reg.get('nonexistent'), null);
  });

  it('names() returns registered provider names', () => {
    const reg = new ProviderRegistry();
    reg.register(new EchoProvider());
    const n = reg.names();
    assert.ok(n.includes('echo'));
  });

  it('remove() deletes a registered provider', () => {
    const reg = new ProviderRegistry();
    reg.register(new EchoProvider());
    assert.ok(reg.get('echo'));
    assert.equal(reg.remove('echo'), true);
    assert.equal(reg.get('echo'), null);
  });

  it('remove() returns false for unregistered name', () => {
    const reg = new ProviderRegistry();
    assert.equal(reg.remove('nonexistent'), false);
  });
});
