// Sprint 22 — WebMCP Discovery + Vault Rekeying + Headless Runner + Away Summary + Notification System + Native Messaging
// RED phase: 30 tests, all expected to fail initially.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ── Global polyfills for Node.js environment ────────────────────
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
if (typeof globalThis.location === 'undefined') {
  globalThis.location = { href: 'http://localhost/', origin: 'http://localhost', pathname: '/' };
}
if (typeof globalThis.BroadcastChannel === 'undefined') {
  globalThis.BroadcastChannel = class {
    onmessage = null;
    postMessage() {}
    close() {}
  };
}
if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = globalThis.crypto || {};
  globalThis.crypto.randomUUID = () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── 1. WebMCP tool discovery (5 tests) ──────────────────────────

describe('WebMCP tool discovery', () => {
  let WebMCPDiscovery;

  before(async () => {
    const mod = await import('../clawser-mcp.js');
    WebMCPDiscovery = mod.WebMCPDiscovery;
  });

  it('WebMCPDiscovery class exists', () => {
    assert.ok(WebMCPDiscovery);
  });

  it('parseToolDescriptors extracts tools from metadata', () => {
    const discovery = new WebMCPDiscovery();
    const tools = discovery.parseToolDescriptors({
      tools: [
        { name: 'search', description: 'Search the web', parameters: { query: { type: 'string' } } },
        { name: 'fetch', description: 'Fetch a URL', parameters: { url: { type: 'string' } } },
      ],
    });
    assert.equal(tools.length, 2);
    assert.equal(tools[0].name, 'search');
    assert.equal(tools[1].name, 'fetch');
  });

  it('validates tool descriptor structure', () => {
    const discovery = new WebMCPDiscovery();
    assert.ok(discovery.isValidTool({ name: 'test', description: 'A test', parameters: {} }));
    assert.ok(!discovery.isValidTool({ description: 'missing name' }));
    assert.ok(!discovery.isValidTool(null));
  });

  it('deduplicates tools by name', () => {
    const discovery = new WebMCPDiscovery();
    discovery.addDiscovered([
      { name: 'tool_a', description: 'First', parameters: {}, source: 'page1' },
    ]);
    discovery.addDiscovered([
      { name: 'tool_a', description: 'Duplicate', parameters: {}, source: 'page2' },
      { name: 'tool_b', description: 'Second', parameters: {}, source: 'page2' },
    ]);
    const all = discovery.listDiscovered();
    assert.equal(all.length, 2);
  });

  it('clearDiscovered resets state', () => {
    const discovery = new WebMCPDiscovery();
    discovery.addDiscovered([
      { name: 'temp', description: 'Temp tool', parameters: {}, source: 'page' },
    ]);
    assert.equal(discovery.listDiscovered().length, 1);
    discovery.clearDiscovered();
    assert.equal(discovery.listDiscovered().length, 0);
  });
});

// ── 2. Vault rekeying logic (5 tests) ───────────────────────────

