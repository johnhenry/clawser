// Sprint 21 — isomorphic-git Backend + Repo Auto-Init + FTS + Embedding API + Message Protocol + Cross-tab Tools
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

// ── 1. isomorphic-git backend (5 tests) ─────────────────────────

describe('isomorphic-git backend', () => {
  let GitOpsProvider, MockGitBackend, GitBehavior;

  before(async () => {
    const mod = await import('../clawser-git.js');
    GitOpsProvider = mod.GitOpsProvider;
    MockGitBackend = mod.MockGitBackend;
    GitBehavior = mod.GitBehavior;
  });

  it('GitOpsProvider interface class exists', () => {
    assert.ok(GitOpsProvider);
  });

  it('MockGitBackend implements all required ops', () => {
    const backend = new MockGitBackend();
    assert.equal(typeof backend.status, 'function');
    assert.equal(typeof backend.add, 'function');
    assert.equal(typeof backend.commit, 'function');
    assert.equal(typeof backend.log, 'function');
    assert.equal(typeof backend.diff, 'function');
    assert.equal(typeof backend.branch, 'function');
    assert.equal(typeof backend.checkout, 'function');
    assert.equal(typeof backend.merge, 'function');
  });

  it('MockGitBackend commit returns a SHA', async () => {
    const backend = new MockGitBackend();
    const sha = await backend.commit('test commit', { name: 'test', email: 'test@test.com' });
    assert.equal(typeof sha, 'string');
    assert.ok(sha.length >= 7);
  });

  it('MockGitBackend log returns committed entries', async () => {
    const backend = new MockGitBackend();
    await backend.commit('first commit', { name: 'a', email: 'a@a.com' });
    await backend.commit('second commit', { name: 'a', email: 'a@a.com' });
    const log = await backend.log(10);
    assert.equal(log.length, 2);
    assert.ok(log[0].message.includes('second commit'));
  });

  it('GitBehavior works with MockGitBackend', async () => {
    const backend = new MockGitBackend();
    const behavior = new GitBehavior({ ops: backend });
    const sha = await behavior.checkpoint('test checkpoint');
    assert.ok(sha);
    const logEntries = await behavior.log();
    assert.ok(logEntries.length > 0);
  });
});

// ── 2. Repository auto-init (5 tests) ───────────────────────────

describe('Repository auto-init', () => {
  let AutoInitManager, MockGitBackend;

  before(async () => {
    const mod = await import('../clawser-git.js');
    AutoInitManager = mod.AutoInitManager;
    MockGitBackend = mod.MockGitBackend;
  });

  it('AutoInitManager class exists', () => {
    assert.ok(AutoInitManager);
  });

  it('ensureRepo initializes if not initialized', async () => {
    const backend = new MockGitBackend();
    const mgr = new AutoInitManager({ backend });
    const result = await mgr.ensureRepo();
    assert.equal(result.initialized, true);
  });

  it('ensureRepo returns existing if already initialized', async () => {
    const backend = new MockGitBackend();
    const mgr = new AutoInitManager({ backend });
    await mgr.ensureRepo();
    const result = await mgr.ensureRepo();
    assert.equal(result.initialized, false);
    assert.equal(result.alreadyExists, true);
  });

  it('onWrite triggers auto-init and commit', async () => {
    const backend = new MockGitBackend();
    const mgr = new AutoInitManager({ backend, autoCommit: true });
    await mgr.onWrite('test.txt', 'file content');
    const log = await backend.log(10);
    assert.ok(log.length > 0);
  });

  it('isInitialized returns correct state', async () => {
    const backend = new MockGitBackend();
    const mgr = new AutoInitManager({ backend });
    assert.equal(mgr.isInitialized, false);
    await mgr.ensureRepo();
    assert.equal(mgr.isInitialized, true);
  });
});

// ── 3. Full-text search for commit messages (5 tests) ───────────

describe('FTS commit search', () => {
  let CommitSearchIndex;

  before(async () => {
    const mod = await import('../clawser-git.js');
    CommitSearchIndex = mod.CommitSearchIndex;
  });

  it('CommitSearchIndex class exists', () => {
    assert.ok(CommitSearchIndex);
  });

  it('indexes commit messages', () => {
    const index = new CommitSearchIndex();
    index.add({ oid: 'abc123', message: 'fix login page bug', timestamp: 1000 });
    index.add({ oid: 'def456', message: 'add new feature for users', timestamp: 2000 });
    assert.equal(index.size, 2);
  });

  it('searches by keyword', () => {
    const index = new CommitSearchIndex();
    index.add({ oid: 'a1', message: 'fix login page bug', timestamp: 1000 });
    index.add({ oid: 'a2', message: 'update CSS styles', timestamp: 2000 });
    index.add({ oid: 'a3', message: 'fix navigation bug', timestamp: 3000 });
    const results = index.search('fix');
    assert.equal(results.length, 2);
  });

  it('ranks by relevance (more matches = higher score)', () => {
    const index = new CommitSearchIndex();
    index.add({ oid: 'a1', message: 'fix bug', timestamp: 1000 });
    index.add({ oid: 'a2', message: 'fix critical bug fix', timestamp: 2000 });
    const results = index.search('fix');
    assert.ok(results.length >= 1);
    // a2 has 'fix' twice → higher score
    assert.equal(results[0].oid, 'a2');
  });

  it('supports multi-word search', () => {
    const index = new CommitSearchIndex();
    index.add({ oid: 'a1', message: 'add user authentication', timestamp: 1000 });
    index.add({ oid: 'a2', message: 'fix user profile page', timestamp: 2000 });
    index.add({ oid: 'a3', message: 'update CSS theme', timestamp: 3000 });
    const results = index.search('user profile');
    assert.ok(results.length >= 1);
    assert.equal(results[0].oid, 'a2'); // both words match
  });
});

