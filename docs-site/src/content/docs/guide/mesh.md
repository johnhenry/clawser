---
title: "Mesh"
---

BrowserMesh modules, identity, transport, CRDT, DHT, marketplace, consensus, swarm

---

### Mesh Peer

**Status:** ✅ Implemented · **Category:** core · **Since:** v2.0.0

Core mesh peer implementation. PeerState tracks fingerprint, label, status (disconnected/connecting/connected/authenticated), transport, endpoint, latency, last seen time, capabilities, and trust level.

**Source files:**

- `web/clawser-mesh-peer.js`

**API surface:**

- `PeerState`
- `PEER_STATUSES`

**See also:**

- Mesh Transport
- Mesh Identity

---

### Mesh Swarm

**Status:** ✅ Implemented · **Category:** coordination · **Since:** v2.0.0

Swarm coordination using SWIM protocol for membership management. Supports leader-follower, round-robin, load-balanced, redundant, and pipeline task strategies. SWIM detects alive/suspect/dead/left member states.

**Source files:**

- `web/clawser-mesh-swarm.js`

**API surface:**

- `SwarmMember`
- `SwarmRole`
- `TaskStrategy`
- `SWIM_MEMBER_STATES`

> **Note:** Task strategies: leader-follower, round-robin, load-balanced, redundant, pipeline.

---

### Mesh DHT

**Status:** ✅ Implemented · **Category:** storage · **Since:** v2.0.0

Distributed hash table with Kademlia-style XOR distance routing. Supports store, find-value, find-node, and gossip protocols. Includes stealth shard support for private storage.

**Source files:**

- `web/clawser-mesh-dht.js`

**API surface:**

- `xorDistance`
- `compareDistance`
- `highestBitIndex`

> **Note:** Wire messages: DHT_PING, DHT_FIND_NODE, DHT_FIND_VALUE, DHT_STORE, GOSSIP_PUSH/PULL/DIGEST.

---

### Mesh Relay

**Status:** ✅ Implemented · **Category:** transport · **Since:** v2.0.0

Message relay for peers that cannot establish direct connections. MockRelayServer provides a testing relay. Production relay uses WebSocket forwarding.

**Source files:**

- `web/clawser-mesh-relay.js`

**API surface:**

- `MockRelayServer`

---

### Mesh Transport

**Status:** ✅ Implemented · **Category:** transport · **Since:** v2.0.0

Transport layer abstraction supporting WebRTC, WSH-WebTransport, and WSH-WebSocket. Tracks connection state (disconnected/connecting/connected/closing/closed) and latency.

**Source files:**

- `web/clawser-mesh-transport.js`

**API surface:**

- `MeshTransport`
- `TRANSPORT_TYPES`
- `TRANSPORT_STATES`

> **Note:** Transport types: webrtc, wsh-wt (WebTransport), wsh-ws (WebSocket).

---

### Mesh Identity

**Status:** ✅ Implemented · **Category:** identity · **Since:** v2.0.0

Ed25519 cryptographic identity system for mesh participants. Each node generates a keypair (PodIdentity) for signing and verification. Supports multiple identities, labels, DID generation, and in-memory or persistent storage. Vault-encrypted storage with PBKDF2 key derivation.

**Source files:**

- `web/clawser-mesh-identity.js`

**API surface:**

- `PodIdentity`
- `derivePodId`
- `InMemoryIdentityStorage`
- `encodeBase64url`
- `decodeBase64url`

> **Note:** VAULT_PBKDF2_ITERATIONS for key derivation, VAULT_SALT_BYTES and VAULT_IV_BYTES for encryption.

---

### Mesh Keyring

**Status:** ✅ Implemented · **Category:** identity · **Since:** v2.0.0

Key management system for mesh cryptographic operations. Manages Ed25519 signing keys, encryption keys, and group key distribution.

**Source files:**

- `web/clawser-mesh-keyring.js`

**API surface:**

- `MeshKeyring`

---

### Mesh Group Keys

**Status:** ✅ Implemented · **Category:** identity · **Since:** v2.0.0

Group key management for encrypted multi-party communication. Supports key rotation and member addition/removal.

**Source files:**

- `web/clawser-mesh-group-keys.js`

**API surface:**

- `GroupKeyManager`

---

### Mesh Trust

**Status:** ✅ Implemented · **Category:** identity · **Since:** v2.0.0

