# Clawser Advanced Features

Guide to Clawser's advanced subsystems beyond the core agent loop.

---

## Routines

**File**: `web/clawser-routines.js`

Event-driven automation engine for scheduling recurring or reactive agent tasks.

### Trigger Types

| Type | Description |
|------|-------------|
| `cron` | 5-field cron expression (`* * * * *`) — supports `*`, ranges, steps, comma-separated |
| `event` | Fires on a named event type |
| `webhook` | Fires on incoming webhook at a path |

### Guardrails

Each routine enforces configurable guardrails:

| Guardrail | Default | Description |
|-----------|---------|-------------|
| maxRunsPerHour | 3 | Rolling hourly rate limit |
| maxCostPerRun | $0.50 | Maximum cost per execution |
| timeoutMs | 5 min | Execution timeout |
| requireApproval | false | Require user confirmation before each run |
| notifyOnFailure | true | Alert on execution failure |
| retryOnFailure | 1 | Automatic retry count |

Routines are auto-disabled after 5 consecutive failures. Run history (last 50) is stored per routine.

**Tools**: `routine_create`, `routine_list`, `routine_delete`, `routine_run`

---

## Delegation

**File**: `web/clawser-delegate.js`

Spawn isolated sub-agents for focused sub-tasks. Each sub-agent has its own conversation history but shares the parent's provider and tools.

| Constant | Value | Description |
|----------|-------|-------------|
| MAX_DELEGATION_DEPTH | 2 | Max nesting depth |
| DEFAULT_MAX_ITERATIONS | 10 | Default tool iterations per sub-agent |
| DEFAULT_MAX_CONCURRENCY | 3 | Max concurrent sub-agents |

By default, sub-agents only have access to `read` and `internal` permission tools (safe default). Use the `tools` parameter to explicitly grant additional tools.

`DelegateManager` supports running multiple sub-agents concurrently via `delegateAll()`.

**Tool**: `agent_delegate`

---

## Channels

**File**: `web/clawser-channels.js`

Bridges external messaging services to the agent via a WebSocket bridge server.

### Supported Channels

webhook, telegram, discord, slack, matrix, email, irc

### Access Control

Each channel has configurable allowlists:
- `allowedUsers` — Array of user IDs/usernames
- `allowedChannels` — Array of channel IDs

### Message Flow

1. External message arrives via WebSocket
2. Normalized to standard format: `{ id, channel, channelId, sender, content, attachments, replyTo, timestamp }`
3. Checked against allowlists via `isMessageAllowed()`
4. Formatted for agent context via `formatForAgent()`
5. Outbound messages formatted per-channel: Telegram HTML, Slack mrkdwn, Discord markdown

**Tools**: `channel_list`, `channel_send`, `channel_history`

---

## Intent Classification

**File**: `web/clawser-intent.js`

Classifies user messages to select the appropriate execution pipeline.

### Intent Types

| Intent | LLM | Tools | Memory | Model | Max Tokens |
|--------|-----|-------|--------|-------|------------|
| command | no | no | no | — | — |
| query | yes | no | yes | fast | 1024 |
| task | yes | yes | yes | smart | 4096 |
| chat | yes | no | no | fast | 256 |
| system | yes | yes | yes | fast | 2048 |

### Classification Rules

1. `/` prefix → `command`
2. Keywords `undo|redo|clear|reset|set ` → `command`
3. Scheduler/webhook/routine source → `system`
4. Short casual greetings (< 30 chars) → `chat`
5. Question words at start → `query`
6. Ends with `?` and < 150 chars → `query`
7. All else → `task`

Custom prefix overrides can be added (e.g. `!task:` → force TASK intent).

**Tools**: `intent_classify`, `intent_add_override`

---

## Heartbeat

**File**: `web/clawser-heartbeat.js`

Periodic health checks from a markdown-format checklist. Silent on pass; alerts only on failure.

### Default Checks

- Every 5 min: context < 80% capacity, no stuck scheduler jobs
- Every 30 min: cost under daily cap, storage under 90%
- On wake: provider reachable

Checks can be loaded from a custom `HEARTBEAT.md` with sections `## Every N minutes/hours` and `## On wake`.

**Tools**: `heartbeat_status`, `heartbeat_run`

---

## Secret Vault

**File**: `web/clawser-vault.js`

Encrypted secret storage using the Web Crypto API.

### Cryptographic Parameters

