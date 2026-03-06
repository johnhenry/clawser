// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-gateway.test.mjs
//
// Unit tests for ChannelGateway, ChannelQueue, CHANNEL_SCOPES, and CHANNEL_COLORS.
// Covers: queue serialization, channel registration/lifecycle, ingest/respond pipeline,
// streaming, tenantId threading, scheduler lane, error resilience, and edge cases.
// Integration tests with RoutineEngine live in clawser-gateway-integration.test.mjs.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub BrowserTool before import
globalThis.BrowserTool = class { constructor() {} };

import {
  ChannelGateway,
  ChannelQueue,
  CHANNEL_SCOPES,
  CHANNEL_COLORS,
} from '../clawser-gateway.js';

// ── Helpers ──────────────────────────────────────────────────────

/** Create a mock agent with sendMessage + runStream support. */
function mockAgent(response = 'Hello from agent') {
  const calls = [];
  return {
    calls,
    sendMessage(text, opts) {
      calls.push({ method: 'sendMessage', text, opts });
    },
    recordEvent(type, data, source) {
      calls.push({ method: 'recordEvent', type, data, source });
    },
    async *runStream() {
      yield { type: 'text', text: response };
      yield { type: 'done', response: { data: response } };
    },
  };
}

/** Create a mock channel plugin. */
function mockPlugin() {
  let cb = null;
  const sent = [];
  return {
    sent,
    running: false,
    _callback: null,
    start() { this.running = true; },
    stop() { this.running = false; },
    onMessage(callback) { this._callback = callback; cb = callback; },
    async sendMessage(text, opts) { sent.push({ text, opts }); return true; },
    /** Simulate receiving a message (for testing). */
    simulateMessage(msg) { if (cb) cb(msg); },
  };
}

// ── CHANNEL_SCOPES ──────────────────────────────────────────────

describe('CHANNEL_SCOPES', () => {
  it('has expected values', () => {
    assert.equal(CHANNEL_SCOPES.ISOLATED, 'isolated');
    assert.equal(CHANNEL_SCOPES.SHARED, 'shared');
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(CHANNEL_SCOPES));
  });
});

// ── CHANNEL_COLORS ──────────────────────────────────────────────

describe('CHANNEL_COLORS', () => {
  it('has expected channels', () => {
    assert.ok(CHANNEL_COLORS.telegram);
    assert.ok(CHANNEL_COLORS.discord);
    assert.ok(CHANNEL_COLORS.slack);
    assert.ok(CHANNEL_COLORS.wsh);
    assert.ok(CHANNEL_COLORS.mesh);
    assert.ok(CHANNEL_COLORS.scheduler);
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(CHANNEL_COLORS));
  });
});

// ── ChannelQueue ────────────────────────────────────────────────

