/**
 * Tests for the Clawser server-side kernel.
 *
 * Uses real file system operations in a temp directory.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ServerIdentity,
  ServerFileSystem,
  ServerAgent,
  PeerNodeServer,
  createServerKernel,
} from './index.mjs'

// ─── ServerIdentity ──────────────────────────────────────────────────

describe('ServerIdentity', () => {
  it('generates a unique identity', async () => {
    const id = await ServerIdentity.generate('test-node')
    assert.ok(id.podId.startsWith('pod-'))
    assert.equal(id.podId.length, 4 + 32) // 'pod-' + 32 hex chars
    assert.equal(id.label, 'test-node')
    assert.equal(typeof id.created, 'number')
  })

  it('generates different podIds each time', async () => {
    const a = await ServerIdentity.generate()
    const b = await ServerIdentity.generate()
    assert.notEqual(a.podId, b.podId)
  })

  it('serializes and deserializes via JSON', async () => {
    const original = await ServerIdentity.generate('json-test')
    const json = original.toJSON()
    const restored = ServerIdentity.fromJSON(json)

    assert.equal(restored.podId, original.podId)
    assert.equal(restored.label, original.label)
    assert.equal(restored.created, original.created)
  })

  it('constructs with explicit values', () => {
    const id = new ServerIdentity({ podId: 'pod-abc', label: 'custom', created: 1000 })
    assert.equal(id.podId, 'pod-abc')
    assert.equal(id.label, 'custom')
    assert.equal(id.created, 1000)
  })
})

// ─── ServerFileSystem ────────────────────────────────────────────────

describe('ServerFileSystem', () => {
  let tmpDir
  let fs

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'clawser-kernel-test-'))
    fs = new ServerFileSystem(tmpDir)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates root directory if it does not exist', () => {
    const newDir = join(tmpDir, 'subdir', 'nested')
    const fs2 = new ServerFileSystem(newDir)
    assert.equal(fs2.rootDir, newDir)
  })

  it('writes and reads a file', async () => {
    const writeResult = await fs.write('hello.txt', 'world')
    assert.equal(writeResult.success, true)
    assert.equal(typeof writeResult.size, 'number')

    const readResult = await fs.read('hello.txt')
    assert.equal(readResult.data, 'world')
    assert.equal(typeof readResult.size, 'number')
  })

  it('lists directory entries', async () => {
    await fs.write('a.txt', 'aaa')
    await fs.write('b.txt', 'bbb')

    const entries = await fs.list('.')
    const names = entries.map(e => e.name).sort()
    assert.ok(names.includes('a.txt'))
    assert.ok(names.includes('b.txt'))
  })

  it('returns empty list for non-existent directory', async () => {
    const entries = await fs.list('no-such-dir')
    assert.deepEqual(entries, [])
  })

  it('gets file stats', async () => {
    await fs.write('stat-test.txt', 'data')
    const stat = await fs.stat('stat-test.txt')
    assert.ok(stat)
    assert.equal(stat.name, 'stat-test.txt')
    assert.equal(stat.type, 'file')
    assert.equal(typeof stat.size, 'number')
    assert.equal(typeof stat.modified, 'number')
  })

  it('returns null stat for non-existent file', async () => {
    const stat = await fs.stat('no-such-file.txt')
    assert.equal(stat, null)
  })

  it('deletes a file', async () => {
    await fs.write('delete-me.txt', 'bye')
    const result = await fs.delete('delete-me.txt')
    assert.equal(result.success, true)

    const stat = await fs.stat('delete-me.txt')
    assert.equal(stat, null)
  })

  it('returns false when deleting non-existent file', async () => {
    const result = await fs.delete('no-file.txt')
    assert.equal(result.success, false)
  })

  it('creates nested directories on write', async () => {
    await fs.write('deep/nested/file.txt', 'deep')
    const result = await fs.read('deep/nested/file.txt')
    assert.equal(result.data, 'deep')
  })

  it('throws on read of non-existent file', async () => {
    await assert.rejects(
      () => fs.read('missing.txt'),
      (err) => err.message.includes('not found')
    )
  })

  it('prevents path traversal', async () => {
    await assert.rejects(
      () => fs.read('../../etc/passwd'),
      (err) => err.message.includes('traversal')
    )
  })
})

// ─── ServerAgent ─────────────────────────────────────────────────────

describe('ServerAgent', () => {
  it('has a name and system prompt', () => {
    const agent = new ServerAgent({ name: 'test-agent' })
    assert.equal(agent.name, 'test-agent')
    assert.ok(agent.systemPrompt.includes('test-agent'))
  })

  it('run returns an echo response', async () => {
    const agent = new ServerAgent({ name: 'echo' })
    const result = await agent.run('hello')
    assert.ok(result.response.includes('hello'))
    assert.ok(result.usage)
  })

  it('executeTool echo returns text', async () => {
    const agent = new ServerAgent({ name: 'tools' })
    const result = await agent.executeTool('echo', { text: 'hi' })
    assert.equal(result.success, true)
    assert.equal(result.output, 'hi')
  })

  it('executeTool time returns ISO string', async () => {
    const agent = new ServerAgent({ name: 'tools' })
    const result = await agent.executeTool('time', {})
    assert.equal(result.success, true)
    assert.ok(result.output.match(/^\d{4}-\d{2}-\d{2}T/))
  })

  it('executeTool info returns agent info', async () => {
    const agent = new ServerAgent({ name: 'info-agent' })
    const result = await agent.executeTool('info', {})
    assert.equal(result.success, true)
    const info = JSON.parse(result.output)
    assert.equal(info.agent, 'info-agent')
    assert.ok(Array.isArray(info.tools))
  })

  it('executeTool returns error for unknown tool', async () => {
    const agent = new ServerAgent({ name: 'tools' })
    const result = await agent.executeTool('nope', {})
    assert.equal(result.success, false)
    assert.ok(result.output.includes('unknown'))
  })

  it('searchMemories returns empty by default', () => {
    const agent = new ServerAgent({ name: 'mem' })
    const results = agent.searchMemories('anything')
    assert.deepEqual(results, [])
  })

  it('searchMemories finds added memories', () => {
    const agent = new ServerAgent({ name: 'mem' })
    agent.addMemory({ key: 'fact', content: 'The sky is blue' })
    agent.addMemory({ key: 'fact2', content: 'Water is wet' })

    const results = agent.searchMemories('sky')
    assert.equal(results.length, 1)
    assert.ok(results[0].content.includes('sky'))
  })
})

// ─── PeerNodeServer ──────────────────────────────────────────────────

describe('PeerNodeServer', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'clawser-peer-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('starts and stops', async () => {
    const identity = await ServerIdentity.generate('test')
    const peer = new PeerNodeServer({
      identity,
      dataDir: tmpDir,
      onLog: () => {},
    })

    assert.equal(peer.state, 'stopped')
    await peer.start()
    assert.equal(peer.state, 'running')
    await peer.stop()
    assert.equal(peer.state, 'stopped')
  })

  it('exposes identity properties', async () => {
    const identity = await ServerIdentity.generate('props-test')
    const peer = new PeerNodeServer({
      identity,
      dataDir: tmpDir,
      onLog: () => {},
    })

    assert.equal(peer.podId, identity.podId)
    assert.equal(peer.identity, identity)
  })

  it('has built-in fs and agent services', async () => {
    const identity = await ServerIdentity.generate('svc-test')
    const peer = new PeerNodeServer({
      identity,
      dataDir: tmpDir,
      onLog: () => {},
    })

    const services = peer.listServices()
    assert.ok(services.includes('fs'))
    assert.ok(services.includes('agent'))
  })

  it('registers and lists custom services', async () => {
    const identity = await ServerIdentity.generate('custom-svc')
    const peer = new PeerNodeServer({
      identity,
      dataDir: tmpDir,
      onLog: () => {},
    })

    peer.registerService('compute', { run: async () => ({ result: 42 }) })
    const services = peer.listServices()
    assert.ok(services.includes('compute'))
    assert.equal(peer.getService('compute').run !== undefined, true)
  })

  it('toJSON returns complete state', async () => {
    const identity = await ServerIdentity.generate('json-test')
    const peer = new PeerNodeServer({
      identity,
      dataDir: tmpDir,
      onLog: () => {},
    })

    await peer.start()
    const json = peer.toJSON()

    assert.equal(json.podId, identity.podId)
    assert.equal(json.label, identity.label)
    assert.equal(json.state, 'running')
    assert.ok(Array.isArray(json.services))
    assert.ok(Array.isArray(json.connectedPeers))
    assert.equal(typeof json.created, 'number')

    await peer.stop()
  })

  it('connectedPeers is empty by default', async () => {
    const identity = await ServerIdentity.generate('peers-test')
    const peer = new PeerNodeServer({
      identity,
      dataDir: tmpDir,
      onLog: () => {},
    })

    assert.deepEqual(peer.connectedPeers, [])
  })

  it('start is idempotent', async () => {
    const identity = await ServerIdentity.generate('idem-test')
    const peer = new PeerNodeServer({
      identity,
      dataDir: tmpDir,
      onLog: () => {},
    })

    await peer.start()
    await peer.start() // should not throw
    assert.equal(peer.state, 'running')
    await peer.stop()
  })

  it('stop is idempotent', async () => {
    const identity = await ServerIdentity.generate('idem-stop')
    const peer = new PeerNodeServer({
      identity,
      dataDir: tmpDir,
      onLog: () => {},
    })

    await peer.stop() // should not throw when already stopped
    assert.equal(peer.state, 'stopped')
  })
})

// ─── createServerKernel factory ──────────────────────────────────────

describe('createServerKernel', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'clawser-factory-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates a kernel with generated identity', async () => {
    const kernel = await createServerKernel({
      dataDir: tmpDir,
      label: 'factory-test',
      onLog: () => {},
    })

    assert.ok(kernel.podId.startsWith('pod-'))
    assert.equal(kernel.identity.label, 'factory-test')
    assert.equal(kernel.state, 'stopped')
  })

  it('creates a kernel with provided identity', async () => {
    const identity = await ServerIdentity.generate('provided')
    const kernel = await createServerKernel({
      identity,
      dataDir: tmpDir,
      onLog: () => {},
    })

    assert.equal(kernel.podId, identity.podId)
  })

  it('fs service works end-to-end', async () => {
    const kernel = await createServerKernel({
      dataDir: tmpDir,
      onLog: () => {},
    })

    const fsSvc = kernel.getService('fs')
    await fsSvc.write({ path: 'test.txt', data: 'hello from kernel' })
    const result = await fsSvc.read({ path: 'test.txt' })
    assert.equal(result.data, 'hello from kernel')
  })

  it('agent service works end-to-end', async () => {
    const kernel = await createServerKernel({
      dataDir: tmpDir,
      agentName: 'kernel-agent',
      onLog: () => {},
    })

    const agentSvc = kernel.getService('agent')
    const result = await agentSvc.run({ message: 'ping' })
    assert.ok(result.response.includes('ping'))
  })
})
