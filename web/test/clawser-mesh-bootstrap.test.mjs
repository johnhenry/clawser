/**
 * Mesh bootstrap integration test.
 * Verifies ClawserPod.initMesh() instantiates all expected subsystems.
 *
 * Run: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-bootstrap.test.mjs
 */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { ClawserPod } from '../clawser-pod.js'

// Stub BroadcastChannel for Node
class StubBroadcastChannel {
  constructor(name) { this.name = name; this.onmessage = null }
  postMessage() {}
  close() {}
}

function makeGlobal() {
  return {
    window: undefined,
    document: undefined,
    BroadcastChannel: StubBroadcastChannel,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

describe('ClawserPod.initMesh() — subsystem bootstrap', () => {
  let pod

  afterEach(async () => {
    if (pod && pod.state !== 'shutdown' && pod.state !== 'idle') {
      await pod.shutdown({ silent: true })
    }
  })

  it('returns all expected subsystem keys', async () => {
    pod = new ClawserPod()
    const g = makeGlobal()
    await pod.boot({ globalThis: g, discoveryTimeout: 50, handshakeTimeout: 50 })

    const result = await pod.initMesh()

    const expectedKeys = [
      'peerNode',
      'swarmCoordinator',
      'discoveryManager',
      'transportNegotiator',
      'auditChain',
      'streamMultiplexer',
      'fileTransfer',
      'serviceDirectory',
      'syncEngine',
      'resourceRegistry',
      'meshMarketplace',
      'quotaManager',
      'quotaEnforcer',
      'paymentRouter',
      'consensusManager',
      'relayClient',
      'nameResolver',
      'remoteRuntimeRegistry',
      'remoteSessionBroker',
      'remotePolicyAdapter',
      'appRegistry',
      'appStore',
      'orchestrator',
    ]

    for (const key of expectedKeys) {
      assert.ok(result[key] !== null && result[key] !== undefined,
        `initMesh() should return ${key}`)
    }
  })

  it('exposes all subsystems via getters', async () => {
    pod = new ClawserPod()
    const g = makeGlobal()
    await pod.boot({ globalThis: g, discoveryTimeout: 50, handshakeTimeout: 50 })
    await pod.initMesh()

    assert.ok(pod.peerNode, 'peerNode getter')
    assert.ok(pod.swarmCoordinator, 'swarmCoordinator getter')
    assert.ok(pod.wallet, 'wallet getter')
    assert.ok(pod.registry, 'registry getter')
    assert.ok(pod.discoveryManager, 'discoveryManager getter')
    assert.ok(pod.transportNegotiator, 'transportNegotiator getter')
    assert.ok(pod.auditChain, 'auditChain getter')
    assert.ok(pod.streamMultiplexer, 'streamMultiplexer getter')
    assert.ok(pod.fileTransfer, 'fileTransfer getter')
    assert.ok(pod.serviceDirectory, 'serviceDirectory getter')
    assert.ok(pod.syncEngine, 'syncEngine getter')
    assert.ok(pod.resourceRegistry, 'resourceRegistry getter')
    assert.ok(pod.meshMarketplace, 'meshMarketplace getter')
    assert.ok(pod.quotaManager, 'quotaManager getter')
    assert.ok(pod.quotaEnforcer, 'quotaEnforcer getter')
    assert.ok(pod.paymentRouter, 'paymentRouter getter')
    assert.ok(pod.consensusManager, 'consensusManager getter')
    assert.ok(pod.relayClient, 'relayClient getter')
    assert.ok(pod.nameResolver, 'nameResolver getter')
    assert.ok(pod.remoteRuntimeRegistry, 'remoteRuntimeRegistry getter')
    assert.ok(pod.remoteSessionBroker, 'remoteSessionBroker getter')
    assert.ok(pod.remotePolicyAdapter, 'remotePolicyAdapter getter')
    assert.ok(pod.appRegistry, 'appRegistry getter')
    assert.ok(pod.appStore, 'appStore getter')
    assert.ok(pod.orchestrator, 'orchestrator getter')
  })

  it('uses unified podId across all subsystems', async () => {
    pod = new ClawserPod()
    const g = makeGlobal()
    await pod.boot({ globalThis: g, discoveryTimeout: 50, handshakeTimeout: 50 })
    await pod.initMesh()

    const basePodId = pod.podId
    assert.ok(basePodId)

    // Wallet default identity matches
    const walletDefault = pod.wallet.getDefault()
    assert.equal(walletDefault.podId, basePodId)

    // PeerNode matches
    assert.equal(pod.peerNode.podId, basePodId)
  })

  it('shutdown nulls all subsystems', async () => {
    pod = new ClawserPod()
    const g = makeGlobal()
    await pod.boot({ globalThis: g, discoveryTimeout: 50, handshakeTimeout: 50 })
    await pod.initMesh()

    assert.ok(pod.peerNode)
    await pod.shutdown()

    assert.equal(pod.peerNode, null)
    assert.equal(pod.swarmCoordinator, null)
    assert.equal(pod.wallet, null)
    assert.equal(pod.registry, null)
    assert.equal(pod.discoveryManager, null)
    assert.equal(pod.transportNegotiator, null)
    assert.equal(pod.auditChain, null)
    assert.equal(pod.streamMultiplexer, null)
    assert.equal(pod.fileTransfer, null)
    assert.equal(pod.serviceDirectory, null)
    assert.equal(pod.syncEngine, null)
    assert.equal(pod.resourceRegistry, null)
    assert.equal(pod.meshMarketplace, null)
    assert.equal(pod.quotaManager, null)
    assert.equal(pod.quotaEnforcer, null)
    assert.equal(pod.paymentRouter, null)
    assert.equal(pod.consensusManager, null)
    assert.equal(pod.relayClient, null)
    assert.equal(pod.nameResolver, null)
    assert.equal(pod.remoteRuntimeRegistry, null)
    assert.equal(pod.remoteSessionBroker, null)
    assert.equal(pod.remotePolicyAdapter, null)
    assert.equal(pod.appRegistry, null)
    assert.equal(pod.appStore, null)
    assert.equal(pod.orchestrator, null)
  })

  it('initMesh() is re-entrant (can be called twice)', async () => {
    pod = new ClawserPod()
    const g = makeGlobal()
    await pod.boot({ globalThis: g, discoveryTimeout: 50, handshakeTimeout: 50 })

    const result1 = await pod.initMesh()
    const result2 = await pod.initMesh()

    // Second call should succeed and return fresh instances
    assert.ok(result2.peerNode)
    assert.ok(result2.swarmCoordinator)
    assert.notEqual(result1.peerNode, result2.peerNode, 'Should create new PeerNode')
  })
})
