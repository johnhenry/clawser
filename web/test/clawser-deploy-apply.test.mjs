// clawser-deploy-apply.test.mjs

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  handleSkillItem,
  handleConfigItem,
  handleMemoryItem,
  createApplyTransport,
} from '../clawser-deploy-apply.mjs'
import { buildCapabilityToken } from '../clawser-deploy-target.mjs'

const FULL_TOKEN = buildCapabilityToken({
  capabilities: {
    config: ['autonomy', 'security'],
    memory: ['learned', 'context'],
  },
})

// ── Skill handler ────────────────────────────────────────────────

describe('handleSkillItem', () => {
  it('persists files via skillsAPI.writeSkill', async () => {
    let called = null
    const ctx = {
      wsId: 'default',
      skillsAPI: { writeSkill: async (scope, wsId, name, files) => { called = { scope, wsId, name, files: [...files.entries()] } } },
    }
    const item = { itemId: 'my-skill', payload: { files: { 'SKILL.md': '# Hi', 'script.js': 'console.log(1)' } } }
    const r = await handleSkillItem(item, FULL_TOKEN, ctx)
    assert.equal(r.ok, true)
    assert.deepEqual(called.name, 'my-skill')
    assert.equal(called.scope, 'workspace')
    assert.equal(called.wsId, 'default')
    assert.equal(called.files.length, 2)
  })

  it('honors scope: global', async () => {
    let scope = null
    const ctx = { wsId: 'default', skillsAPI: { writeSkill: async (s) => { scope = s } } }
    await handleSkillItem({ itemId: 's', payload: { files: { 'SKILL.md': 'x' }, scope: 'global' } }, FULL_TOKEN, ctx)
    assert.equal(scope, 'global')
  })

  it('rejects malformed payloads', async () => {
    const ctx = { wsId: 'default', skillsAPI: { writeSkill: async () => {} } }
    let r = await handleSkillItem({ itemId: 's', payload: null }, FULL_TOKEN, ctx)
    assert.equal(r.ok, false)
    r = await handleSkillItem({ itemId: 's', payload: {} }, FULL_TOKEN, ctx)
    assert.equal(r.ok, false)
    r = await handleSkillItem({ itemId: 's', payload: { files: {} } }, FULL_TOKEN, ctx)
    assert.equal(r.ok, false)
  })

  it('drops non-string file content (defense)', async () => {
    let captured = null
    const ctx = { wsId: 'default', skillsAPI: { writeSkill: async (s, w, n, f) => { captured = f } } }
    await handleSkillItem({ itemId: 's', payload: { files: { 'a.txt': 'hi', 'b.bin': 42, 'c.txt': 'ok' } } }, FULL_TOKEN, ctx)
    const names = [...captured.keys()]
    assert.deepEqual(names.sort(), ['a.txt', 'c.txt'])
  })
})

// ── Config handler ───────────────────────────────────────────────

describe('handleConfigItem', () => {
  let writes
  let ctx
  beforeEach(() => {
    writes = []
    ctx = {
      wsId: 'default',
      writeConfig: async (domain, wsId, value) => writes.push({ domain, wsId, value }),
    }
  })

  it('writes the config when domain is known + capability granted', async () => {
    const r = await handleConfigItem(
      { itemId: 'autonomy', payload: { level: 'supervised' } },
      FULL_TOKEN, ctx,
    )
    assert.equal(r.ok, true)
    assert.equal(writes.length, 1)
    assert.equal(writes[0].domain, 'autonomy')
    assert.deepEqual(writes[0].value, { level: 'supervised' })
  })

  it('rejects unknown domains', async () => {
    const r = await handleConfigItem(
      { itemId: 'definitely-not-a-domain', payload: 1 }, FULL_TOKEN, ctx,
    )
    assert.equal(r.ok, false)
    assert.match(r.error, /unknown domain/)
    assert.equal(writes.length, 0)
  })

  it('rejects when capability not granted', async () => {
    // Token does NOT include 'identity' in config caps
    const r = await handleConfigItem(
      { itemId: 'identity', payload: { name: 'X' } },
      FULL_TOKEN, ctx,
    )
    assert.equal(r.ok, false)
    assert.match(r.error, /capability not granted/)
    assert.match(r.error, /manifest\.capabilities\.config/)
  })

  it('rejects malformed itemId', async () => {
    const r = await handleConfigItem({ itemId: '', payload: {} }, FULL_TOKEN, ctx)
    assert.equal(r.ok, false)
  })
})

// ── Memory handler ───────────────────────────────────────────────

