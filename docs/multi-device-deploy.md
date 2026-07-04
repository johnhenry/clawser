# Multi-device sync + deploy targets — wiring status

This document covers the production wiring of the sync-flags and
deploy-target infrastructure. Initial infrastructure shipped 2026-05-03;
the receive-side dispatcher landed 2026-05-04; the outbound flow,
apply transport, approval modal, DID resolver, and UI render+bind
layer landed in the same week; the **production controllers, mount
points, paired-devices registry, item-picker modal, and end-to-end
verification all shipped 2026-05-03 (this pass)** — closing the
remaining gaps to a working multi-device deploy.

For the protocol itself (envelope formats, signed-package layout,
threat model) see [`DEPLOY.md`](DEPLOY.md).

---

## What's wired (2026-05-04)

### Pod-level message bus

`pod.sendMessage(peerId, envelope)` ships raw JSON via
`peerNode.sendTo`. The inbound symmetry (`pod.onMessage`) used to be
missing — the previous code path expected `PeerSession`'s session
envelope format which `sendMessage` doesn't produce. The 2026-05-04
pass added:

- `peerNode.onIncomingData(cb)` — fans every transport's
  `transport.onMessage` to a Set of listeners, called as
  `cb(pubKey, data, {sessionId, transport})`.
- `pod.onMessage(handler)` — wraps `onIncomingData`, parses string
  data as JSON, and dispatches `(envelope, fromPeerId, meta)` to the
  registered handler. Returns an unsubscribe function.

This gives every workspace consumer a single hook for inbound mesh
traffic without each subsystem wiring its own per-session handler.

### Per-workspace state

`installMultiDeviceWiring({pod, state, wsId, ...})` (in
`web/clawser-multi-device.mjs`) is called from `initMeshSubsystem`
after the pod is up. It:

1. Builds per-workspace storage adapters rooted at
   `~/.config/clawser/sync/` and `~/.config/clawser/deploy/`. The
   adapter falls back to in-memory storage when OPFS isn't
   reachable (Node tests, certain privacy modes).
2. Instantiates `SyncFlags`, `DeployAcl`, `DeployApprovals`,
   `DeployAuditLog`, `DeploySnapshotRing`, `ReplayCounterTracker`
   against those adapters.
3. Registers a `pod.onMessage` handler that routes by `envelope.type`:
   - `'sync'` → `syncEngine.handleIncoming(envelope)`
   - `'deploy'` → `acceptPackage(envelope.package, ctx)`
   - Anything else → ignored (no error).
4. Stores the bundle on `state.syncFlags` and `state.deployTarget`.

`uninstallMultiDeviceWiring(state)` clears state and unsubscribes —
called on workspace teardown and as the first step of each new
install (idempotent).

### Per-workspace isolation

Per the user's decisions: ACL, approvals, audit log, snapshots,
replay counter, sync flags are all per-workspace. Storage paths
resolve via `resolveVirtualPath('~/.config/clawser/...', wsId)`,
which means they live under `clawser/workspaces/{wsId}/.config/clawser/`
on disk and are reachable as `/home/<active>/.config/clawser/...`
in the shell view.

A flag toggled in workspace A is invisible from workspace B; an ACL
grant in A doesn't extend trust to B. Verified in
`web/test/clawser-multi-device-wiring.test.mjs` (the per-workspace
isolation describe block).

### Inbound envelope shapes

The dispatcher recognizes:

```jsonc
// kind:'sync' envelopes — handled by the existing SyncEngine
{
  "type": "sync",
  "kind": "lww" | "yjs",
  "itemId": "skill:my-skill",
  "payload": <transport-specific>,
  "ts": 1714665600000,
  "source": "did:key:z6Mk…"
}
```

```jsonc
// deploy packages — handled by acceptPackage
{
  "type": "deploy",
  "package": {
    "v": "clawser-deploy-v1",
    "source": "did:key:z6Mk…",
    "counter": 42,
    "manifest": { /* … */ },
    "payloads": { /* … */ },
    "signature": "<base64>"
  }
}
```

