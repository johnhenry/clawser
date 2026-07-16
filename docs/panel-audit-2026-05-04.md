# Panel/View Wiring Audit — 2026-05-05

**Status: resolved as of 2026-07-16** (dated snapshot, not live guidance).
All surfaced gaps (orphan modules, stubbed panel actions) were closed by
the follow-up in `docs/panel-convergence-2026-05-04.md`; this file retains
standalone value as the baseline per-panel inventory.

> A "fully wired end-to-end" sweep across every UI panel in the
> Clawser web app. Tests still green: **9361 / 0 fail.**

The recurring "primitives shipped, integration pending" pattern keeps
surfacing — most recently in the deploy-targets work. This audit
enumerates every UI panel and verifies, dimension-by-dimension,
whether it actually functions end-to-end in the running app or
whether the render+bind layer was shipped without the production
controller.

## Method

For each panel:

1. **Mount** — does the panel module get imported and instantiated by
   production code? (Trace: `clawser-app.js` →
   `clawser-ui-panels.js` → `clawser-workspace-init-ui.js` →
   `clawser-workspace-init-mesh.js` → `clawser-workspace-init-tools.js`
   → `clawser-workspace-lifecycle.js`. Plus the toggle-button click
   handlers that lazy-load secondary sections.)
2. **Inputs honored** — every form input persists somewhere meaningful,
   comes back on reload.
3. **Actions wired** — every button/dropdown/toggle invokes a real
   backend, not a `console.log` stub or a no-op `addMsg`.
4. **Reactive updates** — re-renders when backing data changes from
   outside the panel.
5. **Cleanup** — unsubscribers / `clearInterval` / `removeEventListener`
   on destroy.
6. **Cross-workspace isolation** — re-renders on workspace switch with
   the new workspace's data.

---

## Summary

| Panel | Mount | Inputs | Actions | Reactivity | Cleanup | WS-switch | Notes |
|---|---|---|---|---|---|---|---|
| Chat | mounted | ok | ok | ok | ok | ok | 1358 LOC, primary view |
| Tools (registry) | mounted | n/a | ok | ok | n/a | n/a | Click cycles permission |
| Files | mounted | ok | ok | ok (event bus) | n/a | ok (lazy registry) | |
| Memory | mounted | ok | ok | ok | n/a | ok | |
| Goals | mounted | ok | **fixed** | ok | n/a | ok | Inline edit was silently dropped — fixed inline this pass |
| Events | mounted (in chat) | n/a | n/a | ok | n/a | ok | Append-only viewer |
| Skills | mounted | ok | ok | ok | n/a | ok | |
| Terminal | mounted | ok | ok | ok | ok | ok | TerminalSessionManager |
| Dashboard | mounted | n/a | ok | ok | n/a | ok | |
| Servers | mounted | ok | ok | ok (manual refresh) | n/a | ok | Add form, start/stop, logs |
| Tool Mgmt | mounted | n/a | ok | ok | n/a | ok | Tabs: tools, perms, shell |
| Agents | mounted | ok | ok | ok | n/a | ok | |
| Channels | mounted | ok | ok | partial | n/a | ok | No subscribe to channelManager mutations from outside |
| Marketplace | mounted | ok | ok | ok | minor leak | ok | Cleanup fn returned but never called → style el lingers |
| Swarms | mounted | ok | **partial-stub** | partial (manual) | n/a | ok | Join/Leave/Disband/Remove only addMsg; Create ignores maxAgents+members |
| Transfers | mounted | ok | **stub** | partial | n/a | ok | `initTransferListeners()` called with no opts → onSend/onCancel never fire |
| Mesh dashboard | mounted | n/a | **stub** | partial | n/a | ok | All four quick actions do nothing real (ExecRemote opens a modal with no submit handler) |
| Peers | mounted | ok | ok | ok (manual refresh) | n/a | ok | Identity wallet, contacts, sessions, audit log |
| Remote (wsh) | mounted | ok | ok | ok | ok | ok | Remote terminal/files/runtime |
| Config — Autonomy | mounted | ok | ok | ok | n/a | ok | Reactive via FsUiSync |
| Config — Identity | mounted | ok | ok | ok | n/a | ok | Saves to identity manager |
| Config — Identity Editor (full) | mounted | ok | ok | ok | n/a | ok | AIEOS v1.1 |
| Config — Security | mounted (toggle) | ok | ok | partial | n/a | ok | API-key warning + quota bar render on open |
| Config — Self-repair | mounted | ok | ok | ok | n/a | ok | |
| Config — Limits | mounted | ok | ok | ok | n/a | ok | |
| Config — Sandbox | mounted | ok | ok | ok | n/a | ok | |
| Config — Heartbeat | mounted | ok | ok | ok | n/a | ok | |
| Config — Hooks | mounted | ok | ok | ok | n/a | ok | |
| Config — OAuth | mounted | ok | ok | ok | n/a | ok | |
| Config — Routing | mounted | ok | ok | ok | n/a | ok | |
| Config — Auth Profiles | mounted | ok | ok | ok | n/a | ok | |
| Config — Mesh Relay | mounted (toggle) | ok | ok | partial | n/a | ok | Renders on open |
| Config — Shared Worker | mounted | ok | ok | ok | n/a | ok | |
| Vault settings | mounted | ok | ok | ok | ok | n/a (global) | Lock, change passphrase, passkey enroll/list/remove |
| My Devices | mounted (toggle) | ok | ok | ok (subscribe) | ok | **fixed** | WS-switch reactivity gap fixed inline |
| Trusted Publishers | mounted (toggle) | ok | ok | partial (action-wrap re-render) | ok | **fixed** | Same |
| Guest FS | mounted | ok | ok | ok | n/a | ok | v86 guest mount |
| **clawser-ui-diff.js** | **ORPHAN** | n/a | n/a | n/a | n/a | n/a | `renderDiff` exported, never imported in production |
| **clawser-ui-drop.js** | **ORPHAN** | n/a | n/a | n/a | n/a | n/a | `DropHandler` exported, never imported in production |

