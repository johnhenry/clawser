// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-e2e-tools.test.mjs
//
// E2E: Tool execution — BrowserToolRegistry with fs_write → fs_read →
// verify content, permission system, and tool listing.
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  BrowserTool,
  BrowserToolRegistry,
  WorkspaceFs,
} from '../clawser-tools.js'

// ── Stub OPFS ────────────────────────────────────────────────────
// Tools call opfsWalk / opfsWalkDir which need navigator.storage.
// We stub at the OPFS file handle level.

class InMemoryFileHandle {
  #content
  constructor(content = '') { this.#content = content }
  async getFile() {
    return { text: async () => this.#content, size: this.#content.length }
  }
  async createWritable() {
    const self = this
    let buf = ''
    return {
      write(data) { buf += data },
      close() { self.#content = buf },
    }
  }
}

class InMemoryDirHandle {
  #entries = new Map()

  async getDirectoryHandle(name, opts) {
    if (this.#entries.has(name) && this.#entries.get(name) instanceof InMemoryDirHandle) {
      return this.#entries.get(name)
    }
    if (opts?.create) {
      const dir = new InMemoryDirHandle()
      this.#entries.set(name, dir)
      return dir
    }
    throw new Error(`Directory not found: ${name}`)
  }

  async getFileHandle(name, opts) {
    if (this.#entries.has(name) && this.#entries.get(name) instanceof InMemoryFileHandle) {
      return this.#entries.get(name)
    }
    if (opts?.create) {
      const fh = new InMemoryFileHandle()
      this.#entries.set(name, fh)
      return fh
    }
    throw new Error(`File not found: ${name}`)
  }
}

// ── Custom test tools ────────────────────────────────────────────

class EchoTool extends BrowserTool {
  get name() { return 'echo_tool' }
  get description() { return 'Echoes input back' }
  get parameters() {
    return {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    }
  }
  get permission() { return 'read' }
  get idempotent() { return true }

  async execute({ text }) {
    return { success: true, output: `Echo: ${text}` }
  }
}

class WriteTool extends BrowserTool {
  #store
  constructor(store) { super(); this.#store = store }

  get name() { return 'mem_write' }
  get description() { return 'Write to in-memory store' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['key', 'value'],
    }
  }
  get permission() { return 'write' }

  async execute({ key, value }) {
    this.#store.set(key, value)
    return { success: true, output: `Wrote ${key}` }
  }
}

class ReadTool extends BrowserTool {
  #store
  constructor(store) { super(); this.#store = store }

  get name() { return 'mem_read' }
  get description() { return 'Read from in-memory store' }
  get parameters() {
    return {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
    }
  }
  get permission() { return 'read' }
  get idempotent() { return true }

  async execute({ key }) {
    const val = this.#store.get(key)
    if (val === undefined) return { success: false, output: '', error: `Key not found: ${key}` }
    return { success: true, output: val }
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('E2E — Tool Execution', () => {
  let registry, store

  beforeEach(() => {
    registry = new BrowserToolRegistry()
    store = new Map()
    registry.register(new EchoTool())
    registry.register(new WriteTool(store))
    registry.register(new ReadTool(store))
  })

  it('write → read round-trip through tool registry', async () => {
    const writeTool = registry.get('mem_write')
    const readTool = registry.get('mem_read')

    const writeResult = await writeTool.execute({ key: 'greeting', value: 'Hello, world!' })
    assert.ok(writeResult.success)

    const readResult = await readTool.execute({ key: 'greeting' })
    assert.ok(readResult.success)
    assert.equal(readResult.output, 'Hello, world!')
  })

  it('reading non-existent key returns error', async () => {
    const readTool = registry.get('mem_read')
    const result = await readTool.execute({ key: 'missing' })
    assert.ok(!result.success)
    assert.ok(result.error.includes('not found'))
  })

  it('registry lists all tool specs', () => {
    const specs = registry.allSpecs()
    const names = specs.map(s => s.name)
    assert.ok(names.includes('echo_tool'))
    assert.ok(names.includes('mem_write'))
    assert.ok(names.includes('mem_read'))
    assert.equal(specs.length, 3)
  })

  it('tool spec includes correct metadata', () => {
    const spec = registry.getSpec('echo_tool')
    assert.ok(spec)
    assert.equal(spec.name, 'echo_tool')
    assert.equal(spec.description, 'Echoes input back')
    assert.ok(spec.parameters.properties.text)
    assert.equal(spec.required_permission, 'read')
  })

  // ── Permission system ─────────────────────────────────────────

  it('default permission for read tools is auto', () => {
    assert.equal(registry.getPermission('echo_tool'), 'auto')
    assert.equal(registry.getPermission('mem_read'), 'auto')
  })

  it('default permission for write tools is approve', () => {
    assert.equal(registry.getPermission('mem_write'), 'approve')
  })

  it('setPermission overrides defaults', () => {
    registry.setPermission('mem_write', 'auto')
    assert.equal(registry.getPermission('mem_write'), 'auto')

    registry.setPermission('echo_tool', 'denied')
    assert.equal(registry.getPermission('echo_tool'), 'denied')
  })

  it('resetAllPermissions clears overrides', () => {
    registry.setPermission('mem_write', 'auto')
    registry.setPermission('echo_tool', 'denied')

    registry.resetAllPermissions()

    assert.equal(registry.getPermission('mem_write'), 'approve') // back to default
    assert.equal(registry.getPermission('echo_tool'), 'auto')   // back to default
  })

  it('loadPermissions restores saved overrides', () => {
    const saved = { mem_write: 'auto', echo_tool: 'denied' }
    registry.loadPermissions(saved)

    assert.equal(registry.getPermission('mem_write'), 'auto')
    assert.equal(registry.getPermission('echo_tool'), 'denied')
  })

  it('getAllPermissions returns current overrides', () => {
    registry.setPermission('echo_tool', 'denied')
    const perms = registry.getAllPermissions()
    assert.equal(perms.echo_tool, 'denied')
    assert.ok(!perms.mem_read, 'non-overridden tools should not appear')
  })

  // ── Registration / unregistration ─────────────────────────────

  it('unregister removes a tool', () => {
    assert.ok(registry.has('echo_tool'))
    registry.unregister('echo_tool')
    assert.ok(!registry.has('echo_tool'))
    assert.equal(registry.get('echo_tool'), null)
  })

  it('registering a new tool makes it immediately available', () => {
    class CustomTool extends BrowserTool {
      get name() { return 'custom_tool' }
      get description() { return 'Custom' }
      get permission() { return 'internal' }
      async execute() { return { success: true, output: 'custom' } }
    }

    registry.register(new CustomTool())
    assert.ok(registry.has('custom_tool'))

    const spec = registry.getSpec('custom_tool')
    assert.equal(spec.name, 'custom_tool')
  })

  // ── Multiple write/read operations ────────────────────────────

  it('multiple writes then reads: all keys preserved', async () => {
    const writeTool = registry.get('mem_write')
    const readTool = registry.get('mem_read')

    await writeTool.execute({ key: 'a', value: 'alpha' })
    await writeTool.execute({ key: 'b', value: 'beta' })
    await writeTool.execute({ key: 'c', value: 'gamma' })

    const a = await readTool.execute({ key: 'a' })
    const b = await readTool.execute({ key: 'b' })
    const c = await readTool.execute({ key: 'c' })

    assert.equal(a.output, 'alpha')
    assert.equal(b.output, 'beta')
    assert.equal(c.output, 'gamma')
  })

  it('overwriting a key updates the value', async () => {
    const writeTool = registry.get('mem_write')
    const readTool = registry.get('mem_read')

    await writeTool.execute({ key: 'x', value: 'original' })
    await writeTool.execute({ key: 'x', value: 'updated' })

    const result = await readTool.execute({ key: 'x' })
    assert.equal(result.output, 'updated')
  })

  // ── WorkspaceFs path resolution ───────────────────────────────

  it('WorkspaceFs.resolve strips traversal segments', () => {
    const ws = new WorkspaceFs()
    ws.setWorkspace('test-ws')

    const resolved = ws.resolve('../../etc/passwd')
    assert.ok(!resolved.includes('..'), 'should not contain ..')
    assert.ok(resolved.startsWith('clawser/workspaces/test-ws'))
  })

  it('WorkspaceFs.resolve normalizes leading slashes', () => {
    const ws = new WorkspaceFs()
    ws.setWorkspace('ws1')

    const a = ws.resolve('/notes/todo.md')
    const b = ws.resolve('notes/todo.md')
    assert.equal(a, b, 'leading slash should be stripped')
  })

  it('WorkspaceFs.isInternalPath identifies system dirs', () => {
    assert.ok(WorkspaceFs.isInternalPath('.checkpoints/backup'))
    assert.ok(WorkspaceFs.isInternalPath('.conversations/abc'))
    assert.ok(WorkspaceFs.isInternalPath('.skills/my-skill'))
    assert.ok(WorkspaceFs.isInternalPath('.agents/agent1'))
    assert.ok(!WorkspaceFs.isInternalPath('notes/todo.md'))
    assert.ok(!WorkspaceFs.isInternalPath('projects/app'))
  })
})