Malformed payloads (non-JSON, non-object, missing fields) are
dropped silently — defense against malformed traffic from
half-implemented peers.

### Tests covering the wiring

- `web/test/clawser-pod-onmessage.test.mjs` (5) — pod-level dispatch
  contract, malformed-payload drops, no-op when peerNode is missing.
- `web/test/clawser-multi-device-wiring.test.mjs` (11) — install /
  uninstall, inbound type-routing for sync + deploy, untrusted-source
  rejection writes audit, malformed envelope handling, per-workspace
  isolation across two `wsIds`.

Suite total: 9,218 → 9,234 (+16 from this pass).

---

## Track 3 — completion status (2026-05-04 follow-up pass)

Five items from the Track 3 punch list, walked through:

### 1. Outbound deploy flow — **SHIPPED**

`web/clawser-deploy-publish.mjs` provides `publishDeploy({items,
targetPubKey, signingKey, sourceDid, pod, manifestExtras?,
nextCounter?})`. Builds payload bytes, manifest, signs via
`buildSignedPackage`, sends via `pod.sendMessage(target, { type:
'deploy', package })`. `publishDeployToAll({targets, publishOpts})`
fans out in parallel; one peer's failure doesn't abort the others.
15 tests including a full source-side build + sign → target-side
verify-via-`resolveDidKey` round-trip.

### 2. Real `applyTransport` — **SHIPPED**

`web/clawser-deploy-apply.mjs` provides
`createApplyTransport({ctx, handlers})` and
`createDefaultApplyTransport({state, wsId, writeConfig, skillsAPI})`.
Three default handlers:

- `skill` — payload `{files: {<path>: <content>}, scope?}` →
  `SkillStorage.writeSkill(scope, wsId, name, fileMap)`.
- `config` — payload is the JSON value, `itemId` is the domain →
  `writeConfig(domain, wsId, value)`. Gated by
  `manifest.capabilities.config[]`. Unknown domains rejected.
- `memory` — payload `{key, content, category?}` →
  `state.agent.memoryStore({...})`. Gated by
  `manifest.capabilities.memory[]`.

`buildCapabilityToken` extended to include `config` and `memory`
arrays; `enforceCapabilityRequest` extended with `kind === 'config'`
and `kind === 'memory'` cases. 17 tests covering happy paths,
malformed payloads, unknown domains, capability denials, and
batch atomicity (any-item failure → batch fails).

`installMultiDeviceWiring` now wires the default apply transport
via `applyHandlers: { writeConfig, skillsAPI }` from
`workspace-init-mesh`.

### 3. `promptApprove` modal — **SHIPPED**

`web/clawser-approval-modal.mjs` provides
`approvalModalPrompt(req)` and exports `renderApprovalBody` for
testing the rendered content separately. Modal shows source label
+ shortened DID, manifest fingerprint (shortened), capability list
across all five kinds (fs, net, mesh, config, memory), and items
being deployed. Approve/Deny resolves a Promise to `boolean`. UX
defensiveness: Deny button is focused by default, Escape resolves
false, click outside also resolves false.

8 tests covering the empty-state ("(none requested)"), populated
state, HTML escaping, Approve/Deny dispatch, and graceful
no-DOM fallback (auto-deny).

`installMultiDeviceWiring` now passes `promptApprove:
approvalModalPrompt`.

### 4. `resolvePublicKey` — **SHIPPED**

`web/clawser-did-key.mjs` provides `resolveDidKey(did)`
(`did:key:z…` → `CryptoKey`), `parseDidKey(did)` (returns the raw
32-byte pubkey), and `base58btcDecode(s)`. Round-trips with
`MeshIdentityManager.toDID(podId)` — a signature made by an
identity managed by the manager verifies against the resolved key.

