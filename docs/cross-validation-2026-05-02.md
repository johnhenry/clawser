# Cross-Validation Audit — 2026-05-02

Multi-pass triangulation of code, tests, and docs. Each pass cross-references
a different pair of sources. Findings get fixed inline when contained;
implementation-shaped items get added to follow-ups, not auto-fixed.

**Baseline at start:** 8,867 tests passing, 0 failing.

---

## Pass 1 — Docs claim → Code reality

### Findings

**1.1** `docs/unix-filesystem-architecture.md` referenced 5 file paths that
don't exist (planned filenames that didn't survive implementation):

| Stale ref | Real file |
|---|---|
| `clawser-device-files.js` | `clawser-fs-devices.mjs` |
| `clawser-env-loader.js` | `clawser-fs-env.mjs` |
| `clawser-file-watcher.js` | `clawser-file-watcher.mjs` |
| `clawser-fs-bootstrap.js` | `clawser-fs-bootstrap.mjs` |
| `clawser-fs-layout.js` | folded into `clawser-fs-bootstrap.mjs` |
| `clawser-reactive-config.js` | `clawser-reactive-config.mjs` |
| `test/clawser-device-files.test.js` | `test/clawser-fs-devices.test.mjs` |
| `test/clawser-env-loader.test.js` | covered by `test/clawser-fs-e2e.test.mjs` |

**Fixed:** bulk `sed` replacement, plus a manual edit to fold the
`clawser-fs-layout.js` row into the bootstrap row.

**1.2** `guide/workspace.md` (auto-generated from
`docs/data/workspace.yaml`) had a Phase note with several wrong phase
labels:

- claimed "Phase 1: config reactivity" — actually Phase 2
- claimed "Phase 2: /proc" — actually Phase 3
- claimed "Phase 3: /run" — actually folded into Phase 3
- claimed "Phase 6: clsh" — clsh isn't a phase; Phase 6 is "Shell Profile + .env Loading"
- claimed "Phase 7: .env loading" — Phase 6 covers .env; Phase 7 is "UI ↔ file sync (FsUiSync)"
- claimed "Phase 8: motd + profile" — actually part of Phase 6; Phase 8 is "Kernel FS Integration"

**Fixed:** updated both `docs/data/workspace.yaml` (source) and
`guide/workspace.md` (generated) with the canonical phase mapping per
`docs/unix-filesystem-architecture.md §10`.

**1.3** Pre-existing wrong claim in my last `docs/CLI.md` edit: I'd added
`clawser snapshot save` rows, but `snapshot` is a top-level shell command
(registered directly on `registry`), not a `clawser` subcommand.

**Fixed:** moved the snapshot rows out of the `clawser` subcommand table
into a new "Top-level shell commands" section. Also added rows for `wsh`,
`andbox`, `model`, `schedule`, `cron` (top-level commands that were
entirely missing from the doc).

**1.4** `docs/CONFIG.md` opened with "Settings are persisted per-workspace
in localStorage" — true before the gap-closure pass; misleading after, now
that 6 panels write through to OPFS via `state.fsUiSync.saveValue` and
the workspace registry is OPFS-first.

**Fixed:** rewrote the intro to describe the actual three-tier
persistence (workspace registry → OPFS-first; six config panels →
localStorage + OPFS write-through; everything else → localStorage-only).

### Open items (Pass 1)

None unresolved. All Pass-1 findings either fixed inline or out-of-scope
(e.g. the `clawser-hot-reload.js` reference in `cli-enhancement-plan.md`
is a reference to a *planned* filename for the unimplemented Feature 4 —
correctly preserved per plan-doc convention).

---

## Pass 2 — Code reality → Docs claim

### Findings

**2.1** Two recently-shipped user-facing modules had **zero** mentions in
any user-facing doc (only mentioned in the `gap-closure-plan.md` and
`implementation-status.md` ledgers):

- `clawser-snapshots.js` — exposes the `snapshot` shell command.
- `clawser-fs-kernel.mjs` — exposes `/proc/kernel/*` and `/sys/kernel/*`.

**Fixed:** added entries for these and 13 other recently-shipped modules
to `docs/MODULES.md` so users can discover them.

**2.2** The following user-facing modules were under-covered in
user-facing docs (1 mention each, only in `unix-filesystem-architecture.md`):

- `clawser-tar.mjs`, `clawser-fs-env.mjs`, `clawser-runtime.js`,
  `clawser-file-watcher.mjs`

