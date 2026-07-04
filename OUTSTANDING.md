# Clawser — Outstanding Work

> Last updated 2026-05-08 (comprehensive audit Rounds 1-4 complete).
> **9,428 tests passing, 0 failing — stable across runs.**
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

- [ ] **Tool result OUTPUT redaction.** EventLog now redacts
      tool-call arguments (privacy fix shipped 2026-05-08), but
      tool result *output* is still free-form text. A tool that
      echoes a secret in its output (e.g.,
      `"set apiKey to sk-..."`) leaks it into the eventlog.
      Hard to fix without a structured result schema with
      declared sensitive fields — regex over output text would
      false-positive too aggressively. Estimate L.

- [ ] **Vault corruption — no UI reset path.** If the wrapped
      DEK becomes unreadable (corrupted bytes, mismatched salt,
      forgotten passphrase), the unlock dialog only offers
      retry. There is no "reset vault (deletes all secrets)"
      confirm flow. User is stuck. Estimate S.

- [ ] **OPFS quota — no eviction policy.** Writes to vault /
      snapshot / audit / sync don't check
      `navigator.storage.estimate()` first. There is no
      automatic prune of old eventlog entries beyond
      `EventLog.#maxSize`, no compaction of audit log, no
      quota meter in the UI. Power users with multi-month
      workspaces will hit `QuotaExceededError` with no
      automatic recovery. Fix shape: pre-write quota check +
      eventlog compaction UI + workspace settings quota meter.
      Estimate M-L.

- [ ] **Concurrency stress untested.** 100 paired devices, 1k
      skills, 10k audit entries, 100MB OPFS workspace. Code
      paths look reasonable analytically but no synthetic
      stress-test fixtures exist. Surfaced for a dedicated
      pass. Estimate L (multi-day).

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

- [ ] **Agent tool-list editor missing.** The agent editor exposes
      a "Tool Mode" select (allowlist / blocklist / all / none),
      but no UI to populate the actual list. Selecting "Allowlist"
      with the default empty list silently denies the agent every
      tool. Fix shape: inline tool picker (similar to the deploy
      picker). Estimate S-M.

- [ ] **Auth profile credentials UX.** "+ New Profile" creates a
      placeholder via `addProfile(provider, name, {})` (empty
      credentials). There is no UI to set credentials separately
      (OAuth providers have their own flow; non-OAuth profiles are
      stuck). Fix shape: per-profile "Set Credentials" modal that
      writes through to the vault. Estimate S-M.

- [ ] **Peer disconnect not surfaced.** Mid-session
      `peer:disconnect` events update the mesh panel but emit only
      `console.log`. UX choice — surfacing every disconnect would
      be noisy. Recommend a "transient vs sustained" heuristic
      before adding noise. Estimate S after the heuristic is
      designed.

- [ ] **Other BroadcastChannel coordination paths not exhaustively
      audited.** The leader-election bug in `TabCoordinator` was
      caught by reading protocol semantics. `AgentBusyBroadcaster`
      and `CrossTabToolBroadcaster` use the same primitive — likely
      similar shape but not verified.

- [ ] **EventLog replay completeness.** `replayFromEvents`,
      `replaySessionHistory`, and `EventLog.deriveGoals` handle
      a fixed set of event types. New event types can be added
      without a corresponding replay branch (would silently skip).
      Recommend a registry pattern + lint check. Estimate S.

## Surfaced 2026-05-06 (panel-audit convergence pass)

Five-round convergence over the panel/view system. Closed the
three pending controllers (mesh, swarms, transfers), the hooks
silent-data-loss bug, and the visible-panel-on-switch staleness
bug. Items still surfaced for next pass:

- [ ] **Hook persistence not wired.** `ClawserAgent.persistHooks` and
      `restoreHooks(factories)` exist but no caller invokes them.
      User-typed hooks survive a reload only if persistence is
      wired. Fix shape: persist serializable form (name, point,
      priority, body string, enabled), restore via factory that
      `eval`s body strings. Estimate S-M.

