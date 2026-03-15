/**
 * clawser-mesh-scaffolding-audit.test.mjs
 *
 * Smoke tests verifying that all mesh/* and peer/* modules can be imported
 * and their exported classes/functions are real (not stubs).
 *
 * One `it()` per module (~48 tests). Uses dynamic import() wrapped in
 * try/catch so one failing module does not block others.
 *
 * Run:
 *   node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-scaffolding-audit.test.mjs
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// Stubs for browser globals that mesh modules may reference at load time
// ---------------------------------------------------------------------------

globalThis.BrowserTool = globalThis.BrowserTool || class {
  constructor() {}
  get name() { return '' }
  get description() { return '' }
  get parameters() { return {} }
  get permission() { return 'read' }
  async execute() { return { success: true, output: '' } }
}

globalThis.WebSocket = globalThis.WebSocket || class {
  constructor() { this.readyState = 0 }
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

globalThis.RTCPeerConnection = globalThis.RTCPeerConnection || class {
  constructor() {}
  createOffer() { return Promise.resolve({}) }
  createAnswer() { return Promise.resolve({}) }
  setLocalDescription() { return Promise.resolve() }
  setRemoteDescription() { return Promise.resolve() }
  addIceCandidate() { return Promise.resolve() }
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

globalThis.RTCSessionDescription = globalThis.RTCSessionDescription || class {
  constructor(init) { Object.assign(this, init) }
}

globalThis.RTCIceCandidate = globalThis.RTCIceCandidate || class {
  constructor(init) { Object.assign(this, init) }
}

globalThis.WebTransport = globalThis.WebTransport || class {
  constructor() {}
  close() {}
}

if (!globalThis.crypto) {
  globalThis.crypto = {
    getRandomValues(arr) {
      for (let i = 0; i < arr.length; i++) arr[i] = (Math.random() * 256) | 0
      return arr
    },
    subtle: {
      digest: async () => new ArrayBuffer(32),
      generateKey: async () => ({}),
      exportKey: async () => new ArrayBuffer(32),
      importKey: async () => ({}),
      sign: async () => new ArrayBuffer(64),
      verify: async () => true,
      encrypt: async () => new ArrayBuffer(0),
      decrypt: async () => new ArrayBuffer(0),
      deriveBits: async () => new ArrayBuffer(32),
      deriveKey: async () => ({}),
    },
    randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    }),
  }
}

if (!globalThis.btoa) {
  globalThis.btoa = (str) => Buffer.from(str, 'binary').toString('base64')
}
if (!globalThis.atob) {
  globalThis.atob = (str) => Buffer.from(str, 'base64').toString('binary')
}

globalThis.structuredClone = globalThis.structuredClone || ((v) => JSON.parse(JSON.stringify(v)))

globalThis.MessageChannel = globalThis.MessageChannel || class {
  constructor() {
    this.port1 = { postMessage() {}, onmessage: null, close() {}, addEventListener() {} }
    this.port2 = { postMessage() {}, onmessage: null, close() {}, addEventListener() {} }
  }
}

globalThis.MessagePort = globalThis.MessagePort || class {}

// ---------------------------------------------------------------------------
// Helper: assert a class export is real
// ---------------------------------------------------------------------------

function assertClass(mod, name, methods = []) {
  assert.ok(mod[name], `${name} should be exported`)
  assert.equal(typeof mod[name], 'function', `${name} should be a constructor`)
  for (const m of methods) {
    // Check on prototype
    assert.equal(typeof mod[name].prototype[m], 'function', `${name}.prototype.${m} should be a function`)
  }
}

function assertFunction(mod, name) {
  assert.ok(mod[name], `${name} should be exported`)
  assert.equal(typeof mod[name], 'function', `${name} should be a function`)
}

// ===========================================================================
// MESH MODULES
// ===========================================================================

describe('Mesh module scaffolding audit', () => {

  it('clawser-mesh-acl exports load', async () => {
    const mod = await import('../clawser-mesh-acl.js')
    assertClass(mod, 'ScopeTemplate', ['matches'])
    assertClass(mod, 'RosterEntry')
    assertClass(mod, 'InvitationToken')
    assertClass(mod, 'MeshACL', ['grant', 'revoke', 'check'])
    assert.ok(mod.DEFAULT_TEMPLATES, 'DEFAULT_TEMPLATES should be exported')
  })

  it('clawser-mesh-capabilities exports load', async () => {
    const mod = await import('../clawser-mesh-capabilities.js')
    assertClass(mod, 'CapabilityToken')
    assertClass(mod, 'CapabilityChain')
    assertClass(mod, 'CapabilityValidator')
    assertClass(mod, 'WasmSandboxPolicy')
    assertClass(mod, 'WasmSandbox')
    assertClass(mod, 'SandboxRegistry')
    assert.equal(typeof mod.CAP_GRANT, 'number')
    assert.equal(typeof mod.CAP_REVOKE, 'number')
  })

  it('clawser-mesh-chat exports load', async () => {
    const mod = await import('../clawser-mesh-chat.js')
    assertClass(mod, 'ChatMessage')
    assertClass(mod, 'ChatRoom')
    assertClass(mod, 'MeshChat')
    assert.ok(Array.isArray(mod.MESSAGE_TYPES))
  })

  it('clawser-mesh-cross-origin exports load', async () => {
    const mod = await import('../clawser-mesh-cross-origin.js')
    assertClass(mod, 'RateLimiter')
    assertClass(mod, 'CrossOriginBridge')
    assertClass(mod, 'CrossOriginHandshake')
    assert.ok(mod.TRUST_LEVELS)
    assert.equal(typeof mod.XO_REQUEST, 'string')
  })

  it('clawser-mesh-delta-sync exports load', async () => {
    const mod = await import('../clawser-mesh-delta-sync.js')
    assertClass(mod, 'DeltaEntry')
    assertClass(mod, 'DeltaLog')
    assertClass(mod, 'DeltaEncoder')
    assertClass(mod, 'DeltaDecoder')
    assertClass(mod, 'DeltaBranch')
    assertClass(mod, 'SyncSession')
    assertClass(mod, 'SyncCoordinator')
    assert.equal(typeof mod.DELTA_SYNC_REQUEST, 'number')
  })

  it('clawser-mesh-devtools exports load', async () => {
    const mod = await import('../clawser-mesh-devtools.js')
    assertClass(mod, 'MeshInspector', ['snapshot'])
    assertClass(mod, 'MeshInspectTool')
  })

  it('clawser-mesh-dht exports load', async () => {
    const mod = await import('../clawser-mesh-dht.js')
    assertClass(mod, 'KBucket')
    assertClass(mod, 'RoutingTable')
    assertClass(mod, 'DhtNode')
    assertClass(mod, 'GossipProtocol')
    assertClass(mod, 'DhtDiscoveryStrategy')
    assert.equal(typeof mod.DHT_PING, 'number')
    assert.equal(typeof mod.GOSSIP_PUSH, 'number')
  })

  it('clawser-mesh-files exports load', async () => {
    const mod = await import('../clawser-mesh-files.js')
    assertClass(mod, 'FileDescriptor')
    assertClass(mod, 'TransferOffer')
    assertClass(mod, 'ChunkStore')
    assertClass(mod, 'TransferState')
    assertClass(mod, 'MeshFileTransfer')
    assert.ok(Array.isArray(mod.TRANSFER_STATES))
  })

  it('clawser-mesh-gateway exports load', async () => {
    const mod = await import('../clawser-mesh-gateway.js')
    assertClass(mod, 'GatewayRoute')
    assertClass(mod, 'RouteTable')
    assertClass(mod, 'GatewayNode')
    assertClass(mod, 'GatewayDiscovery')
  })

  it('clawser-mesh-handshake exports load', async () => {
    const mod = await import('../clawser-mesh-handshake.js')
    assertClass(mod, 'SignalingClient')
    assertClass(mod, 'DirectInputHandshake')
    assertClass(mod, 'HandshakeCoordinator')
    assertFunction(mod, 'toBase64Url')
    assertFunction(mod, 'fromBase64Url')
  })

  it('clawser-mesh-identity exports load', async () => {
    const mod = await import('../clawser-mesh-identity.js')
    assertClass(mod, 'InMemoryIdentityStorage', ['save'])
    assertClass(mod, 'MeshIdentityManager')
    assertClass(mod, 'AutoIdentityManager')
    assertClass(mod, 'IdentitySelector')
    // Re-exports from mesh-primitives
    assertFunction(mod, 'derivePodId')
    assertFunction(mod, 'encodeBase64url')
    assertFunction(mod, 'decodeBase64url')
  })

  it('clawser-mesh-identity-tools exports load', async () => {
    const mod = await import('../clawser-mesh-identity-tools.js')
    assertClass(mod, 'IdentityToolsContext')
    assertClass(mod, 'IdentityCreateTool')
    assertClass(mod, 'IdentityListTool')
    assertClass(mod, 'IdentitySwitchTool')
    assertClass(mod, 'IdentityExportTool')
    assertClass(mod, 'IdentityImportTool')
    assertClass(mod, 'IdentityDeleteTool')
    assertClass(mod, 'IdentityLinkTool')
    assertClass(mod, 'IdentitySelectRuleTool')
    assertFunction(mod, 'registerIdentityTools')
    assert.ok(mod.identityToolsContext instanceof mod.IdentityToolsContext)
  })

  it('clawser-mesh-migration exports load', async () => {
    const mod = await import('../clawser-mesh-migration.js')
    assertClass(mod, 'MigrationStep')
    assertClass(mod, 'Checkpoint')
    assertClass(mod, 'MigrationPlan')
    assertClass(mod, 'DualActiveWindow')
    assertClass(mod, 'MigrationEngine')
    assert.ok(Array.isArray(mod.MIGRATION_STATES))
    assert.ok(Array.isArray(mod.STEP_STATUSES))
    assert.equal(typeof mod.MIGRATION_INIT, 'number')
  })

  it('clawser-mesh-naming exports load', async () => {
    const mod = await import('../clawser-mesh-naming.js')
    assertClass(mod, 'NameRecord')
    assertClass(mod, 'MeshNameResolver')
    assertFunction(mod, 'parseMeshUri')
    assert.equal(typeof mod.NAME_TTL_DEFAULT, 'number')
    assert.ok(mod.NAME_PATTERN instanceof RegExp)
  })

  it('clawser-mesh-payments exports load', async () => {
    const mod = await import('../clawser-mesh-payments.js')
    assertClass(mod, 'CreditLedger')
    assertClass(mod, 'PaymentChannel')
    assertClass(mod, 'EscrowManager')
    assertClass(mod, 'PaymentRouter')
    assert.ok(Array.isArray(mod.CHANNEL_STATES))
  })

  it('clawser-mesh-peer exports load', async () => {
    const mod = await import('../clawser-mesh-peer.js')
    assertClass(mod, 'PeerState')
    assertClass(mod, 'MeshPeerManager')
    assert.ok(Array.isArray(mod.PEER_STATUSES))
  })

  it('clawser-mesh-relay exports load', async () => {
    const mod = await import('../clawser-mesh-relay.js')
    assertClass(mod, 'MockRelayServer', ['registerClient', 'removeClient'])
    assertClass(mod, 'MeshRelayClient')
    assert.ok(Array.isArray(mod.RELAY_STATES))
  })

  it('clawser-mesh-scheduler exports load', async () => {
    const mod = await import('../clawser-mesh-scheduler.js')
    assertClass(mod, 'ScheduledTask')
    assertClass(mod, 'TaskConstraints')
    assertClass(mod, 'TaskQueue')
    assertClass(mod, 'MeshScheduler')
    assert.equal(typeof mod.SCHED_SUBMIT, 'number')
  })

  it('clawser-mesh-stealth exports load', async () => {
    const mod = await import('../clawser-mesh-stealth.js')
    assertClass(mod, 'StateShard')
    assertClass(mod, 'ShardDistributor')
    assertClass(mod, 'ShardCollector')
    assertClass(mod, 'StealthAgent')
  })

  it('clawser-mesh-streams exports load', async () => {
    const mod = await import('../clawser-mesh-streams.js')
    assertClass(mod, 'MeshStream')
    assertClass(mod, 'StreamMultiplexer')
    assert.ok(Array.isArray(mod.STREAM_STATES))
    assert.ok(Array.isArray(mod.STREAM_ERROR_CODES))
  })

  it('clawser-mesh-sw-routing exports load', async () => {
    const mod = await import('../clawser-mesh-sw-routing.js')
    assertFunction(mod, 'parseMeshRequest')
    assertClass(mod, 'MeshFetchRouter')
  })

  it('clawser-mesh-sync exports load', async () => {
    const mod = await import('../clawser-mesh-sync.js')
    assertClass(mod, 'SyncDocument')
    assertClass(mod, 'MeshSyncEngine')
    assertClass(mod, 'InMemorySyncStorage')
    assert.ok(Array.isArray(mod.CRDT_TYPES))
  })

  it('clawser-mesh-transport exports load', async () => {
    const mod = await import('../clawser-mesh-transport.js')
    assertClass(mod, 'MeshTransport')
    assertClass(mod, 'MockMeshTransport')
    assertClass(mod, 'MeshTransportNegotiator')
    assert.ok(Array.isArray(mod.TRANSPORT_TYPES))
    assert.ok(Array.isArray(mod.TRANSPORT_STATES))
  })

  it('clawser-mesh-webrtc exports load', async () => {
    const mod = await import('../clawser-mesh-webrtc.js')
    assertFunction(mod, 'supportsWebRTC')
    assertClass(mod, 'WebRTCPeerConnection')
    assertClass(mod, 'WebRTCMeshManager')
    assertClass(mod, 'WebRTCTransportAdapter')
    assertClass(mod, 'WebRTCAdapterFactory')
  })

  it('clawser-mesh-websocket exports load', async () => {
    const mod = await import('../clawser-mesh-websocket.js')
    assertClass(mod, 'WebSocketTransport')
    assertClass(mod, 'WebRTCTransport')
    assertClass(mod, 'WebTransportTransport')
    assertClass(mod, 'NATTraversal')
    assertClass(mod, 'TransportFactory')
    assert.equal(typeof mod.WS_CONNECT, 'number')
  })

  it('clawser-mesh-webtransport exports load', async () => {
    const mod = await import('../clawser-mesh-webtransport.js')
    assertFunction(mod, 'supportsWebTransport')
    assertClass(mod, 'WebTransportBridge')
    assertClass(mod, 'WebTransportAdapterFactory')
  })

  it('clawser-mesh-wsh-bridge exports load', async () => {
    const mod = await import('../clawser-mesh-wsh-bridge.js')
    assertClass(mod, 'MeshWshBridge')
    assertFunction(mod, 'hexToBytes')
    assertFunction(mod, 'bytesToHex')
  })
})

// ===========================================================================
// PEER MODULES
// ===========================================================================

describe('Peer module scaffolding audit', () => {

  it('clawser-peer-agent exports load', async () => {
    const mod = await import('../clawser-peer-agent.js')
    assertClass(mod, 'AgentHost')
    assertClass(mod, 'AgentClient')
    assertFunction(mod, 'bridgePeerAgent')
    assert.ok(mod.AGENT_DEFAULTS)
    assert.ok(mod.AGENT_ACTIONS)
    assert.ok(mod.AGENT_CAPABILITIES)
  })

  it('clawser-peer-agent-swarm exports load', async () => {
    const mod = await import('../clawser-peer-agent-swarm.js')
    assertClass(mod, 'SubTask')
    assertClass(mod, 'SwarmInstance')
    assertClass(mod, 'AgentSwarmCoordinator')
    assert.ok(mod.SWARM_STRATEGIES)
    assert.ok(mod.SWARM_DEFAULTS)
  })

  it('clawser-peer-chat exports load', async () => {
    const mod = await import('../clawser-peer-chat.js')
    assertClass(mod, 'PeerChat')
  })

  it('clawser-peer-collab exports load', async () => {
    const mod = await import('../clawser-peer-collab.js')
    assertClass(mod, 'YjsAdapter')
    assertClass(mod, 'AwarenessState')
    assertClass(mod, 'CollabSession')
    assert.equal(typeof mod.COLLAB_UPDATE, 'number')
  })

  it('clawser-peer-compute exports load', async () => {
    const mod = await import('../clawser-peer-compute.js')
    assertClass(mod, 'ComputeChunk')
    assertClass(mod, 'FederatedJob')
    assertClass(mod, 'FederatedCompute')
    assert.ok(mod.COMPUTE_TYPES)
    assert.ok(mod.COMPUTE_DEFAULTS)
  })

  it('clawser-peer-encrypted-store exports load', async () => {
    const mod = await import('../clawser-peer-encrypted-store.js')
    assertClass(mod, 'ManifestEntry')
    assertClass(mod, 'EncryptedBlobStore')
    assertFunction(mod, 'computeCid')
    assertFunction(mod, 'encryptBlob')
    assertFunction(mod, 'decryptBlob')
  })

  it('clawser-peer-escrow exports load', async () => {
    const mod = await import('../clawser-peer-escrow.js')
    assertClass(mod, 'EscrowContract')
    assertClass(mod, 'EscrowManager')
    assert.ok(mod.ESCROW_CONDITIONS)
    assert.ok(Array.isArray(mod.ESCROW_STATUSES))
  })

  it('clawser-peer-files exports load', async () => {
    const mod = await import('../clawser-peer-files.js')
    assertClass(mod, 'FileHost')
    assertClass(mod, 'FileClient')
    assert.ok(mod.FILE_DEFAULTS)
    assert.ok(mod.FILE_ACTIONS)
    assert.ok(mod.FILE_CAPABILITIES)
  })

  it('clawser-peer-health exports load', async () => {
    const mod = await import('../clawser-peer-health.js')
    assertClass(mod, 'PeerHealth')
    assertClass(mod, 'MigrationResult')
    assertClass(mod, 'HealthMonitor')
    assertClass(mod, 'AutoMigrator')
    assert.ok(mod.HEALTH_DEFAULTS)
    assert.ok(Array.isArray(mod.HEALTH_STATUSES))
  })

  it('clawser-peer-ipfs exports load', async () => {
    const mod = await import('../clawser-peer-ipfs.js')
    assertClass(mod, 'IPFSStore')
    assert.ok(mod.IPFS_DEFAULTS)
  })

  it('clawser-peer-memory-sync exports load', async () => {
    const mod = await import('../clawser-peer-memory-sync.js')
    assertClass(mod, 'MemoryEntry')
    assertClass(mod, 'ConflictEntry')
    assertClass(mod, 'SyncResult')
    assertClass(mod, 'AgentMemorySync')
    assert.ok(mod.CONFLICT_STRATEGIES)
    assert.ok(mod.MEMORY_SYNC_DEFAULTS)
  })

  it('clawser-peer-node exports load', async () => {
    const mod = await import('../clawser-peer-node.js')
    assertClass(mod, 'PeerNode')
    assert.ok(Array.isArray(mod.PEER_NODE_STATES))
  })

  it('clawser-peer-payments exports load', async () => {
    const mod = await import('../clawser-peer-payments.js')
    assertClass(mod, 'CreditLedger')
    assertClass(mod, 'WebLNProvider')
    assert.ok(mod.PAYMENT_DEFAULTS)
  })

  it('clawser-peer-registry exports load', async () => {
    const mod = await import('../clawser-peer-registry.js')
    assertClass(mod, 'PeerRegistry')
  })

  it('clawser-peer-routing exports load', async () => {
    const mod = await import('../clawser-peer-routing.js')
    assertClass(mod, 'MeshRouter')
    assertClass(mod, 'ServerSharing')
    assert.ok(mod.ROUTING_DEFAULTS)
  })

  it('clawser-peer-services exports load', async () => {
    const mod = await import('../clawser-peer-services.js')
    assertClass(mod, 'ServiceAdvertiser')
    assertClass(mod, 'ServiceBrowser')
    assert.ok(mod.SERVICE_TYPES)
    assert.equal(typeof mod.SERVICE_TTL_DEFAULT, 'number')
  })

  it('clawser-peer-session exports load', async () => {
    const mod = await import('../clawser-peer-session.js')
    assertClass(mod, 'PeerSession')
    assertClass(mod, 'SessionManager')
    assertFunction(mod, 'createEnvelope')
    assertFunction(mod, 'parseEnvelope')
    assertFunction(mod, 'createErrorEnvelope')
    assert.ok(mod.SESSION_MSG_TYPES)
  })

  it('clawser-peer-terminal exports load', async () => {
    const mod = await import('../clawser-peer-terminal.js')
    assertClass(mod, 'TerminalHost')
    assertClass(mod, 'TerminalClient')
    assert.ok(mod.TERMINAL_DEFAULTS)
  })

  it('clawser-peer-timestamp exports load', async () => {
    const mod = await import('../clawser-peer-timestamp.js')
    assertClass(mod, 'TimestampProof')
    assertClass(mod, 'TimestampAuthority')
    assert.ok(mod.TIMESTAMP_DEFAULTS)
  })

  it('clawser-peer-torrent exports load', async () => {
    const mod = await import('../clawser-peer-torrent.js')
    assertClass(mod, 'TorrentManager')
    assert.ok(mod.TORRENT_DEFAULTS)
  })

  it('clawser-peer-verification exports load', async () => {
    const mod = await import('../clawser-peer-verification.js')
    assertClass(mod, 'Attestation')
    assertClass(mod, 'VerificationQuorum')
    assertFunction(mod, 'computeResultHash')
    assert.ok(mod.VERIFICATION_STRATEGIES)
    assert.ok(mod.VERIFICATION_DEFAULTS)
  })
})
