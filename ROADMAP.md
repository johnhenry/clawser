# Clawser Roadmap

## Current Status (Feb 2026)

Clawser is a **beta-quality** browser-native AI agent platform. The core runtime is functionally complete with 57 JS modules (~31K LOC), 70+ tools, and 38+ LLM provider backends. The project transitioned from a Rust/WASM architecture to pure JavaScript.

### What Works
- Full agent loop with streaming, tool calling, and context compaction
- Event-sourced conversation persistence with fork, replay, and export
- 3-tier provider system supporting 38+ LLM backends with fallback chains
- 70+ browser tools with permission engine (auto/approve/denied)
- Skills system (agentskills.io standard) with OPFS storage, remote registry, and validation
- Virtual shell with 59 commands, pipes, redirects, variable substitution, and glob expansion
- Multi-workspace isolation with separate state per workspace
- Autonomy controls with rate and cost limiting
- Memory system with hybrid BM25+vector recall
- Goal tracking, scheduler (cron), hook pipeline, response cache
- Daemon mode with SharedWorker tab coordination and BroadcastChannel
- Remote tool integration via wsh protocol (shell exec, file transfer, MCP bridging, CORS proxy)
- Local filesystem mounting via FileSystemAccess API
- Delegation, self-repair, undo, routines, heartbeat, auth profiles
- ARIA accessibility, keyboard shortcuts, light/dark mode, responsive design
- CI/CD pipeline, Docker, Service Worker, PWA

### Version History

| Milestone | What shipped |
|-----------|-------------|
| **Phase 0** | Full codebase: pure JS agent, modular UI, providers, tools, tests. Post-modularization fixes. |
| **Phase 1** | Core systems — Blocks 1 (shell), 4 (memory), 5 (vault), 6 (autonomy), 7 (identity), 20 (hooks), 23 (safety), 26 (cache) |
| **Phase 2** | Infrastructure — Blocks 0 (bridge→wsh), 2 (mount), 3 (daemon), 8 (goals), 9 (delegation), 10 (metrics), 11 (fallback), 17 (skills registry), 19 (auth), 22 (self-repair), 24 (tool builder), 25 (undo), 27 (intent) |
| **Phase 3** | Feature modules — Blocks 12 (git), 13 (hardware), 14 (channels), 15 (remote), 16 (OAuth), 18 (browser auto), 21 (routines), 28 (sandbox), 29 (heartbeat) |
| **Batch 1** | Critical security and safety fixes across 7 areas |
| **Batch 2** | Router single source of truth, state namespacing |
| **Batch 3** | Panel enhancements, agent loop integration, 9 API mismatch fixes |
| **0.1.0-beta** | 9 feature module integrations with 36 new agent tools. Phase 2 UI/agent loop wiring for all 30 blocks. |
| **Phase 7** | Virtual Server subsystem — SW fetch intercept, ServerManager, function/static/proxy handlers, 8 agent tools, FetchTool auto-routing, kernel svc:// integration, Servers UI panel |

---

## Phase 1: Foundation -- COMPLETE

### Documentation -- COMPLETE
- [x] README.md — Project overview and quick start
- [x] ARCHITECTURE.md — System design and module map
- [x] ROADMAP.md — This document
- [x] LICENSE — MIT license file at project root
- [x] ~~CHANGELOG.md~~ — Merged into Version History section above
- [x] CONTRIBUTING.md — Contributor guidelines
- [x] SECURITY.md — Security policy and threat model
- [x] docs/API.md — API reference for core modules
- [x] docs/CLI.md — CLI subcommands and shell builtins
- [x] docs/MODULES.md — Feature module manifest
- [x] docs/EVENT-LOG.md — Event log specification
- [x] docs/DEPLOYMENT.md — Static server, Docker, production setup
- [x] .github/ templates — PR template + bug/feature issue templates

### Critical Fixes -- COMPLETE
- [x] **Execution timeout** — Promise.race() with 30s timeout on Codex/vimble sandbox
- [x] **MCP tool wiring** — McpClient/McpManager integrated into agent run loop
- [x] **Skill activation lock cleanup** — try/finally ensures lock deletion on error

### Testing Infrastructure -- COMPLETE
- [x] test.html — 11K LOC browser-based regression suite (57 modules)
- [x] bench.html — Micro-benchmarks (Codex, EventLog, providers, memory)
- [x] GitHub Actions CI — Playwright + syntax checking
- [x] Test fixtures — Sample skill, provider response, event log

---

## Phase 2: Stability -- COMPLETE

### Architecture Refactoring -- COMPLETE
- [x] **clawser-app.js** — Reduced from 977 to 192 LOC thin orchestrator
- [x] **State management** — Namespaced (ui, services, features, session) with ConfigCache and backward-compat aliases
- [x] **Router panel source** — Single PANELS constant, all consumers derive from it
- [x] **UI panels split** — Extracted files, memory, goals, config into sub-modules

### Error Handling -- COMPLETE
- [x] **Tool error recovery** — Returns `{_error, message}` instead of throwing in Codex
- [x] **Sub-agent recursion guard** — MAX_AGENT_REF_DEPTH=3 + visited Set
- [x] **MCP timeout** — AbortController with configurable 30s timeout
- [x] **Conversation locking** — isSending guard prevents switching mid-send

### Provider Improvements -- COMPLETE
- [x] **MateyProvider streaming** — Returns estimated tokens from character count
- [x] **Chrome AI session pooling** — LRU pool (max 3, 5min TTL)
- [x] **Anthropic message merging** — Consecutive merge + tool_use/tool_result packing

### Configuration -- COMPLETE
- [x] **Tool result truncation** — Indicated with char counts + event logged
- [x] **Extract hardcoded limits** — compactionThreshold, maxResultLength, recallCacheTTL, recallCacheMax moved to #config with defaults
- [x] **Cost estimation** — estimateCost() handles cache_creation_input_tokens + cache_read_input_tokens with per-model pricing

---

## Phase 3: Polish -- COMPLETE

### Accessibility & UX -- COMPLETE
- [x] **ARIA labels** — 24+ attributes on landmarks, buttons, live regions
- [x] **Keyboard shortcuts** — Cmd+Enter/K/N/1-9/Escape in clawser-keys.js
- [x] **prefers-reduced-motion** — All animations disabled per user preference
- [x] **Light mode** — CSS media query + .theme-light manual toggle
- [x] **Responsive design** — Media queries at 768px and 480px breakpoints
- [x] **Type scale** — CSS variable typography (xs through xl)
- [x] **Print styles** — Clean chat printing with hidden chrome
- [x] **Item bar search** — Filter input with real-time case-insensitive matching
- [x] **File browser pagination** — PAGE_SIZE=50 with "Load more" button
- [x] **Permission UI tooltips** — Tooltips + color coding (green/yellow/red) on all permission badges

