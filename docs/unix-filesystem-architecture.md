# Unix Filesystem Architecture for Clawser

**Status:** Proposed  
**Author:** Design System  
**Date:** 2026-04-30  
**Scope:** Replace localStorage/IndexedDB state management with OPFS-backed Unix-conventional filesystem as single source of truth

---

## 1. Overview

Clawser currently stores application state across three mechanisms: localStorage (via `lsKey` helpers in `clawser-state.js`), IndexedDB (via `CheckpointIndexedDB`), and OPFS (via `WorkspaceFs`/`ShellFs`/`MountableFs`). This proposal consolidates all state into the OPFS virtual filesystem using Unix-conventional paths. The shell (`ClawserShell`) and its filesystem adapter (`ShellFs`) become the canonical interface for reading and writing all configuration, data, and runtime state.

### Current State of Affairs

**localStorage** (`clawser-state.js`, lines 72-93) stores workspace-scoped config via versioned keys:
- `clawser_v1_memories_{wsId}`, `clawser_v1_config_{wsId}`, `clawser_v1_autonomy_{wsId}`, `clawser_v1_identity_{wsId}`, `clawser_v1_security_{wsId}`, `clawser_v1_hooks_{wsId}`, `clawser_v1_peripherals_{wsId}`, `clawser_v1_routines_{wsId}`, `clawser_v1_terminal_sessions_{wsId}`, `clawser_v1_model_config_{wsId}`, etc.

**IndexedDB** (`clawser-checkpoint-idb.js`) stores daemon checkpoints and background execution logs.

**OPFS** (`clawser-opfs.js`, `clawser-tools.js`) stores workspace file trees under `clawser/workspaces/{wsId}/`. Internal directories: `.checkpoints`, `.conversations`, `.skills`, `.agents`.

**Workspaces** (`clawser-workspaces.js`) stored as a JSON array in `localStorage` key `clawser/workspaces`, with active workspace in `clawser_active_workspace`.

### Design Principles

1. **Files are the API.** Every piece of state is a file at a well-known path. The shell can `cat`, `echo >`, and pipe any config.
2. **Unix conventions.** `/etc/` for global config, `~/.config/` for per-user (per-workspace) config, `~/.local/share/` for data, `/var/log/` for logs, `/run/` for runtime, `/dev/` for device files, `/proc/` for generated read-only state.
3. **Reactivity through file watching.** Config panels write to files; a watcher detects changes and propagates them to subsystems. The file is always the source of truth.
4. **No migration.** Clean slate. Old localStorage and IndexedDB state is deleted on first boot after this change ships. Users start fresh.

### Resolved Design Decisions

- Changes apply immediately by default (with option to disable watcher per-file or globally)
- `/etc/` is shared globally across all workspaces; `~/.config/` has per-workspace overrides
- No migration path — clean slate (delete old localStorage/IndexedDB state)
- `chmod` semantics supported (read-only protection for system files)
- Provider device files ARE the AI interaction API
- v86 guest can mount the clawser filesystem and vice versa

---

## 2. Filesystem Layout

### 2.1 Path Resolution

The OPFS root is obtained via `navigator.storage.getDirectory()`. All paths below are relative to OPFS root, stored under a top-level `clawser/` directory (all paths use slash separators, e.g. `clawser/workspaces/{wsId}/`).

```
OPFS root/
  clawser/                          # top-level namespace
    etc/clawser/                    # global config (shared across workspaces)
    var/log/clawser/                # global logs
    run/clawser/                    # runtime state
    dev/clawser/                    # device files
    proc/clawser/                   # generated read-only state
    proc/kernel/                    # kernel introspection
    sys/kernel/                     # kernel sysfs
    sys/services/                   # service registry
    tmp/clawser/                    # scratch space
    workspaces/
      {wsId}/                       # per-workspace home directory (~)
        .config/clawser/            # per-workspace config
        .local/share/clawser/       # per-workspace data
```

The `~` tilde expands to `clawser/workspaces/{activeWorkspaceId}` in OPFS terms. `ShellState.resolvePath()` and `WorkspaceFs.resolve()` must be updated to handle this mapping.

**Path mapping function** (new export in `clawser-opfs.js`):

