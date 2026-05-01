// clawser-permissions.test.mjs — Tests for Phase 4 chmod support
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-permissions.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub browser globals before importing modules
globalThis.BrowserTool = class { constructor() {} };
globalThis.WorkspaceFs = class {
  resolve(p) { return p; }
  static isInternalPath() { return false; }
  static INTERNAL_DIRS = new Set();
};

import {
  PermissionManager,
  registerChmodBuiltin,
  numericToMode,
  modeToNumeric,
  formatRwx,
  DEFAULT_RULES,
  DEFAULT_MODE,
} from '../clawser-permissions.js';

import {
  ClawserShell,
  MemoryFs,
  CommandRegistry,
  ShellState,
  registerBuiltins,
} from '../clawser-shell.js';

// ── Helper utilities ────────────────────────────────────────────────

describe('numericToMode', () => {
  it('converts 755 to rwx', () => {
    assert.equal(numericToMode('755'), 'rwx');
  });

  it('converts 644 to rw', () => {
    assert.equal(numericToMode('644'), 'rw');
  });

  it('converts 444 to r', () => {
    assert.equal(numericToMode('444'), 'r');
  });

  it('converts 000 to -', () => {
    assert.equal(numericToMode('000'), '-');
  });

  it('converts 100 to x', () => {
    assert.equal(numericToMode('100'), 'x');
  });

  it('handles numeric input', () => {
    assert.equal(numericToMode(755), 'rwx');
  });
});

describe('modeToNumeric', () => {
  it('converts rwx to 755', () => {
    assert.equal(modeToNumeric('rwx'), '755');
  });

  it('converts rw to 644', () => {
    assert.equal(modeToNumeric('rw'), '644');
  });

  it('converts r to 444', () => {
    assert.equal(modeToNumeric('r'), '444');
  });
});

describe('formatRwx', () => {
  it('formats rw as rw-', () => {
    assert.equal(formatRwx('rw'), 'rw-');
  });

  it('formats r as r--', () => {
    assert.equal(formatRwx('r'), 'r--');
  });

  it('formats rwx as rwx', () => {
    assert.equal(formatRwx('rwx'), 'rwx');
  });

  it('formats empty/dash as ---', () => {
    assert.equal(formatRwx('-'), '---');
    assert.equal(formatRwx(''), '---');
  });
});

// ── PermissionManager ───────────────────────────────────────────────

