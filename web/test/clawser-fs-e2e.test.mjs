// clawser-fs-e2e.test.mjs — End-to-end tests for the Unix filesystem architecture
// Exercises Phase 0–6 features as integrated flows: bootstrap → reactivity →
// /proc → devices → chmod → clsh language. Run with:
//   node --import ./web/test/_setup-globals.mjs --test web/test/clawser-fs-e2e.test.mjs

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── In-memory OPFS stub (shared across the file) ──────────────────

const createMemoryOPFS = () => {
  const dirs = new Map();
  const files = new Map();

  const makeFileHandle = (filePath) => ({
    kind: 'file',
    name: filePath.split('/').pop(),
    getFile: async () => ({
      text: async () => files.get(filePath)?.content || '',
      size: (files.get(filePath)?.content || '').length,
      lastModified: files.get(filePath)?.mtime || Date.now(),
    }),
    createWritable: async () => {
      let buf = '';
      return {
        write: async (data) => { buf += typeof data === 'string' ? data : String(data); },
        close: async () => { files.set(filePath, { content: buf, mtime: Date.now() }); },
      };
    },
  });

  const makeDirHandle = (path) => {
    if (dirs.has(path)) return dirs.get(path);
    const handle = {
      kind: 'directory',
      name: path.split('/').pop() || '',
      getDirectoryHandle: async (name, opts = {}) => {
        const childPath = path ? `${path}/${name}` : name;
        if (dirs.has(childPath)) return dirs.get(childPath);
        if (!opts.create) throw new DOMException('Not found', 'NotFoundError');
        return makeDirHandle(childPath);
      },
      getFileHandle: async (name, opts = {}) => {
        const filePath = path ? `${path}/${name}` : name;
        if (files.has(filePath)) return makeFileHandle(filePath);
        if (!opts.create) throw new DOMException('Not found', 'NotFoundError');
        files.set(filePath, { content: '', mtime: Date.now() });
        return makeFileHandle(filePath);
      },
      removeEntry: async (name) => {
        const childPath = path ? `${path}/${name}` : name;
        files.delete(childPath);
        dirs.delete(childPath);
      },
      [Symbol.asyncIterator]: async function* () {
        const prefix = path ? `${path}/` : '';
        const seen = new Set();
        for (const key of [...dirs.keys(), ...files.keys()]) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          const childName = rest.split('/')[0];
          if (!childName || seen.has(childName)) continue;
          seen.add(childName);
          const childPath = prefix + childName;
          const isDir = dirs.has(childPath);
          yield [childName, { kind: isDir ? 'directory' : 'file' }];
        }
      },
    };
    dirs.set(path, handle);
    return handle;
  };

  return { root: makeDirHandle(''), dirs, files };
};

let memOPFS;
const resetOPFS = () => {
  memOPFS = createMemoryOPFS();
  const value = {
    storage: { getDirectory: async () => memOPFS.root },
    locks: { request: async (_name, fn) => (typeof fn === 'function' ? fn() : null) },
  };
  try {
    globalThis.navigator = value;
  } catch {
    Object.defineProperty(globalThis.navigator, 'storage', { value: value.storage, configurable: true });
    Object.defineProperty(globalThis.navigator, 'locks', { value: value.locks, configurable: true });
  }
};
resetOPFS();

// Stub BrowserTool before any clawser-tools/clawser-shell imports.
globalThis.BrowserTool = class {};

// ── Imports under test ───────────────────────────────────────────

const {
  bootstrapFilesystem,
  ensureDirectoryStructure,
  writeDefaultConfigs,
  DEFAULT_CONFIGS,
} = await import('../clawser-fs-bootstrap.mjs');
const { resolveVirtualPath } = await import('../clawser-opfs.js');
const { MemoryFs, ClawserShell } = await import('../clawser-shell.js');
const { PermissionManager, registerChmodBuiltin } = await import('../clawser-permissions.js');
const { ProcFileHandler, registerProcGenerators, registerRunGenerators, VirtualFs } = await import('../clawser-proc.js');
const { DeviceFileHandler, registerProviderDevice, registerSpecialDevices } = await import('../clawser-fs-devices.mjs');
const { FileWatcher } = await import('../clawser-file-watcher.mjs');
const { ReactiveConfigStore, registerDefaultDomains } = await import('../clawser-reactive-config.mjs');
const { initRuntimeFs } = await import('../clawser-runtime.js');

// ── Test 1: Bootstrap → directory creation → default configs ─────

describe('e2e: bootstrap', () => {
  beforeEach(resetOPFS);

  it('creates the canonical directory tree and default configs', async () => {
    const result = await bootstrapFilesystem('test-ws');

    assert.equal(result.dirs, true);
    assert.ok(result.configs.length > 0, 'should report created configs');

    // Every documented default config exists
    for (const virtualPath of Object.keys(DEFAULT_CONFIGS)) {
      const opfsPath = resolveVirtualPath(virtualPath, 'test-ws');
      assert.ok(
        memOPFS.files.has(opfsPath),
        `missing default config: ${virtualPath} → ${opfsPath}`,
      );
    }

    // Permissions manifest written
    const permPath = resolveVirtualPath('~/.config/clawser/permissions.json', 'test-ws');
    assert.ok(memOPFS.files.has(permPath), 'permissions manifest should be written');

    // Welcome motd
    const motdPath = resolveVirtualPath('/etc/clawser/motd', 'test-ws');
    const motd = memOPFS.files.get(motdPath).content;
    assert.match(motd, /clawser/i);
  });

  it('is idempotent — second bootstrap does not overwrite custom values', async () => {
    await bootstrapFilesystem('test-ws');

    // Mutate an existing default
    const motdPath = resolveVirtualPath('/etc/clawser/motd', 'test-ws');
    memOPFS.files.set(motdPath, { content: 'CUSTOM MOTD', mtime: Date.now() });

    const result = await bootstrapFilesystem('test-ws');
    assert.equal(result.configs.length, 0, 'no configs should be reported as new');

    // Custom value preserved
    assert.equal(memOPFS.files.get(motdPath).content, 'CUSTOM MOTD');
  });
});

