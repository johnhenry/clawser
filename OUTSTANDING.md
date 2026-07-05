# Clawser — Outstanding Work

> Last updated 2026-07-05 ("finish everything off" comprehensive pass).
> **9,732 tests passing, 0 failing — full suite (`npm test`, all groups
> incl. the new stress suite) verified green.**
>
> 2026-07-05: closed every item shipped in this session's second pass —
> 8 small UX/wiring fixes, 2 verification audits, 5 medium features
> (quota guard, output redaction, escrow sweeper, daemon audit, v86
> activation), all 8 mesh Phase 11 hardening items including the risky
> SwarmCoordinator multi-swarm refactor (82 pre-existing tests pass
> unmodified — backward-compat proof), a new concurrency stress suite,
> npm publish prep for two packages (found and fixed a real blocker: the
> kernel package's name was already taken on the registry), and channel
> setup docs (found and documented a real Slack limitation: no public
> webhook endpoint for its Events API from a browser tab alone). Also
> closed several stale entries left unchecked from earlier audit rounds
> after this session's own earlier work had already fixed them.
> Along the way: fixed a real, reproducible test hang (not the
> environmental flake it looked like at first) —
> `clawser-sprint19.test.mjs` leaked `AgentBusyIndicator`'s keepalive
> timer in 3 tests, same missing-cleanup bug already fixed in
> `clawser-daemon.test.mjs` earlier but never checked elsewhere; also
> fixed a genuine escrow-sweeper timer leak on workspace switch found
> while wiring mesh health metrics. See CHANGELOG [Unreleased] for the
> full list.
>
> 2026-07-04: the uncommitted 2026-05-04 session (~30K lines:
> multi-device, deploy system, vault v2, passkeys, presence, Y.js
> sync, PWA install, redaction — everything referenced below) was
> found sitting in a git worktree, committed, and merged into main.
> Same pass closed: .env loading wiring, MOTD display, EventLog
> rotation to /var/log/clawser (design §2.5), writable
> /sys/kernel/trace, vault recovery codes (on v2 wraps),
> ClawserShell.complete(), reactive-config content-hash dedupe,
> channel-device gateway fallback. See CHANGELOG [Unreleased].
> Privacy fix shipped: EventLog tool-arg redaction module
> (`web/clawser-redaction.mjs`) wired into all 5 agent
> `eventLog.append('tool_call', ...)` sites. Migration on restore
> scrubs legacy entries. Per-tool `redactedFields` declaration +
> regex fallback (defense-in-depth). 19 new tests.
>
> Round 2 verified all state migrations (workspace localStorage→
> OPFS, vault v1→v2, tar/IDB snapshot fallback, /home/<name>
> alias) are robust and idempotent. Round 3 verified perf hot
> paths are clean. Round 4 verified Safari/iOS Safari compat —
> all browser APIs feature-detected with documented fallbacks.
>
> 3 design-level items surfaced: (1) vault corruption has no UI
> reset path, (2) OPFS quota has no eviction policy, (3) tool
> result OUTPUT redaction not yet implemented. See
> `docs/comprehensive-audit-2026-05-04.md`.
>
> Earlier:
> Security pass landed 2 HIGH-severity fixes: XSS via marked
> sanitization gap in agent message rendering; OAuth callback
> handler accepting any origin. Plus 2 MEDIUM (signature error
> handling, skill filename traversal defense) and 1 leak fix
> (DelegateManager retain cap).
>
> Earlier:
> Race + timer audit: 4 contained fixes (agent picker setTimeout
> race; codex sandbox sleep-poll → Promise single-flight; vault
> unlock single-flight guard; file-watcher poll overlap guard).
> Confidence: ~96%. See `docs/race-and-timer-audit-2026-05-04.md`.
>
> Prior pass — all three structural items closed:
> - **Relay transport** — production WebSocket path implemented;
>   `MeshRelayClient` now actually connects to `relayUrl` (was
>   mock-only). 6 WS-mode tests using a paired-WS fixture.
> - **Orphan classes** — `AgentBusyIndicator` completed (receive
>   side wired, peer-state map, subscribe API); `CrossTabToolBridge`
>   deleted as unused.
> - **Agent-turn-during-cleanup race** — `agent.awaitRun()` added
>   and `cleanupWorkspace` now waits 5s for in-flight turns before
>   destroying state.
>
> See `docs/residual-audit-round2-2026-05-04.md` for the audit that
> surfaced these, and prior `docs/residual-audit-2026-05-04.md`,
> `docs/panel-convergence-2026-05-04.md`, `docs/panel-audit-2026-05-04.md`.
>
> Earlier references:
> `docs/implementation-status.md` for the authoritative ledger,
> `docs/gap-closure-plan.md` for what's been planned and shipped,
> `docs/cross-validation-2026-05-02.md` for the test-runner fix,
> `docs/VAULT.md` for the wrapped-DEK vault model,
> `docs/DEPLOY.md` for the deploy / multi-device sync system,
> `docs/issue-triage-2026-05-04.md` for the earlier triage,
> `docs/bug-hunt-2026-05-04.md` for the targeted bug-hunt findings,
> `docs/guide-expansion-2026-05-04.md` for the guide-page updates,
> `docs/workspace-restructure-verification-2026-05-04.md` for the
> per-lifecycle-event verification of the `/home/<name>` work,
> `docs/multi-device-deploy.md` for the multi-device wiring status
> (now end-to-end shipped: paired-devices registry, controllers,
> mounted panels, item picker, and a full E2E round-trip test), and
> `guide/multi-device.md` for the user-facing walkthrough.

---

## Surfaced 2026-05-08 (comprehensive audit Rounds 2-4)

- [x] **Tool result OUTPUT redaction.** Closed: `BrowserTool` gained
      `get redactedResultFields()`; `redactEvent()` in
      `clawser-redaction.mjs` extended to redact `tool_result.data.result`
      when it's an object (declared fields + regex fallback), plus a
      conservative high-confidence key-shape regex pass for string
      results (no aggressive NL matching — the false-positive concern
      above is why this stayed narrow). Threaded through via
      `#redactToolResult(toolName, result)` at all 5
      `eventLog.append('tool_result', ...)` sites. Declared fields on the
      obvious tools (auth/vault/oauth).

- [x] **Vault corruption — no UI reset path.** Closed: `SecretVault
      .destroy()` wipes all storage (incl. `__vault_*__` internal keys)
      and locks the vault. `showVaultModal`'s unlock path now offers a
      danger-confirmed "Reset vault (deletes all secrets)" action after a
      failed unlock, then reopens the modal in create mode.

- [x] **OPFS quota — no eviction policy.** Closed: new
      `clawser-quota-guard.mjs` — `guardBeforeWrite(sizeBytes, op, opts)`
      denies at critical (≥95%), warns once per session at ≥80% (with an
      `onWarning` callback for eviction), `evictOldestSnapshots()` for
      oldest-first pruning. Wired into `OPFSVaultStorage.write`, snapshot
      writes (`createAtomicSnapshot`/`createTarSnapshot`), the CLI's
      `cmdSave`, `RotatingLogWriter.#doFlush` (with a
      `pruneOldestRotation()` method), and deploy-apply writes. Quota
      meter (`renderQuotaBar`) now also surfaces on the Dashboard, not
      just Settings.

- [x] **Concurrency stress untested.** Closed: new
      `web/test/clawser-stress.test.mjs` covers all four scenarios named
      here (100 paired devices, 1,000 skills, 10,000 audit chain entries,
      100MB/100-file MemoryFs) plus a signature-tamper case for the audit
      chain. Asserts completion/correctness rather than tight performance
      numbers. New `stress` test group (excluded from `fast`/`core`,
      included in `slow`/`all`; run explicitly via `npm run test:stress`).

## Closed 2026-05-08

- [x] **EventLog tool-arg redaction policy** — **CLOSED**
      2026-05-08. New module `web/clawser-redaction.mjs`. Per-
      tool `redactedFields` declaration + regex fallback
      (defense-in-depth). Wired into 5 agent `eventLog.append`
      call sites. Migration on conversation restore scrubs
      legacy entries. Idempotent. 19 new tests.

- [x] **Round 2 (state migrations + error recovery)** —
      **VERIFIED CLEAN** 2026-05-08. Workspace localStorage→
      OPFS, vault v1→v2, tar/IDB snapshot fallback,
      `/home/<name>` alias all robust and idempotent.
      Subsystem error recovery surfaces clearly. One UX gap
      surfaced separately (vault corruption no-reset).

- [x] **Round 3 perf hot paths** — **VERIFIED CLEAN**
      2026-05-08. Terminal keystroke, chat render, agent run,
      sync apply, file watcher poll, mesh dispatch — none
      have JSON parsing or per-byte work in hot paths. OPFS
      quota and concurrency stress surfaced separately.

- [x] **Round 4 Safari/iOS Safari compat** — **VERIFIED CLEAN**
      2026-05-08. All browser APIs (OPFS, BroadcastChannel,
      WebRTC, WebTransport, WebAuthn+PRF, structured-clone,
      periodicSync, File System Access, localStorage) are
      feature-detected with documented fallbacks.

## Surfaced 2026-05-06 (residual audit Round 2) — ALL CLOSED

- [x] **Relay transport unimplemented in production** — **CLOSED**
      2026-05-06. `MeshRelayClient.connect()` now opens a real
      WebSocket to `relayUrl` when no MockRelayServer is supplied.
      Wire protocol mirrors the mock's in-memory semantics exactly
      (register / announce / find / signal). Auto-reconnect with
      exponential backoff. 6 paired-WS-fixture tests.

- [x] **AgentBusyIndicator + CrossTabToolBridge orphans** —
      **CLOSED** 2026-05-06. AgentBusyIndicator's receive side
      wired (peer-state map, subscribe API, stale-peer pruning, 3
      new tests). CrossTabToolBridge deleted with explanatory
      note — its receive side and request/response protocol were
      never built and no consumer existed.

- [x] **Workspace-switch-during-agent-turn race** — **CLOSED**
      2026-05-06. Added `agent.awaitRun({timeoutMs, onWaiting})`;
      `cleanupWorkspace` now waits up to 5s for in-flight turns
      before tearing down state. Times out gracefully via
      `agent.cancel()`. 3 new tests.

## Surfaced 2026-05-06 (residual hiding-spots audit)

Items not silently fixable; need design / feature work:

- [x] **Agent tool-list editor missing.** Closed: `buildToolPickerModel`/
      `renderToolPickerHtml`/`collectToolPickerSelection` (new
      `clawser-tool-picker.mjs`) render a checkbox picker (grouped by
      category) for the allowlist/blocklist Tool Mode, replacing the
      silent-deny-everything empty-list default.

- [x] **Auth profile credentials UX.** Closed: `AuthProfileManager`
      gained `updateCredentials(id, credentials)`/`hasCredentials(id)`;
      per-profile "Set Credentials" button wired to a small modal (API
      key + optional baseUrl) in `renderAuthProfilesSection`. The
      switch/delete buttons already existed in the HTML but had **no**
      event listeners at all — also wired.

- [x] **Peer disconnect not surfaced.** Closed with the "sustained, not
      transient" heuristic this item asked for: new
      `presenceChangeMessage(change)` pure function in
      `clawser-presence.mjs` announces sustained offline (debounced by
      `offlineAfterMs`, so quiet on flapping) and recovery-from-offline
      only — quiet on idle-flapping and initial discovery. Wired into
      `state.presenceService.subscribe(...)`.

- [x] **Other BroadcastChannel coordination paths not exhaustively
      audited.** Audited: `AgentBusyBroadcaster` and
      `CrossTabToolBroadcaster` do **not** have the `TabCoordinator`-class
      leader-election bug (they don't do leader election at all — pure
      broadcast/subscribe, no ordering-sensitive state machine). Recorded
      clean; no fix needed.

- [x] **EventLog replay completeness.** Closed: `replayFromEvents`
      refactored to a `REPLAY_HANDLERS` registry `Map` (type → handler)
      plus an explicit `IGNORED_EVENT_TYPES` `Set`, both exported. New
      test enumerates all 24 appended event types and asserts each is
      either handled or explicitly ignored — the "lint check" this item
      asked for. 7 previously-unclassified types added to the ignore set.

## Surfaced 2026-05-06 (panel-audit convergence pass)

Five-round convergence over the panel/view system. Closed the
three pending controllers (mesh, swarms, transfers), the hooks
silent-data-loss bug, and the visible-panel-on-switch staleness
bug. Items still surfaced for next pass:

- [x] **Hook persistence wired.** `persistHooks()`/`restoreHooks(factories)`
      are now called from the hooks UI (`clawser-ui-config.js`) and
      `initWorkspace()` respectively. User-typed hooks persist as
      `{name, point, priority, body, enabled}`; `defaultHookFactories()`
      rebuilds the `user-hook` factory via `new Function('return '+body)()`,
      wrapped in try/catch so a corrupted body doesn't break restore.

- [x] **Swarms UI/backend structural mismatch — resolved via the mesh
      Phase 11 multi-swarm refactor.** `SwarmCoordinator` now tracks
      `Map<swarmId, {election, distributor, tasks}>` — real multiple
      concurrent swarms, not a single-swarm synthesis. `'local'` is the
      always-present default that every pre-refactor call/test implicitly
      used (all 82 pre-existing tests pass unmodified — backward-compat
      proof). New: `createSwarm`/`disbandSwarm`/`hasSwarm`/`listSwarms`/
      `listMembers`. `buildSwarmViewModel` lists one real card per swarm;
      `onDisband` is a real implementation (still refuses 'local'). Also
      fixed a latent bug found along the way: the view model read
      `task.assignee`, which doesn't exist on `SwarmTask` (only
      `.assignedTo`). 24 new SwarmCoordinator tests + 9 new/updated
      controller tests.

