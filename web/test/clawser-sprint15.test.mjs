// Sprint 15 — Mount System + Shell Builtins + Server Handlers + Tool Retry
// RED phase: 30 tests, all expected to fail initially.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ── 1. System prompt mount table injection (5 tests) ─────────────

describe('Mount table injection', () => {
  let MountableFs, WorkspaceFs;

  before(async () => {
    const tools = await import('../clawser-tools.js');
    WorkspaceFs = tools.WorkspaceFs;
    const mount = await import('../clawser-mount.js');
    MountableFs = mount.MountableFs;
  });

  it('formatMountTable returns empty string when no mounts', () => {
    const fs = new MountableFs();
    // New method: formatMountTable() → string for agent prompt
    assert.equal(typeof fs.formatMountTable, 'function');
    const result = fs.formatMountTable();
    assert.equal(result, '');
  });

  it('formatMountTable renders markdown table for mounts', () => {
    const fs = new MountableFs();
    fs.mount('/mnt/project', { name: 'myapp', kind: 'directory' }, { readOnly: false });
    fs.mount('/mnt/data', { name: 'data', kind: 'directory' }, { readOnly: true });
    const result = fs.formatMountTable();
    assert.ok(result.includes('/mnt/project'));
    assert.ok(result.includes('/mnt/data'));
    assert.ok(result.includes('myapp'));
    assert.ok(result.includes('readonly'));
  });

  it('formatMountTable includes column headers', () => {
    const fs = new MountableFs();
    fs.mount('/mnt/app', { name: 'app', kind: 'directory' });
    const result = fs.formatMountTable();
    assert.ok(result.includes('Path'));
    assert.ok(result.includes('Name'));
  });

  it('injectMountContext returns system prompt with mount section', () => {
    const fs = new MountableFs();
    fs.mount('/mnt/code', { name: 'code', kind: 'directory' });
    // New method: injectMountContext(basePrompt) → enriched prompt
    const base = 'You are a helpful agent.';
    const result = fs.injectMountContext(base);
    assert.ok(result.startsWith(base));
    assert.ok(result.includes('/mnt/code'));
    assert.ok(result.includes('Mounted'));
  });

  it('injectMountContext returns base prompt unchanged when no mounts', () => {
    const fs = new MountableFs();
    const base = 'You are a helpful agent.';
    const result = fs.injectMountContext(base);
    assert.equal(result, base);
  });
});

// ── 2. mount/umount/df shell built-ins (8 tests) ─────────────────

describe('Shell mount builtins', () => {
  let registerMountBuiltins;

  before(async () => {
    const mod = await import('../clawser-shell-builtins.js');
    registerMountBuiltins = mod.registerMountBuiltins;
  });

  it('registerMountBuiltins exports a function', () => {
    assert.equal(typeof registerMountBuiltins, 'function');
  });

  it('registers mount, umount, df commands', () => {
    const registered = new Map();
    const registry = {
      register(name, handler, meta) { registered.set(name, { handler, meta }); },
    };
    registerMountBuiltins(registry, {});
    assert.ok(registered.has('mount'));
    assert.ok(registered.has('umount'));
    assert.ok(registered.has('df'));
  });

  it('mount -l lists current mounts', async () => {
    const registered = new Map();
    const registry = {
      register(name, handler, meta) { registered.set(name, { handler, meta }); },
    };
    const mockFs = {
      mountTable: [
        { path: '/mnt/app', name: 'app', kind: 'directory', readOnly: false },
      ],
    };
    registerMountBuiltins(registry, { mountableFs: mockFs });
    const { handler } = registered.get('mount');
    const result = await handler(['-l'], {});
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('/mnt/app'));
  });

  it('mount with no args and no fs returns error', async () => {
    const registered = new Map();
    const registry = {
      register(name, handler, meta) { registered.set(name, { handler, meta }); },
    };
    registerMountBuiltins(registry, {});
    const { handler } = registered.get('mount');
    const result = await handler([], {});
    assert.notEqual(result.exitCode, 0);
  });

  it('umount removes a mount point', async () => {
    const registered = new Map();
    const registry = {
      register(name, handler, meta) { registered.set(name, { handler, meta }); },
    };
    let unmountedPath = null;
    const mockFs = {
      unmount(path) { unmountedPath = path; return true; },
      isMounted(path) { return path === '/mnt/app'; },
    };
    registerMountBuiltins(registry, { mountableFs: mockFs });
    const { handler } = registered.get('umount');
    const result = await handler(['/mnt/app'], {});
    assert.equal(result.exitCode, 0);
    assert.equal(unmountedPath, '/mnt/app');
  });

  it('umount on non-existent mount returns error', async () => {
    const registered = new Map();
    const registry = {
      register(name, handler, meta) { registered.set(name, { handler, meta }); },
    };
    const mockFs = {
      unmount() { return false; },
      isMounted() { return false; },
    };
    registerMountBuiltins(registry, { mountableFs: mockFs });
    const { handler } = registered.get('umount');
    const result = await handler(['/mnt/nothing'], {});
    assert.notEqual(result.exitCode, 0);
  });

  it('df shows filesystem usage summary', async () => {
    const registered = new Map();
    const registry = {
      register(name, handler, meta) { registered.set(name, { handler, meta }); },
    };
    const mockFs = {
      mountTable: [
        { path: '/mnt/app', name: 'app', kind: 'directory', readOnly: false },
        { path: '/mnt/docs', name: 'docs', kind: 'directory', readOnly: true },
      ],
    };
    registerMountBuiltins(registry, { mountableFs: mockFs });
    const { handler } = registered.get('df');
    const result = await handler([], {});
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('OPFS'));
    assert.ok(result.stdout.includes('/mnt/app'));
    assert.ok(result.stdout.includes('/mnt/docs'));
  });

  it('df with no mounts shows only OPFS root', async () => {
    const registered = new Map();
    const registry = {
      register(name, handler, meta) { registered.set(name, { handler, meta }); },
    };
    registerMountBuiltins(registry, { mountableFs: { mountTable: [] } });
    const { handler } = registered.get('df');
    const result = await handler([], {});
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('OPFS'));
  });
});

