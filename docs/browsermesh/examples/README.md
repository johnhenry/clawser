# BrowserMesh Application Examples

Real-world application architectures built on the BrowserMesh pod system.

Each example demonstrates how pods, identity, session cryptography, capabilities, and lifecycle management compose into working systems — without traditional server infrastructure.

## Examples

| Example | Pod Types | Key Concepts |
|---------|-----------|--------------|
| [Classroom Collab Board](01-classroom-collab-board.md) | WindowPod, FramePod | WebAuthn attestation, scoped capabilities, peer discovery |
| [Distributed Build Monitor](02-distributed-build-monitor.md) | ServiceWorkerPod, SharedWorkerPod, WindowPod | Hierarchical roles, capability escalation, cross-context detection |
| [Peer-to-Peer Encrypted Notes](03-p2p-encrypted-notes.md) | WindowPod (multi-device) | HD key derivation, device pairing, revocation |
| [Multiplayer Game Lobby](04-multiplayer-game-lobby.md) | WindowPod | Signed move logs, host migration, mesh formation |
| [Privacy-First Analytics](05-privacy-analytics-dashboard.md) | WindowPod, FramePod, WorkerPod, ServiceWorkerPod | Data isolation, capability-scoped sources, provenance |
| [Pod-Hosted Web Server](06-pod-hosted-web-server.md) | ServiceWorkerPod, WindowPod | Serving web pages from a browser, FetchEvent routing, live reload |
| [Decentralized Chat](07-decentralized-chat.md) | WindowPod, SharedWorkerPod | End-to-end encryption, offline queuing, presence |
| [Collaborative Code Sandbox](08-collaborative-code-sandbox.md) | WindowPod, FramePod, WorkerPod | Sandboxed execution, capability-limited eval, shared state |

## Conventions

All examples reference specs from `docs/browsermesh/specs/`:

- `identity-keys.md` — Pod identity, credentials API, capabilities
- `session-keys.md` — Noise IK handshake, SessionCrypto, SessionManager
- `webauthn-identity.md` — Optional hardware-backed attestation
- `boot-sequence.md` — Pod lifecycle, discovery, shutdown
- `pod-types.md` — Pod kinds and classification
- `wire-format.md` — Message encoding (CBOR)

Code samples are TypeScript and use the `@browsermesh/runtime` package namespace.