### Shell Improvements -- MOSTLY COMPLETE
- [x] **Variable substitution** — $VAR, ${VAR}, $? fully implemented
- [x] **Glob expansion** — *, ?, [] with POSIX fallback
- [x] ~~Stderr redirect~~ — 2>/dev/null, 2>&1, 2>file fully implemented in executor

### Shell Emulation Layer (Block 1) -- MOSTLY COMPLETE
**Done:**
- [x] Shell parser — recursive descent, full AST (pipes, &&, ||, ;, quotes, redirects)
- [x] Web Streams execution engine with pipe/redirect support and pipefail
- [x] 59 built-in commands (22 core + 37 extended in clawser-shell-builtins.js)
- [x] ShellState (cwd, env, history, $?, aliases) — per-conversation scoping
- [x] Shell session lifecycle — create on conversation start, discard on end
- [x] .clawserrc sourcing on shell init (per-workspace)
- [x] ShellTool — agent-facing tool (single command string)
- [x] Variable expansion ($VAR, ${VAR}, $?)
- [x] Glob expansion (*, ?, [abc])
- [x] Terminal UI panel with interactive input, modes, history, CWD display
- [x] Terminal sessions — OPFS persistence + restore via TerminalSessionManager
- [x] External bridge fallback for unknown commands
- [x] Command registry with metadata, categories, help system

**Remaining:**
- [x] **Command substitution** — expandCommandSubs() with nested $(), escape \\$(), trailing newline strip
- [x] **Advanced globs** — ** recursive via expandRecursiveGlob(), {a,b} via expandBraces(), !(pattern) via expandNegationGlob()
- [x] **Skills → CLI registration** — SkillRegistry.registerCLI()/unregisterCLI() maps enabled skills to CommandRegistry commands
- [x] **Background jobs** — BACKGROUND token, job table, jobs/fg builtins in ClawserShell
- [x] **jq implementation** — JS-subset jq builtin: `.`, `.key`, `.[]`, `keys`, `values`, `length`, `type`
- [x] **Tool CLI wrappers** — generateToolWrappers() maps tool schemas to CLI handlers (curl, search, etc.)
- [x] **Installable CLI packages** — installPackage(), uninstallPackage(), listPackages() in ClawserShell

### Security Hardening -- COMPLETE
- [x] **Skill validation** — validateScript() scans for dangerous patterns before activation
- [x] **eval_js permission** — Defaults to 'approve' with warning in description
- [x] **XSS sanitization** — DomModifyTool strips dangerous tags + on* handlers
- [x] **OPFS quota management** — checkQuota() export with 80/95% thresholds
- [x] **API key warning UI** — renderApiKeyWarning() with banner + "Clear all API keys" button
- [x] **FsWriteTool quota check** — checkQuota() called before writes, rejects at 95%

### Build & Distribution -- COMPLETE
- [x] **Service Worker** — sw.js with cache-first app shell strategy (64 entries, v2 cache)
- [x] **Docker** — Nginx-based Dockerfile with SPA routing
- [x] **Cargo.toml edition** — Fixed to 2021
- [x] **PWA icons** — PNG 192x192 + 512x512 generated from SVG, manifest + apple-touch-icon
- [x] **SW precache list** — All 54 clawser-*.js modules + assets cached (expanded from 27)
- [x] **target/ cleanup** — Not tracked by git (gitignored), local-only build artifacts
- [x] **manifest.json scope** — Already had `"scope": "/web/"`

---

## Phase 4: Hardening -- COMPLETE

Priority: Resilience, observability, and production readiness.

### Reliability -- COMPLETE
- [x] **SSE reconnection** — try/catch with partial content recovery + stream_error event
- [x] **Atomic OPFS writes** — Already atomic per WHATWG spec (documented)
- [x] **Memory entry bounds** — 5000 max entries with LRU eviction
- [x] **MCP notification error handling** — .catch() on notifications/initialized fetch
- [x] **Terminal session quota checks** — checkQuota() before OPFS persist
- [x] **Browser automation cleanup** — AutomationManager.closeAll() via bridge pattern

### Observability -- COMPLETE
- [x] **Rate limit UI feedback** — Error messages include reset time, autonomy stats exposed
- [x] **Debug logging flag** — clawserDebug with enable/disable + localStorage persistence
- [x] **Configurable limits** — Config panel for cache TTL, max entries, tool iterations

### Testing -- COMPLETE
- [x] **Test CI integration** — JSON summary, __TEST_RESULT__ console markers, per-section timing
- [x] **Critical path coverage** — SSE parsing edge cases, workspace isolation, isSending guard, autonomy rate/cost limits, MCP tool invocation
- [x] **Benchmarks in CI** — Playwright runner, structured results, regression detection (>20% threshold), baseline caching
- [x] **Clean up test dirs** — Removed empty tests/unit/, tests/e2e/, tests/integration/

### Storage -- COMPLETE
- [x] **Conversation cleanup** — Bulk delete UI with age threshold + selective checkboxes
- [x] **Checkpoint format docs** — Binary encoding, fields, migration chain in EVENT-LOG.md
- [x] **localStorage versioning** — v1 prefix on all keys + migrateLocalStorageKeys() on startup
- [x] **Lazy panel rendering** — 7 panels deferred via panel:firstrender (tools, files, goals, skills, toolMgmt, agents, dashboard); config panels eager; resetRenderedPanels on workspace switch
- [x] **Response cache config** — TTL and max entries configurable in config panel

### Documentation -- COMPLETE
- [x] **.reference/ README** — Purpose of historical reference dirs documented
- [x] **Demo directory README** — Historical reference status noted

---

## Phase 5: Remote Execution (wsh) -- COMPLETE

Priority: Browser-native remote shell, reverse relay, session management, and MCP bridging.

