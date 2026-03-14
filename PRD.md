# Clawser: Browser-Native Agent Operating System

## Product Requirements Document (PRD)

**Version**: 2.0.0
**Date**: 2026-03-03
**Status**: Implemented

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

Clawser is a browser-native AI agent workspace. It runs entirely in the browser with zero server dependencies, no bundler, and no build step. Pure ES modules loaded directly from the `web/` directory give users a complete agent runtime with persistent memory, goal tracking, ~100 browser tools, a virtual shell, scheduled tasks, 38+ LLM backends, peer-to-peer mesh networking, multi-channel communication, hardware peripheral access, and a microkernel for OS-like primitives.

Unlike server-hosted agent frameworks, Clawser runs entirely client-side. The browser IS the operating system: OPFS provides the filesystem, Fetch provides networking, the DOM provides the UI, Web Workers provide sandboxing, localStorage provides configuration, and IndexedDB provides structured storage.

This is not a chatbot. It is a persistent cognitive process attached to a human, capable of pursuing multi-day goals, maintaining institutional memory, delegating to sub-agents, operating autonomously within user-granted permission boundaries, and connecting to other agents via a distributed mesh network.

### Design Principles

- **Browser as OS**: Let the browser enforce limits rather than fighting them
- **Zero Dependencies**: No npm runtime deps; external libs loaded via CDN
- **Portable over Perfect**: Cross-platform capability over native feature parity
- **Persistent over Stateless**: Workspace artifacts over disposable chat logs
- **Capability-based Security**: Permission model, never raw OS access
- **Event-driven Execution**: No blocking calls; all operations async
- **Pure ES Modules**: No bundler, no transpiler, no build step

---

## 2. Vision & Goals

### What Clawser Is

A micro-operating-system inside the browser whose primary process is an AI agent. The agent has:

- Real persistent memory with hybrid BM25 + vector search
- A versioned workspace with OPFS file artifacts
- ~100 tool execution capabilities (browser-native + MCP protocol)
- Background autonomy (service worker daemon mode)
- Multi-tab presence (shared worker coordination)
- Crash recovery (checkpoint/resume from OPFS + IndexedDB)
- P2P mesh networking (distributed agent ecosystem)
- Multi-channel I/O (Discord, Slack, Telegram, IRC, Matrix, Email)
- Hardware peripheral access (Serial, Bluetooth, USB)
- Agent Skills standard (SKILL.md, agentskills.io)
- Virtual shell with 59+ builtins, pipes, and jq
- Sub-agent delegation with concurrency limits
- 38+ LLM provider backends across 3 tiers
- Cost tracking with daily and monthly limits

### What Clawser Is Not

- A chat UI framework
- A cloud-hosted agent service
- A browser extension (though extensions can provide MCP tools)
- A full native OS replacement
- An npm package (though the kernel, netway, and andbox are)

### Success Criteria

1. Agent persists across tab closures and browser restarts
2. Agent can pursue multi-step goals spanning hours/days
3. Agent workspace is user-visible and file-browsable
4. Agent runs on locked-down corporate machines (no install required)
5. Agent operates on Chromebooks with full capability
6. 38+ LLM backends available with zero configuration
7. Memory footprint under 64MB for core runtime
8. P2P mesh connects agents across browser instances
9. 1680+ tests passing across all subsystems

---

## 3. Target Users

### Primary

| Persona | Description | Key Need |
|---------|-------------|----------|
| **Knowledge Worker** | Researchers, analysts with evolving projects | Persistent memory across sessions |
| **Developer** | Programmers wanting codebase-aware assistants | Tool execution + workspace files |
| **Student** | Learners in skill-building phases | Multi-provider access + memory |
| **Planner** | Trip/event/project coordinators | Long-running goal management |
| **Team Lead** | Coordinates distributed agent teams | Mesh networking + delegation |

### Environment Profiles

| Environment | Capability Level | Notes |
|-------------|-----------------|-------|
| Chrome Desktop | Full | All APIs available including Chrome AI |
| Chromebook | Full | Native deployment target |
| Corporate Lockdown | Full (PWA) | No install friction |
| Firefox/Safari | Degraded | No OPFS, no Chrome AI, limited SharedWorker |
| Mobile Chrome | Partial | Touch-optimized, reduced tool set |

---

## 4. Architecture Overview

### Module Graph

