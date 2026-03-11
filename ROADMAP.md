# Clawser Roadmap

## Current Status (Mar 2026)

Clawser is a **beta-quality** browser-native AI agent platform. The core runtime is functionally complete with 100+ JS modules (~120K LOC), 70+ tools, and 38+ LLM provider backends. The project transitioned from a Rust/WASM architecture to pure JavaScript. Phase 8 (BrowserMesh) added 30 decentralized mesh modules with 3,710 tests.

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
- Daemon mode with BroadcastChannel tab coordination
- Remote tool integration via wsh protocol (shell exec, file transfer, MCP bridging, CORS proxy)
- Local filesystem mounting via FileSystemAccess API
- Delegation, self-repair, undo, routines, heartbeat, auth profiles
- ARIA accessibility, keyboard shortcuts, light/dark mode, responsive design
- CI/CD pipeline, Docker, Service Worker, PWA
- BrowserMesh P2P: identity, trust, CRDT sync, transport, relay, discovery, consensus, swarm, apps, marketplace

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
| **Phase 8** | BrowserMesh integration — 30 new modules for decentralized mesh: identity, trust, CRDT sync, P2P transport, naming, real transports, resource scheduling, payments, consensus, swarm coordination |
| **OpenClaw Final** | Channel Gateway (`clawser-gateway.js`) — scheduler/routine lane through gateway, kernel tenantId threading, per-channel serialized queues, virtual channel keys, 105 gateway tests |
| **Phase 8.11** | Subsystem wiring + doc-only features — wire code collision fix (21 codes migrated), 11 subsystems wired into bootstrap, SW mesh routing, WebTransport bridge, cross-origin comms, WebRTC mesh, mesh DevTools inspector (5 new modules, 139 new tests) |

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
- [x] **Execution timeout** — Promise.race() with 300s timeout on Codex/andbox sandbox
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

### Shell Improvements -- COMPLETE
- [x] **Variable substitution** — $VAR, ${VAR}, $? fully implemented
- [x] **Glob expansion** — *, ?, [] with POSIX fallback
- [x] ~~Stderr redirect~~ — 2>/dev/null, 2>&1, 2>file fully implemented in executor

### Shell Emulation Layer (Block 1) -- COMPLETE
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
- [x] 92 message types (codegen from YAML spec)
- [x] Ping/pong keepalive
- [x] JS client library (connect, auth, sessions, file transfer, MCP, guest, share, compress, rate, link, copilot, E2E, file channel, policy)
- [x] Browser wsh tools (27 tools)
- [x] Browser wsh CLI (copy-id, suspend, resume, restart, metrics, guest, share, compress, rate, link, copilot, file, policy)
- [x] Pairing system (6-digit codes, tokens)

### Rust CLI Status Matrix

| Command | Status | Notes |
|---------|--------|-------|
| `wsh connect` | Implemented | PTY open/read/write/resize loop via `wsh-client` |
| `wsh <host> <cmd...>` / `wsh exec` | Implemented | Exec channel output relay with remote exit-code propagation |
| `wsh scp` | Implemented | Upload/download via `wsh-client::file_transfer` |
| `wsh tools` | Implemented | MCP discovery via `wsh-client::mcp::discover_tools` |
| `wsh sessions` | Implemented | Server-backed visible-session listing via protocol `SessionListRequest/SessionList` |
| `wsh attach` | Implemented | Attach request/ack flow using last successful connection metadata |
| `wsh detach` | Implemented (marker-based) | Explicit protocol detach via last attached session marker |
| `wsh copy-id` | Limited | Transport path still placeholder/stub |

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
- [x] Metrics request, idle suspend, PTY restart (client + tools + CLI)
- [x] Guest sessions, multi-attach, compression negotiation, rate control
- [x] Cross-session linking, copilot mode, E2E encryption (X25519/AES-GCM)
- [x] Predictive echo, diff-based sync, horizontal scaling, shared sessions
- [x] Structured file channel (stat/list/read/write/mkdir/remove/rename)
- [x] Policy engine (evaluate/update with relay dispatch)

### Phase 5.8–5.12: Audit Fixes — COMPLETE
See [AUDIT.md](AUDIT.md) for detailed security audit fix log.

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
- [x] CORS-free fetch proxy via background worker
- [x] Firefox compatibility (WebExtension APIs, `webextension-polyfill`)
- [x] "Discovered Tools" UI panel with per-tool enable/disable (approval required)

**Phase 6c: WebMCP + BrowserMCP** -- PARTIAL
- [x] Basic WebMCP discovery (`ext_webmcp_discover`) — scan `<meta name="webmcp">`, `<link rel="mcp">`, `navigator.modelContext`, `.well-known/mcp`
- [x] Deep WebMCP integration — auto-register discovered tools (with user approval)
- [x] Evaluate BrowserMCP fork vs standalone
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
- [x] **FileSystemObserver** — Watch mounted dirs for external changes (Chrome 129+)
- [x] **Auto-indexing** — MountableFs.buildIndex() recursive dir tree with maxDepth support
- [x] **Drag-and-drop folder mounting** — Drop folder onto Clawser UI to mount
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
- [x] **SharedWorker host** — shared-worker.js hosting ClawserAgent instance
- [x] **Tab ↔ SharedWorker message protocol** — user_message, stream_chunk, state, shell_exec
- [x] **Web Locks for input arbitration** — InputLockManager with tryAcquire/release/isHeld + navigator.locks fallback

**Phase 2 remaining — Service Worker daemon:**
- [x] **Heartbeat loop in SW** — Periodic wake-up for scheduled job checking
- [x] **Headless agent execution** — SW reads checkpoint, runs agent, saves new checkpoint
- [x] **Background activity log** — EventLog maxSize, query(type/source/limit), summary()
- [x] **"While you were away" summary** — Card shown on tab open after background work

**Phase 3 remaining — Multi-tab + polish:**
- [x] **Multiple tab views** — chat, terminal, activity, workspace, goals as separate views
- [x] **"Agent is busy" cross-tab indicator** — AgentBusyIndicator with setBusy/status via BroadcastChannel
- [x] **Interrupted tool call handling** — BrowserTool.idempotent getter, read-only tools marked idempotent
- [x] **Checkpoint rollback UI** — Browse checkpoint history, restore to previous state

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

### API Key Encryption (Block 5) -- COMPLETE
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
- [x] **Detailed cost dashboard** — Per-model breakdown, time series, cost trends

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
- [x] **Avatar display in chat UI** — Show avatar_url from identity in message bubbles
- [x] **Dedicated identity editor** — Full-featured editor panel (not just settings fields)

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
- [x] **Goal editing UI** — Rename, change priority, edit description inline
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
- [x] **Sub-agent UI** — Inline collapsible display of sub-agent execution in chat

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
- [x] **Charts/visualization** — CSS bar charts for cost, tokens, latency over time
- [x] **Historical time-series storage** — MetricsCollector.rollup(), MetricsTimeSeries (add/query/import/export)
- [x] **Per-conversation and per-goal stats** — MetricsCollector.scopedView(namespace) with prefixed keys
- [x] **Cost over time chart** — Last 7/30 day trends

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
- [x] **Chain editor UI** — Visual fallback chain configuration in workspace settings

### Git as Agent Behavior (Block 12) -- COMPLETE
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

### Web Hardware Peripherals (Block 13) -- COMPLETE
**Done:** SerialPeripheral, BluetoothPeripheral, USBPeripheral, PeripheralManager, 6 tools (hw_list/connect/send/read/disconnect/info) — 961 LOC
**Remaining:**
- [x] **hw_monitor tool** — Real-time device data streaming to agent (Sprint 11: HwMonitorTool class, duration-based data collection)
- [x] **Hardware event forwarding** — Auto-trigger agent on device data arrival (Sprint 11: PeripheralManager.onDeviceData()/offDeviceData()/dispatchDeviceData())
- [x] **Peripheral state persistence** — Survive page reloads for granted devices (Sprint 11: PeripheralManager.saveState()/restoreState() via localStorage)

### Multi-Channel Input (Block 14) -- MOSTLY COMPLETE
**Done:** ChannelManager, InboundMessage normalization, allowlists, formatForChannel, 3 tools (channel_list/send/history), 7 channel types defined — 465 LOC
**Remaining:**
- [x] **Backend relay server** — WebSocket relay + generic webhook receiver (server-side)
- [x] **Telegram bot plugin** — Polling mode implementation
- [x] **Discord/Slack/Matrix plugins** — Gateway/Events API implementations
- [x] **Email plugin** — IMAP polling + SMTP send
- [x] **IRC client** — Protocol implementation
- [x] **Attachment handling** — AttachmentProcessor class with processText(), formatForContext()

### Remote Access Gateway (Block 15) -- COMPLETE
**Done:** PairingManager (6-digit codes, token exchange, expiry), RateLimiter (60/min), GatewayClient, 3 tools (remote_status/pair/revoke) — 482 LOC
**Also done:**
- [x] **Backend gateway server** — POST /message + GET /stream (SSE) endpoints
- [x] **Tunnel integration** — Cloudflare tunnel + ngrok provider abstraction
- [x] **Tunnel URL display** — QR code for mobile scanning
- [x] **Mobile-friendly /remote/ pages** — Static remote UI

### OAuth App Integrations (Block 16) -- COMPLETE
**Done:** OAuthManager (popup flow, CSRF state, vault storage, auto-refresh), 5 providers (Google/GitHub/Notion/Slack/Linear), 4 tools, AuthProfileManager — 911 LOC
**Also done:**
- [x] **Popup auth handler wiring** — OAuthManager.#openPopupFn injectable, connect() calls openPopupFn(authUrl) for popup flow
- [x] **Code exchange via wsh** — Server-side OAuth code→token exchange
- [x] **Google Calendar/Gmail/Drive operations** — Read/write tools for Google APIs
- [x] **Notion/Slack/Linear read-write tools** — Platform-specific operations
- [x] **"Connected Apps" UI panel** — Settings section showing connected services
- [x] **Auth profile management UI** — Profile switching, account management

### Integrations
- [x] GitHub integration — PR review, issue management, code search
- [x] Calendar integration — Schedule awareness, meeting prep
- [x] Email integration — Draft, summarize, triage
- [x] Slack/Discord — Channel monitoring, response drafting

### Skill Package Registry (Block 17) -- COMPLETE
**Done:** SkillParser, SkillStorage (OPFS), SkillRegistry, SkillRegistryClient (remote search/fetch), 8 tools, metadata extraction, workspace+global discovery — 1770 LOC
**Remaining:**
- [x] **Skill browser UI panel** — Full browseable UI for discovering/installing skills (skillBrowseResults container, browse cards, remote search via SkillRegistryClient)
- [x] **Skill dependency resolution** — resolveDependencies() checks skills + tools availability
- [x] **Skill verification/signing** — computeSkillHash() (FNV-1a) + verifySkillIntegrity()

### Browser Automation (Block 18) -- COMPLETE
**Done:** PageSnapshot, AutomationSession (rate limit, selector resolution), AutomationManager (domain allowlist), 8 tools (browser_open/read_page/click/fill/wait/evaluate/list_tabs/close_tab), sensitive field detection — 736 LOC
**Remaining:**
- [x] **browser_select tool** — BrowserSelectTool for dropdown/select elements
- [x] **browser_screenshot tool** — BrowserScreenshotTool with format/fullPage options
- [x] **browser_scroll tool** — BrowserScrollTool with direction/amount/selector
- [x] **Content script integration** — Real browser automation via extension: content.js injected via manifest + scripting.executeScript, ExtensionRpcClient, 34 ext_* tools
- [x] **Multi-step workflow chaining** — WorkflowRecorder with addStep/export/clear
- [x] **Automation recipes as skills** — Package automations as installable skills

