# Workspace

Workspaces, persistence, conversations, vault, migration

---

### Workspace Management

**Status:** ✅ Implemented · **Category:** workspaces · **Since:** v1.0.0

Multi-workspace system with isolated state per workspace. Each workspace has its own memory, goals, skills, configurations, conversations, and tool permissions. Workspaces persisted to localStorage with LRU timestamps. OPFS directories per workspace at clawser_workspaces/{wsId}/.

**Source files:**

- `web/clawser-workspaces.js`
- `web/clawser-workspaces.d.ts`

**API surface:**

- `loadWorkspaces`
- `saveWorkspaces`
- `getActiveWorkspaceId`
- `setActiveWorkspaceId`
- `ensureDefaultWorkspace`
- `createWorkspace`
- `renameWorkspace`
- `deleteWorkspace`
- `getWorkspaceName`
- `touchWorkspace`
- `WS_KEY`
- `WS_ACTIVE_KEY`

**See also:**

- Workspace Lifecycle

---

### Workspace Lifecycle

**Status:** ✅ Implemented · **Category:** lifecycle · **Since:** v1.0.0

Workspace initialization, switching, and teardown. Sets up kernel integration, creates shell sessions, and restores state on workspace switch.

**Source files:**

- `web/clawser-workspace-lifecycle.js`
- `web/clawser-workspace-lifecycle.d.ts`
- `web/clawser-workspace-init-ui.js`
- `web/clawser-workspace-init-tools.js`
- `web/clawser-workspace-init-mesh.js`

**API surface:**

- `switchWorkspace`
- `initWorkspace`
- `createShellSession`
- `setKernelIntegration`
- `getKernelIntegration`

---

### OPFS Persistence

**Status:** ✅ Implemented · **Category:** persistence · **Since:** v1.0.0

Primary persistence layer using the Origin Private File System. Stores event logs (JSONL), memory state, skill files, conversation data, and checkpoints. Per-workspace directories with isolated storage.

**Source files:**

- `web/clawser-agent.js`

**API surface:**

- `persistCheckpoint`
- `restoreCheckpoint`
- `persistConversation`
- `restoreConversation`
- `persistMemories`
- `restoreMemories`
- `persistConfig`
- `restoreConfig`

> **Note:** OPFS directories: clawser_skills/ (global), clawser_workspaces/{wsId}/ (per-workspace). Performance target: less than 100ms startup.

---

### localStorage Persistence

**Status:** ✅ Implemented · **Category:** persistence · **Since:** v1.0.0

Secondary persistence for workspace list, active workspace ID, tool permissions, conversation metadata, and application configuration. Faster than OPFS for small key-value data.

**Source files:**

- `web/clawser-workspaces.js`
- `web/clawser-state.js`

**API surface:**

- `loadWorkspaces`
- `saveWorkspaces`

---

### IndexedDB Persistence

**Status:** ✅ Implemented · **Category:** persistence · **Since:** v1.5.0

Tertiary persistence for checkpoint indexing, server route definitions, and terminal session state. Used when structured queries are needed.

**Source files:**

- `web/clawser-checkpoint-idb.js`
- `web/clawser-terminal-session-store.js`

**API surface:**

- `CheckpointIDB`
- `TerminalSessionStore`

---

### Conversations

**Status:** ✅ Implemented · **Category:** conversations · **Since:** v1.0.0

Conversation management with create, load, switch, fork, replay, and export. Conversations are event-sourced via the EventLog. Metadata (id, name, created, lastUsed) stored per-workspace. Full JSONL serialization for portability.

**Source files:**

- `web/clawser-conversations.js`
- `web/clawser-conversations.d.ts`

**API surface:**

- `loadConversations`
- `updateConversationMeta`
- `generateConvId`
- `ConversationMeta`

---

### Checkpoint/Restore

**Status:** ✅ Implemented · **Category:** checkpoint · **Since:** v1.0.0

Binary checkpoint format for full agent state serialization. Checkpoint captures conversation history, memory state, goal state, scheduler jobs, and configuration. Three-level fallback hierarchy: v2 directory-based, v1 file-based, localStorage.

**Source files:**

- `web/clawser-agent.js`
- `web/clawser-daemon.js`

**API surface:**

- `checkpoint`
- `restore`
- `getCheckpointJSON`

> **Note:** Performance target under 64MB memory usage.

**See also:**

- CheckpointManager

---

### Filesystem Mounting

**Status:** ✅ Implemented · **Category:** mount · **Since:** v1.0.0

Mount local filesystem directories into the agent's OPFS namespace using the File System Access API. Supports persisting mount handles across sessions, directory picking, and file picking.