```
index.html (SPA entry point)
  └─ clawser-app.js (orchestrator)
       ├─ ClawserAgent (clawser-agent.js)
       │    ├─ EventLog — append-only JSONL in OPFS
       │    ├─ HookPipeline — 6 lifecycle interception points
       │    ├─ AutonomyController — readonly / supervised / full
       │    ├─ SemanticMemory — BM25 + cosine hybrid search
       │    └─ CostLedger — per-model/provider cost tracking
       │
       ├─ Providers (clawser-providers.js)
       │    ├─ Tier 1: Echo, Chrome AI, OpenAI, Anthropic
       │    ├─ Tier 2: Groq, OpenRouter, Together, Fireworks, Mistral,
       │    │          DeepSeek, xAI, Perplexity, Ollama, LM Studio
       │    └─ Tier 3: ai.matey (24+ backends via CDN)
       │
       ├─ Tools (clawser-tools.js) — ~100 browser tools
       │    ├─ Permission system (auto/approve/denied)
       │    ├─ Domain allowlist (FetchTool)
       │    └─ File size limits (FsWriteTool)
       │
       ├─ Shell (clawser-shell.js) — virtual terminal
       │    ├─ 59+ builtins (ls, cat, grep, jq, curl, etc.)
       │    └─ Pipes, redirects, logic operators
       │
       ├─ Skills (clawser-skills.js)
       │    └─ SKILL.md parser, OPFS storage, slash-command invocation
       │
       ├─ Mesh (clawser-mesh-*.js) — P2P networking
       │    ├─ Identity (Ed25519, DID, vault-encrypted)
       │    ├─ Transport (WebSocket, relay, gateway)
       │    ├─ Sync (CRDT, delta-sync, streams)
       │    ├─ Apps (marketplace, payments, quotas)
       │    └─ Ops (audit, consensus, scheduler, swarm)
       │
       ├─ Channels (clawser-channel-*.js) — multi-platform I/O
       │    └─ Discord, Slack, Telegram, IRC, Matrix, Email, Relay
       │
       ├─ Kernel (packages/kernel/) — OS-like primitives
       │    ├─ ResourceTable, ByteStream, Clock, RNG
       │    ├─ ServiceRegistry, Tracer, Signal, Caps
       │    └─ Tenant isolation, capability enforcement
       │
       └─ UI — clawser-ui-*.js (chat, panels, config, goals, files)
```

### Storage Architecture

| Storage Layer | Technology | Purpose |
|---------------|------------|---------|
| Configuration | localStorage | API keys, preferences, workspace list |
| File System | OPFS | Agent workspace files, skills, checkpoints |
| Structured Data | IndexedDB | Server routes, daemon checkpoints |
| Secrets | Web Crypto AES-GCM | Encrypted API key vault |
| Cache | In-memory LRU | Response cache, memory recall cache |

### Execution Contexts

| Context | Role | Files |
|---------|------|-------|
| Main Thread | UI rendering, agent orchestration | clawser-app.js, clawser-ui-*.js |
| Service Worker | Background execution, daemon mode, cache | sw.js |
| Shared Worker | Multi-tab coordination, single brain | shared-worker.js |
| Worker Sandbox | Isolated code execution (Codex/andbox) | packages/andbox/ |

---

## 5. Core Modules

### 5.1 Agent Core (`clawser-agent.js` — 3,765 LOC)

The central agent runtime providing:

- **ClawserAgent**: Async run loop with streaming (`run()`, `runStream()`)
- **EventLog**: Append-only JSONL event persistence in OPFS
- **HookPipeline**: 6 lifecycle points (beforeInbound, beforeToolCall, beforeOutbound, transformResponse, onSessionStart, onSessionEnd)
- **AutonomyController**: 3 levels (readonly/supervised/full), per-hour rate limits, daily + monthly cost limits, time-of-day restrictions, PolicyEngine integration
- **Context Compaction**: Auto-summarizes old messages when context exceeds threshold
- **Idle Timeout**: Auto-compacts on resume after configurable idle period
- **Parallel Tool Execution**: Read-only tools run concurrently via `Promise.allSettled()`

Key API:
```js
const agent = await ClawserAgent.create({ browserTools, providers, autonomy, costLedger });
agent.init({ maxToolIterations: 20, idleTimeoutMs: 1800000 });
agent.addMessage('user', 'Research quantum computing advances');
const result = await agent.run(); // or async for (const chunk of agent.runStream()) {}
```

### 5.2 Provider System (`clawser-providers.js` — 1,868 LOC)

Three-tier LLM provider architecture:

**Tier 1 — Built-in Providers** (zero external deps):
| Provider | Streaming | Native Tools | Vision | Default Model |
|----------|-----------|--------------|--------|---------------|
| Echo | No | No | No | echo |
| Chrome AI | Yes | No | No | (Gemini Nano) |
| OpenAI | Yes | Yes | Yes | gpt-4o-mini |
| Anthropic | Yes | Yes | Yes | claude-sonnet-4-6 |

**Tier 2 — OpenAI-Compatible** (configurable base URL):
Groq, OpenRouter, Together AI, Fireworks, Mistral, DeepSeek, xAI (Grok), Perplexity, Ollama, LM Studio

**Tier 3 — ai.matey** (CDN lazy-load):
24+ backends via user's npm package, Bridge pattern

Additional components:
- **ResponseCache**: TTL-based LRU cache for identical requests
- **CostLedger**: Per-call cost recording, grouped by model/provider
- **estimateCost()**: Token-based cost estimation from MODEL_PRICING table
- **SSE Readers**: `readSSE()` (OpenAI format), `readAnthropicSSE()` (event+data pairs)
- **Vision/Multimodal**: Content array support (`text` + `image_url` parts) for OpenAI and Anthropic

