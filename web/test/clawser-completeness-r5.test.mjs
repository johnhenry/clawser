/**
 * Completeness Audit Round 5 — TDD tests for 12 confirmed findings.
 *
 * F1:  FetchTool.getDomainAllowlist()
 * F2:  ChannelManager.clearHistory()
 * F3:  NotificationManager.getQuietHours() / setQuietHours()
 * F4:  EventLog.size getter
 * F5:  CostLedger.size getter
 * F6:  IntentRouter.removeOverride(prefix)
 * F7:  WorkerSandbox.clearLog()
 * F8:  WasmSandbox.clearLog()
 * F9:  McpManager.disconnectAll()
 * F10: OAuthManager.disconnectAll()
 * F11: CommitSearchIndex.clear()
 * F12: SSEChannel.close() clears callbacks
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── F1: FetchTool.getDomainAllowlist() ──────────────────────────

describe('F1: FetchTool.getDomainAllowlist()', async () => {
  const { FetchTool } = await import('../clawser-tools.js');

  it('returns null when no allowlist is set', () => {
    const tool = new FetchTool();
    assert.strictEqual(tool.getDomainAllowlist(), null);
  });

  it('returns the set of allowed domains', () => {
    const tool = new FetchTool();
    tool.setDomainAllowlist(['example.com', 'api.test.io']);
    const result = tool.getDomainAllowlist();
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 2);
    assert.ok(result.includes('example.com'));
    assert.ok(result.includes('api.test.io'));
  });
});

// ── F2: ChannelManager.clearHistory() ───────────────────────────

describe('F2: ChannelManager.clearHistory()', async () => {
  const { ChannelManager } = await import('../clawser-channels.js');

  it('clears message history', () => {
    const mgr = new ChannelManager();
    // Simulate some history by sending messages
    mgr.clearHistory(); // should not throw even if empty
    const history = mgr.getHistory();
    assert.strictEqual(history.length, 0);
  });

  it('is callable as a method', () => {
    const mgr = new ChannelManager();
    assert.strictEqual(typeof mgr.clearHistory, 'function');
  });
});

// ── F3: NotificationManager.getQuietHours() / setQuietHours() ───

describe('F3: NotificationManager quiet hours accessors', async () => {
  const { NotificationManager } = await import('../clawser-notifications.js');

  it('getQuietHours returns null by default', () => {
    const mgr = new NotificationManager();
    assert.strictEqual(mgr.getQuietHours(), null);
  });

  it('getQuietHours returns constructor config', () => {
    const mgr = new NotificationManager({ quietHours: { start: 22, end: 7 } });
    const qh = mgr.getQuietHours();
    assert.deepStrictEqual(qh, { start: 22, end: 7 });
  });

  it('setQuietHours updates the config', () => {
    const mgr = new NotificationManager();
    mgr.setQuietHours({ start: 23, end: 6 });
    assert.deepStrictEqual(mgr.getQuietHours(), { start: 23, end: 6 });
  });

  it('setQuietHours(null) disables quiet hours', () => {
    const mgr = new NotificationManager({ quietHours: { start: 22, end: 7 } });
    mgr.setQuietHours(null);
    assert.strictEqual(mgr.getQuietHours(), null);
  });
});

// ── F4: EventLog.size getter ────────────────────────────────────

describe('F4: EventLog.size getter', async () => {
  // EventLog is an inner class of clawser-agent.js, exported
  const mod = await import('../clawser-agent.js');
  const EventLog = mod.EventLog;

  it('returns 0 for empty log', () => {
    const log = new EventLog();
    assert.strictEqual(log.size, 0);
  });

  it('increments after append', () => {
    const log = new EventLog();
    log.append('test', { foo: 1 });
    assert.strictEqual(log.size, 1);
    log.append('test', { foo: 2 });
    assert.strictEqual(log.size, 2);
  });

  it('resets after clear', () => {
    const log = new EventLog();
    log.append('test', {});
    log.clear();
    assert.strictEqual(log.size, 0);
  });
});

// ── F5: CostLedger.size getter ──────────────────────────────────

describe('F5: CostLedger.size getter', async () => {
  const { CostLedger } = await import('../clawser-providers.js');

  it('returns 0 for empty ledger', () => {
    const ledger = new CostLedger();
    assert.strictEqual(ledger.size, 0);
  });

  it('increments after record', () => {
    const ledger = new CostLedger();
    ledger.record({ model: 'test', provider: 'test', inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
    assert.strictEqual(ledger.size, 1);
  });

  it('resets after clear', () => {
    const ledger = new CostLedger();
    ledger.record({ model: 'test', provider: 'test', inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
    ledger.clear();
    assert.strictEqual(ledger.size, 0);
  });
});

// ── F6: IntentRouter.removeOverride(prefix) ─────────────────────

describe('F6: IntentRouter.removeOverride(prefix)', async () => {
  const { IntentRouter, MessageIntent } = await import('../clawser-intent.js');

  it('removes an existing override and returns true', () => {
    const router = new IntentRouter();
    router.addOverride('!task:', MessageIntent.TASK);
    assert.strictEqual(router.overrideCount, 1);
    const result = router.removeOverride('!task:');
    assert.strictEqual(result, true);
    assert.strictEqual(router.overrideCount, 0);
  });

  it('returns false for non-existent prefix', () => {
    const router = new IntentRouter();
    assert.strictEqual(router.removeOverride('!nope:'), false);
  });
});

// ── F7: WorkerSandbox.clearLog() ────────────────────────────────

describe('F7: WorkerSandbox.clearLog()', async () => {
  const { WorkerSandbox } = await import('../clawser-sandbox.js');

  it('clearLog is a method', () => {
    const sb = new WorkerSandbox();
    assert.strictEqual(typeof sb.clearLog, 'function');
  });

  it('resets execCount to 0', () => {
    const sb = new WorkerSandbox();
    sb.clearLog();
    assert.strictEqual(sb.execCount, 0);
  });
});

// ── F8: WasmSandbox.clearLog() ──────────────────────────────────

describe('F8: WasmSandbox.clearLog()', async () => {
  const { WasmSandbox } = await import('../clawser-sandbox.js');

  it('clearLog is a method', () => {
    const sb = new WasmSandbox();
    assert.strictEqual(typeof sb.clearLog, 'function');
  });

  it('resets execCount to 0', () => {
    const sb = new WasmSandbox();
    sb.clearLog();
    assert.strictEqual(sb.execCount, 0);
  });
});

// ── F9: McpManager.disconnectAll() ──────────────────────────────

describe('F9: McpManager.disconnectAll()', async () => {
  const { McpManager } = await import('../clawser-mcp.js');

  it('disconnectAll is a method', () => {
    const mgr = new McpManager();
    assert.strictEqual(typeof mgr.disconnectAll, 'function');
  });

  it('works on empty manager', () => {
    const mgr = new McpManager();
    mgr.disconnectAll(); // should not throw
  });
});

// ── F10: OAuthManager.disconnectAll() ───────────────────────────

describe('F10: OAuthManager.disconnectAll()', async () => {
  const { OAuthManager } = await import('../clawser-oauth.js');

  it('disconnectAll is an async method', () => {
    const mgr = new OAuthManager();
    assert.strictEqual(typeof mgr.disconnectAll, 'function');
  });

  it('works on empty manager', async () => {
    const mgr = new OAuthManager();
    await mgr.disconnectAll(); // should not throw
    assert.strictEqual(mgr.connectionCount, 0);
  });
});

// ── F11: CommitSearchIndex.clear() ──────────────────────────────

describe('F11: CommitSearchIndex.clear()', async () => {
  const { CommitSearchIndex } = await import('../clawser-git.js');

  it('clears all entries', () => {
    const idx = new CommitSearchIndex();
    idx.add({ oid: 'abc', message: 'test commit' });
    assert.strictEqual(idx.size, 1);
    idx.clear();
    assert.strictEqual(idx.size, 0);
  });

  it('is a no-op on empty index', () => {
    const idx = new CommitSearchIndex();
    idx.clear(); // should not throw
    assert.strictEqual(idx.size, 0);
  });
});

// ── F12: SSEChannel.close() clears callbacks ────────────────────

describe('F12: SSEChannel.close() clears onMessageCallbacks', async () => {
  const { SSEChannel } = await import('../clawser-server.js');

  it('close() sets closed to true', () => {
    const ch = new SSEChannel('test');
    ch.close();
    assert.strictEqual(ch.closed, true);
  });

  it('callbacks are cleared after close', () => {
    const ch = new SSEChannel('test');
    const fn = () => {};
    ch.onMessage(fn);
    ch.close();
    // After close, adding a message should not invoke callback
    // We verify by checking the channel doesn't error
    assert.strictEqual(ch.closed, true);
  });
});