**Source files:**

- `web/clawser-mount.js`
- `web/clawser-mount.d.ts`

**API surface:**

- `MountableFs`
- `persistHandle`
- `restoreHandle`
- `removePersistedHandle`
- `listPersistedMounts`
- `isFileSystemAccessSupported`
- `pickDirectory`
- `pickFile`
- `MountListTool`
- `MountResolveTool`

---

### Filesystem Observer

**Status:** ✅ Implemented · **Category:** observer · **Since:** v1.5.0

Watches for changes in mounted filesystem directories and triggers events when files are created, modified, or deleted.

**Source files:**

- `web/clawser-fs-observer.js`

**API surface:**

- `FsObserver`

---

### Unix Filesystem Architecture

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v2.1.0

Ten-phase Unix filesystem architecture (Phases 0–9) layered on top of OPFS. Canonical directory tree with /etc, /var, /run, /dev, /proc, /home, /tmp, and /mnt namespaces. First-boot bootstrap creates the full hierarchy and writes default config files. Provides the foundation for config reactivity, device files, virtual filesystems, and the profile system.

**Source files:**

- `web/clawser-fs-bootstrap.mjs`

**API surface:**

- `GLOBAL_DIRS`
- `PER_WS_DIRS`
- `DEFAULT_FILES`
- `bootstrapFilesystem`

> **Note:** Phase 0 (OPFS adapter rewrite), Phase 1 (filesystem layout + bootstrap), Phase 2 (config file reactivity), Phase 3 (/proc and /run), Phase 4 (chmod support), Phase 5 (device files), Phase 6 (shell profile + .env loading), Phase 7 (UI ↔ file sync via FsUiSync), Phase 8 (kernel filesystem integration), Phase 9 (v86 guest mount points).

**See also:**

- OPFS Persistence

---

### Config File Reactivity

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v2.1.0

Reactive config store backed by OPFS file watching. FileWatcher polls for changes to config files; ReactiveConfigStore provides subscribe/unsubscribe API with validation and apply callbacks. Editing a config file in the shell automatically propagates changes to the running agent. Uses Web Locks for safe concurrent writes.

**Source files:**

- `web/clawser-reactive-config.mjs`

**API surface:**

- `ReactiveConfigStore`
- `FileWatcher`

> **Note:** Phase 1 of Unix filesystem architecture. Watches files like ~/.config/clawser/autonomy.json and applies changes in real time.

**See also:**

- Unix Filesystem Architecture

---

### /proc Virtual Filesystem

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v2.1.0

Read-only virtual filesystem at /proc/clawser/ that exposes live runtime state as files. Includes agent status, memory stats, active goals, provider info, mesh peers, and kernel tenant data. Files are generated on read from current application state.

**Source files:**

- `web/clawser-proc.js`

**API surface:**

- `ProcFs`

> **Note:** Phase 2 of Unix filesystem architecture. cat /proc/clawser/status returns live agent state as JSON.

---

### /run Virtual Filesystem

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v2.1.0

Runtime state directory at /run/clawser/ for ephemeral data that does not survive restarts. Stores PID files, tab registration, active lock files, and transient session data. Cleared on bootstrap.

**Source files:**

- `web/clawser-fs-bootstrap.mjs`

> **Note:** Phase 3 of Unix filesystem architecture.

---

### Chmod Permissions Layer

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v2.1.0

Virtual Unix-like permission system for the clawser filesystem. Stores owner-mode permissions (read/write/execute) in a manifest persisted to OPFS. chmod builtin sets permissions; ls -l displays them. Enforced on file operations via PermissionManager.

**Source files:**

- `web/clawser-permissions.js`

**API surface:**

- `PermissionManager`
- `checkPermission`
- `setPermission`

> **Note:** Phase 4 of Unix filesystem architecture. Numeric modes simplified to owner-only (e.g. 644 → rw-).

---

### Device Files

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v2.1.0

Read/write device file layer at /dev/clawser/. Writing to a device triggers an action; reading returns the result. Sub-trees for providers (/dev/clawser/providers/), channels (/dev/clawser/channels/), hardware (/dev/clawser/hardware/), and mesh peers (/dev/clawser/mesh/peers/). Plus special devices: /dev/clawser/null, /random, /zero.

**Source files:**

- `web/clawser-fs-devices.mjs`
- `web/clawser-runtime.js`

**API surface:**

- `DeviceFileHandler`
- `registerProviderDevice`
- `registerChannelDevice`
- `registerHardwareDevice`
- `registerMeshPeerDevice`
- `unregisterMeshPeerDevice`
- `registerSpecialDevices`
- `addMeshPeerDevice`
- `removeMeshPeerDevice`