- [x] **`clawser-ui-diff.js` wired.** `buildUndoDiffModel(fileOps)` maps
      `UndoManager` file ops to diffable `{path, action, oldText, newText}`;
      the undo button in chat now renders a "± View changes (N)" expander
      using `computeDiff`/`renderDiff` when file ops exist for that
      checkpoint.

- [x] **Mesh dashboard "Deploy Skill" cross-mount.** Closed: `onDeploySkill`
      wired to a picker modal → target picker from the paired-devices
      store → `publishDeploy(...)`, reusing the My Devices controller
      flow (`clawser-deploy-flow.mjs`) instead of duplicating it. Also
      fixed a real bug found along the way: `mountMyDevicesPanel(state)`
      was called with no second argument, so `resolveItems`/
      `getSigningKey`/`getSourceDid` were always the useless defaults.

- [x] **`max_tokens`-style ghost-method audit not exhaustive.** Closed:
      scripted enumeration of every `state.<service>.<method>(` call site
      across all UI modules (node script importing modules with stubs,
      reflecting on prototypes to verify each call site against real
      class methods). Findings fixed (guarded or corrected); no
      unguarded ghost-method calls remaining in the audited surface.

See `docs/panel-convergence-2026-05-04.md` for the full per-round
report + brutal-honest residual-gap assessment.

