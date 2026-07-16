# Relay Service

## Overview

The relay service provides a signaling and relay layer for BrowserMesh peer discovery and signal forwarding. When direct peer-to-peer connections are not possible, peers connect to a relay server to discover each other, announce capabilities, and exchange signaling data (SDP offers/answers, ICE candidates). The module includes a `MockRelayServer` for testing without real WebSocket infrastructure.

Source: `web/clawser-mesh-relay.js`

## Wire Codes

This module does not define or import wire codes from the canonical registry. Communication with the relay server uses a distinct protocol layer (WebSocket JSON messages) rather than the mesh wire format.

### Real WebSocket Wire Protocol

When `MeshRelayClient.connect()` is called without a `MockRelayServer`, it opens a real `WebSocket` to `relayUrl` and speaks a small JSON message protocol that mirrors the `MockRelayServer` method surface:

| Direction | `type` | Payload | Purpose |
|-----------|--------|---------|---------|
| client → server | `register` | `{ fingerprint }` | Sent on socket open |
| client → server | `unregister` | `{ fingerprint }` | Sent on `disconnect()` |
| client → server | `announce` | `{ fingerprint, capabilities }` | `announcePresence()` |
| client → server | `find` | `{ requestId, query }` | `findPeers()`; expects a matching `find_response` |
| client → server | `signal` | `{ from, to, signal }` | `forwardSignal()` |
| server → client | `peer_announce` | `{ fingerprint, capabilities }` | Delivered via `onPeerAnnounce()` |
| server → client | `signal` | `{ from, signal }` | Delivered via `onSignal()` |
| server → client | `find_response` | `{ requestId, peers }` | Resolves the pending `findPeers()` promise |
| server → client | `error` | `{ message }` | Delivered via `onError()` |

The client auto-reconnects with exponential backoff (`reconnectDelayMs * 2^attempt`, default base 500ms, up to `maxReconnectAttempts` = 5) unless the disconnect was consumer-initiated (`disconnect()`). `findPeers()` over the real WS path times out after 5 seconds if no `find_response` arrives.

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

**Status: Implemented and wired to app bootstrap (when `relayUrl` is configured).**

- `MeshRelayClient` and `MockRelayServer` are fully implemented.
- `MeshRelayClient` is instantiated in `ClawserPod.initMesh()` when `opts.relayUrl` is supplied. Without a relay URL the client is intentionally absent (workspace runs in fully-local mode). See `web/clawser-pod.js` ~line 449.
- The pod hooks `relayClient.onPeerAnnounce()` to ingest peers into the `RemoteRuntimeRegistry`.
- `connect()` has two real code paths, not one: passing a `MockRelayServer` uses the in-memory test path; calling it with no argument opens a **real `WebSocket`** to `relayUrl` and runs the register/find/signal protocol described above, including auto-reconnect with exponential backoff. This is a genuine, working implementation — it is not a placeholder, and `clawser-mesh-websocket.js` is an unrelated module (a general-purpose WebSocket transport for `MeshTransport`/`wsh-ws`, not the relay's own socket).
- All callback-based events (signal, announce, connect, disconnect, error) are implemented with error-swallowing listeners.
- Test file: `web/test/clawser-mesh-relay.test.mjs`

## Source File Reference

`web/clawser-mesh-relay.js` -- 434 lines, pure ES module, no browser-only imports, no external dependencies.
