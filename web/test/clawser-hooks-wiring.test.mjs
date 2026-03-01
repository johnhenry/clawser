// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-hooks-wiring.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ClawserAgent, HookPipeline, HOOK_POINTS } from '../clawser-agent.js';

// ── Minimal stubs ─────────────────────────────────────────────────

/** Stub provider that returns a configurable response. */
function makeStubProvider(response = { content: 'Hello', tool_calls: [], usage: { input_tokens: 10, output_tokens: 5 }, model: 'stub' }) {
  return {
    supportsNativeTools: false,
    supportsStreaming: false,
    chat: async () => ({ ...response }),
    chatStream: async function* () { yield { type: 'text', text: response.content }; yield { type: 'done', response }; },
  };
}

/** Stub provider registry wrapping a single provider. */
function makeStubProviderRegistry(provider) {
  const map = new Map([['stub', provider]]);
  return {
    get: (name) => map.get(name),
    listWithAvailability: async () => [{ name: 'stub' }],
  };
}

/** Create a minimal agent for hook testing. */
async function createTestAgent(overrides = {}) {
  const provider = makeStubProvider(overrides.response);
  const providers = makeStubProviderRegistry(provider);
  const hooks = new HookPipeline();

  const agent = await ClawserAgent.create({
    providers,
    hooks,
    ...overrides,
  });
  agent.init({});
  agent.setProvider('stub');
  agent.setSystemPrompt('You are a test agent.');
  return { agent, hooks, provider };
}

// ── beforeOutbound ────────────────────────────────────────────────

describe('beforeOutbound hook wiring', () => {
  it('fires beforeOutbound with response content in run()', async () => {
    const fired = [];
    const { agent, hooks } = await createTestAgent();

    hooks.register({
      name: 'test-outbound',
      point: 'beforeOutbound',
      execute: async (ctx) => {
        fired.push(ctx);
        return { action: 'continue' };
      },
    });

    agent.sendMessage('Hi');
    const result = await agent.run();

    assert.equal(result.status, 1);
    assert.equal(fired.length, 1);
    assert.equal(fired[0].content, 'Hello');
    assert.equal(fired[0].model, 'stub');
  });

  it('beforeOutbound can block the response in run()', async () => {
    const { agent, hooks } = await createTestAgent();

    hooks.register({
      name: 'blocker',
      point: 'beforeOutbound',
      execute: async () => ({ action: 'block', reason: 'policy violation' }),
    });

    agent.sendMessage('Hi');
    const result = await agent.run();

    assert.equal(result.status, -1);
    assert.ok(result.data.includes('policy violation'));
  });

  it('beforeOutbound can modify content in run()', async () => {
    const { agent, hooks } = await createTestAgent();

    hooks.register({
      name: 'modifier',
      point: 'beforeOutbound',
      execute: async (ctx) => ({
        action: 'modify',
        data: { content: ctx.content + ' [modified]' },
      }),
    });

    agent.sendMessage('Hi');
    const result = await agent.run();

    assert.equal(result.status, 1);
    assert.equal(result.data, 'Hello [modified]');
  });

  it('fires beforeOutbound in runStream() non-streaming path', async () => {
    const fired = [];
    const { agent, hooks } = await createTestAgent();

    hooks.register({
      name: 'test-outbound-stream',
      point: 'beforeOutbound',
      execute: async (ctx) => {
        fired.push(ctx);
        return { action: 'continue' };
      },
    });

    agent.sendMessage('Hi');
    const chunks = [];
    for await (const chunk of agent.runStream()) {
      chunks.push(chunk);
    }

    assert.equal(fired.length, 1);
    assert.equal(fired[0].content, 'Hello');
  });

  it('beforeOutbound does NOT fire when there is no user message', async () => {
    const fired = [];
    const { agent, hooks } = await createTestAgent();

    hooks.register({
      name: 'test-outbound',
      point: 'beforeOutbound',
      execute: async (ctx) => {
        fired.push(ctx);
        return { action: 'continue' };
      },
    });

    // No sendMessage — agent runs with only system prompt
    // run() should still work but not fire beforeOutbound
    // (The LLM will be called, but there's no user context for the hook)
    // This tests the `if (lastUserMsg)` guard
    const result = await agent.run();
    assert.equal(fired.length, 0);
  });
});

// ── onSessionStart ────────────────────────────────────────────────

describe('onSessionStart hook wiring', () => {
  it('fires onSessionStart on the first user message', async () => {
    const fired = [];
    const { agent, hooks } = await createTestAgent();

    hooks.register({
      name: 'test-session-start',
      point: 'onSessionStart',
      execute: async (ctx) => {
        fired.push(ctx);
        return { action: 'continue' };
      },
    });

    agent.sendMessage('First message');
    assert.equal(fired.length, 1);
    assert.ok(fired[0].workspaceId);
  });

  it('does NOT fire onSessionStart on subsequent messages', async () => {
    const fired = [];
    const { agent, hooks } = await createTestAgent();

    hooks.register({
      name: 'test-session-start',
      point: 'onSessionStart',
      execute: async (ctx) => {
        fired.push(ctx);
        return { action: 'continue' };
      },
    });

    agent.sendMessage('First message');
    assert.equal(fired.length, 1);

    agent.sendMessage('Second message');
    assert.equal(fired.length, 1); // Still 1 — not fired again
  });
});