```javascript
const CLAWSER_ROOT = 'clawser';

const resolveVirtualPath = (virtualPath, wsId) => {
  if (virtualPath.startsWith('/etc/'))      return `${CLAWSER_ROOT}${virtualPath}`;
  if (virtualPath.startsWith('/var/'))      return `${CLAWSER_ROOT}${virtualPath}`;
  if (virtualPath.startsWith('/run/'))      return `${CLAWSER_ROOT}${virtualPath}`;
  if (virtualPath.startsWith('/dev/'))      return `${CLAWSER_ROOT}${virtualPath}`;
  if (virtualPath.startsWith('/proc/'))     return `${CLAWSER_ROOT}${virtualPath}`;
  if (virtualPath.startsWith('/sys/'))      return `${CLAWSER_ROOT}${virtualPath}`;
  if (virtualPath.startsWith('/tmp/'))      return `${CLAWSER_ROOT}${virtualPath}`;
  if (virtualPath.startsWith('~/'))         return `${CLAWSER_ROOT}/workspaces/${wsId}/${virtualPath.slice(2)}`;
  // Workspace-relative paths (no leading /)
  return `${CLAWSER_ROOT}/workspaces/${wsId}/${virtualPath.replace(/^\//, '')}`;
};
```

**Disposable mode:** In disposable mode (ephemeral sessions), the same Unix path structure applies but all storage is backed by `MemoryFs` instead of OPFS. No behavioral difference from the shell's perspective — all paths, commands, and file operations work identically. The only difference is persistence: nothing survives page close.

### 2.2 Global Config — `/etc/clawser/`

These files are shared across all workspaces. Equivalent to system-wide configuration.

| Path | Format | Description | Current Source |
|------|--------|-------------|----------------|
| `/etc/clawser/motd` | Plain text | Message of the day, displayed on workspace entry | New |
| `/etc/clawser/profile` | Shell script | Global shell startup script (runs on every workspace init, like `/etc/profile`) | New |
| `/etc/clawser/workspaces.json` | JSON | Workspace registry (replaces `localStorage` key `clawser/workspaces`) | `clawser-workspaces.js` → `loadWorkspaces()` |
| `/etc/clawser/active-workspace` | Plain text | Single line: the active workspace ID (replaces `clawser_active_workspace`) | `clawser-workspaces.js` → `getActiveWorkspaceId()` |
| `/etc/clawser/defaults/autonomy.json` | JSON | Default autonomy config for new workspaces | New |
| `/etc/clawser/defaults/identity.json` | JSON | Default identity config for new workspaces | New |
| `/etc/clawser/defaults/security.json` | JSON | Default security policy for new workspaces | New |
| `/etc/clawser/defaults/terminal.json` | JSON | Default terminal settings for new workspaces | New |
| `/etc/clawser/defaults/daemon.json` | JSON | Default daemon config for new workspaces | New |

**`/etc/clawser/workspaces.json` schema:**

```json
[
  {
    "id": "default",
    "name": "workspace",
    "created": 1714435200000,
    "lastUsed": 1714435200000
  }
]
```

**`/etc/clawser/motd` example:**

```
Welcome to Clawser v2.0
Type 'help' for available commands.
```

**`/etc/clawser/profile` example:**

```bash
# Global profile — runs on every workspace init
export CLAWSER_VERSION=2.0
alias ll="ls -la"
alias cls="clear"
```

### 2.3 Per-Workspace Config — `~/.config/clawser/`

Where `~` resolves to `clawser/workspaces/{wsId}`. Each workspace gets its own config namespace. On workspace creation, files from `/etc/clawser/defaults/` are copied here if they don't exist.

| Path | Format | Description | Current Source |
|------|--------|-------------|----------------|
| `~/.config/clawser/autonomy.json` | JSON | Autonomy level, tool auto-approve, confirmation settings | `lsKey.autonomy(wsId)` |
| `~/.config/clawser/identity.json` | JSON | Agent name, persona, system prompt, model preferences | `lsKey.identity(wsId)` |
| `~/.config/clawser/security.json` | JSON | Security policy, allowed domains, CSP settings | `lsKey.security(wsId)` |
| `~/.config/clawser/hooks.json` | JSON | Lifecycle hooks (pre-send, post-response, etc.) | `lsKey.hooks(wsId)` |
| `~/.config/clawser/daemon.json` | JSON | Daemon mode config (interval, tasks, background behavior) | `lsKey.heartbeat(wsId)` |
| `~/.config/clawser/terminal.json` | JSON | Terminal renderer, session config | `lsKey.terminalRenderer(wsId)` |
| `~/.config/clawser/model.json` | JSON | Model routing config, fallback chains | `lsKey.modelConfig(wsId)` |
| `~/.config/clawser/sandbox.json` | JSON | Sandbox execution policy | `lsKey.sandbox(wsId)` |
| `~/.config/clawser/selfrepair.json` | JSON | Self-repair engine config | `lsKey.selfRepair(wsId)` |
| `~/.config/clawser/peripherals.json` | JSON | Hardware peripheral bindings | `lsKey.peripherals(wsId)` |
| `~/.config/clawser/routines.json` | JSON | Scheduled routines definitions | `lsKey.routines(wsId)` |
| `~/.config/clawser/profile` | Shell script | Per-workspace shell startup (runs after `/etc/clawser/profile`) | New |
| `~/.config/clawser/.env` | KEY=VALUE | API keys and env vars (loaded like Unix env files) | Vault + `lsKey.config(wsId)` |
| `~/.config/clawser/providers/` | Directory | One JSON file per provider | `lsKey.config(wsId)` (embedded) |
| `~/.config/clawser/providers/openai.json` | JSON | OpenAI provider config (model, endpoint, headers) | Part of config blob |
| `~/.config/clawser/providers/anthropic.json` | JSON | Anthropic provider config | Part of config blob |
| `~/.config/clawser/providers/google.json` | JSON | Google AI provider config | Part of config blob |
| `~/.config/clawser/providers/openrouter.json` | JSON | OpenRouter provider config | Part of config blob |
| `~/.config/clawser/providers/local.json` | JSON | Local/Ollama provider config | Part of config blob |
| `~/.config/clawser/agents/` | Directory | One JSON file per agent definition | `clawser_agent_{id}` localStorage keys |
| `~/.config/clawser/agents/{name}.json` | JSON | Agent personality, tools, system prompt | `clawser_agent_{id}` |
| `~/.config/clawser/tool-permissions.json` | JSON | Per-tool permission overrides | `lsKey.toolPerms(wsId)` |
| `~/.config/clawser/skills-enabled.json` | JSON | Enabled skill list | `lsKey.skillsEnabled(wsId)` |
| `~/.config/clawser/show-dotfiles` | Plain text | "true" or "false" | `lsKey.showDotfiles(wsId)` |

**`~/.config/clawser/autonomy.json` schema:**

```json
{
  "level": "supervised",
  "autoApproveTools": ["browser_read_file", "memory_recall"],
  "requireConfirmation": ["browser_write_file", "browser_fetch"],
  "maxAutoIterations": 20,
  "costLimit": 1.00,
  "costLimitAction": "pause"
}
```

**`~/.config/clawser/identity.json` schema:**

```json
{
  "name": "Clawser",
  "persona": "A capable browser-native AI assistant",
  "systemPrompt": "",
  "model": "claude-sonnet-4-20250514",
  "temperature": 0.7,
  "maxTokens": 4096
}
```

**`~/.config/clawser/providers/openai.json` schema:**

```json
{
  "enabled": true,
  "model": "gpt-4o",
  "endpoint": "https://api.openai.com/v1",
  "headers": {},
  "maxTokens": 4096,
  "temperature": 0.7,
  "keyRef": "vault:openai-api-key"
}
```

Note: The `keyRef` field uses a `vault:` prefix to reference a key stored in the encrypted vault at `~/.local/share/clawser/vault/`. API keys are never stored in plaintext config files. The `.env` file is an alternative for users who prefer the `KEY=VALUE` pattern — the loader reads `.env`, stores values in the vault, and injects them into the shell environment.

**`~/.config/clawser/.env` format:**

```bash
# API keys — loaded into shell env and provider configs
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_AI_KEY=AI...

# Custom env vars
CLAWSER_DEBUG=true
DEFAULT_MODEL=claude-sonnet-4-20250514
```

### 2.4 Data — `~/.local/share/clawser/`

Per-workspace persistent data that is not configuration.

| Path | Format | Description | Current Source |
|------|--------|-------------|----------------|
| `~/.local/share/clawser/memory/` | Directory | Individual memory files | `lsKey.memories(wsId)` (JSON blob) |
| `~/.local/share/clawser/memory/{id}.json` | JSON | Single memory entry: `{ key, content, category, timestamp }` | Embedded in memories blob |
| `~/.local/share/clawser/goals/` | Directory | One file per goal | `clawser_goals_{wsId}` |
| `~/.local/share/clawser/goals/{id}.json` | JSON | Goal: `{ id, description, status, steps, created }` | GoalManager |
| `~/.local/share/clawser/skills/` | Directory | Installed skill definitions | `.skills/` OPFS directory |
| `~/.local/share/clawser/skills/{name}/` | Directory | Skill package: `manifest.json`, `handler.js`, etc. | SkillRegistry |
| `~/.local/share/clawser/vault/` | Directory | Encrypted credential blobs | `SecretVault` → `OPFSVaultStorage` |
| `~/.local/share/clawser/vault/keys.enc` | Binary | Encrypted key store | OPFSVaultStorage |
| `~/.local/share/clawser/vault/salt` | Binary | Derivation salt | OPFSVaultStorage |
| `~/.local/share/clawser/conversations/` | Directory | Conversation history | `.conversations/` OPFS directory |
| `~/.local/share/clawser/conversations/{id}.json` | JSON | Full conversation (messages, metadata) | ConversationStore |
| `~/.local/share/clawser/checkpoints/` | Directory | Daemon checkpoints | `CheckpointIndexedDB` |
| `~/.local/share/clawser/checkpoints/{key}.json` | JSON | Serialized checkpoint data | IDB `write(key, data)` |
| `~/.local/share/clawser/snapshots/` | Directory | Atomic filesystem snapshots | New |
| `~/.local/share/clawser/snapshots/{timestamp}.tar` | Binary | Point-in-time snapshot of config + data | New |
| `~/.local/share/clawser/agents/` | Directory | Agent state (distinct from agent config — this is runtime learned state) | `.agents/` OPFS directory |
| `~/.local/share/clawser/terminal/` | Directory | Terminal session persistence | `lsKey.termSessions(wsId)` |
| `~/.local/share/clawser/terminal/sessions.json` | JSON | Active terminal sessions | TerminalSessions |

**Memory file schema (`~/.local/share/clawser/memory/{id}.json`):**

```json
{
  "id": "mem_1714435200_abc",
  "key": "user prefers dark theme",
  "content": "The user explicitly said they prefer dark mode in all interfaces.",
  "category": "preference",
  "timestamp": 1714435200000,
  "source": "conversation",
  "conversationId": "conv_xyz"
}
```

### 2.5 Logs — `/var/log/clawser/`

Global log files. These are append-only and rotate based on size.

| Path | Format | Description | Current Source |
|------|--------|-------------|----------------|
| `/var/log/clawser/events.jsonl` | JSONL | Structured event log (one JSON object per line) | `state.session.eventLog` |
| `/var/log/clawser/errors.log` | Plain text | Error messages with timestamps | `RingBufferLog` |
| `/var/log/clawser/audit.log` | JSONL | Security audit trail (tool executions, permission changes) | New |
| `/var/log/clawser/daemon.log` | Plain text | Daemon execution log | `DaemonController` |

**Log rotation policy:**
- Max file size: 5 MB per log file
- On rotation: rename `events.jsonl` → `events.1.jsonl`, start new `events.jsonl`
- Keep at most 3 rotated files (`.1`, `.2`, `.3`)
- Rotation check runs on every 100th write or on workspace init

**`events.jsonl` line format:**

```json
{"ts":1714435200000,"type":"tool_call","tool":"browser_write_file","args":{"path":"/notes.md"},"result":"success","duration":42}
```

### 2.6 Runtime — `/run/clawser/`

Ephemeral runtime state. Cleared on workspace close or app restart. Not persisted across sessions — these files are generated on boot and updated during operation.

| Path | Format | Description | Current Source |
|------|--------|-------------|----------------|
| `/run/clawser/pid` | Plain text | "1" (virtual — indicates clawser is running) | New |
| `/run/clawser/agent.status` | Plain text | One of: `idle`, `thinking`, `executing`, `error` | `state.ui.isSending` |
| `/run/clawser/cost.json` | JSON | `{ session: 0.042, total: 1.23, limit: 5.00 }` | `state.session.sessionCost` |
| `/run/clawser/workspace` | Plain text | Active workspace ID | `getActiveWorkspaceId()` |
| `/run/clawser/conversation` | Plain text | Active conversation ID | `state.session.activeConversationId` |
| `/run/clawser/tabs/` | Directory | One file per open tab/conversation | New |
| `/run/clawser/tabs/{id}.json` | JSON | Tab state: `{ id, name, lastMessage, unread }` | New |
| `/run/clawser/daemon.status` | Plain text | `running`, `paused`, `stopped` | `DaemonController` |
| `/run/clawser/uptime` | Plain text | Seconds since workspace init | New |

### 2.7 Device Files — `/dev/clawser/`

Device files provide a Unix-style interface to external services. Writing to a device file triggers an action; reading returns the result.

| Path | Type | Description |
|------|------|-------------|
| `/dev/clawser/providers/` | Directory | AI provider device files |
| `/dev/clawser/providers/openai` | Device | OpenAI provider — write prompt, read response |
| `/dev/clawser/providers/anthropic` | Device | Anthropic provider |
| `/dev/clawser/providers/google` | Device | Google AI provider |
| `/dev/clawser/providers/openrouter` | Device | OpenRouter provider |
| `/dev/clawser/providers/local` | Device | Local/Ollama provider |
| `/dev/clawser/channels/` | Directory | Channel device files |
| `/dev/clawser/channels/{name}` | Device | Write message → sends to channel |
| `/dev/clawser/hardware/` | Directory | Hardware peripheral device files |
| `/dev/clawser/hardware/{name}` | Device | Peripheral interface (camera, mic, etc.) |
| `/dev/clawser/mesh/peers/` | Directory | One file per connected mesh peer |
| `/dev/clawser/mesh/peers/{peerId}` | Device | Write → send message to peer, read → last received |
| `/dev/clawser/null` | Device | Discard all writes, read returns empty |
| `/dev/clawser/random` | Device | Read returns random bytes |
| `/dev/clawser/zero` | Device | Read returns null bytes |

### 2.8 Proc — `/proc/clawser/`

Generated, read-only files that reflect live system state. These are not stored on disk — they are synthesized on read by registered handlers.

| Path | Format | Description | Current Source |
|------|--------|-------------|----------------|
| `/proc/clawser/tools` | JSON | List of all registered tools with specs | `BrowserToolRegistry.allSpecs()` |
| `/proc/clawser/metrics` | JSON | Collected metrics snapshot | `MetricsCollector` |
| `/proc/clawser/health` | JSON | `{ status, uptime, memoryUsed, providers }` | New |
| `/proc/clawser/uptime` | Plain text | Seconds since init | New |
| `/proc/clawser/mounts` | Plain text | Mount table (like `/proc/mounts`) | `MountableFs.listMounts()` |
| `/proc/clawser/env` | Plain text | Current environment variables | `ShellState.env` |
| `/proc/clawser/version` | Plain text | Clawser version string | New |
| `/proc/clawser/skills` | JSON | Registered skills and their status | `SkillRegistry` |
| `/proc/clawser/jobs` | JSON | Background shell jobs | `ClawserShell.jobs()` |

### 2.9 Kernel — `/proc/kernel/` and `/sys/kernel/`

Kernel introspection and configuration. Read-only `/proc/kernel/` reflects kernel state; `/sys/kernel/` provides writable tuning knobs.

| Path | Format | Description | Current Source |
|------|--------|-------------|----------------|
| `/proc/kernel/tenants/` | Directory | One file per tenant | `Kernel.listTenants()` |
| `/proc/kernel/tenants/{id}` | JSON | Tenant info: `{ id, capabilities, env }` | `Kernel.getTenant(id)` |
| `/proc/kernel/resources` | JSON | Resource table dump | `Kernel.resources` |
| `/proc/kernel/services` | JSON | Registered services | `Kernel.services` |
| `/sys/kernel/trace` | Plain text | Write `1` to enable tracing, `0` to disable | `Kernel.tracer` |
| `/sys/kernel/chaos` | JSON | Chaos engine config (fault injection) | `Kernel.chaos` |
| `/sys/services/` | Directory | One file per registered service | `ServiceRegistry` |
| `/sys/services/{name}` | JSON | Service metadata and status | `ServiceRegistry` |

### 2.10 Temp — `/tmp/clawser/`

Scratch space for temporary files. Cleared on workspace close.

| Path | Description |
|------|-------------|
| `/tmp/clawser/` | General scratch directory |
| `/tmp/clawser/downloads/` | Temporary download staging |
| `/tmp/clawser/sandbox/` | Sandbox execution temp files |
| `/tmp/clawser/export/` | Export staging area |

---

## 3. Reactivity Layer

### 3.1 Architecture

The reactivity layer sits between the filesystem and application subsystems. It watches config files for changes and propagates updates to the appropriate subsystem.

```
  UI Panel (Settings)                 Shell (echo '{}' > file)
       |                                    |
       v                                    v
  ┌────────────────────────────────────────────┐
  │            OPFS Filesystem                 │
  │         (Single Source of Truth)           │
  └──────────────────┬─────────────────────────┘
                     │
              ┌──────┴──────┐
              │ FileWatcher  │
              │  (polling)   │
              └──────┬──────┘
                     │  debounced change events
                     v
  ┌──────────────────────────────────────────┐
  │          ReactiveConfigBus               │
  │  ┌─────────┐ ┌──────────┐ ┌──────────┐  │
  │  │autonomy │ │identity  │ │providers │  │
  │  │handler  │ │handler   │ │handler   │  │
  │  └─────────┘ └──────────┘ └──────────┘  │
  └──────────────────────────────────────────┘
                     │
                     v
            Subsystem state updated
            UI re-renders via event bus
```

### 3.2 FileWatcher

OPFS does not support native file system events, so we use a polling watcher that tracks file modification times.

**New file: `web/clawser-file-watcher.js`**

```javascript
/**
 * FileWatcher — polls OPFS files for changes and emits events.
 *
 * @example
 *   const watcher = new FileWatcher(fs, { intervalMs: 1000 });
 *   watcher.watch('~/.config/clawser/autonomy.json', (content) => {
 *     applyAutonomyConfig(JSON.parse(content));
 *   });
 *   watcher.start();
 */
export class FileWatcher {
  #fs;                          // ShellFs instance
  #intervalMs;                  // polling interval
  #watches = new Map();         // path → { callback, lastModified, lastContent, debounceTimer }
  #pollTimer = null;
  #enabled = true;
  #debounceMs;

  constructor(fs, { intervalMs = 2000, debounceMs = 300 } = {}) {
    this.#fs = fs;
    this.#intervalMs = intervalMs;
    this.#debounceMs = debounceMs;
  }

  /**
   * Register a file to watch.
   * @param {string} path - Virtual path (e.g., '~/.config/clawser/autonomy.json')
   * @param {(content: string, path: string) => void} callback
   * @param {{ parseJson?: boolean, keepPreviousOnError?: boolean }} opts
   */
  watch(path, callback, opts = {}) {
    this.#watches.set(path, {
      callback,
      lastModified: 0,
      lastContent: null,
      lastValidContent: null,
      debounceTimer: null,
      parseJson: opts.parseJson ?? path.endsWith('.json'),
      keepPreviousOnError: opts.keepPreviousOnError ?? true,
    });
  }

  /** Remove a watch. */
  unwatch(path) {
    const entry = this.#watches.get(path);
    if (entry?.debounceTimer) clearTimeout(entry.debounceTimer);
    this.#watches.delete(path);
  }

  /** Start polling. */
  start() {
    if (this.#pollTimer) return;
    this.#poll();                // immediate first check
    this.#pollTimer = setInterval(() => this.#poll(), this.#intervalMs);
  }

  /** Stop polling. */
  stop() {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
    for (const entry of this.#watches.values()) {
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    }
  }

  /** Enable or disable reactivity (changes only apply on next start/boot if disabled). */
  set enabled(value) { this.#enabled = !!value; }
  get enabled() { return this.#enabled; }

  /** Force re-read all watched files (useful on workspace switch). */
  async rescan() {
    for (const [path, entry] of this.#watches) {
      entry.lastModified = 0;
      entry.lastContent = null;
    }
    await this.#poll();
  }

  async #poll() {
    if (!this.#enabled) return;

    for (const [path, entry] of this.#watches) {
      try {
        const stat = await this.#fs.stat(path);
        if (!stat || stat.kind !== 'file') continue;

        const modified = stat.lastModified || 0;
        if (modified <= entry.lastModified) continue;

        // File changed — read content
        const content = await this.#fs.readFile(path);
        if (content === entry.lastContent) {
          entry.lastModified = modified;
          continue;
        }

        entry.lastModified = modified;
        entry.lastContent = content;

        // Debounce rapid writes
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        entry.debounceTimer = setTimeout(() => {
          entry.debounceTimer = null;
          this.#deliver(path, entry, content);
        }, this.#debounceMs);

      } catch {
        // File doesn't exist or read error — skip
      }
    }
  }

  #deliver(path, entry, content) {
    if (entry.parseJson) {
      try {
        const parsed = JSON.parse(content);
        entry.lastValidContent = parsed;
        entry.callback(parsed, path);
      } catch (e) {
        console.warn(`[FileWatcher] JSON parse error in ${path}: ${e.message}`);
        if (!entry.keepPreviousOnError) {
          entry.callback(null, path);
        }
        // If keepPreviousOnError: silently keep the last valid config
      }
    } else {
      entry.lastValidContent = content;
      entry.callback(content, path);
    }
  }
}
```

### 3.3 ReactiveConfigBus

Connects the `FileWatcher` to subsystems. Registered handlers receive parsed config objects when files change.

**New file: `web/clawser-reactive-config.js`**

```javascript
/**
 * ReactiveConfigBus — wires file changes to subsystem updates.
 * Each config domain registers:
 *   - which file(s) to watch
 *   - a handler that applies the new config
 *   - an optional validator
 */
export class ReactiveConfigBus {
  #watcher;
  #handlers = new Map();    // path → { apply, validate?, domain }

  constructor(watcher) {
    this.#watcher = watcher;
  }

  /**
   * Register a config handler.
   * @param {string} domain - Logical name (e.g., 'autonomy')
   * @param {string} path - File path to watch
   * @param {{ apply: Function, validate?: Function }} handler
   */
  register(domain, path, handler) {
    this.#handlers.set(path, { ...handler, domain });
    this.#watcher.watch(path, (content, filePath) => {
      const h = this.#handlers.get(filePath);
      if (!h) return;

      // Validate if validator provided
      if (h.validate) {
        const errors = h.validate(content);
        if (errors && errors.length > 0) {
          console.warn(`[ReactiveConfig] Validation failed for ${domain}:`, errors);
          return; // keep previous config
        }
      }

      try {
        h.apply(content);
        emit('configChanged', { domain, path: filePath });
      } catch (e) {
        console.error(`[ReactiveConfig] Error applying ${domain} config:`, e);
      }
    });
  }

  /** Unregister a domain. */
  unregister(domain) {
    for (const [path, h] of this.#handlers) {
      if (h.domain === domain) {
        this.#watcher.unwatch(path);
        this.#handlers.delete(path);
      }
    }
  }
}
```

### 3.4 Config Domain Registrations

During workspace init, register all config domains:

```javascript
// In clawser-workspace-lifecycle.js, after filesystem is ready:

configBus.register('autonomy', '~/.config/clawser/autonomy.json', {
  apply: (config) => {
    state.agent?.updateAutonomy(config);
    emit('refreshDashboard');
  },
  validate: (config) => {
    const errors = [];
    if (config.level && !['full', 'supervised', 'locked'].includes(config.level))
      errors.push('Invalid autonomy level');
    if (config.maxAutoIterations && typeof config.maxAutoIterations !== 'number')
      errors.push('maxAutoIterations must be a number');
    return errors;
  },
});

configBus.register('identity', '~/.config/clawser/identity.json', {
  apply: (config) => {
    state.identityManager?.update(config);
    emit('refreshDashboard');
  },
});

configBus.register('security', '~/.config/clawser/security.json', {
  apply: (config) => {
    state.safetyPipeline?.updatePolicy(config);
  },
});

configBus.register('hooks', '~/.config/clawser/hooks.json', {
  apply: (config) => {
    // Re-register lifecycle hooks
  },
});

// Provider configs — watch each file in the providers directory
for (const name of ['openai', 'anthropic', 'google', 'openrouter', 'local']) {
  configBus.register(`provider:${name}`, `~/.config/clawser/providers/${name}.json`, {
    apply: (config) => {
      state.providers?.updateProvider(name, config);
    },
  });
}
```

### 3.5 Disabling Reactivity

Users can disable the watcher globally or per-file. When disabled, changes only apply on workspace init (boot).

**Global toggle** — `~/.config/clawser/daemon.json`:

```json
{
  "reactiveConfig": false
}
```

When `reactiveConfig` is `false`, `FileWatcher.enabled` is set to `false`. The `ReactiveConfigBus` still exists but the watcher never fires. Config is read once at boot and applied.

---

## 4. Device File System

### 4.1 Provider Device Files

Provider device files (`/dev/clawser/providers/{name}`) act as the primary interface for AI interactions from the shell. They behave like Unix character devices with **separate read and write streams**:

- **Writing** to `/dev/clawser/providers/openai` sends the prompt (non-blocking, returns immediately)
- **Reading** from `/dev/clawser/providers/openai` returns the response (blocks until available, or returns last response if already complete)
- This is two separate streams, not a single synchronous call
- Shell usage: `echo "prompt" > /dev/clawser/providers/openai && cat /dev/clawser/providers/openai`

**DeviceFileHandler** — registered in `ShellFs` to intercept reads/writes to `/dev/` paths:

```javascript
/**
 * DeviceFileHandler — intercepts reads/writes to /dev/clawser/ paths.
 *
 * Each device has:
 *   - writeHandler(content): called when data is written to the device
 *   - readHandler(): called when data is read from the device
 *   - state: small mutable state object (last prompt, last response, status)
 */
export class DeviceFileHandler {
  #devices = new Map();   // path → { write, read, state }

  register(path, { write, read, state = {} }) {
    this.#devices.set(path, { write, read, state });
  }

  isDevice(path) {
    return path.startsWith('/dev/clawser/') && this.#devices.has(path);
  }

  async handleWrite(path, content) {
    const dev = this.#devices.get(path);
    if (!dev) throw new Error(`No device at ${path}`);
    return dev.write(content, dev.state);
  }

  async handleRead(path) {
    const dev = this.#devices.get(path);
    if (!dev) throw new Error(`No device at ${path}`);
    return dev.read(dev.state);
  }

  getState(path) {
    return this.#devices.get(path)?.state;
  }
}
```

### 4.2 Provider Device Registration

Each provider gets a device file that maintains a small state machine:

```javascript
const registerProviderDevice = (deviceHandler, providerName, providers) => {
  const path = `/dev/clawser/providers/${providerName}`;

  deviceHandler.register(path, {
    state: {
      lastPrompt: null,
      lastResponse: null,
      status: 'idle',        // idle | thinking | streaming | error
      streaming: false,
      streamBuffer: '',
      streamResolve: null,   // resolves when streaming completes
    },

    write: async (content, state) => {
      state.lastPrompt = content.trim();
      state.status = 'thinking';
      state.lastResponse = null;
      state.streamBuffer = '';

      try {
        // Create a promise that resolves when streaming is done
        const responsePromise = new Promise((resolve) => {
          state.streamResolve = resolve;
        });

        const provider = providers.get(providerName);
        if (!provider) throw new Error(`Provider ${providerName} not configured`);

        // Send to provider with streaming callback
        const result = await provider.complete({
          messages: [{ role: 'user', content: state.lastPrompt }],
          onToken: (token) => {
            state.streamBuffer += token;
            state.status = 'streaming';
          },
        });

        state.lastResponse = result.content || state.streamBuffer;
        state.status = 'idle';
        state.streamResolve?.(state.lastResponse);
        state.streamResolve = null;

        return state.lastResponse;
      } catch (e) {
        state.status = 'error';
        state.lastResponse = `Error: ${e.message}`;
        state.streamResolve?.(state.lastResponse);
        state.streamResolve = null;
        throw e;
      }
    },

    read: async (state) => {
      // If streaming is in progress, block until complete
      if (state.status === 'thinking' || state.status === 'streaming') {
        if (state.streamResolve) {
          // Wait for the stream to finish
          await new Promise((resolve) => {
            const original = state.streamResolve;
            state.streamResolve = (val) => {
              original?.(val);
              resolve(val);
            };
          });
        }
      }

      return state.lastResponse ?? '';
    },
  });
};
```

### 4.3 Shell Usage Examples

```bash
# Send a prompt to OpenAI
echo "What is the capital of France?" > /dev/clawser/providers/openai

# Read the response (blocks until complete)
cat /dev/clawser/providers/openai
# → Paris is the capital of France.

# Pipe a file through a provider
cat document.txt | echo "Summarize this: $(cat)" > /dev/clawser/providers/anthropic
cat /dev/clawser/providers/anthropic

# Simpler pipe syntax (provider reads stdin if prompt references it)
echo "summarize" > /dev/clawser/providers/openai < report.txt

# Chain providers
echo "translate to French" > /dev/clawser/providers/openai
cat /dev/clawser/providers/openai > /dev/clawser/providers/anthropic
# (anthropic now has the translated text as its prompt)

# Check provider status
cat /dev/clawser/providers/openai   # returns last response if idle
```

### 4.4 Special Device Files

```javascript
// /dev/clawser/null — discard writes, empty reads
deviceHandler.register('/dev/clawser/null', {
  write: async () => '',
  read: async () => '',
});

// /dev/clawser/random — read returns random hex string
deviceHandler.register('/dev/clawser/random', {
  write: async () => '',
  read: async () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  },
});

// /dev/clawser/zero — read returns null bytes (as empty string in text mode)
deviceHandler.register('/dev/clawser/zero', {
  write: async () => '',
  read: async () => '\0'.repeat(256),
});
```

### 4.5 Channel Device Files

```javascript
// /dev/clawser/channels/{name} — write sends message, read returns last received
const registerChannelDevice = (deviceHandler, channelName, channelManager) => {
  deviceHandler.register(`/dev/clawser/channels/${channelName}`, {
    state: { lastReceived: null },
    write: async (content, state) => {
      await channelManager.send(channelName, content.trim());
      return '';
    },
    read: async (state) => {
      return state.lastReceived ?? '';
    },
  });
};
```

### 4.6 ShellFs Integration

`ShellFs.readFile()` and `ShellFs.writeFile()` must check for device file paths before delegating to OPFS:

```javascript
// In ShellFs class:

async readFile(path) {
  // Check device files first
  if (this.#deviceHandler?.isDevice(path)) {
    return this.#deviceHandler.handleRead(path);
  }
  // Check proc files
  if (this.#procHandler?.isProc(path)) {
    return this.#procHandler.handleRead(path);
  }
  // Normal OPFS read
  const [parent, name] = await this.#getParentAndName(path);
  const fh = await parent.getFileHandle(name);
  const file = await fh.getFile();
  return file.text();
}

async writeFile(path, content) {
  // Check device files first
  if (this.#deviceHandler?.isDevice(path)) {
    return this.#deviceHandler.handleWrite(path, content);
  }
  // Guard against writes to read-only paths
  this.#guardWrite(path);
  if (this.#procHandler?.isProc(path)) {
    throw new Error(`Read-only: ${path} is a proc file`);
  }
  // Check chmod permissions
  if (this.#permissions?.isReadOnly(path)) {
    throw new Error(`Permission denied: ${path} is read-only (chmod)`);
  }
  // Normal OPFS write
  const opfsPath = this.#resolve(path);
  const { dir, name } = await opfsWalk(opfsPath, { create: true });
  const fh = await dir.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
}
```

### 4.7 Web Locks for Concurrent Access

OPFS file access uses the Web Locks API (`navigator.locks.request()`) to prevent multi-tab race conditions. This ensures that concurrent writes from multiple browser tabs do not corrupt config files.

**Locking strategy:**
- **Config file writes** acquire a named lock before writing: lock name pattern is `clawser:config:{filename}` (e.g., `clawser:config:autonomy.json`)
- **Reads are lockless** — they always read the latest committed state without acquiring a lock
- This prevents corrupted config from concurrent writes while keeping reads fast

```javascript
// In ShellFs.writeFile() for config paths:
const writeConfigFile = async (path, content) => {
  const filename = path.split('/').pop();
  await navigator.locks.request(`clawser:config:${filename}`, async () => {
    const opfsPath = resolveVirtualPath(path, activeWsId);
    const { dir, name } = await opfsWalk(opfsPath, { create: true });
    const fh = await dir.getFileHandle(name, { create: true });
    const writable = await fh.createWritable();
    await writable.write(content);
    await writable.close();
  });
};
```

**Note:** Web Locks are advisory and scoped to the origin. They prevent races between tabs of the same clawser instance but do not provide filesystem-level locking.

---

## 5. Shell Profile System

### 5.1 Profile Loading Order

On workspace init, profiles are sourced in this order (matching Unix convention):

1. `/etc/clawser/profile` — global profile (shared across all workspaces)
2. `~/.config/clawser/.env` — workspace env vars (loaded into shell environment)
3. `~/.config/clawser/profile` — workspace profile (can override global settings)

### 5.2 Profile Script Capabilities

Profile scripts support the full shell command set:

```bash
# Aliases
alias ll="ls -la"
alias gs="cat /run/clawser/agent.status"
alias cost="cat /run/clawser/cost.json"

# Environment variables
export DEFAULT_MODEL=claude-sonnet-4-20250514
export MAX_TOKENS=8192
export CLAWSER_THEME=dark

# Custom shell functions (stored as aliases with complex commands)
alias summarize="echo 'Summarize the following:' > /dev/clawser/providers/openai < "
alias translate="echo 'Translate to French:' > /dev/clawser/providers/anthropic < "

# Conditional setup
cat /proc/clawser/health > /dev/clawser/null 2>&1 && echo "System healthy"

# Display MOTD
cat /etc/clawser/motd 2>/dev/null
```

**Note on clsh parser requirements:** clsh is the full shell language upgrade that includes the complete EBNF grammar (capability blocks, group execution, typed values, conditionals, loops — see §21). The profile system depends on clsh being complete enough to parse profile scripts with conditionals and function definitions. Specifically, profile script support requires the clsh parser to handle multi-line functions, conditionals, loops, and here-docs. This means the profile system (Phase 6) depends on the clsh parser upgrade being substantially complete.

### 5.3 `.env` Loading

The `.env` loader runs before the workspace profile, making env vars available to profile scripts and provider configs.

```javascript
/**
 * Load a .env file into the shell environment and optionally into provider configs.
 * Supports: KEY=VALUE, KEY="quoted value", KEY='single quoted', # comments, blank lines.
 */
const loadEnvFile = async (shell, path) => {
  let content;
  try {
    content = await shell.fs.readFile(path);
  } catch {
    return; // file doesn't exist — not an error
  }

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    shell.state.env.set(key, value);

    // Auto-map known env vars to provider configs
    // OPENAI_API_KEY → store in vault, update provider config
    if (key.endsWith('_API_KEY') || key.endsWith('_KEY')) {
      const vault = state.services.vault;
      if (vault && !vault.isLocked) {
        const vaultKey = key.toLowerCase().replace(/_/g, '-');
        await vault.set(vaultKey, value);
      }
    }
  }
};
```

### 5.4 `source()` and Profile Scripts

The `source()` builtin reads a file and executes it line-by-line in the current shell context (no subprocess). For profile scripts to work as intended, `source()` must handle the full clsh grammar: multi-line function definitions, conditionals (`if ... { }`), loops (`while ... { }`), and here-docs. Without this, profile scripts are limited to simple aliases and exports.

**Implication:** The profile system cannot be fully realized until the clsh parser upgrade is substantially complete. Early phases can support basic profiles (aliases, exports, simple commands), but advanced profiles with conditionals and functions require the full parser.

### 5.5 Profile Execution on Init

In `clawser-workspace-lifecycle.js`, the workspace init sequence becomes:

```javascript
const initWorkspace = async (wsId) => {
  // 1. Set workspace in filesystem adapter
  state.workspaceFs.setWorkspace(wsId);

  // 2. Ensure directory structure exists
  await ensureDirectoryStructure(wsId);

  // 3. Create shell session
  const shell = createShellSession();

  // 4. Source global profile
  await shell.source('/etc/clawser/profile');

  // 5. Load workspace .env
  await loadEnvFile(shell, '~/.config/clawser/.env');

  // 6. Source workspace profile
  await shell.source('~/.config/clawser/profile');

  // 7. Display MOTD (if not suppressed)
  try {
    const motd = await shell.fs.readFile('/etc/clawser/motd');
    if (motd.trim()) addMsg('system', motd.trim());
  } catch { /* no motd */ }

  // 8. Start file watcher
  fileWatcher.start();

  // 9. Read and apply all config files
  await configBus.rescan();
};
```

---

## 6. UI ↔ File Sync

### 6.1 Principle

Config panels are thin views over files. They have no local state of their own — they read from files on render and write to files on save. The `FileWatcher` closes the loop by refreshing the UI when files change externally (e.g., from the shell).

### 6.2 Config Panel Lifecycle

```
  ┌────────────────────────────────────────────────────┐
  │                  Config Panel                       │
  │                                                     │
  │  1. onRender:  content = await fs.readFile(path)   │
  │                populateFormFields(content)           │
  │                                                     │
  │  2. onSave:    content = serializeFormFields()      │
  │                await fs.writeFile(path, content)     │
  │                                                     │
  │  3. onFileChange (from FileWatcher):                │
  │                content = newContent                  │
  │                populateFormFields(content)           │
  │                                                     │
  └────────────────────────────────────────────────────┘
