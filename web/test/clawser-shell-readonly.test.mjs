// clawser-shell-readonly.test.mjs — Tests for read-only OPFS directory protection
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-shell-readonly.test.mjs

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Stub browser globals with real INTERNAL_DIRS so guards work
const INTERNAL_DIRS = new Set(['.checkpoints', '.conversations', '.skills', '.agents'])
globalThis.BrowserTool = class { constructor() {} }
globalThis.WorkspaceFs = class {
  resolve(p) { return p }
  static INTERNAL_DIRS = INTERNAL_DIRS
  static isInternalPath(shellPath) {
    const first = shellPath.replace(/^\//, '').split('/')[0]
    return INTERNAL_DIRS.has(first)
  }
}

import {
  MemoryFs,
  ClawserShell,
} from '../clawser-shell.js'

// ─── Helper ─────────────────────────────────────────────────────────

/**
 * Create a shell with MemoryFs and pre-seeded system directories.
 * System dirs are seeded by writing directly to the MemoryFs internals
 * (simulating agent/system writes that bypass guards).
 */
const createShell = () => {
  const fs = new MemoryFs()
  const shell = new ClawserShell({ fs })
  return { shell, fs }
}

// ─── Read-only directory protection (MemoryFs) ─────────────────────

describe('MemoryFs read-only guards', () => {
  it('rejects writeFile to a protected directory', async () => {
    const fs = new MemoryFs()
    await assert.rejects(
      () => fs.writeFile('/.agents/config.json', '{}'),
      /Read-only.*system directory/
    )
  })

  it('rejects mkdir inside a protected directory', async () => {
    const fs = new MemoryFs()
    await assert.rejects(
      () => fs.mkdir('/.checkpoints/snap1'),
      /Read-only.*system directory/
    )
  })

  it('rejects delete inside a protected directory', async () => {
    const fs = new MemoryFs()
    await assert.rejects(
      () => fs.delete('/.skills/tool.js'),
      /Read-only.*system directory/
    )
  })

  it('rejects copy to a protected directory', async () => {
    const fs = new MemoryFs()
    await fs.writeFile('/readme.txt', 'hello')
    await assert.rejects(
      () => fs.copy('/readme.txt', '/.conversations/log.txt'),
      /Read-only.*system directory/
    )
  })

  it('rejects move from a protected directory', async () => {
    const fs = new MemoryFs()
    await assert.rejects(
      () => fs.move('/.agents/agent.json', '/agent-backup.json'),
      /Read-only.*system directory/
    )
  })

  it('rejects move to a protected directory', async () => {
    const fs = new MemoryFs()
    await fs.writeFile('/data.txt', 'content')
    await assert.rejects(
      () => fs.move('/data.txt', '/.skills/data.txt'),
      /Read-only.*system directory/
    )
  })

  it('allows writes to non-protected paths', async () => {
    const fs = new MemoryFs()
    await fs.writeFile('/myfile.txt', 'hello')
    assert.equal(await fs.readFile('/myfile.txt'), 'hello')
  })

  it('allows reads from protected directories', async () => {
    // readFile and stat should not throw for permission reasons
    const fs = new MemoryFs()
    // Reading a nonexistent file throws ENOENT, not permission error
    await assert.rejects(
      () => fs.readFile('/.agents/config.json'),
      /ENOENT/
    )
  })
})

// ─── Shell command integration ──────────────────────────────────────

describe('Shell commands respect read-only directories', () => {
  let shell

  beforeEach(() => {
    ({ shell } = createShell())
  })

  // ── Write commands that should be blocked ──

  it('rm rejects deletion in protected directory', async () => {
    const r = await shell.exec('rm /.agents/config.json')
    assert.notEqual(r.exitCode, 0)
    assert.match(r.stderr, /Read-only|system directory/)
  })

  it('rm -rf rejects recursive deletion of protected directory', async () => {
    const r = await shell.exec('rm -rf /.checkpoints')
    assert.notEqual(r.exitCode, 0)
    assert.match(r.stderr, /Read-only|system directory/)
  })

  it('mkdir rejects creating dirs inside protected directory', async () => {
    const r = await shell.exec('mkdir /.skills/newskill')
    assert.notEqual(r.exitCode, 0)
    assert.match(r.stderr, /Read-only|system directory/)
  })

  it('cp rejects copying into protected directory', async () => {
    await shell.exec('echo hello > /src.txt')
    // src.txt is created via redirect which calls writeFile
    // Now try to copy into protected dir
    const r = await shell.exec('cp /src.txt /.agents/copy.txt')
    assert.notEqual(r.exitCode, 0)
    assert.match(r.stderr, /Read-only|system directory/)
  })

  it('mv rejects moving into protected directory', async () => {
    await shell.exec('echo data > /moveme.txt')
    const r = await shell.exec('mv /moveme.txt /.conversations/moveme.txt')
    assert.notEqual(r.exitCode, 0)
    assert.match(r.stderr, /Read-only|system directory/)
  })

  it('redirect > rejects writing to protected directory', async () => {
    const r = await shell.exec('echo bad > /.agents/hack.txt')
    assert.notEqual(r.exitCode, 0)
    assert.match(r.stderr, /Read-only|system directory|redirect/)
  })

  it('redirect >> rejects appending to protected directory', async () => {
    const r = await shell.exec('echo bad >> /.skills/append.txt')
    assert.notEqual(r.exitCode, 0)
    assert.match(r.stderr, /Read-only|system directory|redirect/)
  })

  it('tee rejects writing to protected directory', async () => {
    const r = await shell.exec('echo data | tee /.agents/tee-target.txt')
    assert.notEqual(r.exitCode, 0)
    assert.match(r.stderr, /Read-only|system directory/)
  })

  // ── touch (from extended builtins) ──

  it('touch rejects creating files in protected directory', async () => {
    const r = await shell.exec('touch /.checkpoints/newfile')
    assert.notEqual(r.exitCode, 0)
    assert.match(r.stderr, /Read-only|system directory/)
  })

  // ── Read commands that should still work ──

  it('cd into protected directory works', async () => {
    // cd doesn't write, just changes cwd — should succeed even if dir
    // doesn't exist (we get "no such directory" not "read-only")
    const r = await shell.exec('cd /.agents')
    // It may fail because the dir doesn't exist in empty MemoryFs,
    // but it should NOT fail with "read-only"
    if (r.exitCode !== 0) {
      assert.doesNotMatch(r.stderr, /Read-only|system directory/)
    }
  })

  it('ls on protected directory works', async () => {
    const r = await shell.exec('ls /.agents')
    // May fail with ENOENT but NOT with read-only
    if (r.exitCode !== 0) {
      assert.doesNotMatch(r.stderr, /Read-only|system directory/)
    }
  })

  it('cat on protected directory file works (fails with ENOENT not permission)', async () => {
    const r = await shell.exec('cat /.agents/config.json')
    if (r.exitCode !== 0) {
      assert.doesNotMatch(r.stderr, /Read-only|system directory/)
    }
  })

  // ── Writes to normal directories still work ──

  it('normal file operations still work', async () => {
    let r = await shell.exec('echo hello > /myfile.txt')
    assert.equal(r.exitCode, 0)

    r = await shell.exec('cat /myfile.txt')
    assert.equal(r.exitCode, 0)
    assert.match(r.stdout, /hello/)

    r = await shell.exec('mkdir /mydir')
    assert.equal(r.exitCode, 0)

    r = await shell.exec('cp /myfile.txt /mydir/copy.txt')
    assert.equal(r.exitCode, 0)

    r = await shell.exec('mv /mydir/copy.txt /mydir/moved.txt')
    assert.equal(r.exitCode, 0)

    r = await shell.exec('rm /mydir/moved.txt')
    assert.equal(r.exitCode, 0)
  })

  // ── All four protected directories ──

  it('guards all four system directories', async () => {
    for (const dir of ['.checkpoints', '.conversations', '.skills', '.agents']) {
      const r = await shell.exec(`echo test > /${dir}/file.txt`)
      assert.notEqual(r.exitCode, 0, `Expected write to /${dir} to fail`)
    }
  })

  it('guards nested paths within system directories', async () => {
    const r = await shell.exec('mkdir /.agents/deep/nested/path')
    assert.notEqual(r.exitCode, 0)
    assert.match(r.stderr, /Read-only|system directory/)
  })
})