Defensive checks: rejects non-`did:key`, non-`z` multibase
prefix, garbage payloads, unsupported multicodecs (only Ed25519
`0xed 0x01` is accepted), and wrong byte lengths.

10 tests including the round-trip + a wrong-identity negative test.

`installMultiDeviceWiring` defaults `resolvePublicKey =
resolveDidKey` so signed packages from `did:key:` peers verify out
of the box.

### 5. UI panels — **SHIPPED**

`web/clawser-ui-multi-device.mjs` provides the render+bind layer:

- `renderMyDevicesPanel({devices})` → HTML string with rows for
  label, last-sync timestamp, sync toggle, "Deploy now", "Unpair",
  and the "Pair new device" button.
- `bindMyDevicesPanel(container, controller)` → wires onClick/onChange
  events to controller hooks (`onPairNew`, `onToggleSync`, `onDeployNow`,
  `onUnpair`). Returns unsubscribe.
- `renderTrustedPublishersPanel({sources, approvals, auditEvents})`
  → HTML string with three sections (trusted DIDs, approved manifest
  fingerprints, deploy history with rollback per `applied` entry).
- `bindTrustedPublishersPanel(container, controller)` → wires
  `onRevokeSource`, `onRetrustSource`, `onRevokeApproval`,
  `onRollback`.
- `showPairNewDeviceModal({generatePayload})` → opens a modal that
  displays the pairing payload for the user to scan/copy.

15 tests covering every render+bind combination, empty/populated
states, HTML escaping (XSS defense), and dispatch semantics.

### 6. Production controllers — **SHIPPED**

`web/clawser-multi-device-controllers.mjs` provides:

- `buildMyDevicesController(ctx)` — returns `{onPairNew, onToggleSync,
  onDeployNow, onUnpair}`. `onDeployNow` chains
  `showPickerModal → publishDeploy → store.recordSync` and threads
  the active identity's signing key + DID through. `onPairNew`
  generates a fresh pairing code via `clawser-pairing.mjs` and shows
  it via `showPairNewDeviceModal`. Modal helpers are injectable so
  controllers stay testable without DOM.
- `buildTrustedPublishersController(ctx)` — returns `{onRevokeSource,
  onRetrustSource, onRevokeApproval, onRollback}`. All actions go
  through a `confirm` injectable that defaults to `modal.confirm`
  (or `window.confirm`, or auto-true for tests).

19 tests in `web/test/clawser-multi-device-controllers.test.mjs`.

### 7. Item picker modal — **SHIPPED**

`web/clawser-deploy-picker-modal.mjs` provides `showPickerModal({skills,
configs, memory, sourceLabel})` returning `{items, manifest} | null`.

Three sections with checkboxes: skills, configs, memory.
`deriveCapabilities(items)` is **strictly declarative** — configs
contribute their domain to `capabilities.config[]`, memory contributes
its category to `capabilities.memory[]`, and skills contribute
nothing. There is **no magic capability inference from skill content**
(per scoping decision: anything else would create a security
laundering surface).

The modal previews the derived capability set before send so the
sender can see exactly what they're authorizing the recipient to
receive.

### 8. Paired-devices registry — **SHIPPED**

`web/clawser-paired-devices.mjs` provides `PairedDevicesStore` —
the registry that tracks which devices have been paired with this
identity. Storage lives at `~/.config/clawser/paired-devices/`
under the active workspace (path scoped to ws by current OPFS
plumbing; cross-workspace global paired-devices is a future polish
item — the data is per-identity in spirit but per-ws on disk).

API: `list()`, `get(id)`, `add(entry)`, `update(id, patch)`,
`remove(id)`, `setLabel(id, label)`, `recordSync(id, ts?)`,
`subscribe(callback)`, `clear()`. Reactive subscribe lets the
panel re-render automatically on every mutation.

Entry shape: `{deviceId, label, addedAt, lastSyncAt, peerPublicKey,
peerDid}` plus arbitrary patch fields like `syncEnabled`.

