// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-completeness-r3.test.mjs
// Completeness Audit Round 3 — TDD tests (written before implementation)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── F1: NotificationCenter.get(id) ────────────────────────────

import { NotificationCenter } from '../clawser-daemon.js';

describe('NotificationCenter.get', () => {
  let nc;

  beforeEach(() => {
    nc = new NotificationCenter();
  });

  it('returns a notification by ID', () => {
    const id = nc.add({ type: 'info', title: 'Test', message: 'Hello' });
    const n = nc.get(id);
    assert.ok(n);
    assert.equal(n.id, id);
    assert.equal(n.title, 'Test');
    assert.equal(n.message, 'Hello');
  });

  it('returns null for non-existent ID', () => {
    assert.equal(nc.get(999), null);
  });

  it('returns correct notification among many', () => {
    nc.add({ type: 'info', title: 'A', message: 'first' });
    const id2 = nc.add({ type: 'warn', title: 'B', message: 'second' });
    nc.add({ type: 'info', title: 'C', message: 'third' });
    const n = nc.get(id2);
    assert.equal(n.title, 'B');
    assert.equal(n.type, 'warn');
  });
});

// ── F2: InputLockManager.heldLocks() ──────────────────────────

import { InputLockManager } from '../clawser-daemon.js';

describe('InputLockManager.heldLocks', () => {
  it('returns empty array when no locks held', () => {
    const lm = new InputLockManager();
    assert.deepEqual(lm.heldLocks(), []);
  });

  it('returns held lock names after acquire', async () => {
    const lm = new InputLockManager();
    await lm.tryAcquire('res-a');
    await lm.tryAcquire('res-b');
    const locks = lm.heldLocks();
    assert.equal(locks.length, 2);
    assert.ok(locks.includes('res-a'));
    assert.ok(locks.includes('res-b'));
  });

  it('reflects releases', async () => {
    const lm = new InputLockManager();
    await lm.tryAcquire('res-a');
    await lm.tryAcquire('res-b');
    lm.release('res-a');
    const locks = lm.heldLocks();
    assert.equal(locks.length, 1);
    assert.ok(locks.includes('res-b'));
  });
});

// ── F3: SSEChannel.offMessage(fn) ─────────────────────────────

import { SSEChannel } from '../clawser-server.js';

describe('SSEChannel.offMessage', () => {
  it('removes a registered callback', () => {
    const ch = new SSEChannel('test');
    const calls = [];
    const fn = (msg) => calls.push(msg);
    ch.onMessage(fn);
    ch.receive({ type: 'a', data: 'first' });
    assert.equal(calls.length, 1);

    ch.offMessage(fn);
    ch.receive({ type: 'b', data: 'second' });
    assert.equal(calls.length, 1); // Not called again
  });

  it('does not affect other callbacks', () => {
    const ch = new SSEChannel('test');
    const callsA = [];
    const callsB = [];
    const fnA = (msg) => callsA.push(msg);
    const fnB = (msg) => callsB.push(msg);
    ch.onMessage(fnA);
    ch.onMessage(fnB);
    ch.offMessage(fnA);
    ch.receive({ type: 'x', data: 'hello' });
    assert.equal(callsA.length, 0);
    assert.equal(callsB.length, 1);
  });

  it('is no-op for unregistered callback', () => {
    const ch = new SSEChannel('test');
    ch.offMessage(() => {}); // Should not throw
  });
});

// ── F4: BluetoothPeripheral.unsubscribe() ─────────────────────

import { BluetoothPeripheral } from '../clawser-hardware.js';

describe('BluetoothPeripheral.unsubscribe', () => {
  it('has unsubscribe method', () => {
    const bp = new BluetoothPeripheral();
    assert.equal(typeof bp.unsubscribe, 'function');
  });

  it('throws when not connected', async () => {
    const bp = new BluetoothPeripheral();
    await assert.rejects(
      () => bp.unsubscribe('svc-uuid', 'char-uuid'),
      /not connected/i,
    );
  });
});

// ── F5: StuckDetector.resetThresholds() ───────────────────────

