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
import { DiscoveryManager, DiscoveryRecord, RelayStrategy, ServiceDirectory } from './clawser-mesh-discovery.js'
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
import { ServiceAdvertiser, ServiceBrowser } from './clawser-peer-services.js'
// Track 1: Transport adapters
import { WebSocketTransport, TransportFactory } from './clawser-mesh-websocket.js'
import { WebRTCTransportAdapter, WebRTCAdapterFactory } from './clawser-mesh-webrtc.js'
import { WebTransportBridge, WebTransportAdapterFactory } from './clawser-mesh-webtransport.js'
// Track 2: Security & Auth
import { HandshakeCoordinator } from './clawser-mesh-handshake.js'
import { MeshACL } from './clawser-mesh-acl.js'
import { CapabilityValidator } from './clawser-mesh-capabilities.js'
import { CrossOriginBridge } from './clawser-mesh-cross-origin.js'
import { VerificationQuorum } from './clawser-peer-verification.js'
import { EncryptedBlobStore } from './clawser-peer-encrypted-store.js'
// Track 3: Communication & Files
import { MeshChat } from './clawser-mesh-chat.js'
import { GatewayNode, GatewayDiscovery } from './clawser-mesh-gateway.js'
import { TorrentManager } from './clawser-peer-torrent.js'
import { IPFSStore } from './clawser-peer-ipfs.js'
// Track 4: Compute
import { FederatedCompute } from './clawser-peer-compute.js'
import { AgentSwarmCoordinator } from './clawser-peer-agent-swarm.js'
import { MeshScheduler } from './clawser-mesh-scheduler.js'
// Track 5: Ops & Resilience
import { HealthMonitor } from './clawser-peer-health.js'
import { MeshInspector } from './clawser-mesh-devtools.js'
import { MigrationEngine } from './clawser-mesh-migration.js'
import { SessionManager } from './clawser-peer-session.js'
import { TimestampAuthority } from './clawser-peer-timestamp.js'
import { StealthAgent } from './clawser-mesh-stealth.js'
import { MeshRouter } from './clawser-peer-routing.js'
import { MeshFetchRouter } from './clawser-mesh-sw-routing.js'
import { MeshWshBridge } from './clawser-mesh-wsh-bridge.js'
import { SyncCoordinator } from './clawser-mesh-delta-sync.js'
import { AgentMemorySync } from './clawser-peer-memory-sync.js'
import { EscrowManager } from './clawser-peer-escrow.js'
import { DhtNode } from './clawser-mesh-dht.js'
import { CreditLedger } from './clawser-mesh-payments.js'
import { RemoteRuntimeRegistry } from './clawser-remote-runtime-registry.js'
import { RemoteSessionBroker } from './clawser-remote-session-broker.js'
import { RemoteRuntimePolicyAdapter } from './clawser-remote-runtime-policy.js'
import { createRemoteWshConnectors } from './clawser-remote-runtime-wsh.js'
import { RemoteRuntimeAuditRecorder } from './clawser-remote-runtime-audit.js'
import { configureRemoteRuntimeGateway } from './clawser-netway-tools.js'

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
  #serviceAdvertiser = null
  #serviceBrowser = null
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
  #remoteWshConnectors = null
  #remoteAuditRecorder = null
  // Track 1: Transports
  #transportFactory = null
  // Track 2: Security
  #handshakeCoordinator = null
  #meshACL = null
  #capabilityValidator = null
  #crossOriginBridge = null
  #verificationQuorum = null
  #encryptedBlobStore = null
  // Track 3: Communication
  #meshChat = null
  #gatewayNode = null
  #gatewayDiscovery = null
  #torrentManager = null
  #ipfsStore = null
  // Track 4: Compute
  #federatedCompute = null
  #agentSwarmCoordinator = null
  #meshScheduler = null
  // Track 5: Ops
  #healthMonitor = null
  #meshInspector = null
  #migrationEngine = null
  #sessionManager = null
  #timestampAuthority = null
  #stealthAgent = null
  #meshRouter = null
  #meshFetchRouter = null
  #meshWshBridge = null
  #syncCoordinator = null
  #escrowManager = null
  #dhtNode = null
  #creditLedger = null

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
  get serviceAdvertiser() { return this.#serviceAdvertiser }
  get serviceBrowser() { return this.#serviceBrowser }
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
  get remoteAuditRecorder() { return this.#remoteAuditRecorder }
  // Track 1
  get transportFactory() { return this.#transportFactory }
  // Track 2
  get handshakeCoordinator() { return this.#handshakeCoordinator }
  get meshACL() { return this.#meshACL }
  get capabilityValidator() { return this.#capabilityValidator }
  get crossOriginBridge() { return this.#crossOriginBridge }
  get verificationQuorum() { return this.#verificationQuorum }
  get encryptedBlobStore() { return this.#encryptedBlobStore }
  // Track 3
  get meshChat() { return this.#meshChat }
  get gatewayNode() { return this.#gatewayNode }
  get gatewayDiscovery() { return this.#gatewayDiscovery }
  get torrentManager() { return this.#torrentManager }
  get ipfsStore() { return this.#ipfsStore }
  // Track 4
  get federatedCompute() { return this.#federatedCompute }
  get agentSwarmCoordinator() { return this.#agentSwarmCoordinator }
  get meshScheduler() { return this.#meshScheduler }
  // Track 5
  get healthMonitor() { return this.#healthMonitor }
  get meshInspector() { return this.#meshInspector }
  get migrationEngine() { return this.#migrationEngine }
  get sessionManager() { return this.#sessionManager }
  get timestampAuthority() { return this.#timestampAuthority }
  get stealthAgent() { return this.#stealthAgent }
  get meshRouter() { return this.#meshRouter }
  get meshFetchRouter() { return this.#meshFetchRouter }
  get meshWshBridge() { return this.#meshWshBridge }
  get syncCoordinator() { return this.#syncCoordinator }
  get escrowManager() { return this.#escrowManager }
  get dhtNode() { return this.#dhtNode }
  get creditLedger() { return this.#creditLedger }

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

    // 6b. Add relay discovery strategy when a signaling URL is configured
    if (opts.relayUrl) {
      this.#discoveryManager.addStrategy(new RelayStrategy({
        relayUrl: opts.relayUrl,
        podId,
      }))
    }

    // 7. TransportNegotiator — tries adapters in preference order
    this.#transportNegotiator = new MeshTransportNegotiator()

    // 7a. Register transport adapters (Track 1)
    this.#transportFactory = new TransportFactory()
    this.#transportNegotiator.registerAdapter('wsh-ws', async (endpoint, auth) => {
      const ws = new WebSocketTransport({ url: endpoint })
      await ws.connect()
      return ws
    })
    this.#transportNegotiator.registerAdapter('webrtc', async (endpoint, auth) => {
      const bridge = new WebRTCTransportAdapter(
        new (await import('./clawser-mesh-webrtc.js')).WebRTCPeerConnection({
          localPodId: podId,
          remotePodId: endpoint,
        })
      )
      await bridge.connect()
      return bridge
    })
    this.#transportNegotiator.registerAdapter('wsh-wt', async (endpoint, auth) => {
      const bridge = new WebTransportBridge()
      await bridge.connect(endpoint, auth)
      return bridge
    })

    // 8. AuditChain — tamper-evident log
    this.#auditChain = new AuditChain(podId)

    // 9. StreamMultiplexer — multiplexed data streams
    this.#streamMultiplexer = new StreamMultiplexer()

    // 10. MeshFileTransfer — chunked file transfers
    this.#fileTransfer = new MeshFileTransfer()

    // 11. ServiceDirectory — svc:// routing
    this.#serviceDirectory = new ServiceDirectory({ localPodId: podId })
    this.#serviceAdvertiser = new ServiceAdvertiser({ localPodId: podId })
    this.#serviceBrowser = new ServiceBrowser()

    // 11a. Security & Auth subsystems (Track 2)
    this.#handshakeCoordinator = new HandshakeCoordinator({
      localPodId: podId,
      signalingClient: null,
      transportFactory: this.#transportFactory,
    })
    this.#meshACL = new MeshACL({ owner: podId })
    this.#capabilityValidator = new CapabilityValidator()
    this.#crossOriginBridge = new CrossOriginBridge({ localPodId: podId })

    // 11b. Session manager (Track 5 — needed by Track 2 peers)
    this.#sessionManager = new SessionManager({
      localPodId: podId,
      acl: this.#meshACL,
      auditLog: this.#auditChain,
    })

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
    this.#remoteAuditRecorder = new RemoteRuntimeAuditRecorder({
      auditChain: this.#auditChain,
      authorId: podId,
    })
    this.#remoteRuntimeRegistry = new RemoteRuntimeRegistry({
      auditRecorder: this.#remoteAuditRecorder,
    })
    this.#remotePolicyAdapter = new RemoteRuntimePolicyAdapter({
      peerRegistry: this.#registry,
      quotaEnforcer: this.#quotaEnforcer,
    })
    this.#remoteWshConnectors = createRemoteWshConnectors({
      username: podId,
      auditRecorder: this.#remoteAuditRecorder,
    })
    this.#remoteSessionBroker = new RemoteSessionBroker({
      runtimeRegistry: this.#remoteRuntimeRegistry,
      nameResolver: this.#nameResolver,
      policyAdapter: this.#remotePolicyAdapter,
      connectors: this.#remoteWshConnectors,
      auditRecorder: this.#remoteAuditRecorder,
    })
    configureRemoteRuntimeGateway({
      remoteSessionBroker: this.#remoteSessionBroker,
      auditRecorder: this.#remoteAuditRecorder,
      quotaEnforcer: this.#quotaEnforcer,
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
    this.#serviceBrowser.on?.('discovered', (service) => {
      this.#remoteRuntimeRegistry?.ingestServiceAdvertisement(service)
    })
    this.#serviceBrowser.on?.('lost', (service) => {
      this.#remoteAuditRecorder?.record('remote_service_lost', {
        podId: service?.podId || null,
        name: service?.name || null,
      })
    })

    // 21. AppRegistry + AppStore — app lifecycle
    this.#appRegistry = new AppRegistry({ localPodId: podId })
    this.#appStore = new AppStore({ localPodId: podId })

    // 22. MeshOrchestrator — pod orchestration (must be after peerNode)
    this.#orchestrator = new MeshOrchestrator({
      peerNode: this.#peerNode,
      serviceAdvertiser: this.#serviceAdvertiser,
      serviceBrowser: this.#serviceBrowser,
      runtimeRegistry: this.#remoteRuntimeRegistry,
      remoteSessionBroker: this.#remoteSessionBroker,
      resourceRegistry: this.#resourceRegistry,
      auditRecorder: this.#remoteAuditRecorder,
      peerRegistry: this.#registry,
    })

    // 23. Communication & Files (Track 3)
    this.#meshChat = new MeshChat({ identity: { fingerprint: podId }, onLog: (m) => console.log(`[mesh-chat] ${m}`) })
    this.#gatewayNode = new GatewayNode(podId)
    this.#gatewayDiscovery = new GatewayDiscovery(podId)
    this.#torrentManager = new TorrentManager()
    this.#ipfsStore = new IPFSStore()

    // 24. Compute (Track 4)
    this.#meshScheduler = new MeshScheduler({ localPodId: podId })

    // 24a. DHT node — used by stealth, DHT tools, and verification
    this.#dhtNode = new DhtNode({ localId: podId })

    // 24b. Credit ledger — from PaymentRouter's internal ledger
    this.#creditLedger = this.#paymentRouter.getLedger()

    // 24c. Escrow manager — uses credit ledger
    this.#escrowManager = new EscrowManager({ creditLedger: this.#creditLedger })

    // 24d. FederatedCompute — adapter bridges meshScheduler + registry
    const computeSchedulerAdapter = {
      dispatch: async (peerId, job) => {
        const { ScheduledTask } = await import('./clawser-mesh-scheduler.js')
        const task = new ScheduledTask({
          id: job.id || crypto.randomUUID(),
          type: job.type || 'compute',
          payload: job,
          submittedBy: podId,
        })
        return this.#meshScheduler.submit(task)
      },
      listAvailablePeers: () => {
        return this.#registry.listPeers({ status: 'connected' })
          .map(p => p.fingerprint || p.podId || p.pubKey)
      },
    }
    this.#federatedCompute = new FederatedCompute({ scheduler: computeSchedulerAdapter })

    // 24e. AgentSwarmCoordinator — adapter proxies to peerNode messaging
    const agentProxyAdapter = {
      chat: async (peerId, message) => {
        // Route through session manager if a session exists
        const sessions = this.#sessionManager?.listSessions?.() || []
        const session = sessions.find(s =>
          s.remoteIdentity === peerId || s.remoteIdentity?.podId === peerId
        )
        if (session) {
          session.send({ type: 'agent:chat', payload: { message } })
          return `[dispatched to ${peerId}]`
        }
        return `[no session for ${peerId}]`
      },
    }
    this.#agentSwarmCoordinator = new AgentSwarmCoordinator({ agentProxy: agentProxyAdapter })

    // 25. Ops & Resilience (Track 5)
    this.#meshRouter = new MeshRouter({ localPodId: podId })
    this.#migrationEngine = new MigrationEngine(podId)

    // 25a. HealthMonitor — monitors session health
    this.#healthMonitor = new HealthMonitor({
      sessions: this.#sessionManager,
      trust: this.#registry,
    })

    // 25b. VerificationQuorum — uses scheduler adapter and trust from registry
    const verificationSchedulerAdapter = {
      dispatch: async (peerId, job) => {
        const sessions = this.#sessionManager?.listSessions?.() || []
        const session = sessions.find(s =>
          s.remoteIdentity === peerId || s.remoteIdentity?.podId === peerId
        )
        if (!session) throw new Error(`No session for peer ${peerId}`)
        session.send({ type: 'verification:dispatch', payload: job })
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Verification timeout')), 30000)
          session.registerHandler?.('verification:result', (msg) => {
            clearTimeout(timeout)
            resolve(msg.payload || msg)
          })
        })
      },
    }
    const trustAdapter = {
      getReputation: (pid) => this.#registry.getReputation?.(pid) ?? 0.5,
      listTrustedPeers: (threshold) => {
        const peers = this.#registry.listPeers({ status: 'connected' })
        return peers
          .filter(p => (this.#registry.getReputation?.(p.fingerprint || p.podId) ?? 0.5) >= (threshold ?? 0))
          .map(p => p.fingerprint || p.podId)
      },
    }
    this.#verificationQuorum = new VerificationQuorum({
      scheduler: verificationSchedulerAdapter,
      trust: trustAdapter,
    })

    // 25c. StealthAgent — threshold-encrypted state via DHT
    this.#stealthAgent = new StealthAgent({
      agentId: podId,
      dhtNode: this.#dhtNode,
    })

    // 25d. MeshFetchRouter — intercept mesh:// URLs
    this.#meshFetchRouter = new MeshFetchRouter({
      onRpc: async (method, params) => {
        // Route RPC calls through the name resolver and session broker
        const resolved = this.#nameResolver?.resolve?.(params?.target)
        return { resolved, method, params }
      },
    })

    // 25e. TimestampAuthority — needs sessions + identity
    const timestampIdentityAdapter = {
      podId,
      sign: async (data) => {
        if (this.#wallet) {
          const defaultId = this.#wallet.getDefault()
          if (defaultId?.keyPair?.privateKey) {
            const encoded = typeof data === 'string' ? new TextEncoder().encode(data) : data
            return crypto.subtle.sign({ name: 'Ed25519' }, defaultId.keyPair.privateKey, encoded)
          }
        }
        return new Uint8Array(64) // fallback stub
      },
    }
    this.#timestampAuthority = new TimestampAuthority({
      sessions: this.#sessionManager,
      identity: timestampIdentityAdapter,
    })

    this.#meshInspector = new MeshInspector({
      pod: this,
      peerNode: this.#peerNode,
      swarmCoordinator: this.#swarmCoordinator,
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
      appRegistry: this.#appRegistry,
      appStore: this.#appStore,
      orchestrator: this.#orchestrator,
      sessionManager: this.#sessionManager,
      discoveryManager: this.#discoveryManager,
    })
    this.#syncCoordinator = new SyncCoordinator({ localPodId: podId })

    return {
      peerNode: this.#peerNode,
      swarmCoordinator: this.#swarmCoordinator,
      discoveryManager: this.#discoveryManager,
      transportNegotiator: this.#transportNegotiator,
      auditChain: this.#auditChain,
      streamMultiplexer: this.#streamMultiplexer,
      fileTransfer: this.#fileTransfer,
      serviceDirectory: this.#serviceDirectory,
      serviceAdvertiser: this.#serviceAdvertiser,
      serviceBrowser: this.#serviceBrowser,
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
      remoteAuditRecorder: this.#remoteAuditRecorder,
      appRegistry: this.#appRegistry,
      appStore: this.#appStore,
      orchestrator: this.#orchestrator,
      // Track 1: Transports
      transportFactory: this.#transportFactory,
      // Track 2: Security
      handshakeCoordinator: this.#handshakeCoordinator,
      meshACL: this.#meshACL,
      capabilityValidator: this.#capabilityValidator,
      crossOriginBridge: this.#crossOriginBridge,
      verificationQuorum: this.#verificationQuorum,
      sessionManager: this.#sessionManager,
      // Track 3: Communication
      meshChat: this.#meshChat,
      gatewayNode: this.#gatewayNode,
      gatewayDiscovery: this.#gatewayDiscovery,
      torrentManager: this.#torrentManager,
      ipfsStore: this.#ipfsStore,
      // Track 4: Compute
      meshScheduler: this.#meshScheduler,
      federatedCompute: this.#federatedCompute,
      agentSwarmCoordinator: this.#agentSwarmCoordinator,
      // Track 5: Ops
      dhtNode: this.#dhtNode,
      creditLedger: this.#creditLedger,
      escrowManager: this.#escrowManager,
      healthMonitor: this.#healthMonitor,
      meshRouter: this.#meshRouter,
      migrationEngine: this.#migrationEngine,
      meshInspector: this.#meshInspector,
      stealthAgent: this.#stealthAgent,
      meshFetchRouter: this.#meshFetchRouter,
      timestampAuthority: this.#timestampAuthority,
      syncCoordinator: this.#syncCoordinator,
    }
  }

  _onMessage(msg) {
    // Forward pod-level messages as events
    // Listeners can subscribe via pod.on('pod:message', ...)
  }

  /**
   * Tear down the pod and all mesh subsystems.
   * Stops the peer node, sync engine, relay client, and WSH connectors,
   * then nulls all references so the pod can be garbage-collected.
   * Delegates to Pod.shutdown() at the end for base-class cleanup.
   *
   * Called by cleanupWorkspace() during workspace switching / destruction.
   *
   * @param {object} [opts] - Forwarded to Pod.shutdown()
   * @returns {Promise<void>}
   */
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
    if (this.#remoteWshConnectors?.disconnectAll) {
      try { await this.#remoteWshConnectors.disconnectAll() } catch { /* non-fatal */ }
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
    this.#serviceAdvertiser = null
    this.#serviceBrowser = null
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
    this.#remoteAuditRecorder = null
    this.#appRegistry = null
    this.#appStore = null
    this.#orchestrator = null
    // Track 1
    this.#transportFactory = null
    // Track 2
    this.#handshakeCoordinator = null
    this.#meshACL = null
    this.#capabilityValidator = null
    this.#crossOriginBridge = null
    this.#verificationQuorum = null
    this.#encryptedBlobStore = null
    // Track 3
    this.#meshChat = null
    this.#gatewayNode = null
    this.#gatewayDiscovery = null
    this.#torrentManager = null
    this.#ipfsStore = null
    // Track 4
    this.#federatedCompute = null
    this.#agentSwarmCoordinator = null
    this.#meshScheduler = null
    // Track 5
    this.#healthMonitor = null
    this.#meshInspector = null
    this.#migrationEngine = null
    this.#sessionManager = null
    this.#timestampAuthority = null
    this.#stealthAgent = null
    this.#meshRouter = null
    this.#meshFetchRouter = null
    this.#meshWshBridge = null
    this.#syncCoordinator = null
    this.#escrowManager = null
    this.#dhtNode = null
    this.#creditLedger = null
    await super.shutdown(opts)
  }
}