```

### 6.3 Implementation Pattern

Every config panel follows this pattern:

```javascript
// Example: Autonomy panel

const AUTONOMY_PATH = '~/.config/clawser/autonomy.json';

const renderAutonomyPanel = async (container, fs) => {
  // Read current config from file
  let config;
  try {
    const content = await fs.readFile(AUTONOMY_PATH);
    config = JSON.parse(content);
  } catch {
    config = { level: 'supervised', autoApproveTools: [], maxAutoIterations: 20 };
  }

  // Populate form fields
  container.querySelector('#autonomy-level').value = config.level;
  container.querySelector('#max-iterations').value = config.maxAutoIterations;
  // ... etc

  // Save handler
  container.querySelector('#save-autonomy').addEventListener('click', async () => {
    const newConfig = {
      level: container.querySelector('#autonomy-level').value,
      maxAutoIterations: parseInt(container.querySelector('#max-iterations').value, 10),
      autoApproveTools: /* gather from UI */,
    };
    await fs.writeFile(AUTONOMY_PATH, JSON.stringify(newConfig, null, 2));
    // FileWatcher will pick up the change and emit 'configChanged'
    // which triggers subsystem update — no direct subsystem call needed here
  });
};

// Register for file-change refresh
on('configChanged', ({ domain, path }) => {
  if (domain === 'autonomy') {
    renderAutonomyPanel(container, fs);
  }
});
```

### 6.4 ConfigCache Replacement

The existing `ConfigCache` class (`clawser-state.js`, lines 330-434) is replaced by direct OPFS reads. Since OPFS reads are async, we add a thin in-memory cache layer within the `FileWatcher` itself (via `lastValidContent`). The `ConfigCache` class and `configCache` singleton are deprecated and removed.

### 6.5 Event Flow

When a user changes a setting in the UI:
1. UI calls `fs.writeFile('~/.config/clawser/autonomy.json', newContent)`
2. `ShellFs.writeFile()` writes to OPFS
3. `FileWatcher` detects the change on next poll (within `intervalMs`, typically 2 seconds)
4. `FileWatcher` debounces (300ms) then calls the registered callback
5. `ReactiveConfigBus` validates and applies the config to the subsystem
6. `ReactiveConfigBus` emits `configChanged` on the event bus
7. Any open UI panels re-render with the new data

When a user changes a setting from the shell:
1. User runs `echo '{"level":"full"}' > ~/.config/clawser/autonomy.json`
2. `ShellFs.writeFile()` writes to OPFS (same path)
3. Steps 3-7 above are identical — the UI refreshes automatically

---

## 7. chmod Support

### 7.1 Permission Model

Since OPFS doesn't support native permissions, we implement a virtual permission layer stored as a metadata file.

**Metadata file:** `clawser/permissions.json` (at OPFS root level, outside any workspace)

```json
{
  "/etc/clawser/profile": { "mode": "0644", "owner": "system" },
  "/proc/clawser/tools": { "mode": "0444", "owner": "system" },
  "/run/clawser/pid": { "mode": "0444", "owner": "system" }
}
```

### 7.2 PermissionManager

```javascript
export class PermissionManager {
  #permissions = new Map();  // path → { mode, owner }
  #fs;                       // raw OPFS access (not through ShellFs to avoid circular)

  async load() {
    try {
      const content = await this.#readRaw('clawser/permissions.json');
      const data = JSON.parse(content);
      for (const [path, perms] of Object.entries(data)) {
        this.#permissions.set(path, perms);
      }
    } catch { /* no permissions file yet */ }
  }

  isReadOnly(path) {
    const perms = this.#permissions.get(path);
    if (!perms) return false;
    // Check if write bit is unset (Unix: mode & 0o200 === 0)
    const mode = parseInt(perms.mode, 8);
    return (mode & 0o200) === 0;
  }

  async chmod(path, mode) {
    this.#permissions.set(path, {
      ...this.#permissions.get(path),
      mode: typeof mode === 'number' ? mode.toString(8).padStart(4, '0') : mode,
    });
    await this.#persist();
  }

  async #persist() {
    const obj = Object.fromEntries(this.#permissions);
    await this.#writeRaw('clawser/permissions.json', JSON.stringify(obj, null, 2));
  }
}
```

### 7.3 Shell `chmod` Command

```javascript
registry.register('chmod', async ({ args, state, fs }) => {
  if (args.length < 2) return { stdout: '', stderr: 'chmod: usage: chmod MODE FILE', exitCode: 1 };
  const mode = args[0];
  const path = state.resolvePath(args[1]);

  if (!/^[0-7]{3,4}$/.test(mode)) {
    return { stdout: '', stderr: `chmod: invalid mode: ${mode}`, exitCode: 1 };
  }

  await fs.permissions.chmod(path, mode);
  return { stdout: '', stderr: '', exitCode: 0 };
}, { description: 'Change file permissions', category: 'File Operations', usage: 'chmod MODE FILE' });
```

---

## 8. Proc File System

### 8.1 ProcFileHandler

Proc files are generated on read. They have no backing storage — a handler function produces the content each time `readFile()` is called on a `/proc/` path.

```javascript
export class ProcFileHandler {
  #generators = new Map();   // path → () => string|Promise<string>

  register(path, generator) {
    this.#generators.set(path, generator);
  }

  isProc(path) {
    if (!path.startsWith('/proc/') && !path.startsWith('/sys/')) return false;
    return this.#generators.has(path) || this.#matchesDirectory(path);
  }

  async handleRead(path) {
    const gen = this.#generators.get(path);
    if (!gen) throw new Error(`No proc handler for ${path}`);
    return gen();
  }

  #matchesDirectory(path) {
    for (const key of this.#generators.keys()) {
      if (key.startsWith(path + '/')) return true;
    }
    return false;
  }

  /** List entries under a proc directory */
  listDir(path) {
    const prefix = path.endsWith('/') ? path : path + '/';
    const entries = new Set();
    for (const key of this.#generators.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const name = rest.split('/')[0];
        entries.add({ name, kind: rest.includes('/') ? 'directory' : 'file' });
      }
    }
    return [...entries];
  }
}
```

### 8.2 Proc Registrations

```javascript
// Register all proc file generators during init

proc.register('/proc/clawser/tools', () => {
  return JSON.stringify(state.browserTools.allSpecs(), null, 2);
});

proc.register('/proc/clawser/metrics', () => {
  return JSON.stringify(state.metricsCollector?.snapshot() || {}, null, 2);
});

proc.register('/proc/clawser/health', () => {
  return JSON.stringify({
    status: state.shuttingDown ? 'shutting_down' : 'running',
    uptime: Math.floor((Date.now() - bootTime) / 1000),
    memoryUsed: performance?.memory?.usedJSHeapSize || null,
    providers: Object.fromEntries(
      (state.providers?.list() || []).map(p => [p.name, p.status])
    ),
  }, null, 2);
});

proc.register('/proc/clawser/uptime', () => {
  return String(Math.floor((Date.now() - bootTime) / 1000));
});

proc.register('/proc/clawser/mounts', () => {
  const mounts = state.workspaceFs?.listMounts() || [];
  return mounts.map(m => `${m.source} on ${m.mountPoint} type ${m.kind}`).join('\n') + '\n';
});