### Phase 5.0: Protocol & Transport — COMPLETE
- [x] CBOR control channel with BE32 framing
- [x] Ed25519 pubkey auth (authorized_keys)
- [x] WebTransport + WebSocket fallback
- [x] 50+ message types (codegen from YAML spec)
- [x] Ping/pong keepalive
- [x] JS client library (connect, auth, sessions, file transfer, MCP)
- [x] Rust CLI (connect, keygen, copy-id, scp, sessions, attach)
- [x] Browser wsh tools (9 tools)
- [x] Pairing system (6-digit codes, tokens)

### Phase 5.1: Gateway & Networking — COMPLETE
- [x] TCP/UDP proxy, DNS resolution, bidirectional relay
- [x] Reverse TCP listeners, gateway policy enforcement
- [x] Netway virtual networking (StreamSocket, DatagramSocket, Listener)
- [x] Leak fixes, timeout enforcement, error handling

### Phase 5.2: "wsh into Browser" Relay — COMPLETE
- [x] ReverseRegister/ReverseList/ReverseConnect server dispatch
- [x] Browser auto-register, incoming session handler, relay message routing
- [x] Rust CLI: reverse, peers, connect commands

### Phase 5.3: Session Management (Server) — COMPLETE
- [x] Attach/Resume/Open/Resize/Signal/Close dispatch
- [x] Session metadata (Rename, Snapshot, Presence, ControlChanged, Metrics, IdleWarning, Shutdown)

### Phase 5.4: MCP Dispatch — COMPLETE
- [x] McpDiscover/McpCall server dispatch + HTTP proxy

### Phase 5.5: Protocol Improvements — COMPLETE
- [x] Dynamic capability negotiation, clipboard sync, per-key permissions
- [x] Auth/attach rate limiting, password auth, protocol version negotiation

### Phase 5.6: Client Enhancements — COMPLETE
- [x] URL read-only attach, session list/attach/scp/connect commands

### Phase 5.7: Protocol Extensions — COMPLETE
- [x] Recording export, snapshots, command journal, device labels
- [x] Background jobs, metrics, idle suspend, PTY restart, ghostty-web
- [x] Guest sessions, multi-attach, compression, rate control
- [x] Cross-session linking, copilot mode, E2E encryption
- [x] Predictive echo, diff-based sync, horizontal scaling, shared sessions
- [x] Structured file channel, policy engine

### Phase 5.8–5.12: Audit Fixes — COMPLETE
See [AUDIT.md](AUDIT.md) for detailed security audit fix log (5 rounds, all resolved).

---

## Phase 6: Ecosystem (Future)

Priority: Integrations, API, and community.

### External Tool Integration (Block 0)

**Phase 6a: Bridge → wsh Migration** -- COMPLETE
- [x] Bridge system retired (ExternalBridge, LocalServerBridge, ExtensionBridge, BridgeManager — deleted)
- [x] All bridge functionality replaced by wsh protocol: shell exec (`wsh_exec`), file transfer (`wsh_upload`/`wsh_download`), MCP bridging (`wsh_mcp_call`), reverse mode (`wsh_connect` with expose)
- [x] `wsh_fetch` tool added — CORS proxy replacement via `curl` over `wsh_exec`
- [x] Bridge dead code removed from OAuth, state, UI, SW, tests

**Phase 6b: Browser Extension** -- COMPLETE
- [x] Scaffold Chrome extension (Manifest V3, background service worker) — `extension/manifest.json`, `extension/background.js`
- [x] Content script: message relay to/from Clawser page (`__clawser_ext__` marker injection) — `extension/content.js`
- [x] 34 `ext_*` BrowserTool subclasses + ExtensionRpcClient — `web/clawser-extension-tools.js`
- [x] Tab management (5), navigation (3), screenshots/window (3) via Chrome APIs
- [x] DOM reading (4): accessibility tree, find, text extract, HTML
- [x] Input simulation (9): click, dblclick, tripleclick, rightclick, hover, drag, scroll, type, key
- [x] Form tools (2): form_input, select_option
- [x] Console + network monitoring (2) via userScripts + webRequest
- [x] Evaluate + wait (2): JS execution in MAIN world, selector/condition polling
- [x] Cookies (1): read cookies for URL
- [x] Type definitions — `web/clawser-extension-tools.d.ts`
- [x] Tests: registration (34 tools), permissions, graceful degradation, RPC lifecycle
- [x] Integration: registered in workspace-lifecycle, cached in sw.js
- [ ] CORS-free fetch proxy via background worker
- [ ] Firefox compatibility (WebExtension APIs, `webextension-polyfill`)
- [ ] "Discovered Tools" UI panel with per-tool enable/disable (approval required)

**Phase 6c: WebMCP + BrowserMCP** -- PARTIAL
- [x] Basic WebMCP discovery (`ext_webmcp_discover`) — scan `<meta name="webmcp">`, `<link rel="mcp">`, `navigator.modelContext`, `.well-known/mcp`
- [x] Deep WebMCP integration — auto-register discovered tools (with user approval)
- [ ] Evaluate BrowserMCP fork vs standalone
- [x] Cross-tab tool invocation
- [x] Native messaging for system tools (optional, extension + local binary)

### Local Filesystem Mounting (Block 2) -- MOSTLY COMPLETE
**Done:**
- [x] `MountableFs` class extending WorkspaceFs with mount table (`web/clawser-mount.js`, 355 LOC)
- [x] `showDirectoryPicker()` integration with `/mnt/<name>` mount point assignment
- [x] Handle persistence in IndexedDB + re-permission on reload
- [x] Mount list UI in sidebar (renderMountList with unmount buttons)
- [x] `mount_list` agent tool (registered in workspace init)
- [x] `mount_resolve` agent tool (registered in workspace init)
- [x] Read-only mount option (opts.readOnly, persisted)
- [x] Individual file mounting via `showOpenFilePicker()`

**Remaining:**
- [x] **System prompt mount table injection** — MountableFs.formatMountTable() + injectMountContext(basePrompt)
- [x] **Shell transparent mount routing** — MountableFs.readMounted(), writeMounted(), listMounted() with mount routing
- [x] **mount/umount/df shell built-ins** — registerMountBuiltins() in clawser-shell-builtins.js
- [x] **isomorphic-git integration** — Pure JS git ops on mounted repos (~300KB, lazy-load)
- [ ] **FileSystemObserver** — Watch mounted dirs for external changes (Chrome 129+)
- [x] **Auto-indexing** — MountableFs.buildIndex() recursive dir tree with maxDepth support
- [ ] **Drag-and-drop folder mounting** — Drop folder onto Clawser UI to mount
- [x] **Mount presets per workspace** — exportPresets()/importPresets() for serializable mount configs

