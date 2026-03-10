// clawser-pod.js — ClawserPod: full agent workspace pod
//
// Extends Pod with mesh networking (PeerNode, SwarmCoordinator, etc.)
// Used by clawser-workspace-lifecycle.js to initialize the mesh subsystem.

import { Pod } from './packages/pod/src/pod.mjs'
import { MeshIdentityManager } from './clawser-mesh-identity.js'
import { IdentityWallet } from './clawser-identity-wallet.js'
import { PeerRegistry } from './clawser-peer-registry.js'
import { PeerNode } from './clawser-peer-node.js'
import { SwarmCoordinator } from './clawser-mesh-swarm.js'
import { DiscoveryManager, DiscoveryRecord, ServiceDirectory } from './clawser-mesh-discovery.js'
import { MeshTransportNegotiator } from './clawser-mesh-transport.js'
import { AuditChain } from './clawser-mesh-audit.js'
import { StreamMultiplexer } from './clawser-mesh-streams.js'
import { MeshFileTransfer } from './clawser-mesh-files.js'
import { MeshSyncEngine } from './clawser-mesh-sync.js'
import { ResourceRegistry } from './clawser-mesh-resources.js'
import { Marketplace } from './clawser-mesh-marketplace.js'
import { QuotaManager, QuotaEnforcer } from './clawser-mesh-quotas.js'
import { PaymentRouter } from './clawser-mesh-payments.js'
import { ConsensusManager } from './clawser-mesh-consensus.js'
import { MeshRelayClient } from './clawser-mesh-relay.js'
import { MeshNameResolver } from './clawser-mesh-naming.js'
import { AppRegistry, AppStore } from './clawser-mesh-apps.js'
import { MeshOrchestrator } from './clawser-mesh-orchestrator.js'
import { RemoteRuntimeRegistry } from './clawser-remote-runtime-registry.js'
import { RemoteSessionBroker } from './clawser-remote-session-broker.js'
import { RemoteRuntimePolicyAdapter } from './clawser-remote-runtime-policy.js'

export class ClawserPod extends Pod {
  #peerNode = null
  #swarmCoordinator = null
  #wallet = null
  #registry = null
  #discoveryManager = null
  #transportNegotiator = null
  #auditChain = null
  #streamMultiplexer = null
  #fileTransfer = null
  #serviceDirectory = null
  #syncEngine = null
  #resourceRegistry = null
  #meshMarketplace = null
  #quotaManager = null
  #quotaEnforcer = null
  #paymentRouter = null
  #consensusManager = null
  #relayClient = null
  #nameResolver = null
  #appRegistry = null
  #appStore = null
  #orchestrator = null
  #remoteRuntimeRegistry = null
  #remoteSessionBroker = null
  #remotePolicyAdapter = null