### 5.3 Tool System (`clawser-tools.js` — 1,729 LOC)

~100 browser-native tools organized by permission level:

| Permission | Auto-Approval | Example Tools |
|------------|---------------|---------------|
| `internal` | Always | agent_memory_search, agent_memory_store |
| `read` | Always | browser_fs_read, browser_fs_list |
| `write` | Requires approval | browser_fs_write, browser_fs_delete |
| `network` | Requires approval | browser_fetch, browser_web_search |
| `browser` | Requires approval | browser_dom_query, browser_screenshot |

**BrowserTool** base class defines: `name`, `description`, `parameters`, `permission`, `execute()` → `{success, output, error?}`

**BrowserToolRegistry**: Registration, lookup, permission-checked execution, `allSpecs()` generator for tool descriptions.

**WorkspaceFs**: OPFS filesystem abstraction with path resolution, directory operations, and file size limits.

Additional tool modules:
- `clawser-extension-tools.js` — 32 Chrome Extension tools (real browser control)
- `clawser-chrome-ai-tools.js` — Chrome AI Summarizer/Writer/Rewriter
- `clawser-server-tools.js` — Virtual HTTP server management
- `clawser-slack-tools.js`, `clawser-google-tools.js`, `clawser-notion-tools.js`, `clawser-linear-tools.js` — Platform-specific tools
- `clawser-mesh-tools.js` — Mesh networking tools
- `clawser-netway-tools.js` — Kernel networking tools

### 5.4 Virtual Shell (`clawser-shell.js` + `clawser-shell-builtins.js` — 3,376 LOC)

Full virtual terminal with:
- **Tokenizer + Parser**: Handles quotes, escapes, pipes, redirects, logic ops (`&&`, `||`, `;`)
- **59+ Builtins**: ls, cat, head, tail, grep, wc, sort, uniq, echo, pwd, cd, mkdir, rm, cp, mv, touch, find, tree, xxd, base64, sha256, date, env, export, alias, history, clear, help, jq, curl, wget, rev, tr, fold, seq, yes, nl, cut, paste, tee, xargs
- **Pipe System**: Unix-style `cmd1 | cmd2 | cmd3`
- **Command Registry**: Extensible with custom commands
- **jq Integration**: Full jq query support on JSON data
- **Shell State**: cwd, env, aliases, history, exit codes

### 5.5 Memory System (`clawser-memory.js` — 903 LOC)

Hybrid search combining:
- **BM25 Keyword Search**: TF-IDF scoring with configurable k1/b parameters
- **Cosine Vector Search**: Embedding-based similarity (4 provider backends)
- **Memory Categories**: `core`, `learned`, `user`, `context`
- **Memory Entry**: `{id, key, content, category, timestamp}`
- **Memory Hygiene**: Deduplication, age-based purging, workspace-scoped

### 5.6 Skills System (`clawser-skills.js` — 2,016 LOC)

Implements the Agent Skills open standard (agentskills.io):
- **SKILL.md Format**: YAML frontmatter + markdown body
- **SkillParser**: Extracts metadata, triggers, and body
- **SkillStorage**: OPFS-based (global + per-workspace with override semantics)
- **SkillRegistry**: Activation/deactivation, slash-command invocation (`/skill-name args`)
- **System Prompt Pipeline**: basePrompt → memories → goals → skillMetadata → activeSkillBodies

### 5.7 Mesh Networking (31 files — 20,000+ LOC)

Full P2P agent ecosystem:

**Identity & Crypto** (5 files):
- Ed25519 keypairs with vault-encrypted storage
- DID (Decentralized Identifier) support
- Keyring management for multiple identities
- Trust relationships and delegation chains
- Capability-based access control (CBAC)

**Transport & Connectivity** (7 files):
- WebSocket transport with reconnection
- Relay servers for NAT traversal
- Gateway for external network access
- DHT + mDNS peer discovery
- DNS-like naming service

**Synchronization** (4 files):
- CRDT state replication (LWWMap, ORSet)
- Delta-based sync (bandwidth-efficient)
- Reliable streaming message delivery
- Data migration and reconciliation

**Applications & Services** (5 files):
- Decentralized app ecosystem (manifest, install, RPC, pub/sub)
- Distributed marketplace (list, install, rate)
- Payment/compensation system
- Resource quotas (bandwidth, storage, computation)
- Mesh-wide chat and messaging

**Operations** (6 files):
- Audit logging for compliance
- Raft-like consensus protocol
- Distributed task scheduler
- Resource accounting and load balancing
- Swarm intelligence and collective behavior
- Topology and state visualizations

### 5.8 Channels (`clawser-channel-*.js` — 1,814 LOC + `clawser-channels.js` — 550 LOC)

Multi-platform communication:

| Channel | Protocol | Features |
|---------|----------|----------|
| Discord | WebSocket + REST | Guild/channel selection, message threading |
| Slack | WebSocket + REST | Workspace/channel selection, app tokens |
| Telegram | Long-polling | Bot API, inline commands |
| IRC | WebSocket | Server/channel selection, nick management |
| Matrix | REST | Room management, E2E encryption support |
| Email | IMAP/SMTP | Inbox monitoring, auto-reply |
| Relay | Webhook | Custom channel integration |

Normalized `InboundMessage` format across all channels with allowlist configuration.

### 5.9 Kernel (`packages/kernel/` — 2,862 LOC)

Browser microkernel providing OS-like primitives:
- **ResourceTable**: Handle-based resource management (`res_N`)
- **ByteStream**: Duck-typed stream protocol with `createPipe`/`compose`/`pipe`
- **Clock**: Fixed-time mode for deterministic testing
- **RNG**: Seeded xorshift128+ for reproducible randomness
- **ServiceRegistry**: `svc://` URI scheme with `onLookupMiss`
- **Tracer**: Ring buffer with AsyncIterable interface
- **Signal**: TERM/INT/HUP + AbortSignal integration
- **Caps**: Capability enforcement (NET, FS, CLOCK, RNG, IPC, STDIO, TRACE, CHAOS, ENV, SIGNAL)
- **Kernel Facade**: `createTenant()` → isolated environment with capabilities

### 5.10 Agent Features

**Goals** (`clawser-goals.js` — 815 LOC): Sub-goal trees, progress logging, cascading completion, artifact attachment

**Delegation** (`clawser-delegate.js` — 625 LOC): Sub-agent spawning, concurrency limits, result aggregation

**Daemon Mode** (`clawser-daemon.js` — 1,178 LOC): Background execution, multi-tab coordination, checkpoint/resume, service worker relay

**Browser Automation** (`clawser-browser-auto.js` — 917 LOC): Tab management, click/fill/screenshot, accessibility tree traversal, selector strategies

**Routines** (`clawser-routines.js` — 897 LOC): Event-driven automation with cron + event + webhook triggers, guardrails

**Self-Repair** (`clawser-self-repair.js` — 457 LOC): Stuck detection, recovery strategies (compact, fallback provider, downgrade model, pause), watchdog

**Identity** (`clawser-identity.js` — 485 LOC): AIEOS v1.1 agent identity with plain/structured/openclaw formats

**Safety** (`clawser-safety.js` — 271 LOC): Input sanitizer, tool call validator, leak detector pipeline

**Git Integration** (`clawser-git.js` — 935 LOC): Auto-commit, experiment branching, episodic memory queries

### 5.11 Server System (`clawser-server.js` — 724 LOC)

Virtual HTTP servers within the browser:
- Route storage in IndexedDB
- Handler dispatch with pattern matching
- Service worker relay for cross-origin serving
- Gateway server for remote access
- Tunnel/proxy support

### 5.12 Integrations

**OAuth** (`clawser-oauth.js` — 543 LOC): Google, GitHub, Notion, Slack, Linear OAuth flows

**Platform Tools**: Google Workspace (Sheets, Docs, Drive, Gmail), Notion, Linear, Slack, GitHub

**Hardware** (`clawser-hardware.js` — 1,128 LOC): Web Serial API, Bluetooth, USB peripherals with discovery and management

### 5.13 Sandbox System (`clawser-sandbox.js` — 614 LOC)

WASM/Worker tool sandbox:
- Tier-based isolation (none, worker, wasm)
- Capability gates per sandbox
- Fuel metering for compute limits
- Dynamic tool creation via ToolBuilder

---

## 6. Feature Specifications

### 6.1 Agent Loop

The agent operates in a decide-execute cycle:

1. **Receive** user message → add to history
2. **Idle Check** → auto-compact if resuming after idle timeout
3. **Autonomy Check** → verify rate/cost/time-of-day limits
4. **Hook Pipeline** → run `beforeInbound` hooks, sanitize input
5. **Build Request** → system prompt + history + tool specs + memory context
6. **LLM Call** → route to active provider (streaming or batch)
7. **Cost Recording** → update AutonomyController + CostLedger
8. **Tool Execution** → parallel for read-only, sequential for write tools
9. **Hook Pipeline** → run `beforeOutbound` hooks
10. **Safety Scan** → check tool outputs for leaked secrets
11. **Context Management** → compact if over threshold
12. **Repeat** from step 5 until no more tool calls or iteration limit reached

Streaming variant (`runStream()`) yields chunks: `{type: 'text'|'tool_start'|'tool_delta'|'done'|'error'}`

### 6.2 Multi-Tab Coordination

- SharedWorker maintains single agent instance
- UI tabs are rendering-only clients
- State synchronization via BroadcastChannel
- Leader election for daemon mode
- Graceful handoff on tab close

### 6.3 Background Execution (Daemon Mode)

- Service Worker maintains heartbeat
- Checkpoint/resume on browser restart
- Multi-phase lifecycle: BOOT → IDLE → ACTIVE → CHECKPOINT → SHUTDOWN
- Remote UI for monitoring daemon state

### 6.4 Workspace Management

