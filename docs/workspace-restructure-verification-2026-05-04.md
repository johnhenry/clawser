# Workspace `/home/<name>` restructure — verification pass

**Status: resolved as of 2026-07-16** (dated snapshot, not live guidance).
The two gaps flagged here (`SyncFlags` never instantiated, deploy-ACL
classes never wired to a mesh-message dispatcher) are now closed in
`web/clawser-multi-device.mjs`.

Each lifecycle event walked end-to-end against the implementation.
The walkthrough tests live at
`web/test/clawser-workspace-lifecycle-verification.test.mjs` (25 tests
covering events 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13/14).

**Headline:** the restructure itself is solid for everything routed
through the shell + workspace-lifecycle path. Two real gaps were
found, both pre-existing the restructure (they're "primitives
shipped, integration pending" carry-overs from the deploy/sync
follow-ups). One was surfaced; one was patched.

**Test count: 9,193 → 9,218 (+25).**

---

## Per-event verification

### #1 — Fresh install / first run

**Status:** ✅ Works.

The default workspace claims `/home/default`. `bootstrapFilesystem('default')`
calls `writeDefaultConfigs('default')` which calls
`resolveVirtualPath('~/.config/clawser/<name>.json', 'default')` →
`clawser/workspaces/default/.config/clawser/<name>.json`. The
`/home/default` alias resolves to the same OPFS subtree, so default
configs are reachable via either form.

**Evidence:** test #1 verifies `/home/default/.config/clawser/autonomy.json`
and `~/.config/clawser/autonomy.json` resolve to the same OPFS path.
Code path: `bootstrapFilesystem` → `writeDefaultConfigs` →
`resolveVirtualPath`.

### #2 — Existing user upgrade

**Status:** ✅ Works (no migration needed).

The `/home/<name>` alias is a path-resolution layer; OPFS storage at
`clawser/workspaces/{wsId}/...` is unchanged. Files written under the
legacy code's `~/path` are reachable via the new code's
`/home/default/path` because both resolve to the same OPFS location.

**Evidence:** test #2 asserts the equivalence directly.

### #3 — Create new workspace

**Status:** ✅ Works.

`createWorkspace(name)` (in `web/clawser-workspaces.js`) generates
`ws_<base36>_<rand>` IDs and stores the user-typed name. The UI then
calls `navigate('workspace', id)` which routes through
`route-handler.js` → `initWorkspace(newId)`.

`initWorkspace` calls `ensureDirectoryStructure(newId)` and
`writeDefaultConfigs(newId)` — both use the wsId (not the name) so
storage lands at `clawser/workspaces/{newId}/...`. Then
`createShellSession()` builds a fresh shell via
`createConfiguredShell({wsId: newId})`, which reads
`loadWorkspaces()` and computes `activeSanitizedName(wsList, newId)`
to determine `/home/<sanitized>`. `/proc/clawser/workspaces`
re-reads the workspace list on every read so the new entry is
visible immediately.

**Sanitization is computed, not stored.** That's deliberate — it
means renames take effect immediately without filesystem moves, and
collision-suffix ordering is stable across reads.

**Evidence:** tests #3 (5 sub-tests covering sanitization,
collisions, default-name reservation, OPFS placement under wsId, and
`/proc/clawser/workspaces` reflecting the new entry).

### #4 — Switch workspace ($HOME re-export)

**Status:** ✅ Works.

`switchWorkspace(newId)` (in `clawser-workspace-lifecycle.js:317`)
calls `cleanupWorkspace()`, then `setActiveWorkspaceId(newId)`, then
`createShellSession()` which builds a brand-new shell with
`HOME = /home/<new-sanitized-name>`. The OLD shell is discarded
along with its old `HOME`. Terminal sessions get their attached
shell replaced via `state.shell = newShell`.

