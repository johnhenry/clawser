// clawser-home-alias.test.mjs — /home/<name> alias + cross-workspace isolation

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { resolveVirtualPath, CLAWSER_ROOT } from '../clawser-opfs.js'
import { ClawserShell, MemoryFs } from '../clawser-shell.js'
import { ProcFileHandler, VirtualFs, registerProcGenerators } from '../clawser-proc.js'

// ── resolveVirtualPath ────────────────────────────────────────────

describe('resolveVirtualPath — /home/<name> aliasing', () => {
  it('/home/<active>/foo maps to the workspace home', () => {
    const r = resolveVirtualPath('/home/myws/foo.txt', 'ws_abc', { activeHomeName: 'myws' })
    assert.equal(r, `${CLAWSER_ROOT}/workspaces/ws_abc/foo.txt`)
  })

  it('/home/<active> (no trailing slash) maps to the workspace dir', () => {
    const r = resolveVirtualPath('/home/myws', 'ws_abc', { activeHomeName: 'myws' })
    assert.equal(r, `${CLAWSER_ROOT}/workspaces/ws_abc`)
  })

  it('/home/<other>/foo maps to an isolated never-created subtree', () => {
    const r = resolveVirtualPath('/home/their-ws/foo.txt', 'ws_mine', { activeHomeName: 'mine' })
    assert.match(r, /_isolated_\/their-ws\//, 'cross-workspace path must NOT touch any real workspace dir')
    assert.doesNotMatch(r, /workspaces\//)
  })

  it('/home and /home/ map to the isolated root (used for `ls /home`)', () => {
    const a = resolveVirtualPath('/home', 'ws_abc', { activeHomeName: 'myws' })
    const b = resolveVirtualPath('/home/', 'ws_abc', { activeHomeName: 'myws' })
    assert.match(a, /_isolated_\/__virtual_home_root__/)
    assert.match(b, /_isolated_\/__virtual_home_root__/)
  })

  it('without activeHomeName (legacy callers), /home/<name>/... is treated as cross-workspace', () => {
    const r = resolveVirtualPath('/home/anything/x', 'ws_abc')
    assert.match(r, /_isolated_/)
  })

  it('~/ still resolves to the workspace home (existing behavior)', () => {
    assert.equal(
      resolveVirtualPath('~/notes.md', 'ws_abc', { activeHomeName: 'myws' }),
      `${CLAWSER_ROOT}/workspaces/ws_abc/notes.md`,
    )
  })

  it('system paths (/etc, /tmp, /proc, /dev) are unaffected by activeHomeName', () => {
    assert.match(resolveVirtualPath('/etc/foo', 'ws_abc', { activeHomeName: 'myws' }), /\/etc\/foo$/)
    assert.match(resolveVirtualPath('/tmp/foo', 'ws_abc', { activeHomeName: 'myws' }), /\/tmp\/foo$/)
  })
})

// ── ShellFs alias + isolation ────────────────────────────────────

describe('ClawserShell — /home/<name> alias, $HOME, isolation', () => {
  it('setActiveHomeName updates $HOME and the shell-fs alias', async () => {
    const fs = new MemoryFs()
    const shell = new ClawserShell({ fs })
    shell.setActiveHomeName('default')
    assert.equal(shell.state.env.get('HOME'), '/home/default')
    shell.setActiveHomeName(null)
    assert.equal(shell.state.env.get('HOME'), '/')
  })

  it('switching active home re-exports $HOME live', async () => {
    const fs = new MemoryFs()
    const shell = new ClawserShell({ fs })
    shell.setActiveHomeName('myws')
    assert.equal(shell.state.env.get('HOME'), '/home/myws')
    shell.setActiveHomeName('side-project')
    assert.equal(shell.state.env.get('HOME'), '/home/side-project')
  })

  // The ShellFs/ResolveVirtualPath aliasing is exercised when ShellFs
  // is wired up; that's covered in the `clawser-shell.test.mjs` flow.
  // For unit-level tests we only verify the env+helper surface here.
})

// ── /proc/clawser/workspaces ─────────────────────────────────────

describe('/proc/clawser/workspaces virtual file', () => {
  it('lists workspaces with id, name, /home path, and active marker', async () => {
    const handler = new ProcFileHandler()
    registerProcGenerators(handler, {
      getWorkspaces: () => [
        { id: 'default', name: 'workspace' },
        { id: 'ws_a', name: 'My Project' },
        { id: 'ws_b', name: 'Café' },
      ],
      getActiveId: () => 'ws_a',
    })
    const out = await handler.readFile('/proc/clawser/workspaces')
    const lines = out.trim().split('\n')
    assert.equal(lines[0], 'id\tname\thome\tactive')
    assert.match(out, /default\tworkspace\t\/home\/default\t\n/)
    assert.match(out, /ws_a\tMy Project\t\/home\/my-project\tyes/)
    assert.match(out, /ws_b\tCafé\t\/home\/cafe\t\n/) // sanitized cafe
  })

  it('emits a clear placeholder when no workspaces are available', async () => {
    const handler = new ProcFileHandler()
    registerProcGenerators(handler, { getWorkspaces: () => [] })
    const out = await handler.readFile('/proc/clawser/workspaces')
    assert.match(out, /no workspaces/)
  })

  it('emits unavailable when no getWorkspaces is supplied', async () => {
    const handler = new ProcFileHandler()
    registerProcGenerators(handler, {}) // no getWorkspaces
    const out = await handler.readFile('/proc/clawser/workspaces')
    assert.match(out, /unavailable/)
  })
})

// ── End-to-end: /home/<active>/foo === ~/foo, /home/<other>/foo blocked ──

describe('shell end-to-end with /home/<name> alias', () => {
  it('writing to ~/x and reading from /home/<active>/x returns the same content', async () => {
    const fs = new MemoryFs()
    const proc = new ProcFileHandler()
    const vfs = new VirtualFs(fs, proc, null)
    const shell = new ClawserShell({ fs: vfs })
    shell.setActiveHomeName('default')
    // The MemoryFs path here is independent of the OPFS layout; this is
    // really verifying that ShellFs resolves both paths to the same
    // underlying location. With MemoryFs (no opfs prefix), paths
    // collide as expected.
    await shell.exec('echo hello > ~/note.txt')
    const r = await shell.exec('cat /home/default/note.txt')
    assert.equal(r.stdout, 'hello\n')
  })

  it('writing to /home/<other>/x is denied with a clear error', async () => {
    const fs = new MemoryFs()
    const proc = new ProcFileHandler()
    const vfs = new VirtualFs(fs, proc, null)
    const shell = new ClawserShell({ fs: vfs })
    shell.setActiveHomeName('mine')
    const r = await shell.exec('echo hi > /home/their-ws/secret.txt')
    assert.equal(r.exitCode, 1)
    assert.match(r.stderr, /Cross-workspace|denied|isolated/i)
  })

  it('reading /home/<other>/x returns ENOENT (not data leak)', async () => {
    const fs = new MemoryFs()
    const proc = new ProcFileHandler()
    const vfs = new VirtualFs(fs, proc, null)
    const shell = new ClawserShell({ fs: vfs })
    shell.setActiveHomeName('mine')
    // Even if the OTHER workspace's data existed at its own ShellFs
    // path, our shell's ShellFs is bound to ONE wsId, so /home/<other>
    // resolves to a never-touched path → ENOENT.
    const r = await shell.exec('cat /home/their-ws/anything')
    assert.equal(r.exitCode, 1)
    assert.match(r.stderr, /No such file/i)
  })

  it('listing /home/ does not expose other workspace names', async () => {
    const fs = new MemoryFs()
    const proc = new ProcFileHandler()
    const vfs = new VirtualFs(fs, proc, null)
    const shell = new ClawserShell({ fs: vfs })
    shell.setActiveHomeName('mine')
    const r = await shell.exec('ls /home/')
    // Empty (or ENOENT) — the shell view doesn't enumerate other workspaces.
    if (r.exitCode === 0) {
      // Either empty or just the placeholder — must not contain other names
      assert.doesNotMatch(r.stdout, /their|other|workspace/i)
    } else {
      assert.match(r.stderr, /No such file|denied|isolated/i)
    }
  })
})