---

## Current State: Clean

The 2026-05-02 deep-dive audit + gap-closure pass closed every known
"implemented but not wired" item from the previous OUTSTANDING list, plus
shipped a substantial set of new wirings and features. See the closure log
below.

---

## Recently Closed (2026-05-02 pass)

### Code quality

- [x] **Shell tab completion** — `getCompletions()` exported from
      `clawser-shell.js`, wired into the terminal input via `Tab` with
      cycle-through behaviour. 9 tests.
- [x] **DID spec compliance** — `MeshIdentityManager.toDID()` now returns
      proper W3C `did:key` format (multicodec `0xed 0x01` + base58btc-encoded
      raw Ed25519 pubkey). `toLegacyDID` retained as a stable identifier
      alias.

### Filesystem

- [x] `injectEnvIntoShell` wired into `createConfiguredShell`.
- [x] `state.fsUiSync` write-through migrated all six config panels.
- [x] Hardware device files (`/dev/clawser/hardware/*`) reachable from the
      shell.
- [x] Real USTAR tar snapshots wired through `snapshot save/restore/list/
      delete`. Falls back to legacy IDB for older snapshots.
- [x] OPFS-first workspaces.json with one-time localStorage migration.
- [x] Mesh peer device read path wired via `discoveryManager.onPeerDiscovered/
      onPeerLost`. **Write path is Partial** — see Remaining below.

