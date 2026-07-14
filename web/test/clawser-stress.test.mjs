// clawser-stress.test.mjs — concurrency/scale stress suite (mesh Phase 11
// Batch E). Deliberately excluded from the `fast`/`core` groups (large
// loops take longer than a typical feedback-loop run) — run explicitly
// with `npm run test:stress` or as part of `slow`/`all`.
//
// These assert COMPLETION and CORRECTNESS at scale, not tight performance
// numbers — timing assertions are intentionally absent/generous per the
// project's flake-avoidance convention; a hang is still caught by the
// test runner's per-file timeout.
//
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-stress.test.mjs

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

globalThis.BrowserTool = globalThis.BrowserTool || class { constructor() {} }

// ═══════════════════════════════════════════════════════════════════════
// (a) 100 paired devices — PairedDevicesStore + in-memory storage fixture
// ═══════════════════════════════════════════════════════════════════════

import { PairedDevicesStore } from '../clawser-paired-devices.mjs'

function memStorage() {
  const map = new Map()
  return {
    async read(name) { return map.has(name) ? map.get(name) : null },
    async write(name, bytes) { map.set(name, bytes) },
  }
}

describe('Stress: 100 paired devices', () => {
  it('registers 100 devices with unique auto-generated deviceIds', async () => {
    const store = new PairedDevicesStore(memStorage())

    for (let i = 0; i < 100; i++) {
      await store.add({ label: `device-${i}`, peerPublicKey: `pk-${i}` })
    }

    const entries = await store.list()
    assert.equal(entries.length, 100)

    const ids = new Set(entries.map(e => e.deviceId))
    assert.equal(ids.size, 100, 'every deviceId must be unique')

    const labels = new Set(entries.map(e => e.label))
    assert.equal(labels.size, 100)
  })

  it('persists across a fresh store instance backed by the same storage', async () => {
    const storage = memStorage()
    const store = new PairedDevicesStore(storage)
    for (let i = 0; i < 100; i++) {
      await store.add({ label: `device-${i}` })
    }

    const reloaded = new PairedDevicesStore(storage)
    const entries = await reloaded.list()
    assert.equal(entries.length, 100)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// (b) 1,000 skills — SkillStorage.writeSkill against a mock OPFS tree
// ═══════════════════════════════════════════════════════════════════════

import { SkillStorage } from '../clawser-skills.js'

// Minimal OPFS directory/file handle mocks — flat structure only (every
// skill here writes a single SKILL.md, no nested scripts/ subdirs), so
// this is deliberately lighter than clawser-skills.test.mjs's fixture.
function createFileHandle(content) {
  let stored = content
  return {
    kind: 'file',
    getFile() { return { text: async () => stored, arrayBuffer: async () => new TextEncoder().encode(stored).buffer } },
    async createWritable() {
      return { async write(data) { stored = data }, async close() {} }
    },
  }
}

function createDirHandle() {
  const dirs = {}
  const files = {}
  return {
    kind: 'directory',
    async getDirectoryHandle(name, opts) {
      if (dirs[name]) return dirs[name]
      if (opts?.create) { dirs[name] = createDirHandle(); return dirs[name] }
      throw new DOMException(`Not found: ${name}`, 'NotFoundError')
    },
    async getFileHandle(name, opts) {
      if (files[name]) return files[name]
      if (opts?.create) { const fh = createFileHandle(''); files[name] = fh; return fh }
      throw new DOMException(`Not found: ${name}`, 'NotFoundError')
    },
    async removeEntry(name) { delete dirs[name]; delete files[name] },
    async *[Symbol.asyncIterator]() {
      for (const [name, dir] of Object.entries(dirs)) yield [name, dir]
      for (const [name, file] of Object.entries(files)) yield [name, file]
    },
  }
}

let origGetDirectory
function installMockOPFS(root) {
  origGetDirectory = navigator.storage.getDirectory
  navigator.storage.getDirectory = async () => root
}
function restoreOPFS() {
  if (origGetDirectory) {
    navigator.storage.getDirectory = origGetDirectory
    origGetDirectory = null
  }
}

describe('Stress: 1,000 skills', () => {
  it('writes and lists 1,000 global skills', async () => {
    installMockOPFS(createDirHandle())
    try {
      for (let i = 0; i < 1000; i++) {
        const files = new Map([['SKILL.md', `---\nname: skill-${i}\n---\nBody ${i}`]])
        await SkillStorage.writeSkill('global', null, `skill-${i}`, files)
      }

      const names = await SkillStorage.listSkillDirs('global')
      assert.equal(names.length, 1000)
      assert.ok(names.includes('skill-0'))
      assert.ok(names.includes('skill-999'))

      // Spot-check round-trip content on a few entries rather than all 1000.
      const sample = await SkillStorage.readSkill('global', null, 'skill-500')
      assert.match(sample.get('SKILL.md'), /name: skill-500/)
    } finally {
      restoreOPFS()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// (c) 10,000 audit chain entries — AuditChain append + full verify
// ═══════════════════════════════════════════════════════════════════════

import { AuditChain } from '../clawser-mesh-audit.js'

async function makeSignFn() {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const signFn = async (bytes) => new Uint8Array(await crypto.subtle.sign('Ed25519', keyPair.privateKey, bytes))
  return { keyPair, signFn }
}

describe('Stress: 10,000 audit chain entries', () => {
  it('appends 10,000 entries and verifies the full chain', async () => {
    const { keyPair, signFn } = await makeSignFn()
    const chain = new AuditChain('stress-chain')

    for (let i = 0; i < 10_000; i++) {
      await chain.append('pod-a', `op-${i % 50}`, { i }, signFn)
    }

    assert.equal(chain.length, 10_000)

    const result = await chain.verify(async () => keyPair.publicKey)
    assert.equal(result.valid, true)
  })

  it('fails verification against the wrong public key (signature check actually runs at scale)', async () => {
    const { signFn } = await makeSignFn()
    const chain = new AuditChain('stress-chain-tampered')

    for (let i = 0; i < 10_000; i++) {
      await chain.append('pod-a', `op-${i}`, { i }, signFn)
    }

    const wrongKeyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const result = await chain.verify(async () => wrongKeyPair.publicKey)
    assert.equal(result.valid, false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// (d) 100 MB MemoryFs — 100 x 1MB files + listDir
// ═══════════════════════════════════════════════════════════════════════

import { MemoryFs } from '../clawser-shell.js'

describe('Stress: 100MB MemoryFs', () => {
  it('writes 100 x 1MB files and lists them all', async () => {
    const fs = new MemoryFs()
    const oneMb = 'x'.repeat(1024 * 1024)

    for (let i = 0; i < 100; i++) {
      await fs.writeFile(`/stress-data/file-${i}.bin`, oneMb)
    }

    const entries = await fs.listDir('/stress-data')
    assert.equal(entries.length, 100)
    assert.ok(entries.every(e => e.kind === 'file'))

    // Spot-check a read-back rather than re-reading all 100 (redundant
    // with the write loop already having succeeded for each).
    const content = await fs.readFile('/stress-data/file-50.bin')
    assert.equal(content.length, 1024 * 1024)
  })
})