Headline: of 38+ panel surfaces audited, **2 are orphans** (code+tests
exist, never integrated) and **3 are partially stubbed** in production
(mesh dashboard, swarms, transfers). The rest are correctly wired.

---

## Fixes applied this pass (contained)

### 1. Goals — silent edit failure → fixed

**Bug.** `clawser-ui-goals.js` inline-edit handler called
`state.agent.getGoal?.(g.id)` — but `getGoal` did **not exist** on
`ClawserAgent`. The optional-chain returned `undefined`, the
`if (goalObj)` branch was skipped, the form closed cleanly, and the
edit was silently dropped. No error, no feedback. User clicks Save,
nothing changes, no warning.

**Fix.** Added two methods to `ClawserAgent`:

- `getGoal(id)` — returns the goal or `null`.
- `editGoal(id, {description?, priority?})` — patches mutable fields,
  stamps `updated_at`, fires `goal.edited` onEvent, appends a
  `goal_edited` entry to the event log.

Updated `clawser-ui-goals.js` to call `state.agent.editGoal(id, {description, priority})`
instead of mutating the goal object directly.

Also fixed `EventLog.deriveGoals()` which previously ignored
`goal_edited` AND `goal_removed` events — meaning a goal edited or
removed via the UI would re-appear if the agent ever rebuilt goals
from event-log replay (e.g. checkpoint loss recovery). Both events
now replay correctly.

**Tests.** `web/test/clawser-agent.test.mjs` gained 4 new cases:
- `getGoal returns the goal by id (and null when missing)`
- `editGoal updates description + priority and logs goal_edited`
- `editGoal returns false for unknown id and ignores empty patch`
- `deriveGoals replays goal_edited and goal_removed events`

### 2. Multi-device panels — workspace-switch reactivity gap → fixed

**Bug.** `mountMyDevicesPanel(state)` and `mountTrustedPublishersPanel(state)`
were only triggered by toggle-button clicks, not by workspace switch.
If the user opened the section, then switched workspaces, the panel
content stayed populated with the *previous* workspace's
`pairedDevices` / `deployTarget` data until the user manually
toggled the section closed and re-opened it.

**Fix.** Added `remountVisibleMultiDevicePanels(state)` to
`web/clawser-multi-device-panels.mjs` — re-mounts only the sections
whose `.visible` class is currently set in the DOM. Idempotent;
safe to call when nothing is open. Hooked into `switchWorkspace` in
`web/clawser-workspace-lifecycle.js` immediately after
`registerLazyPanelRenders`.

**Tests.** `web/test/clawser-multi-device-panels.test.mjs` gained
4 new cases covering: re-mount when My Devices section is visible,
re-mount when Trusted Publishers section is visible, no-op when
sections are closed, no-op when there is no document.

---

## Structural gaps — surfaced, not papered over

These are not contained one-line fixes — they're the
"primitives-shipped-controllers-missing" pattern that this audit
was specifically hunting. Listed for the next pass to address
deliberately.

### A. Two orphan modules with shipping tests

- `web/clawser-ui-diff.js` — exports `computeDiff`, `renderDiff`. Has
  test file (`web/test/clawser-ui-diff.test.mjs`). **Never imported in
  any production module.** Either delete or wire into a code-diff view
  somewhere (e.g., terminal artifact preview, undo/redo).