### Mesh

- [x] All five "Implemented, not wired" browsermesh modules turned out to
      already be wired in `ClawserPod.initMesh()`. Specs were stale; updated
      and pinned by smoke test (`clawser-pod-mesh-wiring.test.mjs`).
- [x] `PEER_TYPE` taxonomy + `peerType` field on `DiscoveryRecord`.

### CLI / RPC / PWA

- [x] HTTP RPC transport (`clawser rpc --rpc-http :PORT`).
- [x] Bearer-token auth for HTTP RPC.
- [x] PWA install flow module (captures `beforeinstallprompt`, exposes
      `tryInstall()`, `isStandalone()`, `detectPlatform()`).
- [x] Manifest hardening: `id`, `display_override`, `categories`, `shortcuts`.

---

## Remaining

### Partial implementations

- [x] **Mesh peer device write path** — closed in the 2026-05-02 follow-up.
      `ClawserPod.sendMessage(peerId, envelope)` and `PeerNode.sendTo(pubKey, data)`
      added; `state.pod.sendMessage` is wired as the `sendFn` for every mesh
      peer device. Writes throw a clear "no active session" error when the
      peer hasn't been connected.
- [x] **Phase 7 (FsUiSync) read direction** — closed in the 2026-05-02
      follow-up. `createShellSession` registers all six panels with
      `state.fsUiSync.registerPanel`; render functions use
      `clawser-panel-dirty.mjs` setters that preserve user-typed input.

