// clawser-multi-device-e2e.test.mjs — full source→target round-trip
// through the production code path: publishDeploy → pod.sendMessage →
// pod.onMessage → acceptPackage → applyTransport → audit log.
//
// Two simulated workspaces, two states, one shared identity. The
// transport between them is a tiny in-memory shim that mirrors what
// the production peerNode.onIncomingData → pod.onMessage chain
// does (parses JSON, dispatches by type).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { installMultiDeviceWiring, uninstallMultiDeviceWiring } from '../clawser-multi-device.mjs'
import { buildMyDevicesController, buildTrustedPublishersController } from '../clawser-multi-device-controllers.mjs'
import { resolveDidKey } from '../clawser-did-key.mjs'
import { MeshIdentityManager, InMemoryIdentityStorage } from '../clawser-mesh-identity.js'
import { showApprovalModal as _approvalModalUnused } from '../clawser-approval-modal.mjs'

// ── A pair of pods bound to each other via an in-memory wire ─────

function makePodPair() {
  // Each pod has a list of onMessage handlers and a sendMessage that
  // delivers (after a microtask) to the other pod's handlers. Matches
  // the production `peerNode.onIncomingData → pod.onMessage` contract.
  const handlersA = []
  const handlersB = []
  const podA = {
    selfId: 'peerA',
    _handlers: handlersA,
    onMessage: (handler) => {
      handlersA.push(handler)
      return () => { const i = handlersA.indexOf(handler); if (i >= 0) handlersA.splice(i, 1) }
    },
    sendMessage: async (peerId, envelope) => {
      // peerId is the remote's selfId — deliver to that pod's handlers.
      const target = peerId === 'peerB' ? podB : (peerId === 'peerA' ? podA : null)
      if (!target) throw new Error(`no active session for ${peerId}`)
      await Promise.resolve()
      // Mirror a structured-clone-capable transport (WebRTC datachannel binary
      // mode, structured-clone IPC). Preserves Uint8Array refs end-to-end so
      // the deploy package's payload bytes survive the wire.
      for (const h of target._handlers) {
        try { await h(envelope, 'peerA', { sessionId: 's', transport: 'mock' }) } catch (err) {
          console.warn('[e2e-test] handler threw:', err?.message || err)
        }
      }
    },
  }
  const podB = {
    selfId: 'peerB',
    _handlers: handlersB,
    onMessage: (handler) => {
      handlersB.push(handler)
      return () => { const i = handlersB.indexOf(handler); if (i >= 0) handlersB.splice(i, 1) }
    },
    sendMessage: async (peerId, envelope) => {
      const target = peerId === 'peerA' ? podA : (peerId === 'peerB' ? podB : null)
      if (!target) throw new Error(`no active session for ${peerId}`)
      await Promise.resolve()
      for (const h of target._handlers) {
        try { await h(envelope, 'peerB', { sessionId: 's', transport: 'mock' }) } catch (err) {
          console.warn('[e2e-test] handler threw:', err?.message || err)
        }
      }
    },
  }
  return { podA, podB }
}

// ── identity setup (shared between source + target) ──────────────

async function makeSharedIdentity() {
  const mgr = new MeshIdentityManager(new InMemoryIdentityStorage())
  const summary = await mgr.create('e2e-test')
  const jwk = await mgr.export(summary.podId)
  // The signing key is what publishDeploy needs.
  const signingKey = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign'])
  return { mgr, summary, signingKey }
}

// ── E2E ──────────────────────────────────────────────────────────