21 tests in `web/test/clawser-paired-devices.test.mjs`.

`installMultiDeviceWiring` instantiates the store as
`state.pairedDevices`; `uninstallMultiDeviceWiring` clears it.

### 9. Mount into live DOM — **SHIPPED**

`web/clawser-multi-device-panels.mjs` provides:

- `mountMyDevicesPanel(state, opts)` — subscribes to
  `state.pairedDevices` for reactive re-render. Idempotent via a
  WeakMap-keyed mount handle.
- `mountTrustedPublishersPanel(state, opts)` — wraps controller
  actions to re-render after each mutation (deploy stores don't
  expose `subscribe` today, so the wrap pattern keeps the panel
  fresh without polling).

`web/index.html` exposes two collapsible sections under the mesh
panel: "My Devices" (`#myDevicesToggle` + `#myDevicesContainer`)
and "Trusted Publishers" (`#trustedPubsToggle` +
`#trustedPubsContainer`). `web/clawser-ui-panels.js` wires the
toggle buttons to lazy-load the panel module on first open and
mount into the container.

11 tests in `web/test/clawser-multi-device-panels.test.mjs`
covering view-model transforms, mount idempotence, and reactive
re-render on subscribe.

### 10. End-to-end verification — **SHIPPED**

`web/test/clawser-multi-device-e2e.test.mjs` proves the full
production round-trip with no mocked surfaces between source and
target:

1. Two simulated workspaces share a single Ed25519 identity (real
   `MeshIdentityManager`).
2. A `makePodPair()` shim links them via in-memory transport that
   mirrors `peerNode.onIncomingData → pod.onMessage`.
3. The source uses `buildMyDevicesController` → `onDeployNow` →
   `publishDeploy` to sign + send a skill package.
4. The target's `pod.onMessage` dispatcher hits `acceptPackage`,
   verifies the signature against the source DID via `resolveDidKey`,
   passes the ACL/approval gates, and calls the apply transport.
5. Audit log records the `applied` event; source's
   `recordSync(deviceId)` stamps `lastSyncAt`; rollback restores via
   the snapshot driver.

Three test cases: happy path, untrusted source rejected, user-denied
approval rejected. All audit log assertions verify the expected
`status` + `error` strings.

---

## Test count delta

The full multi-device deploy effort across 2026-05-03 → 2026-05-04
landed 9,353 tests in the suite (up from a pre-track-3 baseline of
9,218; +135 from the deploy work specifically). All passing; three
consecutive stable runs at the end of the pass.

---

## How to inspect the wiring at runtime

Once a workspace is loaded:

```js
// In the browser console:
state.syncFlags                 // SyncFlags instance
state.syncFlags.listFlagged()   // Promise<string[]>
state.deployTarget              // bundle of services
state.deployTarget.deployAcl    // DeployAcl instance
state.deployTarget.deployAcl.list()  // Promise<{source, label, ...}[]>
state.deployTarget.deployAudit.list({limit: 20})  // recent deploy events
```

To verify the dispatcher is live:

```js
// In console:
const env = { type: 'sync', kind: 'lww', itemId: 'test', payload: 1, ts: Date.now(), source: 'self' };
// (You'd need a real peer to test inbound, but the round-trip works.)
```

Storage on disk (after some flagging activity):

```
clawser/workspaces/{wsId}/.config/clawser/sync/__sync_flags__.json
clawser/workspaces/{wsId}/.config/clawser/deploy/__deploy_acl__.json
clawser/workspaces/{wsId}/.config/clawser/deploy/__deploy_approvals__.json
clawser/workspaces/{wsId}/.config/clawser/deploy/__deploy_audit__.json
clawser/workspaces/{wsId}/.config/clawser/deploy/__deploy_counters__.json
clawser/workspaces/{wsId}/.config/clawser/deploy/__deploy_snapshots__.json
```

In the shell view: `/home/<active>/.config/clawser/sync/`,
`/home/<active>/.config/clawser/deploy/`.