### Code quality (Batch 3 / scoping discussion needed)

- [x] **Vault recovery / forgotten-passphrase mitigation** — Closed in
      the 2026-05-03 vault Option F pass. The vault was refactored from
      direct passphrase encryption to a wrapped-DEK model
      (`web/clawser-vault.js`); users can now enroll a WebAuthn passkey
      (PRF extension) as a second unlock path. Includes a "Change
      passphrase" UI surface in the vault modal (gear → Change
      passphrase) and atomic v1 → v2 migration on first unlock of an
      existing vault. **Update 2026-07-04:** recovery codes shipped as
      a `recovery`-kind KEK wrap (`setupRecovery`/`recoverWithCode`) —
      code shown once at vault creation; "Forgot passphrase?" flow in
      the unlock modal; code rotates on use.
- [x] **126 silent catch blocks** — Closed in the 2026-05-03 quick-wins
      pass. Replaced with `silentCatch(module, op, err, ctx?)` calls
      (debug-gated, opt-in via `clawserDebug.enable()`). Helper in
      `web/clawser-silent-catch.mjs`. The original audit said 41; the
      actual count was 126.
- [x] **Relay auto-connect UX** — Closed in the 2026-05-03 quick-wins
      pass. New "Mesh / Relay" section in Settings exposes Relay URL,
      Signaling URL, and an "Auto-connect on workspace start" checkbox;
      values round-trip with the existing `clawser_relay_url` /
      `clawser_signaling_url` localStorage keys plus a new
      `clawser_relay_auto_connect` flag wired into `initMeshSubsystem`.

### Mesh production hardening (RM Phase 11, all in Batch 3)

- [x] **WebRTC reliability hardening** — `mergeIceServers()` (TURN support
      via a new Settings → Mesh/Relay TURN field), `WebRTCPeerConnection
      .reconnect()` (ICE restart), `WebRTCMeshManager` auto-reconnect with
      exponential backoff (`onReconnectOffer`/`reconnectPeer`). 39 new
      tests. Known gap, documented honestly: `clawser-pod.js`'s production
      'webrtc' transport adapter still uses raw per-endpoint
      `WebRTCPeerConnection`, not `WebRTCMeshManager` — the auto-reconnect
      machinery isn't wired into the live transport path yet.
