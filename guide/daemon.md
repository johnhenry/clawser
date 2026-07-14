# Daemon

Multi-tab coordination, SharedWorker, daemon mode, checkpoint/resume, lifecycle

---

### DaemonState

**Status:** ✅ Implemented · **Category:** state · **Since:** v1.5.0

Phase-based state machine for daemon lifecycle. Tracks daemon phase transitions: stopped, starting, running, checkpointing, paused, recovering, error. Manages state transitions with validation.

**Source files:**

- `web/clawser-daemon.js`
- `web/clawser-daemon.d.ts`

**API surface:**

- `DaemonState`
- `DaemonPhase`
- `DaemonTransition`

> **Note:** Phases: stopped → starting → running → checkpointing → paused → recovering → error.

**See also:**

- CheckpointManager
- DaemonController

---

### DaemonController

**Status:** ✅ Implemented · **Category:** controller · **Since:** v1.5.0

Main daemon orchestrator. Controls the background execution lifecycle with periodic checkpointing. Agent continues running tasks even when tab is not focused. Configurable wake intervals and checkpoint frequency.

**Source files:**

- `web/clawser-daemon.js`
- `web/clawser-daemon.d.ts`

**API surface:**

- `DaemonController`

---

### CheckpointManager

**Status:** ✅ Implemented · **Category:** checkpoint · **Since:** v1.5.0

State persistence manager for daemon checkpoints. Supports v2 directory-based and v1 file-based checkpoint formats. Enforces max checkpoint limit. Checkpoints stored in IndexedDB with metadata indexing.

**Source files:**

- `web/clawser-daemon.js`
- `web/clawser-daemon.d.ts`
- `web/clawser-checkpoint-idb.js`

**API surface:**

- `CheckpointManager`
- `CheckpointMeta`
- `CheckpointRestoreResult`

> **Note:** Three-level fallback hierarchy for checkpoint storage.

---

### TabCoordinator

**Status:** ✅ Implemented · **Category:** multi-tab · **Since:** v1.5.0

BroadcastChannel-based coordination between multiple Clawser tabs. Tab ID assignment and discovery, message passing, singleton enforcement, and leader election. One tab becomes the "leader" via election; others defer background tasks to it.

**Source files:**

- `web/clawser-daemon.js`
- `web/clawser-daemon.d.ts`

**API surface:**

- `TabCoordinator`
- `TabInfo`

---

### InputLockManager

**Status:** ✅ Implemented · **Category:** multi-tab · **Since:** v1.5.0

Manages input locking across tabs to prevent concurrent user input when daemon mode is active in a specific tab.

**Source files:**

- `web/clawser-daemon.js`
- `web/clawser-daemon.d.ts`

**API surface:**

- `InputLockManager`

---

### NotificationCenter

**Status:** ✅ Implemented · **Category:** notifications · **Since:** v1.5.0

Daemon notification center for alerting users about daemon state changes, checkpoint events, and error conditions.

**Source files:**

- `web/clawser-daemon.js`
- `web/clawser-daemon.d.ts`

**API surface:**

- `NotificationCenter`
- `Notification`

---

### SharedWorker Client

**Status:** ✅ Implemented · **Category:** shared-worker · **Since:** v1.5.0

Client-side interface for communicating with the SharedWorker. Enables cross-tab state sharing and background processing coordination.

**Source files:**

- `web/clawser-shared-worker-client.js`
- `web/shared-worker.js`

**API surface:**

- `SharedWorkerClient`

---

### Service Worker Heartbeat

**Status:** ✅ Implemented · **Category:** heartbeat · **Since:** v1.5.0

Service Worker-based heartbeat for detecting tab liveness and coordinating daemon responsibilities. Sends periodic pings to verify tab health.

**Source files:**

- `web/clawser-sw-heartbeat.js`
- `web/sw.js`

**API surface:**

- `SWHeartbeat`

---

### Background Runner

**Status:** ✅ Implemented · **Category:** execution · **Since:** v1.5.0

Background task execution engine. Runs agent tasks in the background with progress tracking and error recovery.

**Source files:**

- `web/clawser-background-runner.js`

**API surface:**

- `BackgroundRunner`

---

### Daemon Tools

**Status:** ✅ Implemented · **Category:** tools · **Since:** v1.5.0

Five agent tools for daemon management: daemon_status, daemon_checkpoint, daemon_pause, daemon_resume, daemon_restore.

**Source files:**

- `web/clawser-daemon.js`
- `web/clawser-daemon.d.ts`

**API surface:**

- `DaemonStatusTool`
- `DaemonCheckpointTool`
- `DaemonPauseTool`
- `DaemonResumeTool`
- `DaemonRestoreTool`

---

### Cross-Tab Tool Bridge

**Status:** ✅ Implemented · **Category:** multi-tab · **Since:** v2.0.0

Bridges tool execution across browser tabs via BroadcastChannel. Allows one tab to invoke tools registered in another tab.

**Source files:**

- `web/clawser-daemon.js`

**API surface:**

- `cross_tab_tool_bridge`

---

### Wake Lock

**Status:** ⚠️ Partial · **Category:** power · **Since:** v1.5.0

Screen Wake Lock API integration to prevent the device from sleeping during long-running agent tasks. Falls back gracefully when the API is unavailable.

**Source files:**

- `web/clawser-daemon.js`

**API surface:**

- `wakeLock`

> **Note:** Requires HTTPS and a visible tab. Not supported in all browsers.

---

---

[← Ui](./ui.md) | [Index](./index.md) | [Scheduling →](./scheduling.md)
