# Issue triage — 2026-05-04

Triage pass on three concrete user-reported issues plus a subsystem
sanity sweep. Fixed two real bugs inline; surfaced one design item for
the user to decide on; verified every major subsystem is green.

**Test count: 9,108 → 9,154 (+46).** Three stable runs at 9,154/0.

---

## Issue 1 — File created in terminal doesn't show in `ls`. **FIXED.**

### Reproduce

A Node test reproduced it deterministically against the production
shell + filesystem stack:

```js
const fs = new MemoryFs();
const proc = new ProcFileHandler();
proc.register('/proc/clawser/version', () => '0.1.0');  // any /proc entry
const vfs = new VirtualFs(fs, proc, null);
const shell = new ClawserShell({ fs: vfs });
await shell.exec('echo hi > /myfile');
console.log((await shell.exec('ls /')).stdout);
// Before fix: "proc/\n"            ← /myfile is HIDDEN
// After fix:  "myfile\nproc/\n"
```

### Root cause

`VirtualFs.listDir(path)` in `web/clawser-proc.js` was early-returning
virtual entries when proc had any matching generator under the path:

```js
if (this.#proc.handles(path)) {
  const virtualEntries = this.#proc.listDir(path);
  if (virtualEntries.length > 0) return virtualEntries;  // ← ignores realFs
}
return this.#realFs.listDir(path, opts);
```