Trust computation system with categories and transitive trust propagation. Creates trust edges between peers and computes composite trust scores.

**Source files:**

- `web/clawser-mesh-trust.js`

**API surface:**

- `TRUST_CATEGORIES`
- `createTrustEdge`
- `computeTransitiveTrust`

---

### Mesh Sync (CRDT)

**Status:** ✅ Implemented · **Category:** sync · **Since:** v2.0.0

CRDT-based state synchronization. Supports 6 CRDT types: LWW-Register, G-Counter, PN-Counter, OR-Set, RGA (Replicated Growable Array), and LWW-Map. SyncDocument wraps a CRDT with metadata, ACL, and versioning.

**Source files:**

- `web/clawser-mesh-sync.js`

**API surface:**

- `SyncDocument`
- `CRDT_TYPES`
- `CRDT_CONSTRUCTORS`

> **Note:** CRDT types: lww-register, g-counter, pn-counter, or-set, rga, lww-map.

---

### Mesh Delta Sync

**Status:** ✅ Implemented · **Category:** sync · **Since:** v2.0.0

Efficient delta-based synchronization that only transmits changes rather than full state. Reduces bandwidth for large synchronized documents.

**Source files:**

- `web/clawser-mesh-delta-sync.js`

**API surface:**

- `SyncCoordinator`

---

### Mesh Consensus

**Status:** ✅ Implemented · **Category:** consensus · **Since:** v2.0.0

Distributed consensus protocol for mesh-wide decisions. Supports simple majority, super majority, unanimous, and weighted voting. Proposals have quorum and deadline requirements.

**Source files:**

- `web/clawser-mesh-consensus.js`

**API surface:**

- `Proposal`
- `VoteType`
- `generateProposalId`

> **Note:** Vote types: SIMPLE, SUPER, UNANIMOUS, WEIGHTED.

---

### PBFT Consensus

**Status:** ✅ Implemented · **Category:** consensus · **Since:** v2.0.0

Practical Byzantine Fault Tolerance consensus (pre-prepare/prepare/commit, 3f+1 validator quorum) for strongly consistent mesh operations, opt-in via ClawserPod.initMesh({ enablePBFT: true }). Backed by the raijin-consensus npm package. web/clawser-mesh-consensus.js's ConsensusManager is a separate, simpler majority/super-majority/weighted voting mechanism — not PBFT — used where sub-second finality isn't required.

**Source files:**

- `web/clawser-pod.js`

**API surface:**

- `pbftConsensus`

---

### Mesh Discovery

**Status:** ✅ Implemented · **Category:** discovery · **Since:** v2.0.0

Peer and service discovery system. DiscoveryRecord tracks podId, label, endpoint, transport, capabilities, metadata, and TTL with expiration. Supports announce, query, response, and goodbye messages.

**Source files:**

- `web/clawser-mesh-discovery.js`

**API surface:**

- `DiscoveryRecord`

> **Note:** Wire messages: DISCOVERY_ANNOUNCE, DISCOVERY_QUERY, DISCOVERY_RESPONSE, DISCOVERY_GOODBYE.

---

### Mesh Naming

**Status:** ✅ Implemented · **Category:** discovery · **Since:** v2.0.0

Name resolution service for the mesh. Maps human-readable names to peer identities and endpoints.

**Source files:**

- `web/clawser-mesh-naming.js`

**API surface:**

- `MeshNameResolver`

---

### Mesh Handshake

**Status:** ✅ Implemented · **Category:** transport · **Since:** v2.0.0

Secure handshake protocol for establishing authenticated connections between mesh peers with capability negotiation.

**Source files:**

- `web/clawser-mesh-handshake.js`

**API surface:**

- `HandshakeCoordinator`

---

### Mesh ACL

**Status:** ✅ Implemented · **Category:** security · **Since:** v2.0.0

Access Control List engine for mesh resource protection. Supports permissions, access grants, scope matching, and default templates (guest, collaborator, admin).

**Source files:**

- `web/clawser-mesh-acl.js`

**API surface:**

- `ACLEngine`
- `AccessGrant`
- `Permission`
- `ScopeTemplate`
- `DEFAULT_TEMPLATES`
- `generateGrantId`
- `matchScope`

> **Note:** Default templates: guest (read-only), collaborator (read-write), admin (full).

---

### Mesh Capabilities

**Status:** ✅ Implemented · **Category:** security · **Since:** v2.0.0