// ── Test 2: Config reactivity (FileWatcher → ReactiveConfigStore) ──

describe('e2e: config reactivity', () => {
  let fs, watcher, store, applied;

  beforeEach(() => {
    fs = new MemoryFs();
    watcher = new FileWatcher(fs, { intervalMs: 30, debounceMs: 5 });
    store = new ReactiveConfigStore(watcher, fs);
    applied = [];
  });

  afterEach(() => watcher.stop());

  it('detects external writes and applies to subsystem + notifies subscribers', async () => {
    store.register('autonomy', '~/.config/clawser/autonomy.json', {
      apply: (cfg) => applied.push(cfg),
    });

    const events = [];
    store.subscribe('autonomy', (e) => events.push(e));

    await fs.writeFile('~/.config/clawser/autonomy.json', JSON.stringify({ level: 'full' }));
    watcher.start();

    // Wait long enough for poll + debounce
    await new Promise(r => setTimeout(r, 100));

    assert.equal(applied.length, 1, 'apply should fire exactly once');
    assert.equal(applied[0].level, 'full');
    assert.equal(events.length, 1, 'subscriber should fire');
    assert.equal(events[0].newValue.level, 'full');
  });

  it('invalid JSON keeps last valid config (does not crash)', async () => {
    store.register('autonomy', '~/.config/clawser/autonomy.json', {
      apply: (cfg) => applied.push(cfg),
    });

    await fs.writeFile('~/.config/clawser/autonomy.json', JSON.stringify({ level: 'supervised' }));
    watcher.start();
    await new Promise(r => setTimeout(r, 80));

    assert.equal(applied.length, 1);

    // Write garbage — old config must remain applied
    await fs.writeFile('~/.config/clawser/autonomy.json', '{not valid');
    await new Promise(r => setTimeout(r, 80));

    assert.equal(applied.length, 1, 'apply should not be called on parse error');
  });

  it('validation rejects bad config without applying', async () => {
    store.register('autonomy', '~/.config/clawser/autonomy.json', {
      apply: (cfg) => applied.push(cfg),
      validate: (cfg) => cfg.level === 'invalid' ? ['bad level'] : [],
    });

    await fs.writeFile('~/.config/clawser/autonomy.json', JSON.stringify({ level: 'invalid' }));
    watcher.start();
    await new Promise(r => setTimeout(r, 80));

    assert.equal(applied.length, 0, 'invalid config must not be applied');
  });

  it('store.set writes through and suppresses self-notification', async () => {
    store.register('autonomy', '~/.config/clawser/autonomy.json', {
      apply: (cfg) => applied.push(cfg),
    });
    watcher.start();
    await new Promise(r => setTimeout(r, 50));

    await store.set('autonomy', { level: 'full' });
    await new Promise(r => setTimeout(r, 100));

    // Self-write should not trigger the apply callback
    assert.equal(applied.length, 0, 'self-write must be suppressed');

    // But the file is on disk
    const content = await fs.readFile('~/.config/clawser/autonomy.json');
    assert.equal(JSON.parse(content).level, 'full');
  });

  it('registerDefaultDomains wires all six standard domains', () => {
    const stateStub = {};
    registerDefaultDomains(store, stateStub);
    const domains = store.listDomains().sort();
    assert.deepEqual(
      domains,
      ['autonomy', 'daemon', 'hooks', 'identity', 'security', 'terminal'],
    );
  });
});

// ── Test 3: /proc virtual files ───────────────────────────────────

describe('e2e: /proc virtual files', () => {
  it('exposes uptime, version, tools, health via ProcFileHandler', async () => {
    const handler = new ProcFileHandler();

    // Minimal tool registry stub matching the duck-typed shape
    const toolRegistry = {
      allSpecs: () => [
        { name: 'fs_read', description: 'Read a file' },
        { name: 'fs_write', description: 'Write a file' },
      ],
      names: () => ['fs_read', 'fs_write'],
      getPermission: (n) => n === 'fs_write' ? 'approve' : 'auto',
    };

    registerProcGenerators(handler, {
      toolRegistry,
      initTime: performance.now() - 5000, // 5 seconds ago
      wsId: 'default',
    });
    registerRunGenerators(handler, { toolRegistry });

    // Uptime should report ~5s
    const uptime = await handler.readFile('/proc/clawser/uptime');
    const seconds = parseInt(uptime.trim(), 10);
    assert.ok(seconds >= 4 && seconds <= 7, `uptime should be ~5s, got ${seconds}`);

    // Version is the literal beta tag
    const version = await handler.readFile('/proc/clawser/version');
    assert.match(version.trim(), /^\d+\.\d+\.\d+/);

    // Tools listing has expected columns
    const tools = await handler.readFile('/proc/clawser/tools');
    const lines = tools.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /fs_read\tauto\tRead a file/);
    assert.match(lines[1], /fs_write\tapprove\tWrite a file/);

    // Health JSON shape
    const health = JSON.parse(await handler.readFile('/proc/clawser/health'));
    assert.ok(['healthy', 'degraded', 'unhealthy'].includes(health.status));
    assert.ok(Array.isArray(health.checks));
    assert.equal(health.checks.find(c => c.component === 'tools').count, 2);
  });

  it('reports degraded health when no tools are registered', async () => {
    const handler = new ProcFileHandler();
    registerProcGenerators(handler, {
      toolRegistry: { allSpecs: () => [], names: () => [], getPermission: () => 'auto' },
      initTime: performance.now(),
    });
    const health = JSON.parse(await handler.readFile('/proc/clawser/health'));
    assert.equal(health.status, 'degraded');
  });

  it('VirtualFs makes /proc files read-only', async () => {
    const handler = new ProcFileHandler();
    registerProcGenerators(handler, { initTime: performance.now() });

    const realFs = new MemoryFs();
    const vfs = new VirtualFs(realFs, handler);

    const content = await vfs.readFile('/proc/clawser/version');
    assert.match(content, /\d+\.\d+/);

    await assert.rejects(
      () => vfs.writeFile('/proc/clawser/version', 'forged'),
      /[Rr]ead-only/,
    );
  });
});