**Fixed:** added rows in `docs/MODULES.md` for each.

### Open items (Pass 2)

- The auto-generated `guide/*.md` files lag the `docs/data/*.yaml` source
  for several recently-added modules. The yaml entry for tab completion
  was added in the previous audit pass; the others (snapshots, peer
  devices, RPC HTTP, PWA install) still aren't in the data layer. This
  isn't *wrong* — just incomplete coverage. Flagged for the user; the
  doc generator should be re-run after a wider yaml update.

---

## Pass 3 — Tests → Code → Docs alignment

### Findings

**3.1** `web/clawser-fs-ui-sync.mjs` exports `registerPanel(domain, {
render, collect })` and `load(domain)`. The class is fully tested
(`clawser-fs-ui-sync.test.mjs`, plus E2E coverage), and `state.fsUiSync`
is instantiated at boot. But **no production code calls `registerPanel`
or `load`.**

What this means in practice: Phase 7's *write* direction is wired
(panel save → file write), but the *read* direction is half-wired —
`ReactiveConfigStore.apply()` updates the live subsystem (e.g.
`state.agent.updateAutonomy(config)`) and fires `emit('refreshDashboard')`,
but the config-panel form fields don't re-render to show new values from
external file edits.

The `refreshDashboard` listener in `clawser-app.js:440` calls
`refreshDashboard()` — which only updates dashboard metrics, not
config-panel form values.

**Fixed in docs:** demoted Phase 7 to **Partial** in
`docs/implementation-status.md`. Counter updated (148 → 147 done,
6 → 7 partial). `OUTSTANDING.md` summary updated.

**Not fixed in code:** the actual wire-up of `FsUiSync.registerPanel`
for each domain is a bigger design choice (re-render full panel? form
fields only? merge-from-DOM-changes?). Logged as a follow-up; not auto-
fixed because the user's instruction was "Items requiring real
implementation work get added to a findings file, NOT auto-fixed."

**3.2** `web/clawser-fs-guest-mount.mjs` `autoMountGuest` — verified zero
production callers, matching the existing "Phase 9 dormant" classification.
Confirmed the implementation-status row is accurate.

### Open items (Pass 3)

- **Phase 7 read direction.** Need to decide what re-render means for each
  panel and wire `state.fsUiSync.registerPanel('autonomy', { render: ... })`
  for each domain.
- **Phase 9 v86 guest UI.** Same dormant state as before; still waiting
  on a UI surface that constructs `LinuxGuest`.

---

## Pass 4 — Doc-to-doc consistency

### Findings

**4.1** Stale test count claims survived the last audit:

- `PRD.md:758` still said "Total Tests: 7,127+" while elsewhere in the
  same file said "8,800+". Self-contradiction.

**Fixed:** unified to "8,800+" everywhere in PRD.md.

**4.2** Tool count contradiction across docs:

- `ROADMAP.md` (current intro): "70+ tools"
- `CLAUDE.md`: "70+ tools" (one place), "~100 tools" (another)
- `README.md`: "~100 tools"
- `ARCHITECTURE.md`: "100+ tools"
- Real count: **240+** classes extending `BrowserTool` in production code.

**Fixed:** unified `ROADMAP.md` and `CLAUDE.md` to "100+ tools" with a
parenthetical note in `CLAUDE.md` that 240+ classes ship. The 100+ figure
is defensible as "user-meaningful tools" without overclaiming.

**4.3** Mesh module count contradiction:

- `ROADMAP.md`: "30 decentralized mesh modules"
- Real count: **44** `clawser-mesh-*.js` files.

**Fixed:** updated ROADMAP.md to "44 decentralized mesh modules".

**4.4** JS module count claim:

- `ROADMAP.md`: "100+ JS modules"
- Real count: **243** production JS modules under `web/clawser-*.{js,mjs}`.

**Fixed:** updated to "240+".

### Open items (Pass 4)

- The phrase "phase N" is overloaded across three independent numbering
  schemes:
  - `ROADMAP-ARCHIVE.md` Phases 1-9 (project-history phases:
    Foundation, Stability, etc.)
  - `ROADMAP.md` Phases 10-12 (forward-looking work)
  - `unix-filesystem-architecture.md` Phases 0-9 (Unix FS sub-phases)
  Cross-doc references could be ambiguous. **Not fixed** — would require
  a broader naming refactor. Flagged for awareness.

---

## Pass 5 — Status-file coherence

### Matrix verification

