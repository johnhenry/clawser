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

---

[← Safety](./safety.md) | [Index](./index.md) | [Agents →](./agents.md)