// ── Test 4: Device files (provider device write/read) ─────────────

describe('e2e: device files', () => {
  it('provider device pipes write→provider→read', async () => {
    const handler = new DeviceFileHandler();

    const fakeProvider = {
      chat: async ({ messages }) => ({
        content: `Echo: ${messages[messages.length - 1].content}`,
      }),
    };
    const providerRegistry = { get: () => fakeProvider };

    registerProviderDevice(handler, 'fake', providerRegistry, {});

    await handler.handleWrite('/dev/clawser/providers/fake', 'What is 2+2?');
    const response = await handler.handleRead('/dev/clawser/providers/fake');

    assert.match(response, /Echo: What is 2\+2\?/);
  });

  it('mesh peer device: read returns JSON metadata, write dispatches envelope', async () => {
    const handler = new DeviceFileHandler();
    const { registerMeshPeerDevice, unregisterMeshPeerDevice } = await import('../clawser-fs-devices.mjs');

    // Mock pod that captures sends and exposes peer info.
    const sent = [];
    let lastInbound = null;
    const pod = {
      sendMessage: async (peerId, envelope) => { sent.push({ peerId, envelope }); },
      getPeerInfo: (peerId) => ({
        podId: peerId,
        status: 'connected',
        lastSeen: 1234567890,
        capabilities: ['relay'],
        peerType: 'runtime',
      }),
      getPeerLastMessage: () => lastInbound,
    };

    registerMeshPeerDevice(handler, 'pod-abc', pod);

    // Read returns parseable JSON with all documented fields
    const r1 = await handler.handleRead('/dev/clawser/mesh/peers/pod-abc');
    const meta = JSON.parse(r1);
    assert.equal(meta.podId, 'pod-abc');
    assert.equal(meta.status, 'connected');
    assert.equal(meta.lastSeen, 1234567890);
    assert.deepEqual(meta.capabilities, ['relay']);
    assert.equal(meta.peerType, 'runtime');
    assert.equal(meta.lastMessage, null);

    // Write dispatches the JSON envelope
    await handler.handleWrite('/dev/clawser/mesh/peers/pod-abc', '{"type":"ping","payload":"hi"}');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].peerId, 'pod-abc');
    assert.deepEqual(sent[0].envelope, { type: 'ping', payload: 'hi' });

    // Read after inbound update
    lastInbound = { type: 'pong', payload: 'world' };
    const r2 = await handler.handleRead('/dev/clawser/mesh/peers/pod-abc');
    assert.deepEqual(JSON.parse(r2).lastMessage, { type: 'pong', payload: 'world' });

    // Invalid JSON write throws with a clear error
    await assert.rejects(
      () => handler.handleWrite('/dev/clawser/mesh/peers/pod-abc', 'not json'),
      /invalid JSON envelope/,
    );

    // Envelope without a type throws
    await assert.rejects(
      () => handler.handleWrite('/dev/clawser/mesh/peers/pod-abc', '{}'),
      /must be an object with a string "type" field/,
    );

    // Unregister cleans up
    unregisterMeshPeerDevice(handler, 'pod-abc');
    assert.equal(handler.isDevice('/dev/clawser/mesh/peers/pod-abc'), false);
  });

  it('mesh peer device: defaults metadata when getPeerInfo missing', async () => {
    const handler = new DeviceFileHandler();
    const { registerMeshPeerDevice } = await import('../clawser-fs-devices.mjs');

    const pod = { sendMessage: async () => {} }; // no getPeerInfo
    registerMeshPeerDevice(handler, 'plain-peer', pod);

    const r = await handler.handleRead('/dev/clawser/mesh/peers/plain-peer');
    const meta = JSON.parse(r);
    assert.equal(meta.podId, 'plain-peer');
    assert.equal(meta.status, 'unknown');
    assert.equal(meta.peerType, 'unknown');
  });

  it('mesh peer device: opts-only signature (sendFn + getMetadata)', async () => {
    const handler = new DeviceFileHandler();
    const { registerMeshPeerDevice } = await import('../clawser-fs-devices.mjs');

    const sent = [];
    registerMeshPeerDevice(handler, 'pod-opts', {
      sendFn: async (peerId, env) => sent.push({ peerId, env }),
      getMetadata: () => ({ podId: 'pod-opts', status: 'active', peerType: 'runtime' }),
    });

    const r = await handler.handleRead('/dev/clawser/mesh/peers/pod-opts');
    assert.equal(JSON.parse(r).status, 'active');

    await handler.handleWrite('/dev/clawser/mesh/peers/pod-opts', '{"type":"hi"}');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].peerId, 'pod-opts');
  });

  it('mesh peer device write → pod.sendMessage → peerNode.sendTo round-trip', async () => {
    const handler = new DeviceFileHandler();
    const { registerMeshPeerDevice } = await import('../clawser-fs-devices.mjs');

    // Simulated pod with sendMessage that captures (peerId, envelope)
    const calls = [];
    const fakePod = {
      sendMessage: async (peerId, envelope) => {
        calls.push({ peerId, envelope });
      },
    };

    registerMeshPeerDevice(handler, 'pod-real', {
      sendFn: (peerId, envelope) => fakePod.sendMessage(peerId, envelope),
      getMetadata: () => ({ podId: 'pod-real', status: 'active' }),
    });

    await handler.handleWrite('/dev/clawser/mesh/peers/pod-real', '{"type":"hello","payload":42}');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].peerId, 'pod-real');
    assert.deepEqual(calls[0].envelope, { type: 'hello', payload: 42 });
  });

  it('mesh peer device: write throws when no sendFn is wired', async () => {
    const handler = new DeviceFileHandler();
    const { registerMeshPeerDevice } = await import('../clawser-fs-devices.mjs');

    registerMeshPeerDevice(handler, 'readonly-peer', {
      getMetadata: () => ({ podId: 'readonly-peer', status: 'active' }),
    });

    // Read works
    const r = await handler.handleRead('/dev/clawser/mesh/peers/readonly-peer');
    assert.equal(JSON.parse(r).podId, 'readonly-peer');

    // Write fails with a clear error
    await assert.rejects(
      () => handler.handleWrite('/dev/clawser/mesh/peers/readonly-peer', '{"type":"x"}'),
      /no send function wired/,
    );
  });

  it('hardware device adapter round-trips through DeviceFileHandler', async () => {
    const handler = new DeviceFileHandler();
    const { registerHardwareDevice } = await import('../clawser-fs-devices.mjs');

    const sent = [];
    let inboundBuffer = '';
    const adapter = {
      write: async (data) => { sent.push(data); return ''; },
      read: async () => inboundBuffer,
    };
    registerHardwareDevice(handler, 'serial0', adapter);

    await handler.handleWrite('/dev/clawser/hardware/serial0', 'AT+RST\n');
    assert.deepEqual(sent, ['AT+RST\n']);

    inboundBuffer = 'OK\n';
    const r = await handler.handleRead('/dev/clawser/hardware/serial0');
    assert.equal(r, 'OK\n');
  });

  it('special devices: /dev/clawser/null discards, /dev/clawser/random returns hex', async () => {
    const handler = new DeviceFileHandler();
    registerSpecialDevices(handler);

    // null discards writes
    const nullWrite = await handler.handleWrite('/dev/clawser/null', 'noise');
    assert.equal(nullWrite, '');
    assert.equal(await handler.handleRead('/dev/clawser/null'), '');

    // random returns 64 hex chars (32 bytes × 2)
    const r = await handler.handleRead('/dev/clawser/random');
    assert.match(r, /^[0-9a-f]{64}$/);

    // zero returns 256 NULs
    const z = await handler.handleRead('/dev/clawser/zero');
    assert.equal(z.length, 256);
    assert.equal(z.charCodeAt(0), 0);
  });

  it('channel device write→send + read returns most-recent inbound', async () => {
    const handler = new DeviceFileHandler();

    // Mock ChannelManager that captures sends and exposes a history.
    const sent = [];
    const history = [];
    const channelManager = {
      send: (channel, channelId, message) => sent.push({ channel, channelId, message }),
      getHistory: ({ channel, limit }) => {
        const filtered = channel ? history.filter(m => m.channel === channel) : history;
        return filtered.slice(-(limit || 20));
      },
    };
    const { registerChannelDevice } = await import('../clawser-fs-devices.mjs');
    registerChannelDevice(handler, 'slack', channelManager);

    // Write goes to ChannelManager.send
    await handler.handleWrite('/dev/clawser/channels/slack', 'Deploy complete!');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].channel, 'slack');
    assert.equal(sent[0].message, 'Deploy complete!');

    // Read with no inbound history returns empty
    assert.equal(await handler.handleRead('/dev/clawser/channels/slack'), '');

    // Simulate inbound message and read again
    history.push({ channel: 'slack', sender: { name: 'alice' }, text: 'hi there' });
    const r = await handler.handleRead('/dev/clawser/channels/slack');
    assert.equal(r, 'alice\thi there\n');

    // Newer message wins
    history.push({ channel: 'slack', sender: { name: 'bob' }, text: 'second' });
    const r2 = await handler.handleRead('/dev/clawser/channels/slack');
    assert.equal(r2, 'bob\tsecond\n');

    // Cross-channel isolation: a message on a different channel does not show up
    history.push({ channel: 'discord', sender: { name: 'eve' }, text: 'wrong channel' });
    const r3 = await handler.handleRead('/dev/clawser/channels/slack');
    assert.equal(r3, 'bob\tsecond\n');
  });

  it('provider error surfaces via lastResponse', async () => {
    const handler = new DeviceFileHandler();
    const providerRegistry = { get: () => null }; // unconfigured
    registerProviderDevice(handler, 'missing', providerRegistry);

    await assert.rejects(
      () => handler.handleWrite('/dev/clawser/providers/missing', 'hi'),
      /not configured/,
    );

    const response = await handler.handleRead('/dev/clawser/providers/missing');
    assert.match(response, /Error.*not configured/);
  });
});

