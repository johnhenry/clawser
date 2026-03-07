# Relay Service

## Overview

The relay service provides a signaling and relay layer for BrowserMesh peer discovery and signal forwarding. When direct peer-to-peer connections are not possible, peers connect to a relay server to discover each other, announce capabilities, and exchange signaling data (SDP offers/answers, ICE candidates). The module includes a `MockRelayServer` for testing without real WebSocket infrastructure.

Source: `web/clawser-mesh-relay.js`

## Wire Codes

This module does not define or import wire codes from the canonical registry. Communication with the relay server uses a distinct protocol layer (WebSocket JSON messages) rather than the mesh wire format.

## API Surface

### Constants

**RELAY_STATES** -- frozen array: `['disconnected', 'connecting', 'connected']`

### MockRelayServer

In-memory relay server for testing. Tracks connected clients and forwards signals between them.

| Method / Property                                    | Returns                                              | Description                                    |
|------------------------------------------------------|------------------------------------------------------|------------------------------------------------|
| `registerClient(client)`                             | `void`                                               | Register a MeshRelayClient by fingerprint      |
| `removeClient(fingerprint)`                          | `boolean`                                            | Unregister a client                            |
| `getConnectedPeers()`                                | `Array<{ fingerprint, capabilities, endpoint }>`     | All connected peer descriptors                 |
| `findPeers(query?)`                                  | `Array<{ fingerprint, capabilities, endpoint }>`     | Filter peers by `capability` string            |
| `forwardSignal(fromFingerprint, toFingerprint, signal)` | `boolean`                                         | Deliver signal to target client                |
| `broadcastPresence(fingerprint, capabilities)`       | `void`                                               | Notify all other clients of a peer announcement|
| `size`                                               | `number`                                             | Getter: connected client count                 |

### MeshRelayClient

Client for connecting to a signaling/relay server. Manages connection lifecycle, presence announcements, peer discovery, and signal forwarding.

**State machine:** `disconnected` -> `connecting` -> `connected` -> `disconnected`

**Constructor fields:** `relayUrl` (WebSocket endpoint), `identity` (`{ fingerprint }`), `onLog?` (logging callback).

#### Accessors

| Property       | Returns    | Description                          |
|----------------|------------|--------------------------------------|
| `relayUrl`     | `string`   | Relay server URL                     |
| `fingerprint`  | `string`   | Local identity fingerprint           |
| `state`        | `string`   | Current connection state             |
| `connected`    | `boolean`  | True when state is `'connected'`     |

#### Lifecycle

| Method                    | Returns          | Description                                    |
|---------------------------|------------------|------------------------------------------------|
| `connect(mockServer?)`    | `Promise<void>`  | Connect to relay; accepts MockRelayServer for testing |
| `disconnect()`            | `void`           | Disconnect and clean up                        |

#### Presence and Discovery

| Method                       | Returns                                                  | Description                                    |
|------------------------------|----------------------------------------------------------|------------------------------------------------|
| `announcePresence(capabilities)` | `void`                                               | Broadcast capabilities to the relay            |
| `findPeers(query?)`         | `Promise<Array<{ fingerprint, capabilities, endpoint }>>` | Query relay for peers; excludes self           |

#### Signal Forwarding

| Method                                  | Returns    | Description                                    |
|-----------------------------------------|------------|------------------------------------------------|
| `forwardSignal(targetFingerprint, signal)` | `boolean` | Send signaling data to a target peer via relay |

#### Event Registration

| Method               | Callback signature                          | Description                          |
|----------------------|---------------------------------------------|--------------------------------------|
| `onSignal(cb)`       | `(fromFingerprint: string, signal: *)`      | Incoming signals from peers          |
| `onPeerAnnounce(cb)` | `({ fingerprint, capabilities })`           | Peer presence announcements          |
| `onConnect(cb)`      | `()`                                        | Relay connection established         |
| `onDisconnect(cb)`   | `()`                                        | Relay connection closed              |
| `onError(cb)`        | `(error: Error)`                            | Relay errors                         |

#### Serialization

| Method       | Returns   | Description                                          |
|--------------|-----------|------------------------------------------------------|
| `toJSON()`   | `object`  | Serialize state (no callbacks); includes `relayUrl`, `fingerprint`, `connected`, `state`, `capabilities`, `knownPeerCount` |

#### Internal Methods (used by MockRelayServer)

| Method                          | Description                                    |
|---------------------------------|------------------------------------------------|
| `_deliverSignal(from, signal)`  | Inject an incoming signal from another peer    |
| `_deliverPeerAnnounce(info)`    | Inject a peer presence announcement            |
| `_announcedCapabilities`        | Public field: capabilities array for server    |
| `_endpoint`                     | Public field: endpoint string for server       |

## Implementation Status

**Status: Implemented, not wired to app bootstrap.**

- `MeshRelayClient` and `MockRelayServer` are fully implemented.
- The `connect()` method currently only supports the mock path; real WebSocket connection is stubbed with a comment placeholder.
- No integration with `ClawserPod.initMesh()` or any bootstrap path.
- No wire codes are used; the relay protocol operates at a transport level below the mesh wire format.
- All callback-based events (signal, announce, connect, disconnect, error) are implemented with error-swallowing listeners.
- Test file: `web/test/clawser-mesh-relay.test.mjs`

## Source File Reference

`web/clawser-mesh-relay.js` -- 434 lines, pure ES module, no browser-only imports, no external dependencies.