- `web/clawser-ui-drop.js` — exports `DropHandler`, `extractHandles`,
  `mountPathForHandle`. Has tests. **Never imported in production.**
  This is meant for drag-and-drop folder mounts but the actual mount
  flow uses `showDirectoryPicker` via `mountLocalFolder()` in
  `clawser-ui-files.js`. Decide: integrate into the Files panel as a
  drop zone, or remove.

### B. Mesh Dashboard quick actions are all stubs in production

`web/clawser-ui-mesh.js` defines `initMeshListeners({onExecRemote,
onDeploySkill, onDrainPod, onRefresh})`. The contract is: caller
supplies these handlers; the panel wires them to the four buttons.

**The production mount in `web/clawser-workspace-init-mesh.js:494`
calls `initMeshListeners()` with no opts at all.** Every button falls
through to the panel's "no-handler" fallback path:

- **Exec Remote** opens a modal with input fields (target pod ID,
  command) but the modal has no submit handler. Click the Execute
  button → nothing.
- **Deploy Skill** prints `addMsg('system', 'Deploy Skill: select a skill and target pod')` —
  an *instruction* string, not an action.
- **Drain Pod** prints `addMsg('system', 'Drain Pod: select a pod to gracefully disconnect')` —
  same.
- **Refresh** prints `addMsg('system', 'Refreshing mesh status...')` and
  does not actually refresh.

The user clicks any of these expecting the labelled action; they get
a status message and no behaviour. **Mounted, rendered, completely
non-functional in production.** Severity: important.

The fix is the same shape as the multi-device deploy fix this week:
build a controller (`buildMeshController(ctx)`) that wires the four
opts to real backend calls (`peerNode.sendTo` for ExecRemote,
`publishDeploy` for DeploySkill, `swarmCoordinator.disband` or
`peerNode.disconnectPeer` for DrainPod, `refreshMeshWorkspacePanel`
for Refresh) and pass the controller into `initMeshListeners`.

### C. Swarms panel actions partially stubbed

`web/clawser-ui-swarms.js` defines `initSwarmListeners({onJoin, onLeave,
onDisband, onRemove, onCreate, onRefresh})`. Mount in
`web/clawser-workspace-init-ui.js:99-112`:

- `onCreate` is wired to `state.swarmCoordinator.submitTask(opts.goal,
  opts.strategy || 'round_robin', {})` — but **only goal+strategy are
  used**; the form's `maxAgents` and `members` fields are silently
  ignored.
- `onJoin`, `onLeave`, `onDisband`, `onRemove` are **not passed at
  all**. Every Join/Leave/Disband/Remove button in every swarm card
  falls through to the panel's `if (opts.onJoin)` (skipped) and just
  fires an `addMsg` like "Joining swarm xxx...". The actual `onJoin`
  call never happens. The user thinks they joined; nothing changed.

Severity: important. Fix shape: a real controller that maps the four
membership actions to `swarmCoordinator.{joinSwarm, leaveSwarm,
disbandSwarm, removeSwarm}` (assuming those exist; if not, that's a
deeper gap), and changes `onCreate` to honour all four form fields.

### D. Transfers panel send/cancel are stubs

`web/clawser-ui-transfers.js` exposes `initTransferListeners({onSend,
onCancel})`. Mount in `web/clawser-workspace-init-ui.js:122` calls
`initTransferListeners()` — no opts. Every drag-drop, file-picker,
or cancel-button click runs through `if (opts.onSend) opts.onSend(...)`
(skipped), then fires `addMsg('system', 'Sending N file(s) to X...')`.
**No actual send.** Same for Cancel buttons.

Severity: important. Fix shape: pass `onSend: (files, targetPeerId) =>
state.fileTransfer.send(files, targetPeerId)` and `onCancel: (id) =>
state.fileTransfer.cancel(id)` in the lazy-render mount.

### E. Marketplace panel — minor cleanup leak

`renderMarketplace(container, marketplace, opts)` returns a `cleanup`
function that removes the injected `<style id="mp-marketplace-styles">`
element. The lazy-mount in `clawser-workspace-init-ui.js:84-92`
discards the returned cleanup, so on workspace switch the same style
element accumulates (idempotent — same id, dedup'd by line 235-241 of
the marketplace module — so this is *not* a memory leak, just a
process leftover). Severity: minor / cosmetic.

### F. Multi-device controller wraps trusted-publishers double-binds

