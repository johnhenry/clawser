# Multi Device

Device — Personal device pairing and signed deploy targets

---

### Device Pairing

**Status:** ✅ Implemented · **Category:** pairing · **Since:** v2.0.0

QR-code / 6-digit-code flow for pairing a second browser under the same identity. The source device encrypts its Ed25519 `did:key` JWK with an AES-GCM key derived from a fresh 6-digit code (PBKDF2-SHA256, 100k iterations), wraps it in a `CLAWSER-PAIR:` text payload, and the target decrypts it after the user types the same code. Both devices end up sharing one identity.

**Source files:**

- `web/clawser-pairing.mjs`

**API surface:**

- `generatePairingCode`
- `createPairingPayload`
- `parsePairingPayload`
- `consumePairingPayload`
- `createMemoryPairingStorage`

> **Note:** Bundles expire after 5 minutes by default; a 6-digit code has ~20 bits of entropy, so brute-force resistance is time-bounded by design, not indefinite. Consumed `pairingId`s are tracked (capped at last 200) so the same payload can't be replayed on the same target device.

**See also:**

- Paired Devices Store
- Multi-Device Wiring

---

### Paired Devices Store

**Status:** ✅ Implemented · **Category:** pairing · **Since:** v2.0.0

Per-identity registry of paired devices (label, peer pubkey, last sync timestamp, sync-enabled flag). Backs the "My Devices" settings panel and is what `publishDeployToAll` iterates over.

**Source files:**

- `web/clawser-paired-devices.mjs`

**API surface:**

- `PairedDevicesStore`

**See also:**

- Device Pairing
- Multi-Device Panels & Controllers

---

### Sync Flags

**Status:** ✅ Implemented · **Category:** sync · **Since:** v2.0.0

Per-item "sync to my devices" flag storage. Skills, workspace configs, and memory items are addressed by a fully-qualified `{kind}:{id}` id (e.g. `skill:my-skill`, `config:autonomy`, `memory:abc123`) and opted into sync individually. Flags persist in an OPFS-backed JSON file and are not workspace-scoped.

**Source files:**

- `web/clawser-sync-flags.mjs`

**API surface:**

- `flagId`
- `SyncFlags`

**See also:**

- Sync Engine
- Deploy Publish

---

### Sync Engine

**Status:** ✅ Implemented · **Category:** sync · **Since:** v2.0.0

Debounced (500ms default) outbound sync queue with kind-aware dispatch: `lww` payloads resolve via timestamp (ties broken lexicographically by source, for deterministic convergence between two peers); `yjs` payloads delegate to a pluggable `YjsApplicator`. Coalesces repeated updates to the same itemId so only the latest payload ships.

**Source files:**

- `web/clawser-sync.mjs`

**API surface:**

- `lwwShouldReplace`
- `SyncEngine`

**See also:**

- Sync Flags
- Multi-Device Wiring

---

### Deploy Package (signed manifests)

**Status:** ✅ Implemented · **Category:** deploy · **Since:** v2.0.0

Canonical JSON + SHA-256 hashing and Ed25519-signed package format for remote deploy. Signs `(version, sourceDid, counter, canonicalManifest)` as a single unit so tampering with any field invalidates the signature. `ReplayCounterTracker` rejects packages whose counter doesn't strictly exceed the last-seen value per source.

**Source files:**

- `web/clawser-deploy-package.mjs`

**API surface:**

- `canonicalJson`
- `sha256Hex`
- `buildSignedPackage`
- `verifySignedPackage`
- `ReplayCounterTracker`

**See also:**

- Deploy Target (ACL, approvals, audit, rollback)
- [Protocol & threat model](../docs/DEPLOY.md)

---

### Deploy Target (ACL, approvals, audit, rollback)

**Status:** ✅ Implemented · **Category:** deploy · **Since:** v2.0.0

Receive-side trust and safety layer for deploy packages: `DeployAcl` gates which `did:key:` sources are trusted, `DeployApprovals` caches one-time consent per manifest fingerprint, `DeployAuditLog` records every accepted/rejected/applied/rolled-back event, and `DeploySnapshotRing` takes a pre-deploy snapshot so an applied deploy can be rolled back. Capability tokens (`buildCapabilityToken`, `enforceCapabilityRequest`) ensure a manifest can only write the config/memory domains it explicitly declared.