> **Note:** Phase 5 of Unix filesystem architecture. echo "hello" > /dev/clawser/channels/slack sends a message via the Slack channel adapter.

---

### Mesh Peer Device Files

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v2.1.0

Per-peer device files at /dev/clawser/mesh/peers/{peerId}. Read returns peer metadata as JSON ({podId, status, lastSeen, capabilities, peerType, lastMessage}). Write parses a JSON envelope ({type, payload, timeout?}) and dispatches via pod.sendMessage(peerId, envelope), which routes through PeerNode.sendTo using the peer's currently active transport session. Devices register/unregister automatically on discovery events.

**Source files:**

- `web/clawser-fs-devices.mjs`
- `web/clawser-workspace-init-mesh.js`
- `web/clawser-pod.js`
- `web/clawser-peer-node.js`

**API surface:**

- `registerMeshPeerDevice`
- `unregisterMeshPeerDevice`
- `sendMessage`
- `sendTo`
- `hasActiveSession`

> **Note:** UFS §2.7. Documented envelope shape passes type verbatim; unknown types are forwarded to the peer for opt-in handling. Throws "no active session" if the peer hasn't been connected.

**See also:**

- Device Files

---

### .env File Loading

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v2.1.0

Automatic loading of .env files from the workspace root into shell environment variables on workspace init. Supports comments and KEY=VALUE syntax.

**Source files:**

- `web/clawser-fs-bootstrap.mjs`

> **Note:** Phase 7 of Unix filesystem architecture.

---

### Motd and Profile Scripts

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v2.1.0

Message of the day (/etc/clawser/motd) displayed on shell startup. Profile scripts (/etc/clawser/profile and ~/.clshrc) sourced on shell init for setting aliases, environment variables, and custom functions.

**Source files:**

- `web/clawser-fs-bootstrap.mjs`
- `web/clawser-shell.js`

> **Note:** Phase 8 of Unix filesystem architecture.

**See also:**

- Source Builtin and Profile System

---

### Web Locks for OPFS Concurrency

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v2.1.0

Uses the Web Locks API to coordinate concurrent OPFS access across tabs and workers. Prevents data corruption from simultaneous writes to config files, event logs, and checkpoint data.

**Source files:**

- `web/clawser-reactive-config.mjs`
- `web/clawser-fs-bootstrap.mjs`

> **Note:** Integrated into ReactiveConfigStore and bootstrap writes.

---

### Disposable Mode

**Status:** ✅ Implemented · **Category:** workspaces · **Since:** v2.1.0

Ephemeral workspace mode where nothing persists after tab close. No OPFS writes, no localStorage, no IndexedDB. For demos, sensitive work, or guest access.

**Source files:**

- `web/clawser-fs-bootstrap.mjs`

> **Note:** Inspired by Linux on Tab's 'close tab, everything gone' privacy model.

---

### Atomic Workspace Snapshots

**Status:** ✅ Implemented · **Category:** checkpoint · **Since:** v2.1.0

Save and restore the complete workspace state (event log, checkpoint, memories, routines, shell state, skill activations, hooks, localStorage settings) as a single atomic snapshot. Two backends: tar-on-OPFS (default) writes USTAR archives to ~/.local/share/clawser/snapshots/{id}.tar; legacy IndexedDB backend retained for one release for backward compatibility. Top-level shell commands: snapshot save/restore/list/delete/info.

**Source files:**

- `web/clawser-snapshots.js`
- `web/clawser-snapshot-cli.js`
- `web/clawser-tar.mjs`

**API surface:**

- `SnapshotManager`
- `createTarSnapshot`
- `restoreTarSnapshot`
- `listTarSnapshots`
- `deleteTarSnapshot`
- `createAtomicSnapshot`
- `restoreAtomicSnapshot`
- `listSnapshots`
- `deleteSnapshot`

> **Note:** Each subsystem becomes one tar entry; meta.json is the self-describing header. snapshot list merges OPFS-tar and legacy-IDB sources.

---

### USTAR Tar Format

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v2.1.0

Pure-JS POSIX USTAR tar writer/reader. Used by the snapshot system and available for any future export/import flow. Round-trips files with arbitrary content sizes, UTF-8, mtime, mode, and prefix splitting for long names (up to 255 bytes). Validates checksums on read.

**Source files:**

- `web/clawser-tar.mjs`

**API surface:**

- `writeTar`
- `readTar`
- `writeTarFromObject`
- `readTarToObject`

**See also:**

- Atomic Workspace Snapshots

---

---

[← Safety](./safety.md) | [Index](./index.md) | [Agents →](./agents.md)