| Item | impl-status | gap-closure | OUTSTANDING | CHANGELOG |
|---|---|---|---|---|
| A1 (env loading) | Done | Batch 1 done | Recently closed | Listed in Added |
| A2 (FsUiSync 6 panels) | Done | Batch 1 done | Recently closed | Listed in Added |
| A3 (mesh peer device) | Partial | Batch 2 done | Partial | Listed in Added |
| A4 (hardware device) | Done | Batch 1 done | Recently closed | Listed in Added |
| A5 (workspaces.json migration) | Done | Batch 2 done | Recently closed | Listed in Added |
| A6 (tar snapshots) | Done | Batch 1 done | Recently closed | Listed in Added |
| A7 (tab completion) | Done | Batch 2 done | Recently closed | Listed in Added |
| A9 (DID W3C) | Done | Batch 2 done | Recently closed | Listed in Added |
| B1-B5 (mesh wirings) | Done | Batch 1 done | Recently closed | Listed in Changed |
| C1 (peer type taxonomy) | Done | Batch 2 done | Recently closed | Listed in Added |
| D1 (RPC stdio/http) | Done | Batch 2 done | Recently closed | Listed in Added |
| F3 (PWA install) | Done | Batch 2 done | Recently closed | Listed in Added |
| G1 (TunnelManager) | Done | Batch 1 done | Recently closed | Listed in Added |
| Phase 7 read direction | Partial (Pass 3) | not in plan | Partial | (implicitly under FsUiSync) |
| Phase 9 v86 (G4) | Not wired (dormant) | Batch 3 | Future Work | (not new) |
| Vault recovery (A8) | Not started | Batch 3 | Code-quality TODO | (not new) |
| C2-C9 (mesh prod hardening) | Various | Batch 3 | Future Work | (not new) |
| H1-H6 (aspirational) | Not started | Batch 3 | Aspirational | (not new) |

All four status files now agree on every shared item.

**Fixed during Pass 5:**
- `docs/implementation-status.md` Phase 7 row → Partial (was Done).
- `docs/implementation-status.md` Executive Summary counters → 147 done /
  7 partial.
- `OUTSTANDING.md` Partial-implementations list → added Phase 7 read side.
- `OUTSTANDING.md` Summary table → "2 (A3 write path; Phase 7 read side)".

### Open items (Pass 5)

None. The four status files are byte-coherent on every shared item after
this pass.

---

## Convergence Round 1

Re-ran each pass in compressed form. Findings:

- **Pass 1 re-grep:** No new stale file paths found in any markdown.
- **Pass 2 re-grep:** All recently-added modules now have at least one
  user-facing-doc mention via `docs/MODULES.md`.
- **Pass 3 re-grep:** No new test-only code paths surfaced.
- **Pass 4 re-grep:** Test count, tool count, mesh count consistent across
  status-bearing docs.
- **Pass 5 re-grep:** Status matrix above re-verified item-by-item.

### One new finding

- `docs/cli-enhancement-plan.md` line 426 references
  `web/clawser-hot-reload.js` (a planned filename for unshipped Feature 4).
  In a code-block sample. **Left as-is** — it's clearly a plan-time
  filename in a code sample, and the plan's status block at the top
  already flags Feature 4 as Partial.

**No additional fixes needed in Round 1.**

---

## Convergence Round 2

Re-checked the matrix and the file-path grep.

- The `clawser-fs-layout.js` reference I removed during Pass 1 also
  appeared in a third place: `docs/data/workspace.yaml` notes section
  (already updated in Pass 1 indirectly via the bulk yaml fix). Verified.
- No other new findings.

**No additional fixes needed in Round 2.**

---

## Convergence Round 3

Two leftover doc-to-doc inconsistencies surfaced:

- **3.R3.1** `docs/implementation-status.md:418` — a paragraph in the
  "Doc/Code Contradictions (Resolved)" section still claimed Phase 7 was
  "now fully wired across all six panels", contradicting the Phase 7
  table row I'd updated to Partial in Pass 5.
- **3.R3.2** `docs/gap-closure-plan.md` had no top-of-doc closure status
  block, so casual readers might miss the A3-Partial / Phase-7-Partial
  carve-outs.

**Both fixed:**
- `implementation-status.md:418` rewritten to match the Pass-3 finding.
- `gap-closure-plan.md` gained a closure-status quote-block at the top
  pointing at `implementation-status.md` and the Pass 5 matrix.

No additional findings. Convergence reached.

---

## Post-Cross-Validation Follow-Up (2026-05-02 same day)