- [x] **WebTransport — reframed, not a gap** — WebTransport is inherently
      client-server (no browser exposes a peer-to-peer WebTransport mode;
      it's built on HTTP/3, which requires a server). The "bridged, not
      end-to-end" framing implied a P2P mode was coming; there isn't one to
      build. `docs/browsermesh/specs/networking/transport-probing.md`
      already documented this correctly (`webTransport: server-mediated`,
      same table as `webSocket`). `WebTransportBridge`
      (`clawser-mesh-webtransport.js`) is the correct, complete
      implementation for what WebTransport can be: a bridge/relay
      transport, same category as WebSocket — not a peer transport like
      WebRTC. Closing this item by documentation; no code change needed.
- [x] **Consensus validator sets** — `ConsensusManager.addValidator/
      removeValidator/listValidators/isValidator` gate `propose()`/`vote()`
      (both local calls and inbound wire handlers) once at least one
      validator is registered; empty set = open membership (unchanged
      default behavior). 19 new tests. This is membership-gated voting,
      **not** PBFT — no pre-prepare/prepare/commit rounds, no view
      changes, no 3f+1 Byzantine safety guarantee. Full PBFT remains the
      opt-in `raijin-consensus` path wired at `clawser-pod.js`'s PBFT
      integration (~line 417-478) for when Byzantine fault tolerance
      actually matters (e.g. payment finality).
- [x] **Payment channel settlement/escrow timeouts** — `PaymentRouter
      .startEscrowSweeper(intervalMs, onExpired)` calls `EscrowManager
      .pruneExpiredDetailed()` on a timer; wired in `initMeshSubsystem`
      (started/stopped alongside the pod's mesh lifecycle) with a bug fix
      found while wiring: the previous workspace's sweeper was never
      stopped before `initMesh()` rebuilt a fresh `PaymentRouter`, leaking
      a timer against a detached `EscrowManager` on every workspace switch.
- [x] **Per-member group key envelope encryption** — X25519 ECDH + AES-GCM
      key wrap (`generateEncryptionKeyPair`/`wrapKeyForMember`/
      `unwrapKeyForMember` in `clawser-mesh-group-keys.js`).
      `GroupKeyManager.initEncryption()`/`setMemberPublicKey()`; `broadcast
      Distribute()` now sends a per-member encrypted envelope when the
      recipient's public key is known, falling back to metadata-only (the
      old behavior) with a logged warning otherwise. Public keys are
      advertised via discovery-record metadata (`clawser-pod.js`) — best
      effort/fire-and-forget since key generation is async and discovery
      announces periodically. 58 tests.
- [x] **Presence protocol standalone service** — Closed in the 2026-05-03
      quick-wins pass. New `web/clawser-presence.mjs` (`PresenceService`)
      subscribes to PeerNode `peer:connect`/`peer:disconnect` events and
      tracks `online`/`idle`/`offline` per peer with timestamps. Public
      API: `getPresence(peerId)`, `getAll()`, `subscribe(cb)`,
      `recordHeartbeat(peerId)`. Wired into `initMeshSubsystem` as
      `state.presenceService`. 25 tests.
- [x] **Distributed tracing across mesh hops** — traceId carried inside
      our own message envelope (not the browsermesh-primitives wire
      schema): `ClawserPod.sendMessage()` generates one for new outbound
      envelopes (preserving one already present, so forwarded/relayed
      messages keep the same id across hops), `onMessage()` reports
      `mesh.recv` for any envelope that already carries one.
      `KernelIntegration.traceMeshEvent()` emits to the kernel Tracer;
      wired via `initMeshSubsystem(opts)` → `pod.setTraceEmit(...)`. Full
      spec-level tracing (correlating with non-clawser mesh peers) stays a
      roadmap note — this only correlates hops between clawser pods.
      24 tests.
- [x] **Mesh health dashboard + alert rules** — `WebRTCPeerConnection
      .getConnectionStats()` queries `RTCPeerConnection.getStats()`
      (byte/message counters, RTT, an approximate packet-loss ratio via
      STUN retransmission — data channels have no standard packetsLost
      counter); `WebRTCMeshManager.getAllConnectionStats()` aggregates +
      caches. New `clawser-mesh-alert-rules.mjs`: pure `evaluateAlertRules()`
      (latency >2s, packet loss >5%, peer-drop defaults) +
      `recordMetricSample()` (rolling 1-min window). `MeshInspector
      .snapshot()` gains a `connectivity` field; `clawser-ui-mesh.js`
      renders a "Connectivity Metrics" section. A 10s poller in
      `initMeshSubsystem` surfaces violations via `addMsg('system')`.
      Known gap, documented honestly: `state.webrtcMeshManager` isn't
      populated by `ClawserPod.initMesh()` yet (same WebRTC-hardening gap
      noted above) — the poller is real and fully tested against
      `WebRTCMeshManager` directly, but is a documented no-op in
      production until that wiring lands. 60 tests.
- [x] **Remote peers as deployment targets (push code/skills)** —
      **End-to-end shipped 2026-05-03 in the multi-device deploy
      completion pass.** All five Track 3 items + paired-devices
      registry + mount + E2E verification done. The full picture:
      - **Receive side:** `pod.onMessage` + `peerNode.onIncomingData`
        dispatcher; per-workspace `state.syncFlags`,
        `state.deployTarget` (`deployAcl`, `deployApprovals`,
        `deployAudit`, `deploySnapshots`, `replayCounter`).
        Per-workspace OPFS storage at `~/.config/clawser/{sync,deploy}/`
        with isolation across workspaces.
      - **Outbound:** `publishDeploy({items, targetPubKey, signingKey,
        sourceDid, pod, ...})` in `web/clawser-deploy-publish.mjs`.
        Build manifest, sign Ed25519, send via `pod.sendMessage`.
        `publishDeployToAll` for parallel fan-out.
      - **Apply transport:** `web/clawser-deploy-apply.mjs` with three
        per-kind handlers (skill → `SkillStorage.writeSkill`, config
        → `writeConfig` gated on `capabilities.config[]`, memory →
        `state.agent.memoryStore` gated on `capabilities.memory[]`).
      - **Approval modal:** `web/clawser-approval-modal.mjs` —
        deny-by-default UX, capability summary, manifest fingerprint,
        items list.
      - **DID resolver:** `web/clawser-did-key.mjs` — `did:key:z…` →
        Ed25519 `CryptoKey`, round-trips with `MeshIdentityManager.toDID`.
      - **UI panels (render+bind):** `web/clawser-ui-multi-device.mjs`
        — `renderMyDevicesPanel`, `bindMyDevicesPanel`,
        `renderTrustedPublishersPanel`, `bindTrustedPublishersPanel`,
        `showPairNewDeviceModal`. 15 tests with XSS escape coverage.
      - **Production controllers:** `web/clawser-multi-device-controllers.mjs`
        — `buildMyDevicesController`, `buildTrustedPublishersController`.
        DOM helpers injectable for testing. 19 tests.
      - **Item picker modal:** `web/clawser-deploy-picker-modal.mjs` —
        skills/configs/memory checkboxes; **strictly declarative**
        capability derivation (configs contribute domain, memory
        contributes category, skills contribute nothing — no magic
        inference from skill content).
      - **Paired-devices registry:** `web/clawser-paired-devices.mjs`
        — `PairedDevicesStore` with `subscribe()` for reactive UI.
        21 tests.
      - **Mount:** `web/clawser-multi-device-panels.mjs` — idempotent
        mount via WeakMap, reactive re-render on store mutations.
        `web/index.html` exposes `myDevicesContainer` +
        `trustedPubsContainer` under collapsible toggles wired in
        `web/clawser-ui-panels.js`. 11 tests.
      - **End-to-end test:** `web/test/clawser-multi-device-e2e.test.mjs`
        — full source→target round-trip through production code:
        `publishDeploy → pod.sendMessage → pod.onMessage → acceptPackage
        → applyTransport → audit log`, plus rollback. 3 cases:
        happy path, untrusted source, user-denied approval.
      - User-facing walkthrough: `guide/multi-device.md`.
      - Status table: `docs/multi-device-deploy.md` (every item
        flipped from "missing" to "shipped").

### Daemon / Service Worker (RM Phase 12, Batch 3)

- [x] **SW wake-on-message (in-repo half).** `sw.js`'s periodicsync handler
      logic is now a shared `checkAndWakeScheduler()` function, called both
      by `periodicsync` (browser-scheduled) and a new `self.addEventListener
      ('message', ...)` handler responding to `{type: 'clawser-scheduler-
      check'}` — a page can now ask the SW to check right now instead of
      waiting for periodicSync's next (browser-throttled, often
      hours-later) tick. Client side: `clawser-app.js` posts that message
      on `visibilitychange` when a tab regains visibility. **Remaining
      gap, honestly out of scope for a client-only app:** true push-from-
      relay (waking the SW while every tab is closed) needs Web Push +
      VAPID, which requires a server component.