describe('handleMemoryItem', () => {
  let stored
  let ctx
  beforeEach(() => {
    stored = []
    ctx = { wsId: 'default', agent: { memoryStore: (entry) => { stored.push(entry); return 'mem-id' } } }
  })

  it('persists when category is granted', async () => {
    const r = await handleMemoryItem(
      { itemId: 'm1', payload: { key: 'preference', content: 'dark mode', category: 'learned' } },
      FULL_TOKEN, ctx,
    )
    assert.equal(r.ok, true)
    assert.equal(stored.length, 1)
    assert.equal(stored[0].key, 'preference')
  })

  it('default category is "learned"', async () => {
    const r = await handleMemoryItem(
      { itemId: 'm', payload: { key: 'k', content: 'c' } },
      FULL_TOKEN, ctx,
    )
    assert.equal(r.ok, true)
    assert.equal(stored[0].category, 'learned')
  })

  it('rejects when category not granted', async () => {
    // 'core' is not in FULL_TOKEN.memory
    const r = await handleMemoryItem(
      { itemId: 'm', payload: { key: 'k', content: 'c', category: 'core' } },
      FULL_TOKEN, ctx,
    )
    assert.equal(r.ok, false)
    assert.match(r.error, /capability not granted/)
    assert.match(r.error, /manifest\.capabilities\.memory/)
  })

  it('rejects malformed payload', async () => {
    let r = await handleMemoryItem({ itemId: 'm', payload: null }, FULL_TOKEN, ctx)
    assert.equal(r.ok, false)
    r = await handleMemoryItem({ itemId: 'm', payload: { content: 'x' } }, FULL_TOKEN, ctx)
    assert.equal(r.ok, false)
    r = await handleMemoryItem({ itemId: 'm', payload: { key: 'k' } }, FULL_TOKEN, ctx)
    assert.equal(r.ok, false)
  })
})

// ── createApplyTransport ─────────────────────────────────────────

describe('createApplyTransport', () => {
  it('dispatches by item.itemKind to the matching handler', async () => {
    const calls = []
    const handlers = {
      skill: async (item) => { calls.push(['skill', item.itemId]); return { ok: true } },
      config: async (item) => { calls.push(['config', item.itemId]); return { ok: true } },
    }
    const transport = createApplyTransport({ ctx: { wsId: 'd' }, handlers })
    const r = await transport.applyBatch([
      { itemKind: 'skill', itemId: 's1', capabilities: FULL_TOKEN },
      { itemKind: 'config', itemId: 'autonomy', capabilities: FULL_TOKEN },
    ])
    assert.equal(r.ok, true)
    assert.deepEqual(r.applied, ['s1', 'autonomy'])
    assert.deepEqual(calls, [['skill', 's1'], ['config', 'autonomy']])
  })

  it('falls back to item.kind when itemKind is absent', async () => {
    const calls = []
    const handlers = { skill: async () => { calls.push('skill'); return { ok: true } } }
    const transport = createApplyTransport({ ctx: { wsId: 'd' }, handlers })
    await transport.applyBatch([{ kind: 'skill', itemId: 's1', capabilities: FULL_TOKEN }])
    assert.deepEqual(calls, ['skill'])
  })

  it('any-item failure → batch fails (atomic)', async () => {
    const handlers = {
      skill: async () => ({ ok: true }),
      config: async () => ({ ok: false, error: 'simulated' }),
    }
    const transport = createApplyTransport({ ctx: { wsId: 'd' }, handlers })
    const r = await transport.applyBatch([
      { itemKind: 'skill', itemId: 's1', capabilities: FULL_TOKEN },
      { itemKind: 'config', itemId: 'autonomy', capabilities: FULL_TOKEN },
    ])
    assert.equal(r.ok, false)
    assert.match(r.error, /simulated/)
  })

  it('a thrown handler reports as error (no leak)', async () => {
    const handlers = { config: async () => { throw new Error('boom') } }
    const transport = createApplyTransport({ ctx: { wsId: 'd' }, handlers })
    const r = await transport.applyBatch([
      { itemKind: 'config', itemId: 'autonomy', capabilities: FULL_TOKEN },
    ])
    assert.equal(r.ok, false)
    assert.match(r.error, /boom/)
  })

  it('unknown kind reported, not swallowed', async () => {
    const transport = createApplyTransport({ ctx: { wsId: 'd' } })
    const r = await transport.applyBatch([{ itemKind: 'unknown-kind', itemId: 'x' }])
    assert.equal(r.ok, false)
    assert.match(r.error, /no handler for kind/)
  })
})
