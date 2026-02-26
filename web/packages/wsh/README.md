# wsh — Web Shell

Browser-native remote command execution over WebTransport/WebSocket with Ed25519 authentication.

wsh is a pure-JS client library that connects browsers to remote shells. It implements its own binary protocol (CBOR over length-prefixed frames) with Ed25519 challenge-response auth, channel multiplexing, session management, and MCP tool bridging.

## Install

```js
// ESM import (browser, no bundler needed)
import { WshClient, WshKeyStore } from './packages/wsh/src/index.mjs';
```

Zero dependencies. Uses only Web Crypto API, WebTransport/WebSocket, and OPFS.

## Quick Start

```js
import { WshClient, WshKeyStore } from 'wsh';

// Load or generate Ed25519 keys
const keystore = new WshKeyStore();
const { privateKey, publicKey } = await keystore.getOrCreate('default');

// Connect
const client = new WshClient();
await client.connect('wss://server.example.com/wsh', {
  username: 'alice',
  privateKey,
  publicKey,
});

// Open a PTY session
const session = await client.openSession({ kind: 'pty', cols: 80, rows: 24 });

// Write to stdin
session.write('ls -la\n');

// Read stdout
session.onData = (data) => terminal.write(data);

// Resize
session.resize(120, 40);

// Close
session.close();
client.disconnect();
```

## Architecture

```
WshClient
  |
  +-- Transport (WebTransport or WebSocket)
  |     |
  |     +-- CBOR codec (encode/decode)
  |     +-- Length-prefixed framing (4-byte BE)
  |
  +-- Auth (Ed25519 challenge-response)
  |     |
  |     +-- buildTranscript: SHA-256(version || '\0' || session_id || nonce)
  |     +-- signChallenge / verifyChallenge
  |     +-- fingerprint: SHA-256(raw_pubkey) -> hex
  |
  +-- Sessions (channel multiplexing)
  |     |
  |     +-- WshSession (PTY or exec)
  |     +-- stdin/stdout data streams
  |     +-- resize, signal, exit
  |
  +-- Subsystems
        +-- WshKeyStore (OPFS-backed key storage)
        +-- WshFileTransfer (file ops over wsh channels)
        +-- SessionRecorder / SessionPlayer (recording/replay)
        +-- WshMcpBridge (MCP tool discovery + invocation)
```

## Module Map

| File | LOC | Purpose |
|------|-----|---------|
| `src/client.mjs` | ~1100 | `WshClient` — connection, auth, channel management, keepalive |
| `src/session.mjs` | ~340 | `WshSession` — single PTY/exec channel with stdin/stdout streams |
| `src/messages.mjs` | — | Thin re-export from `messages.gen.mjs` (auto-generated) |
| `src/messages.gen.mjs` | ~360 | 33 message constructors, MSG constants, enums (generated from YAML) |
| `src/cbor.mjs` | ~330 | CBOR codec + length-prefixed frame encoder/decoder |
| `src/auth.mjs` | ~265 | Ed25519 keygen, signing, verification, transcript, fingerprints, SSH wire format |
| `src/transport.mjs` | ~340 | Abstract `WshTransport` + `WebTransportTransport` |
| `src/transport-ws.mjs` | ~460 | `WebSocketTransport` with multiplexed stream framing |
| `src/keystore.mjs` | ~470 | `WshKeyStore` — OPFS-backed Ed25519 key management |
| `src/file-transfer.mjs` | ~390 | `WshFileTransfer` — file read/write/list over wsh channels |
| `src/recording.mjs` | ~400 | `SessionRecorder` + `SessionPlayer` — session recording/replay |
| `src/mcp-bridge.mjs` | ~230 | `WshMcpBridge` — bridge wsh MCP messages to local tool calls |
| `src/index.mjs` | ~50 | Public API re-exports |

## Protocol

The wsh protocol uses **CBOR** encoding with **4-byte big-endian length-prefixed** framing. Every message has a numeric `type` field.

### Message Categories

| Category | Codes | Messages |
|----------|-------|----------|
| Handshake | `0x01`–`0x07` | Hello, ServerHello, Challenge, AuthMethods, Auth, AuthOk, AuthFail |
| Channel | `0x10`–`0x16` | Open, OpenOk, OpenFail, Resize, Signal, Exit, Close |
| Transport | `0x20`–`0x22` | Error, Ping, Pong |
| Session | `0x30`–`0x38` | Attach, Resume, Rename, IdleWarning, Shutdown, Snapshot, Presence, ControlChanged, Metrics |
| MCP | `0x40`–`0x43` | McpDiscover, McpTools, McpCall, McpResult |
| Reverse | `0x50`–`0x53` | ReverseRegister, ReverseList, ReversePeers, ReverseConnect |
| Framing | `0x60` | WS_DATA (WebSocket multiplexing marker, not a CBOR message) |

See `spec/wsh-v1.md` for the full protocol specification.

### Authentication Flow

```
Client                          Server
  |--- Hello(username) ----------->|
  |<-- ServerHello(session_id) ----|
  |<-- Challenge(nonce) -----------|
  |                                |
  |  transcript = SHA-256("wsh-v1\0" || session_id || nonce)
  |  signature  = Ed25519.sign(privateKey, transcript)
  |                                |
  |--- Auth(pubkey, signature) --->|
  |<-- AuthOk(token, ttl) --------|
```

### Crypto Primitives

- **Key type**: Ed25519
- **Auth transcript**: `SHA-256(PROTOCOL_VERSION || '\0' || session_id || nonce)`
- **Fingerprint**: `hex(SHA-256(raw_32_byte_pubkey))` (64 hex chars)
- **Session token**: `[8B expiry_be][32B HMAC-SHA256(secret, session_id || expiry)]` (40 bytes)
- **SSH wire format**: `[4B len]["ssh-ed25519"][4B len][32B raw_key]`

## Codegen

The protocol schema lives in `spec/wsh-v1.yaml`. A codegen script generates both JS and Rust message types from this single source of truth:

```bash
node web/packages/wsh/spec/codegen.mjs
```

This produces:
- `src/messages.gen.mjs` — JS message constructors + constants
- `../../crates/wsh-core/src/messages.gen.rs` — Rust message types + serde
- `spec/wsh-v1.md` — Human-readable protocol specification

### Why Codegen?

The wsh protocol has both a JS client and a Rust server. A cross-implementation bug in the auth transcript formula was found and fixed — the codegen approach prevents this class of bug by generating both implementations from the same schema.

## Tests

```bash
node --test web/packages/wsh/test/*.test.mjs
```

Test suites:
- `messages.test.mjs` — MSG constants, constructors, validation
- `cbor.test.mjs` — CBOR codec, frame encoder/decoder
- `auth.test.mjs` — Key generation, signing, verification, transcript, fingerprints
- `cross-compat.test.mjs` — Verifies JS wire format matches Rust (protocol constants, field names, CBOR encoding, auth transcript formula, SSH key format, fingerprint computation)

## Rust Server

The Rust server implementation lives in `crates/wsh-server/` with shared types in `crates/wsh-core/`. The Rust message types are also generated from `spec/wsh-v1.yaml` via the same codegen script.

```bash
# Check Rust compilation
cargo check -p wsh-core

# Run Rust tests
cargo test --workspace
```

## License

MIT
