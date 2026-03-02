# BrowserMesh Specifications

Technical specifications for BrowserMesh, a browser-native distributed runtime with Kubernetes-inspired semantics.

## Quick Start

Start with [spec-index.md](spec-index.md) for the complete dependency graph and recommended reading order.

## Directory Structure

```
specs/
├── core/                    # Core runtime specifications
│   ├── pod-types.md         # Pod kinds and capabilities
│   ├── boot-sequence.md     # Boot protocol
│   ├── wire-format.md       # CBOR message encoding
│   ├── error-handling.md    # Error codes and recovery
│   ├── security-model.md    # Threat model and mitigations
│   └── protocol-versioning.md  # Version negotiation and feature flags
│
├── crypto/                  # Cryptographic specifications
│   ├── identity-keys.md     # Ed25519 identity, HD derivation
│   ├── session-keys.md      # X25519 handshake, session encryption
│   ├── capability-scope-grammar.md  # Scope string grammar and validation
│   ├── webauthn-identity.md # Optional hardware-backed identity (WebAuthn)
│   ├── group-keys.md        # Symmetric group encryption
│   └── identity-persistence.md  # Key storage and at-rest protection
│
├── networking/              # Communication specifications
│   ├── channel-abstraction.md  # PodChannel interface and adapters
│   ├── link-negotiation.md  # Channel negotiation state machine
│   ├── message-envelope.md  # Request/response protocol
│   ├── message-middleware.md   # Composable transform pipeline
│   ├── pod-socket.md        # Unified socket abstraction
│   ├── pod-addr.md          # IPv6-style virtual addressing
│   ├── streaming-protocol.md   # Stream state machine and backpressure
│   ├── stream-encryption.md    # Per-stream encryption
│   ├── resumable-transfer.md   # Checkpoint-and-resume large transfers
│   ├── binary-request-protocol.md  # HTTP-style req/resp over non-HTTP channels
│   ├── http-interop.md         # HTTP mapping layer for infrastructure traversal
│   ├── transport-probing.md    # Transport auto-detection and selection
│   ├── signaling-protocol.md   # WebRTC signaling and ICE exchange
│   ├── dht-routing.md         # Kademlia DHT for peer discovery
│   ├── source-route-labels.md # Compact multi-hop path encoding
│   ├── device-pairing.md    # Cross-device pairing handshake
│   └── session-resumption.md   # Abbreviated reconnection
│
├── coordination/            # Coordination specifications
│   ├── service-model.md     # Service naming and discovery
│   ├── presence-protocol.md # Real-time presence tracking
│   ├── join-protocol.md     # Session join ritual
│   ├── leader-election.md   # Deterministic leader election
│   ├── offline-queue.md     # Message buffering for disconnected peers
│   ├── slot-lease-protocol.md  # SharedWorker coordination
│   ├── reconciliation-loop.md  # Desired state reconciliation
│   ├── pubsub-topics.md     # Topic-based pub/sub messaging
│   ├── state-sync.md        # CRDT state synchronization
│   ├── reactive-signals.md  # Lightweight reactive state primitives
│   ├── peer-reputation.md   # Peer quality scoring
│   └── pod-migration.md     # Pod state migration
│
├── operations/              # Operational specifications
│   ├── observability.md     # Tracing, logging, metrics
│   ├── operations.md        # Key rotation, admission control
│   ├── chaos-testing.md     # Fault injection and testing
│   └── test-transport.md    # In-memory test transport
│
├── extensions/              # Extension specifications
│   ├── signed-audit-log.md  # Hash-chained audit entries
│   ├── pod-executor.md      # Ephemeral WorkerPod lifecycle
│   ├── server-pod.md        # Server-side runtime
│   ├── storage-integration.md  # IPFS/Storacha integration
│   ├── compute-offload.md   # WASM compute offload
│   └── artifact-registry.md # Content-addressable artifact storage
│
├── reference/               # Reference documentation
│   ├── libp2p-alignment.md  # libp2p comparison
│   ├── design-rationale.md  # Architectural decisions
│   ├── manifest-format.md   # Kubernetes-style manifests
│   ├── pod-capability-schema.json  # JSON Schema for capabilities
│   ├── client-api.md        # MeshClient/MeshServer/MeshRuntime API
│   ├── mesh-ctl.md          # CLI command reference
│   └── utility-functions.md # Shared helper functions
│
└── spec-index.md            # Complete index with dependency graph
```

## Reading Order

### Essential (Start Here)

| Order | Spec | Description |
|-------|------|-------------|
| 1 | [pod-types.md](core/pod-types.md) | What pods are, capability matrix |
| 2 | [identity-keys.md](crypto/identity-keys.md) | Ed25519 identity, Pod IDs |
| 2a | [identity-persistence.md](crypto/identity-persistence.md) | Key storage and at-rest protection |
| 3 | [boot-sequence.md](core/boot-sequence.md) | How pods discover topology |
| 4 | [wire-format.md](core/wire-format.md) | Message encoding (CBOR) |
| 5 | [session-keys.md](crypto/session-keys.md) | Secure channel establishment |

