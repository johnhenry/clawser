/**
 * Tests for clawser-fs-guest-mount.mjs — Phase 9: v86 Guest Mount Points
 */
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-fs-guest-mount.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGuestFsAdapter,
  mountGuest,
  umountGuest,
  listGuestMounts,
  isGuestMount,
  autoMountGuest,
} from '../clawser-fs-guest-mount.mjs';

// ── Mock LinuxGuest ──────────────────────────────────────────────

const createMockGuest = (filesystem = {}) => {
  // filesystem: { '/etc/hostname': 'clawser-guest\n', '/home/': null (dir), ... }
  const fs = { ...filesystem };
  const state = 'running';

  return {
    state,
    async sendCommand(cmd) {
      // Parse the command and return appropriate output
      const trimmed = cmd.trim();

      // cat command
      if (trimmed.startsWith('cat ')) {
        const path = extractPath(trimmed, 'cat ');
        if (fs[path] === undefined) {
          return `${trimmed}\r\ncat: ${path}: No such file or directory\r\n/ # `;
        }
        return `${trimmed}\r\n${fs[path]}\r\n/ # `;
      }

      // ls -la command
      if (trimmed.startsWith('ls -la ')) {
        const path = extractPath(trimmed, 'ls -la ');
        const entries = listMockDir(fs, path);
        const header = `${trimmed}\r\ntotal ${entries.length * 4}\r\n`;
        const lines = entries.map(e => {
          if (e.type === 'directory') {
            return `drwxr-xr-x    2 root root  4096 Jan  1 00:00 ${e.name}`;
          }
          const size = (fs[e.fullPath] || '').length;
          return `-rw-r--r--    1 root root  ${size} Jan  1 00:00 ${e.name}`;
        });
        return header + lines.join('\r\n') + '\r\n/ # ';
      }

      // stat command
      if (trimmed.startsWith('stat ')) {
        const path = extractPath(trimmed, 'stat ');
        if (fs[path] === undefined && !isDirInFs(fs, path)) {
          return `${trimmed}\r\nstat: ${path}: No such file or directory\r\n/ # `;
        }
        const isDir = isDirInFs(fs, path);
        const size = isDir ? 4096 : (fs[path] || '').length;
        return `${trimmed}\r\n  File: '${path}'\r\n  Size: ${size}\tBlocks: 8\tIO Block: 4096\t${isDir ? 'directory' : 'regular file'}\r\nAccess: (0755/drwxr-xr-x)  Uid: (    0/    root)  Gid: (    0/    root)\r\nAccess: 2024-01-01 00:00:00.000000000 +0000\r\nModify: 2024-01-01 00:00:00.000000000 +0000\r\nChange: 2024-01-01 00:00:00.000000000 +0000\r\n/ # `;
      }

      // echo ... | base64 -d > ... (write command)
      if (trimmed.includes('base64 -d >')) {
        const pathMatch = trimmed.match(/>\s*'([^']+)'/);
        if (pathMatch) {
          const b64Match = trimmed.match(/echo '([^']+)'/);
          if (b64Match) {
            const decoded = Buffer.from(b64Match[1], 'base64').toString('utf-8');
            fs[pathMatch[1]] = decoded;
          }
        }
        return `${trimmed}\r\n/ # `;
      }

      // mkdir -p
      if (trimmed.startsWith('mkdir -p ')) {
        const path = extractPath(trimmed, 'mkdir -p ');
        fs[path + '/.'] = null; // Mark as directory
        return `mkdir -p ${path}\r\n/ # `;
      }

      // rm
      if (trimmed.startsWith('rm ')) {
        const path = extractPath(trimmed, trimmed.startsWith('rm -rf ') ? 'rm -rf ' : 'rm -f ');
        delete fs[path];
        return `${trimmed}\r\n/ # `;
      }

      return `${trimmed}\r\n/ # `;
    },

    // Test helper: access internal fs
    _fs: fs,
  };
};

/** Extract path from command, handling shell-escaped paths. */
const extractPath = (cmd, prefix) => {
  const rest = cmd.slice(prefix.length).trim();
  if (rest.startsWith("'")) {
    const end = rest.indexOf("'", 1);
    return end > 0 ? rest.slice(1, end) : rest.slice(1);
  }
  return rest.split(/\s/)[0];
};