describe('multi-device deploy — full round-trip', () => {
  it('source install → mark for sync → Deploy now → target approve → applied → audit logged → rollback', async () => {
    const { podA, podB } = makePodPair()
    const id = await makeSharedIdentity()

    // Two workspace states. Source = stateS, target = stateT.
    const stateS = { pod: podA }
    const stateT = { pod: podB }

    // Capture what the apply transport persists on the target. We
    // use a tracking apply transport to assert the skill landed,
    // sidestepping the need for a real OPFS-backed SkillStorage.
    const appliedItems = []
    const targetApplyTransport = {
      async applyBatch(items) {
        for (const it of items) appliedItems.push({ kind: it.itemKind || it.kind, itemId: it.itemId, payload: it.payload })
        return { ok: true, applied: items.map(i => i.itemId), snapshotId: `snap-${appliedItems.length}` }
      },
    }

    // Mock snapshot driver so rollback works for the test.
    const restored = []
    const snapshotDriver = {
      delete: async () => {},
      restore: async (id) => { restored.push(id) },
    }

    // Install on source.
    installMultiDeviceWiring({
      pod: podA, state: stateS, wsId: 'wsS',
      // No applyTransport on source — source doesn't need one.
    })
    // Install on target (with the tracking apply transport + auto-approve).
    installMultiDeviceWiring({
      pod: podB, state: stateT, wsId: 'wsT',
      promptApprove: async () => true,        // auto-approve in tests
      applyTransport: targetApplyTransport,
      snapshotDriver,
      resolvePublicKey: resolveDidKey,
    })

    // Source: register the target as a paired device.
    await stateS.pairedDevices.add({
      deviceId: 'd-target', label: 'My Tablet',
      peerPublicKey: 'peerB',                  // matches the pod pair
      peerDid: id.summary.did,
    })

    // Target: trust the source's DID.
    await stateT.deployTarget.deployAcl.grant(id.summary.did, 'My Mac')

    // Source: build a controller and click "Deploy now" on the
    // target row, with a picker that auto-confirms a skill item.
    const skillPayload = { files: { 'SKILL.md': '# Code review skill', 'tool.js': 'export default {}' } }
    const ctrl = buildMyDevicesController({
      state: stateS,
      showPickerModalFn: async () => ({
        items: [{ kind: 'skill', itemId: 'code-review', payload: skillPayload }],
        manifest: {
          sourceLabel: 'My Mac',
          items: [{ kind: 'skill', itemId: 'code-review' }],
          capabilities: { fs: [], net: [], mesh: [], config: [], memory: [] },
          createdAt: Date.now(),
        },
      }),
      getSigningKey: async () => id.signingKey,
      getSourceDid: () => id.summary.did,
      resolveItems: async () => ({
        skills: [{ kind: 'skill', itemId: 'code-review', payload: skillPayload, label: 'Code review' }],
        configs: [], memory: [],
      }),
    })

    const result = await ctrl.onDeployNow('d-target')
    assert.equal(result.ok, true, `deploy should succeed: ${result.error || ''}`)

    // Target should have received the package, accepted it, applied,
    // and written an audit entry.
    assert.equal(appliedItems.length, 1, 'target apply transport must have been called')
    assert.equal(appliedItems[0].kind, 'skill')
    assert.equal(appliedItems[0].itemId, 'code-review')

    const targetAudit = await stateT.deployTarget.deployAudit.list()
    assert.ok(targetAudit.length >= 1)
    const event = targetAudit[0]
    assert.equal(event.status, 'applied')
    assert.equal(event.source, id.summary.did)

    // Target: source's lastSyncAt was updated on success.
    const updatedDevice = await stateS.pairedDevices.get('d-target')
    assert.equal(typeof updatedDevice.lastSyncAt, 'number',
      'recordSync should stamp the device after a successful deploy')

    // Rollback: target rolls back the deploy event. Snapshot driver's
    // restore should fire with the snapshotId we recorded.
    const tpCtrl = buildTrustedPublishersController({
      state: stateT, confirm: async () => true,
    })
    const rb = await tpCtrl.onRollback(event.id)
    assert.equal(rb.ok, true, `rollback should succeed: ${rb.error || ''}`)
    assert.equal(restored.length, 1, 'snapshotDriver.restore should fire')
    assert.equal(restored[0], event.id ? `snap-${appliedItems.length}` : restored[0])

    // Cleanup — confirm uninstall doesn't blow up
    uninstallMultiDeviceWiring(stateS)
    uninstallMultiDeviceWiring(stateT)
    assert.equal(stateS.deployTarget, null)
    assert.equal(stateT.deployTarget, null)
  })

  it('untrusted source: target rejects, audit logs the rejection, source still got ok-from-send', async () => {
    const { podA, podB } = makePodPair()
    const id = await makeSharedIdentity()
    const stateS = { pod: podA }
    const stateT = { pod: podB }
    let applyCalls = 0
    installMultiDeviceWiring({ pod: podA, state: stateS, wsId: 'wsS' })
    installMultiDeviceWiring({
      pod: podB, state: stateT, wsId: 'wsT',
      promptApprove: async () => true,
      applyTransport: { applyBatch: async (i) => { applyCalls++; return { ok: true, applied: i.map(x => x.itemId) } } },
      resolvePublicKey: resolveDidKey,
    })

    // NB: we DON'T grant the source on the target's ACL.

    await stateS.pairedDevices.add({ deviceId: 'd', peerPublicKey: 'peerB', peerDid: id.summary.did })
    const ctrl = buildMyDevicesController({
      state: stateS,
      showPickerModalFn: async () => ({
        items: [{ kind: 'skill', itemId: 's', payload: { files: { 'SKILL.md': '' } } }],
        manifest: { items: [{ kind: 'skill', itemId: 's' }], capabilities: {}, createdAt: 1 },
      }),
      getSigningKey: async () => id.signingKey,
      getSourceDid: () => id.summary.did,
      resolveItems: async () => ({ skills: [], configs: [], memory: [] }),
    })
    const r = await ctrl.onDeployNow('d')
    assert.equal(r.ok, true, 'send-side reports OK; target-side rejection happens asynchronously')
    // Wait microtask for inbound delivery to land.
    await new Promise(r => setTimeout(r, 5))
    assert.equal(applyCalls, 0, 'apply transport must not be called for untrusted source')
    const audit = await stateT.deployTarget.deployAudit.list()
    assert.ok(audit.length >= 1)
    assert.equal(audit[0].status, 'rejected')
    assert.match(audit[0].error, /not trusted/)
  })

  it('user-denied approval: target audit-logs rejection', async () => {
    const { podA, podB } = makePodPair()
    const id = await makeSharedIdentity()
    const stateS = { pod: podA }
    const stateT = { pod: podB }
    let applyCalls = 0
    installMultiDeviceWiring({ pod: podA, state: stateS, wsId: 'wsS' })
    installMultiDeviceWiring({
      pod: podB, state: stateT, wsId: 'wsT',
      promptApprove: async () => false,       // user denies
      applyTransport: { applyBatch: async () => { applyCalls++; return { ok: true, applied: [] } } },
      resolvePublicKey: resolveDidKey,
    })

    await stateT.deployTarget.deployAcl.grant(id.summary.did)
    await stateS.pairedDevices.add({ deviceId: 'd', peerPublicKey: 'peerB' })

    const ctrl = buildMyDevicesController({
      state: stateS,
      showPickerModalFn: async () => ({
        items: [{ kind: 'config', itemId: 'autonomy', payload: { level: 5 } }],
        manifest: {
          items: [{ kind: 'config', itemId: 'autonomy' }],
          capabilities: { config: ['autonomy'] },
          createdAt: 1,
        },
      }),
      getSigningKey: async () => id.signingKey,
      getSourceDid: () => id.summary.did,
      resolveItems: async () => ({ skills: [], configs: [{ kind: 'config', itemId: 'autonomy', payload: { level: 5 } }], memory: [] }),
    })
    await ctrl.onDeployNow('d')
    await new Promise(r => setTimeout(r, 5))
    assert.equal(applyCalls, 0)
    const audit = await stateT.deployTarget.deployAudit.list()
    assert.ok(audit.length >= 1)
    assert.equal(audit[0].status, 'rejected')
    assert.match(audit[0].error, /user rejected/)
  })
})