// ── onSessionEnd ──────────────────────────────────────────────────

describe('onSessionEnd hook wiring', () => {
  it('fires onSessionEnd when reinit is called', async () => {
    const fired = [];
    const { agent, hooks } = await createTestAgent();

    hooks.register({
      name: 'test-session-end',
      point: 'onSessionEnd',
      execute: async (ctx) => {
        fired.push(ctx);
        return { action: 'continue' };
      },
    });

    agent.sendMessage('Hello');
    await agent.run();
    agent.reinit({});

    assert.equal(fired.length, 1);
    assert.ok(fired[0].messageCount > 0);
  });

  it('fires onSessionEnd when clearHistory is called', async () => {
    const fired = [];
    const { agent, hooks } = await createTestAgent();

    hooks.register({
      name: 'test-session-end',
      point: 'onSessionEnd',
      execute: async (ctx) => {
        fired.push(ctx);
        return { action: 'continue' };
      },
    });

    agent.sendMessage('Hello');
    agent.clearHistory();

    assert.equal(fired.length, 1);
    assert.ok(fired[0].messageCount >= 1);
  });

  it('does NOT fire onSessionEnd when history is empty', async () => {
    const fired = [];
    const { agent, hooks } = await createTestAgent();

    hooks.register({
      name: 'test-session-end',
      point: 'onSessionEnd',
      execute: async (ctx) => {
        fired.push(ctx);
        return { action: 'continue' };
      },
    });

    // No messages sent — reinit on fresh agent shouldn't fire
    agent.reinit({});
    assert.equal(fired.length, 0);
  });

  it('onSessionEnd receives correct messageCount before history is cleared (clearHistory)', async () => {
    const fired = [];
    const { agent, hooks } = await createTestAgent();

    hooks.register({
      name: 'test-session-end-count',
      point: 'onSessionEnd',
      execute: async (ctx) => {
        fired.push(ctx);
        return { action: 'continue' };
      },
    });

    agent.sendMessage('Hello');
    await agent.run();
    // History should have system + user + assistant = 3 messages
    agent.clearHistory();

    assert.equal(fired.length, 1);
    // The hook must receive the count BEFORE clearing, not 0
    assert.ok(fired[0].messageCount >= 3, `Expected >=3 but got ${fired[0].messageCount}`);
  });

  it('onSessionEnd receives correct messageCount before history is cleared (reinit)', async () => {
    const fired = [];
    const { agent, hooks } = await createTestAgent();

    hooks.register({
      name: 'test-session-end-count',
      point: 'onSessionEnd',
      execute: async (ctx) => {
        fired.push(ctx);
        return { action: 'continue' };
      },
    });

    agent.sendMessage('Hello');
    await agent.run();
    agent.reinit({});

    assert.equal(fired.length, 1);
    assert.ok(fired[0].messageCount >= 3, `Expected >=3 but got ${fired[0].messageCount}`);
  });
});

// ── beforeOutbound on cached responses ────────────────────────────

describe('beforeOutbound on cached responses', () => {
  it('fires beforeOutbound on cache hit in run()', async () => {
    const fired = [];
    const { ResponseCache } = await import('../clawser-providers.js');
    const cache = new ResponseCache();

    const { agent, hooks } = await createTestAgent({ responseCache: cache });

    hooks.register({
      name: 'test-outbound-cache',
      point: 'beforeOutbound',
      execute: async (ctx) => {
        fired.push(ctx);
        return { action: 'continue' };
      },
    });

    // First call — populates cache
    agent.sendMessage('Hi');
    await agent.run();
    assert.equal(fired.length, 1);

    // Reset history so second call has same cache key (system + user "Hi")
    agent.reinit({});
    agent.setSystemPrompt('You are a test agent.');

    // Second call — should hit cache AND still fire beforeOutbound
    agent.sendMessage('Hi');
    const result = await agent.run();
    assert.equal(fired.length, 2, 'beforeOutbound must fire on cache hit');
    assert.equal(result.data, 'Hello');
    assert.ok(result.cached, 'response should be marked as cached');
  });

  it('fires beforeOutbound on cache hit in runStream()', async () => {
    const fired = [];
    const { ResponseCache } = await import('../clawser-providers.js');
    const cache = new ResponseCache();

    const { agent, hooks } = await createTestAgent({ responseCache: cache });

    hooks.register({
      name: 'test-outbound-cache-stream',
      point: 'beforeOutbound',
      execute: async (ctx) => {
        fired.push(ctx);
        return { action: 'continue' };
      },
    });

    // First call — populates cache via non-streaming fallback
    agent.sendMessage('Hi');
    for await (const _ of agent.runStream()) {}
    assert.equal(fired.length, 1);

    // Reset history so second call has same cache key
    agent.reinit({});
    agent.setSystemPrompt('You are a test agent.');

    // Second call — cache hit should still fire beforeOutbound
    agent.sendMessage('Hi');
    for await (const _ of agent.runStream()) {}
    assert.equal(fired.length, 2, 'beforeOutbound must fire on cache hit in runStream');
  });
});
