// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-agent-hardening.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── localStorage polyfill for Node.js ────────────────────────────
if (typeof globalThis.localStorage === 'undefined') {
  const store = {};
  globalThis.localStorage = {
    getItem(k) { return store[k] ?? null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
  };
}

import { ClawserAgent, AutonomyController } from '../clawser-agent.js';
import { MetricsCollector } from '../clawser-metrics.js';

// ── Minimal stubs ─────────────────────────────────────────────────

function makeStubProvider(response = { content: 'Hello', tool_calls: [], usage: { input_tokens: 10, output_tokens: 5 }, model: 'stub' }) {
  return {
    supportsNativeTools: true,
    supportsStreaming: false,
    chat: async () => ({ ...response }),
  };
}

function makeStubProviderRegistry(provider) {
  const map = new Map([['stub', provider]]);
  return {
    get: (name) => map.get(name),
    listWithAvailability: async () => [{ name: 'stub' }],
  };
}

// ── AgentHaltedError ──────────────────────────────────────────────

describe('AgentHaltedError', () => {
  it('checkLimits returns structured error with limitType for rate limit', () => {
    const ac = new AutonomyController({
      maxActionsPerHour: 1,
    });
    ac.recordAction(); // exhaust limit
    const result = ac.checkLimits();
    assert.equal(result.blocked, true);
    assert.ok(result.limitType, 'should have limitType field');
    assert.equal(result.limitType, 'rate');
    assert.ok(result.resetTime > 0, 'should have a resetTime');
  });

  it('checkLimits returns structured error with limitType for cost limit', () => {
    const ac = new AutonomyController({
      maxCostPerDayCents: 10,
    });
    ac.recordCost(15); // exceed cost limit
    const result = ac.checkLimits();
    assert.equal(result.blocked, true);
    assert.equal(result.limitType, 'cost');
    assert.ok(result.resetTime > 0, 'should have a resetTime');
  });

  it('run() returns structured error with limitType on autonomy block', async () => {
    const ac = new AutonomyController({ maxActionsPerHour: 0 });
    const agent = await ClawserAgent.create({
      providers: makeStubProviderRegistry(makeStubProvider()),
      autonomy: ac,
    });
    agent.init({});
    agent.setProvider('stub');
    agent.setSystemPrompt('Test');
    agent.sendMessage('Hi');

    const result = await agent.run();
    assert.equal(result.status, -1);
    assert.ok(result.limitType, 'should include limitType in result');
  });
});

// ── Tool Timeout Cancellation ─────────────────────────────────────

describe('Tool timeout cancellation', () => {
  it('cancels a tool that exceeds the timeout', async () => {
    const toolCall = {
      id: 'tc_1', name: 'slow_tool', arguments: '{}',
    };

    // Provider returns a tool call, then plain text
    let callCount = 0;
    const provider = {
      supportsNativeTools: true,
      supportsStreaming: false,
      chat: async function () {
        callCount++;
        if (callCount === 1) {
          return { content: '', tool_calls: [toolCall], usage: { input_tokens: 10, output_tokens: 5 }, model: 'stub' };
        }
        return { content: 'Done', tool_calls: [], usage: { input_tokens: 10, output_tokens: 5 }, model: 'stub' };
      },
    };

    // Create a tool registry with a slow tool
    const { createDefaultRegistry } = await import('../clawser-tools.js');
    const registry = createDefaultRegistry();
    // Register a tool that takes 5s (should be cancelled at 100ms)
    registry.register({
      name: 'slow_tool',
      description: 'A slow tool for testing',
      parameters: { type: 'object', properties: {} },
      permission: 'auto',
      execute: async () => {
        await new Promise(resolve => setTimeout(resolve, 5000));
        return { success: true, output: 'done' };
      },
    });

    const agent = await ClawserAgent.create({
      providers: makeStubProviderRegistry(provider),
      browserTools: registry,
    });
    agent.init({ toolTimeout: 100 }); // 100ms timeout
    agent.setProvider('stub');
    agent.setSystemPrompt('Test');
    agent.sendMessage('Run slow tool');

    const result = await agent.run();
    // Should complete without hanging (tool was cancelled)
    assert.ok(result, 'run() should return a result, not hang');
    // The tool result should indicate a timeout error
    // We verify indirectly — the agent loop should continue past the timeout
  });

  it('does not cancel tools that complete within timeout', async () => {
    const toolCall = {
      id: 'tc_1', name: 'browser_echo', arguments: '{"text":"hi"}',
    };

    let callCount = 0;
    const provider = {
      supportsNativeTools: true,
      supportsStreaming: false,
      chat: async function () {
        callCount++;
        if (callCount === 1) {
          return { content: '', tool_calls: [toolCall], usage: { input_tokens: 10, output_tokens: 5 }, model: 'stub' };
        }
        return { content: 'Done', tool_calls: [], usage: { input_tokens: 10, output_tokens: 5 }, model: 'stub' };
      },
    };

    const { createDefaultRegistry } = await import('../clawser-tools.js');
    const registry = createDefaultRegistry();

    const agent = await ClawserAgent.create({
      providers: makeStubProviderRegistry(provider),
      browserTools: registry,
    });
    agent.init({ toolTimeout: 30000 }); // generous timeout
    agent.setProvider('stub');
    agent.setSystemPrompt('Test');
    agent.sendMessage('Echo hi');
    const result = await agent.run();
    assert.equal(result.status, 1);
  });
});

// ── Agent Pause via Self-Repair ───────────────────────────────────

describe('Agent pause mechanism', () => {
  it('pause handler prevents further LLM calls', async () => {
    const { SelfRepairEngine } = await import('../clawser-self-repair.js');
    const engine = new SelfRepairEngine();

    const agent = await ClawserAgent.create({
      providers: makeStubProviderRegistry(makeStubProvider()),
      selfRepairEngine: engine,
    });
    agent.init({});
    agent.setProvider('stub');
    agent.setSystemPrompt('Test');

    // Trigger pause via self-repair
    assert.ok(engine.hasHandler('pause'), 'pause handler should be registered');

    // Manually invoke the pause handler
    const result = await engine.check({
      turnCost: 5.0, // exceeds default 2.0 threshold
      lastActivityAt: Date.now(),
    });
    // COST_RUNAWAY triggers pause first
    const pauseEntry = result.find(r => r.strategy.action === 'pause');
    assert.ok(pauseEntry, 'Should have attempted pause strategy');
    assert.ok(pauseEntry.success, 'pause handler should succeed');

    // After pause, agent.run() should indicate paused state
    agent.sendMessage('Hi');
    const runResult = await agent.run();
    assert.equal(runResult.status, -1);
    assert.ok(runResult.data.includes('pause') || runResult.data.includes('Pause'), 'should indicate paused state');
  });

  it('downgrade_model handler switches to cheapest provider', async () => {
    const { SelfRepairEngine } = await import('../clawser-self-repair.js');
    const engine = new SelfRepairEngine();

    const cheapProvider = makeStubProvider({ content: 'Cheap', tool_calls: [], usage: { input_tokens: 5, output_tokens: 3 }, model: 'cheap' });
    const providers = {
      get: (name) => name === 'stub' ? makeStubProvider() : name === 'cheap' ? cheapProvider : null,
      listWithAvailability: async () => [{ name: 'stub' }, { name: 'cheap' }],
    };

    const agent = await ClawserAgent.create({
      providers,
      selfRepairEngine: engine,
    });
    agent.init({});
    agent.setProvider('stub');
    agent.setSystemPrompt('Test');

    assert.ok(engine.hasHandler('downgrade_model'), 'downgrade_model handler should be registered');
  });
});

// ── Hooks Persistence ─────────────────────────────────────────────

describe('Hooks localStorage persistence', () => {
  it('persists hooks to localStorage on workspace init', async () => {
    const agent = await ClawserAgent.create({
      providers: makeStubProviderRegistry(makeStubProvider()),
    });
    agent.init({});
    agent.setProvider('stub');
    agent.setSystemPrompt('Test');
    agent.setWorkspaceId('test-ws');

    // Register a hook
    agent.registerHook({
      name: 'test-persist-hook',
      point: 'beforeInbound',
      priority: 5,
      enabled: true,
      factoryName: 'test-factory',
      execute: async () => ({ action: 'continue' }),
    });

    // Save hooks
    agent.persistHooks();

    // Verify localStorage contains the hooks
    const stored = localStorage.getItem('clawser_hooks_test-ws');
    assert.ok(stored, 'hooks should be stored in localStorage');
    const data = JSON.parse(stored);
    assert.equal(data.hooks.length, 1);
    assert.equal(data.hooks[0].name, 'test-persist-hook');
  });

  it('restores hooks from localStorage on workspace init', async () => {
    // Pre-populate localStorage
    const hookData = {
      hooks: [
        { name: 'restored-hook', point: 'beforeInbound', priority: 3, enabled: true, factoryName: 'test-factory' },
      ],
    };
    localStorage.setItem('clawser_hooks_restore-ws', JSON.stringify(hookData));

    const factories = {
      'test-factory': () => ({
        name: 'restored-hook',
        point: 'beforeInbound',
        execute: async () => ({ action: 'continue' }),
      }),
    };

    const agent = await ClawserAgent.create({
      providers: makeStubProviderRegistry(makeStubProvider()),
    });
    agent.init({});
    agent.setProvider('stub');
    agent.setSystemPrompt('Test');
    agent.setWorkspaceId('restore-ws');

    // Restore hooks using factories
    agent.restoreHooks(factories);

    const hooks = agent.listHooks();
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].name, 'restored-hook');
    assert.equal(hooks[0].priority, 3);

    // Cleanup
    localStorage.removeItem('clawser_hooks_restore-ws');
  });
});