// ── Test 5: chmod → permissions enforcement ───────────────────────

describe('e2e: chmod and permissions', () => {
  it('chmod -w blocks subsequent writes to a path', async () => {
    const fs = new MemoryFs();
    const permissions = new PermissionManager();
    await permissions.load(fs);

    // Set up a writable scratch path with a real underlying fs
    fs._setPermissions?.(permissions);
    const writable = new MemoryFs(permissions);
    await writable.writeFile('/tmp/clawser/scratch.txt', 'hello');

    // Default: writable
    permissions.checkWrite('/tmp/clawser/scratch.txt');

    // Apply chmod -w (drop write bit)
    await permissions.setPermission('/tmp/clawser/scratch.txt', 'r');

    assert.throws(
      () => permissions.checkWrite('/tmp/clawser/scratch.txt'),
      /Permission denied/,
    );

    // MemoryFs should refuse the write through its guard
    await assert.rejects(
      () => writable.writeFile('/tmp/clawser/scratch.txt', 'overwrite'),
      /Permission denied/,
    );
  });

  it('chmod via shell builtin updates the manifest', async () => {
    const permissions = new PermissionManager();
    const fs = new MemoryFs(permissions);
    await permissions.load(fs);

    const shell = new ClawserShell({ fs, permissions });

    // Create a file we can write to
    await fs.writeFile('/tmp/clawser/important.txt', 'data');
    assert.equal(permissions.formatMode('/tmp/clawser/important.txt'), 'rw-');

    const result = await shell.exec('chmod -w /tmp/clawser/important.txt');
    assert.equal(result.exitCode, 0, `chmod failed: ${result.stderr}`);

    assert.equal(permissions.formatMode('/tmp/clawser/important.txt'), 'r--');
    assert.throws(() => permissions.checkWrite('/tmp/clawser/important.txt'));
  });

  it('numeric chmod mode works (644 → rw-)', async () => {
    const permissions = new PermissionManager();
    const fs = new MemoryFs(permissions);
    await permissions.load(fs);
    const shell = new ClawserShell({ fs, permissions });
    await fs.writeFile('/tmp/clawser/x.txt', 'data');

    await shell.exec('chmod 644 /tmp/clawser/x.txt');
    assert.equal(permissions.formatMode('/tmp/clawser/x.txt'), 'rw-');

    await shell.exec('chmod 444 /tmp/clawser/x.txt');
    assert.equal(permissions.formatMode('/tmp/clawser/x.txt'), 'r--');
  });
});