describe('Vault rekeying', () => {
  let VaultRekeyer;

  before(async () => {
    const mod = await import('../clawser-vault.js');
    VaultRekeyer = mod.VaultRekeyer;
  });

  it('VaultRekeyer class exists', () => {
    assert.ok(VaultRekeyer);
  });

  it('plan returns list of secrets to re-encrypt', async () => {
    const mockVault = {
      isLocked: false,
      list: async () => ['apikey-openai', 'apikey-anthropic'],
      retrieve: async (name) => `secret-${name}`,
    };
    const rekeyer = new VaultRekeyer(mockVault);
    const plan = await rekeyer.plan();
    assert.equal(plan.secretCount, 2);
    assert.ok(Array.isArray(plan.secrets));
  });

  it('rejects if vault is locked', async () => {
    const mockVault = { isLocked: true };
    const rekeyer = new VaultRekeyer(mockVault);
    await assert.rejects(() => rekeyer.plan(), /locked/i);
  });

  it('execute re-encrypts all secrets', async () => {
    const stored = {};
    const mockVault = {
      isLocked: false,
      list: async () => ['key1', 'key2'],
      retrieve: async (name) => `value-${name}`,
      store: async (name, value) => { stored[name] = value; },
      unlock: async () => {},
      lock: () => {},
    };
    const rekeyer = new VaultRekeyer(mockVault);
    const result = await rekeyer.execute('old-passphrase', 'new-passphrase');
    assert.equal(result.rekeyed, 2);
    assert.ok(stored.key1);
    assert.ok(stored.key2);
  });

  it('rollsback on failure', async () => {
    let storeCount = 0;
    const mockVault = {
      isLocked: false,
      list: async () => ['key1', 'key2', 'key3'],
      retrieve: async (name) => `value-${name}`,
      store: async (name, value) => {
        storeCount++;
        if (storeCount >= 3) throw new Error('Storage failed');
      },
      unlock: async () => {},
      lock: () => {},
    };
    const rekeyer = new VaultRekeyer(mockVault);
    const result = await rekeyer.execute('old', 'new');
    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});

// ── 3. Headless agent runner (5 tests) ──────────────────────────

describe('Headless agent runner', () => {
  let HeadlessRunner;

  before(async () => {
    const mod = await import('../clawser-daemon.js');
    HeadlessRunner = mod.HeadlessRunner;
  });

  it('HeadlessRunner class exists', () => {
    assert.ok(HeadlessRunner);
  });

  it('loadCheckpoint loads agent state', async () => {
    const state = { history: [{ role: 'user', content: 'hello' }], goals: [] };
    const runner = new HeadlessRunner({
      readFn: async (key) => key === 'checkpoint_latest' ? state : null,
    });
    const loaded = await runner.loadCheckpoint();
    assert.ok(loaded);
    assert.deepEqual(loaded.history, state.history);
  });

  it('returns null when no checkpoint exists', async () => {
    const runner = new HeadlessRunner({
      readFn: async () => null,
    });
    const loaded = await runner.loadCheckpoint();
    assert.equal(loaded, null);
  });

  it('runFromCheckpoint processes pending jobs', async () => {
    const state = {
      history: [{ role: 'system', content: 'You are an agent' }],
      pendingJobs: [{ id: 'j1', task: 'check weather' }],
    };
    let executed = false;
    const runner = new HeadlessRunner({
      readFn: async (key) => key === 'checkpoint_latest' ? state : null,
      writeFn: async () => {},
      executeFn: async (job) => { executed = true; return { success: true }; },
    });
    const result = await runner.runFromCheckpoint();
    assert.ok(result);
    assert.equal(executed, true);
  });

  it('saves checkpoint after execution', async () => {
    const saved = {};
    const runner = new HeadlessRunner({
      readFn: async () => ({ history: [], pendingJobs: [] }),
      writeFn: async (key, val) => { saved[key] = val; },
      executeFn: async () => ({ success: true }),
    });
    await runner.runFromCheckpoint();
    assert.ok(saved.checkpoint_latest !== undefined);
  });
});

// ── 4. Away summary builder (5 tests) ───────────────────────────

describe('Away summary builder', () => {
  let AwaySummaryBuilder;

  before(async () => {
    const mod = await import('../clawser-daemon.js');
    AwaySummaryBuilder = mod.AwaySummaryBuilder;
  });

  it('AwaySummaryBuilder class exists', () => {
    assert.ok(AwaySummaryBuilder);
  });

  it('builds summary from activity log', () => {
    const builder = new AwaySummaryBuilder();
    builder.addEvent({ type: 'job_completed', task: 'weather check', timestamp: Date.now() - 3600000 });
    builder.addEvent({ type: 'goal_updated', goal: 'Monitor alerts', timestamp: Date.now() - 1800000 });
    builder.addEvent({ type: 'error', message: 'API rate limit', timestamp: Date.now() - 900000 });
    const summary = builder.build();
    assert.ok(summary.events.length === 3);
    assert.ok(typeof summary.text === 'string');
    assert.ok(summary.text.length > 0);
  });

  it('returns empty summary when no events', () => {
    const builder = new AwaySummaryBuilder();
    const summary = builder.build();
    assert.equal(summary.events.length, 0);
    assert.equal(summary.text, 'No activity while you were away.');
  });

  it('filters events by time range', () => {
    const builder = new AwaySummaryBuilder();
    const now = Date.now();
    builder.addEvent({ type: 'old', timestamp: now - 100000 });
    builder.addEvent({ type: 'recent', timestamp: now - 5000 });
    const summary = builder.build({ since: now - 10000 });
    assert.equal(summary.events.length, 1);
  });

  it('clear resets events', () => {
    const builder = new AwaySummaryBuilder();
    builder.addEvent({ type: 'test', timestamp: Date.now() });
    assert.equal(builder.eventCount, 1);
    builder.clear();
    assert.equal(builder.eventCount, 0);
  });
});

// ── 5. Notification center (5 tests) ────────────────────────────

describe('Notification center', () => {
  let NotificationCenter;

  before(async () => {
    const mod = await import('../clawser-daemon.js');
    NotificationCenter = mod.NotificationCenter;
  });

  it('NotificationCenter class exists', () => {
    assert.ok(NotificationCenter);
  });

  it('add creates a notification', () => {
    const center = new NotificationCenter();
    center.add({ type: 'info', title: 'Task done', message: 'Job completed' });
    assert.equal(center.count, 1);
    assert.equal(center.unreadCount, 1);
  });

  it('markRead marks specific notification as read', () => {
    const center = new NotificationCenter();
    const id = center.add({ type: 'info', title: 'Test', message: 'Hello' });
    assert.equal(center.unreadCount, 1);
    center.markRead(id);
    assert.equal(center.unreadCount, 0);
    assert.equal(center.count, 1);
  });

  it('markAllRead clears all unread', () => {
    const center = new NotificationCenter();
    center.add({ type: 'info', title: 'A', message: '1' });
    center.add({ type: 'warning', title: 'B', message: '2' });
    center.add({ type: 'error', title: 'C', message: '3' });
    assert.equal(center.unreadCount, 3);
    center.markAllRead();
    assert.equal(center.unreadCount, 0);
  });

  it('list returns notifications newest first', () => {
    const center = new NotificationCenter();
    center.add({ type: 'info', title: 'First', message: '1' });
    center.add({ type: 'info', title: 'Second', message: '2' });
    const list = center.list();
    assert.equal(list[0].title, 'Second');
    assert.equal(list[1].title, 'First');
  });
});

// ── 6. Native messaging protocol (5 tests) ─────────────────────

describe('Native messaging protocol', () => {
  let NativeMessageCodec;

  before(async () => {
    const mod = await import('../clawser-daemon.js');
    NativeMessageCodec = mod.NativeMessageCodec;
  });

  it('NativeMessageCodec class exists', () => {
    assert.ok(NativeMessageCodec);
  });

  it('encodes message with length prefix', () => {
    const encoded = NativeMessageCodec.encode({ type: 'ping', data: 'hello' });
    assert.ok(encoded instanceof Uint8Array);
    // First 4 bytes are little-endian length
    const length = encoded[0] | (encoded[1] << 8) | (encoded[2] << 16) | (encoded[3] << 24);
    assert.equal(length, encoded.length - 4);
  });

  it('decodes length-prefixed message', () => {
    const original = { type: 'pong', data: 'world' };
    const encoded = NativeMessageCodec.encode(original);
    const decoded = NativeMessageCodec.decode(encoded);
    assert.deepEqual(decoded, original);
  });

  it('roundtrip preserves nested objects', () => {
    const msg = { type: 'tool_result', data: { success: true, output: 'hello', nested: { a: 1 } } };
    const encoded = NativeMessageCodec.encode(msg);
    const decoded = NativeMessageCodec.decode(encoded);
    assert.deepEqual(decoded, msg);
  });

  it('throws on invalid input', () => {
    assert.throws(() => NativeMessageCodec.decode(new Uint8Array([0, 0, 0])));
    assert.throws(() => NativeMessageCodec.decode(new Uint8Array([])));
  });
});
