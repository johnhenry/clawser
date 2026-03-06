// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-gateway-integration.test.mjs
//
// Integration tests for the RoutineEngine → ChannelGateway → Agent pipeline
// (Gap 1: Cron/Routine Lane) and tenantId recording through gateway messages
// (Gap 2: Kernel Tenant Context). Unit tests live in clawser-gateway.test.mjs.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.BrowserTool = class { constructor() {} };

import { ChannelGateway, CHANNEL_COLORS } from '../clawser-gateway.js';
import {
  RoutineEngine,
  TRIGGER_TYPES,
  ACTION_TYPES,
  resetRoutineCounter,
} from '../clawser-routines.js';

// ── Helpers ──────────────────────────────────────────────────────

/** Mock agent that records all calls and streams a fixed response. */
function mockAgent(response = 'agent reply') {
  const calls = [];
  const events = [];
  return {
    calls,
    events,
    sendMessage(text, opts) {
      calls.push({ method: 'sendMessage', text, opts });
    },
    recordEvent(type, data, source) {
      events.push({ type, data, source });
    },
    async *runStream() {
      yield { type: 'text', text: response };
      yield { type: 'done', response: { data: response } };
    },
    async run() {
      return { data: response };
    },
  };
}

/** Mock agent that throws on runStream (simulates provider failure). */
function failingAgent() {
  const calls = [];
  return {
    calls,
    sendMessage(text, opts) { calls.push({ method: 'sendMessage', text, opts }); },
    recordEvent() {},
    async *runStream() { throw new Error('provider unavailable'); },
  };
}

// ── RoutineEngine → Gateway integration ─────────────────────────