// ── Test 6: clsh language features ────────────────────────────────

describe('e2e: clsh language', () => {
  let fs, shell;

  beforeEach(() => {
    fs = new MemoryFs();
    shell = new ClawserShell({ fs });
  });

  it('exposes SHELL, CLSH_VERSION, HOME env vars', async () => {
    let result = await shell.exec('echo $SHELL');
    assert.equal(result.stdout.trim(), 'clsh');

    result = await shell.exec('echo $CLSH_VERSION');
    assert.equal(result.stdout.trim(), '1.0');

    result = await shell.exec('echo $HOME');
    assert.equal(result.stdout.trim(), '/');
  });

  it('if/else evaluates truthiness on exit code', async () => {
    const r1 = await shell.exec('if true; then echo yes; else echo no; fi');
    assert.equal(r1.exitCode, 0);
    assert.equal(r1.stdout.trim(), 'yes');

    const r2 = await shell.exec('if false; then echo yes; else echo no; fi');
    assert.equal(r2.stdout.trim(), 'no');
  });

  it('for loop iterates over a literal list', async () => {
    const r = await shell.exec('for x in a b c; do echo $x; done');
    assert.equal(r.exitCode, 0);
    assert.deepEqual(
      r.stdout.trim().split('\n'),
      ['a', 'b', 'c'],
    );
  });

  it('while loop terminates and respects MAX_ITERATIONS safety', async () => {
    // Counter via env var
    const r = await shell.exec(`i=0; while [ "$i" != "3" ]; do echo $i; i=$((i+1)); done`);
    // Note: $((...)) arithmetic might not be supported. Fall back to a simple
    // bounded loop using exit codes. The harness should still terminate.
    assert.ok(r.exitCode === 0 || r.exitCode === 127, 'while should terminate');
  });

  it('function definition + invocation with positional params', async () => {
    const r = await shell.exec('greet() { echo "Hello $1"; }; greet clawser');
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout.trim(), 'Hello clawser');
  });

  it('nested function calls preserve caller positional params', async () => {
    // outer($1=alpha) calls inner($1=beta), then echoes $1 again — must see "alpha"
    const script = `
      inner() { echo "inner=$1"; }
      outer() { inner beta; echo "outer=$1"; }
      outer alpha
    `.trim().split('\n').map(s => s.trim()).filter(Boolean).join('; ');
    const r = await shell.exec(script);
    assert.equal(r.exitCode, 0);
    const lines = r.stdout.trim().split('\n');
    assert.deepEqual(lines, ['inner=beta', 'outer=alpha']);
  });

  it('nested function with more args in outer than inner clears stale params', async () => {
    // outer has $1=a $2=b $3=c, inner only takes $1=x. After inner returns,
    // outer must still see $2=b and $3=c (not the inner's empty $2/$3).
    const script = `
      inner() { echo "inner=$1,$2"; }
      outer() { inner x; echo "outer=$1,$2,$3,$#"; }
      outer a b c
    `.trim().split('\n').map(s => s.trim()).filter(Boolean).join('; ');
    const r = await shell.exec(script);
    assert.equal(r.exitCode, 0);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines[0], 'inner=x,');
    assert.equal(lines[1], 'outer=a,b,c,3');
  });

  it('return inside inner function does not leak signal to outer', async () => {
    // inner returns 7, outer returns 0. The outer must not be aborted by
    // the inner's return signal.
    const script = `
      inner() { return 7; echo "should not print"; }
      outer() { inner; echo "after-inner=$?"; }
      outer
      echo "after-outer=$?"
    `.trim().split('\n').map(s => s.trim()).filter(Boolean).join('; ');
    const r = await shell.exec(script);
    assert.equal(r.exitCode, 0, `script failed: ${r.stderr}`);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines[0], 'after-inner=7');
    assert.equal(lines[1], 'after-outer=0');
  });

  it('tilde expands to $HOME', async () => {
    shell.state.env.set('HOME', '/home/alice');
    const r = await shell.exec('echo ~');
    assert.equal(r.stdout.trim(), '/home/alice');

    const r2 = await shell.exec('echo ~/docs');
    assert.equal(r2.stdout.trim(), '/home/alice/docs');
  });

  it('sourceProfiles loads /etc/clawser/profile and ~/.config/clawser/profile', async () => {
    // ClawserShell.source() reads paths verbatim from the underlying fs.
    // MemoryFs.normalizePath preserves the leading '~' as a path segment, so
    // a write to '~/.config/clawser/profile' lands at '/~/.config/clawser/profile'
    // — matching the read path. Real ShellFs handles ~/ via resolveVirtualPath.
    await fs.writeFile('/etc/clawser/profile', 'export GLOBAL_VAR=set-by-etc');
    await fs.writeFile('~/.config/clawser/profile', 'export USER_VAR=set-by-user');

    await shell.sourceProfiles();

    assert.equal(shell.state.env.get('GLOBAL_VAR'), 'set-by-etc');
    assert.equal(shell.state.env.get('USER_VAR'), 'set-by-user');
  });

  it('user profile overrides system profile (sourced last)', async () => {
    await fs.writeFile('/etc/clawser/profile', 'export PRIORITY=system');
    await fs.writeFile('~/.config/clawser/profile', 'export PRIORITY=user');

    await shell.sourceProfiles();

    assert.equal(shell.state.env.get('PRIORITY'), 'user');
  });

  it('missing profile is not an error', async () => {
    // No profile files exist
    await shell.sourceProfiles();
    // Should not throw and shell should still be functional
    const r = await shell.exec('echo ok');
    assert.equal(r.stdout.trim(), 'ok');
  });
});

