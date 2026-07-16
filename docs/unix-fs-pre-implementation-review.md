# Unix Filesystem Architecture — Pre-Implementation Review

**Date:** 2026-05-01
**Status:** Final review pass before implementation

> **Post-implementation status note (2026-07-14):** This review predates
> implementation and was never updated afterward. The design it critiques
> shipped (Phases 0–9) on 2026-07-04 — see the "Delivery notes" callout at
> the top of `unix-filesystem-architecture.md` for what was actually built
> and how it diverged from the design doc. Treat this document as a
> historical record of pre-implementation concerns, not a live risk
> register. Based on cross-checking the shipped code in `web/`:
>
> - **Resolved as designed:** Two Competing Uptime Sources (Ambiguities
>   §2) — only `/proc/clawser/uptime` was ever implemented, `/run/clawser/uptime`
>   was never built, so there's no drift between two sources. `/sys/`
>   Write Semantics (Ambiguities §3) — `/sys/kernel/trace` is registered
>   as an explicit `{read, write}` generator in `ProcFileHandler`; no
>   other `/sys/` path has a write generator, so they correctly stay
>   read-only. Multi-tab FileWatcher duplicate notifications (Edge Cases
>   §2) — `ReactiveConfigStore` dedupes by a serialized `lastAppliedKey`
>   per domain and `FileWatcher.markWrittenByMe()` suppresses
>   self-triggered reloads. Channel Device Incoming Messages (Ambiguities
>   §8) — `DeviceFileHandler.deliverToChannel()` now sets
>   `state.lastReceived`. Workspace Metadata Storage (Current Codebase
>   Conflicts §3) — `clawser-workspaces.js` now reads/writes
>   `/etc/clawser/workspaces.json` in OPFS, with localStorage kept only
>   as a one-time migration source and fallback.
> - **Still open / only partially addressed:** Checkpoint Storage Backend
>   (Current Codebase Conflicts §5) — checkpoints are still in
>   IndexedDB via `CheckpointIndexedDB`, never moved to OPFS. Vault
>   Storage (Current Codebase Conflicts §6) — `OPFSVaultStorage` still
>   writes to a legacy root-level `clawser_vault/` OPFS directory, not
>   `~/.local/share/clawser/vault/` as both docs describe. Config Storage
>   Model Mismatch (Current Codebase Conflicts §1) — of the 18
>   localStorage domains this section lists, only 11 have any OPFS
>   counterpart (`clawser-fs-config.mjs`'s `CONFIG_MAP`), and of those
>   only 6 (autonomy, identity, security, daemon, terminal, hooks) are
>   wired reactively through `ReactiveConfigStore`/`FsUiSync`; the rest
>   (`toolPerms`, `skillsEnabled`, `showDotfiles`, `termSessions`,
>   `skillHotReload`) still have no file-backed path at all.
>   `reactiveConfig: false` Chicken-and-Egg (Ambiguities §4) — still
>   real: toggling it emits a `reactiveConfigToggled` event but nothing
>   subscribes to that event to flip `FileWatcher.enabled`, so re-enabling
>   still requires a restart as this doc predicted.
> - **Rendered moot:** "Clean slate" (Risks §1, Unresolved Questions
>   §5–7) never shipped — there is no `cleanSlate()` function anywhere in
>   the codebase. localStorage and IndexedDB were never deleted; the
>   shipped filesystem layers OPFS files on top of the pre-existing
>   storage instead of replacing it (see `clawser-fs-config.mjs`'s
>   dual-write in `writeConfig()`). So the high-risk data-loss scenario
>   this review warns about did not happen in production — but not
>   because an export/migration path was built; the destructive step
>   itself was simply never implemented.

---

## Missed Ideas from Conversation

### APIs Mentioned Once and Never Integrated

The ChatGPT conversation surfaced several Web APIs that were acknowledged as "extremely kernel-like" or "huge for wnix" but never made it into the design doc or implementation plan:

1. **Compute Pressure API** — Called "extremely kernel-like" and noted it "lets you adapt scheduling decisions." Never incorporated into any scheduler or daemon design. This is directly relevant to adaptive workload management in the daemon controller.

2. **Prioritized Task Scheduling API** — Controls event loop task priority. Never integrated despite being directly relevant to wnsh job scheduling and the kernel's resource management.

3. **Storage Foundation API** — Described as "low-level block storage abstraction" with the analogy of "raw disk access." This could provide a better foundation than OPFS for block-level storage operations, but was mentioned once and dropped.

4. **WebTransport** — QUIC-based bidirectional transport. Mentioned once as "emerging," never revisited. Could be superior to WebSocket for the networking subsystem (`/net/` in the design doc).

5. **Content Index API** — Mentioned for "package manager integration" and "offline app discovery." Relevant to a future skill/package management system but never explored.

6. **Battery Status API / Idle Detection API** — Mentioned for "adaptive scheduling" and "power-aware apps." Never integrated into daemon scheduling despite being directly relevant to background execution decisions.

7. **Server-Sent Events** — Listed under IPC, never discussed in networking design. Could be relevant for the channel device files.

### Implicit Insights Never Made Explicit

8. **"The browser IS the kernel"** — The conversation repeatedly circled toward but never committed to this insight. The assistant said "the browser already behaves like a microkernel" but neither party drew the full implication: clawser/wnix is a *personality layer* over the browser kernel (like Linux's ability to run different syscall ABIs), not a replacement OS. The design doc should state this clearly to avoid scope confusion.

9. **OPFS + `FileSystemSyncAccessHandle` is the single most important API** — Enables synchronous file I/O in Workers, which is the one thing that makes Unix-style programs work. The conversation called it "huge for wnix" but the design doc treats OPFS as just another storage backend rather than the foundational primitive.

10. **Service Workers as daemons implies offline-first** — If Service Workers are the init/daemon system, clawser inherently becomes an offline-first application. The design doc never acknowledges this architectural consequence.

11. **wnsh is actually a new programming language** — The EBNF grammar defines typed values (String, Path, Stream, Job, CapabilitySet), structured job graphs, and capability blocks. This goes well beyond a shell. The implementation effort for wnsh is likely 10x what a shell would be.

12. **Bytecode format for wnsh scripts** — Offered once at the very end of the conversation, never pursued. Compiled shell scripts would be a significant performance differentiator for complex startup sequences.

### Ideas Started But Never Finished

13. **ELF binary compatibility layer** — The assistant offered to design "a wnix compatibility layer for ELF binaries vs WASM binaries." Never explored. Potentially critical for running existing Linux binaries via v86.

14. **SQLite as proof-of-feasibility** — Running SQLite in WASM was offered as a concrete test, never pursued. Would validate the WASI stub approach in `clawser-sandbox.js`.

15. **Coreutils port strategy** — How would `ls`, `ps`, `grep` be adapted to wnsh's model vs the current ClawserShell builtins? Never explored. The current shell has 22+ builtins that would need to be reconciled with the Unix filesystem approach.

16. **The `/dev` subsystem read/write API** — The `/dev` structure was outlined but the actual read/write API for device files was never fully specified. The design doc's `DeviceFileHandler` fills some of this gap but the protocol for devices that produce streaming output (e.g., `/dev/clawser/providers/openai`) is under-specified.

---

## Current Codebase Conflicts

### 1. Config Storage Model Mismatch

**Design doc says:** Config lives in files under `~/.config/clawser/` (OPFS), read/written as JSON. ReactiveConfigBus watches files for changes.

**Code actually does:** Config lives in **localStorage** under versioned keys (`clawser_v1_config_{wsId}`, `clawser_v1_autonomy_{wsId}`, etc.). The `ConfigCache` class in `clawser-state.js` provides an in-memory cache with debounced writes to localStorage. There are **18 distinct localStorage key domains** defined in `lsKey`: memories, config, toolPerms, security, skillsEnabled, autonomy, identity, selfRepair, sandbox, heartbeat, routines, termSessions, hooks, peripherals, showDotfiles, modelConfig, terminalRenderer, skillHotReload.

**Impact:** Every one of these 18 domains needs to be migrated from localStorage key → OPFS file. The ConfigCache's debounced write mechanism needs to be replaced with file-based writes. The `migrateLocalStorageKeys()` function (which currently migrates unversioned → v1 keys) would need to be replaced with a localStorage → OPFS migration.

### 2. OPFS Path Mapping Divergence

**Design doc says:** Paths like `/etc/clawser/config.json` are resolved via `resolveVirtualPath()` to `clawser/etc/clawser/config.json` in OPFS.

**Code actually does:** `WorkspaceFs.resolve()` maps user paths to `clawser_workspaces/{wsId}/{path}`. The OPFS directory structure is `clawser_workspaces/{wsId}/` for workspace files, `clawser_checkpoints/{wsId}/` for checkpoints. There is no `clawser/etc/` or `clawser/dev/` or `clawser/proc/` namespace in the current OPFS layout.

**Impact:** The entire OPFS namespace needs to be restructured. The `resolveVirtualPath()` function in the design doc prepends `clawser/` to everything, meaning the OPFS root would contain a single `clawser/` directory with the Unix hierarchy inside it. But workspace data currently lives at `clawser_workspaces/` (note: underscore, not nested path). These two naming schemes are incompatible.

### 3. Workspace Metadata Storage

**Design doc says:** Workspace list lives at `/var/clawser/workspaces.json` in OPFS.

**Code actually does:** Workspace list lives in localStorage under `clawser_workspaces` key. Workspace metadata shape is `{id, name, created, lastUsed}`. The `clawser-workspaces.js` module is pure localStorage CRUD with no OPFS dependency (except for cleanup during deletion).

**Impact:** Workspace CRUD needs to be rewritten to use OPFS. The disposable mode (which uses `sessionStorage` via `getStorage()` from `clawser-disposable.js`) needs a fallback strategy since OPFS may not persist in incognito mode.

### 4. Shell Filesystem Adapter Chain

**Design doc says:** `ShellFs` reads/writes through a unified VFS layer that handles virtual paths (`/dev/`, `/proc/`, `/etc/`), with `DeviceFileHandler` and `ProcFileHandler` intercepting reads/writes to synthetic paths.

**Code actually does:** `ShellFs` wraps `WorkspaceFs` and delegates to `opfsWalk`/`opfsWalkDir` from `clawser-opfs.js`. There is no virtual path interception. The current `ShellFs` has write guards for internal directories (`.conversations/`, `.checkpoints/`, `.skills/`, `.agents/`) but no concept of device files or proc files.

**Impact:** `ShellFs` needs to be extended with the virtual path dispatch logic. The current write guards for internal directories need to be reconciled with the new permission system (`chmod` in Phase 8). The question: does `ShellFs` get the VFS logic, or does a new layer sit between `ShellFs` and `WorkspaceFs`?

### 5. Checkpoint Storage Backend

**Design doc says:** Checkpoints go in OPFS under the workspace directory structure.

**Code actually does:** `CheckpointManager` in `clawser-daemon.js` uses injectable `writeFn`/`readFn` callbacks, which `clawser-app.js` wires to `CheckpointIndexedDB`. Checkpoint data is in **IndexedDB**, not OPFS. Keys follow the pattern `checkpoint_{id}`, `checkpoint_latest`, `checkpoint_index`.

**Impact:** The clean-slate migration deletes IndexedDB databases. If this runs before checkpoint data is migrated to OPFS, all existing checkpoints are lost. The design doc says "No migration. Clean slate." — this means checkpoint history is intentionally destroyed. Is that acceptable?

### 6. Vault Storage

**Design doc says:** Vault data at `~/.local/share/clawser/vault/` in OPFS.

**Code actually does:** Vault uses `OPFSVaultStorage` (already OPFS-based) or in-memory storage for disposable mode. The vault is created in `clawser-app.js` during init.

**Impact:** The vault is already in OPFS, but its current OPFS path may not match the design doc's `~/.local/share/clawser/vault/` path. Need to verify the actual OPFS key used by `OPFSVaultStorage` and whether it conflicts with the new namespace.

### 7. Event Bus / `emit()` Function

**Design doc says:** `ReactiveConfigBus` calls `emit('configChanged', ...)` when files change.

**Code actually does:** `clawser-state.js` exports `on()`, `off()`, `emit()` as a standalone pub/sub event bus. The `emit()` in the design doc's `ReactiveConfigBus` code is never imported or connected to this bus. The design doc's code appears to assume `emit` is globally available or inherited, but the `ReactiveConfigBus` class doesn't extend or import the event bus.

**Impact:** The `ReactiveConfigBus` implementation needs explicit wiring to the existing event bus from `clawser-state.js`. Without this, config changes won't propagate to any listeners.

### 8. Global State Singleton Structure

**Design doc says:** Services are accessed via filesystem paths and config files.

**Code actually does:** `state` in `clawser-state.js` is a massive mutable singleton with ~50+ service slots under `state.services` (agent, providers, browserTools, mcpManager, vault, workspaceFs, shell, skillRegistry, kernel, daemonController, routineEngine, etc.), plus `state.ui`, `state.features`, `state.session`, and flat fields. Many modules directly read/write `state.services.X`.

**Impact:** Even after the filesystem migration, `state.services` will still hold runtime service references. The design doc doesn't address this — it implies config drives everything, but runtime service instances need to live somewhere. The filesystem is config/data storage, not a service locator.

### 9. Init Sequence Dependencies

**Design doc says:** `cleanSlate()` runs early, creates directory structure, deletes old storage.

**Code actually does:** `clawser-app.js` init creates ~30 service singletons in a specific order with dependencies between them. The kernel is booted at step 6, daemon controller at step 7, features at step 9. Many services depend on `state.services.workspaceFs` being set before they initialize.

**Impact:** The `cleanSlate()` function needs to run before `MountableFs` is created (since it restructures OPFS), but `MountableFs` is one of the first things created. The ordering constraint needs careful planning: `cleanSlate()` → create new filesystem adapter → create `MountableFs` → continue normal init.

### 10. UndoManager OPFS Helpers

**Code actually does:** `clawser-app.js` defines helper functions `opfsGetFile()`, `opfsWriteFile()`, `opfsRemoveFile()` used by the UndoManager for file revert operations. These directly access `navigator.storage.getDirectory()` and `opfsWalk()`.

**Impact:** These bypass the VFS layer entirely. After migration, they need to go through the new filesystem adapter, or the UndoManager needs its own path into the OPFS layer that respects the new directory structure.

---

## Unresolved Questions

### Architecture

1. **What is the boundary between "clawser filesystem" and "wnix filesystem"?** The design doc defines two overlapping hierarchies (sections 1-15 vs 16-34). Are they the same thing at different zoom levels? Does clawser implement the full wnix hierarchy eventually? Or are they separate projects?

2. **Which shell executes profile scripts?** Phase 5 defines shell profiles with bash-like syntax (`alias`, `export`, `&&`). Section 21 defines wnsh with incompatible syntax (`if condition { }` instead of `if ... then ... fi`). Which grammar do profile scripts use?

3. **Does the Unix filesystem replace or wrap the current OPFS layout?** The design doc's `resolveVirtualPath()` maps everything under `clawser/` in OPFS. But `WorkspaceFs.resolve()` currently maps under `clawser_workspaces/`. Is the migration: (a) move everything under a new `clawser/` root, or (b) add a translation layer that maps new paths to old storage locations?

4. **What happens to the 18 localStorage domains?** Each needs a corresponding file path. The design doc defines files for some (autonomy, identity, providers, security) but not all (toolPerms, skillsEnabled, sandbox, heartbeat, routines, termSessions, hooks, peripherals, showDotfiles, modelConfig, terminalRenderer, skillHotReload).

### Data & Migration

5. **Is "clean slate" really acceptable?** The design doc says all localStorage and IndexedDB is deleted. This destroys: conversation history, checkpoint data, workspace configs, tool permissions, agent memories, skill settings, routine definitions, terminal sessions. Users lose everything. Is there truly no migration path?

6. **What about users with multiple workspaces?** Clean slate deletes all workspace data. If a user has carefully configured workspaces with specific provider settings, memories, and tool permissions, they lose all of it.

7. **Should there be an export-before-clean-slate mechanism?** Even if we don't migrate, we could export the current state as a downloadable archive before wiping.

### Runtime

8. **How does multi-tab coordination work with the new filesystem?** Two tabs share OPFS. Both would have FileWatchers. Both would write to `/run/clawser/pid`. The `TabCoordinator` in `clawser-daemon.js` uses BroadcastChannel for coordination, but the design doc doesn't integrate with it.

9. **How does disposable mode work?** Currently uses `sessionStorage` instead of `localStorage`. With OPFS-based config, disposable mode needs an in-memory filesystem fallback. The design doc doesn't address this.

10. **What is the async shell command UX?** The shell is described as "async-native" but the current `ClawserShell.exec()` awaits completion. If commands like `cat /dev/clawser/providers/openai` block until an LLM response completes, that's potentially minutes of blocking. How does the user cancel? See status? Run other commands?

---

## Ambiguities in the Design Doc

### 1. Virtual Path Resolution Catch-All

`resolveVirtualPath()` (lines 83-84) treats any path starting with `/` that doesn't match a known prefix as workspace-relative after stripping the leading slash. This means `/unknown/path` silently becomes `clawser/workspaces/{wsId}/unknown/path`. An absolute path that doesn't match any known prefix should probably be an error, not silently mapped into the workspace.

### 2. Two Competing Uptime Sources

`/run/clawser/uptime` (periodically written, by whom?) and `/proc/clawser/uptime` (computed on read) serve the same purpose. Which is authoritative? If both exist, they'll drift apart. The `/run/` version implies a writer process — is that the daemon? The kernel? How often?

### 3. `/sys/` Write Semantics

`/sys/kernel/trace` is documented as writable ("Write `1` to enable tracing, `0` to disable"). But `ProcFileHandler.isProc()` classifies `/sys/` paths as proc files, and `ShellFs.writeFile()` throws "Read-only" for proc paths. The design doc contradicts itself: `/sys/` needs write support for some paths but the implementation blocks all writes.

### 4. `reactiveConfig: false` Chicken-and-Egg

If `daemon.json` has `reactiveConfig: false`, the FileWatcher is disabled. But if the watcher is disabled, changing `daemon.json` back to `reactiveConfig: true` won't be detected. The only way to re-enable reactivity is to restart the application.

### 5. "Block Until Complete" in Async Context

The provider device file documentation says "If streaming is in progress, block until complete." JavaScript/OPFS is async. "Block" here means `await`, which blocks the calling coroutine but not the event loop. But in a shell pipeline context, does this mean the pipe stalls? Can other commands run concurrently? The blocking semantics need clarification.

### 6. Scope of `cleanSlate()`

`cleanSlate()` deletes all `clawser_*` keys from localStorage and all IndexedDB databases matching `clawser*`. But it also creates the new directory structure. If the function fails partway through (after deleting old data but before creating new dirs), the application is in a broken state with no data and no filesystem. Should this be transactional? Should the new dirs be created first, then old data deleted?

### 7. `writeDefaultConfigs()` Is Undefined

Called in `cleanSlate()` but never defined in the design doc. The default values for at least 18 config domains need to be specified. Some schemas are shown (autonomy, identity, provider) but others are not (security, hooks, daemon, sandbox, selfrepair, terminal, model, toolPerms, skillsEnabled, heartbeat, routines, termSessions, peripherals, showDotfiles, terminalRenderer, skillHotReload).

### 8. Channel Device File Incoming Messages

The channel device file has a write handler (sends messages via `channelManager.send()`) but no mechanism for incoming messages to populate `state.lastReceived`. Reading `/dev/clawser/channels/{name}` returns `lastReceived`, but nothing ever sets it.

---

## Edge Cases Not Addressed

### Concurrent Access

1. **Multi-tab OPFS races** — Two tabs sharing OPFS can have concurrent read-modify-write cycles on `workspaces.json`, `permissions.json`, or any config file. OPFS has no file locking mechanism. The `TabCoordinator` uses BroadcastChannel but the design doc doesn't integrate it with filesystem operations.

2. **FileWatcher in multiple tabs** — Each tab runs its own FileWatcher polling the same files. Two watchers detecting the same change trigger duplicate config reloads and duplicate event emissions.

3. **PID file collisions** — `/run/clawser/pid` is written by each tab. The last writer wins. The PID concept doesn't map well to multi-tab browser contexts.

### Failure Modes

4. **Storage quota exhaustion** — OPFS writes fail silently or throw. No quota monitoring, no user warning, no graceful degradation. The snapshot feature (`~/.local/share/clawser/snapshots/{timestamp}.tar`) could consume significant space with no cleanup policy.

5. **Corrupted `permissions.json`** — If the file is corrupted (partial write, invalid JSON), `PermissionManager.#persist()` will fail on next read. The catch block is empty, meaning all permission checks fail open (returning `false` from `isReadOnly`). This is a security concern — corruption grants write access to read-only paths.

6. **Truncated config files** — `createWritable()` + `write()` + `close()` is not atomic. A crash between `write()` and `close()` leaves a truncated file. No write-to-temp-then-rename pattern. Critical for `workspaces.json`, `permissions.json`, provider configs.

7. **Proc generator exceptions** — If a proc generator throws (e.g., `performance.memory` is undefined in Firefox), `ProcFileHandler.handleRead()` propagates the error. Some callers catch, some don't. Uncaught errors in proc reads could crash shell commands.

### Browser Compatibility

8. **`performance.memory.usedJSHeapSize`** — Referenced in the health proc generator. Chrome-only, non-standard. Firefox and Safari return `undefined`. The code uses `|| null` but the health endpoint silently degrades.

9. **SharedArrayBuffer cross-origin isolation** — Required for the shared memory IPC path. Needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers. Not addressed as a deployment requirement.

10. **OPFS in incognito/private browsing** — May not persist (browser-dependent). No detection or fallback.

### Offline & Disposable

11. **Offline provider access** — Provider device files call AI APIs over the network. No queuing, retry, or offline indication when network is unavailable. The generic `catch` sets status to `error` but provides no user feedback.

12. **Disposable mode filesystem** — Currently uses sessionStorage. With OPFS-based storage, disposable mode needs an in-memory filesystem implementation. The design doc's `MemoryFs` (mentioned in the conversation but not in the design doc) could serve this role.

### Missing Operations

13. **Workspace deletion cleanup** — Creating workspace directories is specified; deleting them (removing per-workspace dirs, updating `workspaces.json`, handling deletion of the active workspace) is not.

14. **Watched file deletion** — FileWatcher calls `stat()` and skips if `!stat`. But the subsystem retains stale config. Should deleted config revert to defaults? Trigger an error event?

15. **Log rotation in OPFS** — OPFS doesn't support atomic rename. The rotation logic (`events.jsonl` → `events.1.jsonl`) requires copy + delete, which is not atomic and could lose log entries on failure.

---

## Phase Dependencies

### Documented Phase Order
```
Phase 1 (Directory Layout) → Phase 2 (Reactivity) → Phase 3 (Proc Files)
→ Phase 4 (Device Files) → Phase 5 (Shell Profiles) → Phase 6 (UI Sync)
→ Phase 7 (Init/Boot) → Phase 8 (chmod) → Phase 9 (v86 Mounts)
```

### Undocumented Dependencies

1. **Phase 0 (not in plan): OPFS adapter replacement** — Before any phase begins, `clawser-opfs.js` needs to be updated to support the new directory structure. Both `opfsWalk` and `opfsWalkDir` assume flat relative paths from OPFS root. The new hierarchy nests everything under `clawser/`. This is a prerequisite for Phase 1.

2. **Phase 0.5 (not in plan): `ShellFs` VFS dispatch** — Phase 3 (proc files) and Phase 4 (device files) need `ShellFs.readFile()`/`writeFile()` to dispatch to virtual handlers for `/proc/` and `/dev/` paths. This dispatch logic needs to exist before proc or device files can work.

3. **Phase 8 (chmod) should come before Phase 4 (device files)** — Device files and proc files need read-only protection from the start. Without chmod, writes to `/proc/` paths are only prevented by hardcoded path checks in `ShellFs`. Adding device files without protection means `echo "garbage" > /dev/clawser/providers/openai` could corrupt state.

4. **Phase 5 (shell profiles) depends on shell parser enhancements** — The profile scripts use `export`, `alias`, conditionals (`&&`), and stderr redirection (`2>/dev/null`). The design doc notes "Verify `ClawserShell.source()` handles all profile constructs" — implying it currently may not. If `source` needs enhancement, that's a separate task not scoped in any phase.

5. **Phase 2 (reactivity) depends on `ShellFs.stat()` returning `lastModified`** — The FileWatcher checks `stat.lastModified`. The current `ShellFs.stat()` implementation needs to be verified — it may not return this field from OPFS `File` objects.

6. **Phase 6 (UI panel sync) depends on Phase 3 and 4** — UI panels show health status (proc files) and provider status (device files). The dependency list only shows Phase 1 and 2.

7. **Phase 7 (init/boot) depends on Phase 5 (profiles)** — The boot sequence loads shell profiles as part of initialization. Phase 7 can't fully work without Phase 5's profile system.

8. **The vault system is assumed pre-existing** — The `.env` loader in Phase 5 references `state.services.vault` and calls `vault.set()`. No phase creates or migrates the vault. Its current OPFS path needs to be verified against the new namespace.

9. **`writeDefaultConfigs()` blocks Phase 1** — `cleanSlate()` calls this function, but it's never defined. All default config schemas must be specified before Phase 1 can complete.

---

## Risks

### High Risk

1. **Data loss from clean-slate approach** — Users lose all conversation history, memories, workspace configs, tool permissions, checkpoint data, and routine definitions. No export mechanism is defined. This could cause significant user frustration and is the single highest-risk decision in the plan.

2. **Multi-tab race conditions** — OPFS has no file locking. Config corruption is plausible with concurrent tabs. The existing `TabCoordinator` solves a different problem (leader election, heartbeat) and isn't integrated with filesystem operations. A corrupted `permissions.json` fails open, which is a security issue.

3. **Scope creep from wnix vision** — The design doc contains two designs: a practical clawser filesystem refactor (sections 1-15) and an aspirational wnix OS architecture (sections 16-34). Without a clear boundary, implementation could expand to cover wnix concerns that aren't needed for the immediate refactor.

### Medium Risk

4. **FileWatcher polling overhead** — Polling every 2 seconds across potentially dozens of config files creates ongoing OPFS read traffic. In a multi-tab scenario, this multiplies. Battery and CPU impact on mobile/laptop is unknown.

5. **v86 integration underestimated** — Phase 9 estimates 5-7 days for bidirectional 9p filesystem bridging. The design doc's implementation hooks are a bare skeleton. Realistic estimate is likely 2-4 weeks for a working 9p bridge with error handling, path mapping, and binary file support.

6. **Shell profile compatibility** — If `ClawserShell.source()` doesn't support all the constructs shown in the profile examples (conditionals, redirects, variable expansion in all positions), Phase 5 becomes a shell parser rewrite.

7. **Browser compatibility gaps** — `performance.memory`, SharedArrayBuffer isolation, OPFS in incognito — these are all Chrome-specific or Chrome-first features. Firefox and Safari users may get a degraded experience with no documented fallback paths.

### Lower Risk

8. **Snapshot format unspecified** — `.tar` files in a browser require a library (e.g., tar-js). No library is chosen, no format is documented, no phase covers implementation. Risk: this feature gets forgotten and the directory structure reserves space for something never built.

9. **Log rotation without atomic rename** — OPFS copy+delete is not atomic. Log entries could be lost during rotation. Risk: minor data loss in edge cases, but logs aren't critical data.

10. **`resolveVirtualPath` catch-all** — Silently mapping unknown absolute paths into the workspace is a source of confusing bugs. A user typing `/usr/bin/python` would get `clawser/workspaces/{wsId}/usr/bin/python` instead of an error.