| Parameter | Value |
|-----------|-------|
| Key derivation | PBKDF2, 600,000 iterations, SHA-256 |
| Encryption | AES-GCM, 256-bit key, 96-bit IV |
| Salt | 16 bytes, random, per-vault |

### Usage

1. `vault.unlock(passphrase)` — derives key from passphrase
2. `vault.store(name, secret)` — encrypts and writes to OPFS
3. `vault.retrieve(name)` — decrypts and returns secret
4. `vault.lock()` — zeros the key from memory

Storage is in OPFS at `/clawser_vault/{name}.enc`. The passphrase is never stored — a canary value is used for verification.

---

## Response Cache

Referenced in `clawser-state.js` as `state.responseCache`.

LRU cache for LLM responses to avoid redundant API calls.

| Setting | Default | Description |
|---------|---------|-------------|
| TTL | 30 min | Time-to-live per entry |
| Max Entries | 500 | Maximum cached responses |

Statistics (hits, misses, entry count) are visible in the Config panel.

---

## Safety Pipeline

**File**: `web/clawser-safety.js`

Multi-stage defense-in-depth pipeline on every message and tool call.

### Stage 1: Input Sanitizer

Strips invisible Unicode characters. Detects prompt injection patterns: "ignore previous instructions", "you are now", `<|system|>`, etc. Flags but does not block.

### Stage 2: Tool Call Validator

Per-tool validation before execution:
- **File tools**: Path traversal (`..`) → critical; vault path access → critical
- **Shell tool**: Chained `rm`, command substitution, curl piped to shell → high severity
- **Fetch tool**: `file://` or `data:` URLs → high; localhost/private network → medium

Critical severity blocks execution; others warn.

### Stage 3: Leak Detector

Scans content for credential patterns:
- **Redact**: OpenAI keys, Anthropic keys, GitHub tokens, AWS keys, connection strings, Bearer tokens
- **Warn**: JWTs
- **Block**: RSA/EC private keys

The pipeline can be toggled on/off via `pipeline.enabled`.

---

## Command Palette

**File**: `web/clawser-cmd-palette.js`

Floating overlay for executing any registered tool outside the chat flow.

**Shortcut**: Cmd/Ctrl+K

Features:
- Searchable tool list (browser tools + MCP tools)
- Typed parameter form inputs from JSON Schema
- Required field validation
- Results rendered inline in chat
- Permission level badges per tool

---

## Item Bar

**File**: `web/clawser-item-bar.js`

Reusable UI component for managing named lists (conversations, terminal sessions).

Features:
- History dropdown with search/filter
- Inline rename, delete, fork, export
- Sorted by last-used time
- Configurable export formats (script, markdown, JSON)

---

## Tool Management

**File**: `web/clawser-ui-panels.js`

### Tool Registry Panel

Lists all registered tools with clickable permission badges. Click to cycle: auto → approve → denied → auto. Permissions persist per-workspace.

### MCP Server List

Lists connected MCP servers with tool counts and connection status.

### Skills Panel

Lists installed skills with scope badges (global/workspace). Per-skill controls: toggle enable/disable, export as ZIP, delete. Shows token estimate warnings for large skills. Includes skill search from remote registry.

---

## Agent Picker

**Files**: `web/clawser-ui-panels.js`, `web/clawser-agent-storage.js`

Multiple named agent definitions with custom system prompts, provider overrides, and tool restrictions. 5 built-in starter agents.

- Agents stored in OPFS: global `clawser_agents/` and per-workspace `.agents/`
- `switch_agent` tool loads and applies an agent spec live
- `consult_agent` tool runs a question through a named agent in isolation

---

## Lazy Panel Rendering

**File**: `web/clawser-workspace-lifecycle.js`

Defers DOM population of non-essential panels until the user first navigates to them.

### Deferred Panels (7)

tools, files, goals, skills, toolMgmt, agents, dashboard

### Eagerly Rendered

All config sections — because they apply runtime settings (autonomy level, cache TTL, etc.) on workspace load.

Panels are tracked via `isPanelRendered()`. State resets on workspace switch via `resetRenderedPanels()`.

---

## Daemon Mode

**File**: `web/clawser-daemon.js`

Background execution lifecycle, periodic checkpointing, and multi-tab awareness.

### State Machine

`stopped` → `starting` → `running` ↔ `checkpointing` / `paused` → `stopped`

### Tab Coordination