describe('PermissionManager', () => {
  let pm;

  beforeEach(() => {
    pm = new PermissionManager();
  });

  describe('getPermission', () => {
    it('returns default "r" for /etc/clawser/ paths', () => {
      assert.equal(pm.getPermission('/etc/clawser/motd'), 'r');
    });

    it('returns default "r" for /proc/clawser/ paths', () => {
      assert.equal(pm.getPermission('/proc/clawser/version'), 'r');
    });

    it('returns default "r" for /dev/clawser/ paths', () => {
      assert.equal(pm.getPermission('/dev/clawser/providers/openai'), 'r');
    });

    it('returns default "r" for /sys/ paths', () => {
      assert.equal(pm.getPermission('/sys/kernel/config'), 'r');
    });

    it('returns default "r" for /run/clawser/ paths', () => {
      assert.equal(pm.getPermission('/run/clawser/tabs/tab1'), 'r');
    });

    it('returns default "rw" for ~/.config/clawser/ paths', () => {
      assert.equal(pm.getPermission('~/.config/clawser/autonomy.json'), 'rw');
    });

    it('returns default "rw" for ~/.local/share/clawser/ paths', () => {
      assert.equal(pm.getPermission('~/.local/share/clawser/memory/facts.json'), 'rw');
    });

    it('returns default "rw" for /var/log/clawser/ paths', () => {
      assert.equal(pm.getPermission('/var/log/clawser/app.log'), 'rw');
    });

    it('returns default "rw" for /tmp/clawser/ paths', () => {
      assert.equal(pm.getPermission('/tmp/clawser/scratch.txt'), 'rw');
    });

    it('returns default "rw" for unrecognized paths', () => {
      assert.equal(pm.getPermission('/some/random/path'), 'rw');
    });
  });

  describe('setPermission', () => {
    it('overrides the default for a specific path', async () => {
      await pm.setPermission('/tmp/clawser/important.txt', 'r');
      assert.equal(pm.getPermission('/tmp/clawser/important.txt'), 'r');
    });

    it('manifest entry takes priority over default rules', async () => {
      await pm.setPermission('/etc/clawser/motd', 'rw');
      assert.equal(pm.getPermission('/etc/clawser/motd'), 'rw');
    });
  });

  describe('setPermissionRecursive', () => {
    it('sets the prefix and updates existing child entries', async () => {
      await pm.setPermission('/tmp/clawser/a.txt', 'rw');
      await pm.setPermission('/tmp/clawser/b.txt', 'rw');
      await pm.setPermissionRecursive('/tmp/clawser', 'r');

      assert.equal(pm.getPermission('/tmp/clawser'), 'r');
      assert.equal(pm.getPermission('/tmp/clawser/a.txt'), 'r');
      assert.equal(pm.getPermission('/tmp/clawser/b.txt'), 'r');
    });
  });

  describe('checkWrite', () => {
    it('returns true for writable paths', () => {
      assert.equal(pm.checkWrite('/tmp/clawser/file.txt'), true);
    });

    it('throws for read-only paths', () => {
      assert.throws(
        () => pm.checkWrite('/etc/clawser/motd'),
        /Permission denied.*read-only/
      );
    });

    it('throws with formatted mode in message', () => {
      assert.throws(
        () => pm.checkWrite('/etc/clawser/motd'),
        /r--/
      );
    });
  });

  describe('checkRead', () => {
    it('returns true for all readable paths', () => {
      assert.equal(pm.checkRead('/etc/clawser/motd'), true);
      assert.equal(pm.checkRead('/tmp/clawser/file.txt'), true);
    });
  });

  describe('formatMode', () => {
    it('formats read-only as r--', () => {
      assert.equal(pm.formatMode('/etc/clawser/motd'), 'r--');
    });

    it('formats read-write as rw-', () => {
      assert.equal(pm.formatMode('/tmp/clawser/file.txt'), 'rw-');
    });
  });

  describe('dump', () => {
    it('includes default rules', () => {
      const dumped = JSON.parse(pm.dump());
      assert.ok(dumped['/etc/clawser/']);
      assert.equal(dumped['/etc/clawser/'].mode, 'r');
      assert.equal(dumped['/etc/clawser/'].source, 'default');
    });

    it('includes manifest entries', async () => {
      await pm.setPermission('/tmp/clawser/custom.txt', 'rwx');
      const dumped = JSON.parse(pm.dump());
      assert.ok(dumped['/tmp/clawser/custom.txt']);
      assert.equal(dumped['/tmp/clawser/custom.txt'].mode, 'rwx');
      assert.equal(dumped['/tmp/clawser/custom.txt'].source, 'manifest');
    });
  });

  describe('load', () => {
    it('loads manifest from filesystem', async () => {
      const fs = new MemoryFs();
      await fs.writeFile('~/.config/clawser/permissions.json', JSON.stringify({
        '/tmp/clawser/locked.txt': 'r',
      }));
      await pm.load(fs);
      assert.equal(pm.getPermission('/tmp/clawser/locked.txt'), 'r');
    });

    it('handles missing manifest gracefully', async () => {
      const fs = new MemoryFs();
      await pm.load(fs);
      // Should still work with defaults
      assert.equal(pm.getPermission('/etc/clawser/motd'), 'r');
    });
  });
});

// ── chmod builtin ───────────────────────────────────────────────────

describe('chmod builtin', () => {
  let shell;
  let pm;

  beforeEach(() => {
    pm = new PermissionManager();
    const fs = new MemoryFs(pm);
    shell = new ClawserShell({ fs, permissions: pm });
  });

  it('is registered as a command', () => {
    assert.ok(shell.registry.has('chmod'));
  });

  it('chmod +w adds write permission', async () => {
    await pm.setPermission('/tmp/clawser/file.txt', 'r');
    const result = await shell.exec('chmod +w /tmp/clawser/file.txt');
    assert.equal(result.exitCode, 0);
    assert.equal(pm.getPermission('/tmp/clawser/file.txt'), 'rw');
  });

  it('chmod -w removes write permission', async () => {
    const result = await shell.exec('chmod -w /tmp/clawser/file.txt');
    assert.equal(result.exitCode, 0);
    assert.equal(pm.getPermission('/tmp/clawser/file.txt'), 'r');
  });

  it('chmod +x adds execute permission', async () => {
    const result = await shell.exec('chmod +x /tmp/clawser/script.sh');
    assert.equal(result.exitCode, 0);
    const mode = pm.getPermission('/tmp/clawser/script.sh');
    assert.ok(mode.includes('x'));
  });

  it('chmod -x removes execute permission', async () => {
    await pm.setPermission('/tmp/clawser/script.sh', 'rwx');
    const result = await shell.exec('chmod -x /tmp/clawser/script.sh');
    assert.equal(result.exitCode, 0);
    assert.ok(!pm.getPermission('/tmp/clawser/script.sh').includes('x'));
  });

  it('chmod 644 sets numeric mode', async () => {
    const result = await shell.exec('chmod 644 /tmp/clawser/file.txt');
    assert.equal(result.exitCode, 0);
    assert.equal(pm.getPermission('/tmp/clawser/file.txt'), 'rw');
  });

  it('chmod 755 sets rwx mode', async () => {
    const result = await shell.exec('chmod 755 /tmp/clawser/script.sh');
    assert.equal(result.exitCode, 0);
    assert.equal(pm.getPermission('/tmp/clawser/script.sh'), 'rwx');
  });

  it('chmod 444 sets read-only mode', async () => {
    const result = await shell.exec('chmod 444 /tmp/clawser/locked.txt');
    assert.equal(result.exitCode, 0);
    assert.equal(pm.getPermission('/tmp/clawser/locked.txt'), 'r');
  });

  it('chmod -R applies recursively', async () => {
    await pm.setPermission('/tmp/clawser/dir/a.txt', 'rw');
    await pm.setPermission('/tmp/clawser/dir/b.txt', 'rw');
    const result = await shell.exec('chmod -R -w /tmp/clawser/dir');
    assert.equal(result.exitCode, 0);
    assert.equal(pm.getPermission('/tmp/clawser/dir'), 'r');
    assert.equal(pm.getPermission('/tmp/clawser/dir/a.txt'), 'r');
    assert.equal(pm.getPermission('/tmp/clawser/dir/b.txt'), 'r');
  });

  it('errors on missing arguments', async () => {
    const result = await shell.exec('chmod');
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('usage'));
  });

  it('errors on invalid mode', async () => {
    const result = await shell.exec('chmod +z /tmp/clawser/file.txt');
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('invalid mode'));
  });
});