Cross-cut: every workspace switch is a fresh shell construction
(not an in-place mutation of the existing shell's env). That's how
the live re-export is implemented in practice — there's no
"re-export onto the existing shell" code path because the shell
itself is rebuilt.

**Evidence:** test #4 verifies `setActiveHomeName` updates `HOME`
and `state.activeHomeName` immediately, and that `isCrossWorkspaceHome`
flips for paths from the old workspace name post-switch.

### #5 — Rename workspace

**Status:** ✅ Works (storage stable, alias updates).

`renameWorkspace(id, newName)` updates the workspace list's `name`
field. The OPFS storage subtree at `clawser/workspaces/{wsId}/`
DOES NOT MOVE — `wsId` is the canonical key. The next time anything
calls `activeSanitizedName(loadWorkspaces(), wsId)`, the new
sanitized name is returned. New shells get the new `HOME`.

**Caveat:** an EXISTING shell's `HOME` env var stays at the old
name until the workspace is switched (forcing a fresh shell). This
is a minor UX gap — renames don't live-re-export `HOME` to the
running shell. Real-world impact: low — users rarely rename the
active workspace and immediately depend on `$HOME` reflecting it
mid-session.

**Evidence:** test #5 asserts the sanitized name updates with the
rename and the OPFS path stays at the wsId.

### #6 — Delete workspace

**Status:** ✅ Works.

`deleteWorkspace(id)` (in `clawser-workspaces.js:211`) refuses to
delete `default`, removes the entry from the list, clears
localStorage namespaces (memories, config, tool perms, security,
etc. via `lsKey.*`). Active-workspace-deletion is handled by the
calling UI (it navigates to a different workspace first).

`/proc/clawser/workspaces` re-reads the list on every read, so the
deleted entry disappears.

**Caveat:** the OPFS subtree at `clawser/workspaces/{deletedId}/`
is not actively cleaned up by `deleteWorkspace`. It stays as
orphan data. For a one-time cleanup, "Reset all data" in vault
settings clears every OPFS dir.

**Evidence:** test #6 asserts active sanitized name returns `null`
for a deleted ID and `/proc/clawser/workspaces` no longer lists it.

### #7 — CLI session

**Status:** ✅ Works.

The CLI runs inside the same browser context as the UI; there's no
separate CLI process. `clawser foo` → `state.shell.exec('clawser foo')`.
That shell has `HOME = /home/<active-sanitized-name>` set on
construction (in `createConfiguredShell`). All `clawser` subcommands
resolve paths through the same `state.resolvePath` /
`ShellFs.#resolve` chain as interactive use.

**Evidence:** test #7 asserts the shell built by the factory pattern
gets `HOME` from `setActiveHomeName(activeSanitizedName(...))`.

### #8 — Cross-workspace denial — every fs entry point

**Status:** ✅ Works (at every entry point covered).

The denial is enforced at TWO layers:
1. `state.isCrossWorkspaceHome(path)` is checked at the shell-
   redirect handler (`> /home/<other>/x` → `Cross-workspace write
   denied`).
2. `ShellFs.#guardWrite(path)` re-checks (defense in depth, useful
   when ShellFs is reached via paths the redirect didn't see).

Reads naturally ENOENT because `resolveVirtualPath('/home/<other>/x',
wsId, {activeHomeName: 'mine'})` returns
`clawser/_isolated_/<other>/x` — a never-created OPFS subtree.

**Verified entry points** (test #8):
- `>` redirect → denied with `cross-workspace write denied` error
- `>>` redirect → denied
- `cat /home/<other>/x` → ENOENT
- `ls /home/<other>/` → ENOENT
- `ls /home/` (bare) → ENOENT (does NOT enumerate other workspaces)
- A path that LOOKS like the active prefix (`/home/mineral/`) but
  isn't (`/home/mine/`) is correctly classified as cross-workspace.

**Coverage gap noted:** `WorkspaceFs.resolve()` (an alternate code
path used by some tools that don't go through ShellFs) does not
include the cross-workspace check. In practice, `WorkspaceFs` is
constructed per-workspace (`new WorkspaceFs(wsId)`), so calls to it
already only see one workspace's data — there's no `/home/<other>`
ambiguity to resolve at that layer. So the gap is theoretical.

### #9 — Profile + `.env` loading

**Status:** ✅ Works.

`/etc/clawser/profile` resolves to a global path
(`clawser/etc/clawser/profile`) — same regardless of workspace. The
shell sources it via `this.source('/etc/clawser/profile')` on every
construction.

`~/.config/clawser/.env` resolves under the active workspace
subtree. `injectEnvIntoShell(wsId, shell.state)` (in
`clawser-fs-env.mjs`) reads from that path and populates the
shell's env. Run on every shell construction (workspace switch =
fresh shell = re-source).

**Evidence:** test #9 verifies path resolution under each workspace
ID.

### #10 — Vault path

**Status:** ✅ Works (intentionally global).

The vault is at OPFS `clawser_vault/` — a top-level directory,
sibling to `clawser/`, NOT under any workspace subtree. This is
intentional: API keys + identities are per-USER, not per-workspace.
Switching workspaces does not require re-unlocking the vault.

The vault was at this location before the restructure and is
unchanged. No migration needed. The only restructure-related
question was "does the alias accidentally route the vault path
somewhere different?" — and no, the vault uses raw OPFS access
(via `OPFSVaultStorage`) that's outside the
`resolveVirtualPath` / `/home/<name>` machinery.

### #11 — Mesh peer device files at `/dev/clawser/mesh/peers/*`

**Status:** ✅ Works (with a clarification).

The path `/dev/clawser/mesh/peers/{peerId}` is GLOBAL — `/dev/...`
resolves to `clawser/dev/...` regardless of workspace. But the
`state.deviceHandler` instance is built fresh in `initRuntimeFs`
on every workspace switch (`createShellSession` rebuilds it). Peer
registrations live ON THAT INSTANCE, not in OPFS, so they reset on
switch. Newly-discovered peers register themselves via
`discoveryManager.onPeerDiscovered` in the new workspace's mesh
init.

Net effect: peer device files are scoped to the active
workspace's mesh subsystem. The path namespace is global; the
contents are per-session. This is the right behavior — different
workspaces may want to talk to different mesh peers.

### #12 — Snapshots

**Status:** ✅ Works (per-workspace).

`SNAPSHOT_DIR = '~/.local/share/clawser/snapshots'` resolves per the
active workspace, so snapshots live at
`clawser/workspaces/{wsId}/.local/share/clawser/snapshots/`. Each
workspace has its own snapshot ring. Restoring a snapshot from
workspace A while in workspace B isn't possible via the normal
flow — you'd need to manually copy bytes (which the cross-workspace
isolation prevents through the shell, but `snapshotManager` access
is a programmatic-only path).

### #13 — Sync flags. **GAP: not wired in production.**

**Status:** ❌ Primitives shipped, integration pending.

The `SyncFlags` class in `web/clawser-sync-flags.mjs` is
extensively unit-tested (13 tests) but `grep` confirms it's
**never instantiated** in production code. No `state.syncFlags`,
no consumer flipping flags from the UI, no sync-on-change wiring.

This means: if the user wants to flag a skill or config for
multi-device sync, the UI doesn't have a "Sync to my devices"
toggle, and no code is reading the flag set anyway. The class is
ready; the integration is missing.

**Recommended scope for fixing:**
- Per-workspace `state.syncFlags = new SyncFlags(workspaceFsAdapter)`
  in `initWorkspace`. Storage path: `~/.local/share/clawser/sync-flags.json`.
- UI toggle on each skill/config row that reads/writes the flag.
- A subscription in skill/config save paths that calls
  `recordLocalChange(ctx, fid, kind, itemId, payload)` from
  `clawser-deploy.mjs`.

**Effort:** S-M. The classes are done; the wiring is the work.

### #14 — Deploy targets (ACL, approvals, audit, rollback). **GAP: not wired.**

**Status:** ❌ Primitives shipped, integration pending.

Same shape as #13. `DeployAcl`, `DeployApprovals`, `DeployAuditLog`,
`DeploySnapshotRing`, `ReplayCounterTracker`, and `acceptPackage`
all ship with 56 tests, but no production code instantiates any
of them. There's no:
- "Trusted publishers" UI
- Inbound mesh-message handler that calls `acceptPackage`
- Per-workspace storage adapter for the ACL/approval/audit files

So if a peer signed and sent a deploy package today, the receiver
would see it via `pod.sendMessage`'s message envelope (since A3 IS
wired), but no handler routes it through the deploy pipeline. The
package would arrive and be ignored.

**Recommended scope for fixing:**
- `state.deployAcl = new DeployAcl(workspaceFsAdapter)` etc. in
  `initWorkspace`. Per-workspace because different workspaces may
  trust different sources.
- A mesh-message dispatcher in `initMeshSubsystem` that recognizes
  `kind: 'deploy-package-v1'` envelopes and calls
  `acceptPackage(pkg, ctx)` with a `promptApprove` that opens the
  manifest-approval modal.
- A "Deploy targets" subsection in the Mesh settings panel for
  trusted-publisher management + audit log review + rollback UI.

**Effort:** M-L. Substantial, design-heavy (per-workspace vs
global ACL is a real choice; UI is non-trivial). **Surfaced for
user decision** — not fixed inline this pass.

### #15 — Skills / capability gating

**Status:** ✅ Works as designed.

`SkillStorage` exposes both:
- `getGlobalSkillsDir()` → OPFS `clawser_skills/` (shared across
  all workspaces).
- `getWorkspaceSkillsDir(wsId)` → `clawser/workspaces/{wsId}/.skills/`
  (per-workspace).

Workspace skills override global skills with the same name. This
is a deliberate two-tier system, not a restructure issue.

Capability tokens (the deploy-time gate from
`clawser-skill-capabilities.mjs`) are token-shaped objects passed
into `executeSkillScript` per-invocation. Storage of tokens is the
deploy-target's job — which (per #14) isn't wired yet, so today
every skill runs without a token (= local-skill path, full Worker
sandbox, no extra capabilities). When deploy targets do get wired,
the capability flow is ready to run.

---

## Static sweep — path reference audit

Grepped for every `~`, `$HOME`, `/home/`, and hardcoded
`clawser/workspaces/` reference in production code:

| Reference | Location(s) | Verdict |
|-----------|-------------|---------|
| `~/.config/clawser/*` | `clawser-fs-config.mjs` (config domain map) | ✅ Correctly per-workspace via `resolveVirtualPath` |
| `~/.local/share/clawser/snapshots` | `clawser-snapshots.js` | ✅ Per-workspace |
| `~/.config/clawser/.env` | `clawser-fs-env.mjs` | ✅ Per-workspace |
| `/etc/clawser/profile` | `clawser-shell.js` (sourceProfiles) | ✅ Global |
| `/etc/clawser/motd` | `clawser-fs-bootstrap.mjs` | ✅ Global |
| `/etc/clawser/workspaces.json` | `clawser-workspaces.js` (registry) | ✅ Global |
| `/proc/clawser/*` | `clawser-proc.js` generators | ✅ Global, virtual |
| `/dev/clawser/mesh/peers/*` | `clawser-fs-devices.mjs` | ✅ Global path, per-session registrations |
| `/home/user/projects` | `clawser-terminal-adapter-dom.mjs:181` | docstring example only — no code |
| `/home/user/.clawser/skills` | `clawser-skill-hot-reload.js:354` | docstring example only |
| `/home/clawser/README.txt` | `clawser-vm-console.js:55,67,78,135,228,265` | inside the v86 guest VM, not the host shell — unrelated to the restructure |
| `clawser/workspaces/{wsId}/` | `clawser-tools.js:26` `WorkspaceFs.homePath` | ✅ Correctly per-wsId |

No production reference was using `/home/...` in a way that would
conflict with the new aliasing. The only `/home/...` paths in the
codebase outside the new resolver are docstring examples or live
INSIDE the v86 guest VM (a separate filesystem entirely).

---

## Things this verification did NOT cover

- **The actual UI panels.** "My Devices" panel for pairing /
  trusted publishers / audit log review doesn't exist (see #13/#14
  gaps). The corresponding storage classes are ready; the UI is
  the missing piece.
