// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-routines.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RoutineEngine,
  TRIGGER_TYPES,
  ACTION_TYPES,
  resetRoutineCounter,
} from '../clawser-routines.js';

// Reset counter before each describe block
resetRoutineCounter();

// ── HMAC Webhook Signature Verification ────────────────────────

describe('HMAC webhook signature verification', () => {
  it('accepts a valid HMAC-SHA256 signature', async () => {
    resetRoutineCounter();
    const engine = new RoutineEngine({
      executeFn: async () => 'ok',
    });

    engine.addRoutine({
      name: 'webhook-hmac',
      trigger: {
        type: TRIGGER_TYPES.WEBHOOK,
        webhookPath: '/hook/deploy',
        hmacSecret: 'test-secret-key',
      },
    });

    const payload = { action: 'deploy', ref: 'main' };
    const body = JSON.stringify(payload);

    // Compute expected HMAC
    const { createHmac } = await import('node:crypto');
    const sig = createHmac('sha256', 'test-secret-key').update(body).digest('hex');

    const result = await engine.handleWebhook('/hook/deploy', payload, {
      signature: `sha256=${sig}`,
      rawBody: body,
    });

    assert.ok(result, 'should match the webhook routine');
    assert.equal(result.result, 'success');
  });

  it('rejects an invalid HMAC signature', async () => {
    resetRoutineCounter();
    const engine = new RoutineEngine({
      executeFn: async () => 'ok',
    });

    engine.addRoutine({
      name: 'webhook-hmac-reject',
      trigger: {
        type: TRIGGER_TYPES.WEBHOOK,
        webhookPath: '/hook/deploy',
        hmacSecret: 'real-secret',
      },
    });

    const result = await engine.handleWebhook('/hook/deploy', { a: 1 }, {
      signature: 'sha256=badhex',
      rawBody: '{"a":1}',
    });

    assert.ok(result, 'should return a result (not null)');
    assert.equal(result.result, 'signature_invalid', 'should report signature_invalid');
  });

  it('skips HMAC verification when no hmacSecret is configured', async () => {
    resetRoutineCounter();
    const engine = new RoutineEngine({
      executeFn: async () => 'ok',
    });

    engine.addRoutine({
      name: 'webhook-no-hmac',
      trigger: {
        type: TRIGGER_TYPES.WEBHOOK,
        webhookPath: '/hook/open',
      },
    });

    // No signature header, no secret — should execute normally
    const result = await engine.handleWebhook('/hook/open', { data: 'hello' });
    assert.ok(result);
    assert.equal(result.result, 'success');
  });

  it('rejects when hmacSecret is set but no signature provided', async () => {
    resetRoutineCounter();
    const engine = new RoutineEngine({
      executeFn: async () => 'ok',
    });

    engine.addRoutine({
      name: 'webhook-missing-sig',
      trigger: {
        type: TRIGGER_TYPES.WEBHOOK,
        webhookPath: '/hook/secure',
        hmacSecret: 'my-secret',
      },
    });

    const result = await engine.handleWebhook('/hook/secure', { x: 1 });
    assert.ok(result);
    assert.equal(result.result, 'signature_invalid', 'should reject missing signature');
  });
});

// ── routine_history Tool ─────────────────────────────────────────

describe('routine_history tool', () => {
  it('exports RoutineHistoryTool class', async () => {
    const mod = await import('../clawser-routines.js');
    assert.ok(mod.RoutineHistoryTool, 'should export RoutineHistoryTool');
  });

  it('returns execution history for a routine', async () => {
    resetRoutineCounter();
    const { RoutineHistoryTool } = await import('../clawser-routines.js');
    const engine = new RoutineEngine({
      executeFn: async () => 'ok',
    });

    const routine = engine.addRoutine({
      name: 'history-test',
      trigger: { type: TRIGGER_TYPES.EVENT, event: 'test.run' },
    });

    // Run it twice
    await engine.handleEvent('test.run', {});
    await engine.handleEvent('test.run', {});

    const tool = new RoutineHistoryTool(engine);
    const result = await tool.execute({ id: routine.id });
    assert.ok(result.success);
    assert.ok(result.output.includes('2'), 'should show 2 history entries');
  });

  it('returns error for unknown routine', async () => {
    resetRoutineCounter();
    const { RoutineHistoryTool } = await import('../clawser-routines.js');
    const engine = new RoutineEngine();
    const tool = new RoutineHistoryTool(engine);

    const result = await tool.execute({ id: 'nonexistent' });
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it('has correct tool metadata', async () => {
    const { RoutineHistoryTool } = await import('../clawser-routines.js');
    const engine = new RoutineEngine();
    const tool = new RoutineHistoryTool(engine);

    assert.equal(tool.name, 'routine_history');
    assert.ok(tool.description.includes('history'));
    assert.equal(tool.parameters.required[0], 'id');
  });
});

// ── Event Bus Integration ──────────────────────────────────────

describe('Event bus integration', () => {
  it('RoutineEngine exposes a connectEventBus method', () => {
    const engine = new RoutineEngine();
    assert.equal(typeof engine.connectEventBus, 'function');
  });

  it('connectEventBus subscribes to agent events and routes to handleEvent', async () => {
    resetRoutineCounter();
    let handledEvents = [];
    const engine = new RoutineEngine({
      executeFn: async (routine, trigger) => {
        handledEvents.push(trigger);
      },
    });

    engine.addRoutine({
      name: 'on-tool-complete',
      trigger: { type: TRIGGER_TYPES.EVENT, event: 'tool.complete' },
    });

    // Simulate a minimal event bus (EventTarget or {on, emit})
    const bus = new EventTarget();
    engine.connectEventBus(bus);

    // Dispatch event on the bus
    bus.dispatchEvent(new CustomEvent('tool.complete', { detail: { tool: 'fetch' } }));

    // Give async handler time to run
    await new Promise(r => setTimeout(r, 50));

    assert.equal(handledEvents.length, 1, 'should have handled 1 event');
    assert.equal(handledEvents[0].type, 'tool.complete');
    assert.deepEqual(handledEvents[0].payload, { tool: 'fetch' });
  });

  it('disconnectEventBus stops routing events', async () => {
    resetRoutineCounter();
    let count = 0;
    const engine = new RoutineEngine({
      executeFn: async () => { count++; },
    });

    engine.addRoutine({
      name: 'on-msg',
      trigger: { type: TRIGGER_TYPES.EVENT, event: 'message.sent' },
    });

    const bus = new EventTarget();
    engine.connectEventBus(bus);

    bus.dispatchEvent(new CustomEvent('message.sent', { detail: {} }));
    await new Promise(r => setTimeout(r, 50));
    assert.equal(count, 1);

    engine.disconnectEventBus();

    bus.dispatchEvent(new CustomEvent('message.sent', { detail: {} }));
    await new Promise(r => setTimeout(r, 50));
    assert.equal(count, 1, 'should not fire after disconnect');
  });
});