### Daemon Mode (Block 3) -- PARTIALLY COMPLETE
**Done:**
- [x] ClawserAgent DOM-free (pure JS, no window/document deps)
- [x] Checkpoint serialization — getCheckpointJSON(), EventLog toJSONL/fromJSONL
- [x] DaemonState state machine (7 states: stopped→starting→running→checkpointing→paused→recovering→error)
- [x] CheckpointManager with full CRUD (create/restore/list/delete via OPFS)
- [x] TabCoordinator with BroadcastChannel (heartbeat, tab discovery, join/leave)
- [x] DaemonController (lifecycle orchestration + checkpoint + coordination)
- [x] Checkpoint migration (v1→v2 via migrateV1ToEvents)
- [x] NotifyTool (browser Notification API wrapper)
- [x] Service Worker app caching (sw.js, cache-first, 64 entries)
- [x] URL-hash routing (clawser-router.js parseHash)
- [x] DaemonStatusTool + DaemonCheckpointTool (agent tools)

**Phase 1 remaining — SharedWorker + messaging:**
- [ ] **SharedWorker host** — shared-worker.js hosting ClawserAgent instance
- [x] **Tab ↔ SharedWorker message protocol** — user_message, stream_chunk, state, shell_exec
- [x] **Web Locks for input arbitration** — InputLockManager with tryAcquire/release/isHeld + navigator.locks fallback

**Phase 2 remaining — Service Worker daemon:**
- [ ] **Heartbeat loop in SW** — Periodic wake-up for scheduled job checking
- [x] **Headless agent execution** — SW reads checkpoint, runs agent, saves new checkpoint
- [x] **Background activity log** — EventLog maxSize, query(type/source/limit), summary()
- [x] **"While you were away" summary** — Card shown on tab open after background work

**Phase 3 remaining — Multi-tab + polish:**
- [ ] **Multiple tab views** — chat, terminal, activity, workspace, goals as separate views
- [x] **"Agent is busy" cross-tab indicator** — AgentBusyIndicator with setBusy/status via BroadcastChannel
- [x] **Interrupted tool call handling** — BrowserTool.idempotent getter, read-only tools marked idempotent
- [ ] **Checkpoint rollback UI** — Browse checkpoint history, restore to previous state

**Notifications remaining:**
- [x] **NotificationManager** — Centralized manager with permission request flow, unique IDs, history, dismiss/clear
- [x] **Notification batching** — Configurable batch window with flush(), summary delivery for multiple notifications
- [x] **In-app notification center** — Toast popups + badge count + notification panel
- [x] **Notification preferences** — Per-type toggles, quiet hours, setPreference() in NotificationManager

### Semantic Memory Embedding Providers (Block 4)
**Done (pure JS BM25 + cosine hybrid):**
- [x] BM25 keyword search with Porter stemmer
- [x] Cosine similarity, EmbeddingProvider interface, NoopEmbedder
- [x] Hybrid search (BM25 0.3 + cosine 0.7 weighted merge)
- [x] EmbeddingCache (LRU, 500 entries)
- [x] Memory hygiene, export/import, browser UI, comprehensive tests

**Remaining — real embedding providers:**
- [x] **OpenAI embedding provider** — Concrete EmbeddingProvider using text-embedding-3-small API (Sprint 10: OpenAIEmbeddingProvider class, custom model/dimensions/baseUrl, fetch-based)
- [x] **Chrome AI embedding provider** — ChromeAIEmbeddingProvider with isAvailable(), hash-based embedding, L2 normalization, 256-dim default
- [x] **transformers.js local embeddings** — TransformersEmbeddingProvider (384d, CDN lazy-load, isAvailable guard)
- [x] **Embedding backfill** — Backfill existing memories when provider first configured (already implemented: SemanticMemory.backfillEmbeddings() with onProgress callback)

### API Key Encryption (Block 5) -- MOSTLY COMPLETE
**Done:**
- [x] SecretVault with PBKDF2 (600K iterations) + AES-GCM (256-bit)
- [x] OPFS vault storage backend
- [x] Vault lock/unlock lifecycle with 30-min idle auto-lock
- [x] Canary-based passphrase verification
- [x] Migration from plaintext localStorage keys
- [x] Passphrase modal on app init

**Remaining:**
- [x] **Passphrase strength indicator** — measurePassphraseStrength() with entropy/score/label
- [x] **Vault rekeying UI** — Change passphrase without re-encrypting from scratch

### Autonomy & Cost Limiting (Block 6) -- MOSTLY COMPLETE
**Done:**
- [x] AutonomyController with 3 levels (readonly/supervised/full)
- [x] Rate limiting (maxActionsPerHour) + cost limiting (maxCostPerDayCents)
- [x] MODEL_PRICING table + estimateCost() for all providers
- [x] Cost meter UI (progress bar, danger/warn colors)
- [x] Autonomy badge in header
- [x] Per-workspace autonomy config in settings panel
- [x] **AgentHaltedError** — Structured limit result with `limitType` ('rate'|'cost') and `resetTime` (ms) from checkLimits(); forwarded in run()/runStream() return values (Sprint 8)

**Remaining:**
- [ ] **Detailed cost dashboard** — Per-model breakdown, time series, cost trends

### Identity System (Block 7) -- MOSTLY COMPLETE
**Done:**
- [x] Three identity formats: plain, AIEOS v1.1, OpenClaw (detected)
- [x] AIEOS JSON schema validator with defaults
- [x] System prompt compiler (identity + memories + goals + skills)
- [x] IdentityManager per-workspace with localStorage persistence
- [x] Default Clawser persona (INTJ, pragmatic utilitarian)
- [x] Settings UI: format selector, plain editor, AIEOS fields, preview

**Remaining:**
- [x] **Identity templates/presets** — IDENTITY_TEMPLATES with 4 personas (CodeBot, Muse, Analyst, Coach), IdentityManager.fromTemplate(), listTemplates()
- [x] **OpenClaw markdown loading** — IdentityManager.loadFromFiles({identity, soul, user}) for markdown-based identities
- [ ] **Avatar display in chat UI** — Show avatar_url from identity in message bubbles
- [ ] **Dedicated identity editor** — Full-featured editor panel (not just settings fields)