### Auth Profiles (Block 19) -- COMPLETE
**Done:** AuthProfile + AuthProfileManager, vault-encrypted credentials, CRUD + workspace binding, 3 tools (auth_status/list_profiles/switch_profile) — 353 LOC
**Remaining:**
- [x] **Profile management UI** — renderAuthProfilesSection() in config panel with add/remove/switch, active toggle, provider display
- [x] **OAuth token refresh wiring** — OAuthManager auto-refresh on expired tokens via injectable #refreshTokenFn, getConnection() checks expired + refreshToken
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
- [x] **Hook management UI** — Enable/disable/configure hooks in settings

### Routines Engine (Block 21) -- COMPLETE
**Done:** RoutineEngine (cron/event/webhook), guardrails, auto-disable on failures, cron matching, event glob filtering, history tracking, 4 tools, serialization — 598 LOC
**Remaining:**
- [x] **HMAC webhook signature verification** — Validate webhook authenticity (Sprint 9: verifyHmac() with Node.js crypto + Web Crypto fallback, handleWebhook() opts.signature/rawBody)
- [x] **Event bus integration** — Subscribe routines to agent event bus (Sprint 9: connectEventBus/disconnectEventBus on RoutineEngine)
- [x] **routine_history tool** — Expose execution history to agent (Sprint 9: RoutineHistoryTool class)

### Self-Repair (Block 22) -- COMPLETE
**Done:** StuckDetector (6 issue types), SelfRepairEngine with recovery strategies, loop detection, configurable thresholds, repair log, 2 tools — 425 LOC
- [x] **Wire into agent run loop** — Auto-invoke .check() between turns (agent.js:1375, 1598, 1755)
- [x] **Register recovery handlers** — compact (compactContext), inject_message (push system prompt), abort (mark destroyed), fallback_provider (switch to next available)
- [x] **hasHandler() API** — Check if handler registered before overwriting (preserves user-registered handlers)

