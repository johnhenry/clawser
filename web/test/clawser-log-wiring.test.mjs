// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-log-wiring.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClawserAgent } from '../clawser-agent.js';
import { RingBufferLog } from '../clawser-metrics.js';

// ── Minimal stubs ─────────────────────────────────────────────────

function makeStubProvider(response = { content: 'Hello', tool_calls: [], usage: { input_tokens: 10, output_tokens: 5 }, model: 'stub' }) {
  return {
    supportsNativeTools: true,
    supportsStreaming: false,
    chat: async () => ({ ...response }),
    chatStream: async function* () { yield { type: 'text', text: response.content }; yield { type: 'done', response }; },
  };
}

function makeStubProviderRegistry(provider) {
  const map = new Map([['stub', provider]]);
  return {
    get: (name) => map.get(name),
    listWithAvailability: async () => [{ name: 'stub' }],
  };
}

async function createTestAgent(overrides = {}) {
  const log = new RingBufferLog(100);
  const provider = makeStubProvider(overrides.response);
  const providers = makeStubProviderRegistry(overrides.provider || provider);

  const agent = await ClawserAgent.create({
    providers,
    ringBufferLog: log,
    ...overrides,
  });
  agent.init({});
  agent.setProvider('stub');
  agent.setSystemPrompt('You are a test agent.');
  return { agent, log, provider };
}

// ── RingBufferLog wiring ─────────────────────────────────────────

describe('RingBufferLog wiring', () => {
  it('pushes entries on agent run', async () => {
    const { agent, log } = await createTestAgent();
    agent.sendMessage('Hi');
    await agent.run();

    assert.ok(log.size > 0, 'RingBufferLog should have entries after run');
  });

  it('entries have correct fields (level, source, message)', async () => {
    const { agent, log } = await createTestAgent();
    agent.sendMessage('Hi');
    await agent.run();

    const entries = log.toArray();
    for (const entry of entries) {
      assert.ok(typeof entry.level === 'number', `entry missing level: ${JSON.stringify(entry)}`);
      assert.ok(typeof entry.source === 'string', `entry missing source: ${JSON.stringify(entry)}`);
      assert.ok(typeof entry.message === 'string', `entry missing message: ${JSON.stringify(entry)}`);
      assert.ok(typeof entry.timestamp === 'number', 'entry missing timestamp');
    }
  });

  it('query by source filters correctly', async () => {
    const { agent, log } = await createTestAgent();
    agent.sendMessage('Hi');
    await agent.run();

    const llmEntries = log.query({ source: 'llm' });
    for (const e of llmEntries) {
      assert.equal(e.source, 'llm');
    }
  });

  it('logs LLM call events with source=llm', async () => {
    const { agent, log } = await createTestAgent();
    agent.sendMessage('Hi');
    await agent.run();

    const llmEntries = log.query({ source: 'llm' });
    assert.ok(llmEntries.length >= 1, 'Should have at least one llm entry');
  });

  it('logs errors with level >= 3', async () => {
    const failProvider = {
      supportsNativeTools: false,
      supportsStreaming: false,
      chat: async () => { throw new Error('API down'); },
    };
    const { agent, log } = await createTestAgent({ provider: failProvider });
    agent.sendMessage('Hi');
    await agent.run();

    const errors = log.query({ level: 3 });
    assert.ok(errors.length >= 1, 'Should log errors on provider failure');
  });

  it('pushes entries in runStream too', async () => {
    const { agent, log } = await createTestAgent();
    agent.sendMessage('Hi');
    for await (const _ of agent.runStream()) {}

    assert.ok(log.size > 0, 'RingBufferLog should have entries after runStream');
  });
});
