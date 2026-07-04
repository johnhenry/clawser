# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added (2026-07-04 audit pass + session recovery merge)
- **Recovered 2026-05-04 session merged into main.** ~30K lines of
  finished, QA'd work (multi-device sync/pairing, deploy system,
  vault v2, passkeys, presence, Y.js collab, PWA install, fs/UI
  sync, ~20 audit docs) sat uncommitted in a git worktree since
  May 4 — committed, merged, and reconciled with the fixes below.
- **Vault recovery codes** on the v2 wrapped-DEK model:
  `setupRecovery()` / `hasRecovery()` / `recoverWithCode()` add a
  `recovery`-kind KEK wrap; code shown once at vault creation, and
  a "Forgot passphrase?" flow in the unlock modal rotates the code
  on use. Complements the passkey wrap as a second recovery path.
- **.env loading wired**: `sourceProfiles()` now loads
  `~/.config/clawser/.env` between the system and user profiles
  (module existed since Phase 5 but was never called).
- **MOTD**: `/etc/clawser/motd` displayed as a system message on
  workspace init and switch.
- **EventLog rotation**: new `RotatingLogWriter`
  (`clawser-fs-logs.mjs`) streams agent events to
  `/var/log/clawser/events.jsonl` with 5 MB / keep-3 rotation per
  design §2.5; `EventLog` gains an `onAppend` observer.
- **/sys/kernel/trace is writable**: write `1`/`0` to toggle the
  kernel Tracer (new enable/disable on Tracer, `{read, write}`
  descriptors on ProcFileHandler, permission carve-out).
- **ClawserShell.complete()**: instance-level tab completion
  (aliases, functions, pipe-aware command position, common-prefix
  insert) alongside the standalone `getCompletions()`.

### Fixed (2026-07-04)
- Reactive config applies are deduped by content hash — duplicate
  multi-tab file-watcher notifications no longer re-apply; watcher
  self-write suppression is content-aware (also fixes a flaky test).
- Channel device reads fall back to gateway-delivered messages
  (`deliverToChannel`) when ChannelManager history is absent.
- Silent catch blocks: remaining empty catches annotated
  (best-effort cleanup) or converted to logging; hardware listener
  errors now logged; manual routine-run failures surface in chat.

### Security (2026-05-08 comprehensive audit privacy fix — eventlog redaction)
- **EventLog tool-arg redaction shipped.** When an agent called a
  tool with sensitive arguments (e.g., `auth_set_credentials({
  apiKey: "sk-..."})`), the apiKey was previously persisted
  verbatim to the OPFS eventlog and travelled with workspace
  exports. New module `web/clawser-redaction.mjs` provides
  `redactArgs(args, declaredFields)` that replaces sensitive
  field values with `{redacted:true, kind:<type>, length?:<n>}`
  placeholders. Two layers: (1) per-tool declaration via
  `BrowserTool.redactedFields` getter; (2) regex fallback
  (`SECRET_FIELD_RE`) catching common secret-bearing field
  names — defense-in-depth even for tools that don't declare.
  Idempotent: re-redacting already-redacted entries is a
  no-op. Wired into all 5 `eventLog.append('tool_call', ...)`
  call sites in `clawser-agent.js`. On conversation restore,
  `redactEventLog(events)` scans loaded entries and rewrites
  the OPFS file in place if any legacy secrets are detected.
  19 new tests in `web/test/clawser-redaction.test.mjs`. Test
  count 9,409 → 9,428 / 0 fail.

### Verified clean (2026-05-08 comprehensive audit Rounds 2-4)
- **Round 2 — state migrations** verified robust. Workspace
  localStorage→OPFS, vault v1→v2 (with atomic commit point at
  meta-write + `.next-suffix` staging), tar/IDB snapshot
  fallback, `/home/<name>` alias migration — all idempotent
  and edge-case-safe. Subsystem error recovery (vault, identity,
  agent provider, OPFS unavailable, mesh refuses, skills
  storage corrupt) surfaces with clear UX or graceful
  fallback. **One design-level gap surfaced**: vault corruption
  has no UI reset path — user is stuck if DEK can't decrypt.
- **Round 3 — performance hot paths** verified clean. Terminal
  keystroke, chat render, agent run loop, sync apply, file
  watcher poll, mesh dispatch — none have JSON parsing or
  per-byte work in their hot paths. **One design-level gap
  surfaced**: OPFS quota has no eviction policy — power users
  with multi-month workspaces will hit quota with no automatic
  recovery. **One acknowledgment surfaced**: concurrency stress
  (100 devices, 1k skills, 10k audits, 100MB workspace) looks
  fine analytically but is untested in code.
- **Round 4 — Safari/iOS Safari compat** verified clean. All
  browser APIs (OPFS, BroadcastChannel, WebRTC, WebTransport,
  WebAuthn+PRF, structured-clone, periodicSync, File System
  Access, localStorage) are feature-detected with documented
  fallbacks. WebTransport falls back to WebSocket; PRF falls
  back to passphrase; periodicSync falls back to setInterval;
  showDirectoryPicker falls back to download blob.

### Security (2026-05-07 comprehensive audit Round 1 — 4 security fixes)
- **HIGH: XSS via marked agent message rendering — fixed.**
  `clawser-ui-chat.js` rendered agent markdown via marked v15
  without HTML sanitization (marked v5+ doesn't sanitize by
  default). A malicious tool result, prompt-injected response, or
  user-pasted markdown could execute arbitrary HTML/JS in the
  user's session. Added `sanitizeMarkdownHtml()` post-processor
  that uses inert `<template>` parsing + `<script>/<iframe>/...`
  removal + `on*`/`javascript:` URL stripping.
- **HIGH: OAuth callback handler missing origin filter — fixed.**
  `clawser-app.js` accepted `__clawser_oauth_callback__` postMessages
  from any source/origin. An attacker who could iframe our app
  could forge a fake callback with attacker-controlled `code` to
  cause our exchange flow to connect the user's session to an
  attacker's account. Now checks `event.source === popup` and
  `event.origin === location.origin`.
