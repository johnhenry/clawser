// clawser-fs-bootstrap.test.mjs — Tests for Phase 0: OPFS path resolver, directory bootstrap, default configs, web locks
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-fs-bootstrap.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── In-memory OPFS stub ────────────────────────────────────────────

/**
 * Minimal in-memory FileSystemDirectoryHandle stub for testing.
 * Tracks created directories and files without real OPFS.
 */
const createMemoryOPFS = () => {
  const dirs = new Map();  // path → MemoryDirHandle
  const files = new Map(); // path → { content: string }

  const makeDirHandle = (path) => {
    if (dirs.has(path)) return dirs.get(path);
    const handle = {
      kind: 'directory',
      name: path.split('/').pop() || '',
      getDirectoryHandle: async (name, opts = {}) => {
        const childPath = path ? `${path}/${name}` : name;
        if (dirs.has(childPath)) return dirs.get(childPath);
        if (!opts.create) throw new DOMException('Not found', 'NotFoundError');
        const child = makeDirHandle(childPath);
        dirs.set(childPath, child);
        return child;
      },
      getFileHandle: async (name, opts = {}) => {
        const filePath = path ? `${path}/${name}` : name;
        if (files.has(filePath)) return makeFileHandle(filePath);
        if (!opts.create) throw new DOMException('Not found', 'NotFoundError');
        files.set(filePath, { content: '' });
        return makeFileHandle(filePath);
      },
      [Symbol.asyncIterator]: async function* () {
        const prefix = path ? `${path}/` : '';
        // Yield direct children only
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

  const makeFileHandle = (filePath) => ({
    kind: 'file',
    name: filePath.split('/').pop(),
    getFile: async () => ({
      text: async () => files.get(filePath)?.content || '',
      size: (files.get(filePath)?.content || '').length,
      lastModified: Date.now(),
    }),
    createWritable: async () => {
      let buf = '';
      return {
        write: async (data) => { buf += typeof data === 'string' ? data : String(data); },
        close: async () => { files.set(filePath, { content: buf }); },
      };
    },
  });

  const root = makeDirHandle('');
  return { root, dirs, files };
};

// ── Patch navigator.storage before imports ─────────────────────────

let memOPFS;

const resetOPFS = () => {
  memOPFS = createMemoryOPFS();
  const storageDesc = {
    value: { getDirectory: async () => memOPFS.root },
    configurable: true,
    writable: true,
  };
  try {
    globalThis.navigator = {
      storage: storageDesc.value,
      locks: { request: async (_name, fn) => fn() },
    };
  } catch {
    Object.defineProperty(globalThis.navigator, 'storage', storageDesc);
  }
};

resetOPFS();

// ── Import modules under test ──────────────────────────────────────

import { CLAWSER_ROOT, resolveVirtualPath, opfsWalk, opfsWalkDir, withLock } from '../clawser-opfs.js';
import {
  GLOBAL_DIRS,
  WORKSPACE_DIRS,
  DEFAULT_CONFIGS,
  ensureDirectoryStructure,
  writeIfMissing,
  writeDefaultConfigs,
  bootstrapFilesystem,
} from '../clawser-fs-bootstrap.mjs';

// ─── resolveVirtualPath ────────────────────────────────────────────

describe('resolveVirtualPath', () => {
  it('maps /etc/ paths to global namespace', () => {
    assert.equal(
      resolveVirtualPath('/etc/clawser/motd', 'default'),
      'clawser/etc/clawser/motd',
    );
  });

  it('maps /var/ paths to global namespace', () => {
    assert.equal(
      resolveVirtualPath('/var/log/clawser/app.log', 'ws1'),
      'clawser/var/log/clawser/app.log',
    );
  });

  it('maps /run/ paths to global namespace', () => {
    assert.equal(
      resolveVirtualPath('/run/clawser/pid', 'ws1'),
      'clawser/run/clawser/pid',
    );
  });

  it('maps /dev/ paths to global namespace', () => {
    assert.equal(
      resolveVirtualPath('/dev/clawser/providers/openai', 'ws1'),
      'clawser/dev/clawser/providers/openai',
    );
  });

  it('maps /proc/ paths to global namespace', () => {
    assert.equal(
      resolveVirtualPath('/proc/clawser/status', 'ws1'),
      'clawser/proc/clawser/status',
    );
  });

  it('maps /sys/ paths to global namespace', () => {
    assert.equal(
      resolveVirtualPath('/sys/kernel/version', 'ws1'),
      'clawser/sys/kernel/version',
    );
  });

  it('maps /tmp/ paths to global namespace', () => {
    assert.equal(
      resolveVirtualPath('/tmp/clawser/scratch', 'ws1'),
      'clawser/tmp/clawser/scratch',
    );
  });

  it('expands ~/ to workspace home', () => {
    assert.equal(
      resolveVirtualPath('~/.config/clawser/autonomy.json', 'ws_abc'),
      'clawser/workspaces/ws_abc/.config/clawser/autonomy.json',
    );
  });

  it('treats bare relative paths as workspace-relative', () => {
    assert.equal(
      resolveVirtualPath('docs/readme.md', 'default'),
      'clawser/workspaces/default/docs/readme.md',
    );
  });

  it('strips leading slash for non-system paths', () => {
    assert.equal(
      resolveVirtualPath('/myfile.txt', 'default'),
      'clawser/workspaces/default/myfile.txt',
    );
  });
});

// ─── CLAWSER_ROOT ──────────────────────────────────────────────────

describe('CLAWSER_ROOT', () => {
  it('equals "clawser"', () => {
    assert.equal(CLAWSER_ROOT, 'clawser');
  });
});

// ─── withLock ──────────────────────────────────────────────────────

describe('withLock', () => {
  it('executes the callback and returns its result', async () => {
    const result = await withLock('test:lock', async () => 42);
    assert.equal(result, 42);
  });

  it('works when navigator.locks is unavailable', async () => {
    const origLocks = globalThis.navigator.locks;
    try {
      Object.defineProperty(globalThis.navigator, 'locks', {
        value: undefined, configurable: true, writable: true,
      });
      const result = await withLock('test:lock', async () => 'ok');
      assert.equal(result, 'ok');
    } finally {
      Object.defineProperty(globalThis.navigator, 'locks', {
        value: origLocks, configurable: true, writable: true,
      });
    }
  });

  it('propagates errors from the callback', async () => {
    await assert.rejects(
      () => withLock('test:lock', async () => { throw new Error('boom'); }),
      { message: 'boom' },
    );
  });
});

// ─── ensureDirectoryStructure ──────────────────────────────────────

describe('ensureDirectoryStructure', () => {
  beforeEach(() => resetOPFS());

  it('creates all global directories', async () => {
    await ensureDirectoryStructure('default');
    for (const dir of GLOBAL_DIRS) {
      assert.ok(memOPFS.dirs.has(dir), `missing global dir: ${dir}`);
    }
  });

  it('creates all workspace directories', async () => {
    await ensureDirectoryStructure('ws_test');
    for (const dir of WORKSPACE_DIRS) {
      const fullPath = `clawser/workspaces/ws_test/${dir}`;
      assert.ok(memOPFS.dirs.has(fullPath), `missing workspace dir: ${fullPath}`);
    }
  });

  it('is idempotent — second call does not throw', async () => {
    await ensureDirectoryStructure('default');
    await ensureDirectoryStructure('default');
    // No assertion needed — just confirm no error thrown
  });
});

// ─── writeIfMissing ────────────────────────────────────────────────

describe('writeIfMissing', () => {
  beforeEach(() => resetOPFS());

  it('creates a file that does not exist', async () => {
    await ensureDirectoryStructure('default');
    const created = await writeIfMissing('clawser/etc/clawser/motd', 'hello');
    assert.equal(created, true);
    assert.equal(memOPFS.files.get('clawser/etc/clawser/motd')?.content, 'hello');
  });

  it('returns false for a file that already exists', async () => {
    await ensureDirectoryStructure('default');
    await writeIfMissing('clawser/etc/clawser/motd', 'first');
    const created = await writeIfMissing('clawser/etc/clawser/motd', 'second');
    assert.equal(created, false);
    // Content should remain 'first'
    assert.equal(memOPFS.files.get('clawser/etc/clawser/motd')?.content, 'first');
  });
});

// ─── writeDefaultConfigs ───────────────────────────────────────────

describe('writeDefaultConfigs', () => {
  beforeEach(() => resetOPFS());

  it('writes all default config files', async () => {
    await ensureDirectoryStructure('default');
    const created = await writeDefaultConfigs('default');
    assert.equal(created.length, Object.keys(DEFAULT_CONFIGS).length);
  });

  it('writes valid JSON for object configs', async () => {
    await ensureDirectoryStructure('default');
    await writeDefaultConfigs('default');

    const autonomyPath = resolveVirtualPath('~/.config/clawser/autonomy.json', 'default');
    const content = memOPFS.files.get(autonomyPath)?.content;
    assert.ok(content, 'autonomy.json should exist');

    const parsed = JSON.parse(content);
    assert.equal(parsed.level, 'supervised');
    assert.equal(parsed.rateLimit.perHour, 60);
    assert.equal(parsed.costLimit.perDay, 5.00);
  });

  it('writes plain text for string configs', async () => {
    await ensureDirectoryStructure('default');
    await writeDefaultConfigs('default');

    const motdPath = resolveVirtualPath('/etc/clawser/motd', 'default');
    const content = memOPFS.files.get(motdPath)?.content;
    assert.equal(content, 'Welcome to clawser — browser agent workspace');
  });

  it('does not overwrite existing configs on second call', async () => {
    await ensureDirectoryStructure('default');
    const first = await writeDefaultConfigs('default');
    const second = await writeDefaultConfigs('default');
    assert.equal(first.length, Object.keys(DEFAULT_CONFIGS).length);
    assert.equal(second.length, 0);
  });
});

// ─── bootstrapFilesystem ──────────────────────────────────────────

describe('bootstrapFilesystem', () => {
  beforeEach(() => resetOPFS());

  it('creates dirs and configs in one call', async () => {
    const result = await bootstrapFilesystem('default');
    assert.equal(result.dirs, true);
    assert.ok(result.configs.length > 0);
  });

  it('defaults wsId to "default"', async () => {
    const result = await bootstrapFilesystem();
    assert.equal(result.dirs, true);
    const wsDir = 'clawser/workspaces/default/.config/clawser';
    assert.ok(memOPFS.dirs.has(wsDir), 'default workspace dirs should exist');
  });
});

// ─── opfsWalk / opfsWalkDir with new namespace ─────────────────────

describe('opfsWalk with new namespace', () => {
  beforeEach(() => resetOPFS());

  it('walks a clawser/ prefixed path', async () => {
    await ensureDirectoryStructure('default');
    const opfsPath = resolveVirtualPath('/etc/clawser/motd', 'default');
    const { dir, name } = await opfsWalk(opfsPath, { create: true });
    assert.equal(name, 'motd');
    assert.ok(dir, 'parent directory handle should exist');
  });
});