Uses `BroadcastChannel` (`clawser-tabs`) for multi-tab awareness:
- Each tab broadcasts a heartbeat every 5 seconds
- Stale tabs (3x interval without heartbeat) are pruned
- First-joined tab is elected leader (`isLeader`)

### Checkpoint Manager

- Auto-checkpoints every 60 seconds while running
- Stored as binary blobs in OPFS `/.checkpoints/latest.bin`
- Keeps at most 10 checkpoints in the index
- Shutdown creates a final checkpoint

**Tools**: `daemon_status`, `daemon_checkpoint`

---

## Bridge Interface

**File**: `web/clawser-bridge.js`

Connects Clawser to external tool servers. Two bridge types with auto-detection (extension preferred over local server).

### Local Server Bridge

Connects to `http://localhost:9377` (configurable). Endpoints:
- `GET /health` — availability check
- `GET /mcp/tools` — list tools
- `POST /mcp/call` — call a tool
- `POST /proxy` — proxy fetch (CORS bypass)

Supports optional API key authentication via Bearer token.

### Extension Bridge

Communicates via browser extension `postMessage` RPC. Detected via `globalThis.__clawser_ext__` marker. 10-second RPC timeout.

**Tools**: `bridge_status`, `bridge_list_tools`, `bridge_fetch`

---

## Self-Repair

**File**: `web/clawser-self-repair.js`

Watchdog that monitors agent state for stuck conditions and applies automatic recovery.

### Detected Issues

| Issue | Default Threshold | Recovery Chain |
|-------|-------------------|----------------|
| tool_timeout | 60s | cancel → retry (1x) → skip |
| no_progress | 120s | nudge → compact → abort |
| loop_detected | 3 consecutive | break_loop → abort |
| context_pressure | 95% usage | compact → checkpoint_and_restart |
| consecutive_errors | 5 errors | diagnose → fallback_provider |
| cost_runaway | $2.00/turn | pause → downgrade_model |

Recovery strategies are applied in order; the first successful strategy stops the chain.

**Tools**: `self_repair_status`, `self_repair_configure`

---

## Undo System

**File**: `web/clawser-undo.js`

Multi-layer undo that reverts conversation history, memory operations, file operations, and goal operations simultaneously.

Per-turn checkpoints track:
- Conversation history length (for message trimming)
- Memory ops (store/forget — reversed on undo)
- File ops (write/delete — content restored on undo)
- Goal ops (status changes, additions — reversed on undo)

Default max history: 20 turns. Supports multi-turn undo and preview.

**Tools**: `undo`, `undo_status`

---

## Tool Builder

**File**: `web/clawser-tool-builder.js`

Create, test, edit, and remove custom tools at runtime.

### Code Validation

Forbidden patterns (rejected before execution): `fetch`, `XMLHttpRequest`, `WebSocket`, `document`, `window`, `eval`, `Function(`, `setTimeout`, `import(`, `localStorage`, `navigator`, `location`.

### Versioning

Each edit increments the version number. Full version history is maintained with rollback support.

**Tools**: `tool_build`, `tool_test`, `tool_list_custom`, `tool_edit`, `tool_remove`

---

## Remote Access

**File**: `web/clawser-remote.js`

Remote device connection via 6-digit pairing codes and bearer tokens.

| Constant | Value |
|----------|-------|
| Code length | 6 digits |
| Code expiry | 5 minutes |
| Token expiry | 24 hours |
| Rate limit | 60 requests/minute |

**Tools**: `remote_status`, `remote_pair`, `remote_revoke`

---

## Keyboard Shortcuts

**File**: `web/clawser-keys.js`

| Shortcut | Action |
|----------|--------|
| Cmd+Enter | Send message |
| Cmd+K | Toggle command palette |
| Cmd+N | New conversation |
| Cmd+1–9 | Switch panels (Chat, Tools, Files, Memory, Goals, Events, Skills, Terminal, Config) |
| Escape | Close autocomplete / palette / dropdown (priority order) |

Modifier key: Cmd on macOS, Ctrl on Windows/Linux.

---

## Debug Mode

**File**: `web/clawser-state.js`

Optional verbose logging gated behind a flag. Enable via browser console:

```js
clawserDebug.enable()   // Enable + persist to localStorage
clawserDebug.disable()  // Disable + remove from localStorage
clawserDebug.log(...)   // console.log only when enabled
```

Persists across page refresh via `localStorage.getItem('clawser_debug')`.
