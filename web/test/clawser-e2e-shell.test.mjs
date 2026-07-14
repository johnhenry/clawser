// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-e2e-shell.test.mjs
//
// E2E: Shell session exercising cd, ls, cat, echo, pipes, redirects,
// logical operators, and command history.
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  ClawserShell,
  MemoryFs,
  CommandRegistry,
  registerBuiltins,
} from '../clawser-shell.js'

describe('E2E — Shell Session', () => {
  let shell

  beforeEach(async () => {
    const fs = new MemoryFs()

    // Seed a realistic directory structure
    await fs.mkdir('/projects')
    await fs.mkdir('/projects/app')
    await fs.mkdir('/projects/app/src')
    await fs.writeFile('/projects/app/src/index.js', 'console.log("hello")')
    await fs.writeFile('/projects/app/package.json', '{"name":"app","version":"1.0.0"}')
    await fs.writeFile('/projects/app/README.md', '# App\n\nA sample project.')
    await fs.mkdir('/data')
    await fs.writeFile('/data/users.csv', 'name,age\nAlice,30\nBob,25\nCharlie,35')
    await fs.writeFile('/data/config.json', '{"debug":true,"port":8080}')

    shell = new ClawserShell({ fs })
  })

  // ── Basic navigation ──────────────────────────────────────────

  it('cd + ls: navigate into directory and list contents', async () => {
    const cd = await shell.exec('cd /projects/app')
    assert.equal(cd.exitCode, 0)

    const ls = await shell.exec('ls')
    assert.equal(ls.exitCode, 0)
    assert.ok(ls.stdout.includes('src'), 'should list src dir')
    assert.ok(ls.stdout.includes('package.json'), 'should list package.json')
    assert.ok(ls.stdout.includes('README.md'), 'should list README.md')
  })

  it('cd to non-existent directory fails', async () => {
    const result = await shell.exec('cd /nonexistent')
    assert.notEqual(result.exitCode, 0)
    assert.ok(result.stderr.length > 0, 'should output error message')
  })

  it('cd / returns to root', async () => {
    await shell.exec('cd /projects/app/src')
    const result = await shell.exec('cd /')
    assert.equal(result.exitCode, 0)

    const ls = await shell.exec('ls')
    assert.ok(ls.stdout.includes('projects'))
    assert.ok(ls.stdout.includes('data'))
  })

  // ── cat: read file contents ───────────────────────────────────

  it('cat reads file content', async () => {
    const result = await shell.exec('cat /projects/app/src/index.js')
    assert.equal(result.exitCode, 0)
    assert.ok(result.stdout.includes('console.log("hello")'))
  })

  it('cat non-existent file fails', async () => {
    const result = await shell.exec('cat /nonexistent.txt')
    assert.notEqual(result.exitCode, 0)
  })

  // ── echo ──────────────────────────────────────────────────────

  it('echo outputs text', async () => {
    const result = await shell.exec('echo Hello from shell')
    assert.equal(result.exitCode, 0)
    assert.ok(result.stdout.includes('Hello from shell'))
  })

  // ── Pipes ─────────────────────────────────────────────────────

  it('pipe: echo | cat passes data through', async () => {
    const result = await shell.exec('echo "piped content" | cat')
    assert.equal(result.exitCode, 0)
    assert.ok(result.stdout.includes('piped content'))
  })

  it('pipe: cat file | grep filters lines', async () => {
    const result = await shell.exec('cat /data/users.csv | grep Alice')
    assert.equal(result.exitCode, 0)
    assert.ok(result.stdout.includes('Alice'))
    assert.ok(!result.stdout.includes('Bob'), 'should not include non-matching lines')
  })

  it('multi-pipe: echo | grep | cat chains work', async () => {
    const result = await shell.exec('echo "line1\nline2\nline3" | grep line2 | cat')
    assert.equal(result.exitCode, 0)
    assert.ok(result.stdout.includes('line2'))
  })

  // ── Logical operators ─────────────────────────────────────────

  it('&& runs second command only on success', async () => {
    const result = await shell.exec('echo first && echo second')
    assert.equal(result.exitCode, 0)
    assert.ok(result.stdout.includes('second'))
  })

  it('&& stops on first failure', async () => {
    const result = await shell.exec('cat /nonexistent && echo should-not-run')
    assert.notEqual(result.exitCode, 0)
    assert.ok(!result.stdout.includes('should-not-run'))
  })

  it('|| runs second command only on failure', async () => {
    const result = await shell.exec('cat /nonexistent || echo fallback')
    // The || should cause the fallback to run
    assert.ok(result.stdout.includes('fallback'))
  })

  it('semicolon runs both commands regardless', async () => {
    const result = await shell.exec('echo one ; echo two')
    assert.equal(result.exitCode, 0)
    assert.ok(result.stdout.includes('two'))
  })

  // ── Redirects ─────────────────────────────────────────────────

  it('redirect > writes stdout to file', async () => {
    const result = await shell.exec('echo "redirected content" > /output.txt')
    assert.equal(result.exitCode, 0)

    const cat = await shell.exec('cat /output.txt')
    assert.equal(cat.exitCode, 0)
    assert.ok(cat.stdout.includes('redirected content'))
  })

  it('redirect >> appends to file', async () => {
    await shell.exec('echo "line1" > /append.txt')
    await shell.exec('echo "line2" >> /append.txt')

    const cat = await shell.exec('cat /append.txt')
    assert.equal(cat.exitCode, 0)
    assert.ok(cat.stdout.includes('line1'))
    assert.ok(cat.stdout.includes('line2'))
  })

  // ── Complex pipelines ─────────────────────────────────────────

  it('cd + cat + pipe: navigate then process file', async () => {
    await shell.exec('cd /data')

    const result = await shell.exec('cat config.json | grep port')
    assert.equal(result.exitCode, 0)
    assert.ok(result.stdout.includes('8080'))
  })

  // ── Command history ───────────────────────────────────────────

  it('shell records command history', async () => {
    await shell.exec('echo one')
    await shell.exec('echo two')
    await shell.exec('echo three')

    const histResult = await shell.exec('history')
    assert.equal(histResult.exitCode, 0)
    assert.ok(histResult.stdout.includes('echo one'))
    assert.ok(histResult.stdout.includes('echo two'))
    assert.ok(histResult.stdout.includes('echo three'))
  })

  // ── pwd ───────────────────────────────────────────────────────

  it('pwd shows current working directory', async () => {
    await shell.exec('cd /projects/app')
    const result = await shell.exec('pwd')
    assert.equal(result.exitCode, 0)
    assert.ok(result.stdout.includes('/projects/app'))
  })

  // ── mkdir + ls verify ─────────────────────────────────────────

  it('mkdir creates a new directory visible in ls', async () => {
    await shell.exec('mkdir /newdir')
    const ls = await shell.exec('ls /')
    assert.equal(ls.exitCode, 0)
    assert.ok(ls.stdout.includes('newdir'))
  })

  // ── Empty / whitespace commands ───────────────────────────────

  it('empty command returns exit code 0', async () => {
    const result = await shell.exec('')
    assert.equal(result.exitCode, 0)
  })

  it('whitespace-only command returns exit code 0', async () => {
    const result = await shell.exec('   ')
    assert.equal(result.exitCode, 0)
  })
})