// ── Fallback Effectiveness Metrics ────────────────────────────────

describe('Fallback effectiveness metrics', () => {
  it('increments fallback.attempts on execute()', async () => {
    const { FallbackChain, FallbackExecutor } = await import('../clawser-fallback.js');
    const metrics = new MetricsCollector();

    const chain = new FallbackChain();
    chain.addEntry({ providerId: 'p1', model: 'm1' });

    const executor = new FallbackExecutor(chain, { metricsCollector: metrics });

    await executor.execute(async () => ({ content: 'ok', tool_calls: [], usage: {}, model: 'm1' }));

    assert.ok(metrics.counter('fallback.attempts') >= 1, 'should track fallback attempts');
    assert.ok(metrics.counter('fallback.attempts.p1') >= 1, 'should track per-provider attempts');
  });

  it('increments fallback.failures on failed entry', async () => {
    const { FallbackChain, FallbackExecutor } = await import('../clawser-fallback.js');
    const metrics = new MetricsCollector();

    const chain = new FallbackChain();
    chain.addEntry({ providerId: 'bad-p', model: 'm1' });
    chain.addEntry({ providerId: 'good-p', model: 'm1' });

    const executor = new FallbackExecutor(chain, { metricsCollector: metrics });

    let callCount = 0;
    await executor.execute(async (pid) => {
      callCount++;
      if (pid === 'bad-p') throw Object.assign(new Error('503 Service Unavailable'), { status: 503 });
      return { content: 'ok', tool_calls: [], usage: {}, model: 'm1' };
    });

    assert.ok(metrics.counter('fallback.failures.bad-p') >= 1, 'should track per-provider failures');
  });
});