- **MEDIUM: `verifySignedPackage` throws on malformed payload —
  fixed.** Audit-log path was bypassed when an attacker sent a
  package with a non-Uint8Array payload (e.g., JSON object after
  roundtrip). Now returns clean `{ok:false, reason:...}` instead.
- **MEDIUM: Skill deploy filename traversal defense — fixed.**
  `handleSkillItem` now validates `itemId` (rejects empty, `.`,
  `..`, `/`, `\`) and filters `payload.files` paths (rejects `..`
  segments, leading `/`, `\`). OPFS treats `..` as a literal name
  so this isn't exploitable for breakout, but defense-in-depth
  prevents weird directory creation.

### Fixed (2026-05-07 comprehensive audit Round 1 — 1 leak fix)
- **DelegateManager retains all sub-agents forever — fixed.**
  `#agents` Map grew without bound; each completed sub-agent held
  its full conversation history. Added `#maxRetained` cap (default
  50) and `#trimRetained()` that prunes oldest non-running agents
  past the cap on every `create()`.

### Added
- `docs/comprehensive-audit-2026-05-04.md` — Round 1 full report
  with security/leak/privacy/mock findings, surfaced Rounds 2-4
  (state migrations, error recovery, OPFS quota, performance,
  Safari compat) for next pass.

### Changed (2026-05-07 race + timer audit — 4 contained fixes)
- **Agent picker setTimeout race fixed.** `web/clawser-ui-panels.js`
  was using `setTimeout(...100ms)→dispatchEvent('agent:edit')` to
  signal "open the new-agent form" after clicking the agents-panel
  button. The 100ms could fire before `renderAgentPanel`'s
  `await state.agentStorage.listAll()` completed and registered
  the listener, leaving the new-agent form unopened. Now sets
  `agentEditingId = '__new__'` directly before clicking; the
  panel reads it synchronously and delegates to the editor. Dead
  `agent:edit` listener removed (was leaking one per render call).
- **Codex sandbox sleep-poll replaced with Promise single-flight.**
  `Codex.#ensureSandbox` had `while (#sandboxInitializing) await
  setTimeout(10ms)` for concurrent callers. Replaced with
  `#sandboxInitPromise` shared across concurrent callers — same
  idiom as the IdentitySyncCoordinator and vault fixes.
- **Vault `unlock()` single-flight guard.** Concurrent calls on a
  brand-new vault both fell through to `#createV2`, generating
  independent salts/DEKs and overwriting each other. Added
  `#unlockPromise` so concurrent callers share the same in-flight
  init. Body extracted to `#unlockImpl()`.
- **FileWatcher `#poll()` overlap guard.** Two polls (setInterval
  tick + explicit `rescan()`) could overlap, clobbering each
  other's debounce timers and entry state. Added a `#polling`
  guard. Body extracted to `#pollImpl()`.

### Added (2026-05-07 race + timer audit)
- `docs/race-and-timer-audit-2026-05-04.md` — full per-sweep
  findings with the inventory of 32 setIntervals + 91 setTimeouts
  and brutal-honest residual-confidence assessment (~96%, up from
  95% prior).

### Added (2026-05-06 structural follow-ups from residual-audit Round 2)
- **Relay transport WebSocket production path.** `MeshRelayClient.connect()`
  was mock-only; production callers appeared connected without any
  real network traffic. Now opens a real WebSocket to `relayUrl` when
  no `MockRelayServer` is passed. Wire protocol mirrors the mock's
  in-memory semantics exactly: `register` / `announce` / `find` /
  `signal` outbound; `peer_announce` / `signal` / `find_response` /
  `error` inbound. Auto-reconnect with exponential backoff; fires
  `'error'` event on connect failure and reconnect-budget exhaustion.
  6 new WS-mode tests using a paired-WS fixture.
  Production wiring in `clawser-workspace-init-mesh.js` now also
  surfaces relay errors via `addErrorMsg` instead of silent
  `console.warn`.
- **`AgentBusyIndicator` receive side completed.** Was broadcast-only
  (no `onmessage` handler); now tracks remote-tab busy states with
  a peer map, exposes `subscribe(cb)`, `peerStates()`, and
  `isAnyPeerBusy()`. Stale peers (no heartbeat in 15s) auto-prune.
  Three new paired-channel tests.
- **`agent.awaitRun(opts)` + `cleanupWorkspace` waits for in-flight
  turns.** Adds an `awaitRun({timeoutMs, onWaiting, gracePeriodMs})`
  method on `ClawserAgent` that resolves when the current turn
  settles. `cleanupWorkspace` now awaits it (5s budget) before
  destroying the kernel tenant and persisting state — and surfaces
  "finishing agent turn..." in the status bar after a 150ms grace
  period. If the wait times out, it cancels the turn and proceeds.
  Three new agent tests.

### Removed (2026-05-06)
- **`CrossTabToolBridge`** (clawser-daemon.js) — deleted as an unused
  orphan. The class docstring promised cross-tab tool invocation but
  `invoke()` ran locally only and the channel was never used. No
  production caller existed. The receive side, request/response
  routing, and timeout handling were all unimplemented. Tests in
  `clawser-daemon.test.mjs` and `clawser-sprint21.test.mjs` removed
  with explanatory notes.

### Added (2026-05-06 residual audit Round 2 — 4 rounds)
- **`IdentitySyncCoordinator` symmetric-yield bug fixed (HIGH-IMPACT).**
  When two tabs raced to create the same podId, both would yield to
  the other and neither would acquire the lock. Added a tiebreaker
  token to intent broadcasts; lower token wins. Receiver also
  responds with its own intent (with `_isResponse` flag) so the
  asymmetric-arrival case still resolves. New paired-channel test in
  `clawser-mesh-identity.test.mjs`.
- **WebSocket reconnect-exhausted error surface.** When the reconnect
  budget was exhausted (default 5 attempts), `_handleReconnect`
  silently returned without firing the `'error'` event. The user's
  transport sat at `disconnected` with no UI feedback. Now fires a
  clear error.
- **`KNOWN_EVENT_TYPES` registry in `clawser-agent.js`** — exported
  Set listing every event type with its disposition (replayed by
  derive function or audit-only). New lint-style test scans the
  source for `eventLog.append('X', ...)` calls and asserts each
  type is in the registry. Prevents future silent-skip bugs of the
  `goal_edited` / `goal_removed` variety.
- **SkillHotReloader workspace-switch race fixed.** An in-flight
  poll for workspace A would overwrite the new workspace B's
  `#hashes` with A's scan results when the user switched mid-poll,
  causing spurious reactivation on the next poll. Now captures
  `startWsId` at poll start; aborts cleanly if `setWorkspace`
  changed it before write-back. Test added.

### Added (2026-05-06 residual hiding-spots audit — 4 rounds)
- **`IdentityManager.getCurrent()`** — method-form alias for the
  `identity` getter. Closes a silent ghost-method bug:
  `clawser-ui-chat.js` called `state.identityManager?.getCurrent?.()`
  to read the avatar URL for agent messages, but the method didn't
  exist; agent avatars never rendered even when set.
- **Daemon badge reactivity.** `DaemonController` is now constructed
  with `DaemonState({onChange: phase => emit('updateDaemon', phase)})`
  so mid-session phase transitions (RUNNING → PAUSED → ERROR →
  STOPPED) update the header badge. Previously the badge only
  refreshed at workspace switch.
- **TabCoordinator leader-election bug fixed (HIGH-IMPACT).**
  `tab_join` and `tab_heartbeat` broadcasts now include the sender's
  `joinedAt` timestamp; receivers use the peer's reported value
  rather than stamping with their own clock. Previously two tabs
  could both claim `isLeader == true` because each stamped peers'
  `joinedAt` with its own clock at receive time. Concrete user
  impact: scheduled tasks could run twice (once per tab) in
  multi-tab sessions. Added `tabId` tiebreaker for identical
  `joinedAt` values. New test in `clawser-daemon.test.mjs`.
- **Cost meter / autonomy badge fall back to saved config.** Both
  read their values from DOM inputs that are only populated when
  the autonomy panel is rendered; on a session where the user
  never opens autonomy, both showed defaults instead of the saved
  values. Now fall back to `localStorage.getItem(lsKey.autonomy(wsId))`
  when the DOM input is missing.

### Changed (2026-05-06 residual audit)
- `clawser-ui-config.js` "+ New Profile" button under Auth Profiles
  now calls the real `addProfile(provider, name, {})` method
  instead of the non-existent `createProfile({name, provider})`.
  Errors surface via `addErrorMsg`. The credentials-collection step
  remains a feature gap (surfaced in OUTSTANDING).

### Added (2026-05-06 panel-audit convergence pass — 5 rounds)
- **Mesh Dashboard production controller** in
  `web/clawser-mesh-controller.mjs` (9 tests). Wires Refresh /
  DrainPod / ExecRemote / DeploySkill to real backends. The four
  buttons no longer fall through to placeholder `addMsg` lines.
- **Swarms production controller + view-model** in
  `web/clawser-swarm-controller.mjs` (11 tests). View-model
  synthesizes a single-swarm card from the `SwarmCoordinator` (the
  panel was designed multi-swarm; the backend is single-swarm — see
  the convergence doc for the structural caveat). Create now honors
  `members[]` and `maxAgents`. Join/Leave/Remove map to real ops.
  Disband is explicitly unsupported and logs that clearly rather
  than firing a misleading status message.
- **Transfers production controller + view-model** in
  `web/clawser-transfer-controller.mjs` (12 tests). `onSend` calls
  `fileTransfer.createOffer` and primes the chunk pump; `onCancel`
  calls `fileTransfer.cancelTransfer`. View-model maps the backend's
  `{offer, state}` shape into the panel's flat shape (the previous
  mount passed the raw shape, so active transfers displayed blanks).