- Multiple independent workspaces with separate history, memory, goals, config
- Workspace list in localStorage (`clawser_workspaces`)
- Per-workspace persistence: memories, config, tool permissions, skills, OPFS directory
- Workspace switching with full agent re-initialization
- Memory hygiene on workspace init

### 6.5 Chrome Built-in AI Integration

- Chrome AI (Gemini Nano) via LanguageModel API (Chrome 138+)
- Specialized tools: `chrome_ai_write`, `chrome_ai_rewrite`, `chrome_ai_summarize`
- Fallback chain: `self.ai.languageModel` for Chrome 131-137
- Session management with 5-minute timeout and LRU eviction

### 6.6 Vision / Multimodal Input

- Content part arrays: `{type:'text', text}` + `{type:'image_url', image_url:{url}}`
- OpenAI format: direct pass-through of image_url parts
- Anthropic format: auto-conversion to `{type:'image', source:{type:'base64'|'url', ...}}`
- Cross-format normalization: Anthropic-style images convert to data URIs for OpenAI
- `supportsVision` flag on provider classes

### 6.7 Parallel Tool Execution

- Read-only tools (`internal`, `read` permission) execute concurrently via `Promise.allSettled()`
- Write/network/browser tools execute sequentially to preserve ordering guarantees
- Mixed batches: contiguous read-only runs are parallelized, write tools act as barriers
- Single tool calls bypass parallelization overhead

### 6.8 Cost Management

- **Daily Limits**: `maxCostPerDayCents` with auto-reset at midnight
- **Monthly Limits**: `maxCostPerMonthCents` with auto-reset on month boundary
- **CostLedger**: Per-call recording with model, provider, token counts, USD cost
- **Cost Meter UI**: Visual progress bar with warning (>50%) and danger (>80%) states
- **Rate Limits**: `maxActionsPerHour` with hourly reset

---

## 7. User Scenarios

### Scenario 1: Multi-Source Research

The agent receives a research topic, uses web search and fetch tools to gather information from multiple sources, stores key findings in semantic memory, and produces a synthesized report. Memory persists across sessions, allowing follow-up questions days later.

### Scenario 2: Long-Running Code Analysis

A developer points the agent at a codebase (via OPFS uploads or fetch). The agent reads files, builds an internal understanding, answers questions about architecture, suggests refactorings, and tracks its findings as goals with sub-tasks.

### Scenario 3: Multi-Channel Communication Hub

The agent connects to Discord, Slack, and Email simultaneously. It receives messages across channels, applies allowlist filtering, routes to the appropriate handler, and maintains conversation context per channel.

### Scenario 4: Distributed Agent Team

Multiple Clawser instances connect via mesh networking. They share state via CRDTs, delegate tasks to specialized peers, reach consensus on decisions, and coordinate via the distributed scheduler.

### Scenario 5: Hardware-Integrated Assistant

The agent connects to serial peripherals (Arduino, sensors) via Web Serial API, reads sensor data, processes it, and logs results. Bluetooth and USB peripherals are also supported.

### Scenario 6: Autonomous Background Worker

In daemon mode, the agent runs scheduled tasks (cron jobs), monitors channels for incoming messages, executes routine maintenance, and checkpoints state periodically for crash recovery.

### Scenario 7: Skill-Enhanced Specialist

A user installs domain-specific skills (SKILL.md files) that give the agent specialized knowledge and behaviors. Skills activate via slash commands or automatic detection. Multiple skills compose in the system prompt pipeline.

### Scenario 8: Corporate PWA Deployment

On a locked-down corporate machine, a user opens the PWA. No installation required. The agent runs with full capability, stores data locally, and never sends data to unauthorized servers (domain allowlist enforced).

### Scenario 9: Sub-Agent Delegation

A complex task is decomposed: the main agent delegates sub-tasks to specialized sub-agents, each with their own provider and tool access. Results are aggregated and the main agent produces the final output.

### Scenario 10: Cost-Controlled Production Use

An organization sets daily ($5) and monthly ($50) cost limits. The agent operates freely within limits, blocks when exceeded, and reports cost breakdowns by model and provider via the CostLedger.

---

## 8. API Surface

### 8.1 Agent Core API

```js
// Lifecycle
const agent = await ClawserAgent.create(opts);
agent.init(config);
agent.destroy();

// Messaging
agent.addMessage(role, content);
agent.setSystemPrompt(prompt);
const result = await agent.run();
async for (const chunk of agent.runStream(options)) { }

// Memory
agent.memorize(key, content, category);
agent.recall(query, options);
agent.forget(id);

// Goals
agent.addGoal(description);
agent.updateGoal(id, status);

// Scheduling
agent.addSchedulerJob(type, schedule, prompt);
agent.listSchedulerJobs();
agent.removeSchedulerJob(id);

// State
agent.getIdleTime();
agent.estimateHistoryTokens();
await agent.compactContext(opts);
agent.applyAutonomyConfig(cfg);

// Accessors
agent.autonomy;    // AutonomyController
agent.costLedger;  // CostLedger
agent.lastActivityTs;
```