import { StuckDetector, DEFAULT_THRESHOLDS } from '../clawser-self-repair.js';

describe('StuckDetector.resetThresholds', () => {
  it('restores default thresholds after modification', () => {
    const detector = new StuckDetector();
    detector.setThresholds({ toolTimeout: 999 });
    assert.equal(detector.thresholds.toolTimeout, 999);

    detector.resetThresholds();
    assert.equal(detector.thresholds.toolTimeout, DEFAULT_THRESHOLDS.toolTimeout);
  });

  it('restores all threshold fields', () => {
    const detector = new StuckDetector();
    detector.setThresholds({
      toolTimeout: 1,
      noProgress: 2,
      loopDetection: 3,
      contextPressure: 0.5,
      consecutiveErrors: 10,
      costRunaway: 99,
    });
    detector.resetThresholds();
    assert.deepEqual(detector.thresholds, { ...DEFAULT_THRESHOLDS });
  });
});

// ── F6: SemanticMemory.update(id, updates) ────────────────────

import { SemanticMemory } from '../clawser-memory.js';

describe('SemanticMemory.update', () => {
  let mem;

  beforeEach(() => {
    mem = new SemanticMemory();
  });

  it('updates content of an existing entry', () => {
    const id = mem.store({ key: 'test', content: 'original', category: 'core' });
    const updated = mem.update(id, { content: 'modified' });
    assert.equal(updated, true);
    assert.equal(mem.get(id).content, 'modified');
  });

  it('updates category of an existing entry', () => {
    const id = mem.store({ key: 'test', content: 'x', category: 'core' });
    mem.update(id, { category: 'learned' });
    assert.equal(mem.get(id).category, 'learned');
  });

  it('does not modify unspecified fields', () => {
    const id = mem.store({ key: 'mykey', content: 'original', category: 'core' });
    mem.update(id, { content: 'changed' });
    assert.equal(mem.get(id).key, 'mykey');
    assert.equal(mem.get(id).category, 'core');
  });

  it('returns false for non-existent ID', () => {
    assert.equal(mem.update('no-such', { content: 'x' }), false);
  });

  it('does not change entry count', () => {
    const id = mem.store({ key: 'a', content: 'b' });
    assert.equal(mem.size, 1);
    mem.update(id, { content: 'c' });
    assert.equal(mem.size, 1);
  });
});

// ── F7: ToolBuilder.demoteTool() ──────────────────────────────

import { ToolBuilder } from '../clawser-tool-builder.js';
import { BrowserToolRegistry } from '../clawser-tools.js';