describe('ChannelQueue', () => {
  it('processes tasks serially within a channel', async () => {
    const queue = new ChannelQueue();
    const order = [];

    const p1 = queue.enqueue('ch1', async () => {
      await new Promise(r => setTimeout(r, 20));
      order.push('first');
      return 'a';
    });
    const p2 = queue.enqueue('ch1', async () => {
      order.push('second');
      return 'b';
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.deepEqual(order, ['first', 'second']);
    assert.equal(r1, 'a');
    assert.equal(r2, 'b');
  });

  it('processes different channels concurrently', async () => {
    const queue = new ChannelQueue();
    const order = [];

    const p1 = queue.enqueue('ch1', async () => {
      await new Promise(r => setTimeout(r, 30));
      order.push('ch1');
    });
    const p2 = queue.enqueue('ch2', async () => {
      await new Promise(r => setTimeout(r, 10));
      order.push('ch2');
    });

    await Promise.all([p1, p2]);
    // ch2 should finish first since it's faster and independent
    assert.equal(order[0], 'ch2');
    assert.equal(order[1], 'ch1');
  });

  it('reports pending channels', async () => {
    const queue = new ChannelQueue();
    let resolve;
    const p = queue.enqueue('ch1', () => new Promise(r => { resolve = r; }));
    // Task is running but queue should reflect it
    assert.ok(queue.isProcessing('ch1'));
    resolve();
    await p;
  });

  it('propagates errors', async () => {
    const queue = new ChannelQueue();
    await assert.rejects(
      () => queue.enqueue('ch1', async () => { throw new Error('fail'); }),
      { message: 'fail' },
    );
  });

  it('clears all pending tasks', () => {
    const queue = new ChannelQueue();
    queue.clear();
    assert.equal(queue.pendingChannels, 0);
  });
});

// ── ChannelGateway ──────────────────────────────────────────────

describe('ChannelGateway', () => {
  let gw, agent;

  beforeEach(() => {
    agent = mockAgent('test response');
    gw = new ChannelGateway({ agent });
  });

  afterEach(() => {
    gw.destroy();
  });

  // ── Instantiation ─────────────────────────────────────

  describe('constructor', () => {
    it('creates with agent', () => {
      assert.equal(gw.agent, agent);
      assert.equal(gw.channelCount, 0);
      assert.equal(gw.activeCount, 0);
    });

    it('creates without agent', () => {
      const gw2 = new ChannelGateway();
      assert.equal(gw2.agent, null);
      gw2.destroy();
    });
  });

  // ── Channel Registration ──────────────────────────────

  describe('register / unregister', () => {
    it('registers a channel', () => {
      const plugin = mockPlugin();
      gw.register('telegram', plugin, { scope: 'isolated' });
      assert.equal(gw.channelCount, 1);
      assert.ok(gw.getChannel('telegram'));
    });

    it('replaces existing channel on re-register', () => {
      const p1 = mockPlugin();
      const p2 = mockPlugin();
      gw.register('telegram', p1);
      gw.start('telegram');
      assert.ok(p1.running);

      gw.register('telegram', p2);
      assert.equal(gw.channelCount, 1);
      // Old plugin should have been stopped
      assert.ok(!p1.running);
    });

    it('unregisters a channel', () => {
      gw.register('telegram', mockPlugin());
      assert.ok(gw.unregister('telegram'));
      assert.equal(gw.channelCount, 0);
    });

    it('unregister returns false for unknown', () => {
      assert.ok(!gw.unregister('nonexistent'));
    });

    it('lists channels', () => {
      gw.register('telegram', mockPlugin());
      gw.register('slack', mockPlugin());
      assert.deepEqual(gw.listChannels().sort(), ['slack', 'telegram']);
    });

    it('lists channel status', () => {
      gw.register('telegram', mockPlugin(), { scope: 'isolated' });
      gw.start('telegram');
      const status = gw.listChannelStatus();
      assert.equal(status.length, 1);
      assert.equal(status[0].id, 'telegram');
      assert.equal(status[0].scope, 'isolated');
      assert.equal(status[0].active, true);
    });
  });

  // ── Channel Lifecycle ─────────────────────────────────

  describe('start / stop', () => {
    it('starts a plugin', () => {
      const plugin = mockPlugin();
      gw.register('telegram', plugin);
      gw.start('telegram');
      assert.ok(plugin.running);
      assert.ok(gw.isActive('telegram'));
    });

    it('stops a plugin', () => {
      const plugin = mockPlugin();
      gw.register('telegram', plugin);
      gw.start('telegram');
      gw.stop('telegram');
      assert.ok(!plugin.running);
      assert.ok(!gw.isActive('telegram'));
    });

    it('startAll starts all registered', () => {
      const p1 = mockPlugin();
      const p2 = mockPlugin();
      gw.register('telegram', p1);
      gw.register('slack', p2);
      gw.startAll();
      assert.ok(p1.running);
      assert.ok(p2.running);
      assert.equal(gw.activeCount, 2);
    });

    it('stopAll stops all running', () => {
      const p1 = mockPlugin();
      const p2 = mockPlugin();
      gw.register('telegram', p1);
      gw.register('slack', p2);
      gw.startAll();
      gw.stopAll();
      assert.ok(!p1.running);
      assert.ok(!p2.running);
      assert.equal(gw.activeCount, 0);
    });

    it('ignores start for unknown channel', () => {
      gw.start('unknown');
      assert.equal(gw.activeCount, 0);
    });

    it('ignores double start', () => {
      const plugin = mockPlugin();
      gw.register('telegram', plugin);
      gw.start('telegram');
      gw.start('telegram');
      assert.equal(gw.activeCount, 1);
    });
  });

  // ── Ingest → Agent → Respond ──────────────────────────

  describe('ingest', () => {
    it('sends message to agent and returns response', async () => {
      const plugin = mockPlugin();
      gw.register('telegram', plugin);

      const response = await gw.ingest({
        id: 'msg_1',
        channel: 'telegram',
        channelId: '12345',
        sender: { id: '1', name: 'Alice', username: 'alice' },
        content: 'Hello',
        attachments: [],
        replyTo: null,
        timestamp: Date.now(),
      }, 'telegram');

      assert.equal(response, 'test response');

      // Agent should have been called with source metadata
      const sendCall = agent.calls.find(c => c.method === 'sendMessage');
      assert.ok(sendCall);
      assert.ok(sendCall.text.includes('Alice'));
      assert.ok(sendCall.text.includes('Hello'));
      assert.equal(sendCall.opts.source, 'telegram');
    });

    it('routes response back to plugin', async () => {
      const plugin = mockPlugin();
      gw.register('telegram', plugin);

      await gw.ingest({
        id: 'msg_1',
        channel: 'telegram',
        channelId: '12345',
        sender: { id: '1', name: 'Alice', username: 'alice' },
        content: 'Hello',
        attachments: [],
        replyTo: null,
        timestamp: Date.now(),
      }, 'telegram');

      assert.equal(plugin.sent.length, 1);
      assert.ok(plugin.sent[0].text.includes('test response'));
    });

    it('drops message when no agent', async () => {
      gw.setAgent(null);
      const result = await gw.ingest({ content: 'hello' }, 'test');
      assert.equal(result, '');
    });

    it('normalizes raw messages', async () => {
      const plugin = mockPlugin();
      gw.register('test', plugin);

      const response = await gw.ingest({ content: 'raw message' }, 'test');
      assert.equal(response, 'test response');
    });

    it('records channel_inbound event', async () => {
      const plugin = mockPlugin();
      gw.register('telegram', plugin);

      await gw.ingest({
        id: 'msg_1',
        channel: 'telegram',
        channelId: '12345',
        sender: { id: '1', name: 'Alice', username: 'alice' },
        content: 'Hello',
        attachments: [],
        replyTo: null,
        timestamp: Date.now(),
      }, 'telegram');

      const event = agent.calls.find(c => c.method === 'recordEvent' && c.type === 'channel_inbound');
      assert.ok(event);
      assert.equal(event.data.channelId, 'telegram');
      assert.equal(event.data.content, 'Hello');
    });

    it('records channel_outbound event', async () => {
      const plugin = mockPlugin();
      gw.register('telegram', plugin);

      await gw.ingest({
        id: 'msg_1',
        channel: 'telegram',
        channelId: '12345',
        sender: { id: '1', name: 'Alice', username: 'alice' },
        content: 'Hello',
        attachments: [],
        replyTo: null,
        timestamp: Date.now(),
      }, 'telegram');

      const event = agent.calls.find(c => c.method === 'recordEvent' && c.type === 'channel_outbound');
      assert.ok(event);
      assert.equal(event.data.channelId, 'telegram');
    });
  });

  // ── Serialized queue ──────────────────────────────────

  describe('serialized queue', () => {
    it('processes same-channel messages sequentially', async () => {
      const order = [];
      let callCount = 0;
      const slowAgent = {
        sendMessage() {},
        recordEvent() {},
        async *runStream() {
          callCount++;
          const n = callCount;
          await new Promise(r => setTimeout(r, 10));
          order.push(n);
          yield { type: 'done', response: { data: `response-${n}` } };
        },
      };

      gw.setAgent(slowAgent);
      const plugin = mockPlugin();
      gw.register('ch1', plugin);

      const p1 = gw.ingest({ id: 'a', channel: 'ch1', sender: { id: '1', name: 'A' }, content: 'first', attachments: [], timestamp: Date.now() }, 'ch1');
      const p2 = gw.ingest({ id: 'b', channel: 'ch1', sender: { id: '1', name: 'A' }, content: 'second', attachments: [], timestamp: Date.now() }, 'ch1');

      const [r1, r2] = await Promise.all([p1, p2]);
      assert.deepEqual(order, [1, 2]);
    });

    it('processes different-channel messages concurrently', async () => {
      const order = [];
      let callCount = 0;
      const slowAgent = {
        sendMessage() {},
        recordEvent() {},
        async *runStream() {
          callCount++;
          const n = callCount;
          // First call (ch1) takes longer
          await new Promise(r => setTimeout(r, n === 1 ? 30 : 5));
          order.push(`ch${n}`);
          yield { type: 'done', response: { data: `resp-${n}` } };
        },
      };

      gw.setAgent(slowAgent);
      gw.register('ch1', mockPlugin());
      gw.register('ch2', mockPlugin());

      const p1 = gw.ingest({ id: 'a', channel: 'ch1', sender: { id: '1', name: 'A' }, content: 'first', attachments: [], timestamp: Date.now() }, 'ch1');
      const p2 = gw.ingest({ id: 'b', channel: 'ch2', sender: { id: '2', name: 'B' }, content: 'second', attachments: [], timestamp: Date.now() }, 'ch2');

      await Promise.all([p1, p2]);
      // ch2 should finish first since its delay is shorter
      assert.equal(order[0], 'ch2');
    });
  });

  // ── Respond ───────────────────────────────────────────

  describe('respond', () => {
    it('sends formatted text to plugin', async () => {
      const plugin = mockPlugin();
      gw.register('slack', plugin);

      await gw.respond('slack', '**bold text**', {
        channel: 'slack',
        channelId: 'C123',
        id: 'msg_1',
      });

      assert.equal(plugin.sent.length, 1);
      // Slack formatting: ** → *
      assert.ok(plugin.sent[0].text.includes('*bold text*'));
      assert.equal(plugin.sent[0].opts.chatId, 'C123');
    });

    it('ignores unknown channel', async () => {
      await gw.respond('unknown', 'test');
      // Should not throw
    });
  });

  // ── Callbacks ─────────────────────────────────────────

  describe('callbacks', () => {
    it('fires onIngest callback', async () => {
      let ingestCall = null;
      const gw2 = new ChannelGateway({
        agent: mockAgent(),
        onIngest: (channelId, msg) => { ingestCall = { channelId, msg }; },
      });

      gw2.register('test', mockPlugin());
      await gw2.ingest({
        id: 'msg_1',
        channel: 'test',
        sender: { id: '1', name: 'Test' },
        content: 'hi',
        attachments: [],
        timestamp: Date.now(),
      }, 'test');

      assert.ok(ingestCall);
      assert.equal(ingestCall.channelId, 'test');
      gw2.destroy();
    });

    it('fires onRespond callback', async () => {
      let respondCall = null;
      const gw2 = new ChannelGateway({
        agent: mockAgent('yo'),
        onRespond: (channelId, text) => { respondCall = { channelId, text }; },
      });

      gw2.register('test', mockPlugin());
      await gw2.ingest({
        id: 'msg_1',
        channel: 'test',
        sender: { id: '1', name: 'Test' },
        content: 'hi',
        attachments: [],
        timestamp: Date.now(),
      }, 'test');

      assert.ok(respondCall);
      assert.equal(respondCall.channelId, 'test');
      assert.equal(respondCall.text, 'yo');
      gw2.destroy();
    });
  });

  // ── Plugin onMessage wiring ───────────────────────────

  describe('plugin auto-wiring', () => {
    it('wires plugin.onMessage to gateway.ingest on start', async () => {
      const plugin = mockPlugin();
      gw.register('telegram', plugin);
      gw.start('telegram');

      // Simulate plugin receiving a message
      const msg = {
        id: 'msg_99',
        channel: 'telegram',
        channelId: '12345',
        sender: { id: '1', name: 'Alice', username: 'alice' },
        content: 'from plugin',
        attachments: [],
        replyTo: null,
        timestamp: Date.now(),
      };

      // This should trigger ingest → agent → respond
      const responsePromise = new Promise(resolve => {
        const origSend = plugin.sendMessage.bind(plugin);
        plugin.sendMessage = async (text, opts) => {
          await origSend(text, opts);
          resolve(text);
        };
      });

      plugin.simulateMessage(msg);

      const responseText = await responsePromise;
      assert.ok(responseText.includes('test response'));
    });
  });

  // ── Error handling ────────────────────────────────────

  describe('error handling', () => {
    it('handles agent runStream error gracefully', async () => {
      const errAgent = {
        sendMessage() {},
        recordEvent() {},
        async *runStream() {
          yield { type: 'error', error: 'rate limited' };
        },
      };

      gw.setAgent(errAgent);
      const plugin = mockPlugin();
      gw.register('test', plugin);

      const result = await gw.ingest({
        id: 'msg_1',
        channel: 'test',
        sender: { id: '1', name: 'Test' },
        content: 'hi',
        attachments: [],
        timestamp: Date.now(),
      }, 'test');

      assert.ok(result.includes('Error'));
    });

    it('handles agent run exception', async () => {
      const errAgent = {
        sendMessage() {},
        recordEvent() {},
        async *runStream() { throw new Error('boom'); },
      };

      gw.setAgent(errAgent);
      const plugin = mockPlugin();
      gw.register('test', plugin);

      const result = await gw.ingest({
        id: 'msg_1',
        channel: 'test',
        sender: { id: '1', name: 'Test' },
        content: 'hi',
        attachments: [],
        timestamp: Date.now(),
      }, 'test');

      assert.ok(result.includes('Error'));
    });

    it('handles plugin sendMessage failure', async () => {
      const plugin = mockPlugin();
      plugin.sendMessage = async () => { throw new Error('network fail'); };
      gw.register('test', plugin);

      // Should not throw despite send failure
      const result = await gw.ingest({
        id: 'msg_1',
        channel: 'test',
        sender: { id: '1', name: 'Test' },
        content: 'hi',
        attachments: [],
        timestamp: Date.now(),
      }, 'test');

      assert.equal(result, 'test response');
    });
  });

  // ── Destroy ───────────────────────────────────────────

  describe('destroy', () => {
    it('stops all channels and clears state', () => {
      const plugin = mockPlugin();
      gw.register('telegram', plugin);
      gw.start('telegram');
      gw.destroy();

      assert.ok(!plugin.running);
      assert.equal(gw.channelCount, 0);
      assert.equal(gw.activeCount, 0);
      assert.equal(gw.agent, null);
    });
  });

  // ── setAgent ──────────────────────────────────────────

  describe('setAgent', () => {
    it('replaces agent reference', () => {
      const newAgent = mockAgent('new');
      gw.setAgent(newAgent);
      assert.equal(gw.agent, newAgent);
    });

    it('setAgent(null) prevents future ingests', async () => {
      gw.setAgent(null);
      const result = await gw.ingest({ content: 'hi' }, 'test');
      assert.equal(result, '');
    });
  });

  // ── Scheduler / routine lane ────────────────────────

  describe('scheduler lane', () => {
    it('ingests a routine-style message through the queue', async () => {
      let ingestCall = null;
      let respondCall = null;
      const gw2 = new ChannelGateway({
        agent: mockAgent('routine done'),
        onIngest: (channelId, msg) => { ingestCall = { channelId, msg }; },
        onRespond: (channelId, text) => { respondCall = { channelId, text }; },
      });

      // No plugin needed — routine ingests directly
      const result = await gw2.ingest({
        id: 'routine_daily_123',
        channel: 'scheduler',
        channelId: 'daily',
        sender: { id: 'scheduler', name: 'Daily Report', username: null },
        content: 'Generate daily summary',
        attachments: [],
        replyTo: null,
        timestamp: Date.now(),
      }, 'scheduler:daily');

      assert.equal(result, 'routine done');
      assert.ok(ingestCall);
      assert.equal(ingestCall.channelId, 'scheduler:daily');
      assert.equal(ingestCall.msg.channel, 'scheduler');
      assert.ok(respondCall);
      assert.equal(respondCall.channelId, 'scheduler:daily');
      gw2.destroy();
    });

    it('serializes same-routine messages via channel key', async () => {
      const order = [];
      let callCount = 0;
      const slowAgent = {
        sendMessage() {},
        recordEvent() {},
        async *runStream() {
          callCount++;
          const n = callCount;
          await new Promise(r => setTimeout(r, 10));
          order.push(n);
          yield { type: 'done', response: { data: `resp-${n}` } };
        },
      };

      const gw2 = new ChannelGateway({ agent: slowAgent });

      const msg = (id) => ({
        id, channel: 'scheduler', channelId: 'r1',
        sender: { id: 'scheduler', name: 'R1' },
        content: 'run', attachments: [], timestamp: Date.now(),
      });

      const p1 = gw2.ingest(msg('a'), 'scheduler:r1');
      const p2 = gw2.ingest(msg('b'), 'scheduler:r1');
      await Promise.all([p1, p2]);
      assert.deepEqual(order, [1, 2]); // sequential
      gw2.destroy();
    });

    it('runs different routines concurrently via distinct channel keys', async () => {
      const order = [];
      let callCount = 0;
      const slowAgent = {
        sendMessage() {},
        recordEvent() {},
        async *runStream() {
          callCount++;
          const n = callCount;
          // First routine is slower
          await new Promise(r => setTimeout(r, n === 1 ? 30 : 5));
          order.push(`r${n}`);
          yield { type: 'done', response: { data: `resp-${n}` } };
        },
      };

      const gw2 = new ChannelGateway({ agent: slowAgent });

      const p1 = gw2.ingest({
        id: 'a', channel: 'scheduler', channelId: 'r1',
        sender: { id: 'scheduler', name: 'R1' },
        content: 'slow', attachments: [], timestamp: Date.now(),
      }, 'scheduler:r1');
      const p2 = gw2.ingest({
        id: 'b', channel: 'scheduler', channelId: 'r2',
        sender: { id: 'scheduler', name: 'R2' },
        content: 'fast', attachments: [], timestamp: Date.now(),
      }, 'scheduler:r2');

      await Promise.all([p1, p2]);
      // r2 finishes first (shorter delay, different channel key)
      assert.equal(order[0], 'r2');
      assert.equal(order[1], 'r1');
      gw2.destroy();
    });

    it('records channel_inbound and channel_outbound events for scheduler', async () => {
      const a = mockAgent('done');
      const gw2 = new ChannelGateway({ agent: a });

      await gw2.ingest({
        id: 'routine_r1_1', channel: 'scheduler', channelId: 'r1',
        sender: { id: 'scheduler', name: 'Backup' },
        content: 'Run backup', attachments: [], timestamp: Date.now(),
      }, 'scheduler:r1');

      const inbound = a.calls.find(c => c.method === 'recordEvent' && c.type === 'channel_inbound');
      assert.ok(inbound);
      assert.equal(inbound.data.channel, 'scheduler');
      assert.equal(inbound.data.sender.name, 'Backup');
      assert.equal(inbound.data.content, 'Run backup');

      const outbound = a.calls.find(c => c.method === 'recordEvent' && c.type === 'channel_outbound');
      assert.ok(outbound, 'should record outbound event even without plugin');
      assert.equal(outbound.data.channelId, 'scheduler:r1');
      gw2.destroy();
    });

    it('formats agent text with scheduler channel prefix', async () => {
      const a = mockAgent('ok');
      const gw2 = new ChannelGateway({ agent: a });

      await gw2.ingest({
        id: 'r1', channel: 'scheduler', channelId: 'daily',
        sender: { id: 'scheduler', name: 'Daily Report' },
        content: 'Summarize today', attachments: [], timestamp: Date.now(),
      }, 'scheduler:daily');

      const sendCall = a.calls.find(c => c.method === 'sendMessage');
      assert.ok(sendCall.text.includes('[scheduler/Daily Report]'));
      assert.ok(sendCall.text.includes('Summarize today'));
      assert.equal(sendCall.opts.source, 'scheduler:daily');
      gw2.destroy();
    });
  });

  // ── Respond behavior ────────────────────────────────

  describe('respond (extended)', () => {
    it('fires onRespond for unregistered channels', async () => {
      let respondCall = null;
      const gw2 = new ChannelGateway({
        agent: mockAgent('yo'),
        onRespond: (channelId, text) => { respondCall = { channelId, text }; },
      });

      // Respond to an unregistered channel
      await gw2.respond('scheduler:daily', 'response text');

      assert.ok(respondCall, 'onRespond should fire even for unregistered channels');
      assert.equal(respondCall.channelId, 'scheduler:daily');
      assert.equal(respondCall.text, 'response text');
      gw2.destroy();
    });

    it('records outbound event for unregistered channels', async () => {
      const a = mockAgent('ok');
      const gw2 = new ChannelGateway({ agent: a });

      await gw2.respond('scheduler:daily', 'response text');

      const outbound = a.calls.find(c => c.method === 'recordEvent' && c.type === 'channel_outbound');
      assert.ok(outbound, 'should record outbound event for unregistered channels');
      assert.equal(outbound.data.channelId, 'scheduler:daily');
      gw2.destroy();
    });

    it('does not attempt plugin send for unregistered channels', async () => {
      const a = mockAgent('ok');
      const gw2 = new ChannelGateway({ agent: a });

      // Should not throw even though no plugin exists
      await gw2.respond('nonexistent', 'hello');

      // Only recordEvent should be called on agent, not any sendMessage
      const sendCalls = a.calls.filter(c => c.method === 'sendMessage');
      assert.equal(sendCalls.length, 0, 'should not call agent.sendMessage from respond');
      gw2.destroy();
    });

    it('truncates outbound content to 500 chars', async () => {
      const a = mockAgent('ok');
      const gw2 = new ChannelGateway({ agent: a });

      const longText = 'x'.repeat(1000);
      await gw2.respond('test', longText);

      const outbound = a.calls.find(c => c.method === 'recordEvent' && c.type === 'channel_outbound');
      assert.equal(outbound.data.content.length, 500);
      gw2.destroy();
    });

    it('handles null agent gracefully in respond', async () => {
      const gw2 = new ChannelGateway();
      // Should not throw when agent is null
      await gw2.respond('test', 'hello');
      gw2.destroy();
    });
  });

  // ── Tenant ID threading ─────────────────────────────

  describe('tenantId', () => {
    it('passes constructor tenantId to agent.sendMessage and recordEvent', async () => {
      const tenantAgent = mockAgent('ok');
      const gw2 = new ChannelGateway({
        agent: tenantAgent,
        tenantId: 'tenant_ws_1',
      });

      gw2.register('test', mockPlugin());
      await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'Alice' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      const sendCall = tenantAgent.calls.find(c => c.method === 'sendMessage');
      assert.equal(sendCall.opts.tenantId, 'tenant_ws_1');

      const event = tenantAgent.calls.find(c => c.method === 'recordEvent' && c.type === 'channel_inbound');
      assert.equal(event.data.tenantId, 'tenant_ws_1');
      gw2.destroy();
    });

    it('per-ingest tenantId overrides constructor default', async () => {
      const tenantAgent = mockAgent('ok');
      const gw2 = new ChannelGateway({
        agent: tenantAgent,
        tenantId: 'tenant_default',
      });

      gw2.register('test', mockPlugin());
      await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'Bob' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test', { tenantId: 'tenant_override' });

      const sendCall = tenantAgent.calls.find(c => c.method === 'sendMessage');
      assert.equal(sendCall.opts.tenantId, 'tenant_override');
      gw2.destroy();
    });

    it('setTenantId updates the default tenant', async () => {
      const tenantAgent = mockAgent('ok');
      const gw2 = new ChannelGateway({
        agent: tenantAgent,
        tenantId: 'tenant_old',
      });

      gw2.setTenantId('tenant_new');
      gw2.register('test', mockPlugin());
      await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'X' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      const sendCall = tenantAgent.calls.find(c => c.method === 'sendMessage');
      assert.equal(sendCall.opts.tenantId, 'tenant_new');
      gw2.destroy();
    });

    it('setTenantId(null) resets to null', async () => {
      const tenantAgent = mockAgent('ok');
      const gw2 = new ChannelGateway({
        agent: tenantAgent,
        tenantId: 'tenant_active',
      });

      gw2.setTenantId(null);
      gw2.register('test', mockPlugin());
      await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'Y' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      const sendCall = tenantAgent.calls.find(c => c.method === 'sendMessage');
      assert.equal(sendCall.opts.tenantId, null);
      gw2.destroy();
    });

    it('setTenantId(undefined) resets to null', async () => {
      const tenantAgent = mockAgent('ok');
      const gw2 = new ChannelGateway({
        agent: tenantAgent,
        tenantId: 'tenant_active',
      });

      gw2.setTenantId(undefined);
      gw2.register('test', mockPlugin());
      await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'Z' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      const sendCall = tenantAgent.calls.find(c => c.method === 'sendMessage');
      assert.equal(sendCall.opts.tenantId, null);
      gw2.destroy();
    });

    it('explicit null in ingest opts overrides constructor tenantId', async () => {
      const tenantAgent = mockAgent('ok');
      const gw2 = new ChannelGateway({
        agent: tenantAgent,
        tenantId: 'tenant_default',
      });

      gw2.register('test', mockPlugin());
      await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'A' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test', { tenantId: null });

      const sendCall = tenantAgent.calls.find(c => c.method === 'sendMessage');
      // Explicit null override should win over constructor default
      assert.equal(sendCall.opts.tenantId, null);
      gw2.destroy();
    });

    it('tenantId is null when not provided', async () => {
      const plugin = mockPlugin();
      gw.register('test', plugin);

      await gw.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'X' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      const sendCall = agent.calls.find(c => c.method === 'sendMessage');
      assert.equal(sendCall.opts.tenantId, null);

      const event = agent.calls.find(c => c.method === 'recordEvent' && c.type === 'channel_inbound');
      assert.equal(event.data.tenantId, null);
    });

    it('tenantId flows through to scheduler messages', async () => {
      const tenantAgent = mockAgent('scheduled');
      const gw2 = new ChannelGateway({
        agent: tenantAgent,
        tenantId: 'tenant_ws_42',
      });

      // Scheduler ingests without registering a plugin
      await gw2.ingest({
        id: 'routine_r1_1', channel: 'scheduler', channelId: 'r1',
        sender: { id: 'scheduler', name: 'Backup' },
        content: 'Run backup', attachments: [], timestamp: Date.now(),
      }, 'scheduler:r1');

      const sendCall = tenantAgent.calls.find(c => c.method === 'sendMessage');
      assert.equal(sendCall.opts.tenantId, 'tenant_ws_42');
      assert.equal(sendCall.opts.source, 'scheduler:r1');

      const event = tenantAgent.calls.find(c => c.method === 'recordEvent' && c.type === 'channel_inbound');
      assert.equal(event.data.tenantId, 'tenant_ws_42');
      gw2.destroy();
    });
  });

  // ── Agent fallback path ─────────────────────────────

  describe('non-streaming agent fallback', () => {
    it('uses agent.run() when runStream is not available', async () => {
      const nonStreamAgent = {
        calls: [],
        sendMessage(text, opts) { this.calls.push({ method: 'sendMessage', text, opts }); },
        recordEvent(type, data, source) { this.calls.push({ method: 'recordEvent', type, data, source }); },
        async run() { return { data: 'non-stream response' }; },
      };

      const gw2 = new ChannelGateway({ agent: nonStreamAgent });
      gw2.register('test', mockPlugin());

      const result = await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'A' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      assert.equal(result, 'non-stream response');
      gw2.destroy();
    });

    it('returns empty string when agent.run() returns no data', async () => {
      const emptyAgent = {
        sendMessage() {},
        recordEvent() {},
        async run() { return {}; },
      };

      const gw2 = new ChannelGateway({ agent: emptyAgent });
      gw2.register('test', mockPlugin());

      const result = await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'A' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      assert.equal(result, '');
      gw2.destroy();
    });
  });

  // ── Edge cases ──────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty content message', async () => {
      gw.register('test', mockPlugin());

      const result = await gw.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'A' },
        content: '', attachments: [], timestamp: Date.now(),
      }, 'test');

      assert.equal(result, 'test response');
      const sendCall = agent.calls.find(c => c.method === 'sendMessage');
      assert.ok(sendCall.text.includes('[test/A]: '));
    });

    it('handles sender with null username', async () => {
      gw.register('test', mockPlugin());

      await gw.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'Bot', username: null },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      const sendCall = agent.calls.find(c => c.method === 'sendMessage');
      assert.ok(sendCall.text.includes('[test/Bot]'));
    });

    it('handles rapid sequential ingests to same channel', async () => {
      gw.register('ch1', mockPlugin());

      const results = await Promise.all([
        gw.ingest({ id: 'a', channel: 'ch1', sender: { id: '1', name: 'A' }, content: '1', attachments: [], timestamp: Date.now() }, 'ch1'),
        gw.ingest({ id: 'b', channel: 'ch1', sender: { id: '1', name: 'A' }, content: '2', attachments: [], timestamp: Date.now() }, 'ch1'),
        gw.ingest({ id: 'c', channel: 'ch1', sender: { id: '1', name: 'A' }, content: '3', attachments: [], timestamp: Date.now() }, 'ch1'),
      ]);

      // All should complete with the same response
      assert.equal(results.length, 3);
      results.forEach(r => assert.equal(r, 'test response'));

      // Agent should have received 3 sendMessage calls
      const sendCalls = agent.calls.filter(c => c.method === 'sendMessage');
      assert.equal(sendCalls.length, 3);
    });

    it('concurrent ingests to registered and unregistered channels', async () => {
      const a = mockAgent('ok');
      const gw2 = new ChannelGateway({
        agent: a,
        onRespond: () => {},
      });
      gw2.register('telegram', mockPlugin());

      const [r1, r2] = await Promise.all([
        gw2.ingest({
          id: 'a', channel: 'telegram',
          sender: { id: '1', name: 'Alice' },
          content: 'hello', attachments: [], timestamp: Date.now(),
        }, 'telegram'),
        gw2.ingest({
          id: 'b', channel: 'scheduler',
          sender: { id: 'scheduler', name: 'Cron' },
          content: 'task', attachments: [], timestamp: Date.now(),
        }, 'scheduler:cron1'),
      ]);

      assert.equal(r1, 'ok');
      assert.equal(r2, 'ok');
      gw2.destroy();
    });

    it('destroy clears tenantId', () => {
      const gw2 = new ChannelGateway({ tenantId: 'tenant_123' });
      gw2.destroy();
      assert.equal(gw2.agent, null);
      assert.equal(gw2.channelCount, 0);
    });
  });

  // ── Streaming behavior ──────────────────────────────

  describe('streaming', () => {
    it('accumulates multiple text chunks', async () => {
      const multiChunkAgent = {
        sendMessage() {},
        recordEvent() {},
        async *runStream() {
          yield { type: 'text', text: 'Hello ' };
          yield { type: 'text', text: 'World' };
          yield { type: 'done', response: {} };
        },
      };

      const gw2 = new ChannelGateway({ agent: multiChunkAgent });
      gw2.register('test', mockPlugin());

      const result = await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'A' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      // done has no response.data, so accumulated text is used
      assert.equal(result, 'Hello World');
      gw2.destroy();
    });

    it('done with response.data overwrites accumulated text', async () => {
      const overwriteAgent = {
        sendMessage() {},
        recordEvent() {},
        async *runStream() {
          yield { type: 'text', text: 'partial ' };
          yield { type: 'text', text: 'chunks' };
          yield { type: 'done', response: { data: 'final answer' } };
        },
      };

      const gw2 = new ChannelGateway({ agent: overwriteAgent });
      gw2.register('test', mockPlugin());

      const result = await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'A' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      assert.equal(result, 'final answer');
      gw2.destroy();
    });

    it('done without response.data preserves accumulated text', async () => {
      const noDataAgent = {
        sendMessage() {},
        recordEvent() {},
        async *runStream() {
          yield { type: 'text', text: 'accumulated' };
          yield { type: 'done', response: {} };
        },
      };

      const gw2 = new ChannelGateway({ agent: noDataAgent });
      gw2.register('test', mockPlugin());

      const result = await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'A' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      assert.equal(result, 'accumulated');
      gw2.destroy();
    });

    it('done with null response preserves accumulated text', async () => {
      const nullRespAgent = {
        sendMessage() {},
        recordEvent() {},
        async *runStream() {
          yield { type: 'text', text: 'kept' };
          yield { type: 'done', response: null };
        },
      };

      const gw2 = new ChannelGateway({ agent: nullRespAgent });
      gw2.register('test', mockPlugin());

      const result = await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'A' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      assert.equal(result, 'kept');
      gw2.destroy();
    });

    it('done with empty string response.data does NOT overwrite', async () => {
      const emptyDataAgent = {
        sendMessage() {},
        recordEvent() {},
        async *runStream() {
          yield { type: 'text', text: 'good text' };
          yield { type: 'done', response: { data: '' } };
        },
      };

      const gw2 = new ChannelGateway({ agent: emptyDataAgent });
      gw2.register('test', mockPlugin());

      const result = await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'A' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      // Empty string is falsy, so chunk.response?.data check fails, accumulated text preserved
      assert.equal(result, 'good text');
      gw2.destroy();
    });

    it('error chunk with object error stringifies it', async () => {
      const objErrAgent = {
        sendMessage() {},
        recordEvent() {},
        async *runStream() {
          yield { type: 'error', error: { code: 429, msg: 'rate limited' } };
        },
      };

      const gw2 = new ChannelGateway({ agent: objErrAgent });
      gw2.register('test', mockPlugin());

      const result = await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'A' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      assert.ok(result.startsWith('Error:'));
      gw2.destroy();
    });

    it('error chunk with null error', async () => {
      const nullErrAgent = {
        sendMessage() {},
        recordEvent() {},
        async *runStream() {
          yield { type: 'error', error: null };
        },
      };

      const gw2 = new ChannelGateway({ agent: nullErrAgent });
      gw2.register('test', mockPlugin());

      const result = await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'A' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      assert.ok(result.startsWith('Error:'));
      gw2.destroy();
    });

    it('empty response does not fire respond()', async () => {
      let respondCalled = false;
      const emptyAgent = {
        sendMessage() {},
        recordEvent() {},
        async *runStream() {
          yield { type: 'done', response: {} };
        },
      };

      const gw2 = new ChannelGateway({
        agent: emptyAgent,
        onRespond: () => { respondCalled = true; },
      });
      gw2.register('test', mockPlugin());

      const result = await gw2.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'A' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      assert.equal(result, '');
      assert.ok(!respondCalled, 'should not fire respond for empty response');
      gw2.destroy();
    });
  });

  // ── Respond edge cases ──────────────────────────────

  describe('respond edge cases', () => {
    it('handles plugin without sendMessage method', async () => {
      const noSendPlugin = {
        start() {},
        stop() {},
        onMessage() {},
        // No sendMessage!
      };

      gw.register('nosend', noSendPlugin);
      // Should not throw
      await gw.respond('nosend', 'hello', { channel: 'nosend', id: 'msg_1' });
    });

    it('builds replyOpts only when originalMsg has fields', async () => {
      const plugin = mockPlugin();
      gw.register('test', plugin);

      // originalMsg with no channelId or id
      await gw.respond('test', 'reply', {});
      assert.equal(plugin.sent.length, 1);
      assert.deepEqual(plugin.sent[0].opts, {});
    });

    it('builds replyOpts with both chatId and replyTo', async () => {
      const plugin = mockPlugin();
      gw.register('test', plugin);

      await gw.respond('test', 'reply', {
        channel: 'test',
        channelId: 'C123',
        id: 'msg_456',
      });

      assert.equal(plugin.sent[0].opts.chatId, 'C123');
      assert.equal(plugin.sent[0].opts.replyTo, 'msg_456');
    });

    it('builds replyOpts with only chatId', async () => {
      const plugin = mockPlugin();
      gw.register('test', plugin);

      await gw.respond('test', 'reply', {
        channel: 'test',
        channelId: 'C123',
        // No .id
      });

      assert.equal(plugin.sent[0].opts.chatId, 'C123');
      assert.equal(plugin.sent[0].opts.replyTo, undefined);
    });

    it('builds replyOpts with only replyTo', async () => {
      const plugin = mockPlugin();
      gw.register('test', plugin);

      await gw.respond('test', 'reply', {
        channel: 'test',
        id: 'msg_789',
        // No .channelId
      });

      assert.equal(plugin.sent[0].opts.chatId, undefined);
      assert.equal(plugin.sent[0].opts.replyTo, 'msg_789');
    });

    it('uses channelId as format key when originalMsg has no channel', async () => {
      const plugin = mockPlugin();
      gw.register('test', plugin);

      // originalMsg = null → channel fallback is channelId
      await gw.respond('test', 'hello', null);
      assert.equal(plugin.sent.length, 1);
    });
  });

  // ── Message normalization ───────────────────────────

  describe('message normalization', () => {
    it('normalizes message missing id field', async () => {
      gw.register('test', mockPlugin());

      const result = await gw.ingest({
        channel: 'test',
        sender: { id: '1', name: 'A' },
        content: 'no id', attachments: [], timestamp: Date.now(),
      }, 'test');

      assert.equal(result, 'test response');
    });

    it('normalizes message missing sender field', async () => {
      gw.register('test', mockPlugin());

      const result = await gw.ingest({
        id: 'msg_1',
        channel: 'test',
        content: 'no sender', attachments: [], timestamp: Date.now(),
      }, 'test');

      assert.equal(result, 'test response');
    });

    it('normalizes message missing channel field', async () => {
      gw.register('test', mockPlugin());

      const result = await gw.ingest({
        id: 'msg_1',
        sender: { id: '1', name: 'A' },
        content: 'no channel', attachments: [], timestamp: Date.now(),
      }, 'test');

      assert.equal(result, 'test response');
    });

    it('passes pre-normalized message through unchanged', async () => {
      gw.register('test', mockPlugin());

      const msg = {
        id: 'msg_1',
        channel: 'custom_channel',
        sender: { id: '1', name: 'CustomSender' },
        content: 'pre-normalized', attachments: [], timestamp: Date.now(),
      };

      await gw.ingest(msg, 'test');

      const sendCall = agent.calls.find(c => c.method === 'sendMessage');
      // Should use the msg's channel, not the channelId parameter
      assert.ok(sendCall.text.includes('[custom_channel/CustomSender]'));
    });

    it('uses channelId to set channel on normalized message', async () => {
      gw.register('slack', mockPlugin());

      await gw.ingest({ content: 'raw' }, 'slack');

      const sendCall = agent.calls.find(c => c.method === 'sendMessage');
      assert.ok(sendCall.text.includes('[slack/'));
    });
  });

  // ── Concurrent lifecycle ────────────────────────────

  describe('concurrent lifecycle', () => {
    it('handles ingest after destroy gracefully', async () => {
      gw.register('test', mockPlugin());
      gw.destroy();

      // Agent is null after destroy, so ingest should return empty
      const result = await gw.ingest({
        id: 'msg_1', channel: 'test',
        sender: { id: '1', name: 'A' },
        content: 'hi', attachments: [], timestamp: Date.now(),
      }, 'test');

      assert.equal(result, '');
    });

    it('handles respond after destroy gracefully', async () => {
      gw.destroy();
      // Should not throw — agent is null, no plugin
      await gw.respond('test', 'hello');
    });

    it('re-entrant enqueue during task execution', async () => {
      const queue = new ChannelQueue();
      const order = [];

      const p1 = queue.enqueue('ch1', async () => {
        order.push('outer-start');
        // Enqueue another task on the same channel while executing
        const p2 = queue.enqueue('ch1', async () => {
          order.push('inner');
          return 'inner-result';
        });
        order.push('outer-end');
        return 'outer-result';
      });

      const r1 = await p1;
      assert.equal(r1, 'outer-result');
      // Inner task should run after outer completes (serialized)
      // Wait a tick for the inner task to complete
      await new Promise(r => setTimeout(r, 10));
      assert.deepEqual(order, ['outer-start', 'outer-end', 'inner']);
    });

    it('queued tasks still complete after queue.clear()', async () => {
      const queue = new ChannelQueue();
      let resolve;
      const p = queue.enqueue('ch1', () => new Promise(r => { resolve = r; }));

      // Clear the queue while task is running
      queue.clear();

      // The currently running task should still be able to resolve
      resolve('done');
      // Note: after clear(), the internal state is reset but the promise
      // from the running task still exists in the caller's scope
    });

    it('plugin callback after stop still reaches ingest', async () => {
      const plugin = mockPlugin();
      gw.register('telegram', plugin);
      gw.start('telegram');
      gw.stop('telegram');

      // The plugin callback was wired during start() and isn't unwired on stop
      // Simulate a late message arriving from the plugin
      const msg = {
        id: 'late', channel: 'telegram',
        sender: { id: '1', name: 'Late' },
        content: 'delayed', attachments: [], timestamp: Date.now(),
      };

      // This still works because the callback closure captures `this.ingest`
      plugin.simulateMessage(msg);
      // Give it a tick to process
      await new Promise(r => setTimeout(r, 20));

      // Agent should have received the message
      const sendCall = agent.calls.find(c => c.method === 'sendMessage' && c.text.includes('delayed'));
      assert.ok(sendCall, 'late message should still reach agent');
    });
  });

  // ── onLog callback ──────────────────────────────────

  describe('onLog', () => {
    it('fires log messages for registration and lifecycle', () => {
      const logs = [];
      const gw2 = new ChannelGateway({
        agent: mockAgent(),
        onLog: (msg) => logs.push(msg),
      });

      gw2.register('test', mockPlugin());
      gw2.start('test');
      gw2.stop('test');
      gw2.unregister('test');
      gw2.destroy();

      assert.ok(logs.some(l => l.includes('registered')));
      assert.ok(logs.some(l => l.includes('started')));
      assert.ok(logs.some(l => l.includes('stopped')));
      assert.ok(logs.some(l => l.includes('unregistered')));
      assert.ok(logs.some(l => l.includes('destroyed')));
    });

    it('fires log when message dropped (no agent)', async () => {
      const logs = [];
      const gw2 = new ChannelGateway({
        onLog: (msg) => logs.push(msg),
      });

      await gw2.ingest({ content: 'dropped' }, 'test');
      assert.ok(logs.some(l => l.includes('No agent')));
      gw2.destroy();
    });

    it('fires log for unknown channel start', () => {
      const logs = [];
      const gw2 = new ChannelGateway({
        onLog: (msg) => logs.push(msg),
      });

      gw2.start('unknown');
      assert.ok(logs.some(l => l.includes('unknown')));
      gw2.destroy();
    });
  });
});