Capability token system for fine-grained access control. Tokens have issuer, holder, resource, permissions, constraints, parent chain, expiration, and delegation depth limits.

**Source files:**

- `web/clawser-mesh-capabilities.js`

**API surface:**

- `CapabilityToken`

> **Note:** Wire messages: CAP_GRANT, CAP_REVOKE, CAP_DELEGATE, WASM_SANDBOX_CTRL.

---

### Mesh Marketplace

**Status:** ✅ Implemented · **Category:** marketplace · **Since:** v2.0.0

Decentralized service marketplace for mesh peers. ServiceListing with name, description, category, pricing (free/per-call/subscription/credits), tags, version, endpoint, and expiration.

**Source files:**

- `web/clawser-mesh-marketplace.js`

**API surface:**

- `ServiceListing`
- `VALID_STATUSES`
- `VALID_PRICING_MODELS`

> **Note:** Pricing models: free, per-call, subscription, credits.

---

### Mesh Payments

**Status:** ✅ Implemented · **Category:** payments · **Since:** v2.0.0

Payment routing and escrow system for mesh service transactions.

**Source files:**

- `web/clawser-mesh-payments.js`
- `web/clawser-peer-payments.js`
- `web/clawser-peer-escrow.js`

**API surface:**

- `PaymentRouter`
- `EscrowManager`

---

### Mesh Quotas

**Status:** ✅ Implemented · **Category:** resources · **Since:** v2.0.0

Resource quota management and enforcement for mesh peers. Tracks and limits compute, storage, and bandwidth usage.

**Source files:**

- `web/clawser-mesh-quotas.js`
- `web/clawser-mesh-resources.js`

**API surface:**

- `QuotaManager`
- `QuotaEnforcer`
- `ResourceRegistry`

---

### Mesh GPU

**Status:** ✅ Implemented · **Category:** compute · **Since:** v2.0.0

Distributed GPU compute coordination. GpuCapability tracks WebGPU support, max buffer size, adapter info, and limits. Supports training job sharding and gradient aggregation across peers.

**Source files:**

- `web/clawser-mesh-gpu.js`

**API surface:**

- `GpuCapability`

> **Note:** Wire messages: GPU_PROBE, GPU_SHARD_ASSIGN, GPU_GRADIENT_PUSH, GPU_TRAIN_CONTROL.

---

### Mesh Orchestrator

**Status:** ✅ Implemented · **Category:** orchestration · **Since:** v2.0.0

Kubernetes-style pod orchestration for the mesh. Manages pod lifecycle, deployment, service exposure, draining, and resource monitoring.

**Source files:**

- `web/clawser-mesh-orchestrator.js`

**API surface:**

- `PodInfo`

> **Note:** Wire messages: ORCH_LIST_PODS, ORCH_POD_STATUS, ORCH_EXEC, ORCH_DEPLOY, ORCH_DRAIN, ORCH_EXPOSE, ORCH_ROUTE.

---

### Mesh Scheduler

**Status:** ✅ Implemented · **Category:** orchestration · **Since:** v2.0.0

Distributed task scheduler for the mesh. Submits tasks with priorities, tracks execution, and distributes work across available peers.

**Source files:**

- `web/clawser-mesh-scheduler.js`

**API surface:**

- `MeshScheduler`

---

### Mesh Files

**Status:** ✅ Implemented · **Category:** files · **Since:** v2.0.0

File sharing between mesh peers with transfer offer/accept/cancel protocol.

**Source files:**

- `web/clawser-mesh-files.js`
- `web/clawser-peer-files.js`

**API surface:**

- `MeshFileTransfer`

---

### Mesh Streams

**Status:** ✅ Implemented · **Category:** streams · **Since:** v2.0.0

Multiplexed data stream system for efficient peer-to-peer data transfer. Supports ordered and unordered streams with optional encryption.

**Source files:**

- `web/clawser-mesh-streams.js`

**API surface:**

- `StreamMultiplexer`

---

### Mesh Chat

**Status:** ✅ Implemented · **Category:** chat · **Since:** v2.0.0

Real-time chat system for mesh peers. Supports rooms, message history, and member management.

**Source files:**

- `web/clawser-mesh-chat.js`

**API surface:**

- `MeshChat`

---

### Mesh Audit

**Status:** ✅ Implemented · **Category:** security · **Since:** v2.0.0

Audit chain for recording mesh operations in an append-only log for accountability and debugging.