`mountTrustedPublishersPanel` in
`web/clawser-multi-device-panels.mjs` calls `bindTrustedPublishersPanel`
twice: once with the unwrapped controller (line 153), unbinds (line
171), then rebinds with the wrapped controller (line 172). Functional,
but inefficient — redundant DOM listener churn on each mount.
Severity: minor / cosmetic. Fix shape: build the wrapped controller
first, bind once.

### G. Channels panel is not reactive to external mutations

`renderChannelPanel()` is invoked manually after each in-panel
mutation. There is no subscribe to `state.channelManager`. If a
channel is added/removed/toggled from outside the panel (e.g., via a
slash command or scheduled task), the panel won't refresh until the
user re-opens it.

Severity: minor — the typical mutation paths *do* call
`renderChannelPanel()` themselves, but it's a footgun for future
out-of-panel callers.

---

## Cross-cutting findings

### Pattern 1 — "shipped without the controller" (this audit's headline)

Three panels (mesh, swarms, transfers) all land render+bind functions
that take an `opts` callback bag, then the lazy-mount code passes
**no opts at all** (or only a subset). The result: clickable UI that
appears to work but does nothing real, plus a misleading
`addMsg('system', ...)` line that gives the user a false signal.

The deploy-targets work this week followed exactly this pattern (panel
shipped 2026-05-04 with all-stubs; controllers + mount landed
2026-05-05). The fix shape is repeatable:

1. Write a `buildXController(ctx)` module that returns the opts bag.
2. Mount call: `initXListeners(buildXController({state, ...deps}))`.
3. Tests for the controller shape (no-DOM, just verify each opt
   dispatches to the right backend).

Estimate per panel: S-M (mesh has the most — 4 actions × ~15 lines
each + a controller test file with ~6 cases).

### Pattern 2 — `setInterval` discipline is good

Zero `setInterval` calls across the 24 UI modules audited. The earlier
bug-hunt that surfaced unrefed setIntervals targeted non-UI modules
(daemon, heartbeat, peer-node) and those were already fixed. UI
panels stick to event-driven rendering.

### Pattern 3 — `addEventListener` without `removeEventListener`

UI modules generally don't unregister listeners on workspace switch
because the *panel HTML itself* is replaced (`element.outerHTML = ...`
or `container.innerHTML = ...`), which detaches all child listeners
in one step. This is OK as long as document-level listeners aren't
attached inside render functions. Spot-checked: only
`clawser-ui-panels.js` registers document-level listeners
(`document.addEventListener('click', ...)` at lines 1356, 1990, 2004),
all in `initPanelListeners()` which is called once at startup — fine.

### Pattern 4 — Most lazy-mounted panels DO get workspace-switch reactivity

The lazy-panel registry (`registerLazyPanelRenders` in
`web/clawser-workspace-init-ui.js`) re-runs the render function for
already-rendered panels on workspace switch. So tools / files / goals
/ skills / etc. correctly reflect the new workspace's data
automatically. The exception was the multi-device sections (toggle-mounted
under Config), now fixed.

---

## Test count delta

- Before this audit: **9353 tests / 0 fail**
- After contained fixes: **9361 tests / 0 fail** (+8: 4 new agent
  tests for `getGoal`/`editGoal`/`deriveGoals` replay, 4 new
  multi-device-panels tests for `remountVisibleMultiDevicePanels`).

Three consecutive stable runs at the end of the pass.

---

## What we did NOT fix this pass (and why)

- **Mesh / Swarms / Transfers controllers (gaps B/C/D).** These are
  not contained one-line patches — each panel needs a real controller
  module + tests + a wiring update. Following the brutal-honesty rule:
  surfaced them here so the next pass can address them deliberately
  rather than papering over with another "addMsg-only" half-fix.
- **Orphan modules (gap A).** Decision needed: integrate or remove.
  Either choice should be deliberate, not slipped into an audit pass.
- **Marketplace cleanup leak (E) and trusted-pubs double-bind (F).**
  Cosmetic only — neither affects user-visible behaviour. Logged
  here; fix when adjacent code is touched.
- **Channels external-mutation reactivity (G).** No current external
  caller mutates channels, so it doesn't manifest. Logged.

---

## Reference files modified

- `web/clawser-agent.js` — added `getGoal`, `editGoal`; extended
  `deriveGoals` to replay `goal_edited` and `goal_removed`.
- `web/clawser-ui-goals.js` — inline edit now uses `editGoal`.
- `web/clawser-multi-device-panels.mjs` — added
  `remountVisibleMultiDevicePanels`.
- `web/clawser-workspace-lifecycle.js` — `switchWorkspace` calls the
  new remount helper.
- `web/test/clawser-agent.test.mjs` — 4 new tests.
- `web/test/clawser-multi-device-panels.test.mjs` — 4 new tests.