proc.register('/proc/clawser/env', () => {
  const shell = state.services.shell;
  if (!shell) return '';
  return [...shell.state.env.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
});

proc.register('/proc/clawser/version', () => {
  return 'clawser 2.0.0\n';
});

proc.register('/proc/clawser/skills', () => {
  const reg = state.services.skillRegistry;
  if (!reg) return '{}';
  return JSON.stringify(reg.listAll(), null, 2);
});

proc.register('/proc/clawser/jobs', () => {
  const shell = state.services.shell;
  if (!shell) return '[]';
  return JSON.stringify(shell.jobs(), null, 2);
});

// Kernel proc entries
proc.register('/proc/kernel/tenants', () => {
  return JSON.stringify(state.kernel?.listTenants() || [], null, 2);
});

proc.register('/proc/kernel/resources', () => {
  return JSON.stringify(state.kernel?.resources?.snapshot?.() || {}, null, 2);
});

proc.register('/proc/kernel/services', () => {
  return JSON.stringify(state.kernel?.services?.list?.() || [], null, 2);
});

// Sys entries (writable)
proc.register('/sys/kernel/trace', () => {
  return state.kernel?.tracer?.enabled ? '1\n' : '0\n';
});
```

---

## 9. v86 Guest Mount Points

### 9.1 Bidirectional Mounting

The v86 emulator guest OS can mount the clawser OPFS filesystem, and clawser can mount guest filesystem paths under `/mnt/`.

**Clawser → Guest:** The v86 guest sees clawser's filesystem via a Plan 9 (9p) shared folder or virtio-fs. The entire `clawser/` OPFS tree is exposed as a mount point inside the guest (e.g., at `/mnt/clawser/` in the guest).

**Guest → Clawser:** Guest filesystem paths are mounted into clawser's namespace via the existing `MountableFs.mount()` API, appearing under `/mnt/guest/` in clawser's virtual filesystem.

### 9.2 Implementation Hooks

```javascript
// In v86 integration module:

// Expose clawser OPFS to guest via 9p
const exposeToGuest = (emulator, shellFs) => {
  // Register a 9p filesystem provider backed by ShellFs
  emulator.fs9p.OnOpen = async (path) => shellFs.readFile(path);
  emulator.fs9p.OnWrite = async (path, data) => shellFs.writeFile(path, data);
  // ... etc
};

// Mount guest paths into clawser
const mountGuestPath = (workspaceFs, emulator, guestPath, mountPoint) => {
  const adapter = {
    readFile: (path) => emulator.readFile(guestPath + path),
    writeFile: (path, content) => emulator.writeFile(guestPath + path, content),
    listDir: (path) => emulator.listDir(guestPath + path),
    stat: (path) => emulator.stat(guestPath + path),
    readOnly: false,
    metadata: { source: 'v86-guest', guestPath },
  };
  workspaceFs.mountAdapter(mountPoint || `/mnt/guest`, adapter);
};
```

---

## 10. Implementation Plan

### Phase 0: OPFS Adapter Rewrite

**Goal:** Rewrite OPFS path handling to use the new slash-based namespace (`clawser/workspaces/{wsId}/` instead of the old underscore-separated convention). Create the base directory structure on first boot.

**Tasks:**
- Rewrite all OPFS path resolution to use slash-separated paths consistently
- Create the base directory structure (`clawser/`, `clawser/etc/`, `clawser/workspaces/`, etc.) on first boot
- Define and implement `writeDefaultConfigs()` — creates default config files if they don't exist (`autonomy.json`, `identity.json`, `security.json`, `daemon.json`, `terminal.json`, etc. with sensible defaults)
- Verify path mapping works end-to-end with `resolveVirtualPath()`

**Files to modify:**
| File | Change |
|------|--------|
| `web/clawser-opfs.js` | Rewrite path handling, add `resolveVirtualPath()`, `CLAWSER_ROOT` |
| `web/clawser-fs-bootstrap.js` | Implement `ensureDirectoryStructure()`, `writeDefaultConfigs()` |

**Estimated complexity:** Medium (3-4 days)  
**Dependencies:** None — **this blocks all other phases**

### Phase 1: Filesystem Layout + Bootstrap

**Goal:** Create the OPFS directory structure and write config files from current state. All reads still come from localStorage; this phase only adds the write side.

**Files to create:**
| File | Description |
|------|-------------|
| `web/clawser-fs-layout.js` | Directory structure constants, `ensureDirectoryStructure()`, path resolver |
| `web/clawser-fs-bootstrap.js` | First-boot setup: create all directories, write default config files |

**Files to modify:**
| File | Change |
|------|--------|
| `web/clawser-opfs.js` | Add `resolveVirtualPath()` export, `CLAWSER_ROOT` constant |
| `web/clawser-workspaces.js` | Add OPFS write-through: `saveWorkspaces()` also writes to `/etc/clawser/workspaces.json` |
| `web/clawser-workspace-lifecycle.js` | Call `ensureDirectoryStructure()` on workspace init |

**Estimated complexity:** Medium (3-4 days)  
**Dependencies:** Phase 0

### Phase 2: Config File Reactivity

**Goal:** Implement `FileWatcher` and `ReactiveConfigBus`. Config subsystems read from files instead of localStorage.

**Files to create:**
| File | Description |
|------|-------------|
| `web/clawser-file-watcher.js` | `FileWatcher` class (polling, debounce, JSON error handling) |
| `web/clawser-reactive-config.js` | `ReactiveConfigBus` class, config domain registrations |

**Files to modify:**
| File | Change |
|------|--------|
| `web/clawser-state.js` | Deprecate `ConfigCache`, `lsKey` (keep for backward compat during transition) |
| `web/clawser-workspace-lifecycle.js` | Create `FileWatcher` + `ReactiveConfigBus` on workspace init, wire to subsystems |
| `web/clawser-app.js` | Instantiate watcher, pass to workspace lifecycle |

**Estimated complexity:** Medium (3-4 days)  
**Dependencies:** Phase 0, Phase 1

### Phase 3: /proc and /run

**Goal:** Implement generated read-only proc files and runtime state files.

**Files to create:**
| File | Description |
|------|-------------|
| `web/clawser-proc.js` | `ProcFileHandler` class, all proc generator registrations |
| `web/clawser-runtime.js` | Runtime state writer (updates `/run/` files on state changes) |

**Files to modify:**
| File | Change |
|------|--------|
| `web/clawser-shell.js` | `ShellFs.readFile()` and `listDir()` check proc handler before OPFS |
| `web/clawser-workspace-lifecycle.js` | Register proc generators on init, write `/run/clawser/pid` |

**Estimated complexity:** Low-Medium (2-3 days)  
**Dependencies:** Phase 0, Phase 1

### Phase 4: chmod Support

**Goal:** Virtual permission layer with `chmod` shell command. Provides write protection before device files are exposed.

**Files to create:**
| File | Description |
|------|-------------|
| `web/clawser-permissions.js` | `PermissionManager` class, persistence in OPFS |

**Files to modify:**
| File | Change |
|------|--------|
| `web/clawser-shell.js` | `ShellFs.writeFile()` checks permissions; add `chmod` builtin; add `stat` output for permissions |
| `web/clawser-fs-bootstrap.js` | Set default permissions on system files (`/etc/`, `/proc/` are read-only) |

**Estimated complexity:** Low-Medium (2-3 days)  
**Dependencies:** Phase 0, Phase 1

### Phase 5: Device Files (`/dev/clawser/providers/`)

**Goal:** Implement provider device files that turn `echo "prompt" > /dev/clawser/providers/openai` into real provider calls.

**Files to create:**
| File | Description |
|------|-------------|
| `web/clawser-device-files.js` | `DeviceFileHandler`, provider device registration, special devices (`/dev/null`, etc.) |

**Files to modify:**
| File | Change |
|------|--------|
| `web/clawser-shell.js` | `ShellFs.readFile()` and `writeFile()` check device handler; `listDir()` for `/dev/` |
| `web/clawser-workspace-lifecycle.js` | Register provider devices on init, register channel devices |
| `web/clawser-providers.js` | Expose provider `complete()` interface for device handler consumption |

**Estimated complexity:** High (4-5 days)  
**Dependencies:** Phase 0, Phase 1, Phase 3 (for consistent ShellFs interception pattern), Phase 4 (chmod provides write protection)

### Phase 6: Shell Profile and `.env` Loading

**Goal:** Source `/etc/clawser/profile`, load `.env`, source workspace profile on init.

**Files to create:**
| File | Description |
|------|-------------|
| `web/clawser-env-loader.js` | `.env` parser and loader (KEY=VALUE, quotes, comments, vault integration) |

**Files to modify:**
| File | Change |
|------|--------|
| `web/clawser-shell.js` | Verify `ClawserShell.source()` handles all profile constructs (aliases, exports, conditionals) |
| `web/clawser-workspace-lifecycle.js` | Add profile sourcing sequence to workspace init |
| `web/clawser-shell-builtins.js` | Add `source` as a builtin command (alias for shell.source()) |
| `web/clawser-fs-bootstrap.js` | Write default `/etc/clawser/profile` and `motd` on first boot |

**Estimated complexity:** Low-Medium (2-3 days)  
**Dependencies:** Phase 0, Phase 1, Phase 5 (profiles may use device files)

### Phase 7: UI Panel Sync

**Goal:** Rewrite all config panels to read from / write to files. Remove all direct localStorage access from UI code.

**Files to modify:**
| File | Change |
|------|--------|
| `web/clawser-ui-panels.js` | All config panel render functions read from files; save handlers write to files |
| `web/clawser-accounts.js` | `saveConfig()` writes to `~/.config/clawser/providers/*.json` instead of localStorage |
| `web/clawser-ui-chat.js` | Settings button handlers delegate to file-backed panels |
| `web/clawser-state.js` | Remove `lsKey` exports (breaking change — all callers must be updated) |

**Estimated complexity:** High (5-7 days)  
**Dependencies:** Phase 0, Phase 1, Phase 2

### Phase 8: Kernel Filesystem Integration

**Goal:** Wire kernel introspection into `/proc/kernel/` and `/sys/kernel/` paths. Support writable sysfs for kernel tuning.

**Files to modify:**
| File | Change |
|------|--------|
| `web/clawser-proc.js` | Add kernel proc generators (tenants, resources, services) |
| `web/clawser-shell.js` | `ShellFs.writeFile()` handles `/sys/kernel/trace` writes |
| `web/clawser-kernel-integration.js` | Expose kernel state for proc generators |

**Estimated complexity:** Low (1-2 days)  
**Dependencies:** Phase 3

### Phase 9: v86 Guest Mount Points

**Goal:** Bidirectional filesystem sharing between clawser and v86 guest OS.

**Files to modify:**
| File | Change |
|------|--------|
| `web/clawser-mount.js` | Add `mountAdapter()` support for v86 guest filesystem adapter |
| v86 integration module | Implement 9p/virtio-fs bridge backed by `ShellFs` |

**Estimated complexity:** High (5-7 days)  
**Dependencies:** Phase 0, Phase 1, Phase 5 (device files should work before exposing to guest)

---

## 11. Directory Structure Initialization

On first boot (or after clean slate), the following directory tree is created:

```javascript
const DIRECTORY_TREE = [
  // Global
  'clawser/etc/clawser',
  'clawser/etc/clawser/defaults',
  'clawser/var/log/clawser',
  'clawser/run/clawser',
  'clawser/run/clawser/tabs',
  'clawser/dev/clawser/providers',
  'clawser/dev/clawser/channels',
  'clawser/dev/clawser/hardware',
  'clawser/dev/clawser/mesh/peers',
  'clawser/proc/clawser',
  'clawser/proc/kernel/tenants',
  'clawser/sys/kernel',
  'clawser/sys/services',
  'clawser/tmp/clawser',

  // Per-workspace (created per workspace)
  // 'clawser/workspaces/{id}/.config/clawser/providers',
  // 'clawser/workspaces/{id}/.config/clawser/agents',
  // 'clawser/workspaces/{id}/.local/share/clawser/memory',
  // 'clawser/workspaces/{id}/.local/share/clawser/goals',
  // etc.
];

const WORKSPACE_DIRS = [
  '.config/clawser/providers',
  '.config/clawser/agents',
  '.local/share/clawser/memory',
  '.local/share/clawser/goals',
  '.local/share/clawser/skills',
  '.local/share/clawser/vault',
  '.local/share/clawser/conversations',
  '.local/share/clawser/checkpoints',
  '.local/share/clawser/snapshots',
  '.local/share/clawser/agents',
  '.local/share/clawser/terminal',
];

const ensureDirectoryStructure = async (wsId) => {
  // Global dirs (idempotent — getDirectoryHandle with create:true is safe to re-call)
  for (const dir of DIRECTORY_TREE) {
    await opfsWalkDir(dir, { create: true });
  }
  // Workspace dirs
  for (const dir of WORKSPACE_DIRS) {
    await opfsWalkDir(`clawser/workspaces/${wsId}/${dir}`, { create: true });
  }
};
```

---

## 12. Clean Slate Migration

On first boot after this change ships, the following cleanup runs:

```javascript
const cleanSlate = async () => {
  // Check if migration already happened
  const root = await navigator.storage.getDirectory();
  try {
    await root.getDirectoryHandle('clawser', { create: false });
    return; // already migrated
  } catch { /* proceed with migration */ }

  // 1. Delete all clawser localStorage keys
  const keysToDelete = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('clawser_')) keysToDelete.push(key);
  }
  for (const key of keysToDelete) {
    localStorage.removeItem(key);
  }

  // 2. Delete old OPFS structure
  try {
    await root.removeEntry('clawser_workspaces', { recursive: true });
  } catch { /* doesn't exist */ }
  try {
    await root.removeEntry('clawser_checkpoints', { recursive: true });
  } catch { /* doesn't exist */ }

  // 3. Delete IndexedDB databases
  try {
    indexedDB.deleteDatabase('clawser_checkpoints');
  } catch { /* ok */ }

  // 4. Create new structure
  await ensureDirectoryStructure('default');

  // 5. Write default configs
  await writeDefaultConfigs();

  console.log('[clawser] Clean slate migration complete');
};
```

---

## 13. Testing Strategy

### Unit Tests

Each new module gets its own test file using `MemoryFs` (already exists in `clawser-shell.js`) as the backing filesystem:

- `test/clawser-file-watcher.test.js` — poll timing, debounce, JSON error recovery
- `test/clawser-reactive-config.test.js` — domain registration, validation, apply callbacks
- `test/clawser-device-files.test.js` — provider device write/read, blocking read during stream
- `test/clawser-proc.test.js` — proc generation, directory listing
- `test/clawser-permissions.test.js` — chmod, read-only enforcement
- `test/clawser-env-loader.test.js` — .env parsing, quote handling, comment stripping

### Integration Tests

- Shell integration: `echo '{}' > ~/.config/clawser/autonomy.json && cat ~/.config/clawser/autonomy.json`
- Reactivity loop: write config via shell → verify subsystem received update → verify UI callback fired
- Device file round-trip: `echo "hello" > /dev/clawser/providers/mock && cat /dev/clawser/providers/mock`
- Profile loading order: global profile sets VAR=1, workspace profile sets VAR=2, verify VAR=2 wins

---

## 14. Summary of New Files

| File | Purpose |
|------|---------|
| `web/clawser-fs-layout.js` | Directory constants, path resolver, `resolveVirtualPath()` |
| `web/clawser-fs-bootstrap.js` | First-boot directory creation, default config writing, clean slate migration |
| `web/clawser-file-watcher.js` | `FileWatcher` — OPFS polling, debounce, change detection |
| `web/clawser-reactive-config.js` | `ReactiveConfigBus` — wires file changes to subsystem updates |
| `web/clawser-proc.js` | `ProcFileHandler` — generated read-only files for `/proc/` and `/sys/` |
| `web/clawser-runtime.js` | Runtime state writer for `/run/` files |
| `web/clawser-device-files.js` | `DeviceFileHandler` — provider, channel, hardware, mesh device files |
| `web/clawser-env-loader.js` | `.env` file parser and loader |
| `web/clawser-permissions.js` | `PermissionManager` — virtual chmod support |

## 15. Summary of Modified Files

| File | Key Changes |
|------|-------------|
| `web/clawser-opfs.js` | Add `resolveVirtualPath()`, `CLAWSER_ROOT` |
| `web/clawser-shell.js` | `ShellFs` intercepts `/dev/`, `/proc/`, `/sys/` paths; adds `chmod`, `source` builtins; `WorkspaceFs.resolve()` updated for new path scheme |
| `web/clawser-tools.js` | `WorkspaceFs.resolve()` handles `~` expansion, `/etc/`, `/var/` paths |
| `web/clawser-state.js` | Deprecate `ConfigCache`, `lsKey`; add `fileWatcher`, `configBus` to `state.services` |
| `web/clawser-workspaces.js` | Read/write workspace list from OPFS files instead of localStorage |
| `web/clawser-workspace-lifecycle.js` | New init sequence: directory setup → profile sourcing → watcher start |
| `web/clawser-app.js` | Bootstrap `FileWatcher`, `ReactiveConfigBus`, `ProcFileHandler`, `DeviceFileHandler` |
| `web/clawser-ui-panels.js` | All panels read/write OPFS files instead of localStorage |
| `web/clawser-accounts.js` | Provider config saved to individual files under `~/.config/clawser/providers/` |
| `web/clawser-providers.js` | Expose `complete()` for device file consumption; read config from files |
| `web/clawser-kernel-integration.js` | Expose kernel state getters for proc generators |
| `web/clawser-mount.js` | v86 guest mount adapter support |

---

## 16. Kernel Architecture — wnix Design Layer

> **⚠️ SCOPE NOTE:** Sections 16-34 document the aspirational wnix kernel architecture from the design conversation. These are FUTURE work — the current implementation scope is sections 1-15 only. Sections 16-34 are retained as reference material for later phases.

The sections above (1–15) describe clawser's practical OPFS-backed filesystem. The sections below capture the broader **wnix kernel architecture** — a web-native Unix kernel that positions the browser as a capability-based microkernel and clawser as a Linux-like personality layer running on top. This material was designed in the foundational conversation and represents the long-term architecture vision.

**Core thesis:** The modern browser is not a kernel, but it behaves like a capability-based, distributed microkernel-like environment with hundreds of subsystems. wnix is a Linux-like personality layer over that microkernel. The wnix kernel is a "capability broker + syscall emulation layer" over web APIs.

### 16.1 Architecture Stack

```
[ Linux apps compiled to WASM ]
            |
[ POSIX / syscall shim ]
            |
[ wnix kernel layer ]
   - VFS (OPFS + IndexedDB + FS Access API)
   - process model (Web Workers)
   - networking shim (WebSocket / WebRTC / fetch)
   - memory abstraction (WASM linear memory)
   - device layer (WebUSB / WebBluetooth / WebHID / etc.)
   - capability system (Web Permissions API)
            |
[ Web APIs ]
   - FS API, IndexedDB, fetch/WebSocket, Workers
   - WebUSB, WebBluetooth, WebGPU, WebCodecs
            |
[ Browser runtime (sandbox) ]
```

### 16.2 Syscall Dispatch Pattern

```
syscall(number, args)
   -> dispatch table (JS function router)
   -> subsystems (fs, process, net, memory)
   -> Web APIs