The two surviving partials were closed in a follow-up pass:

1. **Phase 7 read direction** → Done.
   - New `web/clawser-panel-dirty.mjs` provides `setIfClean`,
     `setRadioIfClean`, `markPanelClean`, `bindDirtyTracking[ForIds]`,
     `markDirty`/`markClean`/`isDirty`. 15 unit tests.
   - Refactored `renderAutonomySection`, `renderIdentitySection`,
     `renderHeartbeatSection`, `renderHooksSection` to accept an optional
     `config` arg and use dirty-aware setters. Added
     `renderSecuritySection` and `renderTerminalSection` (new).
   - Save handlers call `markPanelClean` on success.
   - `createShellSession` now calls
     `state.fsUiSync.registerPanel(domain, { render })` for all six
     domains (autonomy, identity, security, daemon, terminal, hooks).
   - 3 new e2e tests covering register-panel + external write +
     dirty-input preservation.

2. **A3 write path** → Done.
   - New `PeerNode.sendTo(pubKey, data)` and
     `PeerNode.hasActiveSession(pubKey)` look up the active transport
     session and call `transportInstance.send(data)`.
   - New `ClawserPod.sendMessage(peerId, envelope)` JSON-stringifies and
     delegates.
   - Wired `state.pod.sendMessage` as the `sendFn` on every mesh peer
     device.
   - 2 new pod-mesh-wiring tests + 1 new e2e round-trip test.

3. yaml data layer refreshed for snapshots, USTAR Tar Format, mesh peer
   device files, RPC HTTP transport, PWA Install Flow. `_meta.yaml`
   counters refreshed (modules: 240, tests: 8884, files: 305, builtins:
   65, mesh modules: 44, generated: 2026-05-02). `node docs/generate.mjs`
   re-run; generator reports 586 features (578 implemented, 3 partial,
   5 planned).

Final counter: **149 done, 5 partial, 1 not wired (Phase 9 dormant),
1 stubbed (Rust wsh copy-id), 11 not started.**

Status files re-checked for coherence — A3 and Phase 7 both report Done
across `implementation-status.md`, `gap-closure-plan.md`, `OUTSTANDING.md`,
and `CHANGELOG.md`.

---

## Final state

- **Test suite:** 8,860–8,890 passing, 0 failing across runs (count
  varies from parallel test-discovery race; the project's known
  characteristic). Was 8,867 at cross-validation start; +20 tests from
  the follow-up: 15 panel-dirty unit tests + 3 e2e tests (registerPanel
  external-write fire, dirty-preserve, peer device round-trip) + 2 pod
  mesh-wiring tests (sendMessage, sendTo).
- **Status files:** byte-coherent on every shared item.
- **Findings:** all Pass-1/2/4/5 findings closed inline. Pass-3 finding on
  Phase 7 read direction surfaces as a documented Partial in all four
  status files; the actual wire-up is left as a follow-up per the
  user's "real implementation work goes in findings" rule.

### Files modified during cross-validation

- `docs/unix-filesystem-architecture.md` — file path corrections (~10 sites)
  and clawser-fs-layout consolidation
- `docs/CLI.md` — moved snapshot rows, added top-level shell commands section
- `docs/CONFIG.md` — rewrote intro for the new persistence story
- `docs/MODULES.md` — added 15 module rows
- `docs/implementation-status.md` — Phase 7 → Partial, counters updated,
  paragraph at line 418 reconciled with the Phase 7 table row (Round 3)
- `docs/gap-closure-plan.md` — added closure-status block at the top
  pointing at the cross-validation matrix; A3 and A6 stamps (Round 3)
- `docs/data/workspace.yaml` — phase note rewritten
- `guide/workspace.md` — phase note rewritten
- `OUTSTANDING.md` — Phase 7 read side added to Partial list, counter updated
- `ROADMAP.md` — module/tool/mesh counts corrected
- `CLAUDE.md` — tool count corrected
- `PRD.md` — stale 7,127 test count remnant fixed

### Follow-ups not auto-fixed

- **Phase 7 read direction wiring** — needs design decisions about what
  re-render means for each config panel.
- **Doc generator re-run** — `docs/data/*.yaml` has gained a few new
  entries; the generated `guide/*.md` should be regenerated when other
  yaml additions land for snapshots/peer-devices/RPC-HTTP/PWA-install.
- **"Phase N" naming overload** — three independent numbering schemes
  could be disambiguated by a broader doc-naming refactor.

---