// ── Write guard integration ─────────────────────────────────────────

describe('Permission write guards', () => {
  let shell;
  let pm;

  beforeEach(async () => {
    pm = new PermissionManager();
    const fs = new MemoryFs(pm);
    shell = new ClawserShell({ fs, permissions: pm });
    // Seed some files
    await shell.exec('echo "hello" > /tmp/clawser/writable.txt');
  });

  it('allows writes to writable paths', async () => {
    const result = await shell.exec('echo "updated" > /tmp/clawser/writable.txt');
    assert.equal(result.exitCode, 0);
  });

  it('blocks writes to read-only paths (default /etc/)', async () => {
    const result = await shell.exec('echo "hacked" > /etc/clawser/motd');
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes('Permission denied') || result.stderr.includes('Read-only'));
  });

  it('blocks writes after chmod -w', async () => {
    await shell.exec('chmod -w /tmp/clawser/writable.txt');
    const result = await shell.exec('echo "nope" > /tmp/clawser/writable.txt');
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes('Permission denied'));
  });

  it('allows writes after chmod +w', async () => {
    await shell.exec('chmod -w /tmp/clawser/writable.txt');
    await shell.exec('chmod +w /tmp/clawser/writable.txt');
    const result = await shell.exec('echo "yes" > /tmp/clawser/writable.txt');
    assert.equal(result.exitCode, 0);
  });

  it('blocks mkdir on read-only directories', async () => {
    const result = await shell.exec('mkdir /etc/clawser/newdir');
    assert.notEqual(result.exitCode, 0);
  });

  it('blocks rm on read-only paths', async () => {
    // First create a file in /etc/ by bypassing permissions
    await pm.setPermission('/etc/clawser/test.txt', 'rw');
    await shell.exec('echo "data" > /etc/clawser/test.txt');
    await pm.setPermission('/etc/clawser/test.txt', 'r');

    const result = await shell.exec('rm /etc/clawser/test.txt');
    assert.notEqual(result.exitCode, 0);
  });
});

// ── ls -l permission display ────────────────────────────────────────

describe('ls -l with permissions', () => {
  let shell;
  let pm;

  beforeEach(async () => {
    pm = new PermissionManager();
    const fs = new MemoryFs(pm);
    shell = new ClawserShell({ fs, permissions: pm });
    await shell.exec('echo "content" > /tmp/clawser/file.txt');
    await shell.exec('mkdir /tmp/clawser/subdir');
  });

  it('shows permission flags in long format', async () => {
    const result = await shell.exec('ls -l /tmp/clawser');
    assert.equal(result.exitCode, 0);
    // Should contain rwx-style permission strings
    assert.ok(result.stdout.includes('rw-'), `Expected rw- in: ${result.stdout}`);
  });

  it('shows type character (d for directory, - for file)', async () => {
    const result = await shell.exec('ls -l /tmp/clawser');
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('drw-'), `Expected drw- for directory in: ${result.stdout}`);
    assert.ok(result.stdout.includes('-rw-'), `Expected -rw- for file in: ${result.stdout}`);
  });

  it('reflects chmod changes in ls -l output', async () => {
    await shell.exec('chmod -w /tmp/clawser/file.txt');
    const result = await shell.exec('ls -l /tmp/clawser');
    assert.ok(result.stdout.includes('-r--'), `Expected -r-- after chmod -w in: ${result.stdout}`);
  });
});