describe('ToolBuilder.demoteTool', () => {
  it('demotes a trusted tool to untrusted', async () => {
    const registry = new BrowserToolRegistry();
    const sandbox = async (code, input) => ({ success: true, output: 'ok' });
    const builder = new ToolBuilder(registry, sandbox);
    await builder.buildTool({
      name: 'test_tool',
      description: 'A test',
      parameters: { type: 'object', properties: {} },
      code: 'return { success: true, output: "ok" }',
    });
    builder.promoteTool('test_tool');
    const result = builder.demoteTool('test_tool');
    assert.equal(result.success, true);
  });

  it('returns error for non-existent tool', () => {
    const registry = new BrowserToolRegistry();
    const builder = new ToolBuilder(registry);
    const result = builder.demoteTool('no-such');
    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});

// ── F8: ServerManager.clearLogs() ─────────────────────────────

import { ServerManager } from '../clawser-server.js';

describe('ServerManager.clearLogs', () => {
  it('clearLogs is a function', () => {
    const sm = new ServerManager();
    assert.equal(typeof sm.clearLogs, 'function');
  });

  it('clearLogs does not throw on empty logs', () => {
    const sm = new ServerManager();
    sm.clearLogs('nonexistent');
    assert.deepEqual(sm.getLogs('nonexistent'), []);
  });

  it('clearLogs with no args does not throw', () => {
    const sm = new ServerManager();
    sm.clearLogs();
    // Should not throw
  });
});

// ── F9: WorkflowRecorder.fromJSON() ───────────────────────────

import { WorkflowRecorder } from '../clawser-browser-auto.js';

describe('WorkflowRecorder.fromJSON', () => {
  it('imports steps from exported data', () => {
    const recorder = new WorkflowRecorder();
    recorder.addStep({ action: 'navigate', url: 'https://example.com' });
    recorder.addStep({ action: 'click', selector: '#btn' });
    const exported = recorder.export('test-flow');

    const recorder2 = new WorkflowRecorder();
    recorder2.fromJSON(exported);
    assert.equal(recorder2.steps.length, 2);
    assert.equal(recorder2.steps[0].action, 'navigate');
    assert.equal(recorder2.steps[1].action, 'click');
  });

  it('replaces existing steps', () => {
    const recorder = new WorkflowRecorder();
    recorder.addStep({ action: 'scroll' });
    assert.equal(recorder.steps.length, 1);

    recorder.fromJSON({ name: 'imported', steps: [{ action: 'fill', value: 'hello' }] });
    assert.equal(recorder.steps.length, 1);
    assert.equal(recorder.steps[0].action, 'fill');
  });

  it('handles empty steps array', () => {
    const recorder = new WorkflowRecorder();
    recorder.fromJSON({ name: 'empty', steps: [] });
    assert.equal(recorder.steps.length, 0);
  });
});

// ── F10: DelegateManager.cancelAll() ──────────────────────────

import { DelegateManager } from '../clawser-delegate.js';

describe('DelegateManager.cancelAll', () => {
  it('is a function', () => {
    const dm = new DelegateManager({});
    assert.equal(typeof dm.cancelAll, 'function');
  });

  it('returns count of cancelled agents', () => {
    const dm = new DelegateManager({});
    // With no agents, should return 0
    const count = dm.cancelAll();
    assert.equal(count, 0);
  });
});

// ── F11: EmbeddingCache.delete(key) ───────────────────────────
// Note: EmbeddingCache is not exported, so we test via SemanticMemory internals
// We test the pattern through SemanticMemory which uses the cache

describe('EmbeddingCache delete via SemanticMemory', () => {
  it('SemanticMemory exposes clearEmbeddingCache()', () => {
    const mem = new SemanticMemory();
    assert.equal(typeof mem.clearEmbeddingCache, 'function');
  });

  it('clearEmbeddingCache does not throw', () => {
    const mem = new SemanticMemory();
    mem.store({ key: 'test', content: 'hello' });
    mem.clearEmbeddingCache(); // Should not throw
  });
});

// ── F12: PluginLoader.enable() / disable() ────────────────────

import { PluginLoader } from '../clawser-plugins.js';

describe('PluginLoader.enable / disable', () => {
  let loader;

  beforeEach(() => {
    loader = new PluginLoader();
    loader.register({ name: 'test-plugin', version: '1.0.0', tools: [{ name: 't1' }] });
  });

  it('disable() marks a plugin as disabled', () => {
    const result = loader.disable('test-plugin');
    assert.equal(result, true);
    const plugin = loader.get('test-plugin');
    assert.equal(plugin.enabled, false);
  });

  it('enable() marks a plugin as enabled', () => {
    loader.disable('test-plugin');
    const result = loader.enable('test-plugin');
    assert.equal(result, true);
    const plugin = loader.get('test-plugin');
    assert.equal(plugin.enabled, true);
  });

  it('disabled plugin tools excluded from getTools()', () => {
    loader.disable('test-plugin');
    const tools = loader.getTools();
    assert.equal(tools.length, 0);
  });

  it('re-enabled plugin tools included in getTools()', () => {
    loader.disable('test-plugin');
    loader.enable('test-plugin');
    const tools = loader.getTools();
    assert.equal(tools.length, 1);
  });

  it('returns false for non-existent plugin', () => {
    assert.equal(loader.enable('no-such'), false);
    assert.equal(loader.disable('no-such'), false);
  });

  it('plugins are enabled by default', () => {
    const plugin = loader.get('test-plugin');
    assert.equal(plugin.enabled, true);
  });
});
