# Direct Stream

Named stream open, codec negotiation, and QoS profiles for BrowserMesh.

**Related specs**: [streaming-protocol.md](streaming-protocol.md) | [stream-encryption.md](stream-encryption.md) | [channel-abstraction.md](channel-abstraction.md) | [pod-socket.md](pod-socket.md)

## 1. Overview

Direct streams extend the low-level streaming protocol (0x12-0x16 wire codes) with a higher-level named-stream API. Where the streaming protocol defines state machines and backpressure, direct streams add:

- **Named stream open** — a `STREAM_OPEN` (0xAF) message that carries a method name, enabling the receiver to route the stream to the correct handler
- **Codec negotiation** — sender and receiver agree on a data encoding (raw bytes, CBOR, JSON, protobuf) during the open handshake
- **QoS profiles** — predefined configurations for common use cases (bulk transfer, real-time, interactive)
- **Stream multiplexing** — `StreamMultiplexer` manages concurrent streams over a single session with per-stream state, flow control, and lifecycle

## 2. STREAM_OPEN Message (0xAF)

```typescript
interface StreamOpenMessage extends MessageEnvelope {
  t: 0xAF;
  p: {
    streamId: string;           // 32-char hex (16-byte ID)
    method: string;             // Handler name: e.g., "storage/upload", "chat/typing"
    ordered: boolean;           // Ordered delivery (default: true)
    encrypted: boolean;         // Per-stream encryption (default: false)
    initialCredits: number;     // Initial send window (default: 8)
    metadata?: {
      codec?: string;           // "raw" | "cbor" | "json" | "protobuf"
      qos?: string;             // "bulk" | "realtime" | "interactive"
      [key: string]: unknown;
    };
  };
}
```

On receiving `STREAM_OPEN`, the responder creates a `MeshStream` in OPEN state and notifies the application via `onStream(callback)`. The responder can write data back on the same stream (bidirectional) or close it immediately if the method is unsupported.

## 3. Method Naming Convention

Methods use a `namespace/action` pattern:

| Method | Description |
|--------|-------------|
| `storage/upload` | Upload file data |
| `storage/download` | Download file data |
| `chat/typing` | Typing indicator stream |
| `rpc/call` | Generic RPC request/response |
| `sensor/data` | Live sensor feed |
| `screen/share` | Screen sharing frames |

Applications can register custom method handlers. Unrecognized methods receive a `STREAM_ERROR` with code `INTERNAL`.

## 4. QoS Profiles

Predefined configurations optimise stream parameters for common patterns:

| Profile | initialCredits | maxSize | ordered | Use Case |
|---------|---------------|---------|---------|----------|
| `bulk` | 32 | 256 MB | true | File transfers, backups |
| `realtime` | 4 | unlimited | false | Audio/video, sensor data |
| `interactive` | 8 | 16 MB | true | Chat, RPC, collaborative editing |

The QoS profile is advisory — either side can override individual parameters.

## 5. StreamMultiplexer API

```javascript
const mux = new StreamMultiplexer({ maxConcurrentStreams: 16 });

// Register handler for inbound streams
mux.onStream(stream => {
  console.log(`Inbound: ${stream.method} (${stream.hexId})`);
  stream.onData(data => process(data));
  stream.onEnd(() => console.log('Done'));
});

// Open an outgoing stream
const stream = mux.open('storage/upload', {
  ordered: true,
  encrypted: true,
  metadata: { codec: 'cbor' },
});

stream.write(new Uint8Array([1, 2, 3]));
stream.end();
```

### Wire Integration

The multiplexer's `onSend(callback)` emits wire messages (type codes 0x13-0x16 + 0xAF) that must be delivered to the remote peer's `dispatch(msg)` method.

```javascript
// Wire two multiplexers together
muxA.onSend(msg => transport.send(msg));
transport.onMessage(msg => muxA.dispatch(msg));
```

## 6. MeshStream Lifecycle

```
IDLE ──[STREAM_OPEN]──► OPEN ──[end()]──► HALF_CLOSED_LOCAL ──[remote END]──► CLOSED
                          │                                                      ▲
                          ├──[remote END]──► HALF_CLOSED_REMOTE ──[end()]────────┘
                          │
                          └──[cancel()/error]──► CLOSED
```

Each stream tracks:
- `sendSeq` / `recvSeq` — monotonic sequence counters
- `sendCredits` / `recvCredits` — credit-based flow control
- `bytesSent` / `bytesReceived` — transfer stats
- `framesSent` / `framesReceived` — frame counts

## 7. Credit-Based Flow Control

See [streaming-protocol.md §4](streaming-protocol.md) for the full specification. Summary:

1. Receiver sets `initialCredits` in STREAM_OPEN (default: 8 chunks)
2. Each write decrements sender credits by 1
3. Sender queues writes when credits reach 0
4. Receiver sends `STREAM_WINDOW_UPDATE` (0x16) to replenish
5. Queued writes drain automatically when credits arrive

## 8. Error Handling

| Error Code | Meaning | Retryable |
|-----------|---------|-----------|
| `CANCELLED` | Stream cancelled by sender or receiver | No |
| `TIMEOUT` | Idle timeout exceeded | Yes |
| `FLOW_CONTROL` | Credit exhaustion or too many concurrent streams | Yes |
| `TOO_LARGE` | Stream exceeded size limit | No |
| `INTERNAL` | Unexpected error or unknown method | No |

Errors transition the stream to CLOSED and notify the application via `onError(callback)`.

## 9. Serialization

Both `MeshStream` and `StreamMultiplexer` support `toJSON()` / `fromJSON()` for checkpoint/restore across page reloads. Callbacks must be re-registered after restoration.

## 10. Implementation

See `web/clawser-mesh-streams.js` for the Clawser implementation (~500 LOC).

## Implementation Status

**Status**: StreamMultiplexer and MeshStream classes exist and are fully functional. Wired to app bootstrap via ClawserPod.initMesh(). Supports flow control with credits, ordered/unordered delivery, and concurrent stream limits.

**Source**: `web/clawser-mesh-streams.js`