- [x] **Scheduled task execution in daemon mode (audit + fix).**
      `clawser-background-runner.js` now validates cron expressions (5
      fields, per-field ranges) once per routine and excludes invalid ones
      from due-checking instead of silently misfiring; tracks
      `consecutiveFailures` and skips (logging "Skipped (previous
      failure)") after 3 in a row instead of retrying forever.

### Ecosystem (Batch 3)

- [x] **5.1** Publish npm embed package — **scaffolded, publish blocked on
      npm auth.** New `packages/clawser-embed/` wraps `EmbeddedPod` (its
      only dependency, `Pod`, resolves to the already-published
      `browsermesh-pod` package). `npm pack --dry-run` produces a clean
      4-file tarball; verified with a real smoke import (constructs
      `EmbeddedPod`, confirms the `ClawserEmbed` alias) against the actual
      installed `browsermesh-pod`. **Also fixed while doing kernel publish
      prep (G2, see below):** `web/packages/kernel/package.json`'s name was
      plain `"kernel"` — already taken on the public registry by an
      unrelated package — renamed to `browsermesh-kernel` (confirmed
      available), matching what ROADMAP.md already committed to. Both are
      genuinely publish-ready; only blocked by `npm login` in this
      environment (`npm whoami` → 401). To publish once credentials exist:
      ```
      cd packages/clawser-embed && npm login && npm publish
      cd web/packages/kernel && npm login && npm publish
      ```
