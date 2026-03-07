# Audit Recorder

## Overview

The audit recorder provides a tamper-evident, hash-chained log of operations for BrowserMesh. Each entry is linked to its predecessor via SHA-256 and signed with Ed25519. The module includes Merkle proof generation and verification for compact inclusion proofs, and fork detection for identifying divergent chains across peers.

Source: `web/clawser-mesh-audit.js`

## Wire Codes

Imported from the canonical registry (`web/packages/mesh-primitives/src/constants.mjs`):

| Name                  | Code   | Description                          |
|-----------------------|--------|--------------------------------------|
| AUDIT_ENTRY           | `0xC4` | Single audit log entry               |
| AUDIT_CHAIN_QUERY     | `0xC5` | Query an audit chain                 |
| AUDIT_CHAIN_RESPONSE  | `0xC6` | Response with audit chain data       |

## API Surface

### Constants

- **GENESIS_HASH** -- `Uint8Array(32)` of zeros, used as `previousHash` for the first entry in every chain.

### AuditEntry

A single entry in a hash-chained audit log.

**Constructor fields:** `sequence` (zero-based), `authorPodId`, `operation` (string), `data` (arbitrary), `previousHash` (Uint8Array), `timestamp` (ms), `signature?` (Uint8Array).

| Method / Property        | Returns            | Description                                    |
|--------------------------|--------------------|------------------------------------------------|
| `signedPayload`          | `string`           | Getter: canonical JSON of all fields except signature |
| `hash()`                 | `Promise<Uint8Array>` | SHA-256 of the signed payload               |
| `toJSON()`               | `object`           | Serialize; binary fields as base64url          |
| `AuditEntry.fromJSON(json)` | `AuditEntry`    | Static deserializer                            |

Canonical JSON encoding: keys sorted recursively, `Uint8Array` values encoded as base64url strings.

### AuditChain

A linear hash chain of AuditEntry objects.

| Method / Property              | Returns                                          | Description                                    |
|--------------------------------|--------------------------------------------------|------------------------------------------------|
| `constructor(chainId)`         | --                                               | Unique chain identifier required               |
| `chainId`                      | `string`                                         | Getter: chain identifier                       |
| `length`                       | `number`                                         | Getter: number of entries                      |
| `append(authorPodId, operation, data, signFn)` | `Promise<AuditEntry>`              | Append signed entry; `signFn(Uint8Array) -> Promise<Uint8Array>` |
| `verify(getPublicKey)`         | `Promise<{ valid, error?, failedAt? }>`          | Verify entire chain: hash linkage + signatures |
| `get(sequence)`                | `AuditEntry\|null`                               | Get entry by sequence number                   |
| `*entries()`                   | `IterableIterator<AuditEntry>`                   | Iterate over all entries                       |
| `slice(start?, end?)`          | `AuditEntry[]`                                   | Return a range of entries                      |
| `toJSON()` / `fromJSON(json)`  | `object` / `AuditChain`                          | Serialization round-trip                       |

**Verification** accepts a `getPublicKey(podId)` function that resolves to raw `Uint8Array` bytes or a `CryptoKey`. Checks: sequence ordering, hash linkage (each entry's `previousHash` matches predecessor's hash), and Ed25519 signature validity.

### AuditStore

Manages multiple named AuditChains.

| Method / Property        | Returns            | Description                      |
|--------------------------|--------------------|----------------------------------|
| `createChain(chainId)`   | `AuditChain`       | Create new chain; throws on duplicate |
| `getChain(chainId)`      | `AuditChain\|null` | Lookup by ID                     |
| `hasChain(chainId)`      | `boolean`          | Existence check                  |
| `deleteChain(chainId)`   | `boolean`          | Delete chain                     |
| `listChains()`           | `string[]`         | All chain IDs                    |
| `size`                   | `number`           | Getter: chain count              |

### Fork Detection

```js
detectFork(entries: AuditEntry[]): Promise<{ ancestor: number, branches: AuditEntry[][] } | null>
```

Groups entries by sequence number. If any sequence contains entries with different hashes, returns the common ancestor (last non-forked sequence) and the divergent branches grouped by hash. Returns `null` if no fork is detected.

### Merkle Proof Helpers

```js
buildMerkleRoot(entries: AuditEntry[]): Promise<Uint8Array>
```

Builds a Merkle root from entry hashes. Leaves are SHA-256 hashes of each entry's signed payload. Odd layers duplicate the last node. Returns 32 zero bytes for empty input.

```js
buildMerkleProof(entries: AuditEntry[], index: number): Promise<{ root: Uint8Array, proof: Array<{ hash: Uint8Array, position: 'left'|'right' }>, index: number }>
```

Builds an inclusion proof for the entry at `index`. Throws `RangeError` for out-of-bounds index.

```js
verifyMerkleProof(entryHash: Uint8Array, proof: Array<{ hash, position }>, index: number, root: Uint8Array): Promise<boolean>
```

Verifies a Merkle inclusion proof against an expected root.

## Implementation Status

**Status: Implemented, wired to app bootstrap via `ClawserPod.initMesh()`.**

- All classes and functions are fully implemented with cryptographic operations via Web Crypto API (`crypto.subtle`).
- Wire codes imported from the canonical registry.
- `AuditChain` and `AuditStore` are instantiated during `ClawserPod.initMesh()` mesh initialization.
- Uses `encodeBase64url` / `decodeBase64url` from `web/packages/mesh-primitives/src/index.mjs` for binary serialization.
- Ed25519 signing and verification use the Web Crypto API directly.
- Test file: `web/test/clawser-mesh-audit.test.mjs`

## Source File Reference

`web/clawser-mesh-audit.js` -- 623 lines, imports from `web/packages/mesh-primitives/src/index.mjs` and `web/packages/mesh-primitives/src/constants.mjs`.