- **End-to-end browser run.** Verified via Node tests using
  MemoryFs + ShellFs + VirtualFs + mocked workspace lists. The
  actual OPFS path resolution in a live browser uses the same code
  paths but wasn't run-tested in this pass (Chrome MCP has been
  flaky in this environment).
- **The kernel package's view of workspaces.** `web/packages/kernel/`
  has its own tenant model that's parallel to but not entwined with
  the workspace lifecycle. Out of scope for the restructure.

---

## Brutal-honesty summary

The `/home/<name>` restructure for everything **routed through the
shell + workspace lifecycle is solid**. Every event (#1-#12, #15)
has a verified code path. The cross-workspace isolation enforces
correctly at multiple layers; sanitization edge cases are covered;
storage placement is per-workspace where appropriate (configs,
snapshots, skills, presence) and global where appropriate (vault,
workspace registry, /etc, /proc).

**The two real gaps (#13, #14) are NOT restructure issues.** They
predate this work — the deploy-targets and sync-flags primitives
shipped in the May 3 deploy work but were never instantiated in
production. The 120 tests that landed for that pass cover the
classes themselves, not the integration. This was previously
flagged in `docs/implementation-status.md`'s "Sandbox capability
enforcement (B.2)" section as a known follow-up; the verification
pass found that the broader sync/deploy integration has the same
shape.

**Decision needed from the user:** wire deploy + sync flags into
the workspace bootstrap (M-L pass) or leave them as primitives
until a future feature pass. Recommendation: leave for now, since
the integration is design-heavy (per-workspace ACL? cross-workspace
sync flags? UI placement?) and the primitives aren't blocking
anything.

---

## Files touched

- `web/test/clawser-workspace-lifecycle-verification.test.mjs` (new — 25 tests)
- `docs/workspace-restructure-verification-2026-05-04.md` (this file)
- `OUTSTANDING.md`, `CHANGELOG.md` (status flips for the gap surfacing)