// ── 4. Embedding API (5 tests) ──────────────────────────────────

describe('Embedding API', () => {
  let ClawserEmbed;

  before(async () => {
    const mod = await import('../clawser-embed.js');
    ClawserEmbed = mod.ClawserEmbed;
  });

  it('ClawserEmbed class exists', () => {
    assert.ok(ClawserEmbed);
  });

  it('creates instance with config', () => {
    const embed = new ClawserEmbed({
      containerId: 'agent-container',
      provider: 'openai',
      model: 'gpt-4o',
    });
    assert.equal(embed.config.containerId, 'agent-container');
    assert.equal(embed.config.provider, 'openai');
  });

  it('exposes sendMessage API', () => {
    const embed = new ClawserEmbed({ containerId: 'test' });
    assert.equal(typeof embed.sendMessage, 'function');
  });

  it('exposes on/off event API', () => {
    const embed = new ClawserEmbed({ containerId: 'test' });
    assert.equal(typeof embed.on, 'function');
    assert.equal(typeof embed.off, 'function');
  });

  it('emits events via on()', async () => {
    const embed = new ClawserEmbed({ containerId: 'test' });
    const received = [];
    embed.on('message', (msg) => received.push(msg));
    embed.emit('message', { content: 'hello' });
    assert.equal(received.length, 1);
    assert.equal(received[0].content, 'hello');
  });
});

// ── 5. Tab↔SharedWorker message protocol (5 tests) ──────────────

describe('SharedWorker message protocol', () => {
  let WorkerProtocol;

  before(async () => {
    const mod = await import('../clawser-daemon.js');
    WorkerProtocol = mod.WorkerProtocol;
  });

  it('WorkerProtocol class exists', () => {
    assert.ok(WorkerProtocol);
  });

  it('encodes user_message correctly', () => {
    const msg = WorkerProtocol.encode('user_message', { text: 'hello', conversationId: 'c1' });
    assert.equal(msg.type, 'user_message');
    assert.equal(msg.payload.text, 'hello');
    assert.ok(msg.id);
    assert.ok(msg.timestamp);
  });

  it('encodes stream_chunk correctly', () => {
    const msg = WorkerProtocol.encode('stream_chunk', { content: 'token', done: false });
    assert.equal(msg.type, 'stream_chunk');
    assert.equal(msg.payload.content, 'token');
    assert.equal(msg.payload.done, false);
  });

  it('decodes encoded message', () => {
    const encoded = WorkerProtocol.encode('state', { busy: true, model: 'gpt-4o' });
    const decoded = WorkerProtocol.decode(encoded);
    assert.equal(decoded.type, 'state');
    assert.equal(decoded.payload.busy, true);
  });

  it('validates message types', () => {
    assert.ok(WorkerProtocol.isValid(WorkerProtocol.encode('user_message', {})));
    assert.equal(WorkerProtocol.isValid({ type: 'unknown_type', payload: {} }), false);
    assert.equal(WorkerProtocol.isValid(null), false);
    assert.equal(WorkerProtocol.isValid('string'), false);
  });
});

// ── 6. Cross-tab tool invocation (5 tests) ──────────────────────

describe('Cross-tab tool invocation', () => {
  let CrossTabToolBridge;

  before(async () => {
    const mod = await import('../clawser-daemon.js');
    CrossTabToolBridge = mod.CrossTabToolBridge;
  });

  it('CrossTabToolBridge class exists', () => {
    assert.ok(CrossTabToolBridge);
  });

  it('registers tools for cross-tab access', () => {
    const bridge = new CrossTabToolBridge({ channel: { postMessage() {}, close() {} } });
    bridge.registerTool('fetch_url', async (args) => ({ success: true, output: 'data' }));
    const tools = bridge.listTools();
    assert.ok(tools.includes('fetch_url'));
  });

  it('unregisters tools', () => {
    const bridge = new CrossTabToolBridge({ channel: { postMessage() {}, close() {} } });
    bridge.registerTool('temp_tool', async () => ({ success: true, output: '' }));
    assert.ok(bridge.listTools().includes('temp_tool'));
    bridge.unregisterTool('temp_tool');
    assert.ok(!bridge.listTools().includes('temp_tool'));
  });

  it('invokes registered tool locally', async () => {
    const bridge = new CrossTabToolBridge({ channel: { postMessage() {}, close() {} } });
    bridge.registerTool('greet', async (args) => ({ success: true, output: `Hello ${args.name}` }));
    const result = await bridge.invoke('greet', { name: 'World' });
    assert.equal(result.success, true);
    assert.equal(result.output, 'Hello World');
  });

  it('returns error for unregistered tool', async () => {
    const bridge = new CrossTabToolBridge({ channel: { postMessage() {}, close() {} } });
    const result = await bridge.invoke('nonexistent', {});
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found'));
  });
});