### Goals & Sub-goals (Block 8) -- MOSTLY COMPLETE
**Done:**
- [x] Goal class with parentId, subGoalIds, artifacts, progressLog, priority
- [x] GoalManager with tree ops (add, cascading completion, progress calc)
- [x] 4 goal tools: add, update, add-artifact, list
- [x] System prompt injection with sub-goal checklist
- [x] Tree UI with indentation, expand/collapse, progress bars, artifact links
- [x] Comprehensive tests

**Remaining:**
- [x] **Goal file format** — Persist goals as GOALS.md (Sprint 11: GoalManager.toMarkdown()/fromMarkdown() with checkbox state, priority, deadline, sub-goal nesting)
- [ ] **Goal editing UI** — Rename, change priority, edit description inline
- [x] **Deadline/due date fields** — Temporal tracking for goal completion (Sprint 11: Goal.deadline field, serialized in toJSON, shown in buildPrompt/toMarkdown)
- [x] **Goal dependency/blocking** — Cross-goal dependencies beyond parent-child (Sprint 11: Goal.blockedBy[], GoalManager.addDependency()/isBlocked())
- [x] **Auto-decompose from natural language** — GoalManager.decompose(goalId, subtasks[]) + GoalDecomposeTool (goal_decompose)

### Sub-agent Delegation (Block 9) -- MOSTLY COMPLETE
**Done:**
- [x] SubAgent class with isolated history, goal-focused execution, tool allowlisting
- [x] DelegateManager with concurrent lifecycle management + concurrency limits
- [x] DelegateTool (`agent_delegate`) registered
- [x] MAX_DELEGATION_DEPTH=2
- [x] Event callbacks (delegate_start/complete/error/timeout)

**Remaining:**
- [x] **ConsultAgentTool** — Read-only sub-agent (agent_consult, auto permission) for advice/analysis without state modification
- [x] **Sub-agent cost attribution** — SubAgent tracks usage (input/output tokens), result includes cost field, DelegateTool outputs cost
- [x] **Streaming from sub-agent** — Stream sub-agent output back to parent UI
- [x] **Sub-agent cancellation** — DelegateManager.cancel(id), SubAgent status tracking mid-loop
- [x] **Sub-agent memory scoping** — parentMemory option (frozen read-only copy), injected into system prompt
- [ ] **Sub-agent UI** — Inline collapsible display of sub-agent execution in chat

### Observability Dashboard (Block 10) -- PARTIALLY COMPLETE
**Done:**
- [x] MetricsCollector (counters, gauges, histograms, snapshot, percentile)
- [x] RingBufferLog (1000 entries, level+source filtering)
- [x] OTLP export + JSON dump
- [x] Basic dashboard UI (request/token/error counters, latency, log viewer)
- [x] **Active agent instrumentation** — MetricsCollector wired into run()/runStream(), provider.chat(), #executeToolCalls(), safety scanning (agent.runs, agent.run_duration_ms, agent.errors, llm.calls, llm.input_tokens, llm.output_tokens, llm.cost_cents, tools.calls, tools.errors, tools.by_name.*, safety.input_flags, safety.tool_blocks, safety.output_blocks, safety.output_redactions)
- [x] **Bug fixes** — runStream() duration/error metrics, beforeOutbound on cache hits, destroy() cleanup
- [x] **Per-model/provider cost metrics** — llm.calls_by_model.{model}, llm.calls_by_provider.{provider}, llm.tokens_by_model.{model} tracked in run()/runStream()
- [x] **RingBufferLog wiring** — Agent pushes structured log entries (level, source, message, data) for LLM calls, errors; query by source/level

**Remaining:**
- [x] **Per-provider/model cost breakdown** — CostLedger class with totalByModel(), totalByProvider(), summary()
- [ ] **Charts/visualization** — CSS bar charts for cost, tokens, latency over time
- [x] **Historical time-series storage** — MetricsCollector.rollup(), MetricsTimeSeries (add/query/import/export)
- [x] **Per-conversation and per-goal stats** — MetricsCollector.scopedView(namespace) with prefixed keys
- [ ] **Cost over time chart** — Last 7/30 day trends

### Provider Fallback Chains (Block 11) -- MOSTLY COMPLETE
**Done:**
- [x] FallbackChain + FallbackEntry data structures
- [x] FallbackExecutor with retry + chain traversal + exponential backoff
- [x] ProviderHealth circuit breaker (failure tracking, cooldown, auto-reorder)
- [x] ModelRouter with 5 hint categories (smart/fast/code/cheap/local)
- [x] costAwareSort() within quality tiers
- [x] **Wire to agent chat execution** — FallbackExecutor wrapping provider.chat/chatStream calls in run() and runStream() (agent.js:1255, 1502)

- [x] **Fallback effectiveness metrics** — FallbackExecutor tracks `fallback.attempts`, `fallback.successes`, `fallback.failures` per provider via MetricsCollector; `addEntry()` alias added to FallbackChain (Sprint 8)

**Remaining:**
- [x] **Dynamic hint selection** — ModelRouter.selectHint({text, toolCount, hasCode}) → fast/smart/code
- [x] **Adaptive model selection** — ModelRouter.recordOutcome() + modelStats() for per-model+hint performance tracking
- [ ] **Chain editor UI** — Visual fallback chain configuration in workspace settings

### Git as Agent Behavior (Block 12) -- MOSTLY COMPLETE
**Done:**
- [x] GitBehavior with goal-boundary commits, experiment branching, micro-commits
- [x] GitEpisodicMemory (recallByTopic, recallByGoal, recallExperiments, findHotspots)
- [x] Structured commit message format with parser/formatter
- [x] 6 agent tools: git_status, git_diff, git_log, git_commit, git_branch, git_recall

**Remaining:**
- [x] **isomorphic-git backend** — Wire GitBehavior to actual isomorphic-git (~300KB, lazy-load)
- [x] **Auto-commit on goal completion** — GoalManager.onCompletion() callback with cascading fire
- [x] **Repository auto-init** — Init .git on first file write if none exists
- [x] **Branch merge conflict resolution** — Strategy for experiment merge conflicts
- [x] **FTS5 integration** — Index commit messages in memory system (Block 4 cross-ref)

