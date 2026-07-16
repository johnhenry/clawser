# Sync Protocol — personal multi-device + signed deploy packages

Wire-level reference for messages exchanged between paired devices and
between deploy sources/targets. The full architectural and threat-model
discussion lives in `docs/DEPLOY.md`; this document is the protocol.

## Versioning

Two independent version strings:

- `clawser-pair-v1` — pairing payload envelope
- `clawser-deploy-v1` — signed deploy package

Receivers MUST reject unknown versions.

## 1. Pairing envelope

Carrier: opaque text with a `CLAWSER-PAIR:` prefix, followed by a
base64-encoded JSON object. Designed to be QR-encodable (alphanumeric +
short).

```json
{
  "v": "clawser-pair-v1",
  "pairingId": "<base64 16 bytes>",
  "createdAt": <ms>,
  "expiresAt": <ms>,
  "sourceLabel": "<utf-8>",
  "identityLabel": "<utf-8>",
  "salt": "<base64 16 bytes>",
  "iv": "<base64 12 bytes>",
  "ciphertext": "<base64 — AES-GCM(KEK, iv, JSON.stringify(jwk))>"
}
```

KEK derivation: `PBKDF2-SHA256(code, salt, 100_000)` → AES-GCM-256.
The `code` is a 6-digit string typed by the user. TTL is 5 minutes.

## 2. Sync envelope

Carrier: `pod.sendMessage(peerId, envelope)` — application-level
message routed over the mesh transport.

```json
{
  "type": "sync",
  "kind": "yjs" | "lww",
  "itemId": "<string>",
  "payload": <transport-specific>,
  "ts": <ms>,
  "source": "<sender device id>",
  "vector": <optional Y state vector>
}
```

- `lww` payload: any JSON-safe value. Receiver applies LWW
  conflict-resolution: higher `ts` wins; equal `ts` resolves by
  lex-greater `source`.
- `yjs` payload: the binary update bytes (Uint8Array transported as
  whatever the mesh layer serializes). Receiver delegates to a
  `YjsApplicator`.

Receivers MUST drop envelopes whose `source` matches their own device
id (echo from self).

## 3. Signed deploy package

Carrier: `pod.sendMessage(peerId, package)` or any other transport that
preserves JSON shape.

```json
{
  "v": "clawser-deploy-v1",
  "source": "did:key:z6Mk…",
  "counter": <monotonic integer>,
  "manifest": {
    "sourceLabel": "<utf-8>",
    "items": [{ "kind": "skill"|"config"|"memory", "itemId": "<id>", "payloadHash": "<sha256-hex>" }],
    "capabilities": { "fs": [...], "net": [...], "mesh": [...] },
    "createdAt": <ms>
  },
  "payloads": { "<itemId>": <bytes-or-json> },
  "signature": "<base64 Ed25519>"
}
```

Signature input (UTF-8):

```
"clawser-deploy-v1|" + source + "|" + counter + "|" + canonicalJson(manifest)
```

`canonicalJson` MUST sort object keys at every level so signers and
verifiers agree byte-for-byte. Each item's `payloadHash` is
`SHA-256(payloads[itemId])` as lowercase hex.

### Receiver checks (mandatory order)

1. Resolve `source` to an Ed25519 public key from the `did:key:` URI.
2. Version match (`v === 'clawser-deploy-v1'`).
3. Verify the signature over the input above.
4. For each `manifest.items[i]`, verify
   `SHA-256(payloads[itemId]) === payloadHash`.
5. Replay counter: accept iff `counter > lastSeen[source]`. Reject
   equal/lower.
6. Trusted-source ACL check.
7. Manifest-hash approval check (prompt user if first-time-this-hash;
   reject if no prompt configured).

Only after all seven checks pass is any state changed on the target.

## 4. Audit log entries (target-local; not on-wire)

Stored under `__deploy_audit__` as a JSON array. Each entry:

```json
{
  "id": "evt-<base36>-<hex>",
  "timestamp": <ms>,
  "source": "<did:key URI>",
  "manifestHash": "<sha256-hex>",
  "items": [{ "kind": "...", "itemId": "..." }],
  "status": "applied" | "rolled-back" | "failed" | "rejected",
  "error": null | "<reason>"
}
```

The audit is local to each receiver. Optional source-side replication
("where I deployed") is out of scope for v1.

## 5. Snapshot ring (target-local; not on-wire)

Stored under `__deploy_snapshots__`. Per-source array of
`{eventId, snapshotId, at}` capped at 5; older entries are removed and
their snapshots are deleted via the snapshot driver.

## 6. Counters

- Replay counters (`__deploy_counters__`) — `did:key → integer`,
  monotonic. Receivers MAY reset to -1 on file corruption; this allows
  a one-time legitimate re-deploy but the user retains revoke as a
  recourse.
- Pairing-consumed ids (`__paired_consumed_ids__`) — capped list of
  `pairingId` strings, last 200. Replay protection on the pairing
  side.
