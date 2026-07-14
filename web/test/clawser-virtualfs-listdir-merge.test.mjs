// clawser-virtualfs-listdir-merge.test.mjs
// Regression for the 2026-05-04 bug: VirtualFs.listDir was early-returning
// virtual / device entries and hiding real-FS entries at the same path.
// Reported symptom: `echo > /tmp/foo.txt; ls /tmp/` (or `ls /`) shows no
// real files when proc/devices have any entry under that directory.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { ClawserShell, MemoryFs } from '../clawser-shell.js'
import { ProcFileHandler, VirtualFs } from '../clawser-proc.js'

describe('VirtualFs.listDir — merges virtual + real entries (regression)', () => {
  it('ls / shows both /proc and real-FS files when proc handlers exist', async () => {
    const fs = new MemoryFs()
    const proc = new ProcFileHandler()
    proc.register('/proc/clawser/version', () => '0.1.0')
    const vfs = new VirtualFs(fs, proc, null)
    const shell = new ClawserShell({ fs: vfs })
    await shell.exec('mkdir -p /home/test')
    await shell.exec('echo hi > /myfile')
    const r = await shell.exec('ls /')
    assert.match(r.stdout, /myfile/, 'real file at root must appear')
    assert.match(r.stdout, /proc/, 'virtual /proc entry must also appear')
  })

  it('ls /tmp/ shows real files even when /tmp/ has a virtual entry', async () => {
    const fs = new MemoryFs()
    const proc = new ProcFileHandler()
    proc.register('/tmp/somevirtual', () => 'x')
    const vfs = new VirtualFs(fs, proc, null)
    const shell = new ClawserShell({ fs: vfs })
    await shell.exec('echo hello > /tmp/foo.txt')
    const r = await shell.exec('ls /tmp/')
    assert.match(r.stdout, /foo\.txt/, 'real file must not be hidden by virtual sibling')
    assert.match(r.stdout, /somevirtual/, 'virtual sibling must also appear')
  })

  it('virtual entry wins on name collision (consistent with prior precedence)', async () => {
    // If a real file shares a name with a proc generator, the proc one
    // takes precedence — same direction as the original code's intent,
    // just no longer at the cost of hiding all the other real files.
    const fs = new MemoryFs()
    const proc = new ProcFileHandler()
    proc.register('/colliding', () => 'virtual')
    const vfs = new VirtualFs(fs, proc, null)
    await vfs.realFs.writeFile('/colliding', 'real') // pre-existing real file at same name
    const shell = new ClawserShell({ fs: vfs })
    const r = await shell.exec('ls /')
    // 'colliding' appears exactly once
    const lines = r.stdout.split('\n').filter(Boolean)
    const occurrences = lines.filter(l => l === 'colliding').length
    assert.equal(occurrences, 1)
  })

  it('falls back to realFs error when path is unknown to all sources', async () => {
    const fs = new MemoryFs()
    const proc = new ProcFileHandler()
    const vfs = new VirtualFs(fs, proc, null)
    const shell = new ClawserShell({ fs: vfs })
    const r = await shell.exec('ls /nope')
    assert.match(r.stderr, /No such file/)
    assert.equal(r.exitCode, 1)
  })
})