```

The syscall dispatch replaces the Linux model of `userspace -> kernel trap -> hardware` with `WASM -> JS function call -> Web API`. Syscalls are function calls into a capability router, not privileged transitions.

Hooking pattern (overriding Emscripten's built-in syscall layer):

```c
int __syscall_open(...) {
    return wnix_open(...);
}
```

WASM instantiation with wnix syscall table:

```js
const wasm = await WebAssembly.instantiate(grepBinary, {
  env: wnixSyscalls
});
```

### 16.3 Two Design Paths

The conversation identified two fundamental strategies:

**Path A: WASI-style** — Define a clean, smaller syscall API; recompile programs to target it. Practical, fast, manageable. The wnix syscall ABI "should look like WASI, extended with browser-specific features."

**Path B: Linux syscall emulation** — Replicate Linux syscalls exactly (like gVisor). Ambitious, extremely complex, constant maintenance burden.

**Recommendation:** Path A with selective emulation of critical Linux syscalls for compatibility.

---

## 17. Syscall Table (wnix v0.1)

Target: ~25-30 syscalls for a minimal viable kernel. Everything async under the hood but sync-like surface via Asyncify. POSIX-ish, not exact Linux.

### 17.1 File System Syscalls

| Syscall | Signature | wnix Implementation | Web API Backend |
|---------|-----------|---------------------|-----------------|
| `open` | `open(path, flags) -> fd` | VFS lookup, allocate FD | IndexedDB / FS Access API |
| `read` | `read(fd, buf, n) -> bytes` | Read from file buffer | IndexedDB / OPFS / memory |
| `write` | `write(fd, buf, n) -> bytes` | Append/write to file | IndexedDB / FS Access API |
| `close` | `close(fd) -> 0` | Release handle | Internal FD table |
| `lseek` | `lseek(fd, off) -> pos` | Pointer tracking | Internal |
| `stat` | `stat(path) -> statbuf` | Metadata lookup | IndexedDB / OPFS |
| `getdents` | `getdents() -> entries` | List directory entries | FS Access API |

### 17.2 Process / Execution Syscalls

| Syscall | Signature | Behavior |
|---------|-----------|----------|
| `execve` | `execve(path, argv)` | Load WASM module into new Worker |
| `exit` | `exit(code)` | Terminate worker, report exit code |
| `getpid` | `getpid() -> pid` | Return synthetic PID (mapped to Worker ID) |
| `kill` | `kill(pid)` | Send termination message to worker |
| `fork` | `fork()` | **DEFERRED** — not supported initially (see §27) |

### 17.3 Memory Syscalls

| Syscall | Behavior |
|---------|----------|
| `brk()` | Grow WASM linear memory (`WebAssembly.Memory.grow()`) |
| `mmap()` | Fake via WASM linear memory (partial emulation only) |
| `munmap()` | No-op / bookkeeping |

### 17.4 Time Syscalls

| Syscall | Web API Mapping |
|---------|-----------------|
| `gettimeofday()` | `Date.now()` |
| `nanosleep()` | `setTimeout` / `Atomics.wait` |

### 17.5 Networking Syscalls

| Syscall | Mapping | Notes |
|---------|---------|-------|
| `socket()` | Create WebSocket/fetch wrapper | |
| `connect()` | WebSocket connect / fetch | |
| `send()` | WebSocket `.send()` | |
| `recv()` | WebSocket `onmessage` | |
| `bind()` | **NOT POSSIBLE** | No server sockets in browser |
| `listen()` | **NOT POSSIBLE** | No server sockets in browser |

### 17.6 IPC Syscalls

| Syscall | Mapping |
|---------|---------|
| `pipe()` | In-memory queue via Streams API |

### 17.7 Miscellaneous Syscalls

| Syscall | Mapping |
|---------|---------|
| `uname()` | Return synthetic system info |
| `getcwd()` | VFS state |

---

## 18. Boot Sequence

Five stages, modeled after Linux boot but adapted for browser context. Boot is **capability-driven and graph-driven** rather than hardware-driven: "request capabilities → mount virtual subsystems → start service graph" instead of "detect hardware → load drivers → start init."

### Stage 0: Browser / Host Startup

Trigger: page load or app launch. The JavaScript runtime, WebAssembly engine, and Web APIs become available. Equivalent to firmware → bootloader → kernel entry in Linux.

### Stage 1: wnix Kernel Bootstrap

Entry point: `await wnix.boot()`

Initialization order (exact sequence):
1. Initialize memory manager (WASM heap)
2. Initialize syscall dispatcher
3. Initialize VFS layer (`/fs` mounts)
4. Initialize device registry (`/dev`)
5. Initialize IPC system (`/ipc`)
6. Initialize scheduler (worker pool)
7. Mount virtual filesystems:
   - `/fs/mem` → RAM filesystem (WASM memory)
   - `/fs/opfs` → persistent storage (Origin Private File System)
   - `/fs/host` → File System Access API (if user-granted)
   - `/dev` → capability device nodes
   - `/proc` → runtime state simulation
   - `/sys` → capability/config layer
8. Initialize capability system (request/grant/deny for: filesystem, network, usb, bluetooth, gpu)
9. Start scheduler: create worker pool, assign initial kernel tasks, start event loop supervisor

### Stage 2: Init System (PID 1 Equivalent)

Path: `/init` (wnix-init). **Critical design point:** wnix-init is NOT privileged — unlike Linux PID 1, it cannot escape the sandbox, cannot access hardware directly. It only orchestrates capabilities.

Steps:
1. Build service dependency graph
2. Resolve dependencies (topological sort)
3. Start core daemons (each = Web Worker + WASM module):
   - `fs-service` — mounts `/fs` layers
   - `net-service` — WebSocket/WebRTC bridge
   - `device-service` — WebUSB/WebBluetooth manager
   - `ipc-service` — message bus
   - `ui-service` — renders shell/apps
4. Spawn shell environment

```js
async function init() {
  await mountFS();
  await startDeviceManager();
  await startNetworkStack();
  await startIPC();
  await startServiceGraph([
    "fs-service",
    "net-service",
    "device-service",
    "ui-service"
  ]);
  spawnShell();
}
```

### Stage 3: Service Manager (systemd Equivalent)

Service dependency graph example: `ui-service → net-service → fs-service`

Service lifecycle states: `created → starting → running → degraded → stopped`

What CAN be replicated from systemd: dependency graph, restart policies, logging, isolation per worker, capability assignment per service.

What CANNOT be replicated: cgroups, kernel-level process isolation, real preemption.

### Stage 4: User Session Environment

- clsh shell process launched
- Session manager tracks active apps, mounted devices, granted permissions at `/session/current` and `/session/user`
- UI runtime options: DOM, Canvas, or optionally WebGPU renderer
- Two UI modes: CLI mode (terminal-like) and GUI mode (command palette, file explorer, process viewer)

### Boot Sequence for Hardware Rust Kernel Variant

```
[Bootloader] → [Rust kernel entry] → memory init → interrupt table setup
→ scheduler init → device discovery → driver init
→ mount /fs, /dev, /proc, /sys → start init job (PID 1 equivalent)
→ spawn clsh shell
```

---

## 19. Service Definition Format

Each service is described by a JSON descriptor (the wnix equivalent of a systemd unit file):

```json
{
  "name": "net-service",
  "exec": "/usr/bin/netd.wasm",
  "requires": ["fs-service"],
  "capabilities": ["network"],
  "restart": "on-failure"
}
```

Each service runs as: Web Worker + WASM module + connected via message bus.

Core services:

| Service | Function | Dependencies |
|---------|----------|-------------|
| `fs-service` | Mounts `/fs` layers | None |
| `net-service` | WebSocket/WebRTC bridge | `fs-service` |
| `device-service` | WebUSB/WebBluetooth manager | `fs-service` |
| `ipc-service` | Message bus | None |
| `ui-service` | Renders shell/apps | `net-service` |

---

## 20. Process & Job Model

### 20.1 The 3-Tier Process Model

The conversation's **recommended design** is a 3-tier model that replaces Unix fork/exec entirely. This is the primary process model — spawn/exec is the correct, native way to create processes in wnix. fork() exists only as an optional compatibility shim (see §27).

**Tier 1: Process (WASM instance)**
- Isolated execution unit
- No shared memory between processes
- Each process = WASM instance + Web Worker + IPC channel (MessageChannel)

**Tier 2: spawn() (instantiation mechanism)**
- Creates a new process with clean state
- Optionally passes initial state (env vars, FD handles, IPC channels)
- State passing replaces memory cloning: `parent → serialized state → child`

**Tier 3: Channels (IPC)**
- Streams (Web Streams API)
- Message passing (MessageChannel)
- Shared capabilities

This is described as shifting "from process cloning (Unix model) to process instantiation (web/actor model)" — closer to Erlang actors, container spawning, and microservice instantiation than Unix process forking.

```
WASM module + Web Worker + message channel = one process
```

PIDs are synthetic, mapped to Worker IDs. Process table stored at `/proc/processes/`. There is no `fork()`, no signals, no shared kernel scheduler, no copy-on-write memory.

### 20.2 spawn() API

The primary process creation API. Replaces fork/exec as the native wnix mechanism.

```ts
// Simple form
spawn("/bin/grep", args)

// With options (shared channels for IPC)
spawn("/bin/app", { shared_channels })
```

Internal `spawn_worker` variant (used by fork emulation):

```ts
spawn_worker({
  memory: ArrayBuffer,     // cloned WASM linear memory (for fork compat only)
  fds: FDTable,            // file descriptor table
  env: Map<string, string> // environment variables
})
```

The `SpawnTask` type used by the job system:

```ts
SpawnTask {
  template: ExecTask       // which binary + args
  stateSnapshot: SerializedState  // optional parent state to inherit
}
```

### 20.3 How Channels Replace Pipes

In the no-fork model, Unix pipes (file descriptor pairs created by `pipe()`) are replaced by Web Streams API objects. Each `|` in a pipeline becomes a TransformStream connecting two Jobs, not a kernel-level pipe fd.

```
Unix pipes:     pipe() → fd[0] read end, fd[1] write end
wnix channels:  ReadableStream → TransformStream → WritableStream
```

Each job consumes/produces Web Streams API objects, not file descriptors:

```
stdout = WritableStream
stdin  = ReadableStream
pipe   = TransformStream
```

IPC between non-piped processes uses MessageChannel (structured cloning) rather than shared memory or Unix domain sockets.

### 20.4 Job Data Structures (replaces fork-based process table)

```ts
Job {
  id: string
  rootTask: Task
  state: "running" | "paused" | "stopped" | "completed"
  workers: WorkerInstance[]
  stdin: Stream
  stdout: Stream
  stderr: Stream
  capabilities: CapabilitySet
  children: Job[]
}
```

Task types (replacing fork/exec):

```ts
ExecTask {
  binary: "/fs/bin/grep.wasm"
  args: string[]
}

PipeTask {
  from: Job
  to: Job
}

SpawnTask {
  template: ExecTask
  stateSnapshot: SerializedState
}
```

JobGroup (for grouped execution like `(server & logger &)`):

```ts
JobGroup {
  id: string
  jobs: Job[]
  foregroundJob?: Job
}
```

### 20.5 Scheduler

States: `READY → RUNNING → BLOCKED → COMPLETED`

Architecture: event-loop driven (primary) + worker pool (parallelism) + optional priority queue. Uses the Prioritized Task Scheduling API and Compute Pressure API for adaptive scheduling decisions.

```
Job Queue → Worker Pool → WASM execution
```

### 20.6 Job Control Commands

| Command | Behavior |
|---------|----------|
| `jobs` | List all jobs with state |
| `fg N` | Attach streams, resume worker |
| `bg N` | Detach streams, continue execution |
| `kill N` | Terminate worker(s), free resources, close streams |
| `stop N` | Pause Web Worker execution loop, freeze WASM instance |
| `resume N` | Resume paused worker |
| `focus job N` | Redirect input stream to job N |

No signals (no SIGKILL, SIGSTOP, SIGCONT). Only state transitions on Job objects and "hard stop" via worker termination.

### 20.7 TTY Model (Stream Router)

There is no real TTY driver. The terminal is a **stream router** that wires input/output streams between the UI layer and jobs.

```
/dev/input/keyboard0 ──→ browser KeyboardEvent stream
                              │
                    (normalized into character events)
                              │
                              ▼
                     foreground job stdin (ReadableStream)
                              │
                          [WASM execution]
                              │
                              ▼
                     job stdout (WritableStream)
                              │
                              ▼
                        terminal UI renderer
```

`/dev/stdin`, `/dev/stdout`, `/dev/stderr` are Streams API objects connected to the UI layer — they are NOT real files.

**Focus control:** `focus job N` mechanically re-wires which job's stdin is connected to the keyboard input stream. There is no signal-based foreground/background switching (no SIGTSTP, no SIGCONT) — it is purely stream routing. The previous foreground job's stdin is simply disconnected from the keyboard stream; it continues running but receives no input.

**Two UI modes for the shell:**
- CLI mode: terminal-like, WebSocket-style input/output
- GUI mode: command palette, file explorer, process viewer

---

## 21. Shell Language Specification — clsh (clawser shell)

### 21.1 Architecture

```
clsh
 ├── parser
 ├── runtime executor
 ├── syscall bridge
 ├── VFS interface (/fs)
 ├── device interface (/dev)
 ├── process manager (WASM workers)
 ├── IPC layer
 └── REPL UI
```

Design: NOT bash-compatible. POSIX-like syntax, async-first, capability-aware, WASM-native execution model. clsh is not a shell that runs commands — it is a stream-based job orchestration language over a capability-aware virtual OS.

### 21.2 EBNF Grammar

```ebnf
program        := statement* ;

statement      := command
                | pipeline
                | job
                | assignment
                | control ;

command        := IDENT args? redirect? ;
               | IDENT args? capability_block? ;

args           := (STRING | IDENT | NUMBER | path)* ;

path           := "/" IDENT ("/" IDENT)* ;

redirect       := (">" | ">>" | "<") path ;

pipeline       := command ( "|" command )+ ;

job            := pipeline "&" ;

assignment     := IDENT "=" expr ;

expr           := STRING | NUMBER | command | pipeline ;

control        := if_stmt | while_stmt | group ;

group          := "(" program ")" ;

if_stmt        := "if" condition "{" program "}" ;

