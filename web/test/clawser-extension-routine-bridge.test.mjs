// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-extension-routine-bridge.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// A minimal but real window stub — needs actual addEventListener/postMessage
// dispatch (not no-ops) since these tests simulate the extension's content.js
// relaying messages in both directions.
const listeners = new Set();
const posted = [];
globalThis.window = {
  addEventListener: (type, fn) => { if (type === 'message') listeners.add(fn); },
  removeEventListener: (type, fn) => { if (type === 'message') listeners.delete(fn); },
  postMessage: (data) => { posted.push(data); },
};

function dispatchIncoming(data) {
  for (const fn of listeners) fn({ source: globalThis.window, data });
}

const { initExtensionRoutineBridge, notifyWorkspaceReady } = await import('../clawser-extension-routine-bridge.js');

describe('notifyWorkspaceReady', () => {
  beforeEach(() => { posted.length = 0; });

  it('posts a workspace_ready notify message', () => {
    notifyWorkspaceReady('ws-123');
    assert.equal(posted.length, 1);
    assert.deepEqual(posted[0], {
      type: '__clawser_ext__',
      direction: 'notify',
      action: 'workspace_ready',
      wsId: 'ws-123',
    });
  });
});

describe('initExtensionRoutineBridge', () => {
  let teardown;
  let routineEngine;
  let triggerCalls;

  beforeEach(() => {
    posted.length = 0;
    triggerCalls = [];
    routineEngine = {
      triggerManual: async (id) => {
        triggerCalls.push(id);
        if (id === 'fails') throw new Error('boom');
        return 'ok';
      },
    };
    teardown = initExtensionRoutineBridge({ routineEngine, onLog: () => {} });
  });

  afterEach(() => { teardown(); });

  it('runs the routine via RoutineEngine.triggerManual and reports success', async () => {
    dispatchIncoming({ type: '__clawser_ext__', direction: 'push', action: 'execute_routine', routineId: 'r1' });
    await new Promise((r) => setTimeout(r, 10));

    assert.deepEqual(triggerCalls, ['r1']);
    assert.equal(posted.length, 1);
    assert.deepEqual(posted[0], {
      type: '__clawser_ext__',
      direction: 'notify',
      action: 'routine_executed',
      routineId: 'r1',
      success: true,
      error: null,
    });
  });

  it('reports failure when triggerManual throws, instead of silently dropping it', async () => {
    dispatchIncoming({ type: '__clawser_ext__', direction: 'push', action: 'execute_routine', routineId: 'fails' });
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(posted.length, 1);
    assert.equal(posted[0].success, false);
    assert.equal(posted[0].error, 'boom');
  });

  it('ignores messages with the wrong type/direction/action', async () => {
    dispatchIncoming({ type: 'something-else', direction: 'push', action: 'execute_routine', routineId: 'r1' });
    dispatchIncoming({ type: '__clawser_ext__', direction: 'request', action: 'execute_routine', routineId: 'r1' });
    dispatchIncoming({ type: '__clawser_ext__', direction: 'push', action: 'not_execute_routine', routineId: 'r1' });
    await new Promise((r) => setTimeout(r, 10));

    assert.deepEqual(triggerCalls, []);
    assert.equal(posted.length, 0);
  });

  it('ignores messages from a different window (source check)', async () => {
    for (const fn of listeners) {
      fn({ source: {}, data: { type: '__clawser_ext__', direction: 'push', action: 'execute_routine', routineId: 'r1' } });
    }
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(triggerCalls, []);
  });

  it('teardown stops responding to further pushes', async () => {
    teardown();
    dispatchIncoming({ type: '__clawser_ext__', direction: 'push', action: 'execute_routine', routineId: 'r1' });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(triggerCalls, []);
  });

  it('does nothing (and returns a no-op teardown) when routineEngine is missing', () => {
    const noop = initExtensionRoutineBridge({ routineEngine: null });
    assert.doesNotThrow(() => noop());
  });
});