- [x] **Tool timeout cancellation** — Promise.race timeout wrapper in #executeToolCalls() for browser tools, configurable via `toolTimeout` in init config (Sprint 8)
- [x] **Cost runaway handlers** — pause handler (sets #paused flag, blocks run()/runStream()), downgrade_model handler (switches to last available provider) (Sprint 8)

**Remaining:**
- [x] **Configurable cost runaway threshold** — CostLedger.thresholdUsd + isOverThreshold() + setThreshold()

### Safety Pipeline (Block 23) -- COMPLETE
**Done:** InputSanitizer (8 injection patterns), ToolCallValidator (path traversal, shell injection, URL scheme blocking), LeakDetector (8 secret patterns), SafetyPipeline orchestrator — 259 LOC
- [x] **Wire sanitizeInput to inbound messages** — Applied in run() and runStream() beforeInbound phase
- [x] **Wire ToolCallValidator to tool execution** — Enforced in #executeToolCalls() for MCP tools + BrowserToolRegistry.execute() for browser tools
- [x] **Wire scanOutput to LLM responses** — Scans all 6 return points in run()/runStream() (codex, plain text, streaming)
- [x] **Safety audit logging** — Events logged to eventLog (safety_input_flag, safety_output_blocked, safety_output_redacted, safety_tool_blocked)

- [x] **PolicyEngine** — Configurable rules engine (clawser-policy-engine.js): addRule/removeRule/setEnabled, evaluateInput/evaluateToolCall/evaluateOutput, pattern/tool_name/domain conditions, block/warn/allow/redact actions, priority ordering, JSON serialization, defensive null/regex error handling

### Tool Builder (Block 24) -- MOSTLY COMPLETE
**Done:** DynamicTool, ToolBuilder (build/test/edit/remove/list), version history + rollback, dry-run testing, import/export, 5 tools, trusted flag — 542 LOC
**Remaining:**
- [x] **Wire sandbox executor** — ToolBuilder constructed with sandbox fn in clawser-app.js (createSandbox from packages-andbox.js, evaluate + dispose)
- [x] **OPFS persistence** — Persist dynamic tools across sessions (Sprint 9: persist()/restore() with storage adapter abstraction)
- [x] **tool_promote** — Mark tool as trusted after user review (Sprint 9: ToolPromoteTool + ToolBuilder.promoteTool())
- [x] **Version diff/comparison UI** — Show changes between tool versions

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
- [x] npm package — Publish core agent as reusable library
- [x] Embedding API — Drop Clawser into any web app

### Skill Ecosystem
- [x] Skill dependency enforcement — Validate requires field
- [x] Skill versioning UI — Show diffs before upgrade
- [x] Skill marketplace — Browseable catalog with ratings
- [x] Skill templates — Starter kits for common patterns

### Community
- [x] Skills registry — Launch public skills registry
- [x] Documentation site — Hosted docs with tutorials
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

## Phase 7A: Remote Runtime Access Expansion (wsh)

Priority: turn `wsh` from "remote shell and relay protocol" into a coherent remote-runtime fabric for hosts, browser peers, and eventually browser-hosted Linux guests.

This phase sits before BrowserMesh on purpose. BrowserMesh is about decentralized identity, transport, and multi-peer coordination at mesh scale. `wsh` is the operator/runtime access plane: authentication, shell/file/tool sessions, relay-mediated reachability, and remote control of specific runtimes. The two systems complement each other, but `wsh` should be operationally solid on its own before deeper mesh abstractions depend on it.

### Why This Matters

Clawser now has three distinct remote-access stories, and they are no longer theoretical:

1. **Direct host access** — a local or remote machine runs `wsh-server`; a CLI connects and gets a real PTY.
2. **Relay-mediated browser access** — a live Clawser tab registers through a relay; a CLI reverse-connects into it and gets a browser-backed interactive terminal.
3. **Peer capability routing** — reverse peers can expose shell, filesystem, and tool surfaces, not just a terminal.

Those are enough to justify treating `wsh` as a first-class subsystem, not just a transport detail.

The remaining gaps are mostly about symmetry and runtime diversity:

- the browser peer path is now materially ahead of the Rust reverse-peer path
- the relay protocol can broker peers, but not every peer type has an equally complete session runtime
- browser-backed terminals work for normal shell workloads, but are still emulated PTY-like terminals, not kernel PTYs
- there is not yet a clean way to treat a browser-hosted Linux guest as a `wsh` peer, even though the surrounding design now makes that feasible

### Current Topology Matrix

| Source | Target | Path | Status | Notes |
|--------|--------|------|--------|-------|
| Rust CLI | `wsh-server` host | Direct | **Complete** | Real host PTY, native Unix semantics, best terminal fidelity |
| Rust CLI | `wsh-server` host | Via relay | **Partial by design** | Reachability model exists, but direct host connection is the preferred path when possible |
| Rust CLI | Clawser browser tab | Via relay reverse-connect | **Complete for interactive shell workloads** | Browser-backed virtual terminal, capability-gated shell/tools/fs |
| Browser tab | Relay | Reverse registration | **Complete** | WebTransport-first, secure WebSocket fallback |
| Rust CLI | Relay-registered peer list | Via relay | **Complete** | `wsh peers` lists available reverse peers |
| Rust CLI | Rust CLI reverse peer | Via relay | **Partial** | Registration exists; incoming session runtime is still much less complete than the browser path |
| Any `wsh` client | Arbitrary peer type | Via relay | **Protocol-ready, runtime-specific** | Depends on whether that peer implements incoming `Open` / `SessionData` / `Resize` / `Signal` correctly |
| Rust CLI | Browser-hosted Linux guest | Via relay | **Roadmap** | Best implemented as a new peer backend, not a special case inside the existing browser shell |

### What `wsh` Is Good For

- **Operator access to real hosts** — when you need a normal shell, file transfer, MCP bridge, or structured remote session with real PTY semantics.
- **Reaching private/browser-bound runtimes** — when the target is a live browser tab, a local-only environment, or a machine that can dial out to a relay more easily than it can accept inbound connections.
- **Capability-scoped remote control** — when you want to expose shell access without also exposing filesystem access, or tools without exposing a shell.
- **Unified auth and trust-on-first-use** — when you want the same identity, `authorized_keys`, and known-host model across host and browser targets.
- **Support and debugging workflows** — reproducing an issue inside the exact browser workspace or remote runtime the user is actually running.
- **Future "runtime as peer" designs** — VM guests, lightweight sandboxes, and headless worker-backed environments all fit the session model better than ad hoc remote APIs.

### What `wsh` Is Not Good For

- **Pixel remoting** — it is not RDP, VNC, or full desktop streaming.
- **Arbitrary GUI apps** — even with a browser-hosted Linux VM, `wsh` is a terminal/control plane first.
- **Perfect PTY emulation in browser-only code** — browser terminals can be excellent, but they are still emulating PTY behavior unless backed by a real kernel PTY.
- **Bulk media/data replication** — BrowserMesh, CRDT sync, content-addressed transfer, and specialized file protocols are better fits for multi-party data distribution.
- **Topology-wide peer discovery and coordination** — that is BrowserMesh territory. `wsh` should remain focused on sessions, transport reachability, auth, and runtime access.

### Design Principles For The Next `wsh` Layer

1. **Preserve the distinction between real PTYs and emulated terminals.**
   - `wsh-server` should remain the source of truth for real host PTY semantics.
   - Browser-backed and VM-backed terminals should advertise themselves honestly as virtual session backends.

2. **Make peer type explicit.**
   - A reverse peer should not just be "a thing on the relay."
   - It should describe whether it is a browser shell, host runtime, VM guest console, worker sandbox, or something else.

3. **Keep the session API unified where possible.**
   - `Open`, `SessionData`, `Resize`, `Signal`, `Exit`, `Close`, `Attach`, replay, and capability advertisement should stay common across peer types.
   - Differences should live in backend adapters, not in ad hoc command forks.

4. **Prefer small capability sets over implicit power.**
   - Shell, filesystem, tools, gateway, and future VM/network capabilities should remain individually exposable.

5. **Do not make BrowserMesh a prerequisite for `wsh`.**
   - Relay-based `wsh` must remain usable in a simpler client/server deployment.
   - BrowserMesh can later enrich peer discovery and routing, but should not be required for basic remote access.

### Near-Term Status Interpretation

The direct-host path is the "production-grade" one:

- `wsh connect` to `wsh-server` is the right answer when the target is a normal machine you control.
- It gives a real PTY, the clearest failure modes, and the least semantic mismatch.

The browser reverse path is now "operator-usable":

- good for shell commands, normal line-oriented workflows, and capability-gated remote access to a live tab
- not intended as a replacement for a real Unix PTY

The Rust reverse-peer path now has first-class parity:

- `wsh-agent` provides long-lived reverse-host presence
- reverse peers expose PTY/exec/file/tool/gateway capability metadata through the shared runtime model
- attach/replay semantics and route failure reporting are aligned with the browser reverse-peer path

The remaining roadmap work is now about convergence and breadth, not basic reverse-host viability.

### Phase 7A Status Dashboard (March 10, 2026)

- `[x]` Canonical runtime contracts, peer metadata, and protocol bindings are in place.
- `[x]` Browser reverse peers are interactive and capability-gated through the shared runtime model.
- `[x]` Reverse-host runtime exists with `wsh-agent`, relay registration, PTY/exec/file/tool/gateway exposure, shared peer metadata, and user-level startup/install support.
- `[x]` Attach/replay and route robustness are now uniform across the supported Phase 7A backends, with backend-specific replay modes surfaced explicitly.
- `[~]` BrowserMesh naming, policy, and trust integration are partially landed; template/preset mapping, scope translation, and denial provenance in the broker/UI/audit path are now implemented, while richer trust inputs are still open.
- `[~]` The remote UI and CLI now consume the shared runtime model, and the topology/support/self-check docs are in place, but remaining duplicate surfaces are not fully closed.
- `[~]` Gateway/service/deploy/automation/filesystem/audit convergence is underway and partly implemented, with compute routing, broker-backed Netway gateways plus gateway audit telemetry, virtual-server service advertising, and safe remote-mount detachment now landed.
- `[~]` VM peer support exists as a browser-side `vm-console` backend and runtime scaffold, but the MVP is not yet complete.
- `[ ]` Final readiness verification is still open.

Committed Phase 7A work already includes:

- canonical `RemoteIdentity` / `RemotePeerDescriptor` / `ReachabilityDescriptor` / `SessionTarget`
- richer `wsh` peer metadata and `wsh peers --json`
- shared runtime registry, policy adapter, and session broker
- reverse-host `wsh-agent`
- broker-backed remote shell/file/service UI
- browser virtual file sessions for reverse peers
- route health tracking and backend-aware session hints
- browser-side `vm-console` backend hooks and runtime registry plumbing

### Phase 7A.1: Documented Runtime Modes

Goal: make the topology legible to contributors and users so the system stops looking more complete or more uniform than it really is.

- [ ] Add a single canonical `wsh` topology diagram to docs: direct host, relay browser peer, relay host peer, future VM peer
- [x] Split protocol terms clearly:
  - `direct host session`
  - `reverse peer`
  - `virtual terminal`
  - `real PTY`
  - `peer capability`
- [x] Add a support matrix to `docs/WSH-INTO-CLAWSER.md` and `docs/CLI.md`
- [x] Make the browser/runtime distinction visible in the CLI:
  - direct host sessions should say `PTY`
  - browser-backed sessions should say `virtual terminal`
- [x] Expose peer backend metadata in `wsh peers`
  - example future fields: `peer_type`, `shell_backend`, `data_mode`

Why first:

- current implementation status is now nuanced enough that "remote shell works" is too vague to be trustworthy documentation
- BrowserMesh planning will be cleaner if `wsh` topology is explicit before mesh routing starts depending on it

### Phase 7A.2: Reverse Host Access For Non-Browser Peers

Goal: make "remote into a local machine via relay" a first-class, symmetric workflow.

This is the missing inverse of the browser work. Today, if a local machine can accept inbound access, the right answer is still `wsh-server` direct connect. But there are real cases where the host can dial out to a relay and cannot or should not expose a public inbound listener:

- laptops behind NAT
- ephemeral dev environments
- CI/debug sandboxes
- "support me" sessions initiated from the target machine outward

Required work:

- [~] Implement a real incoming session runtime for Rust reverse peers
  - replace the current placeholder loop in `crates/wsh-cli/src/commands/relay.rs`
  - accept incoming `Open`
  - create a session backend
  - bridge `SessionData`, `Resize`, `Signal`, `Exit`, and `Close`
- [x] Decide the Rust reverse peer form factor:
  - minimal: CLI process acts as the peer while it is running
  - better: lightweight `wsh-agent` / `wsh-peer` daemon for persistent reverse presence
- [x] Support two backend modes for a reverse host peer:
  - **host PTY mode** — spawn a real PTY locally and expose it via relay
  - **exec/file/tool mode** — expose non-interactive capabilities without full shell access
- [x] Add peer capability policy for host reverse peers
  - shell
  - exec
  - file transfer
  - tools / MCP
  - optional gateway/network features
- [x] Add host peer identity labels so relay listings distinguish:
  - browser tab
  - host agent
  - headless daemon
- [~] Add lifecycle semantics for reverse host peers:
  - manual foreground registration
  - long-lived daemon registration
  - reconnect and reattach after network flap

Success criteria:

- `wsh reverse <relay>` on a local machine can expose a real local PTY through the relay
- another CLI can `wsh reverse-connect <fingerprint> <relay>` into that machine and get an interactive shell
- the experience is materially equivalent to direct `wsh connect`, minus the extra relay hop

Non-goals:

- turning relay mode into the preferred path for machines that are already directly reachable
- hiding the fact that relay mode is operationally more complex than direct host mode

### Phase 7A.3: Peer Types And Capability Contracts

Goal: stop treating all peers as morally the same when they clearly are not.

Proposed peer classes:

- **Host peer**
  - backed by a real OS process environment
  - can expose PTY, exec, file, MCP, gateway
- **Browser shell peer**
  - backed by `ClawserShell`
  - exposes virtual terminal semantics, browser filesystem, browser tools
- **VM guest peer**
  - backed by a browser-hosted emulator/guest OS
  - can expose guest console, optionally guest filesystem/network capabilities
- **Worker/sandbox peer**
  - backed by a headless JS/Worker runtime
  - useful for compute and tool hosting, not necessarily interactive shell

Protocol additions likely needed:

- [ ] `peer_type` field in reverse registration and peer listing
- [ ] `session_backend` or `shell_backend`
  - `pty`
  - `virtual-shell`
  - `vm-console`
  - `exec-only`
- [ ] capability refinements
  - `shell`
  - `pty`
  - `virtual_terminal`
  - `fs`
  - `tools`
  - `mcp`
  - `gateway`
  - `vm_console`
  - `vm_control`
- [ ] optional UX hints
  - `recommended_transport`
  - `attach_supported`
  - `predictive_echo_supported`
  - `term_sync_supported`

Why this matters:

- the CLI can present more honest UX
- policy can become capability-driven rather than product-name-driven
- future VM and worker peers become natural extensions instead of hacks

### Phase 7A.4: Direct Peer Access vs Relay-Mediated Peer Access

Goal: clarify where `wsh` should and should not expand.

Current recommendation:

- keep relay-mediated reverse connections as the main `wsh` peer model
- do not rush into direct peer-to-peer `wsh` transports until there is a concrete operational need

Rationale:

- the relay already solves discovery, auth rendezvous, and NAT reachability for the current product
- direct peer-to-peer `wsh` would add another transport matrix on top of BrowserMesh and WebRTC
- BrowserMesh is the more natural place for future decentralized peer discovery and routing

Planned boundaries:

- [ ] `wsh` remains the session/control plane
- [ ] BrowserMesh may later supply peer discovery, trust, or route selection
- [ ] BrowserMesh should not replace the `wsh` session model itself
- [ ] if direct peer-to-peer `wsh` is ever added, it should be a transport backend under the same session protocol, not a new product surface

### Phase 7A.5: BrowserMesh Integration Contract For `wsh`

Goal: define exactly how `wsh` integrates with the existing peer-to-peer architecture so the two systems compose cleanly without duplicating identity, discovery, relay, policy, or session logic.

This section exists because the current codebase already has most of the raw ingredients:

- `ClawserPod` as the runtime root
- mesh identity and wallet management
- mesh peer registry and discovery
- mesh transport negotiation
- mesh relay client
- mesh ACL and trust subsystems
- a `wsh` identity bridge
- a separate, working `wsh` session/auth/relay subsystem

What is still missing is the **contract**: when a mesh peer is discovered, how does it become a `wsh` target? When a `wsh` peer is listed, how does it appear inside the mesh worldview? When trust and ACL exist in both places, which one decides what?

The roadmap below answers that.

#### Layer Ownership

The first rule is to preserve a strict separation of concerns.

**BrowserMesh owns:**

- identity graph and pod identity lifecycle
- peer discovery
- trust scoring
- ACL / invitation / roster models
- route hints and topology knowledge
- decentralized transport negotiation
- resource and service advertisement

**`wsh` owns:**

- endpoint authentication and session handshake
- session types (`pty`, `exec`, `file`, MCP/tool, gateway)
- attach/replay/resume semantics
- reverse-peer registration and reverse-connect flow
- channel multiplexing and terminal/file/tool transport
- direct host access and relay-mediated operator access

**Shared responsibility:**

- peer metadata and reachability description
- identity conversion / reconciliation
- policy mapping between mesh scopes and `wsh` capability exposure
- transport selection when multiple viable paths exist

#### Core Architectural Rule

BrowserMesh may help discover, rank, and route to a peer.

It must **not** replace `wsh` session semantics.

In practice that means:

- BrowserMesh can tell Clawser *which* peer to talk to and *which path is available*
- `wsh` still decides *how the remote session is authenticated and opened*

This preserves one session model instead of creating:

- a mesh-native shell session model
- a `wsh` shell session model
- and a constant translation problem between them

#### Canonical Runtime Objects

To integrate the two stacks cleanly, the roadmap needs one shared vocabulary.

##### 1. `RemoteIdentity`

Represents the canonical identity of a remote runtime.

Required properties:

- canonical identity ID (base64url pod ID)
- `wsh` fingerprint form (hex or short fingerprint for CLI compatibility)
- identity links / aliases
- display label
- trust snapshot

Source of truth:

- BrowserMesh identity system
- bridged to `wsh` via `clawser-mesh-wsh-bridge.js`

Rule:

- a remote runtime should never have separate "mesh identity" and "`wsh` identity" records that drift independently

##### 2. `RemotePeerDescriptor`

Represents one reachable peer/runtime regardless of how it was discovered.

Required properties:

- identity reference
- peer label / human-friendly name
- `peer_type`
  - `host`
  - `browser-shell`
  - `vm-guest`
  - `worker`
- `shell_backend`
  - `pty`
  - `virtual-shell`
  - `vm-console`
  - `exec-only`
- capabilities
  - `shell`
  - `pty`
  - `virtual_terminal`
  - `fs`
  - `tools`
  - `mcp`
  - `gateway`
  - `vm_console`
  - `vm_control`
- trust and policy summary
- last-seen / liveness
- source provenance
  - mesh discovery
  - mesh relay
  - `wsh` relay
  - manual bookmark
  - direct host config

Rule:

- this should become the single row model used by peer listings, peer pickers, and future remote-runtime UIs

##### 3. `ReachabilityDescriptor`

Represents how a peer can be reached right now.

Required properties:

- `direct_wsh` endpoint(s), if any
- reverse peer registration state, if any
- shared relay coordinates, if any
- mesh route hints, if any
- supported transports
  - `webrtc`
  - `wsh-wt`
  - `wsh-ws`
  - future `wsh-over-mesh-stream`
- auth expectations
  - TOFU host key
  - direct identity match
  - relay-mediated peer accept

Rule:

- discovery and reachability are not the same thing
- one peer can have multiple reachability options at the same time

##### 4. `SessionTarget`

Represents the resolved result of selecting one peer plus one access path.

Required properties:

- selected peer descriptor
- selected transport path
- selected relay, if any
- selected session backend
- session intent
  - interactive shell
  - exec
  - file
  - tool/MCP
  - gateway/network

Rule:

- all connect flows should resolve into this object before opening a session

#### Runtime Composition Inside Clawser

The clean composition point is `ClawserPod`.

`ClawserPod` already owns:

- peer node
- discovery manager
- transport negotiator
- relay client
- sync, files, marketplace, quotas, payments, etc.

That makes it the correct place to host the new integration surfaces.

Proposed new modules:

- [ ] `web/clawser-remote-runtime-registry.js`
  - merges mesh-discovered peers, `wsh` reverse peers, and direct host bookmarks into canonical `RemotePeerDescriptor` records
- [ ] `web/clawser-wsh-session-broker.js`
  - resolves a `SessionTarget` and opens the appropriate `wsh` session path
- [ ] `web/clawser-mesh-wsh-policy-adapter.js`
  - maps mesh ACL/trust state to `wsh` exposure and session-policy decisions
- [ ] `web/clawser-mesh-wsh-reachability.js`
  - computes `ReachabilityDescriptor` objects from discovery + relay + direct config inputs
- [ ] `web/clawser-mesh-wsh-peer-sync.js`
  - consumes `wsh` relay registrations and feeds them into the runtime registry

CLI-side or shared protocol work likely needed:

- [ ] extend `web/packages/wsh/spec/wsh-v1.yaml`
  - peer type metadata
  - backend metadata
  - capability refinements
- [ ] add Rust-side peer descriptor support in `wsh-client` / `wsh-cli`
- [ ] add JSON output format for machine-readable peer descriptors

#### Discovery Unification Plan

Today, peer knowledge is fragmented:

- BrowserMesh discovery knows about pods and peer capabilities
- the mesh relay knows about signaled peers
- the `wsh` relay knows about reverse peers
- direct `wsh` host targets are often entered manually

That fragmentation is normal at this stage, but the roadmap should converge it.

##### Discovery Inputs

The future `RemoteRuntimeRegistry` should ingest:

- mesh `DiscoveryManager` records
- `MeshPeerManager` live connection state
- `MeshRelayClient` presence announcements
- `wsh peers` reverse peer listings
- local direct-host bookmarks / known hosts
- future VM/runtime advertisements

##### Merge Rules

- merge by canonical identity when there is a strong identity link
- when only weak evidence exists, keep separate records until verified
- never merge two peers only because they share a human label
- preserve source provenance for each merged field

##### Verification Requirements

- [ ] test merging mesh and `wsh` identities via `MeshWshBridge`
- [ ] test duplicate suppression
- [ ] test conflicting peer metadata from different sources
- [ ] test partial peer descriptors that gradually become fully resolved

#### Policy And Trust Handoff

This is where "no holes" matters most.

There are at least four distinct policy layers, and the roadmap must keep them separate:

##### Layer 1: Discovery Visibility

Question:

- may this peer be shown to me at all?

Owned by:

- BrowserMesh discovery / ACL / invitation / trust layer

##### Layer 2: Reachability And Relay Use

Question:

- may I use this relay or route to reach that peer?

Owned by:

- mesh relay policy
- `wsh` relay policy
- trust thresholds
- payment / quota policies if enabled

##### Layer 3: Session Admission

Question:

- once I can reach the peer, may I open a shell/file/tool session?

Owned by:

- `wsh` session admission
- reverse peer capability exposure
- host `authorized_keys` / key options
- browser local reverse-peer policy

##### Layer 4: In-Session Capability Scope

Question:

- after the session opens, what exactly may I do?

Owned by:

- `wsh` capability gating
- mesh ACL-derived defaults, where relevant
- peer-local policy / workspace policy / VM policy

##### Integration Rule

Mesh ACL and trust may inform or prefilter `wsh` access.

They must not silently bypass `wsh` authentication or capability checks.

Examples:

- a mesh ACL may hide a peer from discovery, but cannot make `authorized_keys` unnecessary on a host peer
- a trust score may rank a relay higher, but cannot replace endpoint authentication
- a browser permission preset may expose only tools, but cannot be overridden by a mesh hint alone

##### Planned Deliverables

- [ ] map mesh scope templates to `wsh` exposure presets
- [ ] define a canonical policy translation table
- [ ] document the precedence order when mesh and `wsh` policies disagree
- [ ] add audit logging when one layer blocks something another layer would have allowed

#### Transport And Routing Strategy

This is the most important implementation choice.

The roadmap should be explicit about staged transport integration rather than implying everything will converge at once.

##### Stage 1: Mesh For Discovery, `wsh` For Sessions

This should be the immediate integration model.

Behavior:

- BrowserMesh discovers peers, trust, and route hints
- `wsh` opens sessions using the existing direct or relay-mediated paths
- mesh data does not carry shell session traffic yet

Why:

- lowest risk
- reuses the working `wsh` session/auth model
- avoids premature duplication of session transport logic

##### Stage 2: Optional `wsh` Over Mesh Streams

This should be treated as a later optimization/extension, not the starting point.

Behavior:

- BrowserMesh stream transport becomes an optional substrate for carrying `wsh` session envelopes
- `wsh` session semantics stay unchanged
- the transport layer changes, not the session model

Why:

- lets WebRTC/mesh links carry shell/file/tool traffic when appropriate
- keeps one session protocol instead of inventing a mesh-native session variant

Prerequisites:

- stable shared peer descriptors
- stable session broker
- clear transport capability advertisement
- attach/replay semantics that work above an abstract transport

##### Stage 3: Mesh-Assisted Route Selection

Behavior:

- a connect attempt can choose among:
  - direct host endpoint
  - `wsh` relay reverse peer
  - mesh-assisted route
  - future `wsh-over-mesh-stream`

Selection inputs:

- trust score
- latency
- peer type
- capability match
- relay availability
- session intent

#### Session Routing Algorithm

The roadmap should lock down the decision order so implementations and tests can target something concrete.

Recommended first-pass algorithm:

1. **Resolve peer identity**
   - from user target, bookmark, name, fingerprint, or peer picker
2. **Build merged peer descriptor**
   - from all discovery sources
3. **Compute allowed reachability paths**
   - remove paths blocked by ACL, trust, missing capability, or relay policy
4. **Match session intent**
   - interactive shell
   - exec
   - file
   - tool/MCP
5. **Prefer highest-fidelity backend**
   - real PTY host
   - reverse host PTY
   - browser virtual shell
   - VM console
6. **Select best transport path**
   - direct host
   - reverse via relay
   - future mesh stream
7. **Open `wsh` session**
   - using one common session broker
8. **Record outcome**
   - update peer liveness, trust evidence, route health, and audit log

This algorithm should be shared between:

- CLI peer selection flows
- browser UI peer pickers
- future automation / agent routing decisions

#### Relay Convergence And Separation

There are two relay stories in the codebase today:

- BrowserMesh relay/signaling
- `wsh` relay for reverse peers and sessions

The roadmap should treat them as:

- **logically separate today**
- **optionally co-deployable later**

That means:

- the system must not assume one relay implementation replaces the other immediately
- a future deployment may host both services behind one operator endpoint
- but the product should keep their responsibilities distinct until the integration contract is proven

Recommended rule:

- BrowserMesh relay handles discovery/signaling/topology concerns
- `wsh` relay handles session rendezvous and reverse-connect session traffic

Possible later convergence:

- shared operator deployment
- shared identity/trust database
- shared admission policy
- separate logical protocols

#### Integration With Existing BrowserMesh Phases

This roadmap should explicitly map onto the existing BrowserMesh phases so the work can be scheduled and verified without ambiguity.

##### Depends On Phase 8.1

- identity convergence
- trust model
- transport negotiation
- relay presence basics

##### Depends On Phase 8.2

- ACL / remote access control
- streams and file transfer concepts
- name resolution and user-facing peer addressing

##### Depends On Phase 8.7

- mature transport backend inventory
- real transport probing and upgrade policy

##### Depends On Phase 9

- public BrowserMesh package surface should expose stable peer/runtime metadata once the contract is proven internally

#### Verification Matrix For The Integration Contract

This should be treated as mandatory roadmap scope, not optional polish.

##### Identity And Descriptor Verification

- [ ] one mesh identity and one `wsh` identity map to one canonical remote identity
- [ ] mesh and `wsh` peer records merge deterministically
- [ ] conflicting metadata is surfaced, not silently flattened
- [ ] peer records survive reload / reconnect / relay re-registration

##### Policy Verification

- [ ] mesh ACL denial prevents peer selection
- [ ] relay policy denial blocks route selection with an explainable error
- [ ] `wsh` auth denial still blocks session open even if mesh trust is high
- [ ] capability mismatch blocks the right session kinds

##### Routing Verification

- [ ] direct host chosen when available and appropriate
- [ ] reverse relay path chosen when direct host is unavailable
- [ ] browser peer chosen only for workloads it can actually serve
- [ ] future VM peer chosen only when the requested capability/backend fits

##### Session Verification

- [ ] open/resize/signal/close work through each supported path
- [x] attach/replay/reattach work through each supported path
- [x] peer metadata shown to operator matches actual backend behavior

##### Failure-Mode Verification

- [ ] stale discovery record does not create phantom reachability
- [x] relay drop triggers resumable or explainable failure behavior
- [ ] conflicting relays do not corrupt the peer descriptor
- [ ] identity-link mismatch does not merge unrelated peers

#### Deliverables Required Before Calling The Integration Complete

- [ ] shared peer descriptor schema
- [ ] remote runtime registry
- [ ] session broker
- [ ] policy adapter between mesh and `wsh`
- [ ] deterministic routing algorithm
- [ ] full integration test matrix across discovery, policy, transport, and session layers

### Phase 7A.6: Browser-Hosted Linux Guest As A `wsh` Peer

Goal: support an entire Linux environment running inside the browser and expose it through the same relay/peer model as other `wsh` targets.

This is feasible in principle now.

Relevant prior art:

- JSLinux / TinyEMU can boot real Linux userlands in-browser
- v86 can boot Linux guests and exposes serial-console-oriented interaction patterns

The key design choice is **what exactly becomes the peer**.

There are two credible models:

#### Model A: VM Console Peer

The browser remains the peer; the VM is a backend runtime behind it.

- Clawser registers as a reverse peer as it already does today
- instead of routing shell traffic into `ClawserShell`, it routes it into the VM console
- the CLI still sees "a peer on the relay"
- peer metadata says something like `peer_type=vm-guest`, `shell_backend=vm-console`

Advantages:

- fits the current reverse-browser architecture cleanly
- no guest-side `wsh-server` packaging required
- simpler to prototype with v86/JSLinux serial console or terminal output

Limitations:

- still only as good as the exposed console abstraction
- filesystem, process, and networking operations are guest-specific and need adapters
- fidelity depends on the emulator’s console surface

#### Model B: Full Guest `wsh-server`

The guest Linux distro becomes a real host from `wsh`’s perspective.

- boot the Linux guest in the browser
- run a native `wsh-server` inside the guest
- either give it guest networking or bridge it through the browser host
- treat it as a direct or relay-registered host target

Advantages:

- best semantic fidelity
- real PTY behavior inside the guest
- the guest can look like a normal Unix host to `wsh`

Limitations:

- much more complex bootstrapping
- guest networking and key management become real infrastructure problems
- substantially heavier startup and persistence story

Recommended sequence:

- [ ] **First** build Model A as a new browser peer backend
- [ ] **Later** evaluate Model B if there is a need for true Unix fidelity inside the guest

### Phase 7A.7: VM Peer MVP

Goal: prove that a browser-hosted Linux guest can be reached through `wsh` without re-architecting the whole system.

Scope:

- [x] Introduce a new browser-side terminal backend, e.g. `VmTerminalSession`
- [x] Add a runtime selector:
  - `ClawserShell`
  - `VM console`
- [x] Wire `SessionData` to the VM console/serial stream
- [x] Wire `Resize` where supported by the emulator
- [x] Support `Ctrl+C`, `Ctrl+D`, and attach/replay if practical
- [x] Advertise guest-specific capabilities conservatively
- [x] Add explicit UX labels so operators know they are connecting to a VM guest, not the browser shell

Stretch goals:

- [ ] guest filesystem bridge
- [ ] upload/download into the guest
- [ ] VM lifecycle controls (`start`, `stop`, `reset`, `snapshot`)
- [ ] distro/image chooser

Success criteria:

- a browser-hosted Linux guest appears in `wsh peers`
- `wsh reverse-connect` opens an interactive guest console
- normal line-oriented Linux workflows are usable through the relay

### Phase 7A.8: VM Peer Productionization

Goal: decide whether browser-hosted Linux should remain a "console peer" feature or graduate into a real operator/runtime substrate.

Questions to answer:

- should the guest be ephemeral per tab, persisted per workspace, or restored from snapshots?
- should the guest share Clawser identity material or have its own guest-side keys?
- does the product want "developer sandbox in a tab", "portable demo environment", or "real long-lived personal Linux workspace"?
- how much guest networking is acceptable in-browser?
- is a guest console enough, or is a real guest-side `wsh-server` worth the complexity?

Likely follow-up deliverables:

- [ ] VM image management UI
- [ ] snapshot/import/export
- [ ] workspace-bound guest persistence
- [ ] resource budgeting (memory, CPU, storage) in the browser
- [ ] capability policy for VM control vs guest shell access

### Phase 7A.9: Recommended Product Positioning

If all of the above lands, the clean story should be:

- **Use direct `wsh-server`** when the target is a real machine and you need real PTY semantics.
- **Use reverse browser `wsh`** when the target is a live Clawser tab or browser runtime that cannot or should not accept inbound access.
- **Use reverse host peers** when the machine can dial out but is not directly reachable.
- **Use VM peers** when you want a portable, browser-hosted Linux environment accessible through the same relay/session/auth model.

That gives Clawser four legitimate remote-runtime modes without pretending they are interchangeable.

### Phase 7A.10: Adjacent Features Worth Implementing

Goal: identify the features adjacent to the current `wsh` work that will materially improve operator usability, product coherence, and future extensibility.

These are not random nice-to-haves. They are the features that close the gap between "the protocol basically works" and "remote runtime access is a dependable subsystem."

#### Tranche 1: Must-Have Adjacent Work

These should be treated as the next implementation wave after the current browser reverse-terminal work.

##### 1. Reverse Host Peer Parity

Problem:

- the browser reverse peer can accept an incoming terminal session and behave like a usable remote shell
- the Rust reverse peer path still mostly registers, waits, and exposes only a placeholder acceptance loop

Why it matters:

- it is the most obvious product asymmetry in the whole subsystem
- it leaves "remote into a local machine through a relay" feeling half-promised
- it prevents `wsh` from becoming a general remote-runtime plane instead of a browser-special case

Required deliverables:

- [ ] implement incoming session handling for Rust reverse peers
- [ ] create a local session backend that can:
  - spawn a PTY
  - open an exec session
  - relay file operations where supported
  - later bridge MCP/tool calls
- [ ] bridge reverse peer control messages end to end:
  - `Open`
  - `SessionData`
  - `Resize`
  - `Signal`
  - `Exit`
  - `Close`
- [ ] ensure reverse peer sessions use the same interactive loop quality bar as direct sessions
- [ ] add reconnect handling when the relay transport drops

Success definition:

- the relay path for a reverse host feels like a transport variation of direct `wsh connect`, not a different product

##### 2. Peer Typing And Capability Metadata

Problem:

- `wsh peers` currently tells you that something is online, but not enough about what that thing actually is
- hosts, browser tabs, and future VM guests should not be visually or semantically flattened into one row shape

Why it matters:

- the operator needs to know whether they are connecting to:
  - a real host PTY
  - a browser-backed virtual shell
  - a VM guest console
  - a worker/sandbox peer
- policy, routing, and UX all become clearer when peer types are explicit

Required deliverables:

- [ ] extend reverse registration payloads to include backend identity
- [ ] extend reverse peer listings to expose:
  - `peer_type`
  - `shell_backend`
  - `capabilities`
  - `attach_supported`
  - `term_sync_supported`
  - `predictive_echo_supported`
- [ ] show this in the CLI table and JSON output
- [ ] teach the CLI to label sessions clearly on connect/open

Recommended peer type vocabulary:

- `host`
- `browser-shell`
- `vm-guest`
- `worker`

Recommended shell backend vocabulary:

- `pty`
- `virtual-shell`
- `vm-console`
- `exec-only`

##### 3. Long-Lived Reverse Host Agent

Problem:

- a foreground `wsh reverse` process is enough for demos and short-lived support sessions
- it is not the right lifecycle model for a workstation, server, or semi-persistent endpoint

Why it matters:

- reverse host mode becomes operationally useful only when it survives normal process churn
- persistent reverse peers make relay-mediated support and access much more realistic

Required deliverables:

- [x] define a `wsh-agent` / `wsh-peer` daemon mode
- [x] support background registration and automatic reconnect
- [x] support startup-on-login / startup-on-boot integration where practical
- [x] add policy configuration for what the agent exposes by default
- [x] add status inspection commands
  - connected/disconnected
  - relay target
  - active sessions
  - exposed capabilities

Non-goal:

- turning `wsh-agent` into a giant management platform; it should stay focused on remote access lifecycle

##### 4. Uniform Attach / Replay / Reattach

Problem:

- replay and reattach quality currently varies by backend
- good remote access requires a story for dropped tabs, dropped relay links, and resumed operator sessions

Why it matters:

- robustness matters more than raw feature count once the remote shell basically works
- users forgive a relay hop far more easily than they forgive a lost session

Required deliverables:

- [x] define consistent attach semantics across:
  - direct host PTY
  - browser virtual terminal
  - reverse host peer
  - future VM peer
- [x] standardize replay metadata and term-sync behavior
- [x] let peers advertise whether replay is lossless, partial, or unsupported
- [x] preserve session labels and identity across reconnect

Desired UX outcome:

- reconnecting to an interrupted session should feel like resuming a runtime, not starting over blindly

#### Tranche 2: Strongly Recommended Adjacent Work

These are the features that make `wsh` more broadly useful beyond shell-only workflows.

##### 5. First-Class Peer File And Tool Workflows

Problem:

- terminal access is only one-third of the value proposition
- reverse peers should feel just as reachable for filesystem and tool/MCP operations as they do for shell access

Why it matters:

- many real workflows are:
  - fetch a file
  - inspect logs
  - call a tool
  - run one command
  - transfer a result back
- not "open an interactive shell and stay there forever"

Required deliverables:

- [ ] make upload/download first-class against reverse peers
- [ ] support capability-aware file commands from the CLI
- [ ] improve reverse MCP/tool invocation UX
- [ ] allow peer policies to expose tools without necessarily exposing shell
- [ ] make peer error messages explain capability denials clearly

Examples of valuable workflows:

- connect to a browser peer and fetch a generated artifact
- connect to a reverse host peer and tail logs
- invoke a peer-local MCP tool without opening a shell

##### 6. Consent, Exposure, And Policy UX

Problem:

- once tabs, laptops, and future VMs can act as peers, the product needs much clearer consent and exposure controls

Why it matters:

- the system will be judged not just on power, but on whether remote exposure feels safe and understandable

Required deliverables:

- [ ] clear browser UI for what a tab is exposing:
  - shell
  - tools
  - filesystem
  - VM control
- [ ] session approval and audit log where appropriate
- [ ] richer `authorized_keys` option documentation and UI affordances
- [ ] per-peer or per-identity exposure presets
- [ ] visible remote-session status in the UI

Desired effect:

- a user should know exactly what becomes reachable when they run `wsh reverse`

##### 7. Operator UX And Output Quality

Problem:

- the transport and session internals are now significantly more capable than the current CLI affordances suggest

Why it matters:

- a strong subsystem can still feel rough if it presents unclear output, weak defaults, or too much manual targeting

Required deliverables:

- [ ] `wsh peers --json`
- [ ] richer table output with peer type and backend
- [ ] convenience selectors:
  - connect to only peer
  - connect to last peer
  - filter by capability
  - filter by peer type
- [ ] stronger error messages for:
  - transport mismatch
  - cert trust problems
  - capability denials
  - attach/replay unavailability
- [ ] better session banners so operators know what they are entering

##### 8. Local Setup And Bootstrap Quality

Problem:

- a lot of friction in `wsh` adoption comes from certificates, keys, relay startup, and trust setup rather than the session protocol itself

Why it matters:

- for local development and first-run experience, operational polish is multiplicative

Required deliverables:

- [ ] make trusted local relay setup easier
- [ ] improve key generation/copy/authorization guidance
- [ ] offer scripts or commands for local relay bootstrap
- [ ] make relay startup diagnostics more explicit
- [ ] add self-check commands for common failures

Examples:

- cert not trusted by browser
- wrong relay hostname in browser vs CLI
- missing key in `authorized_keys`
- stale known-host entry

#### Tranche 3: Strategic Extensions

These should be pursued after the subsystem becomes symmetric and legible.

##### 9. VM Guest Peer Backend

Problem:

- Clawser has a clear architectural path to "runtime in the browser," but not yet a general Linux runtime target

Why it matters:

- a VM peer unlocks portable demos, disposable sandboxes, and self-contained remote environments
- it makes "browser-hosted Linux as a peer" a real product story instead of a thought experiment

Required deliverables:

- [ ] implement a VM console backend under the existing reverse-browser peer architecture
- [ ] support at least one emulator/runtime integration cleanly
- [ ] expose peer metadata that makes the VM nature explicit
- [ ] ensure the UX does not misrepresent a VM console as a real host PTY

##### 10. VM Lifecycle, Persistence, And Resource Controls

Problem:

- a console without lifecycle and persistence quickly becomes a novelty

Why it matters:

- if VM peers are going to matter operationally, they need image, storage, and lifecycle semantics

Required deliverables:

- [ ] VM start/stop/reset
- [ ] snapshot/import/export
- [ ] persistent workspace binding
- [ ] resource budgeting
  - memory
  - CPU
  - storage
- [ ] capability split between:
  - guest shell access
  - guest filesystem
  - VM administration

##### 11. Mesh-Assisted Discovery Later

Problem:

- once BrowserMesh grows into a stronger discovery/routing layer, there will be pressure to fold `wsh` peer finding into it

Why it matters:

- this is the right long-term direction, but only after the `wsh` layer itself is stable and explicit

Required deliverables:

- [ ] keep `wsh` session/auth semantics independent
- [ ] allow BrowserMesh to supply discovery and route hints later
- [ ] avoid duplicating session semantics across mesh and `wsh`

Target outcome:

- BrowserMesh helps find and route to peers
- `wsh` still owns remote session behavior

### Phase 7A.11: Missed Integration Opportunities And Required Convergences

Goal: capture the cross-subsystem integration opportunities that are easy to overlook because each subsystem already works in isolation, but that should be treated as required convergence work if Clawser is going to feel like one coherent operating environment.

This section is intentionally separate from the adjacent-features list above.

The previous section answered:

- what additional `wsh`-adjacent features should exist

This section answers:

- which existing subsystems should be integrated with the remote-runtime plane and how

The pattern to avoid is:

- multiple peer models
- multiple remote-access UIs
- multiple capability systems
- multiple routing systems
- multiple audit trails

all coexisting without a canonical integration contract.

#### Convergence 1: Remote UI Stack Unification

Current situation:

- [clawser-ui-remote.js](/Users/johnhenry/Projects/clawser/web/clawser-ui-remote.js) already provides remote chat, remote terminal, remote file browser, and service browsing
- the newer `wsh` remote-runtime work now provides a more explicit session/auth/relay model
- these are adjacent enough that they risk becoming competing architectures

Why this matters:

- the user should not have to understand whether a remote terminal came from:
  - the old peer-remote UI stack
  - the mesh session stack
  - the `wsh` reverse peer stack
- the UI should present "remote runtime" as one concept with multiple backends, not multiple product silos

Required convergence:

- [ ] make the remote UI consume canonical `RemotePeerDescriptor` records instead of ad hoc peer/session objects
- [ ] route all terminal/file/service openings through the session broker
- [ ] distinguish clearly in the UI whether the target is:
  - chat-only peer
  - service peer
  - browser shell peer
  - host PTY peer
  - VM guest peer
- [ ] replace duplicated peer display logic with one reusable peer-card / peer-row model
- [ ] ensure remote UI panels reflect actual backend capabilities rather than showing controls that will immediately fail

Verification criteria:

- opening a remote terminal from the UI and opening the same peer from the CLI resolve to the same runtime target model
- remote file browser only appears when the peer advertises filesystem access
- remote service browser and shell/file panels can coexist on the same peer descriptor without duplicating peer identity

#### Convergence 2: Mesh Naming And Address Resolution Into `wsh`

Current situation:

- mesh naming is its own subsystem
- `wsh` targeting still primarily thinks in terms of hostnames, relay fingerprints, and manual targets

Why this matters:

- names are the natural operator-facing handle once peers become numerous
- if naming and runtime access remain separate, operators will keep translating mentally between peer names and session targets

Required convergence:

- [ ] let mesh names resolve to canonical remote peer descriptors
- [ ] allow future `wsh` session targeting by name:
  - `@alice`
  - `@builder`
  - `@guestbox@relay.example.com`
- [ ] preserve the distinction between:
  - naming a peer identity
  - naming a specific endpoint
  - naming a service hosted on a peer
- [ ] define resolution precedence:
  - explicit direct host target
  - explicit fingerprint
  - qualified mesh name
  - local alias/bookmark
- [ ] ensure name resolution never silently binds to the wrong peer when identities are ambiguous

Verification criteria:

- a named peer can be resolved from both UI and CLI
- ambiguous names produce an explainable conflict, not silent misrouting
- names survive relay changes because they bind to identity, not ephemeral transport coordinates

#### Convergence 3: Peer Registry, Discovery, And Runtime Registry Unification

Current situation:

- mesh discovery has peer records
- mesh relay has peer announcements
- `wsh` relay has reverse peers
- direct hosts are often stored separately as targets or bookmarks

Why this matters:

- if each of these produces a different peer list, Clawser will constantly fight itself at the product layer

Required convergence:

- [ ] build one canonical remote runtime registry that ingests:
  - mesh discovery records
  - mesh live peer state
  - mesh relay announcements
  - `wsh` reverse-peer listings
  - direct host bookmarks
  - future VM peer advertisements
- [ ] preserve source provenance for every merged field
- [ ] define deterministic merge rules for:
  - identity match
  - linked identity match
  - conflicting capability reports
  - conflicting transport information
  - stale liveness data
- [ ] provide one query surface for:
  - peer picker UI
  - CLI peer listings
  - agent/routine targeting
  - future marketplace/resource schedulers

Verification criteria:

- one runtime shows up once in product surfaces, even if discovered through multiple channels
- stale discovery does not overwrite fresher relay/runtime state
- direct host bookmarks can coexist with live-discovered peers without identity collisions

#### Convergence 4: ACL Templates And `wsh` Exposure Presets

Current situation:

- mesh ACL already has scope templates and roster semantics in [clawser-mesh-acl.js](/Users/johnhenry/Projects/clawser/web/clawser-mesh-acl.js)
- `wsh` exposure still largely thinks in terms of local flags and low-level capability advertisement

Why this matters:

- one of the strongest integration wins available is to let an operator describe remote access once and have both systems enforce compatible behavior

Required convergence:

- [ ] map mesh scope templates to `wsh` exposure presets
- [ ] define a translation table between mesh scopes and `wsh` capabilities
- [ ] support per-peer/per-identity presets that determine:
  - shell access
  - exec-only access
  - filesystem access
  - MCP/tool access
  - gateway/network access
  - VM control access
- [ ] document precedence between:
  - mesh ACL deny
  - relay policy deny
  - `wsh` local exposure deny
  - host key/capability deny
- [ ] add UX so the operator can see which layer denied a request

Example translation direction:

- mesh `guest` -> `tools + fs:read` but no shell
- mesh `collaborator` -> `shell + fs + tools`
- mesh `admin` -> full runtime access, subject to local `wsh` auth and host policy

Verification criteria:

- granting a mesh role changes the effective remote-access affordances consistently
- a deny in any layer is explainable with the denying layer identified

#### Convergence 5: Trust, Reputation, And Route Selection

Current situation:

- mesh trust and reputation are already planned or implemented as routing signals
- `wsh` currently focuses on auth correctness and availability, not policy-aware ranking

Why this matters:

- once there are multiple routes, multiple relays, and multiple runtimes, the system needs a principled way to choose a path

Required convergence:

- [ ] incorporate mesh trust scores into route ranking, not session admission bypass
- [ ] incorporate relay health and latency into `wsh` path selection
- [ ] allow policy to require a minimum trust score for:
  - relay use
  - compute delegation
  - filesystem exposure
  - VM control
- [ ] record observed runtime quality back into trust/reputation systems where appropriate
  - uptime
  - attach/resume reliability
  - transfer reliability
  - session acceptance behavior

Hard rule:

- trust can rank or suppress candidate paths
- trust must not replace endpoint authentication or local capability checks

Verification criteria:

- lower-trust peers can still be visible but not necessarily chosen by default
- path selection is deterministic for the same inputs
- trust changes affect route ranking without changing identity or capability truth

#### Convergence 6: Netway Gateway And Remote Runtime Routing

Current situation:

- Netway already treats `wsh` as a gateway substrate in [gateway-backend.mjs](/Users/johnhenry/Projects/clawser/web/packages/netway/src/gateway-backend.mjs)
- mesh routing and remote-runtime access are still mostly described separately

Why this matters:

- gateway/network access is one of the most powerful things `wsh` can expose
- it is also one of the riskiest, so it should be integrated with the richer mesh policy/trust/quota systems

Required convergence:

- [x] allow gateway-capable peers to appear as remote runtime descriptors with explicit network capabilities
- [ ] map mesh trust/quota/policy signals into gateway path selection
- [ ] expose route provenance:
  - local
  - direct host gateway
  - reverse host gateway
  - browser-proxied gateway
- [x] ensure gateway exposure is policy-scoped independently from shell/tool access
- [x] integrate gateway session events into the same audit trail as shell/file sessions

Verification criteria:

- gateway paths are visible as capabilities on peers
- policy can allow shell access while denying gateway use, and vice versa
- reconnect/re-auth flows for gateway-backed sessions follow the same runtime registry logic as shell sessions

#### Convergence 7: Federated Compute Using `wsh` As A Runtime Substrate

Current situation:

- [clawser-peer-compute.js](/Users/johnhenry/Projects/clawser/web/clawser-peer-compute.js) already orchestrates work across peers
- it does not yet have a canonical way to distinguish "chat peer", "runtime peer", "host shell peer", or "VM compute peer"

Why this matters:

- compute delegation is a natural consumer of the remote-runtime fabric
- host peers, browser peers, and VM peers should all be schedulable according to what they can actually run

Required convergence:

- [ ] let compute schedulers query the remote runtime registry rather than ad hoc peer lists
- [ ] add capability classes relevant to compute:
  - `exec`
  - `shell`
  - `wasm`
  - `gpu`
  - `vm_console`
  - future guest-side execution APIs
- [ ] allow schedulers to prefer:
  - real host peers for heavy compute
  - browser peers for light tool execution
  - VM peers for isolated Linux workloads
- [ ] tie compute execution records into the same audit and trust loops as interactive sessions

Verification criteria:

- compute dispatch can intentionally choose a real host over a browser shell when fidelity matters
- peer capability mismatches are rejected before job dispatch, not after opaque failure

#### Convergence 8: Virtual Server, Remote Services, And Runtime Hosting

Current situation:

- the Virtual Server subsystem and peer/service discovery are both present
- remote runtimes are still treated mostly as shells or tool endpoints

Why this matters:

- once runtimes become first-class peers, they can also become first-class service hosts

Required convergence:

- [ ] allow remote runtime descriptors to advertise hosted services
- [ ] let the Virtual Server subsystem bind services to a peer/runtime target
- [ ] distinguish between:
  - peer shell access
  - peer service browsing
  - peer service routing
  - peer-hosted server management
- [ ] make service discovery consume the same canonical peer/runtime model

Verification criteria:

- a peer can expose both an interactive shell and one or more hosted services under one identity
- service browsing does not require a separate peer graph from runtime access

#### Convergence 9: Apps, Skills, And Runtime Deployment Targets

Current situation:

- skills, apps, and installable runtime features already exist
- remote peers are not yet first-class deployment targets

Why this matters:

- one of the strongest long-term product stories is that Clawser can not only connect to runtimes, but also provision or extend them

Required convergence:

- [ ] define which peer types can accept deploy/install actions
- [ ] allow app/skill deployment targeting through the remote runtime registry
- [ ] surface whether a peer supports:
  - tool injection
  - skill sync
  - package install
  - VM image/app loading
- [ ] reflect deployment capability in policy, trust, and audit systems

Verification criteria:

- deploy/install actions target canonical peer descriptors
- peers that cannot support deployment never present misleading deployment affordances

#### Convergence 10: Audit, Observability, And Session Telemetry Unification

Current situation:

- mesh audit exists
- `wsh` session events exist
- remote UI and routing have their own event surfaces

Why this matters:

- as remote-runtime access becomes central, audit and observability cannot remain fragmented

Required convergence:

- [ ] log all remote session lifecycle events into a common audit/telemetry surface:
  - discovery
  - route selection
  - relay use
  - auth success/failure
  - exposure changes
  - session open/close
  - file transfer
  - tool invocation
  - gateway use
- [ ] distinguish operator actions from automated routing/runtime actions
- [ ] expose cross-stack telemetry views:
  - peer health
  - route quality
  - relay usage
  - capability denials
  - attach/replay reliability

Verification criteria:

- a single remote session can be followed across discovery, route selection, auth, and session lifecycle in one audit story
- failures become explainable without correlating multiple unrelated subsystems manually

#### Convergence 11: Remote Filesystems And Mount Semantics

Current situation:

- local mounts exist
- remote file transfer exists
- remote filesystems are not yet treated as mountable runtime surfaces

Why this matters:

- remote-runtime UX becomes much stronger if peers can feel like mountable spaces, not just ad hoc transfer endpoints

Required convergence:

- [ ] define remote filesystem mount semantics
- [ ] integrate remote peers with the shell/filesystem model
- [ ] distinguish:
  - ad hoc file transfer
  - live remote browsing
  - mounted remote namespace
- [ ] gate remote mounts by peer capability and trust/policy

Possible user-facing models:

- `/peers/<peer-id>/`
- `peer://<name>/`
- workspace mount aliases bound to peer descriptors

Verification criteria:

- remote mount state reflects peer liveness and capability
- [x] disconnected peers fail cleanly without corrupting local mount state

#### Convergence 12: Routines, Daemon Mode, And Remote Runtime Automation

Current situation:

- routines and daemon mode already provide automation
- remote peers are still mostly treated as manually invoked targets

Why this matters:

- a mature remote-runtime plane should be automatable

Required convergence:

- [ ] allow routines to target canonical remote runtime descriptors
- [ ] support scheduled health checks, syncs, backups, and maintenance against peers
- [ ] ensure daemon/background execution can reuse the same session broker as interactive flows
- [ ] apply policy and audit consistently to automated sessions

Verification criteria:

- the same target resolution and route selection logic works in both interactive and automated contexts
- background automation does not bypass the same policy and trust checks that interactive sessions obey

#### Convergence 13: Product-Surface Unification

Goal: ensure all of the above appears as one product, not a bag of adjacent subsystems.

Required convergence:

- [ ] one canonical peer picker
- [ ] one canonical runtime/session status model
- [ ] one canonical audit trail for remote access
- [ ] one canonical capability display model
- [ ] one canonical route explanation model

This is the convergence that matters most to users.

They do not care whether a feature came from:

- BrowserMesh
- `wsh`
- Netway
- Virtual Server
- remote UI
- peer compute

They care whether:

- they can find the peer
- they can understand what it is
- they can open the right session
- they can trust what it exposes
- they can tell what failed when it fails

### Phase 7A.12: Explicit Non-Priorities

Goal: state what should *not* absorb roadmap energy yet, even if it sounds adjacent.

#### 1. Direct Peer-to-Peer `wsh` As A New Primary Transport

Why not now:

- the relay already solves the immediate reachability problem
- BrowserMesh and WebRTC already create transport complexity
- adding another first-class transport matrix now would fragment effort

Condition for reconsideration:

- only after relay-mediated peer access is mature, symmetric, and clearly insufficient for a real use case

#### 2. GUI Remoting

Why not now:

- it is not what `wsh` is for
- it would distort the product around a completely different interaction model

Correct domain:

- separate remote desktop tooling if ever needed

#### 3. Pretending Browser Consoles Are Real PTYs

Why not now:

- the system is cleaner when PTY vs virtual terminal vs VM console distinctions stay explicit
- a lot of engineering pain comes from trying to erase honest semantic boundaries

Correct approach:

- improve emulated terminals where they are useful
- preserve real PTY paths where real PTY fidelity is required

#### 4. Making BrowserMesh A Prerequisite For Basic `wsh`

Why not now:

- `wsh` should remain deployable in a simple relay/client/server model
- BrowserMesh is an enrichment layer, not a requirement for remote operator access

Correct relationship:

- BrowserMesh may later augment discovery, trust, and routing
- `wsh` should remain independently useful

### Deliverables Before BrowserMesh Should Depend On This

- [ ] Rust reverse host peer parity with the browser path
- [ ] BrowserMesh ↔ `wsh` integration contract implemented as shared peer descriptors, runtime registry, and session broker
- [ ] remote UI, naming, registry, ACL, gateway, compute, audit, and automation integrations all consume the same canonical peer/runtime model
- [ ] clear precedence rules between mesh ACL/trust and `wsh` auth/capability policy
- [ ] peer type and backend metadata in protocol + CLI output
- [ ] docs that clearly distinguish PTY vs virtual terminal vs VM console
- [ ] verification matrix covering discovery, merge, policy, routing, and session behavior across both stacks
- [ ] one stable VM-console proof of concept
- [ ] explicit product guidance on when to use direct host, reverse host, browser peer, and VM peer modes

---

## Phase 8: BrowserMesh Integration

Turns Clawser into a first-class node in the BrowserMesh decentralized mesh — peer-to-peer connectivity, cryptographic identity, CRDT replication, resource sharing, and payment channels. All mesh features are opt-in via `config.mesh.enabled`. Clawser works fully standalone; BrowserMesh makes it distributed.

**Companion spec**: `docs/browsermesh/specs/proposals/clawser-integration.md`. BrowserMesh owns wire format + protocol definitions; Clawser owns API surfaces + runtime integration.

**Wire format**: BrowserMesh messages use codes 0xA0–0xBF (core protocol) and 0xC0–0xD7 (extended subsystems: swarm, audit, resources, quotas, payments, GPU). Range 0xF0–0xFF is reserved. Canonical registry: `web/packages/mesh-primitives/src/constants.mjs`. wsh codes 0x01–0x9E preserved unchanged.
**Identity encoding**: base64url(SHA-256(publicKey)) — 43 chars.
**Trust model**: Float [0.0, 1.0] with multiplicative transitive decay.

### Phase 8.1: Foundation (Core Identity + P2P Connectivity)
- [x] `clawser-mesh-identity.js` — Multi-identity Ed25519 management, DID format, IndexedDB/Vault persistence, AutoIdentityManager, IdentitySelector, cross-tab sync (~550 LOC, 85 tests)
- [x] `clawser-mesh-keyring.js` — Key hierarchy & linking (device, delegate, org, alias, recovery), SignedKeyLink with Ed25519 signatures, verifyCryptoChain (~320 LOC, 87 tests)
- [x] `clawser-mesh-wsh-bridge.js` — WshKeyStore↔MeshIdentityManager bridge: hex↔base64url conversion, import/export, bidirectional sync (~150 LOC, 21 tests)
- [x] `clawser-mesh-identity-tools.js` — 8 BrowserTool subclasses for identity management: create, list, switch, export, import, delete, link, select_rule (~350 LOC, 32 tests)
- [x] `clawser-mesh-sync.js` — CRDT replication: LWW-Register, G-Counter, PN-Counter, OR-Set, RGA, LWW-Map, vector clocks, delta sync. Wraps BrowserMesh `state-sync.md` (~419 LOC, tests pass)
- [x] `clawser-mesh-trust.js` — Trust graph with float levels, transitive decay, scope intersection, reputation. Wraps BrowserMesh `trust-graph.md` (~328 LOC, tests pass)
- [x] `clawser-mesh-peer.js` — Peer connection manager: discover, connect, lifecycle callbacks, capability advertisement (~390 LOC, tests pass)
- [x] `clawser-mesh-transport.js` — Unified transport interface: WebRTC + wsh/WebTransport + wsh/WebSocket, negotiation, upgrade. Wraps BrowserMesh `channel-abstraction.md` + `transport-probing.md` (~356 LOC, tests pass)
- [x] `clawser-mesh-relay.js` — Relay client for NAT traversal and signaling. Wraps BrowserMesh `relay-service.md` (~433 LOC, tests pass)
- [x] Kernel extensions: MESH, PAYMENT, CONSENSUS capability tags (caps.mjs + constants.mjs)
- [x] base64url migration in `web/packages/wsh/src/auth.mjs` (podId, fingerprintToPodId, podIdToFingerprint)
- [x] Float trust migration in `web/clawser-tool-builder.js` (DynamicTool.trustLevel float [0.0, 1.0])

### Phase 8.2: Access Control + Communication
- [x] `clawser-mesh-acl.js` — Remote access control: scope templates, roster management, invitation tokens, ACLEngine integration. Wraps BrowserMesh `remote-access.md` (~400 LOC, 53 tests)
- [x] `clawser-mesh-naming.js` — Decentralized name resolution: @name, mesh:// URIs, TTL-based expiry, ownership transfer. Wraps BrowserMesh `name-resolution.md` (~350 LOC, 41 tests)
- [x] `clawser-mesh-chat.js` — CRDT-backed chatrooms: message log, ORSet membership, presence, moderation. Wraps BrowserMesh `chat-protocol.md` (~500 LOC, 51 tests)
- [x] `clawser-mesh-streams.js` — Multiplexed data streaming: MeshStream state machine, StreamMultiplexer, credit-based backpressure, bidirectional flow. Wraps BrowserMesh `direct-stream.md` (~400 LOC, 74 tests)
- [x] `clawser-mesh-files.js` — Content-addressed file transfer: SHA-256 chunking, ChunkStore, TransferOffer/TransferState, progress tracking, resume support. Wraps BrowserMesh `file-transfer.md` (~450 LOC, 71 tests)
- [x] `clawser-mesh-tools.js` — 7 BrowserTool subclasses exposing mesh stream/file operations to AI agent: stream open/close/list, file send/accept/list/cancel (~350 LOC, 34 tests)

### Phase 8.3: Resources + Economics
- [x] `clawser-mesh-resources.js` — Resource advertisement + discovery + job scheduling. Wraps BrowserMesh `resource-marketplace.md` (~500 LOC, 82 tests)
- [x] `clawser-mesh-quotas.js` — Per-identity resource quotas with enforcement + overage policy. Wraps BrowserMesh `quota-metering.md` (~420 LOC, 75 tests)
- [x] `clawser-mesh-payments.js` — Payment channels: credits, WebLN/Lightning, ecash/Cashu, escrow pattern. Wraps BrowserMesh `payment-channels.md` (~480 LOC, 78 tests)
- [x] `clawser-mesh-audit.js` — Cryptographic audit trail: signed events, Merkle proofs, non-repudiation. Wraps BrowserMesh `audit-recorder.md` (~450 LOC, 71 tests)

### Phase 8.4: Advanced Coordination
- [x] `clawser-mesh-consensus.js` — Voting & consensus: simple/super/unanimous/weighted majority, proposals, tallying. Wraps BrowserMesh `voting-protocol.md` (~520 LOC, 89 tests)
- [x] `clawser-mesh-swarm.js` — Swarm coordination: leader election, yield control, task distribution (leader-follower, round-robin, load-balanced, redundant, pipeline). Wraps BrowserMesh `swarm-protocol.md` (~560 LOC, 93 tests)
- [x] `clawser-mesh-migration.js` — Agent state migration between peers: checkpoint, transfer, verify, activate (~430 LOC, 68 tests)
- [x] ~~`clawser-mesh-directory.js`~~ — Covered by `clawser-mesh-naming.js` (Phase 8.2)
- [x] `clawser-mesh-gateway.js` — Gateway node [thin wrapper]. Wraps BrowserMesh `relay-service.md` (~380 LOC, 62 tests)

### Phase 8.5: App Ecosystem
- [x] `clawser-mesh-apps.js` — Decentralized app distribution: install/publish/verify via DHT, capability-scoped permissions. AppManifest, AppInstance state machine, AppRegistry, AppStore, AppRPC, AppEventBus (~667 LOC, 116 tests)

### Phase 8.6: Naming & Addressing
- [x] ~~`clawser-mesh-naming.js`~~ — Implemented in Phase 8.2: `@name`, `mesh://`, DID URIs, TTL expiry, ownership transfer
- [x] `clawser-mesh-discovery.js` — mDNS/relay peer discovery + BroadcastChannel for same-origin. DiscoveryManager, BroadcastChannelStrategy, RelayStrategy, ManualStrategy, ServiceDirectory with `svc://` URIs (~605 LOC, 104 tests)
- [x] Integrate with kernel ServiceRegistry for `svc://` scheme resolution (via ServiceDirectory)
- [x] ~~Human-friendly naming layer~~ — Covered by `clawser-mesh-naming.js` (Phase 8.2)

### Phase 8.7: Real Transports
- [x] `clawser-mesh-websocket.js` — All transports unified: WebSocketTransport (reconnection, heartbeat, exponential backoff), WebRTCTransport (SDP offer/answer, ICE trickle), WebTransportTransport (HTTP/3 datagrams, bidirectional streams), NATTraversal (STUN/TURN), TransportFactory (browser detection, preference-ordered negotiation) (~1069 LOC, 77 tests)
- [x] NAT traversal (STUN/TURN) integration via NATTraversal class
- [x] TransportFactory handles relay/signaling bootstrap

### Phase 8.8: Resource Description + Scheduling
- [x] `clawser-mesh-scheduler.js` — ScheduledTask (7 statuses), TaskConstraints, TaskQueue (priority queue), MeshScheduler (4 policies: best-fit, first-fit, round-robin, load-balanced) (~87 tests)
- [x] `clawser-mesh-marketplace.js` — ServiceListing (pricing: free/per-call/subscription/credits), ServiceReview, Marketplace (ownership enforcement, self-review prevention), MarketplaceIndex (inverted index) (~94 tests)

### Phase 8.9: Advanced Capabilities
- [x] `clawser-mesh-capabilities.js` — CapabilityToken (unforgeable, attenuate/revoke), CapabilityChain (verify monotonicity), CapabilityValidator (revokeTree cascade), WasmSandboxPolicy, WasmSandbox state machine, SandboxRegistry (~530 LOC, 72 tests)
- [x] `clawser-mesh-delta-sync.js` — DeltaEntry, DeltaLog (append-only, auto-compaction), DeltaEncoder/Decoder (set/delete/merge ops), SyncSession, SyncCoordinator (multi-peer) (~480 LOC, 54 tests)
- [x] `clawser-mesh-visualizations.js` — TrustGraphLayout (force-directed), TrustHeatmap, TopologySnapshot, TopologyLayout (circular/grid/hierarchical), TopologyDiff, VisualizationExporter (~520 LOC, 56 tests)

### Phase 8.10: Pod Abstraction
- [x] `web/packages/pod/src/pod.mjs` — Pod base class: 6-phase boot sequence (identity, discovery, messaging), zero Clawser deps, Ed25519 identity via mesh-primitives, BroadcastChannel peer discovery, role finalization (~300 LOC, 16 tests)
- [x] `web/packages/pod/src/detect-kind.mjs` — Classify execution context into 8 pod kinds: service-worker, shared-worker, worker, worklet, server, iframe, spawned, window (~55 LOC, 10 tests)
- [x] `web/packages/pod/src/capabilities.mjs` — Detect messaging/network/storage/compute capabilities from globalThis (~65 LOC, 7 tests)
- [x] `web/packages/pod/src/messages.mjs` — Wire protocol constants and factories: POD_HELLO, POD_HELLO_ACK, POD_GOODBYE, POD_MESSAGE, POD_RPC_REQUEST, POD_RPC_RESPONSE (~135 LOC, 7 tests)
- [x] `web/packages/pod/src/injected-pod.mjs` — InjectedPod: page text/structured extraction, visual overlay, extension bridge (~155 LOC)
- [x] `web/clawser-pod.js` — ClawserPod extends Pod: wraps PeerNode + SwarmCoordinator via initMesh(), 22 mesh subsystems with private fields, getters, shutdown teardown (~250 LOC)
- [x] `web/clawser-embed.js` — EmbeddedPod extends Pod: embeddable developer API, backward-compat ClawserEmbed alias (~60 LOC, 6 tests)
- [x] `extension/pod-inject.js` — Generated IIFE bundle for extension injection, double-injection guard via Symbol.for('pod.runtime')
- [x] Extension `inject_pod` action in background.js + web_accessible_resources in manifest.json
- [x] `initMeshSubsystem()` refactored to boot ClawserPod then layer mesh networking
- [x] `state.services.pod` slot added for Pod singleton tracking
- [x] 6 test files, 55 tests total (pod, detect-kind, capabilities, discovery, messaging, embed)

### Phase 8.11: Subsystem Wiring + Doc-Only Features
- [x] **Wire code collision fix** — Migrated 21 wire codes from 4 modules (orchestrator, marketplace, apps, consensus) to canonical MESH_TYPE registry in `constants.mjs` (range 0xD8–0xEC). All modules now import from registry, no hardcoded hex values remain
- [x] **Full subsystem bootstrap** — Wired 11 deferred subsystems into app bootstrap: ResourceRegistry, Marketplace, QuotaManager, QuotaEnforcer, PaymentRouter, ConsensusManager, MeshRelayClient, MeshNameResolver, AppRegistry, AppStore, MeshOrchestrator. State slots, ClawserPod instantiation, lifecycle wiring, orchestrator tool registration, live ResourceRegistry data in mesh panel
- [x] `web/clawser-mesh-sw-routing.js` — ServiceWorker mesh routing: MeshFetchRouter intercepts `mesh://` and `*.mesh.local` URLs, parseMeshRequest URL parser (~200 LOC, 17 tests)
- [x] `web/clawser-mesh-webtransport.js` — WebTransport bridge: WebTransportBridge extends MeshTransport (HTTP/3 datagrams + bidi streams), WebTransportAdapterFactory, supportsWebTransport() (~350 LOC, 25 tests)
- [x] `web/clawser-mesh-cross-origin.js` — Cross-origin communication: CrossOriginBridge (origin validation, trust levels, method allowlisting), CrossOriginHandshake (challenge-ack protocol), RateLimiter, TRUST_LEVELS enum (~500 LOC, 38 tests)
- [x] `web/clawser-mesh-webrtc.js` — WebRTC mesh: WebRTCPeerConnection (offer/answer/ICE lifecycle, DataChannel, stats), WebRTCMeshManager (multi-peer, broadcast, auto-cleanup), WebRTCTransportAdapter extends MeshTransport, WebRTCAdapterFactory (~570 LOC, 47 tests)
- [x] `web/clawser-mesh-devtools.js` — Mesh DevTools inspector: MeshInspector (snapshot, healthCheck, toMarkdownReport), MeshInspectTool (BrowserTool, `mesh_inspect`, read permission) (~200 LOC, 12 tests)

### Scope Estimate
| Category | Modules | Est. LOC | Est. Tests |
|----------|---------|----------|------------|
| Identity (Phase 8.1) | 3 | ~1,800 | ~100 |
| Access Control (Phase 8.2) | 1 | ~750 | ~50 |
| Transport (Phase 8.1) | 4 | ~2,600 | ~80 |
| Data/State (Phase 8.1–8.2) | 3 | ~2,200 | ~90 |
| Resources/Economics (Phase 8.3) | 4 | ~2,400 | ~70 |
| Infrastructure (Phase 8.4) | 5 | ~1,500 | ~50 |
| App Ecosystem (Phase 8.5) | 1 | ~600 | ~30 |
| Naming & Addressing (Phase 8.6) | 2 | ~1,200 | ~60 |
| Real Transports (Phase 8.7) | 3 | ~2,000 | ~80 |
| Resource Scheduling (Phase 8.8) | 3 | ~1,800 | ~60 |
| Advanced Capabilities (Phase 8.9) | — | ~1,500 | ~50 |
| Kernel Extensions | — | ~300 | ~30 |
| **Total** | **30 new + 8 ext** | **~18,500–22,000** | **~710** |

---

## Phase 9: Public BrowserMesh Package Surface (Future)

Priority: Complete the documented `@browsermesh/*` package ecosystem. The mesh runtime works internally (30+ modules, 3,700+ tests) but the public API surface promised in documentation does not exist as shippable packages.

### Current state

**Actual packages in repo:**
- `web/packages/mesh-primitives` — Wire protocol, constants, shared types
- `web/packages/pod` — Pod base class, detect-kind, capabilities, messages
- `web/packages/netway` — Network abstractions
- `web/packages/wsh` — Remote shell protocol

**Documented but not implemented:**
- `@browsermesh/runtime`
- `@browsermesh/client`
- `@browsermesh/server`
- `@browsermesh/storage`
- `@browsermesh/compute`
- `@browsermesh/manifest`
- `@browsermesh/schema`
- `@browsermesh/admission`
- `@browsermesh/cli`

### Phase 9.1: Freeze the BrowserMesh Contract
- [ ] Choose canonical package map — promote existing substrate into `@browsermesh/runtime`, `@browsermesh/client`, `@browsermesh/server`; keep `mesh-primitives` as internal shared package
- [ ] Define canonical runtime entrypoints: `installPodRuntime()`, `createRuntime()`, `createClient()`, `createServer()`
- [ ] Mark each spec as: implemented, partial, doc-only, or obsolete
- [ ] Resolve documentation inconsistencies (ARCHITECTURE-AUDIT.md vs ROADMAP.md on BrowserMesh status)

### Phase 9.2: Consolidate the Runtime
- [ ] Extract or alias `web/packages/pod` into `@browsermesh/runtime`
- [ ] Wrap `Pod` with documented runtime API surface
- [ ] Add client/server wrappers around existing transport stack
- [ ] Provide missing documented entrypoints so `installPodRuntime(...)` examples actually run
- [ ] Back `docs/browsermesh/specs/reference/client-api.md` with real code

### Phase 9.3: Align Specs to Code
- [ ] Add or update formal specs for all implemented modules (identity keyring, trust graph, resource marketplace, payment channels, quota metering, voting protocol, swarm protocol, app distribution, audit recorder, relay service)
- [ ] Update spec index and dependency graph
- [ ] Add implementation-status sections to specs with shipping code

### Phase 9.4: Build Missing Package Layers
- [ ] `@browsermesh/storage` — Distributed storage abstraction (reuse OPFS, CRDT sync)
- [ ] `@browsermesh/compute` — Compute routing (reuse `clawser-mesh-resources.js`, `clawser-mesh-scheduler.js`)
- [ ] `@browsermesh/manifest` — App manifest validation and packaging
- [ ] `@browsermesh/schema` — Wire protocol schema definitions
- [ ] `@browsermesh/admission` — Admission control and capability enforcement
- [ ] `@browsermesh/cli` — CLI tooling for mesh operations (reuse `wsh` for bridge/remote transport)

### Phase 9.5: End-to-End and Interop Testing
- [ ] Multi-tab discovery test
- [ ] Service advertisement and lookup across real runtime instances
- [ ] Stream open/data/close across pods
- [ ] File transfer accept/resume/cancel
- [ ] ACL + trust + quota interaction
- [ ] Relay fallback scenarios
- [ ] Browser-to-server pod interop
- [ ] Client/runtime/server API compatibility with documentation
- [ ] Protocol registry collision tests (fail on wire-code reuse)

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