- [ ] **5.2** Skills marketplace backend (agentskills.io) — out of repo
- [x] **5.3** Channel integrations — **credential walkthroughs shipped**,
      real API credentials still require the user's own accounts (out of
      repo by nature). New `docs/channel-setup/{discord,telegram,slack}.md`,
      linked from `docs/data/channels.yaml`'s `see_also`. Discord, Telegram,
      and now Slack are fully self-contained (verified against actual
      adapter source, not assumed behavior). **Found and fixed a real gap
      writing the Slack doc:** `SlackPlugin` only implemented the
      *receiving* half of Slack's Events API (`handleEvent()`) — nothing
      exposed a public HTTPS endpoint for Slack to POST to, which a browser
      tab can't do alone, and the `appToken` config field it accepted was
      dead code despite doc comments calling it "Socket Mode". Implemented
      real Socket Mode in `web/clawser-channel-slack.js`: `apps.connections.open`
      + a WebSocket connection (same self-contained pattern as Discord's
      Gateway), envelope ack (`envelope_id`), and reconnect-with-backoff
      including handling Slack's `disconnect` envelope. The classic Events
      API webhook path (`handleEvent()`) still works for anyone who'd
      rather run their own relay. 15 new tests in
      `web/test/clawser-channel-slack.test.mjs` (23 total, all passing).
      Matrix/IRC get bring-your-own-server notes instead of full
      walkthroughs (Matrix: any homeserver via long-poll `/sync`, no bridge
      needed; IRC: the `server` field must be a `wss://` WebSocket-to-IRC
      bridge URL, not a raw IRC address).
- [ ] **5.4** Chrome Web Store extension publication — code in `clawser-browser-control` repo
- [x] **5.5** Verify IPFS Helia CDN URL freshness — Closed in the 2026-05-03
      quick-wins pass. Bumped `helia@6.0.21` → `helia@6.1.4` in
      `web/clawser-peer-ipfs.js` and `packages/browsermesh-apps/src/peer-ipfs.mjs`;
      added "verified current 2026-05-03" comment. Storacha gateway URL in
      docs is current. No other IPFS gateway URLs in the codebase.
- [ ] **5.6** Verify IoT bridge with real hardware
- [ ] **F4** iOS Safari compatibility audit
- [x] **G2** Kernel extraction to standalone npm — publish-ready (see 5.1
      above for the details: renamed `kernel` → `browsermesh-kernel` to
      fix a real name collision, added README/LICENSE, verified with
      `npm pack --dry-run` + a real smoke import). Blocked only on
      `npm login`.
- [ ] **G3** Kernel tenants from ServerPod (Node)
- [x] **G4** v86 guest UI + auto-mount activation — Closed in the Batch C
      pass. "Guest VM" collapsible section in the Config panel (Boot/
      Shutdown buttons, status line); boots `LinuxGuest` lazily via CDN,
      wires `renderGuestFsPanel` + `autoMountGuest`; torn down in
      `cleanupWorkspace()`. Mock-guest tests cover the controller; real
      boot is network-dependent (manual smoke only, as planned).

### Surfaced for design decision (2026-05-04 triage) — RESOLVED

- [x] **Per-workspace `/home/<workspace_name>` filesystem layout.**
      Closed in the 2026-05-04 home-alias pass via Proposal A. The
      shell view now exposes `/home/<sanitized-name>` as an alias for
      `~/` for the active workspace; cross-workspace `/home/<other>/...`
      paths are blocked (read → ENOENT, write → "cross-workspace write
      denied"). `$HOME` re-exports live on workspace switch.
      `/proc/clawser/workspaces` lists every workspace with its
      sanitized home path. New module `clawser-workspace-name.mjs`
      handles sanitization and conflict-suffixed naming.
      `docs/unix-filesystem-architecture.md` updated.

### Aspirational / not on the roadmap

- `.reference/mesh-rollup-plan.md` — design-only; recommend skip.
- `docs/unix-filesystem-architecture.md §22-34` (wnix v0.1-v0.4) —
  design-only; recommend moving to `.reference/`.

---

## Summary

| Category | Count |
|----------|-------|
| Recently closed in 2026-05-02 pass | 19 items (17 from gap-closure + Phase 7 read side + A3 write path in follow-up) |
| Recently closed in 2026-05-03 quick-wins pass | 4 items (Helia CDN URL, Relay UI, presence service, 126 silent catches) |
| Recently closed in 2026-05-03 vault Option F pass | 1 item (vault refactor + passkey unlock + change-passphrase UI) |
| Recently closed in 2026-05-03 deploy-targets pass | 1 item (multi-device sync + remote deploy targets) |
| Partial (clearly documented) | 0 |
| Batch 3 / scoping needed | ~16 |
| Aspirational design docs | 2 |

See `docs/implementation-status.md` for full per-item evidence.
