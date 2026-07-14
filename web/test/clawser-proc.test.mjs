/**
 * Tests for clawser-proc.js — Virtual /proc and /run filesystem layer.
 */
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-proc.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProcFileHandler,
  VirtualFs,
  registerProcGenerators,
  registerRunGenerators,
} from '../clawser-proc.js';

// ── Mock helpers ────────────────────────────────────────────────────

class MockToolRegistry {
  #tools = new Map();
  #permissions = new Map();

  register(name, perm, desc) {
    this.#tools.set(name, { name, description: desc, parameters: {} });
    this.#permissions.set(name, perm);
  }

  allSpecs() {
    return [...this.#tools.values()].map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  getPermission(name) { return this.#permissions.get(name) || 'auto'; }
  names() { return [...this.#tools.keys()]; }
}

class MockCostTracker {
  #records = [];

  recordCost(model, tokens, costCents) {
    this.#records.push({ model, tokens, costCents, ts: Date.now() });
  }

  getRecords() { return this.#records.slice(); }

  getPerModelBreakdown() {
    const byModel = {};
    for (const r of this.#records) {
      if (!byModel[r.model]) byModel[r.model] = { costCents: 0, totalTokens: 0, calls: 0 };
      byModel[r.model].costCents += r.costCents;
      byModel[r.model].totalTokens += r.tokens.input_tokens + r.tokens.output_tokens;
      byModel[r.model].calls += 1;
    }
    return byModel;
  }
}

class MockMemory {
  #size = 0;
  constructor(size) { this.#size = size; }
  get size() { return this.#size; }
}

class MockDaemonState {
  #phase = 'running';
  constructor(phase) { this.#phase = phase; }
  get phase() { return this.#phase; }
}

class MockTabCoordinator {
  #tabId;
  #tabs;
  constructor(tabId = 'tab_test1', tabs = []) {
    this.#tabId = tabId;
    this.#tabs = tabs;
  }
  get tabId() { return this.#tabId; }
  get activeTabs() {
    return [
      { tabId: this.#tabId, lastSeen: Date.now() },
      ...this.#tabs,
    ];
  }
}

class MockFs {
  #files = new Map();
  #dirs = new Set(['/']);

  seed(path, content) { this.#files.set(path, content); }

  async readFile(path) {
    if (!this.#files.has(path)) throw new Error(`ENOENT: ${path}`);
    return this.#files.get(path);
  }

  async writeFile(path, content) { this.#files.set(path, content); }

  async listDir(path) {
    const prefix = path.endsWith('/') ? path : path + '/';
    const entries = [];
    const seen = new Set();
    for (const key of this.#files.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const name = rest.split('/')[0];
        if (!seen.has(name)) {
          seen.add(name);
          entries.push({ name, kind: rest.includes('/') ? 'directory' : 'file' });
        }
      }
    }
    return entries;
  }

  async mkdir() {}
  async delete() {}
  async stat(path) {
    if (this.#files.has(path)) return { kind: 'file', size: this.#files.get(path).length };
    return null;
  }
}

// ── ProcFileHandler Tests ───────────────────────────────────────────

describe('ProcFileHandler', () => {
  let handler;

  beforeEach(() => {
    handler = new ProcFileHandler();
  });

  describe('register/handles/readFile', () => {
    it('registers and reads a virtual file', async () => {
      handler.register('/proc/clawser/test', () => 'hello\n');
      assert.ok(handler.handles('/proc/clawser/test'));
      assert.strictEqual(await handler.readFile('/proc/clawser/test'), 'hello\n');
    });

    it('handles async generators', async () => {
      handler.register('/proc/async', async () => 'async content\n');
      assert.strictEqual(await handler.readFile('/proc/async'), 'async content\n');
    });

    it('throws ENOENT for unregistered paths', async () => {
      await assert.rejects(() => handler.readFile('/proc/nonexistent'), /ENOENT/);
    });

    it('handles parent directory of registered file', () => {
      handler.register('/proc/clawser/tools', () => 'data');
      assert.ok(handler.handles('/proc/clawser'));
      assert.ok(handler.handles('/proc'));
    });

    it('does not handle completely unrelated paths', () => {
      handler.register('/proc/clawser/tools', () => 'data');
      assert.ok(!handler.handles('/etc/config'));
      assert.ok(!handler.handles('/home'));
    });
  });

  describe('unregister', () => {
    it('removes a registered generator', async () => {
      handler.register('/proc/clawser/test', () => 'data');
      handler.unregister('/proc/clawser/test');
      assert.ok(!handler.handles('/proc/clawser/test'));
    });
  });

  describe('listDir', () => {
    it('lists direct children', () => {
      handler.register('/proc/clawser/tools', () => '');
      handler.register('/proc/clawser/metrics', () => '');
      handler.register('/proc/clawser/health', () => '');
      const entries = handler.listDir('/proc/clawser');
      assert.strictEqual(entries.length, 3);
      assert.ok(entries.every(e => e.kind === 'file'));
      const names = entries.map(e => e.name);
      assert.ok(names.includes('tools'));
      assert.ok(names.includes('metrics'));
      assert.ok(names.includes('health'));
    });

    it('marks nested paths as directories', () => {
      handler.register('/proc/clawser/tools', () => '');
      handler.register('/run/clawser/tabs/tab1', () => '');
      const entries = handler.listDir('/run/clawser');
      const tabsEntry = entries.find(e => e.name === 'tabs');
      assert.ok(tabsEntry);
      assert.strictEqual(tabsEntry.kind, 'directory');
    });

    it('lists top-level /proc entries', () => {
      handler.register('/proc/clawser/tools', () => '');
      handler.register('/proc/clawser/uptime', () => '');
      const entries = handler.listDir('/proc');
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].name, 'clawser');
      assert.strictEqual(entries[0].kind, 'directory');
    });

    it('returns sorted entries', () => {
      handler.register('/proc/clawser/zebra', () => '');
      handler.register('/proc/clawser/alpha', () => '');
      handler.register('/proc/clawser/middle', () => '');
      const entries = handler.listDir('/proc/clawser');
      assert.deepStrictEqual(entries.map(e => e.name), ['alpha', 'middle', 'zebra']);
    });
  });

  describe('paths', () => {
    it('returns all registered paths', () => {
      handler.register('/proc/a', () => '');
      handler.register('/proc/b', () => '');
      assert.deepStrictEqual(handler.paths.sort(), ['/proc/a', '/proc/b']);
    });
  });
});

// ── VirtualFs Tests ─────────────────────────────────────────────────

describe('VirtualFs', () => {
  let mockFs;
  let handler;
  let vfs;

  beforeEach(() => {
    mockFs = new MockFs();
    handler = new ProcFileHandler();
    vfs = new VirtualFs(mockFs, handler);
  });

  it('routes virtual path reads to proc handler', async () => {
    handler.register('/proc/clawser/uptime', () => '42\n');
    const result = await vfs.readFile('/proc/clawser/uptime');
    assert.strictEqual(result, '42\n');
  });

  it('routes non-virtual reads to real FS', async () => {
    mockFs.seed('/home/test.txt', 'real content');
    const result = await vfs.readFile('/home/test.txt');
    assert.strictEqual(result, 'real content');
  });

  it('rejects writes to virtual paths', async () => {
    handler.register('/proc/clawser/tools', () => '');
    await assert.rejects(() => vfs.writeFile('/proc/clawser/tools', 'hack'), /Read-only/);
  });

  it('allows writes to non-virtual paths', async () => {
    await vfs.writeFile('/home/output.txt', 'data');
    assert.strictEqual(await mockFs.readFile('/home/output.txt'), 'data');
  });

  it('lists virtual directory entries', async () => {
    handler.register('/proc/clawser/a', () => '');
    handler.register('/proc/clawser/b', () => '');
    const entries = await vfs.listDir('/proc/clawser');
    assert.strictEqual(entries.length, 2);
  });

  it('falls through to real FS for non-virtual directories', async () => {
    mockFs.seed('/home/file1.txt', 'x');
    const entries = await vfs.listDir('/home');
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].name, 'file1.txt');
  });

  it('stat returns file for virtual files', async () => {
    handler.register('/proc/clawser/version', () => '1.0\n');
    const st = await vfs.stat('/proc/clawser/version');
    assert.strictEqual(st.kind, 'file');
  });

  it('stat returns directory for virtual directories', async () => {
    handler.register('/proc/clawser/tools', () => '');
    const st = await vfs.stat('/proc/clawser');
    assert.strictEqual(st.kind, 'directory');
  });

  it('rejects mkdir on virtual paths', async () => {
    handler.register('/proc/clawser/tools', () => '');
    await assert.rejects(() => vfs.mkdir('/proc/clawser/newdir'), /Read-only/);
  });

  it('rejects delete on virtual paths', async () => {
    handler.register('/proc/clawser/tools', () => '');
    await assert.rejects(() => vfs.delete('/proc/clawser/tools'), /Read-only/);
  });

  it('copy from virtual to real works', async () => {
    handler.register('/proc/clawser/version', () => '0.1.0\n');
    await vfs.copy('/proc/clawser/version', '/home/version.txt');
    assert.strictEqual(await mockFs.readFile('/home/version.txt'), '0.1.0\n');
  });

  it('routes writes to writable virtual files', async () => {
    const writes = [];
    handler.register('/sys/kernel/trace', {
      read: () => 'trace on\n',
      write: (content) => { writes.push(content); return ''; },
    });

    await vfs.writeFile('/sys/kernel/trace', '1');
    assert.deepEqual(writes, ['1']);
    assert.strictEqual(await vfs.readFile('/sys/kernel/trace'), 'trace on\n');
  });

  it('still rejects writes to read-only virtual files', async () => {
    handler.register('/sys/kernel/trace', {
      read: () => '',
      write: () => '',
    });
    handler.register('/sys/kernel/clock', () => '123\n');
    await assert.rejects(() => vfs.writeFile('/sys/kernel/clock', 'x'), /Read-only/);
  });
});

describe('ProcFileHandler writable generators', () => {
  it('supports {read, write} descriptors', async () => {
    const handler = new ProcFileHandler();
    let stored = 'initial';
    handler.register('/sys/kernel/trace', {
      read: () => stored,
      write: (content) => { stored = content; return ''; },
    });

    assert.equal(handler.handles('/sys/kernel/trace'), true);
    assert.equal(handler.canWrite('/sys/kernel/trace'), true);
    assert.equal(await handler.readFile('/sys/kernel/trace'), 'initial');
    await handler.writeFile('/sys/kernel/trace', 'updated');
    assert.equal(await handler.readFile('/sys/kernel/trace'), 'updated');
  });

  it('canWrite is false for function generators and unknown paths', () => {
    const handler = new ProcFileHandler();
    handler.register('/proc/clawser/uptime', () => '1\n');
    assert.equal(handler.canWrite('/proc/clawser/uptime'), false);
    assert.equal(handler.canWrite('/nope'), false);
  });

  it('writeFile throws for non-writable paths', async () => {
    const handler = new ProcFileHandler();
    handler.register('/proc/clawser/uptime', () => '1\n');
    await assert.rejects(() => handler.writeFile('/proc/clawser/uptime', 'x'), /not writable|Read-only/);
  });
});

// ── Proc Generator Tests ────────────────────────────────────────────

describe('registerProcGenerators', () => {
  let handler;
  let toolRegistry;
  let costTracker;
  let memory;
  let daemonState;

  beforeEach(() => {
    handler = new ProcFileHandler();
    toolRegistry = new MockToolRegistry();
    costTracker = new MockCostTracker();
    memory = new MockMemory(15);
    daemonState = new MockDaemonState('running');
  });

  const registerAll = (overrides = {}) => {
    registerProcGenerators(handler, {
      toolRegistry,
      costTracker,
      memory,
      daemonState,
      initTime: 0, // so uptime = performance.now() / 1000
      wsId: 'test-ws',
      ...overrides,
    });
  };

  it('/proc/clawser/version returns version string', async () => {
    registerAll();
    const content = await handler.readFile('/proc/clawser/version');
    assert.strictEqual(content, '0.1.0-beta\n');
  });

  it('/proc/clawser/uptime returns seconds', async () => {
    registerAll({ initTime: performance.now() - 5000 });
    const content = await handler.readFile('/proc/clawser/uptime');
    const seconds = parseInt(content.trim(), 10);
    assert.ok(seconds >= 4 && seconds <= 6, `Expected ~5, got ${seconds}`);
  });

  it('/proc/clawser/tools lists registered tools', async () => {
    toolRegistry.register('browser_fetch', 'network', 'Fetch a URL');
    toolRegistry.register('memory_store', 'write', 'Store memory');
    registerAll();
    const content = await handler.readFile('/proc/clawser/tools');
    const lines = content.trim().split('\n');
    assert.strictEqual(lines.length, 2);
    assert.ok(lines[0].includes('browser_fetch'));
    assert.ok(lines[0].includes('network'));
    assert.ok(lines[0].includes('Fetch a URL'));
    assert.ok(lines[1].includes('memory_store'));
  });

  it('/proc/clawser/metrics returns JSON with cost data', async () => {
    costTracker.recordCost('gpt-4o', { input_tokens: 100, output_tokens: 50 }, 0.5);
    registerAll();
    const content = await handler.readFile('/proc/clawser/metrics');
    const data = JSON.parse(content);
    assert.strictEqual(data.totalCost, 0.5);
    assert.strictEqual(data.totalTokens, 150);
    assert.strictEqual(data.calls, 1);
  });

  it('/proc/clawser/health returns healthy status', async () => {
    toolRegistry.register('test_tool', 'auto', 'Test');
    registerAll();
    const content = await handler.readFile('/proc/clawser/health');
    const data = JSON.parse(content);
    assert.strictEqual(data.status, 'healthy');
    assert.ok(Array.isArray(data.checks));
  });

  it('/proc/clawser/health reports unhealthy on daemon error', async () => {
    daemonState = new MockDaemonState('error');
    registerAll();
    const content = await handler.readFile('/proc/clawser/health');
    const data = JSON.parse(content);
    assert.strictEqual(data.status, 'unhealthy');
  });

  it('/proc/clawser/health reports degraded when no tools', async () => {
    toolRegistry = new MockToolRegistry(); // empty
    registerAll();
    const content = await handler.readFile('/proc/clawser/health');
    const data = JSON.parse(content);
    assert.strictEqual(data.status, 'degraded');
  });

  it('/proc/clawser/memory returns stats', async () => {
    registerAll();
    const content = await handler.readFile('/proc/clawser/memory');
    const data = JSON.parse(content);
    assert.strictEqual(data.count, 15);
  });

  it('/proc/clawser/providers returns fallback when no status', async () => {
    registerAll({ providerStatus: null });
    const content = await handler.readFile('/proc/clawser/providers');
    assert.ok(content.includes('no providers'));
  });

  it('/proc/clawser/providers returns status when provided', async () => {
    registerAll({
      providerStatus: {
        openai: { healthy: true },
        anthropic: { healthy: false, error: 'timeout' },
      },
    });
    const content = await handler.readFile('/proc/clawser/providers');
    assert.ok(content.includes('openai\thealthy'));
    assert.ok(content.includes('anthropic\terror\ttimeout'));
  });

  it('/proc/clawser/agents returns agent list', async () => {
    registerAll({
      agentConfig: [
        { name: 'assistant', provider: 'openai' },
        { name: 'coder', provider: 'anthropic' },
      ],
    });
    const content = await handler.readFile('/proc/clawser/agents');
    assert.ok(content.includes('assistant\topenai'));
    assert.ok(content.includes('coder\tanthropic'));
  });
});

// ── Run Generator Tests ─────────────────────────────────────────────

describe('registerRunGenerators', () => {
  let handler;

  beforeEach(() => {
    handler = new ProcFileHandler();
  });

  it('/run/clawser/pid returns tab ID', async () => {
    const tabCoord = new MockTabCoordinator('tab_abc123');
    registerRunGenerators(handler, { tabCoordinator: tabCoord });
    const content = await handler.readFile('/run/clawser/pid');
    assert.strictEqual(content, 'tab_abc123\n');
  });

  it('/run/clawser/agent.status returns daemon phase', async () => {
    const daemonState = new MockDaemonState('paused');
    registerRunGenerators(handler, { daemonState });
    const content = await handler.readFile('/run/clawser/agent.status');
    assert.strictEqual(content, 'paused\n');
  });

  it('/run/clawser/agent.status returns idle without daemon', async () => {
    registerRunGenerators(handler, {});
    const content = await handler.readFile('/run/clawser/agent.status');
    assert.strictEqual(content, 'idle\n');
  });

  it('/run/clawser/cost.json returns cost breakdown', async () => {
    const costTracker = new MockCostTracker();
    costTracker.recordCost('gpt-4o', { input_tokens: 200, output_tokens: 100 }, 1.5);
    registerRunGenerators(handler, { costTracker });
    const content = await handler.readFile('/run/clawser/cost.json');
    const data = JSON.parse(content);
    assert.strictEqual(data.totalCostCents, 1.5);
    assert.strictEqual(data.sessionCalls, 1);
    assert.ok(data.breakdown['gpt-4o']);
  });

  it('/run/clawser/tabs lists connected tabs', async () => {
    const tabCoord = new MockTabCoordinator('tab_leader', [
      { tabId: 'tab_follower', lastSeen: Date.now() },
    ]);
    registerRunGenerators(handler, { tabCoordinator: tabCoord });
    const content = await handler.readFile('/run/clawser/tabs');
    assert.ok(content.includes('tab_leader'));
    assert.ok(content.includes('tab_follower'));
  });

  it('/run/clawser/tabs without coordinator returns message', async () => {
    registerRunGenerators(handler, {});
    const content = await handler.readFile('/run/clawser/tabs');
    assert.ok(content.includes('no tab coordinator'));
  });
});

// ── Integration: Shell + VirtualFs ──────────────────────────────────

describe('Shell integration with VirtualFs', () => {
  it('ls /proc/clawser/ lists virtual files', async () => {
    const handler = new ProcFileHandler();
    handler.register('/proc/clawser/tools', () => 'tool_data');
    handler.register('/proc/clawser/uptime', () => '100');
    handler.register('/proc/clawser/version', () => '1.0');

    const mockFs = new MockFs();
    const vfs = new VirtualFs(mockFs, handler);

    const entries = await vfs.listDir('/proc/clawser');
    const names = entries.map(e => e.name).sort();
    assert.deepStrictEqual(names, ['tools', 'uptime', 'version']);
  });

  it('cat /proc/clawser/uptime reads virtual content', async () => {
    const handler = new ProcFileHandler();
    handler.register('/proc/clawser/uptime', () => '42\n');

    const mockFs = new MockFs();
    const vfs = new VirtualFs(mockFs, handler);

    const content = await vfs.readFile('/proc/clawser/uptime');
    assert.strictEqual(content, '42\n');
  });
});
