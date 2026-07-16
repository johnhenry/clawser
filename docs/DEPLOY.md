# Deploy — personal multi-device sync and remote deploy targets

This is the protocol and threat-model document for the deploy system
landed 2026-05-03. The implementation is split across seven modules in
`web/`:

- `clawser-pairing.mjs`         — Phase A.1: device pairing flow
- `clawser-sync-flags.mjs`      — Phase A.2: per-item sync flags
- `clawser-sync.mjs`            — Phase A.3: sync engine (LWW + Y.js)
- `clawser-deploy.mjs`          — Phase A.4: continuous + manual deploy
- `clawser-deploy-package.mjs`  — Phase B.5: signed package format
- `clawser-deploy-target.mjs`   — Phase B.1–B.4: ACL, capabilities,
                                    audit log, versioned rollback
- `clawser-skill-capabilities.mjs` — capability-gated `{fetch, fs, mesh}`
                                    API used by deployed-skill execution

The system has two intended use cases:

1. **Personal multi-device sync.** Two devices that share the same
   `did:key` (paired via the QR-code/6-digit-code flow) auto-sync any
   item flagged for sync. No additional trust check — both devices are
   "you".
2. **Remote deploy targets.** A device receives signed packages from
   any peer in its trusted-sources ACL after first-time approval of
   the deploy manifest. Each deploy is sandboxed by manifest-declared
   capabilities and recorded in a per-device audit log.

These sit on the same engine. The difference is which `source` the
target sees: a paired device sends with the shared `did:key`, while a
remote source signs with its own.

---

## Phase A — sync foundation

### A.1 Device pairing

The source device exports its mesh identity (an Ed25519 key pair backing
a W3C `did:key`) as an encrypted JWK bundle, keyed by a freshly
generated 6-digit code:

```
KEK = PBKDF2-SHA256(code, salt, 100_000)
ciphertext = AES-GCM(KEK, iv, JSON.stringify(jwk))
```

The bundle plus a random `pairingId` and `expiresAt` are wrapped in a
`CLAWSER-PAIR:` text payload that's renderable as a QR code or pasted
manually. The target parses, types the same 6-digit code, and decrypts.
PBKDF2 at 100k iterations is brute-force resistant only for the
five-minute window the bundle is live — that's the design: a 6-digit
code has ~20 bits of entropy and we don't pretend otherwise.

Replay protection: each target tracks the consumed `pairingId`s in
`__paired_consumed_ids__` so the same QR cannot be applied twice on
the same device. (Capped at the last 200 ids to prevent unbounded
growth.) Across devices, the time-bounded encryption is what limits
reuse — once expired, the bundle is mathematically unrecoverable in
any reasonable attacker budget.

### A.2 Per-item sync flags

Items opt into sync with a `sync` boolean. The flag set is persisted
as a flat JSON file `__sync_flags__` listing fully-qualified IDs of
the form `kind:id` (e.g. `skill:my-skill`, `config:autonomy`,
`memory:abc123`). Default off. The UI surfaces this as a toggle on
every supported item row.

### A.3 Sync engine

`SyncEngine` owns:

- A debounced outbound queue (500 ms windows by default). Repeated
  updates to the same `itemId` coalesce — only the latest payload
  ships.
- Kind-aware dispatch:
  - **`lww`** carries `(payload, ts, source)`. Receiver compares
    against current state via `lwwShouldReplace`; higher `ts` wins,
    equal `ts` breaks lexicographically on `source` (deterministic and
    convergent for two peers resolving the same conflict).
  - **`yjs`** delegates to a pluggable `YjsApplicator` (`applyUpdate`,
    `encodeStateAsUpdate`). The engine doesn't know Y.js internals —
    the existing `clawser-peer-collab.js` infrastructure is the
    intended adapter. Y.js merges are commutative so no LWW guard is
    applied; the receiver simply stages the update.

The wire envelope is:

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

Transport: every paired peer receives the envelope via
`pod.sendMessage(peerId, envelope)`. A send failure to one peer does
not abort delivery to the others; the failure is logged but the next
update is unaffected.

### A.4 Push modes

Two triggers, same engine:

- **Always-sync.** `recordLocalChange(ctx, fid, kind, itemId, payload)`
  — called by item-storage layers when an item changes locally.
  Checks the sync flag; if set, enqueues on the engine, which flushes
  after the debounce.
- **Manual deploy.** `runDeploy(ctx)` — used by the "Deploy now"
  button. Enumerates every flagged item via `flags.listFlagged()`,
  resolves each to a snapshot, queues them, and flushes immediately.
  `buildDeployPreview(ctx)` produces the confirmation-dialog data
  before invoking `runDeploy`.

### A.5 Atomic apply

Every inbound batch (one or more validated envelopes) is applied
atomically:

1. Take a snapshot via the snapshot driver (`createAtomicSnapshot()`).
2. For each item, call `store.stageApply(kind, itemId, current, incoming)`.
3. Call `store.commit()`.
4. On any error in 2 or 3: call `store.discard()` (best-effort) AND
   `snapshot.restore(snapshotId)`. The result reports `rolledBack: true`.

The snapshot driver is optional — without one the engine still applies
batches, but rollback becomes best-effort discard-only. Tests cover
the rollback path including a stage-apply throw mid-batch and a
commit-time throw.

---

## Phase B — remote deploy targets

When the `source` is *not* one of your paired devices, the receiver
runs the full `acceptPackage(pkg, ctx)` pipeline before applying.

### Wire format

```json
{
  "v": "clawser-deploy-v1",
  "source": "did:key:z6Mk…",
  "counter": 1234,
  "manifest": {
    "sourceLabel": "Alice's MBP",
    "items": [
      { "kind": "skill", "itemId": "code-review", "payloadHash": "<sha256-hex>" }
    ],
    "capabilities": {
      "fs":     ["/tmp/", "/workspace/skills/"],
      "net":    ["api.github.com", "*.example.com"],
      "mesh":   ["mesh:peer-list"],
      "config": ["autonomy"],
      "memory": ["notes"]
    },
    "createdAt": 1714665600000
  },
  "payloads": {
    "code-review": "<raw bytes or JSON>"
  },
  "signature": "<base64 Ed25519 signature>"
}
```

The signature covers:

```
"clawser-deploy-v1|" + source + "|" + counter + "|" + canonicalJson(manifest)
```

`canonicalJson` sorts keys at every object level so source and target
agree byte-for-byte on what was signed. Each item's `payloadHash`
binds the payload bytes to the manifest without signing each blob —
mutating any payload changes its hash and the manifest no longer
verifies.

### Receiver pipeline (`acceptPackage`)

In order:

1. **Resolve source pubkey.** The caller's `resolvePublicKey(source)`
   parses the `did:key:` URI to a `CryptoKey`. Failure short-circuits
   with an audit-logged rejection.
2. **Verify signature + payload hashes** (`verifySignedPackage`).
   Tampered manifest, tampered payload, wrong key, or unknown version
   all fail here.
3. **Replay counter.** `replay.accept(source, counter)` returns false
   if `counter <= lastSeen[source]`. Replay attempts are rejected
   without modifying state.
4. **ACL check.** `acl.isTrusted(source)` — must be granted (and not
   revoked) by the user.
5. **Manifest approval.** `approvals.isApproved(source, manifestHash)`.
   First-time-this-manifest prompts the user with the full manifest
   contents; approval is cached by `(source, manifestHash)` so future
   deploys with the same hash auto-apply. Manifest changes (new
   capability, new item, anything that changes `canonicalJson`) yield
   a different hash and re-prompt. If no `promptApprove` is configured
   in the receiver context, an unapproved manifest is rejected
   outright (no implicit approval).
6. **Atomic apply.** `applyTransport.applyBatch(items)` is the same
   engine `applyBatch` from Phase A, including snapshot before and
   rollback on error.
7. **Audit log entry.** Status is `applied`, `rolled-back`, `failed`,
   or `rejected` (one of the upstream rejection kinds).
8. **Snapshot ring entry.** Recorded under `(source, eventId,
   snapshotId)`. Older snapshots beyond the per-source retention
   (default 5) are pruned via the snapshot driver's `delete`.

### Capability tokens

`buildCapabilityToken(manifest)` produces an inert
`{fs:[...], net:[...], mesh:[...], config:[...], memory:[...]}` object
the sandbox carries through skill execution. (`config` and `memory`
were added by the multi-device wiring pass to gate the `config` and
`memory` apply-transport handlers — see
[`multi-device-deploy.md`](multi-device-deploy.md).)
`enforceCapabilityRequest(token, request)` either returns silently or
throws `CapabilityDeniedError`.

Matching rules:

- `fs` — prefix match. `'/tmp/'` allows `'/tmp/foo'` but not `'/etc/passwd'`.
- `net` — exact host or `*.suffix` glob. `'*.example.com'` matches
  `'a.example.com'` but **not** the bare `'example.com'`.
- `mesh` — exact-string match (e.g. `'mesh:peer-list'`).
- `config` / `memory` — exact-string match against the declared domain
  or memory category, same as `mesh`.

#### Active enforcement (skill-runtime integration)

Capability gating is wired through `web/clawser-skills.js` end-to-end:

- `executeSkillScript(content, input, opts)` is the integration point.
  When `opts.capabilities` is present, the script runs in a same-realm
  AsyncFunction with a capability-gated `{fetch, fs, mesh}` API bound
  as locals (see `web/clawser-skill-capabilities.mjs`). When absent
  (local skills), it falls into the existing andbox Worker sandbox path.
- `SkillScriptTool` accepts `{capabilities, capabilityHooks}` in its
  constructor; the deploy receiver builds the tool with the manifest's
  capability token attached.