// ── 3. Shell transparent mount routing (5 tests) ─────────────────

describe('Shell mount routing', () => {
  let MountableFs;

  before(async () => {
    const mod = await import('../clawser-mount.js');
    MountableFs = mod.MountableFs;
  });

  it('readFile routes /mnt/X paths through mount handle', async () => {
    const fs = new MountableFs();
    let readPath = null;
    const handle = {
      name: 'myapp',
      kind: 'directory',
      getFileHandle(name) {
        readPath = name;
        return {
          getFile() {
            return { text() { return 'hello mount'; } };
          },
        };
      },
    };
    fs.mount('/mnt/myapp', handle);
    // New method: readMounted(path) → string|null
    const content = await fs.readMounted('/mnt/myapp/readme.txt');
    assert.equal(content, 'hello mount');
    assert.equal(readPath, 'readme.txt');
  });

  it('readMounted returns null for OPFS paths', async () => {
    const fs = new MountableFs();
    const result = await fs.readMounted('/workspace/file.txt');
    assert.equal(result, null);
  });

  it('writeMounted writes to mounted directory', async () => {
    const fs = new MountableFs();
    let writtenData = null;
    const handle = {
      name: 'proj',
      kind: 'directory',
      getFileHandle(name, opts) {
        return {
          async createWritable() {
            return {
              async write(data) { writtenData = data; },
              async close() {},
            };
          },
        };
      },
    };
    fs.mount('/mnt/proj', handle);
    await fs.writeMounted('/mnt/proj/out.txt', 'content here');
    assert.equal(writtenData, 'content here');
  });

  it('writeMounted rejects writes to readonly mounts', async () => {
    const fs = new MountableFs();
    const handle = { name: 'ro', kind: 'directory' };
    fs.mount('/mnt/ro', handle, { readOnly: true });
    await assert.rejects(
      () => fs.writeMounted('/mnt/ro/file.txt', 'data'),
      /read.?only/i
    );
  });

  it('listMounted lists files in mounted directory', async () => {
    const fs = new MountableFs();
    const entries = [
      { name: 'a.txt', kind: 'file' },
      { name: 'sub', kind: 'directory' },
    ];
    const handle = {
      name: 'proj',
      kind: 'directory',
      async *entries() {
        for (const e of entries) yield [e.name, e];
      },
    };
    fs.mount('/mnt/proj', handle);
    const result = await fs.listMounted('/mnt/proj');
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 2);
    assert.ok(result.some(e => e.name === 'a.txt'));
    assert.ok(result.some(e => e.name === 'sub'));
  });
});

// ── 4. Skills-as-Handlers (4 tests) ──────────────────────────────

