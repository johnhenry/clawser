// clawser-mesh-controller.test.mjs

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { buildMeshController } from '../clawser-mesh-controller.mjs'

describe('buildMeshController', () => {
  it('onRefresh calls the injected refresh fn', () => {
    let called = 0
    const ctrl = buildMeshController({ peerNode: {}, refresh: () => { called++ } })
    ctrl.onRefresh()
    assert.equal(called, 1)
  })

  it('onDrainPod calls peerNode.disconnectPeer with the prompted pubkey', async () => {
    const calls = []
    const peerNode = { disconnectPeer: (pk) => calls.push(pk), sendTo: async () => {} }
    const ctrl = buildMeshController({ peerNode, promptForPubKey: async () => 'pk-target' })
    const r = await ctrl.onDrainPod()
    assert.equal(r.ok, true)
    assert.equal(r.target, 'pk-target')
    assert.deepEqual(calls, ['pk-target'])
  })

  it('onDrainPod returns cancelled when prompt yields null', async () => {
    const peerNode = { disconnectPeer: () => {} }
    const ctrl = buildMeshController({ peerNode, promptForPubKey: async () => null })
    const r = await ctrl.onDrainPod()
    assert.equal(r.ok, false)
    assert.equal(r.error, 'cancelled')
  })

  it('onDrainPod returns error when peerNode is missing', async () => {
    const ctrl = buildMeshController({ peerNode: null })
    const r = await ctrl.onDrainPod()
    assert.equal(r.ok, false)
    assert.match(r.error, /peerNode/)
  })

  it('onExecRemote sends a remote-exec envelope via peerNode.sendTo', async () => {
    const sent = []
    const peerNode = { sendTo: async (pk, data) => sent.push({ pk, data }), disconnectPeer: () => {} }
    const ctrl = buildMeshController({
      peerNode,
      promptForExec: async () => ({ target: 'pk1', cmd: 'ls -la' }),
    })
    const r = await ctrl.onExecRemote()
    assert.equal(r.ok, true)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].pk, 'pk1')
    const envelope = JSON.parse(sent[0].data)
    assert.equal(envelope.type, 'remote-exec')
    assert.equal(envelope.cmd, 'ls -la')
  })

  it('onExecRemote rejects when prompt is cancelled or incomplete', async () => {
    const peerNode = { sendTo: async () => {}, disconnectPeer: () => {} }
    const cancelled = buildMeshController({ peerNode, promptForExec: async () => null })
    assert.equal((await cancelled.onExecRemote()).ok, false)
    const partial = buildMeshController({ peerNode, promptForExec: async () => ({ target: 'p', cmd: '' }) })
    assert.equal((await partial.onExecRemote()).ok, false)
  })

  it('onExecRemote surfaces sendTo errors', async () => {
    const peerNode = { sendTo: async () => { throw new Error('no session') }, disconnectPeer: () => {} }
    const ctrl = buildMeshController({
      peerNode,
      promptForExec: async () => ({ target: 'p', cmd: 'x' }),
    })
    const r = await ctrl.onExecRemote()
    assert.equal(r.ok, false)
    assert.match(r.error, /no session/)
  })

  it('onDeploySkill delegates to the injected deploySkillFlow', async () => {
    let invoked = 0
    const ctrl = buildMeshController({
      peerNode: {},
      deploySkillFlow: async () => { invoked++; return { ok: true } },
    })
    const r = await ctrl.onDeploySkill()
    assert.equal(r.ok, true)
    assert.equal(invoked, 1)
  })

  it('onDeploySkill returns the not-configured error by default', async () => {
    const ctrl = buildMeshController({ peerNode: {} })
    const r = await ctrl.onDeploySkill()
    assert.equal(r.ok, false)
    assert.match(r.error, /not configured/)
  })
})
