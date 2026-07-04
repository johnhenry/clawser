// clawser-skills-cap-integration.test.mjs — capability gating threaded
// through skill execution + deploy-target → SkillScriptTool integration

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { executeSkillScript } from '../clawser-skills.js'
import { buildCapabilityToken, acceptPackage, DeployAcl, DeployApprovals, DeployAuditLog, DeploySnapshotRing } from '../clawser-deploy-target.mjs'
import { buildSignedPackage, verifySignedPackage, ReplayCounterTracker } from '../clawser-deploy-package.mjs'

const enc = new TextEncoder()
const memStorage = () => {
  const map = new Map()
  return { async read(k) { return map.has(k) ? map.get(k) : null }, async write(k, v) { map.set(k, v) } }
}

const makeFs = () => ({
  reads: [],
  writes: [],
  async readFile(path) { this.reads.push(path); return `content-of-${path}` },
  async writeFile(path, data) { this.writes.push({ path, data }) },
})

// ── executeSkillScript — local skills (unchanged) ─────────────────

describe('executeSkillScript — local skill (no capabilities)', () => {
  // Without `capabilities`, executeSkillScript falls into the andbox
  // sandbox path. In a Node test env without `andbox` installed, this
  // path will fail to import; we verify that the error is reported
  // cleanly through `success: false` rather than crashing the runner —
  // proving the local-skill code path still exists and uses the legacy
  // sandbox (not the gated path).
  it('uses the andbox sandbox path (no gated globals exposed)', async () => {
    const r = await executeSkillScript('return 1+1', '')
    // Either andbox is available (success) or it's a missing-module
    // error (failure with a clear message). Both are valid signals
    // that we didn't go down the capability-gated path.
    if (r.success) {
      // Worker sandbox actually ran — output should be '2'
      assert.equal(r.output, '2')
    } else {
      assert.match(r.error, /andbox|sandbox|worker|require|import/i)
    }
    // The KEY assertion: there's no "Capability not granted" error,
    // because we didn't go through the gated path.
    assert.doesNotMatch(r.error || '', /Capability not granted/)
  })
})

// ── executeSkillScript — deployed skills (gated) ──────────────────

describe('executeSkillScript — deployed skill (capability gated)', () => {
  it('FS cap "/tmp/foo" allows /tmp/foo/bar.txt and rejects /tmp/baz', async () => {
    const fs = makeFs()
    const caps = buildCapabilityToken({ capabilities: { fs: ['/tmp/foo'] } })

    const ok = await executeSkillScript(
      `return await fs.readFile("/tmp/foo/bar.txt")`,
      '',
      { capabilities: caps, capabilityHooks: { fs } },
    )
    assert.equal(ok.success, true)
    assert.equal(ok.output, 'content-of-/tmp/foo/bar.txt')

    const denied = await executeSkillScript(
      `return await fs.readFile("/tmp/baz")`,
      '',
      { capabilities: caps, capabilityHooks: { fs } },
    )
    assert.equal(denied.success, false)
    assert.match(denied.error, /Capability not granted: fs/)
    assert.match(denied.error, /\/tmp\/baz/)
    assert.match(denied.error, /manifest\.capabilities\.fs/)
  })

  it('no network cap → fetch throws with manifest pointer', async () => {
    const caps = buildCapabilityToken({ capabilities: {} })
    const r = await executeSkillScript(
      `return await fetch("https://api.example.com/")`,
      '',
      { capabilities: caps, capabilityHooks: { fetch: async () => ({ ok: true }) } },
    )
    assert.equal(r.success, false)
    assert.match(r.error, /Capability not granted: net/)
    assert.match(r.error, /api\.example\.com/)
    assert.match(r.error, /manifest\.capabilities\.net/)
  })

  it('granted network cap → fetch reaches the inner impl', async () => {
    const caps = buildCapabilityToken({ capabilities: { net: ['api.example.com'] } })
    const r = await executeSkillScript(
      `const res = await fetch("https://api.example.com/x"); return res.bodyText`,
      '',
      {
        capabilities: caps,
        capabilityHooks: { fetch: async () => ({ bodyText: 'pong' }) },
      },
    )
    assert.equal(r.success, true)
    assert.equal(r.output, 'pong')
  })

  it('mesh cap gating respects exact-string allowlist', async () => {
    const caps = buildCapabilityToken({ capabilities: { mesh: ['mesh:peer-list'] } })
    const ok = await executeSkillScript(
      `return await mesh.call("mesh:peer-list", {})`,
      '',
      { capabilities: caps, capabilityHooks: { meshCall: async () => ['p1', 'p2'] } },
    )
    assert.equal(ok.success, true)
    const denied = await executeSkillScript(
      `return await mesh.call("mesh:dangerous", {})`,
      '',
      { capabilities: caps, capabilityHooks: { meshCall: async () => 'bad' } },
    )
    assert.equal(denied.success, false)
    assert.match(denied.error, /mesh/i)
  })

  it('skill input is exposed to the gated runner', async () => {
    const caps = buildCapabilityToken({ capabilities: {} })
    const r = await executeSkillScript(`return input.toUpperCase()`, 'hi there', { capabilities: caps })
    assert.equal(r.success, true)
    assert.equal(r.output, 'HI THERE')
  })
})