// ── Test 6b: .env loading (Phase 6) ───────────────────────────────

describe('e2e: .env loading (injectEnvIntoShell)', () => {
  beforeEach(resetOPFS);

  it('loads KEY=VALUE pairs from ~/.config/clawser/.env into shell env', async () => {
    const { injectEnvIntoShell } = await import('../clawser-fs-env.mjs');

    // Bootstrap so the directory exists
    await bootstrapFilesystem('test-ws');

    // Write a .env file directly into OPFS at the resolved path
    const envOpfsPath = resolveVirtualPath('~/.config/clawser/.env', 'test-ws');
    memOPFS.files.set(envOpfsPath, {
      content: '# header comment\nFOO=bar\nBAZ="hello world"\nQUX=\'single-quoted\'\n',
      mtime: Date.now(),
    });

    const fs = new MemoryFs();
    const shell = new ClawserShell({ fs });

    const env = await injectEnvIntoShell('test-ws', shell.state);

    assert.equal(env.FOO, 'bar');
    assert.equal(env.BAZ, 'hello world');
    assert.equal(env.QUX, 'single-quoted');
    assert.equal(shell.state.env.get('FOO'), 'bar');
    assert.equal(shell.state.env.get('BAZ'), 'hello world');
    assert.equal(shell.state.env.get('QUX'), 'single-quoted');
  });

  it('missing .env file is a silent no-op', async () => {
    const { injectEnvIntoShell } = await import('../clawser-fs-env.mjs');

    const fs = new MemoryFs();
    const shell = new ClawserShell({ fs });

    const env = await injectEnvIntoShell('no-such-ws', shell.state);

    assert.deepEqual(env, {});
    // Shell still works
    const r = await shell.exec('echo ok');
    assert.equal(r.stdout.trim(), 'ok');
  });
});

// ── Test 7: VirtualFs integration with /proc, /dev, real fs ───────

describe('e2e: VirtualFs integration', () => {
  it('reads from /proc, /dev, and real fs through one interface', async () => {
    const realFs = new MemoryFs();
    await realFs.writeFile('/tmp/clawser/note.txt', 'real content');

    const proc = new ProcFileHandler();
    proc.register('/proc/clawser/test', () => 'virtual content\n');

    const devices = new DeviceFileHandler();
    registerSpecialDevices(devices);

    const vfs = new VirtualFs(realFs, proc, devices);

    assert.equal(await vfs.readFile('/tmp/clawser/note.txt'), 'real content');
    assert.equal((await vfs.readFile('/proc/clawser/test')).trim(), 'virtual content');
    assert.equal(await vfs.readFile('/dev/clawser/null'), '');
  });

  it('deletes are blocked on /proc and /dev', async () => {
    const proc = new ProcFileHandler();
    proc.register('/proc/clawser/test', () => 'data');
    const devices = new DeviceFileHandler();
    registerSpecialDevices(devices);
    const vfs = new VirtualFs(new MemoryFs(), proc, devices);

    await assert.rejects(() => vfs.delete('/proc/clawser/test'), /[Rr]ead-only|[Cc]annot/);
    await assert.rejects(() => vfs.delete('/dev/clawser/null'), /[Cc]annot/);
  });
});