/** List directory entries from mock filesystem. */
const listMockDir = (fs, dirPath) => {
  const norm = dirPath.endsWith('/') ? dirPath : dirPath + '/';
  const entries = [];
  const seen = new Set();
  for (const key of Object.keys(fs)) {
    if (key.startsWith(norm) && key !== norm) {
      const rest = key.slice(norm.length);
      const name = rest.split('/')[0];
      if (name && !seen.has(name) && name !== '.') {
        seen.add(name);
        const isDir = rest.includes('/');
        entries.push({
          name,
          type: isDir ? 'directory' : 'file',
          fullPath: norm + name,
        });
      }
    }
  }
  return entries;
};

/** Check if a path is a directory in the mock filesystem. */
const isDirInFs = (fs, path) => {
  const norm = path.endsWith('/') ? path : path + '/';
  return Object.keys(fs).some(k => k.startsWith(norm));
};

// ── Mock MountableFs ──────────────────────────────────────────────

const createMockMountableFs = () => {
  const mounts = new Map();
  return {
    mountAdapter(mountPoint, adapter, opts = {}) {
      if (!mountPoint.startsWith('/mnt/')) throw new Error('Mount points must be under /mnt/');
      mounts.set(mountPoint, { adapter, ...opts });
    },
    unmount(mountPoint) {
      return mounts.delete(mountPoint);
    },
    isMounted(mountPoint) {
      return mounts.has(mountPoint);
    },
    get mountTable() {
      return [...mounts.entries()].map(([mp, info]) => ({
        mountPoint: mp,
        source: info.metadata?.source || 'unknown',
      }));
    },
    _mounts: mounts,
  };
};

// ── Tests ─────────────────────────────────────────────────────────

describe('createGuestFsAdapter', () => {
  let guest;
  let adapter;

  beforeEach(() => {
    guest = createMockGuest({
      '/etc/hostname': 'clawser-guest',
      '/etc/os-release': 'NAME="Alpine Linux"',
      '/home/user/hello.txt': 'Hello from guest!',
      '/home/user/notes/': null,
      '/home/user/notes/todo.txt': 'Buy milk',
    });
    adapter = createGuestFsAdapter(guest);
  });

  it('has correct metadata', () => {
    assert.equal(adapter.metadata.source, 'v86-guest');
    assert.equal(adapter.readOnly, false);
  });

  it('readFile returns file content', async () => {
    const content = await adapter.readFile('/etc/hostname');
    assert.equal(content.trim(), 'clawser-guest');
  });

  it('listDir returns directory entries', async () => {
    const entries = await adapter.listDir('/etc');
    assert.ok(entries.length > 0);
    const names = entries.map(e => e.name);
    assert.ok(names.includes('hostname'));
    assert.ok(names.includes('os-release'));
  });

  it('listDir entries have correct kind', async () => {
    const entries = await adapter.listDir('/home/user');
    const notes = entries.find(e => e.name === 'notes');
    const hello = entries.find(e => e.name === 'hello.txt');
    assert.equal(notes?.kind, 'directory');
    assert.equal(hello?.kind, 'file');
  });

  it('stat returns file info', async () => {
    const info = await adapter.stat('/etc/hostname');
    assert.ok(info);
    assert.equal(info.kind, 'file');
    assert.ok(typeof info.size === 'number');
  });

  it('stat returns directory info', async () => {
    const info = await adapter.stat('/home/user/notes');
    assert.ok(info);
    assert.equal(info.kind, 'directory');
  });

  it('stat returns null for nonexistent path', async () => {
    const info = await adapter.stat('/nonexistent');
    assert.equal(info, null);
  });

  it('writeFile writes content to guest', async () => {
    await adapter.writeFile('/tmp/test.txt', 'written content');
    assert.equal(guest._fs['/tmp/test.txt'], 'written content');
  });
});