- **`addHook` / `removeHook` / `enableHook` on `ClawserAgent`** —
  closes the second silent-data-loss bug (after `getGoal`/`editGoal`
  earlier this week). The Hooks settings panel called these three
  non-existent methods guarded by optional chaining; user clicks Save,
  form closes, "Hook X added" message fires (a lie), nothing is
  registered. Now actually registers via the existing `HookPipeline`.
- **`ChannelManager.subscribe(cb)`** — fires on `addChannel` and
  `removeChannel`. The Channels panel registers a single subscriber
  on init so out-of-panel mutations (slash commands, scheduled
  tasks, MCP tools) re-render without manual refresh.
- **`clawser-ui-drop.js` integrated.** `installFileDropHandler()` in
  `clawser-ui-files.js` registers a `DropHandler` on the file list.
  Dragging a folder onto the Files panel mounts it under `/mnt/<name>`.
  Closes one of the two orphan modules from the panel audit.
- **`registerLazyPanelRenders` eagerly re-renders the visible panel
  on workspace switch.** Previously, if the user was on the Files
  panel and switched workspaces, the panel showed stale data until
  they navigated away and back. Now the visible panel re-renders
  immediately. New `clawser-workspace-init-ui.test.mjs` (3 tests).
- **Mesh Dashboard onclick wrappers are async-aware.** Replaced
  `execBtn.onclick = () => opts.onExecRemote()` (fire-and-forget)
  with a `wrap()` helper that `await`s and surfaces unhandled
  rejections via `addErrorMsg`. Dropped misleading "Refreshing
  mesh status..." placeholder message that fired even when no
  controller was wired.