**Source files:**

- `web/clawser-deploy-target.mjs`

**API surface:**

- `DeployAcl`
- `DeployApprovals`
- `DeployAuditLog`
- `DeploySnapshotRing`
- `buildCapabilityToken`
- `enforceCapabilityRequest`
- `CapabilityDeniedError`
- `acceptPackage`

> **Note:** All per-workspace: ACL, approvals, audit log, snapshots, and the replay counter live under the active workspace, not globally, so a trust grant in one workspace doesn't extend to another.

**See also:**

- Deploy Package (signed manifests)
- Deploy Apply Transport

---

### Deploy Apply Transport

**Status:** ✅ Implemented · **Category:** deploy · **Since:** v2.0.0

Per-kind handlers that actually persist an approved deploy's items: skills via `SkillStorage.writeSkill`, configs via `writeConfig` (gated against the manifest's declared `capabilities.config[]`), and memory entries via the agent's memory store (gated against `capabilities.memory[]`).

**Source files:**

- `web/clawser-deploy-apply.mjs`

**API surface:**

- `handleSkillItem`
- `handleConfigItem`
- `handleMemoryItem`
- `createApplyTransport`
- `createDefaultApplyTransport`

**See also:**

- Deploy Target (ACL, approvals, audit, rollback)

---

### Deploy Publish & Flow

**Status:** ✅ Implemented · **Category:** deploy · **Since:** v2.0.0

Sender-side deploy flow: resolves flagged items into a manifest, signs and sends a `{type: 'deploy', package}` envelope to a target's pubkey via `pod.sendMessage`, and stamps `lastSyncAt` on the paired device entry. `publishDeployToAll` fans a deploy out to every paired device with `syncEnabled: true` in parallel — one peer's failure doesn't abort the others.

**Source files:**

- `web/clawser-deploy-publish.mjs`
- `web/clawser-deploy-flow.mjs`
- `web/clawser-deploy.mjs`

**API surface:**

- `publishDeploy`
- `publishDeployToAll`
- `normalizePayloads`
- `resolveDeployItems`
- `runMeshDeployFlow`
- `buildDeployPreview`
- `runDeploy`
- `recordLocalChange`

**See also:**

- Deploy Target (ACL, approvals, audit, rollback)
- Paired Devices Store

---

### Multi-Device Wiring

**Status:** ✅ Implemented · **Category:** deploy · **Since:** v2.0.0

Binds the sync + deploy infrastructure classes into the active workspace's `state` and routes inbound `pod.onMessage` envelopes: `type: 'sync'` to the sync engine, `type: 'deploy'` to `acceptPackage`. Installed after the mesh pod is up; idempotent teardown clears state and unsubscribes on workspace switch.

**Source files:**

- `web/clawser-multi-device.mjs`

**API surface:**

- `installMultiDeviceWiring`
- `uninstallMultiDeviceWiring`

**See also:**

- Sync Engine
- Deploy Target (ACL, approvals, audit, rollback)
- [Wiring status & storage paths](../docs/multi-device-deploy.md)

---

### Multi-Device Panels & Controllers

**Status:** ✅ Implemented · **Category:** ui · **Since:** v2.0.0

UI layer: the "My Devices" panel (pair/deploy-now/deploy-to-all) and "Trusted Publishers" panel (trusted DIDs, approved manifest fingerprints, deploy audit history with rollback). Controllers wire view models to the underlying stores; the deploy item picker modal shows the derived capability set before a manifest is sent.

**Source files:**

- `web/clawser-multi-device-panels.mjs`
- `web/clawser-multi-device-controllers.mjs`
- `web/clawser-ui-multi-device.mjs`
- `web/clawser-deploy-picker-modal.mjs`

**API surface:**

- `mountMyDevicesPanel`
- `mountTrustedPublishersPanel`
- `buildMyDevicesViewModel`
- `buildTrustedPublishersViewModel`
- `buildMyDevicesController`
- `buildTrustedPublishersController`
- `renderMyDevicesPanel`
- `renderTrustedPublishersPanel`
- `showPairNewDeviceModal`
- `deriveCapabilities`
- `showPickerModal`

**See also:**

- Device Pairing
- Deploy Target (ACL, approvals, audit, rollback)

---

---

[← Pods](./pods.md) | [Index](./index.md) | [Build →](./build.md)
