# browsermesh-transport

WebSocket, WebRTC, WebTransport, relay, and streaming adapters for BrowserMesh.

## Modules

| Module | Key Exports |
|--------|-------------|
| transport | `MeshTransport`, `MockMeshTransport`, `MeshTransportNegotiator` |
| websocket | `WebSocketTransport`, `WebRTCTransport`, `WebTransportTransport`, `NATTraversal`, `TransportFactory` |
| webrtc | `WebRTCPeerConnection`, `WebRTCMeshManager`, `WebRTCTransportAdapter` |
| webtransport | `WebTransportBridge`, `WebTransportAdapterFactory` |
| relay | `MeshRelayClient`, `MockRelayServer` |
| gateway | `GatewayNode`, `GatewayDiscovery`, `RouteTable` |
| streams | `MeshStream`, `StreamMultiplexer` |
| cross-origin | `CrossOriginBridge`, `CrossOriginHandshake`, `RateLimiter` |
| wsh-bridge | `MeshWshBridge` |
| wisp | `WispTransport` |
| channel-relay | `ChannelRelay` |

## Install

```bash
npm install browsermesh-transport browsermesh-primitives
```

## Usage

```js
import { MeshTransport, WebSocketTransport, StreamMultiplexer } from 'browsermesh-transport';
```

## License

MIT