- **Routine "Run now" failures surface.** Previously
  `try { await state.routineEngine.triggerManual(id); } catch {}`
  swallowed every failure silently. Now `addErrorMsg`s the failure
  with the routine id.
- **Transfer cancel surfaces failures.** Previously the cancel
  onclick fired `addMsg('Cancelling...')` regardless of whether the
  controller succeeded. Now error responses route through
  `addErrorMsg`.
- **Multi-device-panels trusted-pubs single-bind.** Removed the
  redundant unbind+rebind cycle on mount. Functional cleanup.
- **Marketplace cleanup leak fixed.** `state._marketplaceCleanup`
  captures the cleanup fn; subsequent mounts call it before
  re-rendering, preventing orphan `<style id="mp-marketplace-styles">`
  elements.
- **Convergence audit report** in
  `docs/panel-convergence-2026-05-04.md` — 5 rounds, per-round
  summary, brutal-honest residual-gap assessment.

### Added (2026-05-05 panel/view wiring audit)
- **Panel audit report** in `docs/panel-audit-2026-05-04.md` —
  systematic pass over every UI panel checking mount, inputs,
  actions, reactivity, cleanup, and cross-workspace isolation. Found
  2 orphan modules (`clawser-ui-diff.js`, `clawser-ui-drop.js`),
  3 production-stubbed panels (mesh dashboard, swarms, transfers all
  have render+bind shipped without controllers wired in their lazy
  mount), and applied contained fixes for the goals silent-edit-failure
  and the multi-device workspace-switch reactivity gap.
- **`getGoal(id)` and `editGoal(id, patch)`** on `ClawserAgent` —
  the inline edit handler in the goals panel was calling
  `state.agent.getGoal?.(g.id)`; the optional chain returned
  `undefined` because the method didn't exist, and edits were
  silently dropped. Added both methods plus event-log appending of
  `goal_edited` so replays reproduce the change.
- **`EventLog.deriveGoals` now replays `goal_edited` + `goal_removed`** —
  previously it ignored both event types, so a goal edited or
  removed via the UI would resurrect on event-log replay (e.g.
  checkpoint loss recovery). Both events now apply correctly.
- **`remountVisibleMultiDevicePanels(state)`** in
  `web/clawser-multi-device-panels.mjs` — re-mounts the My Devices
  and Trusted Publishers sections whose `.visible` class is set in
  the DOM. Hooked into `switchWorkspace` so opening the section
  before a workspace switch no longer leaves stale data on screen.

### Changed (2026-05-05 panel audit pass)
- `web/clawser-ui-goals.js` inline-edit handler now calls
  `state.agent.editGoal(id, {description, priority})` instead of
  mutating the goal object directly.
- `web/clawser-workspace-lifecycle.js` `switchWorkspace` now calls
  `remountVisibleMultiDevicePanels(state)` after
  `registerLazyPanelRenders` so the multi-device sections refresh on
  workspace change.

### Added (2026-05-03 multi-device deploy completion pass)
- **Paired-devices registry** in `web/clawser-paired-devices.mjs` —
  `PairedDevicesStore` backs `state.pairedDevices`. API: `list`,
  `get`, `add`, `update` (partial-patch merge), `remove`,
  `setLabel`, `recordSync`, `subscribe`, `clear`. Reactive
  subscribe enables auto-rerender of the My Devices panel on
  every mutation. 21 tests.
- **Production controllers** in
  `web/clawser-multi-device-controllers.mjs` —
  `buildMyDevicesController(ctx)` returns
  `{onPairNew, onToggleSync, onDeployNow, onUnpair}` chaining
  `showPickerModal → publishDeploy → store.recordSync` with
  injected modal helpers; `buildTrustedPublishersController(ctx)`
  returns `{onRevokeSource, onRetrustSource, onRevokeApproval,
  onRollback}` with an injectable confirm. 19 tests.
- **Item picker modal** in `web/clawser-deploy-picker-modal.mjs` —
  three-section checkbox picker (skills/configs/memory) returning
  `{items, manifest}`. Capability derivation is **strictly
  declarative**: configs contribute their domain, memory contributes
  its category, skills contribute nothing — no inference from
  skill content (a security laundering surface that was explicitly
  rejected).
- **Live mount layer** in `web/clawser-multi-device-panels.mjs` —
  `mountMyDevicesPanel(state, opts)` subscribes to
  `state.pairedDevices` for reactive re-render with WeakMap-based
  idempotent mounts. `mountTrustedPublishersPanel(state, opts)`
  wraps controller actions to re-render after each mutation. 11
  tests.
- **DOM mount points** in `web/index.html` — collapsible "My
  Devices" and "Trusted Publishers" sections under the mesh
  panel. `web/clawser-ui-panels.js` lazy-loads the panel module
  on first toggle and mounts.
- **`PairedDevicesStore` instantiation** in
  `web/clawser-multi-device.mjs` — `installMultiDeviceWiring`
  now creates `state.pairedDevices` against per-workspace OPFS
  storage at `~/.config/clawser/paired-devices/`.
  `uninstallMultiDeviceWiring` clears it.
- **End-to-end verification test** in
  `web/test/clawser-multi-device-e2e.test.mjs` — full source→target
  round-trip through production code:
  `publishDeploy → pod.sendMessage → pod.onMessage → acceptPackage
  → applyTransport → audit log → rollback`. Three test cases
  (happy path, untrusted source rejected, user-denied approval
  rejected). Uses an in-memory pod-pair shim that mirrors a
  structured-clone-capable transport to preserve binary payloads.
- **User-facing walkthrough** in `guide/multi-device.md` — full
  pair → mark for sync → Deploy now → approve → review trusted
  publishers → roll back lifecycle with realistic examples and a
  threat-model summary.

### Changed (2026-05-03 multi-device deploy completion pass)
- `docs/multi-device-deploy.md` updated: every "missing" /
  "pending" item flipped to "shipped". Added sections for
  controllers, picker, paired-devices registry, mount, and E2E.
