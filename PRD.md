> **Note**: This document describes the original Rust/WASM architecture. The current implementation is a pure JavaScript browser runtime. See [ARCHITECTURE.md](ARCHITECTURE.md) for the current architecture.

# Clawser: Browser-Native Agent Operating System

## Product Requirements Document (PRD)

**Version**: 1.0.0
**Date**: 2026-02-20
**Status**: Draft

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Vision & Goals](#2-vision--goals)
3. [Target Users](#3-target-users)
4. [Architecture Overview](#4-architecture-overview)
5. [Core Modules](#5-core-modules)
6. [Feature Specifications](#6-feature-specifications)
7. [User Scenarios](#7-user-scenarios)
8. [API Surface](#8-api-surface)
9. [Configuration Schema](#9-configuration-schema)
10. [Security Model](#10-security-model)
11. [Performance Requirements](#11-performance-requirements)
12. [Testing Strategy](#12-testing-strategy)
13. [Build & Distribution](#13-build--distribution)
14. [Milestones](#14-milestones)

---

## 1. Executive Summary

Clawser is a portable AI agent runtime that compiles entirely to WebAssembly for execution inside web browsers. It transforms the browser into a personal computing environment where an autonomous AI agent operates continuously with persistent memory, tool execution, goal-oriented behavior, and resumable sessions.

Unlike server-hosted agent frameworks, Clawser runs entirely client-side. The browser becomes the host operating system; WASM provides the execution sandbox; JavaScript bridges supply syscall-like interfaces to browser APIs.

This is not a chatbot. It is a persistent cognitive process attached to a human, capable of pursuing multi-day goals, maintaining institutional memory, and operating autonomously within user-granted permission boundaries.

### Design Principles

- **Browser as OS**: Let the browser enforce limits rather than fighting them
- **Portable over perfect**: Cross-platform capability over native feature parity
- **Persistent over stateless**: Workspace artifacts over disposable chat logs
- **Capability-based security**: Permission model, never raw OS access
- **Event-driven execution**: No blocking calls; all operations async
- **Deterministic stepping**: Serializable state for crash recovery and replay

---

## 2. Vision & Goals

### What Clawser Is

A micro-operating-system inside the browser whose only process is an AI agent. The agent has:

- Real persistent memory (not just conversation history)
- A versioned workspace (git-backed file artifacts)
- Tool execution capabilities (via MCP protocol)
- Background autonomy (service worker daemon)
- Multi-tab presence (shared worker, single brain)
- Crash recovery (checkpoint/resume from OPFS)

### What Clawser Is Not

- A chat UI framework
- A cloud-hosted agent service
- A browser extension (though extensions can provide MCP tools)
- A full native OS replacement

### Success Criteria

1. Agent persists across tab closures and browser restarts
2. Agent can pursue multi-step goals spanning hours/days
3. Agent workspace is user-visible and git-versioned
4. Agent runs on locked-down corporate machines (no install required)
5. Agent operates on Chromebooks with full capability
6. Sub-50ms checkpoint/resume cycle
7. Memory footprint under 64MB for core runtime

---

## 3. Target Users

### Primary

| Persona | Description | Key Need |
|---------|-------------|----------|
| **Knowledge Worker** | Researchers, analysts with evolving projects | Persistent memory across sessions |
| **Developer** | Programmers wanting codebase-aware assistants | Tool execution + workspace versioning |
| **Student** | Learners in skill-building phases | Spaced repetition + misconception tracking |
| **Planner** | Trip/event/project coordinators | Long-running goal management |

### Environment Profiles

| Environment | Capability Level | Notes |
|-------------|-----------------|-------|
| Chrome Desktop | Full | All APIs available |
| Chromebook | Full | Native deployment target |
| Corporate Lockdown | Full (PWA) | No install friction |
| Firefox/Safari | Degraded | Polyfill where possible |
| Mobile Chrome | Limited | Background restrictions |

---

## 4. Architecture Overview

### Layer Model

```
+------------------------------------------------------------------+
|                        Browser Tab(s)                             |
|  +------------------------------------------------------------+  |
|  |  Layer 7: UI Shell (Command Palette, Workspace View, Logs) |  |
|  +------------------------------------------------------------+  |
|  |  Layer 6: Event Bus (BroadcastChannel, pub/sub topics)     |  |
|  +------------------------------------------------------------+  |
|  |  Layer 5: Shared Worker (Multi-tab coordination)           |  |
|  +------------------------------------------------------------+  |
|  |  Layer 4: Service Worker (Background daemon, resume)       |  |
|  +------------------------------------------------------------+  |
|  |  Layer 3: JS Host Runtime (Syscall bridge)                 |  |
|  +------------------------------------------------------------+  |
|  |  Layer 2: WASI Shim (Browser polyfill of WASI interface)   |  |
|  +------------------------------------------------------------+  |
|  |  Layer 1: WASM Runtime (Clawser core, compiled from Rust)  |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
```

### Execution Contexts

```
                  +-----------------+
                  |  Service Worker |  (daemon, background exec)
                  |  + WASM Runtime |
                  +--------+--------+
                           |
                  +--------+--------+
                  |  Shared Worker  |  (single brain, state owner)
                  |  + WASM Runtime |
                  +--------+--------+
                      /    |    \
               +-----+ +--+--+ +-----+
               |Tab 1| |Tab 2| |Tab 3|  (UI shells, read-only views)
               +-----+ +-----+ +-----+
```

### Mount Points (Virtual Filesystem)

| Mount | Backend | Purpose |
|-------|---------|---------|
| `/workspace` | File System Access API (user-granted handle) | User-visible project files |
| `/state` | OPFS (Origin Private File System) | Fast checkpoints, agent state |
| `/memory.db` | OPFS | SQLite memory database |
| `/tmp` | In-memory filesystem | Scratch operations |
| `/config` | localStorage / OPFS | Agent configuration |
| `/logs` | In-memory ring buffer | Runtime logs |
| `/skills` | OPFS | Installed skill packs |

### Syscall ABI

The WASM module communicates with the browser through a minimal syscall interface:

```
Category        Syscalls
-------         --------
Logging         sys.log(level, message)
Time            sys.now() -> timestamp
                sys.sleep(ms) -> ()
Task            sys.spawn_task(name, fn) -> task_id
                sys.cancel_task(task_id)
Network         sys.fetch(url, options) -> response
                sys.ws_connect(url) -> conn_id
                sys.ws_send(conn_id, data)
                sys.ws_close(conn_id)
Filesystem      sys.fs.read(path) -> bytes
                sys.fs.write(path, bytes)
                sys.fs.list(path) -> entries
                sys.fs.delete(path)
                sys.fs.stat(path) -> metadata
                sys.fs.mkdir(path)
MCP / Tools     sys.mcp.list_tools() -> tool_specs
                sys.mcp.invoke(name, args) -> result
                sys.mcp.register_server(config)
AI / Inference  sys.ai.generate(request) -> stream
                sys.ai.embed(text) -> vector
                sys.ai.count_tokens(text) -> count
Memory          sys.mem.store(key, content, category)
                sys.mem.recall(query, opts) -> entries
                sys.mem.forget(key)
                sys.mem.list(category) -> entries
Crypto          sys.crypto.encrypt(data, key) -> ciphertext
                sys.crypto.decrypt(ciphertext, key) -> data
                sys.crypto.random(n) -> bytes
Git             sys.git.init(path)
                sys.git.commit(path, message)
                sys.git.log(path, n) -> commits
                sys.git.diff(path) -> diff
                sys.git.checkout(path, ref)
State           sys.state.checkpoint() -> snapshot_id
                sys.state.restore(snapshot_id)
                sys.state.list_checkpoints() -> ids
Events          sys.events.emit(topic, payload)
                sys.events.subscribe(topic, callback_id)
                sys.events.unsubscribe(callback_id)
Permissions     sys.perms.request(capability) -> granted
                sys.perms.check(capability) -> bool
```

---

## 5. Core Modules

### 5.1 WASI Shim (`clawser-wasi`)

Browser polyfill implementing the WASI interface for the WASM module.

**Responsibilities**:
- Map WASI `fd_read`/`fd_write` to virtual filesystem
- Map `clock_time_get` to `performance.now()`
- Map `random_get` to `crypto.getRandomValues()`
- Provide `poll_oneoff` via event loop integration
- Emulate `environ_get` from configuration
- Map `proc_exit` to agent shutdown sequence

**Constraints**:
- No blocking calls (all async via callback trampolines)
- Single-threaded execution model
- Linear memory only (no shared memory)

### 5.2 Host Runtime (`clawser-host`)

JavaScript bridge providing syscall implementations.

**Responsibilities**:
- Implement all `sys.*` syscall handlers
- Manage browser API lifecycle (handles, connections, workers)
- Serialize/deserialize across WASM boundary
- Buffer and batch high-frequency syscalls
- Enforce permission model

**Key Design Decisions**:
- API keys stored in JS host, never in WASM linear memory
- All network requests proxied through host (prevents WASM escape)
- Tool invocations mediated by host permission layer

### 5.3 Agent Core (`clawser-core`)

The Rust library compiled to WASM. This is the brain.

**Sub-modules**:

| Module | Purpose |
|--------|---------|
| `agent` | Main agent loop, state machine, goal management |
| `providers` | AI model provider trait + implementations |
| `memory` | Hybrid vector + keyword memory system |
| `tools` | Tool trait, built-in tools, MCP bridge |
| `scheduler` | Task scheduling, cron, timers |
| `identity` | Agent persona, AIEOS support |
| `config` | Configuration loading and validation |
| `session` | Conversation history, compaction |
| `checkpoint` | State serialization and restoration |

### 5.4 Provider System (`clawser-providers`)

Multi-provider AI model integration.

**Supported Providers**:

| Provider | Auth | Tool Calling | Vision | Streaming |
|----------|------|-------------|--------|-----------|
| OpenAI | API Key | Native | Yes | SSE |
| Anthropic | API Key | Native | Yes | SSE |
| Google Gemini | API Key | Native (functionDeclarations) | Yes | SSE |
| Ollama | None (local) | Native | Model-dependent | SSE |
| OpenRouter | API Key | Passthrough | Passthrough | SSE |
| Chrome Built-in AI | None (local) | Prompt-guided | No | Streaming |
| Groq | API Key | Native | No | SSE |
| Mistral | API Key | Native | No | SSE |
| DeepSeek | API Key | Native | No | SSE |
| xAI (Grok) | API Key | Native | Yes | SSE |
| Together AI | API Key | Native | Model-dependent | SSE |
| Fireworks | API Key | Native | No | SSE |
| Cohere | API Key | Native | No | SSE |
| Perplexity | API Key | Prompt-guided | No | SSE |
| Custom OpenAI-compat | API Key | Configurable | Configurable | SSE |
| Custom Anthropic-compat | API Key | Configurable | Configurable | SSE |

**Provider Trait**:

```rust
#[async_trait]
pub trait Provider: Send + Sync {
    fn name(&self) -> &str;
    fn capabilities(&self) -> ProviderCapabilities;

    async fn chat(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[ToolSpec]>,
        options: &ChatOptions,
    ) -> Result<ChatResponse>;

    async fn chat_stream(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[ToolSpec]>,
        options: &ChatOptions,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<ChatStreamChunk>>>>>;

    async fn embed(&self, text: &str) -> Result<Vec<f32>>;
    fn token_count(&self, text: &str) -> Result<usize>;
}
```

**Reliability Layer**:
- Fallback provider chains (try primary, then fallback list)
- Exponential backoff with jitter on transient failures
- Cost tracking per provider (token usage x pricing)
- Configurable daily/monthly spend limits
- Model routing via `hint:<name>` aliases

### 5.5 Memory System (`clawser-memory`)

Hybrid vector + full-text-search memory engine with zero external dependencies.

**Architecture**:

```
+-------------------+
|   Memory Trait    |  (store, recall, forget, list, count)
+--------+----------+
         |
    +----+----+-----+--------+
    |         |      |        |
 SQLite   Markdown  None   (future)
    |
    +-- FTS5 virtual table (BM25 keyword scoring)
    +-- BLOB vectors (cosine similarity)
    +-- Weighted merge (configurable vector/keyword blend)
```

**Memory Categories**:

| Category | Purpose | Retention |
|----------|---------|-----------|
| `core` | Long-term facts, preferences, decisions | Permanent until forgotten |
| `daily` | Session logs, observations | Archive after N days |
| `conversation` | Current context window | Session-scoped |
| `custom(String)` | User-defined namespaces | Configurable |

**Memory Trait**:

```rust
#[async_trait]
pub trait Memory: Send + Sync {
    async fn store(&self, entry: MemoryEntry) -> Result<String>;
    async fn recall(&self, query: &str, opts: RecallOptions) -> Result<Vec<MemoryEntry>>;
    async fn get(&self, id: &str) -> Result<Option<MemoryEntry>>;
    async fn list(&self, category: Option<MemoryCategory>, limit: usize) -> Result<Vec<MemoryEntry>>;
    async fn forget(&self, id: &str) -> Result<bool>;
    async fn count(&self, category: Option<MemoryCategory>) -> Result<usize>;
    async fn health_check(&self) -> Result<bool>;
}
```

**Embedding Providers**:
- OpenAI `text-embedding-3-small` (remote, high quality)
- Chrome Built-in AI embedding (local, zero-cost)
- Noop (keyword-only mode, no vectors)

**Search Algorithm**:
1. Query → embed to vector via embedding provider
2. Cosine similarity scan against stored BLOB vectors
3. BM25 keyword search via FTS5 virtual table
4. Weighted merge: `score = (vector_weight * cosine) + (keyword_weight * bm25)`
5. Default weights: vector=0.7, keyword=0.3
6. Return top-K results sorted by merged score

**Hygiene**:
- Auto-archive entries older than `archive_after_days`
- Auto-purge archived entries older than `purge_after_days`
- Safe reindex (FTS5 rebuild + re-embed missing vectors)
- Snapshot/export for migration

### 5.6 Tool System (`clawser-tools`)

Capability-based tool execution with MCP protocol support.

**Built-in Tools**:

| Tool | Description | Permission Level |
|------|-------------|-----------------|
| `file_read` | Read file from workspace | read |
| `file_write` | Write file to workspace | write |
| `file_list` | List directory contents | read |
| `file_delete` | Delete file from workspace | write |
| `memory_store` | Persist a memory entry | internal |
| `memory_recall` | Search memory | internal |
| `memory_forget` | Delete a memory entry | internal |
| `web_fetch` | HTTP GET/POST | network |
| `web_search` | Web search query | network |
| `git_commit` | Commit workspace changes | write |
| `git_log` | View commit history | read |
| `git_diff` | View uncommitted changes | read |
| `git_checkout` | Switch branches/restore | write |
| `schedule_add` | Add a scheduled task | scheduler |
| `schedule_list` | List scheduled tasks | scheduler |
| `schedule_remove` | Remove a scheduled task | scheduler |
| `delegate` | Spawn sub-agent task | agent |
| `notify` | Send browser notification | ui |
| `screenshot` | Capture current page | browser |
| `browser_navigate` | Open URL in tab | browser |

**Tool Trait**:

```rust
#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> serde_json::Value;
    fn required_permission(&self) -> Permission;

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult>;
}
```

**MCP Integration**:

The agent can discover and invoke tools provided by:
- Browser extensions (via message passing)
- Localhost MCP servers (via fetch to localhost)
- Registered MCP server configs (stdio via host shim)

MCP tool discovery:
1. Host enumerates available MCP servers
2. For each server, call `tools/list` JSON-RPC method
3. Convert tool specs to internal `ToolSpec` format
4. Register in agent's tool registry
5. On invocation, proxy `tools/call` through host

### 5.7 Scheduler (`clawser-scheduler`)

Task scheduling for autonomous goal pursuit.

**Schedule Types**:

| Type | Syntax | Example |
|------|--------|---------|
| Cron | 5-field cron expression | `0 9 * * 1-5` (9am weekdays) |
| One-shot | RFC3339 timestamp | `2026-03-01T10:00:00Z` |
| Interval | Duration | `every 30m`, `every 2h` |
| Delay | Relative | `in 5m`, `in 1h` |

**Job Configuration**:

```rust
pub struct ScheduledJob {
    pub id: String,
    pub name: String,
    pub schedule: Schedule,
    pub action: JobAction,           // AgentPrompt(String) | ShellCommand(String)
    pub timezone: Option<String>,    // IANA timezone
    pub delivery: DeliveryMode,      // Always | OnError | OnSuccess | None
    pub delete_after_run: bool,
    pub paused: bool,
    pub last_run: Option<DateTime<Utc>>,
    pub next_run: Option<DateTime<Utc>>,
    pub run_count: u64,
}
```

**Heartbeat**:
- Configurable periodic wake-up (default: 5 minutes)
- Triggers pending job evaluation
- Health check of all subsystems
- Memory hygiene (archive/purge check)

### 5.8 Session Manager (`clawser-session`)

Conversation history and context window management.

**Features**:
- Session-based message history (configurable idle timeout)
- Automatic compaction when context approaches token limit
- Keeps N most recent messages + summary of compacted history
- Extended thinking/reasoning content support (Anthropic)
- Multi-turn tool calling loops (max iterations configurable)
- Session scoping for memory queries

**Compaction Algorithm**:
1. When `total_tokens > token_limit * 0.8`:
2. Take oldest messages beyond `keep_recent` count
3. Summarize via provider call (or local model)
4. Replace old messages with summary message
5. Preserve all tool call/result pairs intact

### 5.9 Identity System (`clawser-identity`)

Agent persona and behavioral framework.

**Supported Formats**:

| Format | Description |
|--------|-------------|
| AIEOS v1.1 JSON | Portable AI identity (names, psychology, linguistics, motivations) |
| OpenClaw Markdown | IDENTITY.md, SOUL.md, USER.md files |
| Plain System Prompt | Simple string-based persona |

**AIEOS Fields**:
- `names`: display, full, aliases
- `bio`: origin story, current situation
- `psychology`: MBTI, OCEAN traits, moral compass, neural matrix
- `linguistics`: formality level, catchphrases, forbidden words, vocabulary
- `motivations`: core drive, goals, fears
- `capabilities`: skills, tools, knowledge domains
- `physicality`: avatar description (for UI rendering)
- `history`: key events, timeline

### 5.10 Checkpoint System (`clawser-checkpoint`)

Crash-safe state persistence and resumable execution.

**What Gets Checkpointed**:
- Agent state machine position (current step, pending actions)
- Conversation history
- Active goal stack
- Pending tool calls and their status
- Scheduler state (next run times)
- Memory transaction log (uncommitted entries)

**Checkpoint Storage**:
- Serialized to MessagePack (compact binary)
- Written to OPFS (`/state/checkpoint-{id}.bin`)
- Indexed in `/state/checkpoints.json`
- Automatic checkpoint on:
  - Before each tool execution
  - After each agent step completion
  - Before browser visibility change (page hide event)
  - Periodic timer (configurable interval)

**Resume Flow**:
1. Service worker activates
2. Read latest checkpoint from OPFS
3. Deserialize agent state
4. Verify memory DB integrity
5. Resume from last completed step
6. Re-execute any interrupted tool calls

### 5.11 Event Bus (`clawser-events`)

Cross-context communication system.

**Topics**:

| Topic | Payload | Publishers | Subscribers |
|-------|---------|------------|-------------|
| `agent.step` | Step details, status | Core | UI, Logs |
| `agent.goal.started` | Goal description | Core | UI |
| `agent.goal.completed` | Goal result | Core | UI, Notifications |
| `agent.goal.failed` | Error details | Core | UI, Notifications |
| `tool.invoked` | Tool name, args | Core | UI, Logs |
| `tool.completed` | Tool name, result | Core | UI, Logs |
| `memory.stored` | Entry summary | Memory | UI |
| `provider.request` | Provider, model | Core | Logs, Cost Tracker |
| `provider.response` | Tokens used, cost | Core | Logs, Cost Tracker |
| `checkpoint.saved` | Checkpoint ID | Checkpoint | Logs |
| `schedule.fired` | Job ID, name | Scheduler | Core, Logs |
| `workspace.changed` | File path, action | Tools | UI, Git |
| `error` | Error details | Any | UI, Logs |

**Implementation**:
- BroadcastChannel for cross-context (tabs, workers)
- In-process pub/sub for same-context
- Message format: `{ topic: string, payload: any, timestamp: number, source: string }`

### 5.12 Git Integration (`clawser-git`)

Workspace versioning using isomorphic-git (via host bridge).

**Capabilities**:
- Initialize repository in workspace
- Stage and commit changes
- View log, diff, blame
- Branch creation and checkout
- Rollback to previous commits

**Agent-Specific Features**:
- Automatic commits at goal boundaries ("Goal: {description}")
- Episodic memory: commits as cognition snapshots
- Diff-based self-reflection (agent can analyze its own changes)
- Branch-per-experiment (isolate risky explorations)

### 5.13 Observability (`clawser-observe`)

Runtime monitoring and diagnostics.

**Observer Trait**:

```rust
pub trait Observer: Send + Sync {
    fn record_event(&self, event: Event);
    fn record_metric(&self, metric: Metric);
    fn flush(&self);
    fn name(&self) -> &str;
}
```

**Backends**:

| Backend | Description | Use Case |
|---------|-------------|----------|
| Noop | Zero-cost no-op | Production default |
| Console | `console.log` via host | Development |
| Ring Buffer | In-memory circular log | Runtime inspection |
| Event Bus | Publish to event topics | UI display |

**Metrics**:
- `agent.step.duration_ms` (histogram)
- `provider.request.duration_ms` (histogram)
- `provider.tokens.input` (counter)
- `provider.tokens.output` (counter)
- `provider.cost.usd` (counter)
- `memory.entries.count` (gauge)
- `memory.search.duration_ms` (histogram)
- `tool.execution.duration_ms` (histogram)
- `checkpoint.save.duration_ms` (histogram)
- `checkpoint.size.bytes` (gauge)

---

## 6. Feature Specifications

### 6.1 Agent Loop

The core execution model is a state machine:

```
         +--------+
         | IDLE   |<-----------------------+
         +---+----+                        |
             |                             |
         (message/goal/schedule)           |
             |                             |
         +---v----+                        |
    +--->| THINK  |  (call provider)       |
    |    +---+----+                        |
    |        |                             |
    |    (response)                        |
    |        |                             |
    |    +---v----------+                  |
    |    | PARSE        |                  |
    |    | (text? tools?)|                 |
    |    +---+-----+----+                  |
    |        |     |                       |
    |   (text) (tool_calls)                |
    |        |     |                       |
    |        |  +--v--------+              |
    |        |  | EXECUTE   | (invoke tools) |
    |        |  +--+--------+              |
    |        |     |                       |
    |        |  (results)                  |
    |        |     |                       |
    |        +<----+                       |
    |        |                             |
    |    +---v---------+                   |
    |    | CHECKPOINT  |                   |
    |    +---+---------+                   |
    |        |                             |
    |   (more tools needed?)               |
    |    yes |      no                     |
    +--------+      |                      |
                    |                      |
              +-----v------+              |
              | RESPOND     |  (emit result)|
              +-----+------+              |
                    |                      |
                    +----------------------+
```

**Configuration**:

```rust
pub struct AgentConfig {
    pub max_tool_iterations: u32,       // default: 10
    pub max_history_messages: u32,      // default: 50
    pub token_limit: u32,              // default: 128_000
    pub session_idle_timeout_secs: u64, // default: 1800
    pub compaction_keep_recent: u32,    // default: 20
    pub message_timeout_secs: u64,     // default: 300
    pub checkpoint_interval_secs: u64,  // default: 30
    pub parallel_tools: bool,          // default: false
}
```

### 6.2 Multi-Tab Coordination

```
Tab A (UI)          Shared Worker           Tab B (UI)
  |                     |                      |
  |--- user msg ------->|                      |
  |                     |--- to WASM core ---->|
  |                     |<-- agent step -------|
  |<-- step event ------|------- step event -->|
  |                     |                      |
  |                     |<-- agent response ---|
  |<-- response event --|--- response event -->|
```

- Shared Worker owns the WASM instance (single brain)
- Tabs connect via `MessagePort`
- Web Locks prevent concurrent mutations
- Only one tab can send input at a time (lock acquisition)
- All tabs receive output events

### 6.3 Background Execution

Service Worker responsibilities:
- Keep agent alive when all tabs close
- Resume from checkpoint on service worker activation
- Handle scheduled job wake-ups via `setTimeout` / `setInterval`
- Process incoming webhook messages (if registered)
- Emit notifications for completed goals

Limitations:
- Service workers can be terminated by browser after idle period
- Must checkpoint before termination
- Resume transparently on next wake-up

### 6.4 Workspace Management

The workspace is a user-granted directory (File System Access API):

```
/workspace/
  .git/                  # isomorphic-git repository
  goals/
    active/
      goal-001.md        # Current goal description + status
    completed/
      goal-000.md        # Archived completed goals
  artifacts/
    research-ev.md       # Long-running research output
    audit-results.json   # Security audit findings
  notes/
    meeting-prep.md      # Agent-generated notes
  config/
    identity.json        # AIEOS identity (optional)
```

- Agent reads/writes files as structured output
- User can browse workspace like any directory
- Git provides version history and rollback
- Goals are first-class file artifacts

### 6.5 Chrome Built-in AI Integration

For local on-device inference (zero API cost):

**Available APIs**:
- `ai.languageModel.create()` - General text generation
- `ai.writer.create()` - Content writing with tone/format
- `ai.rewriter.create()` - Content transformation
- `ai.summarizer.create()` - Text summarization

**Usage Strategy**:
1. Use Chrome AI as default for simple tasks (free, fast, private)
2. Fall back to remote providers for complex reasoning
3. Use Chrome AI for memory summarization (background, non-critical)
4. Use remote provider for tool-heavy multi-step tasks

**Provider Implementation**:

```rust
pub struct ChromeAiProvider {
    // Capabilities detected at runtime via host bridge
    has_language_model: bool,
    has_writer: bool,
    has_rewriter: bool,
    has_summarizer: bool,
}
```

---

## 7. User Scenarios

Each scenario describes a real use case the system must support. These serve as acceptance criteria and form the basis of integration tests.

### Scenario 1: Health Investigation

**Actor**: Knowledge Worker
**Duration**: Multi-week
**Goal**: Track symptom patterns, research conditions, prepare doctor briefings

**Flow**:
1. User opens Clawser, sets goal: "Help me track and research my recurring headaches"
2. Agent creates workspace structure: `goals/active/headache-research.md`, `artifacts/symptom-log.md`
3. Over multiple sessions, user reports symptoms; agent stores in memory and appends to log
4. Agent recalls previous entries, identifies patterns (frequency, triggers, timing)
5. Agent uses `web_fetch` to research matching conditions
6. Agent produces `artifacts/doctor-briefing.md` with timeline, patterns, and questions to ask
7. User visits doctor; returns with diagnosis; agent updates memory and archives goal

**Tests**:
- Memory persists across sessions (close all tabs, reopen)
- Agent recalls specific symptom entries from weeks ago
- Workspace files survive checkpoint/restore cycle
- Goal transitions from active to completed

### Scenario 2: Long-Running Code Refactoring

**Actor**: Developer
**Duration**: Multi-day
**Goal**: Plan and execute staged code migration

**Flow**:
1. User grants workspace access to project directory
2. Sets goal: "Migrate authentication from sessions to JWT"
3. Agent reads codebase, identifies all auth-related files
4. Creates migration plan in `artifacts/jwt-migration-plan.md`
5. Creates branches for each migration stage
6. In first session: refactors token generation
7. Commits changes, checkpoints state
8. User closes browser, returns next day
9. Agent resumes from checkpoint, continues with middleware changes
10. Each stage committed separately with descriptive messages
11. Final artifact: `artifacts/jwt-migration-summary.md`

**Tests**:
- Git commits persist in workspace
- Checkpoint resume continues mid-migration
- Agent can read and modify files in granted workspace
- Multi-day session continuity via memory

### Scenario 3: Trip Co-Planning

**Actor**: Planner
**Duration**: 1-2 weeks
**Goal**: Adaptive itinerary with reservation timing

**Flow**:
1. User sets goal: "Plan a 5-day trip to Tokyo in April"
2. Agent creates `goals/active/tokyo-trip.md`
3. Researches weather, events, cherry blossom forecasts via `web_fetch`
4. Produces `artifacts/tokyo-itinerary-v1.md`
5. User provides feedback ("prefer quieter neighborhoods")
6. Agent recalls preference, updates memory, produces v2
7. Agent schedules reminder: "Check hotel prices" in 3 days
8. Scheduled job fires, agent fetches prices, updates `artifacts/tokyo-hotels.md`
9. User approves plan; agent marks goal complete

**Tests**:
- Scheduled job fires after configured delay
- Agent uses memory to refine recommendations
- Multiple artifact versions tracked in workspace
- Goal lifecycle (active -> complete) with file moves

### Scenario 4: Security Audit Sentinel

**Actor**: Developer
**Duration**: Ongoing (weeks/months)
**Goal**: Continuous CVE monitoring for project dependencies

**Flow**:
1. User sets goal: "Monitor my project's dependencies for security vulnerabilities"
2. Agent reads `package.json` / `Cargo.toml` from workspace
3. Extracts dependency list, stores in memory
4. Schedules daily job: "Check for new CVEs"
5. Each day, agent uses `web_fetch` to query vulnerability databases
6. If new CVE found, stores in memory, updates `artifacts/security-report.md`
7. Sends browser notification: "New vulnerability found in dependency X"
8. Agent produces remediation suggestions

**Tests**:
- Recurring cron job executes daily
- New findings accumulate in persistent report
- Notifications delivered via browser API
- Agent distinguishes new vs already-known CVEs via memory

### Scenario 5: Writing Companion

**Actor**: Writer
**Duration**: Weeks/months
**Goal**: Character consistency, plot thread tracking

**Flow**:
1. User sets goal: "Help me write a novel - track characters, plots, themes"
2. Agent creates workspace: `artifacts/characters/`, `artifacts/plot-threads/`, `artifacts/chapters/`
3. User writes chapter drafts, shares with agent
4. Agent extracts character details, stores in memory
5. When user introduces inconsistency, agent flags it: "In chapter 3, Alex had brown eyes; now you say blue"
6. Agent maintains `artifacts/story-bible.md` with all tracked elements
7. User asks "What unresolved plot threads do I have?" - agent recalls from memory

**Tests**:
- Agent detects contradictions across sessions
- Memory recall finds character details stored weeks ago
- Story bible stays current with latest chapter content
- Multiple artifact files managed simultaneously

### Scenario 6: Skill Learning with Spaced Repetition

**Actor**: Student
**Duration**: Weeks
**Goal**: Learn Rust programming with tracked progress

**Flow**:
1. User sets goal: "Teach me Rust - track my progress and misconceptions"
2. Agent creates curriculum in `artifacts/rust-curriculum.md`
3. Each session, agent presents concept, asks practice questions
4. Stores misconceptions in memory with timestamps
5. Schedules spaced repetition reviews based on difficulty
6. "You struggled with lifetimes 3 days ago - let's revisit"
7. Tracks mastery levels per topic in `artifacts/rust-progress.md`
8. Adapts teaching pace based on accumulated performance data

**Tests**:
- Spaced repetition scheduling triggers at correct intervals
- Misconception tracking persists and is recalled accurately
- Progress tracking accumulates over multiple sessions
- Curriculum adapts based on stored performance

### Scenario 7: Personal Research Lab

**Actor**: Researcher
**Duration**: Months
**Goal**: Hypothesis testing with evidence accumulation

**Flow**:
1. User sets goal: "Research whether intermittent fasting affects cognitive performance"
2. Agent creates research structure in workspace
3. Over weeks, user shares papers, articles, personal observations
4. Agent stores evidence categorized by source type
5. Agent maintains `artifacts/evidence-matrix.md` with pro/con/neutral columns
6. When asked for current assessment, agent synthesizes across all stored evidence
7. Agent identifies gaps: "We have no data on effects during sleep deprivation"
8. User can ask agent to re-evaluate based on new evidence

**Tests**:
- Evidence persists across many sessions (months of data)
- Categorized recall works (pro vs con vs neutral)
- Synthesis produces coherent summary from many entries
- Evidence matrix file stays synchronized with memory

### Scenario 8: Browsing Augmentation

**Actor**: Knowledge Worker
**Duration**: Single session (but memory persists)
**Goal**: Context-aware page analysis linked to active projects

**Flow**:
1. User is reading article about WebAssembly optimizations
2. Agent (running in background) detects page content via tool
3. Cross-references with user's active goals and memory
4. Suggests: "This WASM optimization technique is relevant to your Clawser project"
5. Offers to save key findings to relevant project workspace
6. User approves; agent appends to `artifacts/wasm-research.md`

**Tests**:
- Agent can read current page content via browser tool
- Memory recall connects new content to existing projects
- File append preserves existing content
- User confirmation required before workspace write

### Scenario 9: Digital Maintenance

**Actor**: Any User
**Duration**: Ongoing
**Goal**: Automatic file organization and subscription tracking

**Flow**:
1. User sets goal: "Help me keep my workspace organized"
2. Agent periodically scans workspace for patterns
3. Identifies duplicate or similar files
4. Suggests reorganization: "Move 3 CV drafts to `drafts/cv/`"
5. Tracks subscription-related files, reminders for renewals
6. Maintains `artifacts/maintenance-log.md` with actions taken

**Tests**:
- Periodic workspace scan via scheduled job
- Duplicate detection works across directories
- Agent only suggests changes (requires user approval for destructive actions)
- Maintenance log records all actions

### Scenario 10: Corporate Lockdown Deployment

**Actor**: Knowledge Worker on restricted machine
**Duration**: Ongoing
**Goal**: Full agent capability without any software installation

**Flow**:
1. User navigates to Clawser PWA URL in Chrome
2. No installation, no admin rights needed
3. Grants workspace directory access via browser dialog
4. Configures API key for remote provider
5. Agent operates fully within browser sandbox
6. All data stored in OPFS (origin-private, no IT visibility concerns)
7. Service worker enables offline resumption

**Tests**:
- Full functionality without any `npm install`, `cargo install`, etc.
- Works behind corporate proxy (fetch API respects system proxy)
- OPFS storage not accessible to other origins
- PWA installable for app-like experience

---

## 8. API Surface

### 8.1 Rust Public API (Library Crate)

```rust
// Top-level module structure
pub mod agent;       // Agent loop, state machine, goal management
pub mod providers;   // Provider trait + implementations
pub mod memory;      // Memory trait + SQLite/None backends
pub mod tools;       // Tool trait + built-in tools
pub mod scheduler;   // Cron, timers, heartbeat
pub mod session;     // Conversation management
pub mod identity;    // AIEOS, persona loading
pub mod config;      // Configuration schema
pub mod checkpoint;  // State serialization
pub mod events;      // Event bus
pub mod git;         // Workspace versioning
pub mod observe;     // Observability
pub mod syscall;     // WASI/host syscall interface definitions
```

### 8.2 Key Data Types

```rust
// --- Messages ---
pub struct ChatMessage {
    pub role: Role,                    // System, User, Assistant, Tool
    pub content: String,
    pub content_parts: Option<Vec<ContentPart>>,  // Multimodal
    pub tool_call_id: Option<String>,
    pub name: Option<String>,
}

pub enum ContentPart {
    Text(String),
    ImageUrl { url: String },
    ImageBase64 { media_type: String, data: String },
}

pub struct ChatResponse {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub usage: TokenUsage,
    pub model: String,
    pub reasoning_content: Option<String>,
}

pub struct ChatStreamChunk {
    pub delta: String,
    pub tool_call_delta: Option<ToolCallDelta>,
    pub is_final: bool,
    pub usage: Option<TokenUsage>,
}

pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

pub struct ChatOptions {
    pub model: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub stop_sequences: Option<Vec<String>>,
}

// --- Tools ---
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,  // JSON string
}

pub struct ToolResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,  // JSON Schema
    pub required_permission: Permission,
}

// --- Memory ---
pub struct MemoryEntry {
    pub id: String,
    pub key: String,
    pub content: String,
    pub category: MemoryCategory,
    pub timestamp: i64,
    pub session_id: Option<String>,
    pub score: Option<f64>,
    pub embedding: Option<Vec<f32>>,
}

pub enum MemoryCategory {
    Core,
    Daily,
    Conversation,
    Custom(String),
}

pub struct RecallOptions {
    pub limit: usize,           // default: 10
    pub category: Option<MemoryCategory>,
    pub session_id: Option<String>,
    pub min_score: Option<f64>,
    pub vector_weight: Option<f64>,
    pub keyword_weight: Option<f64>,
}

// --- Scheduler ---
pub enum Schedule {
    Cron(String),           // "0 9 * * 1-5"
    At(DateTime<Utc>),      // One-shot timestamp
    Every(Duration),        // Recurring interval
    Delay(Duration),        // One-shot relative
}

pub struct ScheduledJob {
    pub id: String,
    pub name: String,
    pub schedule: Schedule,
    pub action: JobAction,
    pub timezone: Option<String>,
    pub delivery: DeliveryMode,
    pub delete_after_run: bool,
    pub paused: bool,
    pub last_run: Option<i64>,
    pub next_run: Option<i64>,
    pub run_count: u64,
}

pub enum JobAction {
    AgentPrompt(String),
    ToolInvocation { tool: String, args: serde_json::Value },
}

pub enum DeliveryMode {
    Always,
    OnError,
    OnSuccess,
    None,
}

// --- Identity ---
pub struct AieosIdentity {
    pub version: String,              // "1.1"
    pub names: Names,
    pub bio: Option<String>,
    pub psychology: Option<Psychology>,
    pub linguistics: Option<Linguistics>,
    pub motivations: Option<Motivations>,
    pub capabilities: Option<Capabilities>,
    pub history: Option<Vec<HistoryEvent>>,
}

// --- Configuration ---
pub struct Config {
    // Provider settings
    pub default_provider: String,
    pub default_model: String,
    pub default_temperature: f32,
    pub providers: HashMap<String, ProviderConfig>,
    pub model_routes: Vec<ModelRoute>,

    // Agent settings
    pub agent: AgentConfig,

    // Memory settings
    pub memory: MemoryConfig,

    // Scheduler settings
    pub scheduler: SchedulerConfig,

    // Security settings
    pub autonomy: AutonomyConfig,
    pub permissions: PermissionsConfig,

    // Gateway settings (for webhook reception)
    pub gateway: Option<GatewayConfig>,

    // Identity
    pub identity: Option<IdentityConfig>,

    // Observability
    pub observability: ObservabilityConfig,

    // Cost tracking
    pub cost: CostConfig,
}

// --- Permissions ---
pub enum Permission {
    Read,          // Read workspace files
    Write,         // Write workspace files
    Network,       // Make HTTP requests
    Browser,       // Browser automation
    Scheduler,     // Manage scheduled tasks
    Agent,         // Spawn sub-agents
    Internal,      // Memory/internal operations (always granted)
}

pub struct PermissionsConfig {
    pub auto_grant: Vec<Permission>,   // Granted without asking
    pub require_approval: Vec<Permission>,  // Ask user each time
    pub deny: Vec<Permission>,         // Never allowed
}

// --- Autonomy ---
pub enum AutonomyLevel {
    ReadOnly,      // Can read and think, never modify
    Supervised,    // Can suggest, user approves actions
    Full,          // Can act autonomously within permission bounds
}

pub struct AutonomyConfig {
    pub level: AutonomyLevel,
    pub max_actions_per_hour: u32,
    pub max_cost_per_day_cents: u32,
    pub workspace_only: bool,          // Restrict file ops to workspace
}

// --- Checkpoint ---
pub struct Checkpoint {
    pub id: String,
    pub timestamp: i64,
    pub agent_state: AgentState,
    pub session_history: Vec<ChatMessage>,
    pub active_goals: Vec<Goal>,
    pub pending_tool_calls: Vec<ToolCall>,
    pub scheduler_snapshot: SchedulerSnapshot,
    pub memory_txlog: Vec<MemoryOp>,
}

pub struct Goal {
    pub id: String,
    pub description: String,
    pub status: GoalStatus,
    pub created_at: i64,
    pub updated_at: i64,
    pub sub_goals: Vec<String>,
    pub artifacts: Vec<String>,        // Workspace file paths
}

pub enum GoalStatus {
    Active,
    Paused,
    Completed,
    Failed,
}

// --- Events ---
pub struct Event {
    pub topic: String,
    pub payload: serde_json::Value,
    pub timestamp: i64,
    pub source: String,
}
```

### 8.3 Host Syscall Interface (WASM Imports)

Functions imported by the WASM module from the JS host:

```rust
// These are extern "C" functions imported from the host environment
extern "C" {
    // Logging
    fn host_log(level: i32, msg_ptr: *const u8, msg_len: u32);

    // Time
    fn host_now() -> f64;  // milliseconds since epoch

    // Async operations (callback-based)
    fn host_fetch(
        url_ptr: *const u8, url_len: u32,
        opts_ptr: *const u8, opts_len: u32,
        callback_id: u32,
    );

    fn host_fs_read(
        path_ptr: *const u8, path_len: u32,
        callback_id: u32,
    );

    fn host_fs_write(
        path_ptr: *const u8, path_len: u32,
        data_ptr: *const u8, data_len: u32,
        callback_id: u32,
    );

    fn host_fs_list(
        path_ptr: *const u8, path_len: u32,
        callback_id: u32,
    );

    fn host_fs_delete(
        path_ptr: *const u8, path_len: u32,
        callback_id: u32,
    );

    fn host_fs_stat(
        path_ptr: *const u8, path_len: u32,
        callback_id: u32,
    );

    fn host_fs_mkdir(
        path_ptr: *const u8, path_len: u32,
        callback_id: u32,
    );

    fn host_mcp_list_tools(callback_id: u32);

    fn host_mcp_invoke(
        name_ptr: *const u8, name_len: u32,
        args_ptr: *const u8, args_len: u32,
        callback_id: u32,
    );

    fn host_ai_generate(
        request_ptr: *const u8, request_len: u32,
        callback_id: u32,
    );

    fn host_ai_embed(
        text_ptr: *const u8, text_len: u32,
        callback_id: u32,
    );

    fn host_crypto_random(buf_ptr: *mut u8, buf_len: u32);

    fn host_crypto_encrypt(
        data_ptr: *const u8, data_len: u32,
        callback_id: u32,
    );

    fn host_crypto_decrypt(
        data_ptr: *const u8, data_len: u32,
        callback_id: u32,
    );

    fn host_events_emit(
        topic_ptr: *const u8, topic_len: u32,
        payload_ptr: *const u8, payload_len: u32,
    );

    fn host_notify(
        title_ptr: *const u8, title_len: u32,
        body_ptr: *const u8, body_len: u32,
    );

    fn host_permission_check(
        capability_ptr: *const u8, capability_len: u32,
    ) -> i32;

    fn host_permission_request(
        capability_ptr: *const u8, capability_len: u32,
        callback_id: u32,
    );
}
```

### 8.4 WASM Exports (Called by Host)

```rust
// Functions exported from WASM to be called by the host
#[no_mangle]
pub extern "C" fn clawser_init(config_ptr: *const u8, config_len: u32) -> i32;

#[no_mangle]
pub extern "C" fn clawser_step() -> i32;  // Run one agent step

#[no_mangle]
pub extern "C" fn clawser_on_message(msg_ptr: *const u8, msg_len: u32);

#[no_mangle]
pub extern "C" fn clawser_on_callback(callback_id: u32, data_ptr: *const u8, data_len: u32);

#[no_mangle]
pub extern "C" fn clawser_on_error(callback_id: u32, err_ptr: *const u8, err_len: u32);

#[no_mangle]
pub extern "C" fn clawser_on_stream_chunk(
    callback_id: u32,
    chunk_ptr: *const u8,
    chunk_len: u32,
    is_final: i32,
);

#[no_mangle]
pub extern "C" fn clawser_checkpoint() -> i32;  // Serialize state, return size

#[no_mangle]
pub extern "C" fn clawser_restore(data_ptr: *const u8, data_len: u32) -> i32;

#[no_mangle]
pub extern "C" fn clawser_shutdown();

// Memory management
#[no_mangle]
pub extern "C" fn clawser_alloc(size: u32) -> *mut u8;

#[no_mangle]
pub extern "C" fn clawser_dealloc(ptr: *mut u8, size: u32);
```

---

## 9. Configuration Schema

Configuration stored as JSON in OPFS (`/config/clawser.json`):

```json
{
  "version": "1.0.0",

  "providers": {
    "default": "openai",
    "entries": {
      "openai": {
        "api_key": "sk-...",
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o",
        "default_temperature": 0.7,
        "max_tokens": 4096
      },
      "anthropic": {
        "api_key": "sk-ant-...",
        "base_url": "https://api.anthropic.com",
        "default_model": "claude-sonnet-4-20250514",
        "default_temperature": 0.7,
        "max_tokens": 8192
      },
      "chrome-ai": {
        "enabled": true
      },
      "ollama": {
        "base_url": "http://localhost:11434",
        "default_model": "llama3.2"
      },
      "openrouter": {
        "api_key": "sk-or-...",
        "base_url": "https://openrouter.ai/api/v1"
      }
    },
    "model_routes": [
      {
        "hint": "fast",
        "provider": "chrome-ai",
        "model": "default"
      },
      {
        "hint": "smart",
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514"
      },
      {
        "hint": "code",
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514"
      }
    ],
    "reliability": {
      "max_retries": 3,
      "backoff_base_ms": 1000,
      "backoff_max_ms": 30000,
      "fallback_chain": ["openai", "anthropic", "chrome-ai"]
    }
  },

  "agent": {
    "max_tool_iterations": 10,
    "max_history_messages": 50,
    "token_limit": 128000,
    "session_idle_timeout_secs": 1800,
    "compaction_keep_recent": 20,
    "message_timeout_secs": 300,
    "checkpoint_interval_secs": 30,
    "parallel_tools": false
  },

  "memory": {
    "backend": "sqlite",
    "auto_save": true,
    "embedding_provider": "openai",
    "embedding_model": "text-embedding-3-small",
    "embedding_dimensions": 1536,
    "vector_weight": 0.7,
    "keyword_weight": 0.3,
    "hygiene": {
      "enabled": true,
      "archive_after_days": 7,
      "purge_after_days": 30
    },
    "snapshot_enabled": false
  },

  "scheduler": {
    "heartbeat_interval_minutes": 5,
    "max_concurrent_jobs": 3
  },

  "autonomy": {
    "level": "supervised",
    "max_actions_per_hour": 50,
    "max_cost_per_day_cents": 500,
    "workspace_only": true
  },

  "permissions": {
    "auto_grant": ["read", "internal"],
    "require_approval": ["write", "network", "browser", "scheduler"],
    "deny": []
  },

  "identity": {
    "format": "aieos",
    "path": "/workspace/config/identity.json"
  },

  "observability": {
    "backend": "ring_buffer",
    "ring_buffer_size": 1000,
    "emit_to_event_bus": true
  },

  "cost": {
    "tracking_enabled": true,
    "daily_limit_cents": 500,
    "monthly_limit_cents": 10000,
    "warning_threshold_percent": 80
  },

  "workspace": {
    "auto_git_init": true,
    "auto_commit_on_goal_complete": true,
    "max_file_size_bytes": 10485760
  }
}
```

---

## 10. Security Model

### 10.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Agent escapes workspace sandbox | WASM linear memory isolation; host-enforced path validation |
| API key exfiltration from WASM memory | Keys stored in JS host only; never passed to WASM |
| Prompt injection escalates capabilities | Capability checks in host, not WASM; agent cannot self-elevate |
| Malicious tool execution | Permission model; user approval for non-read operations |
| Data exfiltration via network | All fetch requests mediated by host; domain allowlist |
| Cross-origin data leakage | OPFS is origin-scoped; workspace requires explicit user grant |
| Service worker hijacking | Standard browser CSP protections apply |
| Memory corruption | WASM linear memory is bounds-checked by browser engine |

### 10.2 Permission Hierarchy

```
Denied (never allowed)
  |
Requires Approval (user must confirm each time)
  |
Auto-Granted (allowed without prompt)
  |
Internal (always available: memory, logging, events)
```

### 10.3 API Key Management

- User enters API keys via configuration UI
- Keys stored encrypted in OPFS via Web Crypto API
- Host runtime decrypts keys at request time
- Keys are **never** passed across the WASM boundary
- Provider requests assembled in host JS, not in WASM

### 10.4 Workspace Isolation

- All file operations restricted to user-granted directory handle
- Path traversal attacks blocked by `FileSystemDirectoryHandle` API (browser-enforced)
- No access to system files, other origins, or browser storage of other sites
- Symlink following disabled (File System Access API does not support symlinks)

### 10.5 Network Isolation

- All network requests proxied through host `fetch()`
- Configurable domain allowlist
- No raw socket access (WASM limitation)
- No WebSocket to arbitrary hosts without user approval
- Localhost connections allowed (for local MCP servers / Ollama)

---

## 11. Performance Requirements

### 11.1 Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| WASM module load time | < 200ms | Time from `instantiate` to `clawser_init` return |
| Checkpoint serialize | < 50ms | Time to serialize full state to OPFS |
| Checkpoint restore | < 100ms | Time from OPFS read to agent ready |
| Memory recall (10K entries) | < 50ms | Hybrid search with embedding |
| Memory recall (100K entries) | < 200ms | Hybrid search with embedding |
| Idle memory footprint | < 32MB | After init, no active session |
| Active memory footprint | < 64MB | During agent loop with 50 messages |
| WASM binary size | < 2MB | gzip compressed `.wasm` file |
| Event bus latency | < 5ms | Emit to delivery in same context |
| Cross-context event latency | < 20ms | BroadcastChannel round-trip |

### 11.2 Optimization Strategies

- **WASM**:
  - `wasm-opt -Oz` for size optimization
  - `lto = true` in Cargo profile
  - `opt-level = "z"` for size over speed
  - `codegen-units = 1` for maximum optimization
  - Strip debug info in release builds

- **Memory**:
  - SQLite in-memory mode with periodic OPFS flush
  - LRU embedding cache (avoid redundant API calls)
  - Compaction of conversation history
  - Ring buffer for logs (bounded memory)

- **Network**:
  - Streaming responses (avoid buffering full response)
  - Connection keepalive for provider APIs
  - Request deduplication for embeddings

- **Filesystem**:
  - Batch OPFS writes (coalesce checkpoint operations)
  - Read-through cache for frequently accessed workspace files
  - Lazy directory listing (paginated)

---

## 12. Testing Strategy

### 12.1 Test Pyramid

```
                /\
               /  \
              / E2E \        (Browser integration, 10 scenario tests)
             /------\
            /  Integ  \      (Module integration, ~50 tests)
           /----------\
          /    Unit     \    (Pure Rust logic, ~500+ tests)
         /--------------\
```

### 12.2 Unit Tests (Rust, `#[cfg(test)]`)

All pure logic tested without browser or WASM:

**Provider Module**:
- Message formatting per provider (OpenAI, Anthropic, Gemini)
- Tool call extraction from streamed chunks
- Token counting accuracy
- Fallback chain logic (primary fails -> next in chain)
- Cost calculation from token usage
- Retry with exponential backoff timing

**Memory Module**:
- Store and recall entries
- FTS5 keyword search scoring
- Cosine similarity calculation
- Weighted merge of vector + keyword scores
- Category filtering
- Session scoping
- Hygiene (archive after N days, purge after M days)
- Snapshot export/import
- Edge cases: empty query, no embeddings, zero results

**Tool Module**:
- Parameter schema validation
- Tool result construction
- Permission checking
- File path validation (workspace scoping)
- Tool registry lookup

**Scheduler Module**:
- Cron expression parsing and next-run calculation
- One-shot timer scheduling
- Interval scheduling
- Timezone conversion
- Job lifecycle (active -> paused -> resumed -> deleted)
- Delivery mode filtering

**Session Module**:
- History append and retrieval
- Compaction trigger conditions
- Message counting and token estimation
- Idle timeout calculation
- Multi-turn tool call preservation during compaction

**Checkpoint Module**:
- Serialization roundtrip (serialize -> deserialize = identity)
- Partial state restoration
- Checkpoint metadata indexing
- Size estimation

**Config Module**:
- Schema validation
- Default value population
- Provider entry parsing
- Permission config validation
- Invalid config rejection

**Identity Module**:
- AIEOS v1.1 JSON parsing
- Markdown identity loading
- System prompt generation from identity

**Event Module**:
- Subscription and unsubscription
- Topic routing
- Payload serialization

**Agent Module**:
- State machine transitions
- Goal lifecycle (active -> completed/failed)
- Tool iteration limit enforcement
- Context window overflow handling

### 12.3 Integration Tests

Tests that verify module interactions:

**Agent + Provider**:
- Agent sends chat request, receives response with tool calls
- Agent handles streaming response chunks
- Agent retries on provider failure, falls back to secondary

**Agent + Memory**:
- Agent stores observation, later recalls it
- Agent compacts session, summary preserved in memory
- Agent hygiene cycle runs, old entries archived

**Agent + Tools**:
- Agent invokes file_read, gets workspace file content
- Agent invokes file_write, creates artifact
- Agent invokes web_fetch, gets HTTP response
- Agent invokes memory_store, entry persisted
- Agent invokes schedule_add, job registered

**Agent + Scheduler**:
- Scheduled job fires, agent processes prompt
- Heartbeat triggers, health check runs
- Job paused, does not fire; resumed, fires next

**Agent + Checkpoint**:
- Agent mid-loop, checkpoint saved
- Restore from checkpoint, agent continues at correct step
- Interrupted tool call re-executed after restore

**Agent + Git**:
- Agent commits workspace changes
- Agent reads git log
- Agent diffs uncommitted changes
- Goal completion triggers auto-commit

**Memory + Embeddings**:
- Store with embedding, recall by semantic similarity
- Store without embedding (noop provider), recall by keyword only
- Embedding cache prevents duplicate API calls

### 12.4 WASM Integration Tests

Tests that verify the WASM boundary:

**Syscall Bridge**:
- `host_log` delivers to console
- `host_now` returns valid timestamp
- `host_fetch` completes HTTP request and delivers callback
- `host_fs_read/write` operate on virtual filesystem
- `host_mcp_invoke` calls through to tool
- `host_crypto_random` produces valid random bytes
- `host_events_emit` delivers to subscribers

**WASM Lifecycle**:
- `clawser_init` with valid config returns success
- `clawser_init` with invalid config returns error code
- `clawser_step` advances agent state
- `clawser_on_message` enqueues user message
- `clawser_on_callback` delivers async result
- `clawser_on_stream_chunk` delivers incremental data
- `clawser_checkpoint` produces valid snapshot
- `clawser_restore` from snapshot returns to correct state
- `clawser_shutdown` releases all resources

**Memory Management**:
- `clawser_alloc` returns valid pointer
- `clawser_dealloc` frees without leak
- Large payloads across boundary handled correctly
- Out-of-memory handled gracefully

### 12.5 End-to-End Scenario Tests

Browser-based tests (headless Chrome via test harness):

Each scenario from Section 7 has a corresponding E2E test:

```
tests/
  e2e/
    scenario_01_health_investigation.rs
    scenario_02_code_refactoring.rs
    scenario_03_trip_planning.rs
    scenario_04_security_sentinel.rs
    scenario_05_writing_companion.rs
    scenario_06_skill_learning.rs
    scenario_07_research_lab.rs
    scenario_08_browsing_augmentation.rs
    scenario_09_digital_maintenance.rs
    scenario_10_corporate_lockdown.rs
```

Each E2E test:
1. Initializes WASM runtime with mock providers (deterministic responses)
2. Simulates user input sequence
3. Verifies workspace file creation
4. Verifies memory entries stored
5. Verifies checkpoint/restore cycle
6. Verifies scheduled jobs fire correctly
7. Verifies goal state transitions

### 12.6 Test Infrastructure

**Mock Providers**:

```rust
pub struct MockProvider {
    pub responses: VecDeque<ChatResponse>,
    pub requests: Vec<(Vec<ChatMessage>, Option<Vec<ToolSpec>>)>,
}

impl Provider for MockProvider {
    async fn chat(&self, messages, tools, opts) -> Result<ChatResponse> {
        self.requests.push((messages.to_vec(), tools.map(|t| t.to_vec())));
        self.responses.pop_front().ok_or(anyhow!("no more mock responses"))
    }
}
```

**Mock Filesystem**:

```rust
pub struct MockFs {
    files: HashMap<String, Vec<u8>>,
}

impl MockFs {
    pub fn with_file(mut self, path: &str, content: &[u8]) -> Self {
        self.files.insert(path.to_string(), content.to_vec());
        self
    }
}
```

**Mock Host**:

```rust
pub struct MockHost {
    pub fs: MockFs,
    pub provider: MockProvider,
    pub events: Vec<Event>,
    pub checkpoints: Vec<Vec<u8>>,
}
```

**Test Utilities**:

```rust
// Create test agent with defaults
pub fn test_agent() -> AgentBuilder { ... }

// Assert memory contains entry matching predicate
pub fn assert_memory_contains<F: Fn(&MemoryEntry) -> bool>(memory: &dyn Memory, pred: F) { ... }

// Assert workspace file exists with content matching
pub fn assert_workspace_file(fs: &MockFs, path: &str, contains: &str) { ... }

// Assert goal in expected state
pub fn assert_goal_status(agent: &Agent, goal_id: &str, status: GoalStatus) { ... }

// Advance agent through N steps
pub async fn advance_agent(agent: &mut Agent, steps: usize) { ... }

// Simulate user message and get response
pub async fn send_message(agent: &mut Agent, msg: &str) -> ChatResponse { ... }
```

### 12.7 Test Execution

```bash
# Run all unit tests
cargo test --lib

# Run integration tests
cargo test --test '*'

# Run specific scenario
cargo test --test scenario_01

# Run with WASM target (requires wasm-pack)
wasm-pack test --headless --chrome

# Run benchmarks
cargo bench

# Coverage report
cargo llvm-cov --html
```

---

## 13. Build & Distribution

### 13.1 Crate Structure

```
clawser/
  Cargo.toml              # Workspace root
  crates/
    clawser-core/          # Core agent logic (lib, wasm32-wasi target)
      Cargo.toml
      src/
        lib.rs
        agent/
        providers/
        memory/
        tools/
        scheduler/
        session/
        identity/
        config/
        checkpoint/
        events/
        git/
        observe/
        syscall/
    clawser-wasm/          # WASM entry point (cdylib target)
      Cargo.toml
      src/
        lib.rs             # extern "C" exports
        host.rs            # Host syscall imports
        callback.rs        # Async callback management
    clawser-host/          # JS host runtime (TypeScript)
      package.json
      src/
        runtime.ts         # WASM instantiation and syscall impl
        wasi-shim.ts       # WASI polyfill
        filesystem.ts      # Virtual FS (OPFS + File System Access)
        worker.ts          # Shared Worker entry
        service-worker.ts  # Service Worker entry
        events.ts          # BroadcastChannel event bus
        permissions.ts     # Capability permission manager
        providers/
          chrome-ai.ts     # Chrome Built-in AI bridge
        mcp/
          bridge.ts        # MCP tool discovery and invocation
    clawser-ui/            # UI shell (TypeScript + HTML/CSS)
      package.json
      src/
        index.html
        app.ts             # Main UI entry
        command-palette.ts # Goal input
        workspace-view.ts  # File browser
        log-viewer.ts      # Agent activity log
        config-editor.ts   # Settings UI
        styles.css
  tests/
    unit/                  # Additional unit tests
    integration/           # Cross-module tests
    e2e/                   # Browser scenario tests
    fixtures/              # Test data
  docs/
    architecture.md
    syscall-reference.md
    provider-guide.md
    deployment-guide.md
```

### 13.2 Build Pipeline

```bash
# 1. Build Rust to WASM
cargo build --target wasm32-wasip1 --release -p clawser-wasm
wasm-opt -Oz target/wasm32-wasip1/release/clawser_wasm.wasm -o dist/clawser.wasm

# 2. Build JS host runtime
cd crates/clawser-host && npm run build

# 3. Build UI shell
cd crates/clawser-ui && npm run build

# 4. Package for distribution
# Output: dist/
#   clawser.wasm          (< 2MB gzip)
#   host-runtime.js       (< 100KB gzip)
#   service-worker.js
#   shared-worker.js
#   index.html
#   app.js
#   styles.css
#   manifest.json          (PWA manifest)
```

### 13.3 Distribution Options

| Method | Description |
|--------|-------------|
| **Static hosting** | Deploy `dist/` to any CDN/static host |
| **PWA** | Installable via browser (Add to Home Screen) |
| **NPM package** | `@clawser/runtime` for embedding in other apps |
| **Single HTML** | Bundled single-file for offline use |

### 13.4 Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| WASM | 57+ | 52+ | 11+ | 16+ |
| OPFS | 86+ | 111+ | 15.2+ | 86+ |
| File System Access | 86+ | No | No | 86+ |
| Service Worker | 40+ | 44+ | 11.1+ | 17+ |
| Shared Worker | 4+ | 29+ | 16+ | 79+ |
| BroadcastChannel | 54+ | 38+ | 15.4+ | 79+ |
| Web Locks | 69+ | 96+ | 15.4+ | 79+ |
| Chrome AI | 131+ | No | No | No |

**Degradation Strategy**:
- No File System Access → OPFS-only workspace (no user-visible directory)
- No Shared Worker → Single-tab mode
- No Chrome AI → Remote providers only
- No Service Worker → No background execution (tab must stay open)

---

## 14. Milestones

### Phase 1: Foundation (Weeks 1-4)

**Goal**: Core runtime compiles to WASM and executes basic agent loop.

- [ ] Cargo workspace setup with `clawser-core` and `clawser-wasm` crates
- [ ] Basic data types: ChatMessage, ChatResponse, ToolCall, ToolResult
- [ ] Provider trait + MockProvider for testing
- [ ] Agent state machine (IDLE -> THINK -> PARSE -> RESPOND)
- [ ] WASM exports: `init`, `step`, `on_message`, `on_callback`
- [ ] Host imports: `log`, `now`, `fetch`
- [ ] JS host runtime: WASM instantiation + basic syscalls
- [ ] Config loading from JSON
- [ ] Unit tests: agent loop, provider formatting, config parsing
- [ ] Integration test: agent + mock provider completes one exchange

### Phase 2: Memory & Persistence (Weeks 5-8)

**Goal**: Agent has persistent memory and workspace access.

- [ ] Memory trait + SQLite backend (compiled to WASM via sql.js or similar)
- [ ] FTS5 virtual table for keyword search
- [ ] Cosine similarity for vector search
- [ ] Weighted merge algorithm
- [ ] Embedding provider trait + noop implementation
- [ ] Memory tools: store, recall, forget
- [ ] OPFS integration for memory DB persistence
- [ ] File System Access API bridge for workspace
- [ ] File tools: read, write, list, delete
- [ ] Checkpoint system: serialize, restore
- [ ] Unit tests: memory CRUD, search scoring, checkpoint roundtrip
- [ ] Integration test: agent stores memory, survives checkpoint/restore

### Phase 3: Providers & Streaming (Weeks 9-12)

**Goal**: Real AI providers with streaming support.

- [ ] OpenAI provider implementation
- [ ] Anthropic provider implementation
- [ ] Chrome Built-in AI provider (via host bridge)
- [ ] Ollama provider implementation
- [ ] OpenRouter provider implementation
- [ ] SSE stream parsing
- [ ] Streaming callback delivery to WASM
- [ ] Tool call extraction from streamed responses
- [ ] Reliability layer: retries, fallback chain
- [ ] Cost tracking
- [ ] Model routing via hints
- [ ] Embedding provider: OpenAI, Chrome AI
- [ ] Unit tests: each provider's request/response formatting
- [ ] Integration test: agent with real provider (Ollama local)

### Phase 4: Tools & MCP (Weeks 13-16)

**Goal**: Full tool system with MCP protocol support.

- [ ] Tool trait + built-in tool implementations
- [ ] Permission system: check, request, grant/deny
- [ ] Autonomy levels: read-only, supervised, full
- [ ] Git integration (isomorphic-git via host)
- [ ] Git tools: init, commit, log, diff
- [ ] MCP bridge: tool discovery, invocation
- [ ] Web search tool
- [ ] Browser tools: navigate, screenshot
- [ ] Delegate tool (sub-agent)
- [ ] Notification tool
- [ ] Unit tests: tool execution, permission enforcement
- [ ] Integration test: agent uses tools to create workspace artifacts

### Phase 5: Scheduling & Background (Weeks 17-20)

**Goal**: Agent operates autonomously with scheduled tasks.

- [ ] Scheduler: cron, one-shot, interval
- [ ] Heartbeat system
- [ ] Service Worker daemon
- [ ] Shared Worker for multi-tab
- [ ] BroadcastChannel event bus
- [ ] Web Locks for concurrency
- [ ] Background notification delivery
- [ ] Session management: compaction, idle timeout
- [ ] Unit tests: cron parsing, scheduler logic
- [ ] Integration test: scheduled job fires and agent processes it

### Phase 6: Identity & UI (Weeks 21-24)

**Goal**: Full UI shell and agent persona support.

- [ ] AIEOS identity loading
- [ ] OpenClaw markdown identity loading
- [ ] Command palette UI
- [ ] Workspace file browser UI
- [ ] Activity log viewer UI
- [ ] Configuration editor UI
- [ ] PWA manifest and service worker registration
- [ ] Goal management UI (active, completed, paused)
- [ ] Cost dashboard
- [ ] Unit tests: identity parsing
- [ ] E2E tests: all 10 scenarios

### Phase 7: Polish & Distribution (Weeks 25-28)

**Goal**: Production-ready release.

- [ ] Performance optimization (binary size, memory, latency)
- [ ] Browser compatibility testing
- [ ] Degradation paths for missing APIs
- [ ] Security audit
- [ ] Documentation
- [ ] NPM package publication
- [ ] Static hosting deployment
- [ ] Single-file distribution build

---

## Appendix A: Glossary

| Term | Definition |
|------|-----------|
| **AIEOS** | AI Entity Operating System - portable identity format |
| **BroadcastChannel** | Browser API for cross-context messaging |
| **Checkpoint** | Serialized snapshot of agent state for crash recovery |
| **Chrome AI** | Browser-integrated on-device LLM (Gemini Nano) |
| **Compaction** | Summarizing old messages to fit context window |
| **FTS5** | SQLite Full-Text Search extension version 5 |
| **Goal** | A user-defined objective the agent works toward |
| **Heartbeat** | Periodic wake-up for health checks and job evaluation |
| **MCP** | Model Context Protocol - tool definition standard |
| **OPFS** | Origin Private File System - fast browser-only storage |
| **Provider** | AI model service (OpenAI, Anthropic, etc.) |
| **Shared Worker** | Browser thread shared across tabs (single brain) |
| **Service Worker** | Background browser thread (daemon) |
| **Syscall** | Function call from WASM to JS host |
| **Tool** | Capability the agent can invoke (file read, web fetch, etc.) |
| **WASI** | WebAssembly System Interface |

## Appendix B: Feature Provenance

Features drawn from analysis of NullClaw (Zig) and ZeroClaw (Rust) reference implementations:

| Feature Area | NullClaw | ZeroClaw | Clawser (Browser) |
|-------------|----------|----------|-------------------|
| AI Providers | 22+ | 28+ | 16+ (browser-viable subset) |
| Messaging Channels | 13+ | 14 | 0 (not applicable; browser IS the channel) |
| Memory | SQLite + FTS5 | SQLite + FTS5 + PostgreSQL | SQLite + FTS5 (via WASM) |
| Tools | 18+ | 20+ | 20 (adapted for browser APIs) |
| Hardware | Arduino, RPi, STM32 | Arduino, RPi, STM32, ESP32 | 0 (not applicable in browser) |
| Security | ChaCha20, Landlock, Firejail | ChaCha20, Landlock, Docker | Web Crypto, WASM sandbox |
| Sandbox | Kernel-level (Landlock, etc.) | Docker, Landlock | Browser sandbox (inherent) |
| Identity | AIEOS v1.1 | AIEOS v1.1 | AIEOS v1.1 |
| Scheduling | Cron + timers | Cron + timers | Cron + timers (via host) |
| Observability | Noop, Log, File | Noop, Log, Prometheus, OTLP | Noop, Console, Ring Buffer |
| Gateway/Webhooks | HTTP server | Axum HTTP server | Not applicable (no server) |
| Git | Basic | Basic | Isomorphic-git (full) |
| Background | Daemon process | Daemon process | Service Worker |
| Multi-instance | N/A | N/A | Shared Worker (multi-tab) |
| Checkpointing | N/A | N/A | OPFS-backed state serialization |
| Chrome AI | N/A | N/A | Native integration |
| WASM | Optional target | N/A | Primary target |

## Appendix C: Non-Goals (Explicit Exclusions)

The following features from NullClaw/ZeroClaw are **intentionally excluded** from Clawser:

1. **Messaging channels** (Telegram, Discord, Slack, etc.) - The browser IS the interface
2. **Hardware peripherals** (GPIO, I2C, SPI, serial) - Not accessible from browser
3. **OS-level sandboxing** (Landlock, Firejail, Docker) - Browser provides isolation
4. **HTTP gateway server** - Browser cannot serve HTTP
5. **System service management** - No OS-level daemon support
6. **Native shell execution** - Browser cannot spawn processes
7. **iMessage/Email integration** - No direct protocol access from browser
8. **PostgreSQL backend** - Not available in browser (SQLite via WASM only)
9. **Prometheus/OTLP export** - No server-side telemetry collection
10. **SOCKS proxy support** - Browser manages its own networking
