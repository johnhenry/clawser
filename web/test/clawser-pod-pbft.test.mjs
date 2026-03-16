// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-pod-pbft.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { ClawserPod } from '../clawser-pod.js'
import { Proposal, VoteType } from '../clawser-mesh-consensus.js'
import { resetNetwayToolsForTests } from '../clawser-netway-tools.js'

// Stub BroadcastChannel for Node
class StubBroadcastChannel {
  constructor(name) { this.name = name; this.onmessage = null }
  postMessage() {}
  close() {}
}

function makeGlobal(overrides = {}) {
  const listeners = []
  const g = {
    window: undefined,
    document: undefined,
    BroadcastChannel: StubBroadcastChannel,
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const idx = listeners.findIndex(l => l.fn === fn)
      if (idx !== -1) listeners.splice(idx, 1)
    },
    ...overrides,
  }
  g._listeners = listeners
  return g
}

describe('ClawserPod PBFT wiring', () => {
  let pod

  afterEach(async () => {
    if (pod && pod.state !== 'shutdown' && pod.state !== 'idle') {
      await pod.shutdown({ silent: true })
    }
    await resetNetwayToolsForTests()
  })

  it('pbftConsensus defaults to null when enablePBFT is not set', async () => {
    pod = new ClawserPod()
    const g = makeGlobal()
    await pod.boot({ globalThis: g, discoveryTimeout: 50, handshakeTimeout: 50 })
    await pod.initMesh()

    assert.equal(pod.pbftConsensus, null,
      'pbftConsensus should be null when enablePBFT is not passed')
  })

  it('groupKeyManager is created after initMesh', async () => {
    pod = new ClawserPod()
    const g = makeGlobal()
    await pod.boot({ globalThis: g, discoveryTimeout: 50, handshakeTimeout: 50 })

    // Before initMesh, groupKeyManager should be null
    assert.equal(pod.groupKeyManager, null)

    await pod.initMesh()

    assert.ok(pod.groupKeyManager,
      'groupKeyManager should be non-null after initMesh')
  })

  it('consensusManager has wireTransport wired (broadcastProposal does not throw)', async () => {
    pod = new ClawserPod()
    const g = makeGlobal()
    await pod.boot({ globalThis: g, discoveryTimeout: 50, handshakeTimeout: 50 })
    await pod.initMesh()

    const proposal = new Proposal({
      proposalId: 'test-prop-1',
      authorPodId: pod.podId,
      title: 'Test proposal',
      options: ['yes', 'no'],
      voteType: VoteType.SIMPLE,
      quorum: 1,
      deadline: null,
    })

    // Should not throw — proves broadcastFn was wired
    assert.doesNotThrow(() => {
      pod.consensusManager.broadcastProposal(proposal)
    })
  })

  it('paymentRouter has wireTransport wired (openChannel does not throw)', async () => {
    pod = new ClawserPod()
    const g = makeGlobal()
    await pod.boot({ globalThis: g, discoveryTimeout: 50, handshakeTimeout: 50 })
    await pod.initMesh()

    assert.ok(pod.paymentRouter, 'paymentRouter should be non-null after initMesh')

    // broadcastOpen uses the wired broadcastFn — should not throw
    // PaymentRouter.openChannel broadcasts an OPEN message if wireTransport was called
    assert.doesNotThrow(() => {
      pod.paymentRouter.openChannel({
        channelId: 'ch-test-1',
        counterparty: 'peer-abc',
        deposit: 100,
      })
    })
  })

  it('migrationEngine has wireTransport wired (broadcastInit does not throw)', async () => {
    pod = new ClawserPod()
    const g = makeGlobal()
    await pod.boot({ globalThis: g, discoveryTimeout: 50, handshakeTimeout: 50 })
    await pod.initMesh()

    assert.ok(pod.migrationEngine, 'migrationEngine should be non-null after initMesh')

    // broadcastInit uses the wired broadcastFn — should not throw
    assert.doesNotThrow(() => {
      pod.migrationEngine.broadcastInit({
        migrationId: 'mig-test-1',
        sourcePodId: pod.podId,
        targetPodId: 'peer-xyz',
        scope: 'full',
      })
    })
  })

  it('pbftConsensus remains null when raijin-consensus import fails', async () => {
    // enablePBFT is true but raijin-consensus is not installed,
    // so the dynamic import should fail and pbftConsensus stays null
    pod = new ClawserPod()
    const g = makeGlobal()
    await pod.boot({ globalThis: g, discoveryTimeout: 50, handshakeTimeout: 50 })

    const logs = []
    await pod.initMesh({
      enablePBFT: true,
      onLog: (level, msg) => logs.push({ level, msg }),
    })

    assert.equal(pod.pbftConsensus, null,
      'pbftConsensus should be null when raijin-consensus is not installed')
    // Should have logged a warning
    const warnLog = logs.find(l => l.level === 'warn' && l.msg.includes('PBFT'))
    assert.ok(warnLog, 'should log a warning about PBFT being unavailable')
  })
})