- `OUTSTANDING.md`: "Remote peers as deployment targets" item
  flipped from `[~]` partial to `[x]` complete.
- `docs/implementation-status.md`: same item moved from "Not
  started" to "Done" with a pointer to `multi-device-deploy.md`.
- `docs/gap-closure-plan.md`: C8 closed with a full status block.

### Added (2026-05-04 multi-device follow-up pass)
- **`resolveDidKey`** in `web/clawser-did-key.mjs` — parses W3C
  `did:key:z…` Ed25519 URIs (multicodec `0xed 0x01` + 32-byte raw
  key) into `CryptoKey` instances. Default `resolvePublicKey` for
  `installMultiDeviceWiring`. 10 tests including a round-trip with
  `MeshIdentityManager.toDID`.
- **Real apply transport** in `web/clawser-deploy-apply.mjs` —
  per-kind handler registry for `skill`/`config`/`memory` items
  with capability gating. `buildCapabilityToken` extended with
  `config` and `memory` arrays; `enforceCapabilityRequest`
  extended to gate config domains and memory categories.
  `installMultiDeviceWiring` wires real persistence via
  `SkillStorage.writeSkill`, `writeConfig` (fs-config), and
  `state.agent.memoryStore`. 17 tests.
- **Approval modal** in `web/clawser-approval-modal.mjs` —
  async DOM modal for first-deploy manifest approval. Shows
  source DID, manifest fingerprint, capability list, items being
  deployed; Approve/Deny resolve a Promise. Default-focused on
  Deny (defensive UX). 8 tests.
- **Outbound deploy orchestrator** in `web/clawser-deploy-publish.mjs` —
  `publishDeploy({items, targetPubKey, signingKey, sourceDid, pod})`
  builds, signs, and sends a deploy package end-to-end.
  `publishDeployToAll({targets, publishOpts})` fans out in
  parallel. 15 tests including a source-side build → target-side
  `verifySignedPackage`/`resolveDidKey` round-trip.
- **My Devices + Trusted Publishers UI panels** (render + bind) in
  `web/clawser-ui-multi-device.mjs`. Pure render functions
  produce HTML; bind functions wire event delegation to controller
  hooks. Three sections in Trusted Publishers (sources, approvals,
  audit history with rollback). HTML-escaped against XSS. 15 tests.

### Added (2026-05-04 multi-device wiring pass)
- **Pod-level message bus.** `peerNode.onIncomingData(cb)` fans
  every active transport's inbound bytes to a Set of listeners.
  `pod.onMessage(handler)` wraps that with JSON parsing and routes
  envelopes by type. This closes the structural gap where
  `pod.sendMessage` was sending raw bytes that the receive side
  (`PeerSession.#handleMessage`) wasn't picking up.
- **Per-workspace sync + deploy services wired.**
  `web/clawser-multi-device.mjs` exports
  `installMultiDeviceWiring({pod, state, wsId, ...})` and
  `uninstallMultiDeviceWiring(state)`. Called from
  `initMeshSubsystem`, the install creates per-workspace
  `SyncFlags`, `DeployAcl`, `DeployApprovals`, `DeployAuditLog`,
  `DeploySnapshotRing`, `ReplayCounterTracker` against
  workspace-scoped OPFS storage at `~/.config/clawser/{sync,deploy}/`.
  Subscribes to `pod.onMessage` and routes by `envelope.type`:
  `'sync'` → `syncEngine.handleIncoming`, `'deploy'` →
  `acceptPackage`. Per-workspace isolation verified.
- `web/clawser-workspace-storage.mjs` —
  `createWorkspaceConfigStorage(wsId, subdir)` adapter implementing
  the `{read, write}` contract. OPFS-first with in-memory fallback
  for environments where OPFS isn't reachable.
- 16 new tests across `clawser-pod-onmessage.test.mjs` (5) and
  `clawser-multi-device-wiring.test.mjs` (11).
- `docs/multi-device-deploy.md` documents the wiring + the explicit
  Track 3 follow-ups (UI panels, outbound deploy flow, real
  applyTransport, prompt + DID resolver wiring).

### Verified (2026-05-04 workspace verification pass)
- Walked every workspace lifecycle event (fresh install, existing
  user upgrade, create, switch, rename, delete, CLI, cross-workspace
  denial, profile/.env loading, vault, mesh peer devices, snapshots,
  sync flags, deploy targets, skills) against the `/home/<name>`
  restructure. 25 new tests in
  `web/test/clawser-workspace-lifecycle-verification.test.mjs`. Full
  per-event verdict + static sweep in
  `docs/workspace-restructure-verification-2026-05-04.md`.
- Headline: the restructure is solid for everything routed through
  the shell + workspace lifecycle. Two pre-existing gaps surfaced
  (sync-flags + deploy-target classes ship with tests but aren't
  instantiated in production); both are tracked as open items in
  `OUTSTANDING.md`.

### Fixed (2026-05-04 bug-hunt pass)
- **`clawser config set max_tokens N` actually wires the value.** The
  CLI command previously parsed and validated N then echoed
  "max_tokens noted: N (applied at request time)" — but no code read
  the value at request time. Now: `ClawserAgent` has
  `setDefaultMaxTokens` / `getDefaultMaxTokens`, the value is
  persisted via `persistConfig`, restored via `applyRestoredConfig`,
  and threaded into every `provider.chat`/`chatStream` request via
  `_providerOpts.max_tokens`. 5 new tests in
  `web/test/clawser-cli-max-tokens.test.mjs`. See
  `docs/bug-hunt-2026-05-04.md` finding #1.

### Added (2026-05-04 home-alias pass)
- Per-workspace `/home/<sanitized-name>` shell view: each workspace's
  display name resolves to a sanitized directory name, exposed as an
  alias for `~/` for the active workspace. Underlying OPFS layout
  unchanged (still `clawser/workspaces/{wsId}/`).