describe('mountGuest / umountGuest', () => {
  let guest;
  let mfs;

  beforeEach(() => {
    guest = createMockGuest({ '/etc/hostname': 'test' });
    mfs = createMockMountableFs();
    // Clean up any leftover mounts from previous tests
    for (const m of listGuestMounts()) {
      umountGuest(m.mountPoint, mfs);
    }
  });

  afterEach(() => {
    // Clean up mounts
    for (const m of listGuestMounts()) {
      umountGuest(m.mountPoint, mfs);
    }
  });

  it('mounts guest at specified path', () => {
    const result = mountGuest('/mnt/guest', guest, mfs);
    assert.equal(result.mountPoint, '/mnt/guest');
    assert.ok(result.adapter);
    assert.ok(mfs.isMounted('/mnt/guest'));
  });

  it('throws if mount point not under /mnt/', () => {
    assert.throws(() => {
      mountGuest('/etc/guest', guest, mfs);
    }, /must be under \/mnt\//);
  });

  it('throws if guest is null', () => {
    assert.throws(() => {
      mountGuest('/mnt/guest', null, mfs);
    }, /guest instance is required/);
  });

  it('throws if mountableFs is null', () => {
    assert.throws(() => {
      mountGuest('/mnt/guest', guest, null);
    }, /mountableFs is required/);
  });

  it('throws if already mounted', () => {
    mountGuest('/mnt/guest', guest, mfs);
    assert.throws(() => {
      mountGuest('/mnt/guest', guest, mfs);
    }, /already mounted/);
  });

  it('umountGuest removes the mount', () => {
    mountGuest('/mnt/guest', guest, mfs);
    const removed = umountGuest('/mnt/guest', mfs);
    assert.equal(removed, true);
    assert.equal(mfs.isMounted('/mnt/guest'), false);
  });

  it('umountGuest returns false for non-existent mount', () => {
    const removed = umountGuest('/mnt/nonexistent', mfs);
    assert.equal(removed, false);
  });

  it('strips trailing slashes from mount point', () => {
    mountGuest('/mnt/guest/', guest, mfs);
    assert.ok(isGuestMount('/mnt/guest'));
    umountGuest('/mnt/guest/', mfs);
    assert.equal(isGuestMount('/mnt/guest'), false);
  });
});

describe('listGuestMounts / isGuestMount', () => {
  let guest;
  let mfs;

  beforeEach(() => {
    guest = createMockGuest({});
    mfs = createMockMountableFs();
    for (const m of listGuestMounts()) {
      umountGuest(m.mountPoint, mfs);
    }
  });

  afterEach(() => {
    for (const m of listGuestMounts()) {
      umountGuest(m.mountPoint, mfs);
    }
  });

  it('listGuestMounts returns empty when no mounts', () => {
    assert.deepStrictEqual(listGuestMounts(), []);
  });

  it('listGuestMounts lists active mounts', () => {
    mountGuest('/mnt/guest1', guest, mfs);
    mountGuest('/mnt/guest2', guest, mfs);
    const mounts = listGuestMounts();
    assert.equal(mounts.length, 2);
    const points = mounts.map(m => m.mountPoint);
    assert.ok(points.includes('/mnt/guest1'));
    assert.ok(points.includes('/mnt/guest2'));
  });

  it('isGuestMount returns true for active mount', () => {
    mountGuest('/mnt/vm', guest, mfs);
    assert.ok(isGuestMount('/mnt/vm'));
  });

  it('isGuestMount returns false for non-mount', () => {
    assert.equal(isGuestMount('/mnt/nonexistent'), false);
  });

  it('listGuestMounts includes guest state', () => {
    mountGuest('/mnt/guest', guest, mfs);
    const mounts = listGuestMounts();
    assert.equal(mounts[0].guestState, 'running');
  });
});

describe('adapter integration with MountableFs', () => {
  let guest;
  let mfs;

  beforeEach(() => {
    guest = createMockGuest({
      '/etc/hostname': 'integration-guest',
      '/home/': null,
      '/home/data.txt': 'some data',
    });
    mfs = createMockMountableFs();
    for (const m of listGuestMounts()) {
      umountGuest(m.mountPoint, mfs);
    }
  });

  afterEach(() => {
    for (const m of listGuestMounts()) {
      umountGuest(m.mountPoint, mfs);
    }
  });

  it('mounted adapter can readFile', async () => {
    const { adapter } = mountGuest('/mnt/guest', guest, mfs);
    const content = await adapter.readFile('/etc/hostname');
    assert.ok(content.includes('integration-guest'));
  });

  it('mounted adapter can listDir', async () => {
    const { adapter } = mountGuest('/mnt/guest', guest, mfs);
    const entries = await adapter.listDir('/home');
    assert.ok(entries.length > 0);
  });

  it('readOnly option is respected', () => {
    const { adapter } = mountGuest('/mnt/ro-guest', guest, mfs, { readOnly: true });
    assert.equal(adapter.readOnly, true);
  });
});

// ── autoMountGuest ─────────────────────────────────────────────────

/** Mock guest that fires state callbacks on demand. */
const createStatefulMockGuest = (initialState = 'idle') => {
  const callbacks = [];
  let state = initialState;
  return {
    get state() { return state; },
    onStateChange: (cb) => {
      callbacks.push(cb);
      return () => {
        const i = callbacks.indexOf(cb);
        if (i >= 0) callbacks.splice(i, 1);
      };
    },
    /** Test helper: change state and fire callbacks. */
    transition: (newState) => {
      state = newState;
      for (const cb of callbacks.slice()) cb(newState);
    },
    /** Stub for sendCommand, matches the LinuxGuest API. */
    sendCommand: async () => '',
  };
};

describe('autoMountGuest', () => {
  let mfs;

  beforeEach(() => {
    mfs = createMockMountableFs();
    for (const m of listGuestMounts()) {
      umountGuest(m.mountPoint, mfs);
    }
  });

  afterEach(() => {
    for (const m of listGuestMounts()) {
      umountGuest(m.mountPoint, mfs);
    }
  });

  it('mounts when guest transitions to running', () => {
    const guest = createStatefulMockGuest('booting');
    autoMountGuest(guest, mfs);

    assert.equal(isGuestMount('/mnt/guest'), false, 'not yet running');

    guest.transition('running');
    assert.equal(isGuestMount('/mnt/guest'), true, 'mounted on running');
  });

  it('umounts when guest transitions to shutdown', () => {
    const guest = createStatefulMockGuest('running');
    autoMountGuest(guest, mfs);

    assert.equal(isGuestMount('/mnt/guest'), true, 'mounted immediately for already-running guest');

    guest.transition('shutdown');
    assert.equal(isGuestMount('/mnt/guest'), false, 'umounted on shutdown');
  });

  it('umounts on error transition', () => {
    const guest = createStatefulMockGuest('running');
    autoMountGuest(guest, mfs);
    assert.equal(isGuestMount('/mnt/guest'), true);

    guest.transition('error');
    assert.equal(isGuestMount('/mnt/guest'), false);
  });

  it('returned unwire detaches and unmounts', () => {
    const guest = createStatefulMockGuest('running');
    const unwire = autoMountGuest(guest, mfs);

    assert.equal(isGuestMount('/mnt/guest'), true);

    unwire();
    assert.equal(isGuestMount('/mnt/guest'), false, 'unmounted on unwire');

    // Subsequent state changes should not remount
    guest.transition('shutdown');
    guest.transition('running');
    assert.equal(isGuestMount('/mnt/guest'), false, 'detached — state changes ignored');
  });

  it('respects custom mountPoint', () => {
    const guest = createStatefulMockGuest('running');
    autoMountGuest(guest, mfs, { mountPoint: '/mnt/custom' });
    assert.equal(isGuestMount('/mnt/custom'), true);
  });

  it('respects readOnly option', () => {
    const guest = createStatefulMockGuest('running');
    autoMountGuest(guest, mfs, { readOnly: true });
    const list = listGuestMounts();
    assert.equal(list.length, 1);
  });

  it('does not double-mount if running fires multiple times', () => {
    const guest = createStatefulMockGuest('running');
    autoMountGuest(guest, mfs);

    // Re-emit running — autoMount should be idempotent
    guest.transition('running');
    guest.transition('running');

    assert.equal(listGuestMounts().length, 1);
  });
});