describe('RoutineEngine → Gateway integration', () => {
  let agent, gw, engine;

  beforeEach(() => {
    resetRoutineCounter();
    agent = mockAgent('routine completed');
    gw = new ChannelGateway({
      agent,
      tenantId: 'tenant_ws_test',
      onIngest: () => {},
      onRespond: () => {},
    });
  });

  afterEach(() => {
    engine?.stop();
    gw?.destroy();
  });

  it('executeFn routes routine through gateway.ingest', async () => {
    let gatewayResult = null;

    engine = new RoutineEngine({
      executeFn: async (routine) => {
        const prompt = routine.action?.prompt || routine.name || 'routine';
        const routineId = routine.id || `unnamed_${Date.now()}`;
        const routineName = routine.name || routineId;
        if (gw) {
          gatewayResult = await gw.ingest({
            id: `routine_${routineId}_${Date.now()}`,
            channel: 'scheduler',
            channelId: routineId,
            sender: { id: 'scheduler', name: routineName, username: null },
            content: prompt,
            attachments: [],
            replyTo: null,
            timestamp: Date.now(),
          }, `scheduler:${routineId}`);
          return gatewayResult;
        }
      },
    });

    const { id } = engine.addRoutine({
      name: 'Test Routine',
      trigger: { type: TRIGGER_TYPES.MANUAL },
      action: { type: ACTION_TYPES.PROMPT, prompt: 'do the thing' },
    });

    const result = await engine.triggerManual(id);
    assert.equal(result, 'success');
    assert.equal(gatewayResult, 'routine completed');

    // Verify agent received the message via gateway
    const sendCall = agent.calls.find(c => c.method === 'sendMessage');
    assert.ok(sendCall);
    assert.ok(sendCall.text.includes('[scheduler/Test Routine]'));
    assert.ok(sendCall.text.includes('do the thing'));
    assert.ok(sendCall.opts.source.startsWith('scheduler:'));
    assert.equal(sendCall.opts.tenantId, 'tenant_ws_test');
  });

  it('executeFn falls back to direct agent.run when gateway throws', async () => {
    const fallbackAgent = mockAgent('direct run result');
    let fellBack = false;

    // A gateway whose ingest() actually throws (e.g., null agent + queue error)
    const brokenGw = {
      async ingest() { throw new Error('gateway crashed'); },
      destroy() {},
    };

    engine = new RoutineEngine({
      executeFn: async (routine) => {
        const prompt = routine.action?.prompt || routine.name || 'routine';
        if (brokenGw) {
          try {
            return await brokenGw.ingest({
              id: `routine_${routine.id}_${Date.now()}`,
              channel: 'scheduler',
              channelId: routine.id,
              sender: { id: 'scheduler', name: routine.name, username: null },
              content: prompt,
              attachments: [],
              replyTo: null,
              timestamp: Date.now(),
            }, `scheduler:${routine.id}`);
          } catch {
            fellBack = true;
          }
        }
        // Fallback: direct agent run
        fallbackAgent.sendMessage(prompt);
        return fallbackAgent.run();
      },
    });

    const { id } = engine.addRoutine({
      name: 'Fallback Test',
      trigger: { type: TRIGGER_TYPES.MANUAL },
      action: { type: ACTION_TYPES.PROMPT, prompt: 'test fallback' },
    });

    const result = await engine.triggerManual(id);
    assert.equal(result, 'success');
    assert.ok(fellBack, 'should have caught gateway error and fallen back');

    // Verify direct sendMessage was called as fallback
    const directSend = fallbackAgent.calls.find(c => c.method === 'sendMessage' && c.text === 'test fallback');
    assert.ok(directSend, 'fallback should call agent.sendMessage directly');
  });

  it('gateway agent error returns error text without throwing', async () => {
    // Verify the gateway handles internal agent errors gracefully
    const errAgent = {
      sendMessage() {},
      recordEvent() {},
      async *runStream() { throw new Error('provider down'); },
    };
    const errGw = new ChannelGateway({ agent: errAgent });

    // ingest() should NOT throw — it catches the error internally
    const result = await errGw.ingest({
      id: 'r1', channel: 'scheduler', channelId: 'r1',
      sender: { id: 'scheduler', name: 'Cron' },
      content: 'run', attachments: [], timestamp: Date.now(),
    }, 'scheduler:r1');

    assert.ok(result.includes('Error'), 'should return error text, not throw');
    assert.ok(result.includes('provider down'));
    errGw.destroy();
  });

  it('routine with missing prompt uses routine name', async () => {
    engine = new RoutineEngine({
      executeFn: async (routine) => {
        const prompt = routine.action?.prompt || routine.name || 'routine';
        return gw.ingest({
          id: `routine_${routine.id}_${Date.now()}`,
          channel: 'scheduler',
          channelId: routine.id,
          sender: { id: 'scheduler', name: routine.name, username: null },
          content: prompt,
          attachments: [],
          replyTo: null,
          timestamp: Date.now(),
        }, `scheduler:${routine.id}`);
      },
    });

    const { id } = engine.addRoutine({
      name: 'Cleanup',
      trigger: { type: TRIGGER_TYPES.MANUAL },
      // No action.prompt — should fall back to routine.name
    });

    await engine.triggerManual(id);

    const sendCall = agent.calls.find(c => c.method === 'sendMessage');
    assert.ok(sendCall.text.includes('Cleanup'));
  });
});

// ── Agent event recording ───────────────────────────────────────