capability_block := "--cap" IDENT* ;
```

### 21.3 Execution Model

Replaces fork/exec with WASM module instantiation:

```
command → WASM module loader → wnix runtime instance → worker
```

Full execution flow (7 steps):

```
1. Parse AST
2. Resolve FS path (/fs)
3. Check capabilities (/sys)
4. Create Job
5. Spawn Worker (WASM)
6. Attach Streams
7. Execute
```

Expanded:

```
user input → parser → AST → capability check (/sys)
→ resolve binary (/fs) → spawn WASM worker
→ connect streams (stdin/stdout) → execute → render output
```

### 21.4 Type System (Implicit)

| Type | Meaning |
|------|---------|
| String | Text data |
| Path | Virtual FS location |
| Stream | Pipeline data (ReadableStream / WritableStream) |
| Job | Execution unit (Worker + WASM instance) |
| CapabilitySet | Permission set |

### 21.5 Built-in Commands

Core utilities: `ls`, `cd`, `cat`, `echo`, `run`, `ps`, `kill`, `mount`, `umount`, `cap`, `env`, `jobs`, `fg`, `bg`, `stop`, `resume`, `focus`, `top`

Special wnix commands:

```bash
# Execute WASM binary with capability flags
run /fs/bin/app.wasm --cap fs network gpu

# Capability management
cap grant usb
cap revoke network

# VFS mounting at runtime
mount opfs /fs/opfs

# WebSocket connection
ws connect ws://server

# Network fetch
curl https://api.com
```

### 21.6 Error Model

Named errors replacing Unix errno:

| Error | Meaning |
|-------|---------|
| `CapabilityDenied` | Permission not granted for requested capability |
| `FileNotFound` | Path does not exist in VFS |
| `ProcessNotFound` | No worker with given PID |
| `NetworkUnavailable` | Network capability not granted or offline |
| `JobNotFound` | No job with given ID |
| `StreamError` | Stream read/write failure |

### 21.7 Syntax Features clsh Proposes Beyond Current Clawser Shell

- Capability blocks (`--cap fs network`) as first-class syntax
- Group execution syntax `(server & logger &)` creating JobGroups
- Conditional blocks with `if ... { }` instead of `if ... then ... fi`
- While loops
- Implicit type coercion between Strings, Paths, Streams
- Background job syntax with `&`
- Pipe syntax using Streams API internally (not FD-based)
- Variable assignment with `=` (no `export` required for local scope)
- WebSocket commands as builtins (`ws connect ws://server`)
- Possible bytecode compilation for clsh scripts (future extension)

---

## 22. Stream & Pipeline Architecture

### 22.1 Core I/O Model

All I/O in wnix uses the Web Streams API as the core abstraction layer, replacing Unix file descriptors and kernel pipes.

```
stdout = WritableStream
stdin  = ReadableStream
pipe   = TransformStream
```

### 22.2 Pipeline Execution

`cat file.txt | grep foo | wc` becomes:

```
ReadableStream → TransformStream → TransformStream → sink
```

Pipeline `A | B | C`:

```
Job A → Stream → Job B → Stream → Job C
```

Pipes are async stream transformations, NOT OS pipes. Each stage is a Web Worker processing a stream.

### 22.3 Device I/O

```
echo "hello" → write("/dev/stdout") → wnix stream → UI renderer
```

Keyboard input: `/dev/input/keyboard0` mapped to browser `KeyboardEvent` stream, normalized into character events.

All device I/O is stream-based, not file-descriptor-based. `/dev/stdin`, `/dev/stdout`, `/dev/stderr` are Streams API objects connected to the UI layer.

### 22.4 Compound Example

For `ps | grep bash > /fs/mem/output.txt`:
1. `ps` reads `/proc` → scans WASM workers → returns process list as stream
2. `grep` processes stdin stream → TransformStream filters → stdout stream
3. `>` redirection: grep stdout → wnix FS → write to memory FS at `/fs/mem/output.txt`

---

## 23. Capability-Based Security Model

### 23.1 Design Principle

Instead of Linux's root/UID privilege model, wnix uses explicit capability sets attached to each job/process. The kernel is a "capability router." Permissions are first-class kernel objects.

Instead of `chmod +x file`, you have `requestPermission("usb")`.

### 23.2 Capability Set

```ts
capabilities: {
  fs: true,
  network: false,
  usb: false,
  bluetooth: false,
  gpu: false
}
```

Available capabilities: `filesystem`, `network`, `usb`, `bluetooth`, `gpu`, `process`, `ipc`

### 23.3 Capability Lifecycle

1. **Requested** — process declares needed capabilities
2. **Granted or Denied** — mediated by Web Permissions API (user prompted)
3. **Attached to process namespace** — capability set bound to Job
4. **Revocable** — can be revoked at runtime via `cap revoke`

### 23.4 Permission-to-Web-API Mapping

| Capability | Web API | Device Path |
|------------|---------|-------------|
| `usb` | WebUSB | `/dev/usb/*` |
| `bluetooth` | Web Bluetooth | `/dev/bluetooth/*` |
| `filesystem` | File System Access API | `/fs/host/*` |
| `gpu` | WebGPU | `/dev/gpu0` |
| `serial` | Web Serial API | `/dev/serial/tty0` |
| `audio` | Web Audio / getUserMedia | `/dev/audio/*` |
| `video` | getUserMedia / WebCodecs | `/dev/video/*` |

### 23.5 Linux vs wnix Security Comparison

| Linux Concept | wnix Equivalent |
|---------------|-----------------|
| root privileges | None — no privilege escalation possible |
| UID/GID permissions | Capability tokens per process |
| `chmod` / `chown` | `cap grant` / `cap revoke` |
| Syscall checks | API permission gating |
| Kernel mode | Not available — everything runs in browser sandbox |

---

## 24. Expanded Virtual Filesystem Hierarchy

This extends section 2 with the full wnix kernel filesystem namespace, beyond the clawser-specific paths.

### 24.1 Complete Root VFS

```
/
├── /dev        ── capability devices (§24.2)
├── /proc       ── runtime state (§24.3)
├── /sys        ── system configuration + capabilities (§24.4)
├── /run        ── ephemeral runtime state (§24.5)
├── /net        ── networking abstraction layer (§24.6)
├── /fs         ── unified storage mounts (§24.7)
├── /ipc        ── interprocess communication (§24.8)
├── /kernel     ── core control plane (§24.9)
├── /trace      ── performance tracing
├── /log        ── system logs
└── /debug      ── debug interface
```

### 24.2 /dev — Device Subsystem

Devices are NOT hardware drivers — they are "user-approved, capability-backed stream endpoints." Key design rules: lazily instantiated (appear only after user grants access), permission-gated (explicit user selection required), session-scoped (no persistent privileged control), no global enumeration, no automatic device discovery, no kernel-level interrupts.

```
/dev
├── /input
│   ├── keyboard0       ── KeyboardEvent stream
│   ├── mouse0          ── PointerEvent stream
│   └── gamepad0        ── Gamepad API
├── /usb
│   ├── usb0            ── WebUSB (enumerate, control/bulk transfers)
│   └── usb1
├── /bluetooth
│   └── bt0             ── Web Bluetooth (BLE, GATT services, no classic BT)
├── /hid
│   └── hid0            ── WebHID (read/write HID reports)
├── /serial
│   └── tty0            ── Web Serial API (baud rate configurable)
├── /gpu
│   └── gpu0            ── WebGPU (general-purpose GPU compute)
├── /audio
│   ├── mic0            ── getUserMedia (audio)
│   └── speaker0        ── Web Audio API
├── /video
│   └── cam0            ── getUserMedia (video) / WebCodecs
├── /crypto
│   └── rng             ── Web Crypto API (getRandomValues)
├── /net
│   ├── ws0             ── WebSocket
│   └── webrtc0         ── WebRTC data channel
├── /stdin              ── Streams API (ReadableStream from UI)
├── /stdout             ── Streams API (WritableStream to UI)
├── /stderr             ── Streams API (WritableStream to error console)
└── /null               ── Discard all writes, read returns empty
```

### 24.3 /proc — Process & Runtime State

```
/proc
├── /self               ── Current worker metadata
│   ├── status          ── name, state, memory (WASM heap), capabilities
│   ├── maps            ── WASM memory layout
│   └── fd/             ── Virtual file descriptor table
├── /processes
│   ├── /1              ── shell (PID 1)
│   │   ├── status
│   │   └── fd/
│   ├── /2              ── service
│   └── ...
├── /syscall
│   ├── table           ── Syscall dispatch table
│   └── stats           ── Syscall invocation counters
├── /meminfo            ── WASM memory stats
├── /cpuinfo            ── navigator.hardwareConcurrency
├── /uptime             ── performance.now() (seconds since boot)
├── /scheduler
│   ├── runqueue        ── Current job queue
│   └── loadavg         ── Worker pool utilization
└── /fs
    └── mounts          ── Mount table
```

`/proc/self/status` output format:

```
name: bash
state: running
memory: 12MB (WASM heap)
capabilities: fs, ipc
```

### 24.4 /sys — Capability & Policy Layer

```
/sys
├── /capabilities
│   ├── usb             ── WebUSB permission state
│   ├── bluetooth       ── Web Bluetooth permission state
│   └── filesystem      ── File System Access permission state
├── /security
│   ├── permissions     ── Granted permissions list
│   └── sandbox         ── Sandbox policy
├── /runtime
│   ├── scheduler_mode  ── cooperative / priority
│   └── threading_model ── worker / shared
├── /network
│   ├── proxy           ── Proxy configuration
│   └── endpoints       ── Active network endpoints
├── /storage
│   ├── quotas          ── Storage quota info
│   └── mounts          ── Storage mount config
└── /features
    ├── webgpu_enabled  ── Feature detection
    └── webrtc_enabled  ── Feature detection
```

### 24.5 /run — Ephemeral Runtime

```
/run
├── /sessions           ── Active user sessions
├── /tmp                ── Temporary files
├── /locks              ── Web Locks API (cross-worker locking, flock() equivalent)
├── /services           ── Service Worker registrations
└── /workers            ── Web Worker pool state
```

### 24.6 /net — Networking Abstraction

```
/net
├── /tcp                ── Emulated (via WebSocket/WebTransport)
├── /udp                ── Emulated (via WebRTC data channels)
├── /ws                 ── WebSocket connections
├── /webrtc             ── WebRTC peer connections
├── /fetch              ── HTTP client (fetch API)
└── /dns                ── DNS over HTTPS (DoH remote resolver)
```

### 24.7 /fs — Storage VFS Multiplexer

```
/fs
├── /mem                ── RAM filesystem (WASM memory, volatile)
├── /opfs               ── Origin Private File System (persistent, sync in Workers)
├── /indexeddb          ── IndexedDB (persistent, structured)
├── /host               ── File System Access API (user-selected, permission-gated)
└── /remote             ── HTTP / cloud FS
```

### 24.8 /ipc — Interprocess Communication

```
/ipc
├── /pipes              ── Streams API (ReadableStream/WritableStream/TransformStream)
├── /queues             ── MessageChannel (structured IPC)
├── /channels           ── Channel Messaging API
└── /broadcast          ── BroadcastChannel (pub/sub across contexts)
```

Shared memory: SharedArrayBuffer (requires cross-origin isolation headers).

### 24.9 /kernel — Core Control Plane

```
/kernel
├── /syscalls           ── Dispatch table
├── /scheduler          ── Worker scheduling, cooperative multitasking
├── /memory             ── WASM memory manager
├── /loader             ── WASM binary module loader
└── /modules            ── Loaded kernel modules
```

---

## 25. Web API → Kernel Subsystem Mapping

Exhaustive mapping of browser APIs to wnix kernel subsystems.

### 25.1 Execution Layer

| Web API | Kernel Role | Notes |
|---------|-------------|-------|
| WebAssembly | CPU / execution engine | Near-native WASM execution, sandboxed linear memory |
| Web Workers | Process isolation | Each process = WASM instance + Worker + IPC channel |
| SharedArrayBuffer | Shared memory / threading | Requires cross-origin isolation headers |
| Service Workers | Init daemon + packet filter | Background execution, request interception, caching |

### 25.2 Filesystem Layer

| Web API | Mount Point | Role |
|---------|-------------|------|
| Origin Private File System (OPFS) | `/fs/opfs` | Fast persistent FS, sync access in Workers via `FileSystemSyncAccessHandle` |
| File System Access API | `/fs/host` | User-selected host files (permission-gated) |
| IndexedDB | `/fs/indexeddb` | Persistent structured key-value + blob storage |
| localStorage | — | Small synchronous storage (limited use) |
| Cache API | — | HTTP-like key/value store; package cache, binary cache, read-only FS layers |
| Storage Foundation API | — | (Experimental) Low-level block storage; "raw disk access" |
| Compression Streams API | — | gzip/deflate streams; compressed FS layers, implement `tar`/`gzip` |

### 25.3 Networking Layer

| Web API | Mount Point | Kernel Analogy |
|---------|-------------|----------------|
| fetch() | `/net/fetch` | HTTP client (async, streaming) |
| WebSocket | `/net/ws`, `/dev/net/ws0` | Full-duplex bidirectional communication |
| WebRTC | `/net/webrtc`, `/dev/net/webrtc0` | Peer-to-peer, UDP-like data channels — "closest thing to raw sockets" |
| WebTransport | — | (Emerging) QUIC-based transport, bidirectional streams |
| Server-Sent Events | — | Streaming server-to-client |

### 25.4 Device / Hardware APIs

| Web API | Device Path | Capabilities |
|---------|-------------|-------------|
| WebUSB | `/dev/usb/*` | Enumerate (after user selection), control/bulk transfers |
| Web Bluetooth | `/dev/bluetooth/*` | BLE devices, GATT services. No classic Bluetooth, no raw HCI |
| WebHID | `/dev/hid/*` | Read/write HID reports, custom device protocols |
| Web Serial API | `/dev/serial/tty0` | Serial streams, configurable baud rate |
| WebGPU | `/dev/gpu0` | General-purpose GPU compute, parallel processing |
| WebNN | — | (Emerging) ML acceleration |
| WebCodecs | `/dev/video0`, `/dev/audio` | Raw video frames, audio chunks, HW-accelerated encode/decode |
| Web Audio API | `/dev/audio/mic0`, `/dev/audio/speaker0` | Audio processing and I/O |
| getUserMedia | `/dev/video/cam0` | Camera/microphone access |
| Web Crypto API | `/dev/crypto/rng` | Secure random numbers, hashing, encryption |