### Web Hardware Peripherals (Block 13) -- MOSTLY COMPLETE
**Done:** SerialPeripheral, BluetoothPeripheral, USBPeripheral, PeripheralManager, 6 tools (hw_list/connect/send/read/disconnect/info) — 961 LOC
**Remaining:**
- [x] **hw_monitor tool** — Real-time device data streaming to agent (Sprint 11: HwMonitorTool class, duration-based data collection)
- [x] **Hardware event forwarding** — Auto-trigger agent on device data arrival (Sprint 11: PeripheralManager.onDeviceData()/offDeviceData()/dispatchDeviceData())
- [x] **Peripheral state persistence** — Survive page reloads for granted devices (Sprint 11: PeripheralManager.saveState()/restoreState() via localStorage)

### Multi-Channel Input (Block 14) -- MOSTLY COMPLETE
**Done:** ChannelManager, InboundMessage normalization, allowlists, formatForChannel, 3 tools (channel_list/send/history), 7 channel types defined — 465 LOC
**Remaining:**
- [ ] **Backend relay server** — WebSocket relay + generic webhook receiver (server-side)
- [ ] **Telegram bot plugin** — Polling mode implementation
- [ ] **Discord/Slack/Matrix plugins** — Gateway/Events API implementations
- [ ] **Email plugin** — IMAP polling + SMTP send
- [ ] **IRC client** — Protocol implementation
- [x] **Attachment handling** — AttachmentProcessor class with processText(), formatForContext()

### Remote Access Gateway (Block 15) -- MOSTLY COMPLETE
**Done:** PairingManager (6-digit codes, token exchange, expiry), RateLimiter (60/min), GatewayClient, 3 tools (remote_status/pair/revoke) — 482 LOC
**Remaining:**
- [ ] **Backend gateway server** — POST /message + GET /stream (SSE) endpoints
- [ ] **Tunnel integration** — Cloudflare tunnel + ngrok provider abstraction
- [ ] **Tunnel URL display** — QR code for mobile scanning
- [ ] **Mobile-friendly /remote/ pages** — Static remote UI

### OAuth App Integrations (Block 16) -- MOSTLY COMPLETE
**Done:** OAuthManager (popup flow, CSRF state, vault storage, auto-refresh), 5 providers (Google/GitHub/Notion/Slack/Linear), 4 tools, AuthProfileManager — 911 LOC
**Remaining:**
- [ ] **Popup auth handler wiring** — Connect injectable handler to real window.open
- [ ] **Code exchange via wsh** — Server-side OAuth code→token exchange
- [ ] **Google Calendar/Gmail/Drive operations** — Read/write tools for Google APIs
- [ ] **Notion/Slack/Linear read-write tools** — Platform-specific operations
- [ ] **"Connected Apps" UI panel** — Settings section showing connected services
- [ ] **Auth profile management UI** — Profile switching, account management

### Integrations
- [ ] GitHub integration — PR review, issue management, code search
- [ ] Calendar integration — Schedule awareness, meeting prep
- [ ] Email integration — Draft, summarize, triage
- [ ] Slack/Discord — Channel monitoring, response drafting

### Skill Package Registry (Block 17) -- MOSTLY COMPLETE
**Done:** SkillParser, SkillStorage (OPFS), SkillRegistry, SkillRegistryClient (remote search/fetch), 8 tools, metadata extraction, workspace+global discovery — 1770 LOC
**Remaining:**
- [ ] **Skill browser UI panel** — Full browseable UI for discovering/installing skills
- [x] **Skill dependency resolution** — resolveDependencies() checks skills + tools availability
- [x] **Skill verification/signing** — computeSkillHash() (FNV-1a) + verifySkillIntegrity()

### Browser Automation (Block 18) -- PARTIALLY COMPLETE
**Done:** PageSnapshot, AutomationSession (rate limit, selector resolution), AutomationManager (domain allowlist), 8 tools (browser_open/read_page/click/fill/wait/evaluate/list_tabs/close_tab), sensitive field detection — 736 LOC
**Remaining:**
- [x] **browser_select tool** — BrowserSelectTool for dropdown/select elements
- [x] **browser_screenshot tool** — BrowserScreenshotTool with format/fullPage options
- [x] **browser_scroll tool** — BrowserScrollTool with direction/amount/selector
- [ ] **Content script integration** — Real browser automation via extension (not mock)
- [x] **Multi-step workflow chaining** — WorkflowRecorder with addStep/export/clear
- [x] **Automation recipes as skills** — Package automations as installable skills

### Auth Profiles (Block 19) -- MOSTLY COMPLETE
**Done:** AuthProfile + AuthProfileManager, vault-encrypted credentials, CRUD + workspace binding, 3 tools (auth_status/list_profiles/switch_profile) — 353 LOC
**Remaining:**
- [ ] **Profile management UI** — Settings panel for add/edit/remove/switch profiles
- [ ] **OAuth token refresh wiring** — Connect refresh flow to real OAuth providers
- [x] **Profile import/export** — AuthProfileManager.exportProfiles()/importProfiles() (metadata only)
- [x] **Usage tracking per profile** — Cost attribution to specific API keys

### Lifecycle Hooks (Block 20) -- MOSTLY COMPLETE
**Done:** HookPipeline with priority + fail-open, register/unregister/enable, 5 of 6 points wired, audit logger hook — ~120 LOC
- [x] **Wire beforeOutbound hook** — Fires at all 6 return points in run()/runStream(), supports block + modify
- [x] **Wire onSessionStart** — Fires in sendMessage() on first user message
- [x] **Wire onSessionEnd** — Fires in reinit() and clearHistory() when messages exist
- [x] **transformResponse merged into beforeOutbound** — beforeOutbound's modify action covers transformation
- [x] **Hook persistence** — serialize()/deserialize() on HookPipeline with factory-based reconstruction

- [x] **hooks.json persistence** — registerHook(), persistHooks(), restoreHooks(), listHooks() public methods on ClawserAgent; stores per-workspace hook config in localStorage (Sprint 8)

**Remaining:**
- [x] **Skill hook registration** — Skills register hooks via SKILL.md frontmatter (Sprint 10: SkillParser.validateHooks(), inline array-of-objects YAML parsing, 6 valid hook points)
- [ ] **Hook management UI** — Enable/disable/configure hooks in settings

### Routines Engine (Block 21) -- MOSTLY COMPLETE
**Done:** RoutineEngine (cron/event/webhook), guardrails, auto-disable on failures, cron matching, event glob filtering, history tracking, 4 tools, serialization — 598 LOC
**Remaining:**
- [x] **HMAC webhook signature verification** — Validate webhook authenticity (Sprint 9: verifyHmac() with Node.js crypto + Web Crypto fallback, handleWebhook() opts.signature/rawBody)
- [x] **Event bus integration** — Subscribe routines to agent event bus (Sprint 9: connectEventBus/disconnectEventBus on RoutineEngine)
- [x] **routine_history tool** — Expose execution history to agent (Sprint 9: RoutineHistoryTool class)