- [ ] **Swarms UI/backend structural mismatch.** The panel was
      designed multi-swarm; the backend (`SwarmCoordinator`) is
      single-swarm with members + tasks. The new view-model
      synthesizes one card to bridge, and `onDisband` explicitly
      logs "unsupported." Full multi-swarm story would need either
      a UI rewrite or a `SwarmCoordinator` redesign. Estimate L.

- [ ] **`clawser-ui-diff.js` orphan deferred.** `computeDiff`,
      `renderDiff` exist with tests but no production consumer.
      Natural integration: diff viewer over `UndoManager.previousContent`,
      requires UX design. Estimate S to wire when target is decided.

- [ ] **Mesh dashboard "Deploy Skill" cross-mount.** Currently
      hints at "Settings → My Devices → Deploy now." Could be
      unified for one-click cross-pod deploy from the mesh panel.
      Estimate S.

- [ ] **`max_tokens`-style ghost-method audit not exhaustive.**
      Round 3's enumeration covered the high-traffic surfaces
      (`state.agent.*`, `state.skillRegistry.*`, etc.). Other
      `state.X.method()` call sites in deeper UI modules (chat,
      terminal, dashboard, agents picker) may still hide
      ghost-method bugs. Recommend a targeted second pass at
      `state.X.Y` enumeration across all 24 UI modules.

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
      (PRF extension) as a second unlock path. Recovery codes were
      explicitly *not* shipped — see `docs/VAULT.md` for the rationale.
      Includes a "Change passphrase" UI surface in the vault modal
      (gear → Change passphrase) and atomic v1 → v2 migration on first
      unlock of an existing vault.
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

- [ ] WebRTC reliability hardening (reconnection, ICE restart, TURN fallback)
- [ ] WebTransport end-to-end (currently bridged)
- [ ] PBFT consensus end-to-end with real validator sets
- [ ] Payment channel settlement-on-close + escrow timeouts
- [ ] Per-member group key envelope encryption
- [x] **Presence protocol standalone service** — Closed in the 2026-05-03
      quick-wins pass. New `web/clawser-presence.mjs` (`PresenceService`)
      subscribes to PeerNode `peer:connect`/`peer:disconnect` events and
      tracks `online`/`idle`/`offline` per peer with timestamps. Public
      API: `getPresence(peerId)`, `getAll()`, `subscribe(cb)`,
      `recordHeartbeat(peerId)`. Wired into `initMeshSubsystem` as
      `state.presenceService`. 25 tests.
- [ ] Distributed tracing across mesh hops
- [ ] Mesh health dashboard
- [ ] Alert rules
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

- [ ] SW wake-on-message from relay/signaling server
- [ ] Scheduled task execution in daemon mode (audit + fix)

### Ecosystem (Batch 3)

- [ ] **5.1** Publish npm embed package
- [ ] **5.2** Skills marketplace backend (agentskills.io) — out of repo
- [ ] **5.3** Channel integrations with real API credentials (per-channel docs)
- [ ] **5.4** Chrome Web Store extension publication — code in `clawser-browser-control` repo
- [x] **5.5** Verify IPFS Helia CDN URL freshness — Closed in the 2026-05-03
      quick-wins pass. Bumped `helia@6.0.21` → `helia@6.1.4` in
      `web/clawser-peer-ipfs.js` and `packages/browsermesh-apps/src/peer-ipfs.mjs`;
      added "verified current 2026-05-03" comment. Storacha gateway URL in
      docs is current. No other IPFS gateway URLs in the codebase.
- [ ] **5.6** Verify IoT bridge with real hardware
- [ ] **F4** iOS Safari compatibility audit
- [ ] **G2** Kernel extraction to standalone npm
- [ ] **G3** Kernel tenants from ServerPod (Node)
- [ ] **G4** v86 guest UI + auto-mount activation (Phase 9 dormant)

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
