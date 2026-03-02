# File Transfer Protocol

Content-addressed chunked file transfer for BrowserMesh.

**Related specs**: [streaming-protocol.md](streaming-protocol.md) | [direct-stream.md](direct-stream.md) | [resumable-transfer.md](resumable-transfer.md) | [stream-encryption.md](stream-encryption.md)

## 1. Overview

The file transfer protocol provides a high-level "send file to peer" abstraction built on BrowserMesh streams. It handles:

- **Transfer offers** — sender proposes files with metadata; recipient reviews and accepts/rejects
- **Content-addressed chunking** — files split into 256 KB chunks, each identified by SHA-256 CID
- **Integrity verification** — every chunk is verified against its CID on receipt
- **Progress tracking** — real-time byte counts, percentages, and transfer rates
- **Multi-file transfers** — multiple files in a single transfer session
- **Resumability** — recipient advertises received chunk CIDs; sender skips them on retry

## 2. Wire Format

Six new message types in the `0xB8-0xBD` range:

| Code | Name | Direction | Payload |
|------|------|-----------|---------|
| `0xB8` | `FILE_OFFER` | Sender → Recipient | `TransferOffer` |
| `0xB9` | `FILE_ACCEPT` | Recipient → Sender | `{ transferId }` |
| `0xBA` | `FILE_REJECT` | Recipient → Sender | `{ transferId, reason? }` |
| `0xBB` | `FILE_PROGRESS` | Either → Either | `{ transferId, bytesTransferred, totalSize, percentComplete }` |
| `0xBC` | `FILE_COMPLETE` | Either → Either | `{ transferId }` |
| `0xBD` | `FILE_CANCEL` | Either → Either | `{ transferId, reason? }` |

## 3. Transfer Flow

```
Sender                              Recipient
  │                                     │
  ├──── FILE_OFFER ────────────────────►│
  │     { files, totalSize, expires }   │
  │                                     │
  │◄──── FILE_ACCEPT ──────────────────┤
  │      { transferId }                 │
  │                                     │
  ├──── STREAM_DATA (chunk 1) ────────►│  verify CID
  ├──── FILE_PROGRESS ────────────────►│
  ├──── STREAM_DATA (chunk 2) ────────►│  verify CID
  ├──── FILE_PROGRESS ────────────────►│
  │         ...                         │
  ├──── STREAM_DATA (chunk N) ────────►│  verify CID
  ├──── FILE_COMPLETE ────────────────►│
  │                                     │
```

## 4. FileDescriptor

Describes a single file in a transfer:

```typescript
interface FileDescriptor {
  name: string;         // Filename (e.g., "photo.jpg")
  size: number;         // Size in bytes
  mimeType?: string;    // MIME type (e.g., "image/jpeg")
  cid?: string;         // Pre-computed SHA-256 CID of entire file
}
```

## 5. TransferOffer

```typescript
interface TransferOffer {
  transferId: string;        // Unique transfer ID
  sender: string;            // Sender identity (base64url fingerprint)
  recipient: string;         // Recipient identity
  files: FileDescriptor[];   // Files to transfer
  totalSize: number;         // Sum of all file sizes
  expires: number;           // Unix timestamp when offer expires
}
```

Offers expire after 5 minutes by default (`TRANSFER_DEFAULTS.offerExpiry`). The recipient must accept before expiry; otherwise the offer is silently discarded.

## 6. Content-Addressed Chunking

Files are split into fixed-size chunks (default: 256 KB). Each chunk is hashed with SHA-256 to produce a content identifier (CID):

```javascript
const cid = await ChunkStore.computeCid(chunkData);
// → "a948904f2f0f479b8f8564e9d39787..." (64-char hex)
```

Properties:
- **Deterministic** — same data always produces the same CID
- **Verifiable** — recipient recomputes CID and compares
- **Deduplicatable** — identical chunks across files/transfers are stored once

## 7. ChunkStore

In-memory content-addressed storage:

| Method | Description |
|--------|-------------|
| `save(cid, data)` | Store a chunk |
| `get(cid)` | Retrieve by CID |
| `has(cid)` | Check existence |
| `verify(cid, data)` | Verify data matches CID |
| `remove(cid)` | Delete a chunk |
| `static computeCid(data)` | SHA-256 hex hash |

Uses `crypto.subtle.digest` in browsers and `node:crypto` as fallback.

## 8. Transfer States

```
offered ──► accepted ──► transferring ──► completed
   │            │              │
   └──► cancelled ◄────────────┘
                               │
                          ──► failed
```

| State | Description |
|-------|-------------|
| `offered` | Offer sent, waiting for response |
| `accepted` | Recipient accepted, ready to transfer |
| `transferring` | Chunks being sent/received |
| `completed` | All chunks verified and received |
| `failed` | Unrecoverable error during transfer |
| `cancelled` | Cancelled by either party |

## 9. Progress Tracking

`TransferState` tracks per-transfer progress:

- `bytesTransferred` — total bytes sent/received
- `percentComplete` — `bytesTransferred / totalSize * 100`
- `transferRate` — bytes per second (calculated from elapsed time)
- Chunk deduplication by CID prevents double-counting

## 10. Multi-File Transfers

A single transfer can include multiple files. Each chunk carries a `fileIndex` identifying which file it belongs to. Files can complete independently, and the transfer completes when all files are done.

## 11. Resume Semantics

When a transfer is interrupted:

1. Recipient retains received chunks in its `ChunkStore`
2. On reconnection, recipient sends its set of received CIDs per file (`getReceivedChunks(fileIndex)`)
3. Sender skips chunks already received
4. Resume must occur within `TRANSFER_DEFAULTS.resumeTimeout` (30 minutes)

## 12. Defaults

```javascript
TRANSFER_DEFAULTS = {
  chunkSize: 256 * 1024,          // 256 KB per chunk
  maxConcurrentChunks: 16,        // Parallel chunk limit
  offerExpiry: 5 * 60 * 1000,     // 5 minute offer TTL
  resumeTimeout: 30 * 60 * 1000,  // 30 minute resume window
}
```

## 13. Implementation

See `web/clawser-mesh-files.js` for the Clawser implementation (~500 LOC).