describe('Gateway → Agent event recording', () => {
  it('records channel_inbound with tenantId', async () => {
    const agent = mockAgent('ok');
    const gw = new ChannelGateway({ agent, tenantId: 'tenant_42' });

    await gw.ingest({
      id: 'msg_1', channel: 'scheduler',
      sender: { id: 'scheduler', name: 'Cron' },
      content: 'run', attachments: [], timestamp: Date.now(),
    }, 'scheduler:cron1');

    const inbound = agent.events.find(e => e.type === 'channel_inbound');
    assert.ok(inbound);
    assert.equal(inbound.data.tenantId, 'tenant_42');
    assert.equal(inbound.data.channelId, 'scheduler:cron1');
    assert.equal(inbound.data.channel, 'scheduler');
    assert.equal(inbound.data.sender.name, 'Cron');
    assert.equal(inbound.source, 'user');

    const outbound = agent.events.find(e => e.type === 'channel_outbound');
    assert.ok(outbound);
    assert.equal(outbound.data.channelId, 'scheduler:cron1');
    assert.equal(outbound.source, 'agent');
    gw.destroy();
  });

  it('records events even when agent has no runStream', async () => {
    const agent = {
      calls: [],
      events: [],
      sendMessage(text, opts) { this.calls.push({ method: 'sendMessage', text, opts }); },
      recordEvent(type, data, source) { this.events.push({ type, data, source }); },
      async run() { return { data: 'sync result' }; },
    };

    const gw = new ChannelGateway({ agent, tenantId: 'tenant_99' });

    await gw.ingest({
      id: 'msg_1', channel: 'test',
      sender: { id: '1', name: 'X' },
      content: 'hi', attachments: [], timestamp: Date.now(),
    }, 'test');

    assert.equal(agent.events.filter(e => e.type === 'channel_inbound').length, 1);
    assert.equal(agent.events.filter(e => e.type === 'channel_outbound').length, 1);
    gw.destroy();
  });
});

// ── CHANNEL_COLORS constant coverage ────────────────────────────

describe('CHANNEL_COLORS scheduler entry', () => {
  it('scheduler color is a valid hex string', () => {
    assert.ok(CHANNEL_COLORS.scheduler);
    assert.match(CHANNEL_COLORS.scheduler, /^#[0-9A-Fa-f]{6}$/);
  });

  it('all color values are valid hex', () => {
    for (const [key, value] of Object.entries(CHANNEL_COLORS)) {
      assert.match(value, /^#[0-9A-Fa-f]{6}$/, `${key} should be a valid hex color`);
    }
  });
});

// ── Gateway error resilience ────────────────────────────────────

describe('Gateway error resilience', () => {
  it('agent error during ingest still returns error text', async () => {
    const gw = new ChannelGateway({ agent: failingAgent() });

    const result = await gw.ingest({
      id: 'msg_1', channel: 'test',
      sender: { id: '1', name: 'A' },
      content: 'hi', attachments: [], timestamp: Date.now(),
    }, 'test');

    assert.ok(result.includes('Error'));
    assert.ok(result.includes('provider unavailable'));
    gw.destroy();
  });

  it('multiple channels survive one channel erroring', async () => {
    let callCount = 0;
    const agent = {
      sendMessage() {},
      recordEvent() {},
      async *runStream() {
        callCount++;
        if (callCount === 1) throw new Error('ch1 fails');
        yield { type: 'done', response: { data: 'ch2 ok' } };
      },
    };

    const gw = new ChannelGateway({ agent });

    const msg = (ch) => ({
      id: `m_${ch}`, channel: ch,
      sender: { id: '1', name: 'X' },
      content: 'test', attachments: [], timestamp: Date.now(),
    });

    const [r1, r2] = await Promise.all([
      gw.ingest(msg('ch1'), 'ch1'),
      gw.ingest(msg('ch2'), 'ch2'),
    ]);

    assert.ok(r1.includes('Error'), 'ch1 should have error');
    assert.equal(r2, 'ch2 ok', 'ch2 should succeed independently');
    gw.destroy();
  });

  it('agent error still fires onRespond with error text', async () => {
    let responded = null;
    const gw = new ChannelGateway({
      agent: failingAgent(),
      onRespond: (ch, text) => { responded = { ch, text }; },
    });

    await gw.ingest({
      id: 'msg_1', channel: 'test',
      sender: { id: '1', name: 'A' },
      content: 'hi', attachments: [], timestamp: Date.now(),
    }, 'test');

    assert.ok(responded, 'onRespond should fire even on error');
    assert.ok(responded.text.includes('Error'));
    gw.destroy();
  });
});