### Communication Layer

| Order | Spec | Description |
|-------|------|-------------|
| 6 | [link-negotiation.md](networking/link-negotiation.md) | Channel negotiation |
| 7 | [pod-socket.md](networking/pod-socket.md) | Unified socket API |
| 8 | [message-envelope.md](networking/message-envelope.md) | Request/response protocol |

### Coordination Layer

| Order | Spec | Description |
|-------|------|-------------|
| 9 | [service-model.md](coordination/service-model.md) | Service naming and routing |
| 10 | [slot-lease-protocol.md](coordination/slot-lease-protocol.md) | SharedWorker coordination |
| 11 | [reconciliation-loop.md](coordination/reconciliation-loop.md) | Desired state management |

### Operations

| Order | Spec | Description |
|-------|------|-------------|
| 12 | [error-handling.md](core/error-handling.md) | Error codes and recovery |
| 13 | [security-model.md](core/security-model.md) | Threat model |
| 14 | [observability.md](operations/observability.md) | Tracing and metrics |
| 15 | [operations.md](operations/operations.md) | Key rotation, etc. |

### Protocols & Advanced Features

| Order | Spec | Description |
|-------|------|-------------|
| 5a | [channel-abstraction.md](networking/channel-abstraction.md) | Unified channel interface |
| 5b | [capability-scope-grammar.md](crypto/capability-scope-grammar.md) | Scope string grammar |
| 5c | [protocol-versioning.md](core/protocol-versioning.md) | Version negotiation and feature flags |
| 5d | [transport-probing.md](networking/transport-probing.md) | Transport auto-detection and selection |
| 8a | [streaming-protocol.md](networking/streaming-protocol.md) | Stream lifecycle and backpressure |
| 8b | [stream-encryption.md](networking/stream-encryption.md) | Per-stream encryption |
| 8c | [binary-request-protocol.md](networking/binary-request-protocol.md) | Binary HTTP-style req/resp |
| 8d | [session-resumption.md](networking/session-resumption.md) | Abbreviated reconnection |
| 8e | [signaling-protocol.md](networking/signaling-protocol.md) | WebRTC signaling and ICE |
| 8f | [resumable-transfer.md](networking/resumable-transfer.md) | Checkpoint-and-resume transfers |
| 8g | [message-middleware.md](networking/message-middleware.md) | Composable transform pipeline |
| 8h | [http-interop.md](networking/http-interop.md) | HTTP mapping for infrastructure traversal |
| 9a | [presence-protocol.md](coordination/presence-protocol.md) | Real-time presence |
| 9b | [join-protocol.md](coordination/join-protocol.md) | Session join ritual |
| 9c | [offline-queue.md](coordination/offline-queue.md) | Disconnected peer buffering |
| 9d | [pubsub-topics.md](coordination/pubsub-topics.md) | Topic-based pub/sub messaging |
| 9e | [state-sync.md](coordination/state-sync.md) | CRDT state synchronization |
| 9f | [pod-migration.md](coordination/pod-migration.md) | Pod state transfer |
| 9g | [reactive-signals.md](coordination/reactive-signals.md) | Lightweight reactive state |
| 9h | [peer-reputation.md](coordination/peer-reputation.md) | Peer quality scoring |
| 16 | [leader-election.md](coordination/leader-election.md) | Deterministic leader election |
| 17 | [signed-audit-log.md](extensions/signed-audit-log.md) | Hash-chained audit entries |
| 18 | [pod-executor.md](extensions/pod-executor.md) | Ephemeral WorkerPod lifecycle |
| 19 | [group-keys.md](crypto/group-keys.md) | Symmetric group encryption |
| 20 | [device-pairing.md](networking/device-pairing.md) | Cross-device pairing |
| 21 | [dht-routing.md](networking/dht-routing.md) | Kademlia DHT peer discovery |
| 22 | [source-route-labels.md](networking/source-route-labels.md) | Compact multi-hop paths |

### Extensions (Optional)

| Spec | Description |
|------|-------------|
| [server-pod.md](extensions/server-pod.md) | Server-side runtime |
| [storage-integration.md](extensions/storage-integration.md) | IPFS integration |
| [compute-offload.md](extensions/compute-offload.md) | WASM offload |
| [artifact-registry.md](extensions/artifact-registry.md) | Content-addressable artifacts |

### Reference

| Spec | Description |
|------|-------------|
| [client-api.md](reference/client-api.md) | MeshClient/MeshServer/MeshRuntime API |
| [mesh-ctl.md](reference/mesh-ctl.md) | CLI command reference |
| [utility-functions.md](reference/utility-functions.md) | Shared helper functions |
| [chaos-testing.md](operations/chaos-testing.md) | Fault injection framework |
| [test-transport.md](operations/test-transport.md) | In-memory test transport |