// ── deploy-target → SkillScriptTool integration ──────────────────

describe('acceptPackage threads manifest capabilities into the apply batch', () => {
  it('the items handed to applyBatch carry the manifest capability token', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const did = 'did:key:z6MkTest'
    const pkg = await buildSignedPackage({
      source: did, privateKey: kp.privateKey, counter: 1,
      manifest: {
        sourceLabel: 'Mac',
        items: [{ kind: 'skill', itemId: 'my-deployed-skill' }],
        capabilities: {
          fs: ['/workspace/skills/'],
          net: ['*.api.example.com'],
          mesh: ['mesh:peer-list'],
        },
        createdAt: 1,
      },
      payloads: { 'my-deployed-skill': enc.encode(`return await fetch("https://x.api.example.com/")`) },
    })

    const storage = memStorage()
    const aclMod = new DeployAcl(storage)
    await aclMod.grant(did)
    const captured = []
    const ctx = {
      packageVerifier: { verifySignedPackage },
      replay: new ReplayCounterTracker(storage),
      acl: aclMod,
      approvals: new DeployApprovals(storage),
      audit: new DeployAuditLog(storage, { cap: 100 }),
      snapshots: new DeploySnapshotRing(storage, { delete: async () => {}, restore: async () => {} }),
      resolvePublicKey: async () => kp.publicKey,
      promptApprove: async () => true,
      applyTransport: {
        applyBatch: async (items) => {
          captured.push(...items)
          return { ok: true, applied: items.map(i => i.itemId), snapshotId: 'snap-1' }
        },
      },
    }

    const r = await acceptPackage(pkg, ctx)
    assert.equal(r.ok, true)
    assert.equal(captured.length, 1)
    const item = captured[0]
    assert.equal(item.itemId, 'my-deployed-skill')
    assert.deepEqual(item.capabilities.fs, ['/workspace/skills/'])
    assert.deepEqual(item.capabilities.net, ['*.api.example.com'])
    assert.deepEqual(item.capabilities.mesh, ['mesh:peer-list'])
    assert.equal(item.itemKind, 'skill')
  })

  it('end-to-end: capabilities from a deployed manifest gate the eventual skill execution', async () => {
    // 1. Source builds & signs a deployed skill that does `fetch`
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const did = 'did:key:z6MkTest2'
    const skillSource = `const res = await fetch("https://api.example.com/v1"); return res.bodyText`
    const pkg = await buildSignedPackage({
      source: did, privateKey: kp.privateKey, counter: 1,
      manifest: {
        sourceLabel: 'Mac',
        items: [{ kind: 'skill', itemId: 'gated-skill' }],
        capabilities: { net: ['api.example.com'] },
        createdAt: 1,
      },
      payloads: { 'gated-skill': enc.encode(skillSource) },
    })

    // 2. Target accepts it; capture the items + capabilities the apply
    //    batch would have stored.
    const storage = memStorage()
    const aclMod = new DeployAcl(storage)
    await aclMod.grant(did)
    let captured = null
    const ctx = {
      packageVerifier: { verifySignedPackage },
      replay: new ReplayCounterTracker(storage),
      acl: aclMod,
      approvals: new DeployApprovals(storage),
      audit: new DeployAuditLog(storage, { cap: 100 }),
      snapshots: new DeploySnapshotRing(storage, { delete: async () => {}, restore: async () => {} }),
      resolvePublicKey: async () => kp.publicKey,
      promptApprove: async () => true,
      applyTransport: {
        applyBatch: async (items) => {
          captured = items[0] // single item for this test
          return { ok: true, applied: ['gated-skill'], snapshotId: 'snap-1' }
        },
      },
    }
    const r = await acceptPackage(pkg, ctx)
    assert.equal(r.ok, true)

    // 3. Later, the skill is launched. The store's recorded
    //    `capabilities` token is passed to executeSkillScript. Allowed
    //    host → success.
    const decoded = new TextDecoder().decode(captured.payload)
    const allowed = await executeSkillScript(decoded, '', {
      capabilities: captured.capabilities,
      capabilityHooks: { fetch: async () => ({ bodyText: 'allowed-ok' }) },
    })
    assert.equal(allowed.success, true)
    assert.equal(allowed.output, 'allowed-ok')

    // 4. If we tamper with the recorded capabilities (e.g. a test of a
    //    different deployed skill that didn't request 'api.example.com'),
    //    fetch is denied with the manifest pointer.
    const wronglyDeployed = await executeSkillScript(decoded, '', {
      capabilities: buildCapabilityToken({ capabilities: { net: ['only.elsewhere.com'] } }),
      capabilityHooks: { fetch: async () => ({ bodyText: 'should-not-reach' }) },
    })
    assert.equal(wronglyDeployed.success, false)
    assert.match(wronglyDeployed.error, /api\.example\.com/)
    assert.match(wronglyDeployed.error, /manifest\.capabilities\.net/)
  })
})