describe('Skills as server handlers', () => {
  let ServerManager;

  before(async () => {
    // ServerManager requires indexedDB, use dynamic import with mock
    const mod = await import('../clawser-server.js');
    ServerManager = mod.ServerManager;
  });

  it('ServerManager.createSkillHandler returns a handler config', () => {
    // New static method: createSkillHandler(skillName, opts)
    assert.equal(typeof ServerManager.createSkillHandler, 'function');
    const handler = ServerManager.createSkillHandler('my-skill');
    assert.equal(handler.type, 'skill');
    assert.equal(handler.skillName, 'my-skill');
  });

  it('skill handler config includes execution mode', () => {
    const handler = ServerManager.createSkillHandler('api-skill', { execution: 'page' });
    assert.equal(handler.execution, 'page');
  });

  it('executeSkillHandler invokes skill body as response', async () => {
    // Mock skill registry
    const mockRegistry = {
      get(name) {
        if (name === 'echo') {
          return {
            name: 'echo',
            body: 'Echo skill active',
            metadata: { name: 'echo', version: '1.0' },
          };
        }
        return null;
      },
    };

    // New static/instance method: executeSkillHandler(skillName, request, registry)
    assert.equal(typeof ServerManager.executeSkillHandler, 'function');
    const response = await ServerManager.executeSkillHandler('echo', {
      method: 'GET', url: '/echo', headers: {},
    }, mockRegistry);
    assert.ok(response);
    assert.equal(response.status, 200);
  });

  it('executeSkillHandler returns 404 for unknown skill', async () => {
    const mockRegistry = { get() { return null; } };
    const response = await ServerManager.executeSkillHandler('missing', {
      method: 'GET', url: '/', headers: {},
    }, mockRegistry);
    assert.equal(response.status, 404);
  });
});

// ── 5. Interrupted tool call handling (4 tests) ──────────────────

describe('Tool idempotency', () => {
  let BrowserTool, FetchTool, FsReadTool, FsWriteTool;

  before(async () => {
    const tools = await import('../clawser-tools.js');
    BrowserTool = tools.BrowserTool;
    FetchTool = tools.FetchTool;
    FsReadTool = tools.FsReadTool;
    FsWriteTool = tools.FsWriteTool;
  });

  it('BrowserTool has idempotent getter (default false)', () => {
    const tool = new BrowserTool();
    assert.equal(typeof tool.idempotent, 'boolean');
    assert.equal(tool.idempotent, false);
  });

  it('FsReadTool is idempotent', () => {
    const tool = new FsReadTool({});
    assert.equal(tool.idempotent, true);
  });

  it('FetchTool is idempotent', () => {
    const tool = new FetchTool();
    assert.equal(tool.idempotent, true);
  });

  it('FsWriteTool is NOT idempotent', () => {
    const tool = new FsWriteTool({});
    assert.equal(tool.idempotent, false);
  });
});

// ── 6. Notification preferences (4 tests) ────────────────────────

describe('Notification preferences', () => {
  let NotificationManager;

  before(async () => {
    const mod = await import('../clawser-notifications.js');
    NotificationManager = mod.NotificationManager;
  });

  it('accepts preferences in constructor', () => {
    const mgr = new NotificationManager({
      preferences: { error: true, info: false, warning: true, success: false },
    });
    // New getter: preferences
    assert.equal(typeof mgr.preferences, 'object');
    assert.equal(mgr.preferences.error, true);
    assert.equal(mgr.preferences.info, false);
  });

  it('filters notifications by type preference', () => {
    const delivered = [];
    const mgr = new NotificationManager({
      preferences: { error: true, info: false, warning: true, success: true },
      onNotify: (n) => delivered.push(n),
    });
    mgr.notify({ type: 'info', title: 'FYI', body: 'should be filtered' });
    mgr.notify({ type: 'error', title: 'Err', body: 'should deliver' });
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].type, 'error');
  });

  it('setPreference updates a single type', () => {
    const mgr = new NotificationManager({
      preferences: { error: true, info: true, warning: true, success: true },
    });
    mgr.setPreference('info', false);
    assert.equal(mgr.preferences.info, false);
    assert.equal(mgr.preferences.error, true);
  });

  it('quiet hours suppress all notifications during window', () => {
    const delivered = [];
    const mgr = new NotificationManager({
      onNotify: (n) => delivered.push(n),
      quietHours: { start: 0, end: 24 }, // all day quiet
    });
    mgr.notify({ type: 'error', title: 'Alert', body: 'suppressed' });
    assert.equal(delivered.length, 0);
  });
});