## Cryptographic Standards

All specifications use Ed25519/X25519 cryptography (available in browsers since May 2025):

| Purpose | Algorithm | Key Size |
|---------|-----------|----------|
| Identity signing | Ed25519 | 32 bytes |
| Signatures | Ed25519 | 64 bytes |
| Key exchange | X25519 | 32 bytes |
| Encryption | AES-GCM-256 | 32 bytes |
| Key derivation | HKDF-SHA256 | variable |
| Group encryption | AES-GCM-256 | 32 bytes |
| Hardware attestation | WebAuthn (optional) | varies |

## Implementation Order

For implementers, build in this order:

1. **Foundation**: Wire format, identity keys, identity persistence, pod type detection, utility functions
2. **Boot**: Boot sequence, peer discovery, protocol versioning, transport probing
3. **Security**: Session keys, message signing, group keys
4. **Communication**: Link negotiation, pod socket, message envelope, message middleware, streaming, stream encryption, resumable transfer, binary request protocol, session resumption, signaling protocol
5. **Coordination**: Service model, presence, pub/sub, state sync, reactive signals, peer reputation, pod migration
6. **Advanced**: DHT routing, source route labels, leader election, device pairing
7. **Operations**: Error handling, observability (+ HAR capture), chaos testing, test transport
8. **Application**: Client API, artifact registry, mesh-ctl CLI (+ debug/capture)

## Spec Status

| Status | Meaning |
|--------|---------|
| ✅ Stable | Ready for implementation |
| ⚠️ Review | Needs implementation feedback |
| 📋 Draft | Extension, defer implementation |

See [spec-index.md](spec-index.md) for per-spec status.

## Key Concepts

- **Pod**: A JavaScript execution context (window, worker, iframe, etc.)
- **Pod ID**: SHA-256 hash of Ed25519 public key (32 bytes)
- **Session**: Encrypted channel between two pods
- **PodChannel**: Unified transport interface (see [channel-abstraction.md](networking/channel-abstraction.md))
- **Scope**: Capability authorization string in `namespace:action` format (see [capability-scope-grammar.md](crypto/capability-scope-grammar.md))
- **Presence**: Real-time pod activity state (see [presence-protocol.md](coordination/presence-protocol.md))
- **Service**: Named endpoint with capability-based routing
- **Slot**: SharedWorker coordination primitive
- **Topic**: Hierarchical pub/sub channel for message broadcasting (see [pubsub-topics.md](coordination/pubsub-topics.md))
- **StateDocument**: CRDT-based composable state container (see [state-sync.md](coordination/state-sync.md))
- **Group Key**: Symmetric encryption key shared across multi-party sessions (see [group-keys.md](crypto/group-keys.md))
- **Artifact**: Content-addressed storage entry (see [artifact-registry.md](extensions/artifact-registry.md))
- **SmartChannel**: Auto-selecting transport wrapper with fallback chain (see [transport-probing.md](networking/transport-probing.md))
- **LocalChannel**: In-memory PodChannel for testing (see [test-transport.md](operations/test-transport.md))
- **LockedPodIdentity**: PBKDF2/AES-GCM encrypted identity at rest (see [identity-persistence.md](crypto/identity-persistence.md))
- **MeshClient**: Client-side API for connecting and messaging (see [client-api.md](reference/client-api.md))
- **SignalingService**: Pluggable WebRTC signaling transport for pre-connection SDP/ICE exchange (see [signaling-protocol.md](networking/signaling-protocol.md))
- **ResumableTransfer**: Checkpoint-and-resume protocol for large data transfers (see [resumable-transfer.md](networking/resumable-transfer.md))
- **MeshSignal**: Lightweight reactive value primitive for single-writer state sync (see [reactive-signals.md](coordination/reactive-signals.md))
- **RouteLabel**: 64-bit compact encoding of multi-hop paths (see [source-route-labels.md](networking/source-route-labels.md))
- **PeerReputation**: Quality scoring for informed transport selection (see [peer-reputation.md](coordination/peer-reputation.md))

## Related Documents

- [design-rationale.md](reference/design-rationale.md) - Why these design choices
- [libp2p-alignment.md](reference/libp2p-alignment.md) - Comparison with libp2p
- [manifest-format.md](reference/manifest-format.md) - Kubernetes-style manifests
- [pod-capability-schema.json](reference/pod-capability-schema.json) - JSON Schema for capabilities
- [client-api.md](reference/client-api.md) - Public API surface
- [mesh-ctl.md](reference/mesh-ctl.md) - CLI command reference
- [utility-functions.md](reference/utility-functions.md) - Shared helper functions