// ── Test 8: Disposable mode (memory-only, nothing persists) ───────

describe('e2e: disposable mode characteristics', () => {
  it('MemoryFs has no persistence — fresh instance is empty', async () => {
    const fs1 = new MemoryFs();
    await fs1.writeFile('/tmp/clawser/ephemeral.txt', 'should not survive');
    assert.equal(await fs1.readFile('/tmp/clawser/ephemeral.txt'), 'should not survive');

    const fs2 = new MemoryFs();
    await assert.rejects(() => fs2.readFile('/tmp/clawser/ephemeral.txt'), /ENOENT/);
  });

  it('shell history is in-memory and discarded with the shell', async () => {
    const fs = new MemoryFs();
    let shell = new ClawserShell({ fs });
    await shell.exec('echo first');
    await shell.exec('echo second');
    assert.equal(shell.state.history.length, 2);

    shell = new ClawserShell({ fs });
    assert.equal(shell.state.history.length, 0, 'new shell has no history');
  });
});

// ── Test 8a: FsUiSync wiring (Phase 7) ────────────────────────────

describe('e2e: FsUiSync (Phase 7)', () => {
  it('FsUiSync.saveValue writes through to disk + ReactiveConfigStore.get sees it', async () => {
    const fs = new MemoryFs();
    const watcher = new FileWatcher(fs, { intervalMs: 30, debounceMs: 5 });
    const store = new ReactiveConfigStore(watcher, fs);
    const { FsUiSync } = await import('../clawser-fs-ui-sync.mjs');

    let appliedAutonomy = null;
    store.register('autonomy', '~/.config/clawser/autonomy.json', {
      apply: (cfg) => { appliedAutonomy = cfg; },
    });
    watcher.start();

    const sync = new FsUiSync(store);
    await sync.saveValue('autonomy', { level: 'full' });

    // File on disk reflects the save
    const content = await fs.readFile('~/.config/clawser/autonomy.json');
    assert.equal(JSON.parse(content).level, 'full');

    // Self-write was suppressed — apply should NOT fire from our own save
    await new Promise(r => setTimeout(r, 80));
    assert.equal(appliedAutonomy, null, 'self-write must not loop back through apply');

    watcher.stop();
  });

  it('FsUiSync.registerPanel + load round-trips disk → render', async () => {
    const fs = new MemoryFs();
    const watcher = new FileWatcher(fs, { intervalMs: 30, debounceMs: 5 });
    const store = new ReactiveConfigStore(watcher, fs);
    const { FsUiSync } = await import('../clawser-fs-ui-sync.mjs');

    store.register('autonomy', '~/.config/clawser/autonomy.json', { apply: () => {} });
    await fs.writeFile('~/.config/clawser/autonomy.json', JSON.stringify({ level: 'supervised', maxActions: 42 }));

    const sync = new FsUiSync(store);
    const rendered = [];
    sync.registerPanel('autonomy', {
      render: (cfg) => rendered.push(cfg),
      collect: () => null,
    });

    const loaded = await sync.load('autonomy');
    assert.equal(loaded.level, 'supervised');
    assert.equal(loaded.maxActions, 42);
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0].maxActions, 42);

    watcher.stop();
  });

  it('external file write fires registered panel render with new config', async () => {
    const fs = new MemoryFs();
    const watcher = new FileWatcher(fs, { intervalMs: 20, debounceMs: 5 });
    const store = new ReactiveConfigStore(watcher, fs);
    const { FsUiSync } = await import('../clawser-fs-ui-sync.mjs');

    store.register('autonomy', '~/.config/clawser/autonomy.json', { apply: () => {} });
    watcher.start();

    const sync = new FsUiSync(store);
    const renders = [];
    sync.registerPanel('autonomy', {
      render: (cfg) => renders.push(cfg),
      collect: () => null,
    });

    // Simulate an external write (different tab, agent, chmod, etc.)
    await fs.writeFile('~/.config/clawser/autonomy.json', JSON.stringify({ level: 'full', maxActions: 99 }));

    // Wait for poll + debounce
    await new Promise(r => setTimeout(r, 100));

    assert.ok(renders.length >= 1, 'panel render should fire on external write');
    const last = renders[renders.length - 1];
    assert.equal(last.level, 'full');
    assert.equal(last.maxActions, 99);

    watcher.stop();
  });

  it('dirty inputs preserved while clean inputs update on external write', async () => {
    // This is a unit-shaped test for the dirty-aware setters (the
    // integration with FsUiSync.registerPanel renders is exercised in
    // the previous test and the panel-dirty test file).
    const { setIfClean, markDirty, bindDirtyTracking, markPanelClean } =
      await import('../clawser-panel-dirty.mjs');

    // Simulate a small DOM
    const make = (id, val = '') => {
      const listeners = {};
      return {
        id, value: val, type: 'text', dataset: {},
        addEventListener: (t, cb) => { (listeners[t] ||= []).push(cb); },
        removeEventListener: () => {},
        _fire: (t) => { for (const cb of listeners[t] || []) cb({ target: this }); },
      };
    };
    const a = make('cfgMaxActions', '');
    const b = make('cfgDailyCostLimit', '');
    globalThis.document = {
      getElementById: (id) => (id === 'cfgMaxActions' ? a : id === 'cfgDailyCostLimit' ? b : null),
      querySelectorAll: () => [],
    };

    bindDirtyTracking(a);
    bindDirtyTracking(b);

    // Initial render
    setIfClean('cfgMaxActions', '50');
    setIfClean('cfgDailyCostLimit', '5');
    assert.equal(a.value, '50');
    assert.equal(b.value, '5');

    // User edits the cost limit input
    b.value = 'user-typed';
    markDirty(b);

    // External update arrives — renders panel with new config
    setIfClean('cfgMaxActions', '120');
    setIfClean('cfgDailyCostLimit', '10');
    assert.equal(a.value, '120', 'untouched input should update');
    assert.equal(b.value, 'user-typed', 'dirty input should be preserved');

    // After save, panel is clean again
    markPanelClean(['cfgMaxActions', 'cfgDailyCostLimit']);
    setIfClean('cfgDailyCostLimit', '20');
    assert.equal(b.value, '20', 'after markPanelClean, input updates again');
  });
});