- `acceptPackage` derives the token via `buildCapabilityToken(pkg.manifest)`
  and includes it on every item in the apply batch. Stores persist
  `(item, capabilities)` together; the skill registry reads both back
  at activation time and constructs the gated `SkillScriptTool`.

The user-facing error is shaped to point at the manifest declaration
the source needs to add. Example:

> `Capability not granted: net access to "evil.com" was requested by
> the skill but is not declared in the deploy manifest. Ask the source
> to add "evil.com" to manifest.capabilities.net and re-deploy.`

This makes capability-denial errors actionable — users can hand the
exact missing declaration back to the deploy source.

Why same-realm AsyncFunction (not the Worker sandbox) for deployed
skills: the deployed-skill case has already passed signature
verification + manifest approval, so the user has explicitly opted in
to running the code. Worker isolation is defense-in-depth for
*untrusted* local skills; surface-level capability gating matches the
threat model better for trusted-but-bounded deployed skills, and lets
us host-inject the gated `fetch`/`fs`/`mesh` directly without a
postMessage RPC bridge.

### Audit log

`__deploy_audit__` (JSON-array on disk; the docs / external readers
treat each entry as a JSONL line). Each entry:

```json
{
  "id": "evt-<base36-time>-<hex>",
  "timestamp": 1714665600000,
  "source": "did:key:z6Mk…",
  "manifestHash": "<sha256-hex>",
  "items": [{ "kind": "skill", "itemId": "code-review" }],
  "status": "applied" | "rolled-back" | "failed" | "rejected",
  "error": null | "<reason>"
}
```

Capped at 1000 entries by default (oldest dropped). Filterable by
source.

### Versioned rollback

Each successful deploy records its event id against the snapshot id in
`__deploy_snapshots__`. Per-source retention is 5 events; older
snapshots get pruned via the snapshot driver's `delete`.

`snapshots.restore(eventId)` looks up the recorded snapshotId across
all sources and calls the snapshot driver's `restore`. The UI shows a
"Roll back" button on every audit entry whose status is `applied` and
whose snapshotId is still alive.

---

## Threat model

The system protects user data on devices the user controls against
adversaries who control:

- Other peers on the same mesh
- The transport (relay, signaling, WebRTC peers)
- Stale or replayed packages

It does **not** protect against:

- A compromised source device — see below
- Malicious skill code that an authorized source signs and the user
  approves the manifest for. Mitigation: capability tokens and
  audit-log review are the user's recourse.

### Compromised source

If an attacker steals a source device's mesh identity (the Ed25519
private key from `did:key`):

- They can forge signed packages indistinguishable from the genuine
  source — signature checks still pass.
- They cannot bypass replay protection: counters are monotonic
  per-source, and the target rejects equal-or-lower counters. A genuine
  package the attacker captured cannot be replayed once a higher
  counter has arrived.
- They can NOT forge a `manifestHash` collision (SHA-256), so they
  can't piggyback on an existing approval — any new manifest re-prompts.
- The user's mitigation is `acl.revoke(source)`, which immediately
  cuts off all future deploys from that identity. Past audit entries
  remain so the user can see what was applied; the rollback ring lets
  them undo the last 5 deploys per source if needed.

### Compromised target

If an attacker has filesystem access to the target's OPFS:

- They can read/modify the audit log, the ACL, the approvals, the
  snapshot ring metadata. We can't prevent this — there's no on-device
  trust anchor below "the user owns this OPFS".
- They cannot decrypt secrets the vault holds without the vault's
  unlock material (passphrase or passkey PRF output).
- They cannot forge packages that come from a real source — they don't
  have the source's private key. The worst they can do with the deploy
  log is delete entries.

### Compromised paired device

If a paired (personal) device is compromised, the attacker effectively
*is* the user from the mesh's perspective — the shared `did:key` lets
them sign as that user. Mitigations:

- Re-pair: generate a new `did:key`, re-export to the legitimate
  devices, revoke the old identity in trusted-source ACLs on every
  remote target.
- The vault's separate unlock material (passphrase + passkey PRF)
  means stolen mesh identity does **not** give the attacker access to
  the user's API keys / OAuth tokens. Vault and mesh-identity are
  intentionally separate trust domains.

### What we do not attempt

- **End-to-end encryption of envelopes on top of the mesh.** The mesh
  layer's transport encryption (WebRTC DTLS, TLS to relay) is what
  protects traffic in flight. Adding an extra encryption layer over
  the deploy package is redundant for the personal-device case (same
  identity on both ends) and is partially provided for remote deploys
  (the signature gives integrity + authenticity; payload secrecy is
  punted to the transport). A future iteration may add per-package
  encryption to the receiver's pubkey for store-and-forward use cases.
- **Mandatory rate limiting per source.** The replay counter ensures
  monotonicity but nothing throttles a flood of distinct counters.
  Recipients can revoke aggressively-deploying sources via the ACL.