### 8.2 Key Data Types

```js
// Message
{ role: 'user'|'assistant'|'system'|'tool', content: string|ContentPart[], tool_call_id?, tool_calls? }

// ContentPart (multimodal)
{ type: 'text', text: string }
{ type: 'image_url', image_url: { url: string } }
{ type: 'image', source: { type: 'base64'|'url', media_type: string, data|url: string } }

// ToolResult
{ success: boolean, output: string, error?: string }

// ChatResponse
{ content: string, model: string, tool_calls?: ToolCall[], usage: TokenUsage }

// TokenUsage
{ input_tokens: number, output_tokens: number }

// MemoryEntry
{ id: string, key: string, content: string, category: 'core'|'learned'|'user'|'context', timestamp: number }

// ScheduledJob
{ id: number, type: 'once'|'interval'|'cron', schedule: string|number, prompt: string, nextRun: number }

// AutonomyStats
{ level, actionsThisHour, maxActionsPerHour, costTodayCents, maxCostPerDayCents, costThisMonthCents, maxCostPerMonthCents, allowedHours }

// CostLedgerEntry
{ model: string, provider: string, inputTokens: number, outputTokens: number, costUsd: number, timestamp: number }
```

### 8.3 Tool Call Interface

Tools implement the `BrowserTool` base class:

```js
class MyTool extends BrowserTool {
  get name() { return 'my_tool'; }
  get description() { return 'Does something useful'; }
  get parameters() { return { type: 'object', properties: { ... }, required: [...] }; }
  get permission() { return 'read'; } // internal, read, write, network, browser
  async execute(params) { return { success: true, output: 'result' }; }
}
```

### 8.4 Provider Interface

All providers implement `LLMProvider`:

```js
class LLMProvider {
  get name();
  get displayName();
  get requiresApiKey();
  get supportsStreaming();
  get supportsNativeTools();
  get supportsVision();
  async isAvailable();
  async chat(request, apiKey, model, options);
  async chatStream(request, apiKey, model, options); // yields SSE chunks
}
```

---

## 9. Configuration Schema

Configuration is stored in localStorage per workspace:

```js
// Agent config (passed to agent.init())
{
  maxToolIterations: 20,       // Max tool call rounds per run
  maxHistoryMessages: 50,      // History length before auto-compact
  compactionThreshold: 12000,  // Token count triggering compaction
  maxResultLength: 1500,       // Max chars per tool result
  recallCacheTTL: 120000,      // Memory recall cache TTL (ms)
  recallCacheMax: 50,          // Memory recall cache size
  idleTimeoutMs: 1800000,      // Idle timeout before auto-compact (ms)
  toolTimeout: 30000,          // Per-tool execution timeout (ms)
}

// Autonomy config
{
  level: 'supervised',           // readonly | supervised | full
  maxActionsPerHour: 100,        // Rate limit
  maxCostPerDayCents: 500,       // $5/day
  maxCostPerMonthCents: 5000,    // $50/month
  allowedHours: [{start: 9, end: 17}], // Time-of-day restrictions
}

// Security config
{
  domainAllowlist: ['api.openai.com', 'api.anthropic.com'],
  maxFileSizeBytes: 10485760,    // 10MB
}

// Provider config
{
  activeProvider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: '...',                 // Stored in localStorage (user's machine only)
  baseUrl: '',                   // Custom base URL for Tier 2 providers
}
```

---

## 10. Security Model

### 10.1 Permission Hierarchy

```
internal (auto) → read (auto) → write (approve) → network (approve) → browser (approve)
```

- **internal**: Agent-internal operations (memory, goals). Always auto-approved.
- **read**: Read-only operations (fs read, memory search). Always auto-approved.
- **write**: State-mutating operations (fs write, delete). Requires user approval in supervised mode.
- **network**: External network access (fetch, web search). Requires user approval in supervised mode.
- **browser**: DOM manipulation, navigation. Requires user approval in supervised mode.

### 10.2 Autonomy Levels

| Level | Behavior |
|-------|----------|
| `readonly` | Only read/internal tools allowed. No write, network, or browser access. |
| `supervised` | Read/internal auto-approved. Write/network/browser require user approval. |
| `full` | All tools auto-approved. No approval prompts. |

### 10.3 Rate & Cost Limits

- Per-hour action rate limiting with automatic reset
- Per-day cost limiting with midnight reset
- Per-month cost limiting with month-boundary reset
- Time-of-day restrictions (e.g., only allow 9am-5pm)
- PolicyEngine integration for custom tool-level policies

### 10.4 Safety Pipeline

Three-stage defense:
1. **InputSanitizer**: Strips injection attempts from user input
2. **ToolCallValidator**: Validates tool arguments against schemas
3. **LeakDetector**: Scans tool outputs for leaked secrets (API keys, tokens)

### 10.5 API Key Management