Since `/proc/clawser/*` is registered at boot, `proc.handles('/')`
returned true and the realFs entries (the user's actual files) were
silently dropped. Same pattern for the device-files path.

The shell's redirect operator was working correctly — `echo > /foo`
genuinely wrote to OPFS. The bug was reader-side only, which is why it
looked like "the file vanished."

### Fix

`VirtualFs.listDir` now merges device + virtual + real entries by name,
with virtual / device taking precedence on collisions but never hiding
non-colliding real entries. New regression test:
`web/test/clawser-virtualfs-listdir-merge.test.mjs` (4 tests).

### Files changed

- `web/clawser-proc.js` — `listDir` rewritten to merge.
- `web/test/clawser-virtualfs-listdir-merge.test.mjs` — new regression test.

---

## Issue 3 — CLI doesn't honor selected model. **FIXED.**

### Root cause (two bugs)

1. **`clawser model X` and `clawser config set model X` never persisted
   the change.** Both called `agent.setModel(value)` and returned
   without `agent.persistConfig()`. The change lived only in memory, so
   reload → next session started with the previously-saved model.

2. **`applyRestoredConfig` overwrote the user's saved model on
   restore.** When the saved provider was an account, `onProviderChange`
   was called, which sets the agent's model to the account's default
   (`agent.setModel(acct.model)`). The user's previously-saved
   `config.model` was never re-applied — so even if persist had worked,
   the next session would still revert.

### Fix

- `web/clawser-cli.js` — `cmdModel` and `cmdConfig` (set:model branch)
  now call `agent.persistConfig?.()` after `setModel`. `persistConfig`
  is best-effort — a legacy mock without that method is tolerated.
- `web/clawser-accounts.js` — `applyRestoredConfig` now re-applies
  `savedConfig.model` after `onProviderChange()` resolves. Net behavior:
  account selection sets the *default* model for that account; explicit
  CLI / config-set overrides survive reloads.

Test: `web/test/clawser-cli-model-persist.test.mjs` (4 tests).

### Files changed

- `web/clawser-cli.js` — two `persistConfig?.()` calls added.
- `web/clawser-accounts.js` — `await onProviderChange(); if
  (savedConfig.model && state.agent) state.agent.setModel(savedConfig.model);`
- `web/test/clawser-cli-model-persist.test.mjs` — new regression test.

---

## Issue 2 — Per-workspace `/home/<workspace_name>`. **DESIGN; NOT IMPLEMENTED.**

User wants every workspace to look like a real Linux user with its
own `/home/<workspace_name>` directory.

### Current state

| What | Where | Notes |
|------|-------|-------|
| Workspace data | `clawser/workspaces/{wsId}/...` (OPFS) | Per-workspace OPFS subtree exists today. |
| `~/` shell expansion | `clawser-opfs.js` `resolveVirtualPath` line 61 | `~/foo` → `clawser/workspaces/{wsId}/foo`. |
| `$HOME` | `clawser-shell-factory.js:49` | Hardcoded to `/`. |
| `/home/` directory | does not exist in the shell view | No registration anywhere. |
| Workspace identity in shell | implicit | Shell sees one root `/`; switches happen via workspace switching. |
| Workspace name vs ID | `clawser-workspaces.js` | `getActiveWorkspaceId()` returns the ID; workspaces have a separate `name` field. The OPFS layout uses ID. |
| Cross-workspace access | not supported | Each shell session is bound to one wsId. |

So per-workspace isolation already exists at the OPFS level — the gap
is the shell *view*. Today every workspace looks identical (`/`), with
no way to identify which workspace the user is in by path alone.

### Three concrete restructure proposals

#### Proposal A — Lightweight: `/home/<name>` view alias for the active workspace

- Add `/home/{active-workspace-name}/` as a view that resolves to the
  same OPFS directory as `~/`. Both paths work and refer to the same
  data.
- `$HOME` set to `/home/{name}`. Tilde expansion unchanged.
- No OPFS layout change. No data migration.
- Cross-workspace: `/home/<other>/foo` resolves to that workspace's
  OPFS subtree (read/write subject to a new permission gate).
- Workspace rename: trivial — only the path string changes; OPFS keeps
  using the stable wsId.

**Effort: S (1 day).**
**Touches:** `clawser-opfs.js` (`resolveVirtualPath` adds `/home/<name>` →
`workspaces/{wsId}/` mapping; needs name→id lookup), `clawser-shell-factory.js`
(`HOME = /home/{name}`), `clawser-shell.js` `ShellFs.#resolve`,
`clawser-workspace-lifecycle.js` (re-source profiles after workspace
switch), maybe `clawser-fs-config.mjs` if config files reference `~/`.
**Risk:** low. Backwards-compatible — every existing `~/` call keeps
working. Only adds a new alias.
**Migration:** none. Existing data stays at `clawser/workspaces/{wsId}/`.

#### Proposal B — Full rename: OPFS layout uses `home/<name>`

- Rename `clawser/workspaces/{wsId}/` → `clawser/home/{name}/`.
- Shell sees `/home/{name}` directly. Tilde expands to that.
- Workspace rename triggers an OPFS `move()` of the entire subtree.
- Workspace name becomes the canonical identifier in OPFS.

**Effort: L (3-5 days).**
**Touches:** `clawser-opfs.js` (whole layout), every consumer of
`clawser/workspaces/` (snapshots, mesh peer device files,
`clawser-app.js` boot, the import/export path, `clawser-vault-settings.js`'s
"reset all data" recursive walk), workspace rename UI (now triggers a
recursive move).
**Risk:** highest. OPFS rename across many files is slow and partial-
failure-prone. Workspace name characters must be filename-safe (escape
or restrict allowed chars). Existing data needs migration on first
boot of new code.
**Migration:** detect `clawser/workspaces/{wsId}/` on load; if found,
move to `clawser/home/{lookup-name(wsId)}/` with a manifest tombstone
for crash recovery. Same atomicity model as the vault v1→v2 migration.

#### Proposal C — Hybrid: keep wsId as OPFS key, add `/home/<name>` shell view, and a `/etc/workspaces/` registry

- Like Proposal A on the storage side (no OPFS layout change).
- Adds a virtual `/etc/workspaces/{name}` directory (via ProcFileHandler
  or DeviceFileHandler) listing every known workspace, each entry
  mapping to its OPFS subtree.
- `/home/{active}` is a symlink-like alias for `~/`.
- Other workspaces accessible at `/etc/workspaces/<other>/...` (or
  `/home/<other>/...` if we want the `/home/` namespace populated for
  every workspace).
- Cross-workspace permissions enforced at the resolver layer.

**Effort: M (2 days).**
**Touches:** `clawser-opfs.js`, `clawser-shell.js`, `clawser-proc.js`
or new `clawser-workspaces-vfs.mjs`, profile-sourcing path,
`clawser-fs-config.mjs` (`~/.config/clawser/...` paths might
double-resolve through `/home/<active>/.config/clawser/...`).
**Risk:** medium. Two ways to address the same data needs a clear
"canonical" rule for sync, snapshot, audit. Cross-workspace
permission semantics need design.
**Migration:** none for storage. Need to update docs that reference
workspaces by ID to also accept names.

### Open questions for the user

1. **`$HOME` semantics.** Should `$HOME` follow workspace switches
   live (re-export on switch) or be set once per shell session? Real
   Linux is the latter; intuitively users expect the former.
2. **Cross-workspace access.** Read-only by default? Write requires a
   permission grant? Not allowed at all? (Today: not possible — a shell
   is bound to one wsId.)
3. **Workspace name characters.** OPFS filenames have constraints;
   workspace names today are free-form. Need a sanitization layer.
4. **Existing single-default users.** Their data lives at
   `clawser/workspaces/default/`. New view: `/home/default`? Aliased
   so old absolute paths keep working?

**Recommendation: Proposal A.** Lowest-risk, smallest blast radius,
delivers the user-visible win (per-workspace `/home/<name>` paths) without
touching OPFS layout or migrating any data. Proposal C is the right
target if cross-workspace access is a hard requirement; Proposal B is
the cleanest end-state but carries the most risk for the smallest
incremental user value over A.

---

## Subsystem sanity sweep

Per-subsystem health from running the focused test files. Every major
subsystem is green; no broken-but-unit-tested-passing surfaces found
during this sweep. Three full-suite runs hit 9,154/0 identically.

| Subsystem | Status | Evidence |
|-----------|--------|----------|
| Filesystem (OPFS, /proc, /etc, /dev, chmod, watchers) | works | `clawser-proc.test.mjs` 41/0, `clawser-fs-devices.test.mjs` 66/0, `clawser-opfs.test.mjs` 10/0; new `listDir` merge regression covers the issue-1 path. |
| Shell / clsh | works | `clawser-shell.test.mjs` 196/0; redirect/pipes/conditionals/loops all covered; tilde expansion, env vars, profile sourcing exercised. |
| Vault (wrapped-DEK + passkey) | works | `clawser-vault-v2.test.mjs` 33/0, `clawser-vault-settings.test.mjs` 16/0, `clawser-passkey.test.mjs` 14/0. v1→v2 migration crash-recovery paths tested. |
| Mesh (pairing, sync, peer device, deploy) | works | `clawser-pairing.test.mjs` 13/0, `clawser-sync.test.mjs` 31/0, `clawser-pod-mesh-wiring.test.mjs` 5/0, `clawser-deploy.test.mjs` 7/0. |
| Skills / capability gating | works | `clawser-skills.test.mjs` 98/0, `clawser-skill-capabilities.test.mjs` 18/0, `clawser-skills-cap-integration.test.mjs` 8/0. End-to-end: gated `fetch`/`fs`/`mesh` errors point at the manifest declaration. |
| CLI (every subcommand, --json, --rpc-* flags) | works (with the fix) | `clawser-cli.test.mjs` 14/0 + new `clawser-cli-model-persist.test.mjs` 4/0; the `model`-persistence bug from issue 3 is closed. |
| Deploy targets (signed packages, ACL, audit, rollback) | works | `clawser-deploy-package.test.mjs` 19/0, `clawser-deploy-target.test.mjs` 37/0. |
| Y.js convergence | works | `clawser-yjs-applicator.test.mjs` 12/0 — two-peer convergence test passes. |
| Test runner stability | works | three consecutive `npm test` runs = 9,154/0 identical. |

### Spot-checks beyond the test suite

- **Skipped / disabled tests.** `grep` for `it.skip / xit / describe.skip`
  → none in `web/test/`. No quietly-disabled coverage.
- **Production TODOs / FIXMEs.** Production code is clean of
  `TODO|FIXME|XXX|HACK` markers (the previous vault-recovery TODO was
  removed in the Option F pass).
- **Known transient flake.** `clawser-conversations.test.mjs` has been
  flaky since the cross-validation pass; documented in
  `docs/cross-validation-2026-05-02.md`. Did not reproduce in this
  triage's three runs but remains a known follow-up.

### Things explicitly NOT covered

- UI panel rendering (each major one renders + accepts input). Browser
  testing requires a live serve + Chrome MCP (which has been flaky in
  this environment). The test suite covers panel-helper logic
  (validate, perform, render-data builders) but not the actual DOM.
  No regression risk added by this triage — the only DOM-affecting
  change (issue 3 in `applyRestoredConfig`) is testable via its
  `state.agent.setModel` call which the suite catches.
- Live mesh peer-to-peer (requires two browser tabs + WebRTC).

---

## Files touched

- **Code fixes:**
  - `web/clawser-proc.js` (Issue 1 fix — `listDir` merge)
  - `web/clawser-cli.js` (Issue 3 fix — `persistConfig` after `setModel`)
  - `web/clawser-accounts.js` (Issue 3 fix — re-apply saved model after `onProviderChange`)
- **New tests:**
  - `web/test/clawser-virtualfs-listdir-merge.test.mjs` (4 tests)
  - `web/test/clawser-cli-model-persist.test.mjs` (4 tests)
- **Docs:**
  - `docs/issue-triage-2026-05-04.md` (this file)
  - `OUTSTANDING.md` and `CHANGELOG.md` updated