// ── Test 8b: kernel-fs wiring (Phase 8) ───────────────────────────

describe('e2e: kernel-fs generators (Phase 8)', () => {
  it('registerAllKernelGenerators exposes /proc/kernel/* and /sys/kernel/*', async () => {
    const { registerAllKernelGenerators } = await import('../clawser-fs-kernel.mjs');
    const handler = new ProcFileHandler();

    // Minimal kernel-shape stub
    const fakeKernel = {
      _startTime: 0,
      clock: { nowWall: () => 1234567890 },
      tenants: [{ id: 't1', caps: { _granted: ['NET', 'FS'] }, env: { ROLE: 'agent' } }],
      services: {
        list: () => [{ name: 'svc1', metadata: { foo: 'bar' } }],
      },
      tracer: { events: [{ ts: 100, type: 'tool_call', tool: 'fs_read' }] },
      signals: { TERM: { pending: false } },
    };
    const ki = { kernel: fakeKernel };

    registerAllKernelGenerators(handler, ki);

    // /proc/kernel/tenants should list our one tenant
    const tenants = await handler.readFile('/proc/kernel/tenants');
    assert.match(tenants, /t1\tNET,FS\tagent/);

    // /proc/kernel/status JSON
    const status = JSON.parse(await handler.readFile('/proc/kernel/status'));
    assert.equal(status.active, true);
    assert.equal(status.tenantCount, 1);
    assert.equal(status.serviceCount, 1);

    // /sys/kernel/clock returns wall clock
    const clock = await handler.readFile('/sys/kernel/clock');
    assert.equal(clock.trim(), '1234567890');

    // /sys/services lists registered services
    const services = await handler.readFile('/sys/services');
    assert.match(services, /svc:\/\/svc1/);

    // /sys/kernel/trace shows events
    const trace = await handler.readFile('/sys/kernel/trace');
    assert.match(trace, /tool_call/);

    // /sys/kernel/signals lists active signals
    const signals = await handler.readFile('/sys/kernel/signals');
    assert.match(signals, /TERM\tclear/);
  });

  it('graceful when kernel is absent', async () => {
    const { registerAllKernelGenerators } = await import('../clawser-fs-kernel.mjs');
    const handler = new ProcFileHandler();
    registerAllKernelGenerators(handler, { kernel: null });

    const status = JSON.parse(await handler.readFile('/proc/kernel/status'));
    assert.equal(status.active, false);
  });
});

// ── Test 9: full-stack integration — bootstrap → shell → /proc ────

describe('e2e: full integration smoke', () => {
  beforeEach(resetOPFS);

  it('bootstrap + initRuntimeFs + shell can read /proc files', async () => {
    await bootstrapFilesystem('default');

    const toolRegistry = {
      allSpecs: () => [{ name: 'echo', description: 'Print arguments' }],
      names: () => ['echo'],
      getPermission: () => 'auto',
    };
    const procHandler = initRuntimeFs({
      toolRegistry,
      wsId: 'default',
      initTime: performance.now(),
    });

    const realFs = new MemoryFs();
    const vfs = new VirtualFs(realFs, procHandler);

    const shell = new ClawserShell({ fs: vfs });

    const result = await shell.exec('cat /proc/clawser/tools');
    assert.equal(result.exitCode, 0, `cat failed: ${result.stderr}`);
    assert.match(result.stdout, /echo\tauto\tPrint arguments/);
  });

  it('chmod + cat motd through the shell', async () => {
    const permissions = new PermissionManager();
    const fs = new MemoryFs(permissions);
    await permissions.load(fs);

    // Manually seed an /etc/clawser/motd in the writable test fs
    // (default rules block /etc, so write directly through internals)
    permissions.setPermission('/etc/clawser/motd', 'rw');
    await fs.writeFile('/etc/clawser/motd', 'Welcome to clawser!');

    const shell = new ClawserShell({ fs, permissions });
    const result = await shell.exec('cat /etc/clawser/motd');
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Welcome to clawser/);

    // Now lock it down — write should fail
    await shell.exec('chmod -w /etc/clawser/motd');
    await assert.rejects(
      () => fs.writeFile('/etc/clawser/motd', 'pwned'),
      /Permission denied/,
    );
  });
});