- Keys stored in localStorage (user's machine only, never transmitted to unauthorized servers)
- Optional vault encryption via Web Crypto AES-GCM + PBKDF2
- Domain allowlist restricts which endpoints can be called
- No key is ever included in OPFS files or shared state

### 10.6 Workspace Isolation

- Each workspace has independent: history, memory, goals, config, tool permissions, files
- No cross-workspace data leakage
- Skills can be global or per-workspace (per-workspace overrides global)

---

## 11. Performance Requirements

### 11.1 Targets

| Metric | Target | Status |
|--------|--------|--------|
| Core runtime memory | < 64MB | Achieved |
| Agent startup (warm) | < 100ms | Achieved |
| Tool execution (median) | < 100ms | Achieved |
| Context compaction | < 2s | Achieved |
| LLM response (first token) | Provider-dependent | N/A |
| Checkpoint/resume | < 500ms | Achieved |

### 11.2 Optimization Strategies

- **Context Compaction**: Summarizes old messages to stay within token budgets
- **Memory Recall Cache**: LRU cache with TTL avoids redundant searches
- **Response Cache**: Identical LLM requests return cached responses
- **Lazy Loading**: Tier 3 providers (ai.matey) loaded on first use via CDN
- **Parallel Tools**: Read-only tools execute concurrently
- **Streaming**: Progressive token rendering reduces perceived latency

---

## 12. Testing Strategy

### 12.1 Test Infrastructure

- **Framework**: `node:test` with `node:assert/strict`
- **Test Files**: 142+ files in `web/test/`
- **Total Tests**: 1,680+ individual test cases
- **Global Stubs**: `_setup-globals.mjs` provides localStorage, document, navigator, BroadcastChannel

### 12.2 Test Groups

```bash
npm test              # All 142 files
npm run test:fast     # Core + channels (97 files)
npm run test:core     # Agent, tools, providers, shell, etc. (89 files)
npm run test:mesh     # All mesh networking (31 files)
npm run test:mesh-net     # Peer, transport, relay, gateway, websocket (7 files)
npm run test:mesh-sync    # Sync, delta-sync, streams, migration (4 files)
npm run test:mesh-identity # Identity, keyring, trust, ACL, capabilities (6 files)
npm run test:mesh-apps    # Apps, marketplace, payments, quotas (6 files)
npm run test:mesh-ops     # Audit, consensus, scheduler, tools, wsh-bridge (8 files)
npm run test:e2e      # End-to-end scenarios (1 file)
npm run test:changed  # Only files with git changes
```

### 12.3 Test Runner (`web/test/run-tests.mjs`)

Custom group-based runner supporting:
- Named groups with file glob patterns
- Concurrency control (`--concurrency N`)
- Dry-run mode (`--list`)
- Changed-files detection via git diff

### 12.4 Writing Tests

```js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub browser globals BEFORE importing the module
globalThis.BrowserTool = class { constructor() {} };

import { MyClass } from '../clawser-foo.js';

describe('MyClass', () => {
  it('does something', () => {
    assert.equal(new MyClass().value, 42);
  });
});
```

Key rules:
- Stub browser globals before imports
- Use `async` test functions, never callback-style
- Clean up timers in `afterEach` to prevent hangs
- `_setup-globals.mjs` provides localStorage, document, navigator stubs

### 12.5 Coverage by Subsystem

| Subsystem | Test Files | Coverage |
|-----------|-----------|----------|
| Agent core | 15+ | Run loop, memory, goals, scheduler, hooks, autonomy, safety |
| Providers | 5+ | All tiers, streaming, cost estimation, response cache, vision |
| Tools | 10+ | All tool categories, permissions, registry, execution |
| Shell | 8+ | Tokenizer, parser, builtins, pipes, jq |
| Skills | 3+ | Parser, storage, registry, activation |
| Mesh | 31 | All mesh subsystems (identity, transport, sync, apps, ops) |
| Channels | 8+ | All 7 channel adapters + channel manager |
| Kernel | 16 | All 16 kernel modules |
| UI/Config | 5+ | Config persistence, autonomy presets, state management |

---

## 13. Build & Distribution

### 13.1 Architecture

**No build step required.** All source files are ES modules loaded directly by the browser.

```
web/
├── index.html          # SPA entry point
├── clawser-*.js        # Core modules (ES modules)
├── sw.js               # Service Worker
├── shared-worker.js    # SharedWorker
├── manifest.json       # PWA manifest
├── styles/             # CSS
├── packages/           # npm packages (kernel, netway, andbox, wsh)
│   ├── kernel/
│   ├── netway/
│   ├── andbox/
│   └── wsh/
└── test/               # Test files
    ├── _setup-globals.mjs
    ├── run-tests.mjs
    └── clawser-*.test.mjs
```

### 13.2 External Dependencies

All loaded via CDN (zero npm runtime deps):

| Package | Purpose | Load Strategy |
|---------|---------|---------------|
| vimble | Sandboxed JS code execution | data: URI import |
| ai.matey | Universal AI adapter (24+ backends) | CDN lazy-load |
| fflate | Compression for checkpoint/transfer | CDN |

### 13.3 Distribution

| Method | Description |
|--------|-------------|
| Direct serve | Serve `web/` from any static HTTP server |
| PWA install | Add to home screen via manifest.json |
| GitHub Pages | Deploy from repo |
| CDN | Host on any static CDN |

### 13.4 Browser Compatibility

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome 138+ | Full | All APIs including Chrome AI |
| Chrome 131-137 | Full (no Chrome AI) | Fallback `self.ai.languageModel` |
| Chrome < 131 | Full (no Chrome AI) | All other features work |
| Edge | Full | Chromium-based, same as Chrome |
| Firefox | Degraded | No OPFS in main thread, no SharedWorker |
| Safari | Degraded | Limited OPFS, no Chrome AI |

---

## 14. Milestones

### Phase 1: Foundation (Completed)
- Pure JS agent core replacing Rust/WASM
- EventLog, HookPipeline, AutonomyController
- Provider system (Tier 1 + Tier 2)
- Basic tool system with permission model
- Virtual shell with core builtins
- Context compaction and history management

### Phase 2: Memory & Persistence (Completed)
- Semantic memory with BM25 + vector search
- OPFS workspace filesystem
- Checkpoint/resume system
- IndexedDB structured storage
- Secret vault with AES-GCM encryption

### Phase 3: Providers & Streaming (Completed)
- SSE streaming for all providers
- Tier 3 ai.matey integration
- ResponseCache with LRU eviction
- Cost tracking and estimation
- Vision/multimodal input support

### Phase 4: Tools & Skills (Completed)
- ~100 browser-native tools
- MCP client for external tool servers
- Agent Skills standard (SKILL.md)
- Chrome AI specialized tools
- Platform integrations (Google, Slack, Notion, Linear)
- Chrome Extension tools (32 browser automation tools)

### Phase 5: Scheduling & Background (Completed)
- Cron, interval, one-shot scheduler
- Service Worker daemon mode
- SharedWorker multi-tab coordination
- Routine engine with event-driven triggers
- Self-repair and stuck detection

### Phase 6: Mesh & Channels (Completed)
- P2P mesh networking (31 modules)
- 7 channel adapters (Discord, Slack, Telegram, IRC, Matrix, Email, Relay)
- Distributed apps, marketplace, payments
- Consensus protocol, distributed scheduler
- Hardware peripheral support (Serial, Bluetooth, USB)

### Phase 7: Kernel & Polish (Completed)
- Microkernel with tenant isolation
- Capability enforcement
- Cost management (daily + monthly limits, CostLedger wiring)
- Parallel tool execution
- Session idle timeout
- Config UI for new settings
- 1,680+ tests across all subsystems

---

## Appendix A: Glossary

| Term | Definition |
|------|-----------|
| **AIEOS** | AI Entity Operating Standard — identity format for agents |
| **andbox** | Code sandbox using Worker + data: URI for isolated JS execution |
| **BM25** | Best Matching 25 — probabilistic keyword search algorithm |
| **CBAC** | Capability-Based Access Control |
| **Codex** | Code-based tool execution pipeline for non-native-tool providers |
| **CRDT** | Conflict-free Replicated Data Type — for mesh state sync |
| **DID** | Decentralized Identifier — W3C standard for self-sovereign identity |
| **MCP** | Model Context Protocol — standard for LLM tool integration |
| **Mesh** | Peer-to-peer network of Clawser agent instances |
| **OPFS** | Origin Private File System — browser-native sandboxed filesystem |
| **PWA** | Progressive Web App — installable web application |
| **SKILL.md** | Agent Skills open standard file format (agentskills.io) |
| **SSE** | Server-Sent Events — streaming protocol for LLM responses |
| **WSH** | WebSocket Shell — remote shell protocol |

## Appendix B: Module Inventory

| Category | Files | Approx LOC |
|----------|-------|------------|
| Agent Core & Runtime | 8 | 13,500 |
| Application Orchestration | 6 | 2,250 |
| UI Components | 11 | 5,850 |
| Persistence & Storage | 7 | 2,630 |
| Agent Features | 10 | 7,400 |
| Server & Networking | 7 | 3,000 |
| Channels & Integrations | 20 | 5,900 |
| Hardware | 2 | 1,280 |
| Dev & Admin Tools | 15 | 6,400 |
| Sandboxing & Execution | 4 | 1,610 |
| Mesh Networking | 31 | 20,000+ |
| Kernel Infrastructure | 7 | 3,550 |
| Utilities & Helpers | 12 | 2,750 |
| **Total** | **~148** | **~65,000** |

## Appendix C: Non-Goals (Explicit Exclusions)

- Server-side execution (agent runs in-browser only)
- Native mobile app (PWA is the mobile strategy)
- npm package distribution of the full agent (only kernel/netway/andbox are packages)
- Database-backed persistence (browser storage APIs only)
- Real-time collaboration editing (mesh sync is eventual consistency)
- End-to-end encryption of mesh traffic (transport-level TLS only)
- Native OS process management (browser sandbox constraints apply)
