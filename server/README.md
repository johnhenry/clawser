# Clawser Server Infrastructure

Three standalone Node.js services that support the browser-based P2P mesh network. Each is independently deployable with zero shared dependencies beyond `ws`.

## Architecture

```
Browser Pods ←──WebSocket──→ Signaling Server (port 8787)
             ←──WebSocket──→ Relay Server     (port 8788)
             ←──WebRTC────→  (direct, after signaling)

Server Kernel ←──WebSocket──→ Signaling Server
              (always-on mesh peer with fs + agent services)
```

## Services

### `signaling/` — WebRTC Signaling Server

Coordinates WebRTC peer connections by forwarding offer/answer/ICE candidate messages between browser pods.

**Protocol:**
1. Client connects via WebSocket
2. Client sends `{ type: "register", podId: "<id>" }`
3. Server confirms `{ type: "registered", podId }` and broadcasts peer list
4. Client sends `{ type: "offer"|"answer"|"ice-candidate"|"signal", target: "<podId>", ...payload }`
5. Server forwards to target with `source` field injected
6. On disconnect, server broadcasts `{ type: "disconnected", podId }`

**HTTP endpoints:**
- `GET /health` — `{ status: "ok", peers: N }`
- `GET /ice-servers` — ICE configuration array (STUN/TURN)

**Environment:**
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | Listen port |
| `ORIGINS` | _(all)_ | Comma-separated allowed origins |
| `AUTH_MODE` | `open` | `open` or `authenticated` (stub) |
| `ICE_SERVERS` | _(Google STUN)_ | JSON array override for ICE config |
| `TURN_URLS` | _(none)_ | TURN server URL (appended to defaults) |
| `TURN_USERNAME` | _(none)_ | TURN credentials |
| `TURN_CREDENTIAL` | _(none)_ | TURN credentials |

**Features:**
- Origin allowlisting via `ORIGINS` env
- 10-second registration timeout
- Duplicate podId rejection
- Configurable STUN/TURN via env or JSON override

```bash
cd server/signaling && npm start
```

### `relay/` — Envelope Relay Server

Forwards opaque envelopes between peers that can't establish direct WebRTC connections (symmetric NAT, firewalls). The server never inspects message content.

**Protocol:**
1. Client connects via WebSocket
2. Client sends `{ type: "register", podId: "<id>" }`
3. Server confirms `{ type: "registered", podId }`
4. Client sends `{ type: "relay", target: "<podId>", envelope: {...} }`
5. Server forwards to target: `{ type: "relayed", source: "<podId>", envelope: {...} }`

**HTTP endpoints:**
- `GET /health` — `{ status: "ok", peers: N }`
- `GET /stats` — `{ peers: N, relayed: N, rejected: N, uptime: N }`

**Environment:**
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8788` | Listen port |
| `MAX_MESSAGES_PER_MINUTE` | `600` | Per-peer rate limit |

**Features:**
- Per-peer rate limiting (sliding 1-minute window)
- Relay/reject counters exposed via `/stats`
- 10-second registration timeout
- Duplicate podId rejection

```bash
cd server/relay && npm start
```

### `kernel/` — Server-Side Mesh Peer

An always-on Node.js peer that participates in the mesh network. Provides file storage and a stub agent that can be extended with LLM backends.

**Components:**
- `ServerIdentity` — Ed25519-style identity (random 128-bit podId)
- `ServerFileSystem` — Node.js fs wrapper with path traversal prevention and 10MB write limit
- `ServerAgent` — Stub agent with `echo`, `time`, `info` tools and in-memory search
- `PeerNodeServer` — Orchestrator with service registry, signaling connection, lifecycle management

**Built-in services:**
| Service | Methods |
|---------|---------|
| `fs` | `list`, `read`, `write`, `delete`, `stat` |
| `agent` | `run`, `executeTool`, `searchMemories` |

**Environment:**
| Variable | Default | Description |
|----------|---------|-------------|
| `SIGNALING_URL` | _(none)_ | Signaling server WebSocket URL |
| `DATA_DIR` | `./data` | Root directory for file storage |
| `AGENT_NAME` | `server-agent` | Agent display name |
| `POD_LABEL` | _(hostname)_ | Human-readable pod label |

```bash
cd server/kernel && npm start
```

## Deployment

### Docker Compose (all three services)

```bash
cd server/deploy
docker compose up
```

Exposes:
- Signaling on `localhost:8787`
- Relay on `localhost:8788`
- Kernel connects to signaling automatically, data persisted in `kernel-data` volume

### Fly.io (signaling only)

```bash
cd server/deploy
fly deploy
```

Deploys the signaling server with TLS on port 443 (region: `iad`).

### Individual services

```bash
# Each service is self-contained
cd server/signaling && npm install && npm start
cd server/relay && npm install && npm start
cd server/kernel && npm install && npm start
```

## Testing

```bash
# Run all server tests
cd server/signaling && npm test   # 28 tests
cd server/relay && npm test       # 19 tests
cd server/kernel && npm test      # 35 tests
```

All tests use real HTTP/WebSocket connections (no mocks) with ephemeral ports.

## Client Integration

The browser mesh connects to these servers via:

- **`MeshRelayClient`** (`web/clawser-mesh-relay.js`) — connects to the relay server
- **`SignalingClient`** (`web/clawser-mesh-handshake.js`) — connects to the signaling server
- **`WebRTCPeerConnection`** (`web/clawser-mesh-webrtc.js`) — uses ICE servers from signaling

Default URLs configured in `ClawserPod.initMesh()`:
- Relay: `wss://relay.browsermesh.local` (override via `opts.relayUrl`)
- Signaling: configured via `HandshakeCoordinator` constructor

## Security Notes

- **No auth by default** — `AUTH_MODE=open` accepts any podId. The `authenticated` stub is a placeholder for signature verification.
- **No TLS in dev** — use a reverse proxy (nginx, Caddy) or Fly.io for production TLS.
- **Rate limiting** — relay server enforces per-peer message limits. Signaling has no rate limiting (lower volume).
- **Path traversal** — kernel filesystem prevents `../` escapes.
- **File size** — kernel enforces 10MB write limit.