### 25.5 Scheduling & Concurrency

| Web API | Kernel Analogy |
|---------|----------------|
| Prioritized Task Scheduling API | Task priority control in event loop |
| Web Locks API | Mutexes / semaphores (`flock()` equivalent); maps to `/run/locks` |
| Compute Pressure API | CPU load detection; adaptive scheduling — "extremely kernel-like"; maps to `/proc/scheduler/loadavg` |
| `performance.now()` | `/proc/uptime` |
| `navigator.hardwareConcurrency` | `/proc/cpuinfo` |
| `setTimeout` / `setInterval` | `nanosleep()` equivalent |
| `requestAnimationFrame` | Frame-synced scheduling |

### 25.6 IPC & Messaging

| Web API | IPC Mount | Role |
|---------|-----------|------|
| Streams API | `/ipc/pipes` | Core I/O abstraction; Unix pipes replacement |
| MessageChannel | `/ipc/queues` | Structured IPC between Workers |
| BroadcastChannel | `/ipc/broadcast` | Pub/sub across contexts |
| SharedArrayBuffer | — | Shared memory between Workers |

### 25.7 System Integration

| Web API | wnix Mapping |
|---------|-------------|
| Permissions API | `/sys/capabilities` — "first-class kernel objects" |
| Notifications API | System-level notifications |
| Badging API | App state indicators |
| Battery Status API | Power-aware scheduling |
| Idle Detection API | User activity state |
| Network Information API | Bandwidth/latency detection |
| Geolocation API | Sensor data |
| Device Orientation API | Sensor data |
| Ambient Light API | Sensor data |
| Content Index API | Package manager integration, offline app discovery |
| Background Sync / Periodic Sync | `cron` + systemd timers equivalent |
| Performance API | `/proc/uptime`, performance counters |

### 25.8 Key Bridging Technology

**Asyncify** (Emscripten feature, documented at `web.dev/articles/asyncify`) — transforms async web API calls into synchronous-looking calls for WASM code. This is the critical bridge that allows POSIX-style blocking syscalls to work on top of the async browser runtime.

---

## 26. WASM Compilation & Execution Pipeline

### 26.1 Compilation

Primary toolchain: Emscripten.

```bash
emcc grep.c -o grep.js
```

Produces: `grep.wasm` + JS glue code. Override Emscripten's built-in syscall layer with wnix syscall dispatcher.

Alternative: `clang` targeting WASI.

### 26.2 Execution Steps

```js
// Step 1: Seed filesystem with test data
wnix.fs.writeFile("/file.txt", "foo\nbar\nfoo\n");

// Step 2: Load and instantiate WASM module
const wasm = await WebAssembly.instantiate(grepBinary, {
  env: wnixSyscalls
});

// Step 3: Execute
wnix.exec("/bin/grep", ["grep", "foo", "file.txt"]);
```

### 26.3 WASM Module Loading Steps

1. Resolve path in VFS (FileSystemAccess API or OPFS lookup → returns WASM binary blob)
2. Validate binary
3. Allocate memory (WASM linear memory)
4. Attach syscall table
5. Check permissions from `/sys/capabilities`

### 26.4 Compatibility

Programs that work: `grep`, `cat`, `ls`, `awk`, small C programs, interpreters (Lua, Python subset), sqlite.

Programs that break: anything using `fork()` heavily, signals (`SIGINT`, `SIGKILL`), `/proc` introspection, blocking I/O assumptions, kernel modules.

Running bash requires: fake process model, job control (very hard), signal emulation — described as "a major project (months/years)." Two strategies: patched bash (`fork → spawn`) or reimplemented shell (`clsh`).

---

## 27. Process Creation: spawn/exec (Primary) and fork (Compatibility)

**The correct wnix process model is spawn/exec, not fork.** spawn/exec is the native, recommended, performant way to create processes. fork() exists only as an optional compatibility shim for legacy Linux programs that require it.

### 27.1 Primary Model: spawn() + exec()

This is the default, correct way to create processes in wnix:

```ts
// spawn(): create a new process with clean state
spawn("/bin/grep", ["grep", "foo", "file.txt"])

// spawn() with shared channels for IPC
spawn("/bin/app", { shared_channels: [channel1, channel2] })

// exec(): replace the current process entirely (new WASM module in same Worker)
exec("/bin/bash")
```

`spawn()` creates a fresh WASM instance in a new Web Worker. It optionally accepts initial state to pass from parent to child:

```
parent → serialized state → child
```

Passed state includes: environment variables, file descriptor handles, IPC channels. This is state *passing*, not memory *cloning* — fundamentally different from fork.

This is the model WASI leans toward. It is closer to actor-model runtimes (Erlang), container spawning (Docker), and microservice instantiation than Unix process forking.

### 27.2 Compatibility Layer: fork() (Optional Shim)

For legacy Linux programs compiled to WASM that call `fork()`, wnix provides a compatibility shim. **fork() is NOT the preferred API** — it is expensive, imprecise, and exists only for backward compatibility.

Internally, fork() is implemented as spawn + snapshot:

```c
pid_t wnix_fork() {
    state = snapshot(current_process)
    child = spawn_worker({
        memory: clone(state.memory),    // structured copy, NOT shared
        fds: clone(state.fds),
        env: state.env
    })
    return child.pid  // parent gets child PID; child gets 0
}
```

Steps:
1. Snapshot WASM linear memory
2. Snapshot register state
3. Copy file descriptor table
4. Create new Web Worker
5. `structuredClone` parent memory buffer into child (NOT shared memory — no copy-on-write)
6. Emulate return values: parent gets child PID, child gets 0

**Why fork() is second-class:**
- No true copy-on-write — full memory duplication on every fork (expensive)
- No shared address space — WASM instances have isolated linear memory
- Race conditions behave differently than real fork
- `fork()` is the single biggest blocker to full Linux compatibility

### 27.3 Decision Framework

| Scenario | Use |
|----------|-----|
| New wnix-native programs | `spawn()` + channels |
| Ported Linux programs that don't fork | `exec()` |
| Legacy programs that require fork (bash, Apache) | fork() shim |
| Shell pipelines | `spawn()` + TransformStream connections |

The long-term goal is that programs targeting wnix natively never need fork(). The fork shim is a bridge for running unmodified Linux binaries during the transition period.

---

## 28. Hardware Kernel Variant (Rust)

The conversation explored building the wnix architecture as a real hardware kernel in Rust. This would be a **capability-based Rust microkernel with a job-graph execution model inspired by web runtimes**.

### 28.1 Rust Data Structures

```rust
struct Job {
    id: u64,
    tasks: Vec<Task>,
    state: JobState,
    capabilities: CapabilitySet,
}

enum Task {
    Exec(Binary),
    Pipe(Box<Task>, Box<Task>),
    Spawn(Binary),
}

struct Capability {
    filesystem: bool,
    network: bool,
    usb: bool,
}
```

### 28.2 Kernel Module Structure

- `vfs.rs` — trait-based filesystem abstraction
- Process struct — process table
- Task struct — scheduler units
- Scheduler module
- Security policy engine
- Kernel config interface

### 28.3 IPC in Rust Kernel

- Lock-free queues (`crossbeam` crate)
- Channel-based IPC (`tokio`-like patterns)
- Zero-copy buffers

### 28.4 Build Requirements

Uses `no_std` Rust for direct hardware access. No runtime required. Safe memory management without GC.

### 28.5 Prior Art for Rust Kernel

- **seL4** — capability-based microkernel security model; closest match to wnix capability system
- **Redox OS** — Rust-based OS; proves Rust is viable for OS kernel development
- **Singularity** — Microsoft Research OS; managed-code kernel, actor-model runtimes

---

## 29. Prior Art & References

| System | Why Referenced | Relevance |
|--------|---------------|-----------|
| **gVisor** | Implements large subset of Linux syscalls in userspace | "Proves this approach works at scale"; closest real-world analogy to wnix |
| **Wine** | Reimplements Windows APIs so apps run on Linux | Analogy: wnix reimplements Linux APIs on the web |
| **WSL** | Translates Linux syscalls on Windows kernel | Direct architectural analogy |
| **WASI** | Clean, standardized syscall-like interface for WASM | wnix ABI "should look like WASI" |
| **User-Mode Linux** | Runs real Linux kernel as userspace process | Validates "kernel in userspace" concept |
| **seL4** | Microkernel with capability-based security | Security model inspiration for Rust kernel variant |
| **Redox OS** | Rust-based operating system | Proves Rust kernel is feasible |
| **Singularity** | Microsoft Research OS | Managed-code kernel, actor-model runtime ideas |
| **v86** | Browser-based x86 emulator | Existing browser-based Linux environment |
| **WebVM** | Browser-based Linux VM | Existing browser-based Linux environment |
| **Lifo** | "Browser-Native OS for AI Sandboxing" (lifo.sh) | Direct prior art / competitor |
| **WebR** | R in the browser | VFS mounting patterns for WASM (docs.r-wasm.org) |
| **Emscripten** | C/C++ to WASM compiler | Primary compilation toolchain; provides fake FS/syscalls in JS |

### Referenced Papers & Articles

- **"Not So Fast: Analyzing the Performance of WebAssembly vs. Native Code"** (arXiv:1901.09056) — cited for: standard Unix APIs are not available in browsers, requiring emulation layers
- **web.dev Asyncify article** (`web.dev/articles/asyncify`) — key technique for async-to-sync bridging in WASM
- **Mozilla Hacks** ("Making WebAssembly a first-class language on the web", 2026-02) — WASM-to-JS bridge limitations

---

## 30. Known Limitations

Things that **cannot** be fully replicated in the browser:

| Feature | Why Impossible |
|---------|---------------|
| `fork()` semantics | No copy-on-write, no shared address space in WASM |
| Signals (SIGINT, SIGKILL, etc.) | No OS-level signal delivery to Workers |
| Kernel privilege mode | Everything runs in browser sandbox |
| Raw hardware drivers | Only high-level Web APIs (WebUSB, etc.) |
| Raw sockets / listening sockets | No `bind()` or `listen()` in browsers |
| Synchronous blocking I/O | Web is async-only (bridged via Asyncify) |
| cgroups | No resource group isolation |
| Kernel-level process isolation | Workers are isolated but not at kernel level |
| Real preemptive scheduling | Web uses cooperative scheduling (event loop) |
| Auto-scanning devices | User must explicitly select each device |
| Silent device access | Browser always prompts for permission |
| Kernel-level interrupts | No interrupt handling in browser |
| Virtual memory / page tables | WASM has flat linear memory only |
| Persistent background daemons with device access | Service Workers are limited in scope |

### The Fundamental Tension

> "The limiting factor is not lack of APIs. It's that the web is asynchronous, capability-based, and sandboxed by design — while Linux is synchronous, privileged, and hardware-controlled."

The wnix project resolves this tension by building a "next-gen kernel model" that embraces these constraints as features: async-first syscalls, capability-based security that surpasses Linux's permission model, and WASM processes that are inherently sandboxed.

---

## 31. Version Roadmap

From the conversation's upgrade path:

- **v0.1** — 25-30 syscalls, VFS, basic process model, no fork
- **v0.2** — Async syscall support, improved FS performance
- **v0.3** — Web Worker "processes", message-based IPC
- **v0.4** — Partial fork() emulation (snapshot + clone)

---

## 32. Session Tracking

The user session manager tracks state under `/session/`:

- `/session/current` — active session metadata
- `/session/user` — user profile / identity

Tracked state: active apps, mounted devices, permissions granted. The session manager is launched as part of Stage 4 boot.

---

## 33. Unpursued Design Directions

The conversation surfaced several ideas that were noted but not fully designed. These represent potential future work:

- **Bytecode format for clsh scripts** — compiled shell scripts for faster execution, rather than interpreting AST each time
- **ELF-to-WASM compatibility layer** — translating or shimming ELF binaries so the system can handle both binary formats
- **Service Workers as init system** — using the Service Worker lifecycle (install → activate → fetch) as the wnix init daemon, with Background Sync / Periodic Sync as cron equivalents
- **Running sqlite in wnix** — cited as a benchmark for "real program" support
- **Coreutils port strategy** — systematic plan for rewriting `ls`, `ps`, `grep`, etc. for the wnix model
- **Rust module layout** — full `src/` directory structure for the hardware kernel variant
- **Job graph scheduler in Rust** — step-by-step implementation of the READY → RUNNING → BLOCKED → COMPLETED state machine
- **Real parser implementation** — tree-walking interpreter for clsh (TypeScript or Rust)
- **Minimal bootable kernel design** — boot → scheduler → shell as a working prototype
- **Live boot graph visualization** — real-time DAG visualization of service dependencies during boot; noted as "something even Linux doesn't expose cleanly"
- **USB device access from compiled C in browser** — end-to-end example of a WASM program reading from `/dev/usb/usb0`

---

## 34. Specific Numbers from the Design

| Metric | Value | Source |
|--------|-------|--------|
| Target syscall count (v0.1) | ~25-30 | Conversation recommendation |
| Linux syscall count (comparison) | 300+ | Referenced as the full surface area to avoid |
| Example WASM heap size | 12MB | `/proc/self/status` example output |
| Boot stages | 5 (0-4) | Stage 0: browser, Stage 1: kernel, Stage 2: init, Stage 3: services, Stage 4: user session |
| Service lifecycle states | 5 | created → starting → running → degraded → stopped |
| Scheduler states | 4 | READY → RUNNING → BLOCKED → COMPLETED |
| Core services | 5 | fs-service, net-service, device-service, ipc-service, ui-service |
| Top-level VFS mount points | 10+ | /dev, /proc, /sys, /run, /net, /fs, /ipc, /kernel, /trace, /log, /debug |

No specific worker limits, memory ceilings, or performance benchmarks were discussed in the conversation. These are implementation-time decisions.