- Live `$HOME` re-export on workspace switch — fresh shell sessions
  built via `createConfiguredShell` read `loadWorkspaces()` and set
  `HOME = /home/<active-sanitized-name>`. New `setActiveHomeName(...)`
  on `ClawserShell` propagates to `state.activeHomeName` and the
  underlying `ShellFs`.
- Cross-workspace isolation: `/home/<other>/...` reads ENOENT (path
  routes to a never-created `_isolated_/` subtree), writes throw
  `Cross-workspace write denied: …`. Enforced both at the shell
  redirect layer (fs-agnostic) and `ShellFs.#guardWrite` (defense
  in depth).
- `web/clawser-workspace-name.mjs` — `sanitizeWorkspaceName` and
  `buildSanitizedNameMap` produce filename-safe names with stable
  conflict suffixes (NFKD, lowercase, alphanumerics + dash + underscore,
  reserved names rejected).
- `/proc/clawser/workspaces` virtual file lists every workspace with
  id, name, `/home/<sanitized>` path, and active marker.
- 34 new tests across `clawser-workspace-name.test.mjs` (18) and
  `clawser-home-alias.test.mjs` (16).
- `docs/unix-filesystem-architecture.md` updated with the new path
  resolution + sanitization rules.

### Fixed (2026-05-04 issue triage pass)
- **`ls` no longer hides real files when virtual entries exist at the
  same path.** `VirtualFs.listDir` was early-returning virtual / device
  entries, silently dropping every realFs entry under a directory that
  also contained any `/proc/`-style virtual file. Symptom: `echo > /foo;
  ls /` showed only `proc/`, never `foo`. Fixed by merging virtual +
  device + real entries (virtual wins on name collision; real entries
  never hidden when names don't collide). Regression test:
  `web/test/clawser-virtualfs-listdir-merge.test.mjs` (4 tests).
  `web/clawser-proc.js`.
- **CLI model selection now persists across reloads.** `clawser model X`
  and `clawser config set model X` were calling `agent.setModel(value)`
  but never `agent.persistConfig()`, so the change vanished on reload.
  Additionally, `applyRestoredConfig` was overwriting the saved model
  with the account's default during `onProviderChange()`. Both fixed:
  CLI commands now persist; restore re-applies `savedConfig.model`
  after the provider switch so explicit overrides win. Regression test:
  `web/test/clawser-cli-model-persist.test.mjs` (4 tests).
  `web/clawser-cli.js`, `web/clawser-accounts.js`.

### Added (2026-05-03 deploy follow-ups pass)
- **Capability enforcement actively wired (closes B.2).**
  - `web/clawser-skill-capabilities.mjs` — `createSkillCapabilityAPI`
    returning capability-gated `{fetch, fs, mesh}` callables;
    `wrapSkillScript` produces a runnable async wrapper that exposes
    them as locals to the skill source. Errors point at the missing
    `manifest.capabilities.<kind>` declaration.
  - `executeSkillScript` exported from `web/clawser-skills.js` — when
    `capabilities` is present, runs in a same-realm AsyncFunction with
    the gated bridge; otherwise uses the existing andbox Worker
    sandbox path.
  - `SkillScriptTool` accepts `{capabilities, capabilityHooks}` in its
    constructor.
  - `acceptPackage` builds the manifest's capability token via
    `buildCapabilityToken` and threads it through every applyBatch
    item alongside `itemKind`. Stores persist `(item, capabilities)`
    together so the registry can construct the gated tool at activation.
- **Y.js applicator wired through to clawser-peer-collab (closes A.3).**
  - `web/clawser-yjs-applicator.mjs` — `YjsApplicatorRegistry` lazy-creates
    `YjsAdapter` instances per `itemId`; `applyUpdate(itemId, update)`
    routes inbound updates with a `REMOTE_ORIGIN` tag; `bindForSync`
    wires the adapter's `onUpdate` to `syncEngine.queueLocal` for
    outbound dispatch (skipping the REMOTE_ORIGIN echo loop).
  - Convergence verified across two simulated peers via a FakeY mock
    with commutative-merge semantics; LWW-on-key resolution converges
    on both peers.
- 38 new tests across `clawser-skill-capabilities.test.mjs` (18),
  `clawser-skills-cap-integration.test.mjs` (8),
  `clawser-yjs-applicator.test.mjs` (12).
- `docs/DEPLOY.md` updated with the active-enforcement section
  (capability errors, the same-realm vs Worker sandbox decision, and
  the wiring path through `executeSkillScript` /
  `SkillScriptTool` / `acceptPackage`).

### Added (2026-05-03 deploy targets pass)
- **Personal multi-device sync (Phase A).**
  - `web/clawser-pairing.mjs` — QR / 6-digit-code pairing flow.
    PBKDF2-SHA256 (100k) → AES-GCM-encrypted identity bundle, 5-minute
    TTL, replay-protected via per-target consumed-id cap.
  - `web/clawser-sync-flags.mjs` — `__sync_flags__` per-item opt-in store.
  - `web/clawser-sync.mjs` — `SyncEngine` with debounced 500ms outbound
    queue, LWW + Y.js dispatch, atomic apply with snapshot-rollback on
    error, per-peer routing via `pod.sendMessage`.
  - `web/clawser-deploy.mjs` — `recordLocalChange` / `runDeploy` /
    `buildDeployPreview` orchestration over the engine.
- **Remote deploy targets (Phase B).**
  - `web/clawser-deploy-package.mjs` — `clawser-deploy-v1` signed
    package format. Ed25519 signature over canonical-JSON manifest +
    counter + source; payload bytes bound by SHA-256 hashes.
    `ReplayCounterTracker` enforces strict-monotonic per-source counters.
  - `web/clawser-deploy-target.mjs` — `DeployAcl`, `DeployApprovals`,
    `DeployAuditLog`, `DeploySnapshotRing`, capability-token primitives
    (`buildCapabilityToken`, `enforceCapabilityRequest`,
    `CapabilityDeniedError`), and the `acceptPackage(pkg, ctx)`
    end-to-end pipeline.
- 120 new tests across six files.
- `docs/DEPLOY.md` — protocol, package format, ACL/manifest semantics,
  audit format, threat model (compromised source, compromised target,
  compromised paired device, what we do not attempt).
- `docs/browsermesh/specs/extensions/sync-protocol.md` — wire-format
  spec for pairing, sync envelopes, signed deploy packages, and
  receiver check ordering.

### Added (2026-05-03 vault Option F pass)
- Wrapped-DEK vault model (`web/clawser-vault.js` v2): one DEK encrypts
  every secret; one or more KEKs wrap the DEK as separate unlock paths.
  Atomic v1→v2 migration on first unlock of legacy vaults. See
  `docs/VAULT.md`.
- WebAuthn passkey enrollment + unlock with the PRF extension —
  `web/clawser-passkey.mjs` (`isPasskeyPRFSupported`, `enrollPasskey`,
  `assertPasskeyForUnlock`); `vault.addPasskeyWrap` /
  `vault.unlockWithPasskey` / `vault.removeWrap` /
  `vault.peekPasskeyCredentialIds` / `vault.peekPrfSalt` /
  `vault.getOrCreatePrfSalt`. Vault-level shared PRF salt.
- "Change passphrase" UI surface in the vault modal settings panel
  (`vaultChangePassBtn` + `vaultChangeForm`). 12-char minimum, rejects
  identical/mismatched inputs.
- "Passkeys" management UI in the vault settings panel
  (`vaultManagePasskeysBtn` + `vaultPasskeysForm`): list registered
  passkeys with last-used timestamps, add/remove with the last-unlock-path
  guard.
- "Unlock with passkey" button on the vault lock screen, shown only when
  passkey wraps exist and the browser supports PRF.
- 63 new tests across `clawser-vault-v2.test.mjs` (33),
  `clawser-vault-settings.test.mjs` (16), `clawser-passkey.test.mjs` (14).
- `docs/VAULT.md` documenting the v2 format, unlock paths, migration
  crash-safety matrix, and the deliberate non-shipping of recovery codes.

### Changed (2026-05-03 vault Option F pass)
- `VaultRekeyer.execute` is now a thin wrapper that delegates to
  `vault.changePassphrase` (rewraps the DEK rather than re-encrypting
  every secret). Existing test mocks that don't expose `changePassphrase`
  fall back to the legacy re-encrypt path so callers compile.
- The TODO at the previous `clawser-vault.js:251` ("vault recovery codes")
  is gone — replaced by `docs/VAULT.md`'s rationale for not shipping codes.

### Added (2026-05-03 quick-wins pass)
- `web/clawser-presence.mjs` — `PresenceService` (online/idle/offline
  per peer with timestamps, subscribes to PeerNode events). 25 tests.
- `web/clawser-silent-catch.mjs` — debug-gated structured logger for
  intentional silent catches. 4 tests.
- "Mesh / Relay" Settings UI section (relay URL, signaling URL,
  auto-connect checkbox). Round-trips with existing localStorage keys.
  9 tests.
- `state.presenceService` wired in `initMeshSubsystem`.
- `clawser_relay_auto_connect` localStorage flag — when "true",
  `initMeshSubsystem` calls `relayClient.connect()` after pod boot.

### Changed (2026-05-03 quick-wins pass)
- Helia CDN URL bumped `6.0.21` → `6.1.4` (latest); verified-on date
  added in comment. `web/clawser-peer-ipfs.js` and
  `packages/browsermesh-apps/src/peer-ipfs.mjs`.
- 126 silent catch blocks (`} catch { /* ignore */ }`,
  `/* non-fatal */`, `/* best-effort */`) converted to
  `} catch (e) { silentCatch('module', 'op', e) }`. No-op by default;
  surfaces structured records once `clawserDebug.enable()` is called.

### Added (2026-05-02 follow-up pass)
- `web/clawser-panel-dirty.mjs` — per-input dirty-tracking helper (15 tests)
- `state.fsUiSync.registerPanel(domain, { render })` calls in
  `createShellSession` for all six config domains (autonomy, identity,
  security, daemon, terminal, hooks) — closes Phase 7 read direction
- `ClawserPod.sendMessage(peerId, envelope)` — public unicast API
- `PeerNode.sendTo(pubKey, data)` and `PeerNode.hasActiveSession(pubKey)` —
  underlying per-peer transport accessor
- Wired `state.pod.sendMessage` as the `sendFn` in
  `addMeshPeerDevice(...)` calls so writes to `/dev/clawser/mesh/peers/{id}`
  actually dispatch
- `renderSecuritySection(config)` and `renderTerminalSection(config)`
  exports on `clawser-ui-panels.js` (so all six panels have a render
  function callable from FsUiSync)
- Refactored `renderAutonomySection`, `renderIdentitySection`,
  `renderHeartbeatSection`, `renderHooksSection` to accept an optional
  `config` arg and use dirty-aware setters
- yaml data layer entries: snapshots (tar backend + CLI), USTAR Tar Format,
  mesh peer device files, RPC HTTP transport, PWA Install Flow
- `_meta.yaml` counters refreshed (modules: 240, tests: 8884, files: 305,
  builtins: 65, mesh modules: 44, generated: 2026-05-02)

### Added (2026-05-02 gap-closure pass)
- `web/clawser-tar.mjs` — pure-JS POSIX USTAR writer/reader (17 tests)
- `web/clawser-pwa-install.js` — PWA install flow (capture
  `beforeinstallprompt`, `tryInstall()`, `getInstallState()`,
  `onInstallStateChange()`, `isStandalone()`, `detectPlatform()`) — 9 tests
- HTTP RPC transport — `clawser rpc --rpc-http :PORT --rpc-host H --rpc-token T`
  with auto-generated bearer token (3 tests)
- Shell tab completion — `getCompletions()` in `clawser-shell.js`, wired into
  the terminal input via Tab with cycle-through (9 tests)
- `PEER_TYPE` enum + `peerType` field on `DiscoveryRecord` with normalization
  for forward-compat (5 tests)
- `registerMeshPeerDevice` — `/dev/clawser/mesh/peers/{peerId}` device files,
  read returns JSON metadata, write requires `sendFn`. Wired to
  `discoveryManager.onPeerDiscovered/onPeerLost` events.
- W3C did:key encoding (`MeshIdentityManager.toDID`) with base58btc
  multicodec; `toLegacyDID` retained for backward compat
- `injectEnvIntoShell` wired into `createConfiguredShell`
- `state.fsUiSync.saveValue` write-through across all 6 config panels
  (autonomy, identity, security, daemon, terminal, hooks)
- Hardware device files (`/dev/clawser/hardware/*`) populated from
  `peripheralManager.listDevices()`
- `state.tunnelManager` instantiated at boot with Cloudflare + ngrok
  providers
- `initWorkspacesCache()` — async OPFS-first workspace registry with
  one-time localStorage migration (5 tests)
- `state.fsUiSync` (FsUiSync instance) on workspace init
- Tar-on-OPFS snapshot CLI (`snapshot save/restore/list/delete` use
  `~/.local/share/clawser/snapshots/{id}.tar` by default)
- Manifest gained `id`, `display_override`, `categories`, `shortcuts`,
  `prefer_related_applications: false`

### Changed
- All five browsermesh specs flagged as "Implemented, not wired" turned out
  to be already wired — specs updated to reflect reality
- `ClawserPod.initMesh()` smoke test added pinning the wiring
  (`clawser-pod-mesh-wiring.test.mjs`)
- `OUTSTANDING.md` rewritten to reflect post-pass state

### Earlier in Unreleased
- 2 error categories: `timeout` and `content_filter`
- Kernel integration: wired up steps 23, 25, 26, 29, 30 of kernel roadmap
- Memory system tests (78 tests)
- UI module tests (185 tests across 6 files)
- Data-driven documentation: YAML data layer, doc generator, 22 screenshots, 21-page guide

### Fixed
- `ext_screenshot` overflow bug
- Terminal `cd` with dotfiles
- 2 pre-existing test failures (TabWatcher, WSH roadmap consistency)
- Channel device reads now pull from `channelManager.getHistory` (was
  returning never-set `state.lastReceived`)
- Provider device dead `responsePromise` local removed
- clsh nested function calls no longer leak positional params
- `isIncomplete` keyword detection is now quote-aware
- Test runner count variance — `web/test/run-tests.mjs` rewritten to
  spawn one subprocess per file with drain-then-kill instead of
  `--test-force-exit`. Five consecutive full runs now hit 8887/1884
  identically. Two leak-fixes (`clawser-workspace-cleanup.test.mjs`
  `.unref()`, `clawser-app.test.mjs` `after()` exit). See
  `docs/cross-validation-2026-05-02.md` for the full investigation.

## [0.1.0-beta] — Phase 10: Package Extraction

### Changed
- All core packages extracted to standalone npm repos, published, and deployed
- All test imports rewritten to use npm packages via bridge modules
- `web/packages-*.js` bridge files re-export from npm packages

## Phase 9.11 — Subsystem Wiring

### Added
- Wire code collision fix (21 codes migrated)
- 11 subsystems wired into bootstrap
- SW mesh routing, WebTransport bridge, cross-origin comms, WebRTC mesh
- Mesh DevTools inspector (5 new modules, 139 new tests)

## OpenClaw Final — Channel Gateway

### Added
- `clawser-gateway.js` — scheduler/routine lane through gateway
- Kernel tenantId threading, per-channel serialized queues, virtual channel keys
- 105 gateway tests

## Phase 9 — BrowserMesh Integration

### Added
- 30 new modules for decentralized mesh: identity, trust, CRDT sync, P2P transport, naming, real transports, resource scheduling, payments, consensus, swarm coordination

## Phase 8 — Remote Runtime Access (wsh)

### Added
- Canonical runtime registry, session broker, reverse host parity
- VM console peers, route policy, remote filesystems, audit convergence

## Phase 7 — Virtual Server Subsystem

### Added
- SW fetch intercept, ServerManager, function/static/proxy handlers
- 8 agent tools, FetchTool auto-routing, kernel svc:// integration, Servers UI panel

## 0.1.0-beta — Feature Module Integrations

### Added
- 9 feature module integrations with 36 new agent tools
- Phase 2 UI/agent loop wiring for all 30 blocks

## Batch 3 — Panel Enhancements

### Fixed
- 9 API mismatch fixes
- Panel enhancements and agent loop integration

## Batch 2 — Router & State

### Changed
- Router single source of truth
- State namespacing

## Batch 1 — Security Fixes

### Fixed
- Critical security and safety fixes across 7 areas

## Phase 3 — Feature Modules

### Added
- Blocks 12 (git), 13 (hardware), 14 (channels), 15 (remote), 16 (OAuth), 18 (browser auto), 21 (routines), 28 (sandbox), 29 (heartbeat)

## Phase 2 — Infrastructure

### Added
- Blocks 0 (bridge→wsh), 2 (mount), 3 (daemon), 8 (goals), 9 (delegation), 10 (metrics), 11 (fallback), 17 (skills registry), 19 (auth), 22 (self-repair), 24 (tool builder), 25 (undo), 27 (intent)

## Phase 1 — Core Systems

### Added
- Blocks 1 (shell), 4 (memory), 5 (vault), 6 (autonomy), 7 (identity), 20 (hooks), 23 (safety), 26 (cache)

## Phase 0 — Initial Release

### Added
- Full codebase: pure JS agent, modular UI, providers, tools, tests
- Post-modularization fixes