**Source files:**

- `web/clawser-mesh-audit.js`

**API surface:**

- `AuditChain`

---

### Mesh Stealth

**Status:** ✅ Implemented · **Category:** privacy · **Since:** v2.0.0

Anonymous participation mode for mesh peers. Stealth identities can be saved and restored for privacy-preserving mesh operations.

**Source files:**

- `web/clawser-mesh-stealth.js`

**API surface:**

- `StealthAgent`

---

### Mesh Visualizations

**Status:** ✅ Implemented · **Category:** ui · **Since:** v2.0.0

Visual representations of mesh topology, peer connections, and data flow.

**Source files:**

- `web/clawser-mesh-visualizations.js`

**API surface:**

- `TrustGraphLayout`
- `TrustHeatmap`
- `TopologySnapshot`
- `TopologyLayout`
- `TopologyDiff`
- `TopologyBroadcaster`
- `VisualizationExporter`

---

### Mesh DevTools

**Status:** ✅ Implemented · **Category:** dev · **Since:** v2.0.0

Developer tools for inspecting and debugging mesh state, connections, and message flow.

**Source files:**

- `web/clawser-mesh-devtools.js`

**API surface:**

- `MeshInspector`

---

### Mesh Cross-Origin Bridge

**Status:** ✅ Implemented · **Category:** transport · **Since:** v2.0.0

Bridge for mesh communication across different origins/domains.

**Source files:**

- `web/clawser-mesh-cross-origin.js`

**API surface:**

- `CrossOriginBridge`

---

### Mesh SW Routing

**Status:** ✅ Implemented · **Category:** transport · **Since:** v2.0.0

Service Worker routing integration for mesh requests.

**Source files:**

- `web/clawser-mesh-sw-routing.js`

**API surface:**

- `MeshFetchRouter`
- `parseMeshRequest`

---

### Mesh Migration

**Status:** ✅ Implemented · **Category:** maintenance · **Since:** v2.0.0

Migration engine for upgrading mesh data formats and protocols across versions.

**Source files:**

- `web/clawser-mesh-migration.js`

**API surface:**

- `MigrationEngine`

---

### Mesh Torrent

**Status:** ✅ Implemented · **Category:** files · **Since:** v2.0.0

BitTorrent-like distributed file distribution across mesh peers.

**Source files:**

- `web/clawser-peer-torrent.js`

**API surface:**

- `TorrentManager`

---

### Mesh IPFS

**Status:** ✅ Implemented · **Category:** files · **Since:** v2.0.0

IPFS content-addressed storage integration for the mesh.

**Source files:**

- `web/clawser-peer-ipfs.js`

**API surface:**

- `IPFSStore`

---

### Federated Compute

**Status:** ✅ Implemented · **Category:** compute · **Since:** v2.0.0

Federated computation framework for distributing compute jobs across mesh peers while preserving data locality.

**Source files:**

- `web/clawser-peer-compute.js`

**API surface:**

- `FederatedCompute`

---

### Agent Swarm

**Status:** ✅ Implemented · **Category:** orchestration · **Since:** v2.0.0

Multi-agent swarm coordination across mesh peers. Creates and manages collaborative agent swarms for distributed task execution.

**Source files:**

- `web/clawser-peer-agent-swarm.js`

**API surface:**

- `AgentSwarmCoordinator`

---

### Mesh Primitives Package

**Status:** ✅ Implemented · **Category:** primitives · **Since:** v2.0.0

Core mesh primitives library (packages-mesh-primitives). Exports identity, wire format, capabilities, trust, ACL, CRDTs, and test utilities. Shared foundation for all mesh modules.

**Source files:**

- `web/packages-mesh-primitives.js`

**API surface:**

- `PodIdentity`
- `VectorClock`
- `LWWRegister`
- `GCounter`
- `PNCounter`
- `ORSet`
- `RGA`
- `LWWMap`
- `ACLEngine`
- `CapabilityToken`
- `encodeMeshMessage`
- `decodeMeshMessage`
- `TestMesh`

> **Note:** CRDTs: VectorClock, LWWRegister, GCounter, PNCounter, ORSet, RGA, LWWMap. Test utilities: DeterministicRNG, LocalChannel, createLocalChannelPair, TestMesh.

---

---

[← Skills](/docs/guide/skills/) | [Index](/docs/) | [Channels →](/docs/guide/channels/)