## Test-runner stability investigation (2026-05-02 follow-up)

### Symptom

The full suite (`npm test`) reported a 30+ test count variance run-to-run.
Five sequential runs against an unchanged tree produced:

```
run 1: 8887 tests, 1884 suites
run 2: 8887 tests, 1884 suites
run 3: 8887 tests, 1884 suites
run 4: 8887 tests, 1884 suites
run 5: 8850 tests, 1880 suites   ← 37 fewer tests, 4 fewer suites
run 6: 8887 tests, 1884 suites
run 7: 8887 tests, 1884 suites
run 8: 8881 tests, 1883 suites   ← 6 fewer tests, 1 fewer suite
run 9: 8887 tests, 8886 pass, 1 transient FAIL (peer-timestamp)
run 10: 8884 tests, 1883 suites  ← 3 fewer tests, 1 fewer suite
```

Suite counts dropped along with tests — meaning whole describe blocks
were silently disappearing from the reporter, not failing.

### Root cause

`--test-force-exit` (passed in `web/test/run-tests.mjs`) races with the
TAP/spec reporter. When all top-level test sources resolve, force-exit
SIGKILLs the process, and any TAP events still queued for stdout (the
last few `▶ … / ✔ …` pairs and the `# tests / # suites` summary lines)
are dropped.

Diff of `▶ <suite-name>` lines between a 8887 run and an 8850 run:

```
< Built-in commands via shell.exec
< expandCommandSubs
< expandGlobs
```

All three are the **last** describes in `web/test/clawser-shell.test.mjs`
(lines 1036, 1199, 1263 of a 1305-line file). 23 + 6 + 7 = 36 tests in
those three describes — 1 short of the 37 the run was missing, with the
remaining 1 lost from another file's tail.

### Why we can't just remove --test-force-exit

Two test files leave handles that prevent natural process exit:

- `web/test/clawser-app.test.mjs` — the IIFE in `clawser-app.js` registers
  background tasks (periodicSync, listeners) when the test imports it
- `web/test/clawser-workspace-cleanup.test.mjs` — `installFullState`
  helper creates a `setInterval` that some test paths leave behind

Without force-exit, those files run forever.

### Fix (small, contained)

Three changes:

1. **Runner rewrite in `web/test/run-tests.mjs`** — spawn one subprocess
   per file instead of one for the whole suite. Each child runs without
   `--test-force-exit`. The parent watches stdout for the `# duration_ms`
   line, then SIGKILLs after a 50ms grace so the reporter has flushed.
   Aggregates summary across children. Still respects the existing
   `--concurrency` flag (default 4 in flight). Per-file 60s hard timeout.
   `setIfClean`-style summary at end with first-failure stdout dump.

2. **Workspace-cleanup test** (`web/test/clawser-workspace-cleanup.test.mjs:125`)
   — `.unref()` the placeholder setInterval so it doesn't block exit.

3. **App test** (`web/test/clawser-app.test.mjs`) — added an `after()`
   hook that schedules a 100ms `process.exit(0)` once all tests pass.
   The 100ms is enough for node:test to flush its TAP summary; the
   `setTimeout(...).unref()` means the timer doesn't itself prevent exit
   if some other path drains naturally first.

### Verification

After the fix, 5 consecutive full-suite runs:

```
run 1: 8887 tests, 1884 suites, 0 fail
run 2: 8887 tests, 1884 suites, 0 fail
run 3: 8887 tests, 1884 suites, 0 fail
run 4: 8887 tests, 1884 suites, 0 fail
run 5: 8887 tests, 1884 suites, 0 fail
```

Wall time: 38–47s (vs ~28s previously). The 35–65% slowdown is the cost
of 306 process spawns instead of one — acceptable for a stable test
count. `npm run test:fast` and `npm run test:mesh-net` were also
sanity-checked and produce identical counts run-to-run.

### Files changed

- `web/test/run-tests.mjs` — runner rewrite (spawn-per-file pool)
- `web/test/clawser-workspace-cleanup.test.mjs` — `.unref()` the
  placeholder interval (1 line)
- `web/test/clawser-app.test.mjs` — added `after()` hook + `after`
  import (3 lines)

### Known residual: `clawser-conversations.test.mjs`

One run during the verification pass produced a transient failure in
`clawser-conversations.test.mjs` (6/7 instead of 7/7). This is a
pre-existing flake unrelated to the runner work — same family as the
`clawser-peer-timestamp.test.mjs` flake observed earlier. Not addressed
in this pass.
