# Gap Closure Plan

Date: 2026-05-02 (last verified 2026-05-03 vault Option F pass)

> **Closure status:** Batch 1 + Batch 2 shipped. The two partials surfaced
> during cross-validation were closed in the 2026-05-02 follow-up:
> - **A3 (mesh peer device write path):** **Done.**
>   `ClawserPod.sendMessage(peerId, envelope)` + `PeerNode.sendTo(pubKey, data)`
>   added; wired into the peer device's `sendFn` via discovery events.
> - **Phase 7 (FsUiSync) read direction:** **Done.**
>   `createShellSession` registers all six panels via
>   `state.fsUiSync.registerPanel(domain, { render })`. Render functions
>   use `clawser-panel-dirty.mjs` setters so user-typed input is
>   preserved while untouched fields update.
>
> **2026-05-03 quick-wins pass:** four small items closed in one session —
> Helia CDN URL bumped to 6.1.4 (verified current); Relay/Mesh Settings
> UI section added with auto-connect wiring; new `PresenceService`
> extracted into `web/clawser-presence.mjs`; 126 silent catch blocks
> (audit said 41, actual 126) converted to debug-gated `silentCatch(...)`
> calls. Tests: 8,887 → 8,925 (+38).
>
> **2026-05-03 vault Option F pass:** refactored `web/clawser-vault.js`
> from direct passphrase encryption to a wrapped-DEK model with multiple
> unlock paths. Added "Change passphrase" UI, WebAuthn passkey
> enrollment + unlock with the PRF extension
> (`web/clawser-passkey.mjs`), and atomic v1→v2 migration on first
> unlock of legacy vaults. Recovery codes deliberately not shipped —
> see `docs/VAULT.md`. Tests: 8,925 → 8,988 (+63).
>
> **2026-05-03 deploy targets pass:** closed the "remote peers as
> deployment targets" item. Phase A delivers personal multi-device
> sync (pairing, sync flags, sync engine with LWW + Y.js delegation,
> atomic apply, push modes); Phase B layers real deploy targets on
> top (Ed25519-signed packages, monotonic replay counters,
> trusted-source ACL, manifest-hash approval cache, capability tokens,
> audit log, versioned rollback). 6 new modules, 120 new tests. See
> `docs/DEPLOY.md` and `docs/browsermesh/specs/extensions/sync-protocol.md`.
> Tests: 8,988 → 9,108 (+120).
>
> **2026-05-03 deploy follow-ups pass:** closed B.2 (capability
> enforcement actively wired through `executeSkillScript`,
> `SkillScriptTool`, and `acceptPackage`'s applyBatch shape) and A.3
> follow-through (real `YjsApplicatorRegistry` over `YjsAdapter` with
> outbound bridge to the sync engine; two-peer convergence test).
> 3 new modules, 38 new tests. Tests: 9,108 → 9,146 (+38).
>
> Authoritative per-item status lives in `docs/implementation-status.md`;
> the matrix in `docs/cross-validation-2026-05-02.md` Pass 5 cross-checks
> all four status files for coherence.
>
> **Note (2026-07-16):** `docs/implementation-status.md` is a dated
> snapshot (last verified 2026-05-02/03) and has not been kept current —
> see `OUTSTANDING.md` (repo root) and `CHANGELOG.md` for what's shipped
> since.
>
> **Doc-audit spot-check (2026-07-16):** re-grepped the individual item
> write-ups below against current code, since only A3/A6 carry inline
> "Shipped" callouts even though the summary above says all of Batch 1 + 2
> is done. Confirmed still true in code (no further doc changes needed,
> just noting it here so the individual sections aren't mistaken for open
> work): **A1** (`injectEnvIntoShell` is called from
> `clawser-shell-factory.js`), **A2** (`clawser-workspace-lifecycle.js`
> registers all five remaining `fsUiSync` panels: identity, security,
> daemon, terminal, hooks), **A4** (`clawser-workspace-lifecycle.js`
> builds a `hardwareAdapters` map and passes it to `initDeviceFs`), **A7**
> (`getCompletions()` tab-completion lives in `clawser-shell.js`), **A9**
> (`clawser-did-key.mjs` implements the W3C `did:key` multicodec — Ed25519
> prefix `0xed 0x01` + base58btc), **B1–B4** (`ClawserPod` constructs
> `MeshNameResolver`, `MigrationEngine`, `MeshRelayClient`, and
> `AppRegistry`/`AppStore` in its init sequence), and **G1**
> (`state.tunnelManager = new TunnelManager()` in `clawser-app.js`). **A5**
> (workspaces.json) shipped via a different mechanism than originally
> specified: `clawser-workspaces.js` keeps `loadWorkspaces()`/
> `saveWorkspaces()` synchronous (not the `async` rewrite this doc
> proposed) backed by an in-memory cache with an async OPFS persist and a
> localStorage fallback for early-boot/uncached reads — same end result
> (OPFS-first, localStorage safety net), different shape.

Source: `docs/implementation-status.md` — every non-Done item in that ledger
gets a planned closure here. Each entry has acceptance criteria, approach, test
plan, effort estimate, risk flags, and dependencies. Items are then grouped
into batches.

Effort scale: **XS** (<30 min) / **S** (1-2 h) / **M** (half day) /
**L** (full day) / **XL** (multi-day, scoping discussion needed before start).

## User Decisions (2026-05-02)

- **A6 (snapshots):** real streaming tar implementation against OPFS, not a
  doc fix. Scope-up from XS to **L**.
- **A5 (workspaces.json):** OPFS-first with one-time migration; localStorage
  read-only fallback for one release.
- **A3 (mesh peer device files):** read-write. Reads return JSON metadata
  `{podId, status, lastSeen, ...}`. Writes accept JSON `{type, payload}`,
  documented in UFS and tested. Scope-up from M to **M-L**.
- **Execution scope:** Batch 1 + Batch 2. Batch 3 stays pending.
- **Stop rule:** if any item exceeds 2× the estimate after starting, stop and
  report rather than push through.

---

## Reclassification (corrections to the ledger)

Two items in the ledger turned out to be misclassified once I read the code
in detail:

- **`clawser-tunnel.js` `connect()`/`disconnect()` "stubbed".** False positive.
  The throws live on the abstract `TunnelProvider` base class — the standard
  "you must implement this in a subclass" pattern. `CloudflareTunnel` and
  `NgrokTunnel` are concrete subclasses that fully implement both. The real
  gap is that nothing in production *instantiates* `TunnelManager` or its
  providers — see item **G1** below. The base-class throws are not a bug.
- **Phase 5 — Hardware devices.** Listed as "Not wired" in the ledger. The
  underlying `PeripheralManager` is instantiated in `clawser-app.js:376` and
  six hw_* tools are registered. The gap is narrower: the
  `/dev/clawser/hardware/{name}` *device-file* namespace doesn't get
  populated because `initDeviceFs` is called without a `hardwareAdapters`
  map. See item **A4** below.

---

## A. Filesystem and Shell Gaps

### A1. Wire `injectEnvIntoShell` (Phase 6 .env loading)

- **What it is.** Load `~/.config/clawser/.env` and inject the parsed
  KEY=VALUE pairs into the shell environment on workspace init. Code exists
  in `clawser-fs-env.mjs` but no production caller imports it.
- **Acceptance criteria.**
  - `createShellSession()` calls `injectEnvIntoShell(wsId, state.shell.state)`
    after profile sourcing.
  - A `~/.config/clawser/.env` file containing `FOO=bar` results in
    `state.shell.state.env.get('FOO') === 'bar'`.
  - Comments and quoted values are honored.
  - A missing `.env` is silently a no-op.
- **Approach.**
  - `web/clawser-workspace-lifecycle.js`: import `injectEnvIntoShell` from
    `./clawser-fs-env.mjs`, call it after `createConfiguredShell` returns
    in `createShellSession`. Best-effort with try/catch.
- **Test plan.** Add E2E test in `web/test/clawser-fs-e2e.test.mjs` (or
  extend the existing one): write a `.env` to MemoryFs, run the loader,
  assert env vars on shell state.
- **Effort.** XS.
- **Risk.** None. Failure path is a logged warning.
- **Dependencies.** None.

### A2. Wire `state.fsUiSync` for the remaining 5 panels

- **What it is.** Phase 7 was wired in QA pass 2 with autonomy migrated.
  The other five `saveXxxSettings` paths (identity, security, daemon,
  terminal, hooks) still write only to localStorage.
- **Acceptance criteria.**
  - `saveIdentitySettings`, `saveSecuritySettings`, `saveDaemonSettings`,
    `saveTerminalSettings`, `saveHookSettings` each also call
    `state.fsUiSync?.saveValue('<domain>', value)` on save.
  - After save, the corresponding `~/.config/clawser/<domain>.json` file
    contains the new value.
  - Existing localStorage write keeps the panel functional during migration
    (no breakage).
- **Approach.**
  - For each of the 5 panels, locate the save handler and append a
    `state.fsUiSync?.saveValue(...)` call mirroring autonomy.
  - Save handlers live in `web/clawser-ui-config.js` and
    `web/clawser-ui-panels.js` — grep for `lsKey.identity`, `lsKey.security`
    etc. to find them.
- **Test plan.** Smoke tests are not strictly necessary (the bridge itself
  is already tested in `clawser-fs-e2e.test.mjs`). Optionally extend that
  file with one round-trip test per domain. Keep DOM-level tests out of
  scope; the helper API is what we're proving.
- **Effort.** S (~1 h, 5 panels × ~5-line edit).
- **Risk.** Low. Each migration is additive; localStorage path stays.
- **Dependencies.** None (Phase 7 bridge already wired in QA pass 2).

### A3. Wire mesh peer device files — read-write JSON  *(Shipped Done — 2026-05-02 follow-up)*

> **Closure status (2026-05-02):** Both directions wired.
> - Read: `discoveryManager.onPeerDiscovered`/`onPeerLost` events
>   register/unregister per-peer device files; reads return JSON metadata.
> - Write: `state.pod.sendMessage(peerId, envelope)` →
>   `peerNode.sendTo(pubKey, data)` looks up the active session and calls
>   `transportInstance.send(data)`. Throws "no active session" when the
>   peer is not connected (a strictly clearer error than the previous
>   "no send function wired").

- **What it is.** UFS §2.7 reserves `/dev/clawser/mesh/peers/{peerId}` for
  per-peer device files. Per user decision (2026-05-02), reads return
  peer metadata as JSON; writes accept a JSON message envelope and
  dispatch via the pod.
- **Acceptance criteria.**
  - New export `registerMeshPeerDevice(deviceHandler, peerId, pod)` in
    `clawser-fs-devices.mjs`.
  - **Read** (`cat /dev/clawser/mesh/peers/<peerId>`) returns a JSON
    object with: `{podId, status, lastSeen, capabilities?, lastMessage?}`.
  - **Write** (`echo '{"type":"ping","payload":"hi"}' > /dev/clawser/mesh/peers/<peerId>`)
    parses the JSON, dispatches via `pod.sendMessage(peerId, msg)` (or
    equivalent). Invalid JSON → throws with a useful error.
  - Documented write envelope: `{type: string, payload: any, timeout?: number}`.
    `type` is forwarded verbatim. Unknown types are passed through.
  - On peer connect, the workspace lifecycle registers a device; on
    disconnect, unregisters.
  - The write semantics are documented in `docs/unix-filesystem-architecture.md`
    §2.7 and a new test exercises the round trip.
- **Approach.**
  - Add `registerMeshPeerDevice` to `clawser-fs-devices.mjs` mirroring
    `registerProviderDevice`. Use `pod.sendMessage(peerId, msg)` for
    write. Maintain a small per-peer ring of inbound messages populated
    via the pod's existing message listener.
  - Add `addMeshPeerDevice(handler, peerId, pod)` /
    `removeMeshPeerDevice(handler, peerId)` helpers to
    `clawser-runtime.js`.
  - In the workspace-init-mesh module, subscribe to pod peer-add/peer-
    remove events and call the helpers.
- **Test plan.**
  - Unit tests in `clawser-fs-devices.test.mjs`: register a device with a
    mock pod, write JSON envelope, assert pod.sendMessage was called with
    parsed payload. Invalid JSON throws. Read returns the documented
    metadata shape. Inbound message updates `lastMessage`.
  - Update UFS §2.7 with the documented envelope schema.
- **Effort.** **M-L** (real device wiring + inbound listener + UFS doc).
- **Risk.** Pod's peer event API may differ across transports. Mitigation:
  use the highest-level pod method available (`onPeerConnect`/`onPeerDisconnect`)
  and document the envelope as the contract.
- **Dependencies.** None.

### A4. Wire hardware device files (`/dev/clawser/hardware/{name}`)

- **What it is.** `registerHardwareDevice` exists; `initDeviceFs` accepts a
  `hardwareAdapters: Map<string, adapter>` arg but no caller passes one,
  so `/dev/clawser/hardware/*` is empty.
- **Acceptance criteria.**
  - `createShellSession()` builds a `hardwareAdapters` map from
    `state.peripheralManager.listDevices()` and passes it to
    `initDeviceFs({ hardwareAdapters })`.
  - On a connected serial peripheral named `serial0`,
    `echo "AT+RST\n" > /dev/clawser/hardware/serial0` invokes
    `peripheral.write("AT+RST\n")`.
  - `cat /dev/clawser/hardware/serial0` returns the most recent inbound
    data.
  - When peripherals connect/disconnect at runtime, the device map updates.
- **Approach.**
  - In `clawser-workspace-lifecycle.js` `createShellSession`, before
    `initDeviceFs`, build a map by adapting each peripheral to the
    `{ write, read }` shape the device file expects.
  - Subscribe to `peripheralManager` connect/disconnect events to call
    `addHardwareDevice(handler, name, adapter)` /
    `deviceHandler.unregister(path)` — add a small `addHardwareDevice`
    helper to `clawser-runtime.js` (mirroring `addProviderDevice`).
- **Test plan.** Unit tests in `clawser-fs-devices.test.mjs` using the
  existing `createMockHardwareAdapter` helper. Verify add/remove cycle.
- **Effort.** S (~1-2 h).
- **Risk.** Low. PeripheralManager already exists.
- **Dependencies.** None.

### A5. Make `/etc/clawser/workspaces.json` the source of truth (one-time migration)

- **What it is.** UFS §2.2 declares the OPFS file is canonical. Per user
  decision (2026-05-02), the migration is: on first run, read
  localStorage once, write to OPFS, OPFS becomes source of truth.
  localStorage is a read-only fallback for one release.
- **Acceptance criteria.**
  - `loadWorkspaces()` is now async. On call: try OPFS first; on miss
    AND localStorage has data, copy localStorage → OPFS once and return
    that; on both miss, return the default workspace.
  - `saveWorkspaces()` writes only to OPFS.
  - `getActiveWorkspaceId()`/`setActiveWorkspaceId()` use
    `/etc/clawser/active-workspace`.
  - localStorage is read once per session (cached), never written by this
    module again.
  - Existing tests that exercise workspaces continue to pass.
- **Approach.**
  - `web/clawser-workspaces.js`: rewrite to async with OPFS read/write
    helpers using the shared OPFS layer.
  - Synchronous callers updated to await; if a synchronous fast-path is
    needed for early boot, prime an in-memory cache with the OPFS read
    at app init and let synchronous accessors hit the cache.
- **Test plan.**
  - One-time migration test: seed localStorage, call `loadWorkspaces`,
    assert OPFS contains the migrated data and second call doesn't
    re-read localStorage.
  - OPFS-only test: write workspaces.json, call loader, assert returns.
  - Save test: mutate, call save, assert OPFS file has new content and
    localStorage is unchanged.
- **Effort.** M (~3-4 h).
- **Risk.** **Medium.** Workspace registry is load-bearing — any boot-time
  regression locks users out. Async load from OPFS adds latency to the
  first paint of the workspace picker. Mitigated by a synchronous in-
  memory cache populated at app init.
- **Dependencies.** None.

### A6. Atomic snapshots — real tar implementation against OPFS  *(Shipped Done)*

> **Closure status (2026-05-02):** Tar writer/reader (`clawser-tar.mjs`,
> 17 tests). `SnapshotManager.createTarSnapshot/restoreTarSnapshot/
> listTarSnapshots/deleteTarSnapshot` write to OPFS. CLI now uses tar
> by default (cross-validation Round 1 caught the CLI still using legacy
> IDB; fixed). `snapshot list` merges both backends.


- **What it is.** UFS §2.4 specifies `~/.local/share/clawser/snapshots/{ts}.tar`.
  `clawser-snapshots.js` ships to IndexedDB. Per user decision (2026-05-02),
  implement real streaming tar to OPFS, not a doc fix.
- **Acceptance criteria.**
  - Snapshots are written as POSIX tar (USTAR) files to
    `~/.local/share/clawser/snapshots/{timestamp}.tar` in OPFS.
  - The tar contains the workspace's config files, memories, goals,
    skills metadata, conversation events, and checkpoints — same coverage
    the IDB snapshot has today.
  - Restore reads a tar, validates entries, and writes them back.
  - List/delete operate on tar files.
  - Existing IDB snapshots either continue to work (read-only) or there is
    a one-time migration path documented.
- **Approach.**
  - New `web/clawser-tar.mjs` — pure-JS POSIX tar writer/reader, streaming,
    no external dependency. (fflate has gzip but its tar story is not
    widely supported in the version pinned at index.html.) USTAR header
    is fixed-width; not large.
  - Update `web/clawser-snapshots.js` to use the tar module and write to
    OPFS via `ShellFs`/`MountableFs` rather than IDB. Keep IDB read path
    behind a feature flag for one release so existing snapshots remain
    viewable.
  - `clawser-snapshot-cli.js` builtin updated to operate on the new
    paths.
- **Test plan.**
  - Unit tests for the tar writer/reader: round-trip a small fileset,
    verify USTAR magic, octal field encoding, 512-byte block padding,
    end-of-archive marker.
  - Integration test: snapshot, delete a workspace file, restore from
    snapshot, verify the file is back.
- **Effort.** **L** (full day; real tar parser is finicky).
- **Risk.** Medium. Tar field encoding is unforgiving. Browsers' OPFS
  large-file performance is not great — chunked writes needed for any
  archive with many files.
- **Dependencies.** None.

### A7. Tab completion (shell)

- **What it is.** The terminal has no tab completion for builtins or paths.
  TODO comment exists at `clawser-shell.js:1213`.
- **Acceptance criteria.**
  - Pressing `Tab` in the terminal panel completes the current word against
    builtin command names; second tab cycles or shows candidates.
  - Pressing `Tab` after a path-like fragment completes against `fs.listDir`.
  - No regressions in existing terminal input handling.
- **Approach.**
  - Add a `getCompletions(input, cursor, fs)` async helper to
    `clawser-shell.js` that returns `[prefix, suggestions[]]`.
  - In `clawser-ui-panels.js` (terminal input handler), bind Tab to call
    this and update the input value.
- **Test plan.** Unit tests for `getCompletions`: builtin completion,
  path completion, partial-prefix matching, no-matches behaviour.
- **Effort.** M.
- **Risk.** Low. UI keystroke handling can interact with adapter modes
  (custom-dom vs wterm); need to ensure tab-key isn't swallowed by wterm.
- **Dependencies.** None.

### A8. Vault recovery codes

- **What it is.** No recovery if user forgets passphrase. TODO at
  `clawser-vault.js:251`.
- **Acceptance criteria.**
  - Vault create flow generates a one-time recovery code (e.g. 8-word
    BIP-39-style mnemonic), shows it once, and stores an
    encrypted-with-recovery-code copy of the master key alongside the
    passphrase-encrypted copy.
  - "Forgot passphrase" UI accepts the recovery code, decrypts the master
    key, and lets the user set a new passphrase.
  - Lost recovery code does not give an attacker access (still needs the
    code or passphrase).
- **Approach.**
  - Generate code via `crypto.getRandomValues` + word-list encoding.
  - Derive a key from the recovery code (PBKDF2, same iteration count) and
    encrypt the master key with it; store ciphertext alongside the
    passphrase-encrypted version.
  - Add `recoverWithCode(code, newPassphrase)` to `SecretVault`.
  - UI changes: vault-create dialog displays the code with a "Copy" /
    "I've saved it" gate; vault-lock screen gets a "Forgot passphrase"
    flow.
- **Test plan.** Unit tests for the round-trip (create with code, recover
  with code, set new passphrase, unlock with new passphrase).
- **Effort.** M-L (~half to full day).
- **Risk.** **High.** Touches the security boundary. Adds a second
  unwrap-key path; if the encryption is wrong, attacker has a free way in.
  Strongly recommend a security review of the design before/after.
  Word-list choice (BIP-39 vs custom) deserves discussion.
- **Dependencies.** None.

### A9. Update DID encoding to W3C multicodec compliance

- **What it is.** TODO at `clawser-mesh-identity.js:444` — current
  `did:key:z<podId>` is MVP, not the proper base58btc multicodec.
- **Acceptance criteria.**
  - `did:key:` outputs match the W3C did:key spec (multicodec prefix +
    base58btc).
  - Existing pod identities continue to function (backward compatibility
    or migration path).
- **Approach.** Add multicodec prefix bytes (e.g. `0xe7` for ed25519-pub
  or `0x12 0x00` depending on key type) and switch the encoding from
  whatever's there now to base58btc. Probably ~30 lines.
- **Test plan.** Unit tests asserting fixed-input → fixed-output for
  known key vectors.
- **Effort.** S.
- **Risk.** **Medium.** Changes the canonical podId format on the wire.
  Existing peers may not recognise new IDs and vice versa. Need a
  compatibility window or a versioned prefix.
- **Dependencies.** None.

---

## B. Mesh Wiring (Browsermesh specs that self-tag "not wired")

The browsermesh specs explicitly tag five modules as "Implemented, not wired
to app bootstrap". The wiring point in every case is `ClawserPod.initMesh()`
in `web/clawser-pod.js`. They share an effort/risk profile.

### B1. Wire `MeshNameResolver` (NamingService)

- **What it is.** `clawser-mesh-naming.js` exports `NameRecord` and
  `MeshNameResolver`. Spec `name-resolution.md` says: "Instantiated only
  in tests."
- **Acceptance criteria.**
  - `ClawserPod.initMesh()` constructs a `MeshNameResolver` and stores it
    on the pod instance (e.g. `this.#nameResolver`).
  - Existing tests still pass.
  - At least one production codepath uses `nameResolver.resolve(name)` —
    if no callsite is obvious, define one in a follow-up. (For wiring
    alone, instantiation suffices to flip "not wired" → "wired but
    unused.")
- **Approach.** Mirror `ServiceDirectory` instantiation pattern in
  `initMesh`.
- **Test plan.** Add a test that boots a pod, asserts
  `pod.nameResolver` is defined and is an instance of `MeshNameResolver`.
- **Effort.** XS.
- **Risk.** Low for instantiation. Caveat: instantiating without a
  consumer means we add a tracked-but-idle subsystem. Acceptable for the
  audit goal of "no module is unreachable from boot," but the user should
  know it's a half-step until a real caller exists.
- **Dependencies.** None.

### B2. Wire `MigrationEngine`

- **What it is.** `clawser-mesh-migration.js` exports `MigrationEngine`,
  `MigrationPlan`, `MigrationStep`, `Checkpoint`, `DualActiveWindow`.
- **Acceptance criteria.** Same shape as B1 — instantiate in initMesh,
  expose as `pod.migrationEngine`.
- **Approach.** Same pattern.
- **Test plan.** Same.
- **Effort.** XS.
- **Risk.** Same caveat as B1 — instantiated but currently no migration
  flow triggers it.
- **Dependencies.** None.

### B3. Wire `MeshRelayClient`

- **What it is.** `clawser-mesh-relay.js` exports `MockRelayServer` and
  `MeshRelayClient`.
- **Acceptance criteria.** When `opts.relayUrl` is configured,
  `initMesh` constructs a `MeshRelayClient` and connects it.
- **Approach.** Already partially done — `RelayStrategy` is added to
  `DiscoveryManager` when `relayUrl` is set. Add explicit
  `MeshRelayClient` construction next to it.
- **Test plan.** Mock the relay URL and assert client construction +
  initial connect attempt.
- **Effort.** S.
- **Risk.** Low.
- **Dependencies.** None.

### B4. Wire `AppRegistry` / `AppStore` (App distribution)

- **What it is.** `clawser-mesh-apps.js` exports `AppManifest`,
  `AppInstance`, `AppPermissionChecker`, `AppRegistry`, `AppStore`,
  `AppRPC`, `AppEventBus`. Spec: "Implemented, not wired."
- **Acceptance criteria.** `initMesh` constructs `AppRegistry` and
  `AppStore`. Existing apps panel UI (if any) reads from the registry.
- **Approach.** Same pattern as B1; note `AppStore` might need an OPFS
  storage backend to be useful — check before instantiating.
- **Test plan.** Boot test asserts `pod.appRegistry` exists.
- **Effort.** S.
- **Risk.** Low for instantiation; may surface need for storage wire-up
  before it's actually useful.
- **Dependencies.** None.

### B5. Wire voting protocol explicitly

- **What it is.** Spec `voting-protocol.md`: "Implemented, not wired."
  The actual class is in `clawser-mesh-consensus.js` already (since
  voting is part of PBFT). The unwired part is whatever standalone
  voting helper the spec refers to.
- **Acceptance criteria.** Identify the specific exported class the spec
  meant; either wire it or update the spec to point at
  `ConsensusManager`.
- **Approach.** Re-read `voting-protocol.md` carefully against
  `clawser-mesh-consensus.js`. If consensus already covers it, the spec
  is the gap, not the code — doc fix.
- **Test plan.** Depends on outcome.
- **Effort.** S (probably a doc fix).
- **Risk.** Low.
- **Dependencies.** None.

---

## C. Mesh Production-Hardening (Phase 11 from ROADMAP.md)

These are explicit `[ ]` items in `ROADMAP.md` Phase 11. They are larger
than wirings — real new behaviour.

### C1. Peer type taxonomy in discovery records

- **What it is.** Discovery records currently lack a `peerType` field.
  Routing is uniform. Phase 11 wants `chat` / `runtime` / `host-shell` /
  `vm-compute` distinctions used by routing policies.
- **Acceptance criteria.**
  - `DiscoveryRecord` has a `peerType` field; `DiscoveryManager` advertises
    it.
  - UI shows peer types on the peer panel.
  - At least one routing decision (e.g. compute jobs) consults the type.
- **Approach.** Schema change in `clawser-mesh-discovery.js`, plus
  consumer updates.
- **Test plan.** Unit tests on routing decisions; UI snapshot of peer
  list with type badges.
- **Effort.** M.
- **Risk.** **Medium.** Schema change to `DiscoveryRecord` is a wire-
  format adjacent change. Older peers without the field need a defined
  default (`unknown` is fine). May require a versioned record format.
- **Dependencies.** None.

### C2. WebRTC reliability hardening

- **What it is.** Phase 11: reconnection, ICE restart, TURN fallback.
- **Acceptance criteria.**
  - `WebRTCPeerConnection` retries on close with exponential backoff.
  - On ICE failure, `restartIce()` is called.
  - When STUN-only fails, the pod falls back to a configured TURN server.
  - Tests exercise each path.
- **Approach.** Edit `clawser-mesh-webrtc.js` to add lifecycle hooks for
  ICE state transitions. Add config field for TURN credentials.
- **Test plan.** Unit tests with mocked RTCPeerConnection in different
  ICE states.
- **Effort.** L.
- **Risk.** Real WebRTC behaviour is hard to test reliably from Node;
  Playwright integration tests may be needed.
- **Dependencies.** None.

### C3. WebTransport end-to-end

- **What it is.** Phase 11: "currently bridged, not end-to-end."
- **Acceptance criteria.** A pod can establish a WebTransport session to
  a peer that supports it without going through a relay.
- **Approach.** Audit `clawser-mesh-webtransport.js` for the current
  bridge pattern; identify the relay hop; remove it for direct peers.
- **Effort.** L. Needs a real WebTransport-capable test target.
- **Risk.** **High.** WebTransport browser support is uneven; native
  servers are still maturing. Likely needs scoping with the user.
- **Dependencies.** None — but flagged for Batch 3.

### C4. Group encryption — per-member key envelope

- **What it is.** Phase 11: currently metadata-only distribution.
- **Acceptance criteria.** Group keys are wrapped with each member's
  public key and distributed in an envelope; each member unwraps with
  their private key.
- **Approach.** `clawser-mesh-group-keys.js` changes; key rotation hooks.
- **Effort.** L.
- **Risk.** **High** (security-sensitive). Scoping discussion needed.
- **Dependencies.** None — flagged for Batch 3.

### C5. PBFT end-to-end with real validator sets

- **What it is.** Phase 11: "currently opt-in stub" per RM. Code says
  it's wired through ClawserPod, but full validator-set production
  deployment is not done.
- **Acceptance criteria.** Define what "real validator set" means in
  the clawser context (probably: a configurable set of pods opt-in to
  consensus, signed proposals, byzantine-fault tolerance up to f<n/3).
- **Approach.** Significant scoping required.
- **Effort.** XL.
- **Risk.** **Very high.** Distributed consensus is a research-grade
  topic; getting it production-ready needs a dedicated effort.
- **Dependencies.** None — Batch 3 / scoping discussion.

### C6. Payment channels — settlement on close + escrow timeout

- **What it is.** Phase 11: "currently local-only accounting."
- **Acceptance criteria.** Closing a channel triggers a settlement
  transaction (definition of "transaction" is the open question — chain?
  signed receipt?). Escrow timeouts are enforced via the scheduler.
- **Effort.** XL.
- **Risk.** **Very high.** Touches the financial layer and depends on
  decisions about the broader rollup/economics design (see G4).
- **Dependencies.** Probably blocked on the rollup decision — Batch 3.

### C7. Mesh observability — health dashboard, distributed tracing,
        alert rules

- **What it is.** Phase 11 lists three observability items (`[ ]`).
- **Acceptance criteria.** Health dashboard panel renders peer
  latency/throughput/connection. Tracer events propagate across hops.
  Configurable alert rules for peer disconnection, consensus timeout,
  payment dispute.
- **Effort.** L per item, three items total.
- **Risk.** Medium. Cross-hop tracing requires a wire format change for
  trace context propagation.
- **Dependencies.** Trace propagation depends on C1's wire-format
  evolution discipline.

### C8. Remote peers as deployment targets (push code/skills) — **CLOSED 2026-05-03**

- **What it is.** Phase 11: "[ ] Remote peers become first-class
  deployment targets (push code/skills to a peer)."
- **Status.** End-to-end shipped 2026-05-03 across the multi-device
  deploy completion pass. Acceptance criteria met:
  - **Push** — `publishDeploy({items, targetPubKey, signingKey,
    sourceDid, pod, manifestExtras})` in
    `web/clawser-deploy-publish.mjs`. Builds + signs + sends via
    `pod.sendMessage`. Fan-out variant available
    (`publishDeployToAll`).
  - **Receive + verify** — `pod.onMessage` dispatcher routes
    `{type:'deploy'}` envelopes to `acceptPackage`, which verifies
    the signature against the source's `did:key:` public key
    (resolved via `web/clawser-did-key.mjs`), enforces the replay
    counter, checks the `deployAcl`, and either fast-tracks against
    a previously approved manifest fingerprint or prompts via the
    `clawser-approval-modal.mjs`.
  - **Store and (with permission) activate** — `applyTransport` in
    `web/clawser-deploy-apply.mjs` provides per-kind handlers:
    skills → `SkillStorage.writeSkill`, configs → `writeConfig`
    gated on `manifest.capabilities.config[]`, memory →
    `state.agent.memoryStore` gated on `capabilities.memory[]`.
    Skills and configs become live on the target without any
    further user action.
  - **Audit + rollback** — every accept/reject/apply event lands
    in the per-workspace audit log; pre-deploy snapshots enable
    one-click rollback via the trusted-publishers panel.
  - **UI** — Settings → My Devices + Trusted Publishers, mounted
    via `clawser-multi-device-panels.mjs`, with reactive
    re-render on `state.pairedDevices` mutations and a strictly
    declarative item picker (no magic capability inference).
  - **End-to-end verification** —
    `web/test/clawser-multi-device-e2e.test.mjs` proves the full
    round-trip through production code with three test cases
    (happy, untrusted, denied).
- **Effort.** Closed across two passes (2026-05-03 base + 2026-05-04
  Track 3 follow-ups + 2026-05-03 completion pass).
- **Test count.** ~135 new tests across the multi-device deploy
  effort (paired-devices 21 + controllers 19 + panels 11 + picker
  ~10 + e2e 3 + plus the earlier track 3 batch).
- **Reference.** `docs/multi-device-deploy.md`,
  `guide/multi-device.md`.

### C9. Native messaging for system tools

- **What it is.** Phase 12: "Native messaging for system tools (extension
  + local binary)."
- **Acceptance criteria.** The clawser-browser-control extension talks
  to a locally-installed native host binary that exposes system-level
  tools (run commands, access local files outside OPFS, etc.).
- **Effort.** XL. Needs an extension change *and* a local binary build
  pipeline.
- **Risk.** High. Crosses the browser sandbox.
- **Dependencies.** Lives in the `clawser-browser-control` standalone
  repo per RM Phase 10. Out of scope for this repo's audit.

---

## D. RPC / CLI Polish

### D1. Add `--stdio` and `--http` RPC transports

- **What it is.** CLI plan #2 promised three transports: stdin/stdout,
  Unix socket, HTTP. Only Unix socket shipped.
- **Acceptance criteria.**
  - `clawser rpc --stdio` reads JSON-RPC requests from stdin, writes
    responses to stdout.
  - `clawser rpc --http :8422` binds an HTTP server on localhost (default
    bind 127.0.0.1; warns on 0.0.0.0).
  - Both share the method registry already used by the socket transport.
- **Approach.** Extend `clawser-rpc.mjs` with two more transport
  modules. The socket transport already factored the method registry
  out; reuse.
- **Test plan.** New tests covering the two transports with a single
  JSON-RPC ping/pong round-trip each.
- **Effort.** M.
- **Risk.** Low for stdio. HTTP transport adds an attack surface — auth
  token flow needs to be implemented (the plan calls for a bearer token
  printed to stderr on startup).
- **Dependencies.** None.

### D2. General hot-reload (beyond skills)

- **What it is.** CLI plan #4: hot-reload arbitrary extensions, not just
  skills.
- **Acceptance criteria.** Editing a tool definition or extension JS file
  while running causes it to be re-registered.
- **Effort.** M-L.
- **Risk.** Medium. Re-registering tools mid-run can leak state from
  the old version.
- **Dependencies.** None.

---

## E. Daemon / Service Worker

### E1. SW wake-on-message from relay/signaling

- **What it is.** RM Phase 12: "[ ] Wake-on-message from relay/signaling
  server." Code already has periodicSync wake; this is the
  message-triggered variant.
- **Acceptance criteria.**
  - When a pod receives a high-priority message via signaling and the
    main thread is sleeping, the SW wakes and either runs the agent or
    posts a notification.
- **Approach.** Extend `clawser-sw-heartbeat.js` to handle a `wake`
  message type from signaling; route to `clawser-background-runner.js`.
- **Effort.** M.
- **Risk.** Medium. SW lifetime semantics differ across browsers.
- **Dependencies.** Requires a signaling client running in the SW or
  via `chrome.runtime` for the extension path.

### E2. Scheduled task execution in daemon mode

- **What it is.** RM Phase 12: `[ ] Scheduled task execution in daemon
  mode`.
- **Acceptance criteria.** Routines fire at their scheduled time even
  when no tab is open.
- **Approach.** Today, `clawser-background-runner.js` reads routine
  state from IDB on SW wake; verify whether all trigger types
  (cron/event/webhook) actually fire from the SW path. If not, fix.
- **Effort.** M.
- **Risk.** Low to medium. Largely an audit + fix-the-gap exercise.
- **Dependencies.** Some overlap with E1.

---

## F. Provider / Tooling Polish

### F1. Real channel API credentials

- **What it is.** OUTSTANDING 5.3 — out-of-the-box channels work only
  with user-supplied credentials.
- **Acceptance criteria.** Each channel plugin documents its credential
  fields; the auth-profiles UI offers them as a connection.
- **Approach.** Mostly documentation + UI form fields. The plumbing is
  already there.
- **Effort.** S per channel × 7 channels.
- **Risk.** None.
- **Dependencies.** None.

### F2. Skills marketplace backend (agentskills.io)

- **What it is.** OUT 5.2 — front-end client exists; a public registry
  is third-party.
- **Effort.** XL — out of scope for this repo (requires a separate
  service deployment and domain).
- **Status.** Defer. Not implementable in this repo.

### F3. PWA install flow refinement (mobile)

- **What it is.** RM Phase 12 `[ ]`.
- **Acceptance criteria.** Mobile browsers (Safari iOS, Chrome Android)
  show a polished install prompt and the installed app behaves
  correctly.
- **Effort.** M.
- **Risk.** Low.
- **Dependencies.** None.

### F4. iOS Safari compatibility audit

- **What it is.** RM Phase 12 `[ ]`. WebRTC, BroadcastChannel, OPFS all
  have iOS Safari quirks.
- **Acceptance criteria.** A pass/fail matrix per Web API, with shims or
  graceful degradation for the failing ones.
- **Effort.** L (pure audit, plus shim work).
- **Risk.** Low.
- **Dependencies.** Need access to an iOS Safari testbed.

---

## G. Standalone Tooling

### G1. Wire `TunnelManager` into production

- **What it is.** `clawser-tunnel.js` `TunnelManager`, `CloudflareTunnel`,
  `NgrokTunnel` are fully implemented but never instantiated in
  production.
- **Acceptance criteria.**
  - `state.tunnelManager` exists on workspace init when OAuth/remote
    panel is opened.
  - Cloudflare and ngrok providers are registered.
  - The "Remote Access Gateway" UI panel exposes tunnel start/stop.
- **Approach.** Instantiate in `clawser-app.js` or
  `clawser-workspace-lifecycle.js`. The UI panel already exists per
  RMA Block 15; verify its bindings.
- **Test plan.** Tests already cover the providers individually; add
  a small smoke test that exercises `TunnelManager.connect("cloudflare", port)`
  with a stubbed `exec`.
- **Effort.** S.
- **Risk.** Low.
- **Dependencies.** None.

### G2. Kernel extraction to standalone npm

- **What it is.** RM Phase 12 `[ ]`. Today the kernel is `web/packages/kernel/`
  internal; the rest of the packages have been extracted.
- **Acceptance criteria.** A new `browsermesh-kernel` npm package is
  published; the internal `web/packages/kernel/` directory becomes a
  bridge re-exporting from npm.
- **Effort.** L. Out-of-repo work needed (npm publishing, repo creation).
- **Risk.** Process risk (the publishing pipeline). Code risk is low
  because the kernel is already package-shaped.
- **Dependencies.** None inside this repo. Flag for Batch 3.

### G3. Kernel tenants from ServerPod (Node.js)

- **What it is.** RM Phase 12 `[ ]`.
- **Acceptance criteria.** A Node-side ServerPod can call
  `Kernel.createTenant()` with the same surface as the browser.
- **Effort.** L.
- **Risk.** Medium. The kernel has Web-only assumptions (e.g. crypto,
  Web Locks); ServerPod runs in Node where those have polyfill paths.
- **Dependencies.** Cleaner if G2 (extraction) is done first so both
  consumers depend on the npm package, not the in-tree path.

### G4. Phase 9 v86 guest UI + auto-mount activation

- **What it is.** Today `autoMountGuest` exists but no UI creates a
  `LinuxGuest` instance.
- **Acceptance criteria.**
  - There is a "Guest Filesystem" panel button (or similar) that boots a
    `LinuxGuest`, calls `autoMountGuest(guest, state.workspaceFs)`, and
    displays the guest filesystem at `/mnt/guest`.
  - Closing the guest unmounts cleanly.
- **Approach.** Wire up `renderGuestFsPanel` (already exported in
  `clawser-ui-guest-fs.mjs`) into the workspace panel index. Add a
  "Boot Guest" button. Construct the guest. Call `autoMountGuest`.
- **Effort.** M.
- **Risk.** Medium. v86 boot is heavyweight — disk image hosting,
  memory budget, browser performance. The user may not want this
  surfaced in the main app yet.
- **Dependencies.** None inside the repo.

---

## H. Big Design Items (Batch 3 — scoping discussion required)

These are not auto-implementable. For each, I give a recommendation on
whether to do it at all and what the smallest meaningful slice would be.

### H1. `.reference/mesh-rollup-plan.md` — PBFT-sequenced rollup

- **What it is.** A design for a P2P-mesh-based rollup where browser
  peers collectively sequence transactions, settle to Ethereum L1, and
  publish data to Celestia. ~1k LOC plan, zero code.
- **One-paragraph read.** This is a research-grade undertaking. It
  bundles three serious unsolved problems (browser-friendly PBFT, on-
  chain settlement bridging, data-availability layer integration) into
  a single feature. The clawser repo does not currently need a rollup
  to deliver any user-facing functionality — it would unlock
  micropayments and trustless coordination, which are interesting but
  speculative. Doing this end-to-end is a multi-month effort with real
  validator coordination, on-chain costs, and security risk. **I would
  not recommend starting it now.** If the user wants any of the
  underlying capabilities (tamper-evident logs, micropayments,
  consensus), the existing `clawser-mesh-audit.js`,
  `clawser-mesh-payments.js`, and `clawser-mesh-consensus.js` already
  give 80% of the value at 5% of the cost.
- **Smallest meaningful slice.** If the user does want to pursue
  rollup-style coordination, the smallest useful first step is
  signed-receipt settlement on payment channel close (item C6) plus
  an audit-chain rooting service that checkpoints `clawser-mesh-audit.js`
  to a public bulletin board (could be IPFS, could be an L1
  contract). That gives "tamper-evident, externally-verifiable audit
  history" without the rollup machinery.

### H2. `unix-filesystem-architecture.md` §22-34 — wnix v0.1-v0.4

- **What it is.** A speculative roadmap for a wnix OS-in-browser:
  syscalls (25-30), VFS, process model, async syscall, Worker
  "processes", message-based IPC, partial fork() emulation, Rust
  microkernel variant. Spans 13 sub-items in the ledger, all "Not
  started", all design-only.
- **One-paragraph read.** This is the most speculative material in the
  repo. It would turn clawser from "a browser AI agent" into "a
  browser-native operating system." That's a different product. The
  Phase 0-9 Unix FS architecture (which is shipped) already gives users
  the user-facing "everything is a file" experience without needing a
  syscall layer underneath. The wnix sections feel like notes from a
  design conversation that escaped into the docs. **I'd recommend
  moving §22-34 to `.reference/wnix-design-notes.md`** with a note that
  these are aspirational and not on the roadmap. Keeping them in
  `unix-filesystem-architecture.md` makes it look like commitments.
- **Smallest meaningful slice.** If there is a real product reason to
  pursue any wnix idea, the highest-value one is a uniform `/proc/`
  schema that exposes kernel internals (we have most of this already
  via Phase 8). Everything else (real syscalls, Workers as processes,
  fork emulation) requires breaking changes the rest of the codebase
  isn't asking for.

### H3. `.reference/suarez-inspired-ideas.md` — 25 future ideas

- **What it is.** Inspirational list, not a commitment.
- **Recommendation.** Leave in `.reference/`. No closure plan needed.

### H4. `.reference/webroll-package-design.md`

- **What it is.** Design notes for a package format.
- **Recommendation.** Leave in `.reference/`. No closure plan needed.

### H5. Remaining wnix-adjacent items

- Bytecode format for clsh scripts — `Not started`. Recommend defer.
- ELF-to-WASM — `Not started`. Defer.
- Service Workers as wnix init — `Not started`. Defer.
- sqlite-in-wnix benchmark — `Not started`. Defer.
- Coreutils port strategy — `Not started`. clsh has its own
  `ls`/`cat`/etc.; coreutils ports would be redundant. Defer.
- Rust microkernel variant — `Not started`. Defer.

### H6. Guest-Native `wsh-server` (Model B)

- **What it is.** RM:151 — explicit "Not started". Run a native
  `wsh-server` inside a browser-hosted Linux guest, instead of routing
  via the VM-console adapter.
- **Recommendation.** Real product reason needed before starting (per
  the roadmap's own entry criteria). Defer pending product signal.

---

## Batches

### Batch 1 — Wirings + foundational items

Mostly additive. A6 was scoped up to L (real tar) per user decision.

| ID | Item | Effort |
|----|------|--------|
| A1 | Wire `injectEnvIntoShell` | XS |
| A2 | Wire `state.fsUiSync` for the remaining 5 panels | S |
| A4 | Wire hardware device files (`/dev/clawser/hardware/*`) | S |
| B1 | Wire `MeshNameResolver` into initMesh | XS |
| B2 | Wire `MigrationEngine` into initMesh | XS |
| B3 | Wire `MeshRelayClient` into initMesh | S |
| B4 | Wire `AppRegistry` / `AppStore` into initMesh | S |
| B5 | Resolve voting-protocol spec/code mismatch | S |
| G1 | Wire `TunnelManager` into production | S |
| A6 | Real tar snapshots to OPFS | L |

Total estimated effort: ~10-14 hours (was ~6-8 before A6 scope-up).

### Batch 2 — Contained features

A3 was scoped up to M-L per user decision (read-write JSON envelope).

| ID | Item | Effort |
|----|------|--------|
| A3 | Mesh peer device files (read-write JSON) | M-L |
| A5 | Workspaces.json one-time migration | M |
| A7 | Tab completion (shell) | M |
| A9 | DID encoding W3C compliance | S |
| C1 | Peer type taxonomy in discovery | M |
| D1 | RPC `--stdio` and `--http` transports | M |
| F3 | PWA install flow refinement | M |

Total estimated effort: ~14-18 hours.

### Batch 3 — Needs discussion / scoping (do NOT implement without user sign-off)

| ID | Item | Reason |
|----|------|--------|
| A8 | Vault recovery codes | Security boundary; design choice on word list and key wrapping |
| C2 | WebRTC reliability hardening | Real-WebRTC test infra needed |
| C3 | WebTransport end-to-end | Browser/server support uneven |
| C4 | Group encryption per-member envelope | Crypto design needs review |
| C5 | PBFT end-to-end with validators | XL research-grade |
| C6 | Payment channel settlement + escrow | Depends on rollup decision |
| C7 | Mesh observability (3 sub-items) | Wire-format change needed |
| C9 | Native messaging for system tools | Cross-repo (extension + local binary) |
| D2 | Hot-reload arbitrary extensions | State leak risk |
| E1 | SW wake-on-message | Cross-browser SW lifetime |
| E2 | Scheduled task execution in daemon mode | Audit + fix |
| F1 | Real channel API credentials | 7 channels × per-channel docs |
| F4 | iOS Safari compatibility audit | Needs iOS testbed |
| G2 | Kernel extraction to standalone npm | Out-of-repo work |
| G3 | Kernel tenants from ServerPod (Node) | Depends on G2 |
| G4 | v86 guest UI + auto-mount activation | Heavy; product decision |
| H1 | Mesh-native rollup | XL research; recommendation: skip |
| H2 | wnix v0.1-v0.4 | Recommendation: move §22-34 to `.reference/` |
| H3 | Suarez ideas | Inspirational; leave in `.reference/` |
| H4 | Webroll package design | Leave in `.reference/` |
| H5 | wnix-adjacent (bytecode/ELF/SW init/sqlite/coreutils/Rust kernel) | Defer |
| H6 | Guest-Native wsh-server (Model B) | Per roadmap entry criteria |

### Defer / out-of-scope

| ID | Item | Why |
|----|------|-----|
| F2 | Skills marketplace backend (agentskills.io) | Requires separate service + domain |
| Suarez ideas / Webroll | Inspirational reference docs | Not commitments |

---

## Open Questions for the User

Before kicking off Batch 1, two minor decisions worth confirming:

1. **A6 (snapshot tar vs IDB):** OK to fix this with a doc change rather
   than reimplementing snapshots in tar format?
2. **Migration semantics for A5 (workspaces.json):** existing users have
   localStorage state. Bias toward "read both, prefer OPFS, write to
   both" for at least one release before localStorage becomes a backup-
   only mirror?

For Batch 2, one design question:

3. **A3 (mesh peer device files):** is the per-peer write-to-send
   semantic actually useful given the mesh tools (`mesh_send`,
   `peer_send`) already in the agent toolkit? If not, the cheaper move
   is to update UFS §2.7 to drop the promise and not implement
   anything. That flips this from M to XS.

Once you've reviewed, tell me which batches to run.
