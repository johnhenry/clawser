# browsermesh-core

Identity, crypto, peer management, and trust primitives for BrowserMesh.

## Modules

| Module | Key Exports |
|--------|-------------|
| identity | `MeshIdentityManager`, `AutoIdentityManager`, `IdentitySelector`, `PodIdentity`, `derivePodId` |
| identity-tools | `IdentityCreateTool`, `IdentityListTool`, `IdentitySwitchTool`, `registerIdentityTools` |
| keyring | `MeshKeyring`, `KeyLink`, `SignedKeyLink`, `SuccessionPolicy` |
| group-keys | `GroupKeyManager`, `GroupState` |
| peer | `PeerState`, `MeshPeerManager` |
| peer-tools | `MeshPeerToolsContext`, `registerMeshPeerTools` + 30 BrowserTool subclasses |
| handshake | `HandshakeCoordinator`, `SignalingClient`, `DirectInputHandshake` |
| acl | `MeshACL`, `ScopeTemplate`, `RosterEntry`, `InvitationToken` |
| capabilities | `CapabilityToken`, `CapabilityChain`, `CapabilityValidator`, `WasmSandbox` |
| trust | `TrustGraph` |
| hardening | `RetryWithBackoff`, `TransportHealthCheck`, `ConnectionPool`, `TransportFailover` |
| identity-base | `IdentityManager`, `compileSystemPrompt`, `detectIdentityFormat` |
| identity-wallet | `IdentityWallet` |

## Install

```bash
npm install browsermesh-core browsermesh-primitives
```

## Usage

```js
import { MeshIdentityManager, MeshKeyring, TrustGraph } from 'browsermesh-core';
```

## License

MIT
