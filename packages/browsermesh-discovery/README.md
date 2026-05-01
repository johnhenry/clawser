# browsermesh-discovery

DHT, peer discovery, naming, swarm coordination, and stealth networking for BrowserMesh.

## Modules

| Module | Key Exports |
|--------|-------------|
| dht | `DhtNode`, `RoutingTable`, `KBucket`, `GossipProtocol` |
| discovery | `DiscoveryManager`, `DiscoveryStrategy`, `ServiceDirectory`, `BroadcastChannelStrategy` |
| naming | `MeshNameResolver`, `NameRecord`, `parseMeshUri` |
| swarm | `SwarmCoordinator`, `LeaderElection`, `TaskDistributor`, `SwimMembership` |
| sw-routing | `MeshFetchRouter`, `parseMeshRequest` |
| stealth | `StealthAgent`, `ShardDistributor`, `ShardCollector` |

## Install

```bash
npm install browsermesh-discovery browsermesh-primitives
```

## Usage

```js
import { DhtNode, DiscoveryManager, SwarmCoordinator } from 'browsermesh-discovery';
```

## License

MIT