### Self-Repair (Block 22) -- MOSTLY COMPLETE
**Done:** StuckDetector (6 issue types), SelfRepairEngine with recovery strategies, loop detection, configurable thresholds, repair log, 2 tools — 425 LOC
- [x] **Wire into agent run loop** — Auto-invoke .check() between turns (agent.js:1375, 1598, 1755)
- [x] **Register recovery handlers** — compact (compactContext), inject_message (push system prompt), abort (mark destroyed), fallback_provider (switch to next available)
- [x] **hasHandler() API** — Check if handler registered before overwriting (preserves user-registered handlers)

- [x] **Tool timeout cancellation** — Promise.race timeout wrapper in #executeToolCalls() for browser tools, configurable via `toolTimeout` in init config (Sprint 8)
- [x] **Cost runaway handlers** — pause handler (sets #paused flag, blocks run()/runStream()), downgrade_model handler (switches to last available provider) (Sprint 8)

**Remaining:**
- [x] **Configurable cost runaway threshold** — CostLedger.thresholdUsd + isOverThreshold() + setThreshold()

### Safety Pipeline (Block 23) -- MOSTLY COMPLETE
**Done:** InputSanitizer (8 injection patterns), ToolCallValidator (path traversal, shell injection, URL scheme blocking), LeakDetector (8 secret patterns), SafetyPipeline orchestrator — 259 LOC
- [x] **Wire sanitizeInput to inbound messages** — Applied in run() and runStream() beforeInbound phase
- [x] **Wire ToolCallValidator to tool execution** — Enforced in #executeToolCalls() for MCP tools + BrowserToolRegistry.execute() for browser tools
- [x] **Wire scanOutput to LLM responses** — Scans all 6 return points in run()/runStream() (codex, plain text, streaming)
- [x] **Safety audit logging** — Events logged to eventLog (safety_input_flag, safety_output_blocked, safety_output_redacted, safety_tool_blocked)

- [x] **PolicyEngine** — Configurable rules engine (clawser-policy-engine.js): addRule/removeRule/setEnabled, evaluateInput/evaluateToolCall/evaluateOutput, pattern/tool_name/domain conditions, block/warn/allow/redact actions, priority ordering, JSON serialization, defensive null/regex error handling

### Tool Builder (Block 24) -- MOSTLY COMPLETE
**Done:** DynamicTool, ToolBuilder (build/test/edit/remove/list), version history + rollback, dry-run testing, import/export, 5 tools, trusted flag — 542 LOC
**Remaining:**
- [ ] **Wire sandbox executor** — Connect to andbox Worker sandbox for safe execution
- [x] **OPFS persistence** — Persist dynamic tools across sessions (Sprint 9: persist()/restore() with storage adapter abstraction)
- [x] **tool_promote** — Mark tool as trusted after user review (Sprint 9: ToolPromoteTool + ToolBuilder.promoteTool())
- [ ] **Version diff/comparison UI** — Show changes between tool versions

### Undo/Redo System (Block 25) -- COMPLETE
- [x] UndoManager with turn checkpoint stack (beginTurn, undo, redo)
- [x] TurnCheckpoint — snapshot per turn (history, memory ops, file ops, goal ops)
- [x] recordMemoryOp/recordFileOp/recordGoalOp change tracking
- [x] previewUndo/previewRedo human-readable summaries
- [x] 3 agent tools: UndoTool, RedoTool, UndoStatusTool
- [x] Integration with agent run loop (clawser-agent.js)

### Response Cache (Block 26) -- COMPLETE
- [x] ResponseCache with LRU eviction (500 entries, 30min TTL)
- [x] FNV-1a hash for cache key generation
- [x] Smart skip for tool-call responses (no caching side effects)
- [x] Token/cost savings tracking with stats (hits, misses, hit rate)
- [x] Provider integration in agent chat execution
- [x] Cache config in settings panel (TTL, max entries)

### Intent Router (Block 27) -- COMPLETE
- [x] IntentRouter with pattern-based + heuristic classification
- [x] MessageIntent enum: COMMAND, QUERY, TASK, CHAT, SYSTEM
- [x] PIPELINE_CONFIG per intent (useMemory, useTools, modelHint, maxTokens)
- [x] classifyWithLLM() fallback for ambiguous messages
- [x] addPattern/addOverride/stripOverride extensibility
- [x] 2 agent tools: IntentClassifyTool, IntentOverrideTool

### WASM Tool Sandbox (Block 28) -- COMPLETE
- [x] 3-tier sandbox hierarchy: TRUSTED (main thread), WORKER (Web Worker), WASM (metered)
- [x] WorkerSandbox with timeout + auto-respawn
- [x] WasmSandbox with fuel metering + memory caps
- [x] CapabilityGate with capability-based permission checking
- [x] SandboxManager — unified lifecycle (create/get/execute/terminate)
- [x] SANDBOX_LIMITS per tier (timeout, memory, fuel, output size)
- [x] Integration with ToolBuilder for dynamic tool execution
- [x] 2 agent tools: SandboxRunTool, SandboxStatusTool

### Heartbeat Checklist (Block 29) -- COMPLETE
- [x] HeartbeatRunner with interval scheduling and wake triggers
- [x] Markdown checklist parser (HEARTBEAT.md format)
- [x] Check evaluation with agent context
- [x] Silent-when-healthy alerting (only reports failures)
- [x] Consecutive failure tracking
- [x] Default checklist (context capacity, scheduler, cost, storage, provider reachability)
- [x] Daemon integration via clawser-daemon.js
- [x] 2 agent tools: HeartbeatStatusTool, HeartbeatRunTool

### AI-Integrated Terminal / clawser CLI (Blocks 30-32) -- COMPLETE
- [x] registerClawserCli(registry, getAgent, getShell) in clawser-cli.js
- [x] parseFlags() — full flag parser (short/long flags, booleans, defaults)
- [x] Subcommands: chat, exit, do, config, status, history, clear, tools, model, cost, compact, memory, mcp, session
- [x] One-shot prompting via -p "prompt"
- [x] Global flags: -m (model), --system, --no-stream, --continue, --resume, --tools, --max-turns
- [x] REPL mode entry/exit via __enterAgentMode / __exitAgentMode flags
- [x] Help text with usage examples

### AskUserQuestion Tool (Block 33) -- COMPLETE
- [x] AskUserQuestionTool class in clawser-tools.js (browser_ask_user)
- [x] Structured questions (1-4 per call, 2-4 options each)
- [x] Multi-select support, free-text "Other" option
- [x] Full validation of question structure
- [x] Permission: auto (always allowed — asking, not acting)

### Additional Shell Builtins (Block 34) -- COMPLETE
All 37 new commands implemented in clawser-shell-builtins.js:
- [x] File Operations (8): touch, stat, find, du, basename, dirname, realpath, tree
- [x] Text Processing (9): tr, cut, paste, rev, nl, fold, column, diff, sed
- [x] Generators (6): seq, yes, printf, date, sleep, time
- [x] Shell Session (7): clear, history, alias, unalias, set, unset, read
- [x] Data & Conversion (4): xxd, base64, sha256sum, md5sum
- [x] Process-Like (3): xargs, test, [

### Terminal Sessions (Block 35) -- COMPLETE
- [x] TerminalSessionManager in clawser-terminal-sessions.js
- [x] Session naming, creation, switching, renaming, deletion
- [x] OPFS persistence (meta.json, events.jsonl, state.json)
- [x] Event recording: commands, results, agent prompts/responses, state snapshots
- [x] Session fork (full + from specific event)
- [x] Export: script (.sh), log (text/JSON/JSONL), markdown
- [x] Session replay from event log
- [x] CLI integration: clawser session [list|new|switch|rename|delete|fork|export]

### Tool Management Panel (Block 36) -- COMPLETE
- [x] Dedicated #panelToolMgmt sidebar panel
- [x] Auto-categorization by prefix/source (20+ categories)
- [x] Real-time search with result count
- [x] Filter buttons: All, Enabled, Disabled, Needs Approval
- [x] Per-tool: checkbox, permission badge, description, usage stats
- [x] Per-category: Enable All / Disable All bulk toggles
- [x] Tool detail expansion: full description, parameters, source, radio permission controls
- [x] Global bulk actions: Enable All, Disable All, Reset to Defaults

### Agents as First-Class Entities (Block 37) -- COMPLETE
- [x] AgentStorage class in clawser-agent-storage.js
- [x] Agent definition schema (id, name, provider, model, systemPrompt, tools, guardrails, etc.)
- [x] 5 built-in starter agents (Echo, Chrome AI, Claude Sonnet, Claude Haiku, GPT-4o)
- [x] Storage layers: built-in + global (OPFS) + workspace-scoped (OPFS)
- [x] Active agent per workspace (localStorage)
- [x] Full CRUD: listAll, listGlobal, listWorkspace, load, save, delete, setActive
- [x] SwitchAgentTool + ConsultAgentTool (agent tools)
- [x] @agent-name inline references via clawser-agent-ref.js (MAX_DEPTH=3)

### Developer API
- [x] Plugin API — Formal extension point for third-party tools
- [x] TypeScript definitions — .d.ts files for all modules
- [ ] npm package — Publish core agent as reusable library
- [x] Embedding API — Drop Clawser into any web app

### Skill Ecosystem
- [x] Skill dependency enforcement — Validate requires field
- [x] Skill versioning UI — Show diffs before upgrade
- [ ] Skill marketplace — Browseable catalog with ratings
- [x] Skill templates — Starter kits for common patterns

### Community
- [ ] Skills registry — Launch public skills registry
- [ ] Documentation site — Hosted docs with tutorials
- [x] Demo site — Live demo with Echo provider (no API key)

---

## Phase 7: Virtual Server Subsystem

Turns Clawser into an OS-like platform that can serve HTTP requests entirely in the browser via Service Worker fetch intercept on `/http/{host}[:{port}]/{path}`.

### Architecture
- SW intercepts `/http/` URLs → IndexedDB route lookup → handler execution
- Two execution modes: **page** (full agent/tool/DOM access via MessageChannel relay) and **sw** (fast, limited)
- Four handler types: **function** (JS modules via Blob URL import), **static** (OPFS file serving), **proxy** (URL rewrite + forward), **skill** (SKILL.md server routes)

### Files
| File | Purpose |
|------|---------|
| `web/sw.js` | Modified: `/http/` intercept, parseServerUrl, handleServerRequest, MessageChannel relay |
| `web/clawser-server.js` | ServerManager: route CRUD, handler compilation, SW coordination |
| `web/clawser-server-tools.js` | 8 agent tools (server_list/add/remove/update/start/stop/logs/test) |
| `web/clawser-server.d.ts` | Type definitions |
| `web/clawser-ui-servers.js` | Servers panel UI logic |

### Blocks
- [x] 7.0 — SW Router + Route Table (IndexedDB)
- [x] 7.1 — ServerManager + Function Handlers (Blob URL + dynamic import)
- [x] 7.2 — Static + Proxy Handlers (OPFS serving, MIME detection, directory listing)
- [x] 7.3 — Agent Tools (8 tools registered in workspace lifecycle)
- [x] 7.4 — FetchTool auto-routing + Kernel svc:// integration
- [x] 7.7 — Servers UI Panel (list, add, start/stop, logs)
- [x] 7.8 — Scoping (global + per-workspace routes, workspace priority)
- [x] 7.9 — Types (clawser-server.d.ts)
- [x] 7.5 — Skills-as-Handlers (createSkillHandler + executeSkillHandler in ServerManager)
- [x] 7.6 — SSE Streaming (createSSEResponse + createSSEResponseFromGenerator)
- [x] 7.10 — WebSocket Emulation (SSE + POST bidirectional)

---

## Design Principles

These principles guide development decisions:

1. **Browser-native** — No server required. OPFS for storage, Fetch for network, DOM for UI.
2. **Zero build step** — ES modules loaded directly. No webpack, no npm, no transpilation.
3. **Provider agnostic** — Any LLM backend works. Structured tool calls or code-based execution.
4. **Event-sourced** — Every state change is an event. Full auditability and replay.
5. **Graceful degradation** — Always have a fallback. Streaming -> non-streaming, v2 -> v1, LLM -> truncation.
6. **Workspace isolation** — Projects don't interfere. Separate memory, history, config.
7. **Skills as standard** — Portable agent capabilities via open standard (agentskills.io).
8. **Permission-first** — Tools require explicit permission levels. User approves risky operations.