  get peerNode() { return this.#peerNode }
  get swarmCoordinator() { return this.#swarmCoordinator }
  get wallet() { return this.#wallet }
  get registry() { return this.#registry }
  get discoveryManager() { return this.#discoveryManager }
  get transportNegotiator() { return this.#transportNegotiator }
  get auditChain() { return this.#auditChain }
  get streamMultiplexer() { return this.#streamMultiplexer }
  get fileTransfer() { return this.#fileTransfer }
  get serviceDirectory() { return this.#serviceDirectory }
  get syncEngine() { return this.#syncEngine }
  get resourceRegistry() { return this.#resourceRegistry }
  get meshMarketplace() { return this.#meshMarketplace }
  get quotaManager() { return this.#quotaManager }
  get quotaEnforcer() { return this.#quotaEnforcer }
  get paymentRouter() { return this.#paymentRouter }
  get consensusManager() { return this.#consensusManager }
  get relayClient() { return this.#relayClient }
  get nameResolver() { return this.#nameResolver }
  get appRegistry() { return this.#appRegistry }
  get appStore() { return this.#appStore }
  get orchestrator() { return this.#orchestrator }
  get remoteRuntimeRegistry() { return this.#remoteRuntimeRegistry }
  get remoteSessionBroker() { return this.#remoteSessionBroker }
  get remotePolicyAdapter() { return this.#remotePolicyAdapter }

  /**
   * Initialize the full mesh subsystem on top of the Pod's identity.
   * Creates all mesh components: identity wallet, peer registry, peer node,
   * swarm coordinator, discovery manager, transport negotiator, audit chain,
   * stream multiplexer, file transfer, service directory, and sync engine.
   *
   * @param {object} [opts]
   * @returns {Promise<object>} All instantiated subsystems
   */
  async initMesh(opts = {}) {
    // Tear down existing peer node if running
    if (this.#peerNode && this.#peerNode.state === 'running') {
      await this.#peerNode.shutdown()
    }

    // 1. Identity manager (mesh-level)
    const meshIdMgr = new MeshIdentityManager()

    // 2. Identity wallet — import the Pod's existing identity so the mesh
    //    and pod layers share a single podId. Falls back to creating a
    //    fresh identity only when the Pod has no extractable key pair.
    this.#wallet = new IdentityWallet({ identityManager: meshIdMgr })

    let podId = this.podId || 'local'

    if (this.identity && this.identity.keyPair && this.identity.keyPair.privateKey) {
      try {
        const jwk = await crypto.subtle.exportKey('jwk', this.identity.keyPair.privateKey)
        await this.#wallet.importIdentity(jwk, 'default')
        const imported = this.#wallet.getDefault()
        if (imported) podId = imported.podId
      } catch {
        // Key not extractable — fall back to creating a new identity
        await this.#wallet.createIdentity('default')
        const created = this.#wallet.getDefault()
        if (created) podId = created.podId
      }
    } else {
      await this.#wallet.createIdentity('default')
      const created = this.#wallet.getDefault()
      if (created) podId = created.podId
    }

    // 3. Peer registry with real podId
    this.#registry = new PeerRegistry({ localPodId: podId })

    // 4. PeerNode orchestrator
    this.#peerNode = new PeerNode({ wallet: this.#wallet, registry: this.#registry })
    await this.#peerNode.boot({ label: 'default' })

    // 5. SwarmCoordinator
    this.#swarmCoordinator = new SwarmCoordinator(podId)

    // 6. DiscoveryManager — peer discovery with TTL-based pruning
    const localRecord = new DiscoveryRecord({ podId, label: 'clawser' })
    this.#discoveryManager = new DiscoveryManager({
      localRecord,
      strategies: [],
      announceInterval: 15000,
    })

    // 7. TransportNegotiator — tries adapters in preference order
    this.#transportNegotiator = new MeshTransportNegotiator()

    // 8. AuditChain — tamper-evident log
    this.#auditChain = new AuditChain(podId)

    // 9. StreamMultiplexer — multiplexed data streams
    this.#streamMultiplexer = new StreamMultiplexer()

    // 10. MeshFileTransfer — chunked file transfers
    this.#fileTransfer = new MeshFileTransfer()

    // 11. ServiceDirectory — svc:// routing
    this.#serviceDirectory = new ServiceDirectory({ localPodId: podId })

    // 12. MeshSyncEngine — CRDT state synchronization
    this.#syncEngine = new MeshSyncEngine({ nodeId: podId })

    // 13. ResourceRegistry — mesh resource advertising/discovery
    this.#resourceRegistry = new ResourceRegistry()

    // 14. Marketplace — mesh service marketplace
    this.#meshMarketplace = new Marketplace({ localPodId: podId })

    // 15. QuotaManager + QuotaEnforcer — metering and enforcement
    this.#quotaManager = new QuotaManager()
    this.#quotaEnforcer = new QuotaEnforcer(this.#quotaManager)

    // 16. PaymentRouter — payment channel routing
    this.#paymentRouter = new PaymentRouter(podId)

    // 17. ConsensusManager — voting and consensus protocols
    this.#consensusManager = new ConsensusManager()

    // 18. MeshRelayClient — relay transport (does NOT auto-connect)
    this.#relayClient = new MeshRelayClient({
      relayUrl: opts.relayUrl || 'wss://relay.browsermesh.local',
      identity: { fingerprint: podId },
    })

    // 19. MeshNameResolver — mesh name resolution
    this.#nameResolver = new MeshNameResolver()

    // 20. RemoteRuntimeRegistry + RemoteSessionBroker — canonical remote runtime model
    this.#remoteRuntimeRegistry = new RemoteRuntimeRegistry()
    this.#remotePolicyAdapter = new RemoteRuntimePolicyAdapter({
      peerRegistry: this.#registry,
    })
    this.#remoteSessionBroker = new RemoteSessionBroker({
      runtimeRegistry: this.#remoteRuntimeRegistry,
      nameResolver: this.#nameResolver,
      policyAdapter: this.#remotePolicyAdapter,
    })

    this.#discoveryManager.onPeerDiscovered((record) => {
      const descriptor = this.#remoteRuntimeRegistry?.ingestMeshDiscovery(record)
      if (!descriptor) return
      if (record.label) {
        this.#remoteRuntimeRegistry?.linkName(record.label, descriptor.identity.canonicalId)
      }
      if (record.metadata?.meshName) {
        this.#remoteRuntimeRegistry?.linkName(record.metadata.meshName, descriptor.identity.canonicalId)
      }
      if (record.metadata?.wshFingerprint) {
        this.#remoteRuntimeRegistry?.linkIdentity({
          canonicalId: descriptor.identity.canonicalId,
          alias: record.metadata.wshFingerprint,
        })
      }
    })
    this.#relayClient.onPeerAnnounce((peer) => {
      const descriptor = this.#remoteRuntimeRegistry?.ingestMeshRelayPeer(peer)
      if (!descriptor) return
      if (peer.username) {
        this.#remoteRuntimeRegistry?.linkName(peer.username, descriptor.identity.canonicalId)
      }
      if (peer.label) {
        this.#remoteRuntimeRegistry?.linkName(peer.label, descriptor.identity.canonicalId)
      }
      if (peer.metadata?.meshName) {
        this.#remoteRuntimeRegistry?.linkName(peer.metadata.meshName, descriptor.identity.canonicalId)
      }
    })

    // 21. AppRegistry + AppStore — app lifecycle
    this.#appRegistry = new AppRegistry({ localPodId: podId })
    this.#appStore = new AppStore({ localPodId: podId })

    // 22. MeshOrchestrator — pod orchestration (must be after peerNode)
    this.#orchestrator = new MeshOrchestrator({
      peerNode: this.#peerNode,
      runtimeRegistry: this.#remoteRuntimeRegistry,
    })

    return {
      peerNode: this.#peerNode,
      swarmCoordinator: this.#swarmCoordinator,
      discoveryManager: this.#discoveryManager,
      transportNegotiator: this.#transportNegotiator,
      auditChain: this.#auditChain,
      streamMultiplexer: this.#streamMultiplexer,
      fileTransfer: this.#fileTransfer,
      serviceDirectory: this.#serviceDirectory,
      syncEngine: this.#syncEngine,
      resourceRegistry: this.#resourceRegistry,
      meshMarketplace: this.#meshMarketplace,
      quotaManager: this.#quotaManager,
      quotaEnforcer: this.#quotaEnforcer,
      paymentRouter: this.#paymentRouter,
      consensusManager: this.#consensusManager,
      relayClient: this.#relayClient,
      nameResolver: this.#nameResolver,
      remoteRuntimeRegistry: this.#remoteRuntimeRegistry,
      remoteSessionBroker: this.#remoteSessionBroker,
      remotePolicyAdapter: this.#remotePolicyAdapter,
      appRegistry: this.#appRegistry,
      appStore: this.#appStore,
      orchestrator: this.#orchestrator,
    }
  }

  _onMessage(msg) {
    // Forward pod-level messages as events
    // Listeners can subscribe via pod.on('pod:message', ...)
  }

  async shutdown(opts = {}) {
    if (this.#peerNode && this.#peerNode.state === 'running') {
      try { await this.#peerNode.shutdown() } catch { /* non-fatal */ }
    }
    if (this.#syncEngine) {
      try { this.#syncEngine.stopAllAutoSync() } catch { /* non-fatal */ }
    }
    if (this.#relayClient) {
      try { this.#relayClient.disconnect() } catch { /* non-fatal */ }
    }
    this.#peerNode = null
    this.#swarmCoordinator = null
    this.#wallet = null
    this.#registry = null
    this.#discoveryManager = null
    this.#transportNegotiator = null
    this.#auditChain = null
    this.#streamMultiplexer = null
    this.#fileTransfer = null
    this.#serviceDirectory = null
    this.#syncEngine = null
    this.#resourceRegistry = null
    this.#meshMarketplace = null
    this.#quotaManager = null
    this.#quotaEnforcer = null
    this.#paymentRouter = null
    this.#consensusManager = null
    this.#relayClient = null
    this.#nameResolver = null
    this.#remoteRuntimeRegistry = null
    this.#remoteSessionBroker = null
    this.#remotePolicyAdapter = null
    this.#appRegistry = null
    this.#appStore = null
    this.#orchestrator = null
    await super.shutdown(opts)
  }
}
