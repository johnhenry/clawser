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
- Bridge interface for external tool integration (local server + extension)
- Local filesystem mounting via FileSystemAccess API
- Delegation, self-repair, undo, routines, heartbeat, auth profiles
- ARIA accessibility, keyboard shortcuts, light/dark mode, responsive design
- CI/CD pipeline, Docker, Service Worker, PWA

---

## Phase 1: Foundation -- COMPLETE

### Documentation -- COMPLETE
- [x] README.md — Project overview and quick start
- [x] ARCHITECTURE.md — System design and module map
- [x] ROADMAP.md — This document
- [x] LICENSE — MIT license file at project root
- [x] CHANGELOG.md — Version history from git log
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

### Configuration -- PARTIAL
- [x] **Tool result truncation** — Indicated with char counts + event logged
- [ ] **Extract hardcoded limits** — Max iterations, result length, cache size to agent config
- [ ] **Cost estimation** — Account for prompt caching discounts

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
- [ ] ~~Stderr redirect~~ — Tokenizer parses 2>, 2>&1 but executor routing incomplete (low priority)

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

## Phase 5: Ecosystem (Future)

Priority: Integrations, API, and community.

### Integrations
- [ ] GitHub integration — PR review, issue management, code search
- [ ] Calendar integration — Schedule awareness, meeting prep
- [ ] Email integration — Draft, summarize, triage
- [ ] Slack/Discord — Channel monitoring, response drafting

### Developer API
- [ ] Plugin API — Formal extension point for third-party tools
- [ ] TypeScript definitions — .d.ts files for all modules
- [ ] npm package — Publish core agent as reusable library
- [ ] Embedding API — Drop Clawser into any web app

### Skill Ecosystem
- [ ] Skill dependency enforcement — Validate requires field
- [ ] Skill versioning UI — Show diffs before upgrade
- [ ] Skill marketplace — Browseable catalog with ratings
- [ ] Skill templates — Starter kits for common patterns

### Community
- [ ] Skills registry — Launch public skills registry
- [ ] Documentation site — Hosted docs with tutorials
- [ ] Demo site — Live demo with Echo provider (no API key)

---

## Phase 6: Remote Execution (wsh)

Priority: Complete the wsh protocol implementation — browser-native remote shell, reverse relay, session management, and MCP bridging.

### Phase 6.0: Protocol & Transport — COMPLETE
- [x] CBOR control channel with BE32 framing
- [x] Ed25519 pubkey auth (authorized_keys)
- [x] WebTransport + WebSocket fallback
- [x] 50+ message types (codegen from YAML spec)
- [x] Ping/pong keepalive
- [x] JS client library (connect, auth, sessions, file transfer, MCP)
- [x] Rust CLI (connect, keygen, copy-id, scp, sessions, attach)
- [x] Browser wsh tools (9 tools)
- [x] Pairing system (6-digit codes, tokens)

### Phase 6.1: Gateway & Networking — COMPLETE
- [x] TCP proxy (outbound)
- [x] UDP proxy (outbound)
- [x] DNS resolution
- [x] Bidirectional data relay (GatewayData 0x7e)
- [x] Reverse TCP listeners (server-side bind)
- [x] Gateway policy enforcement (allowlist, limits)
- [x] Netway virtual networking (StreamSocket, DatagramSocket, Listener)
- [x] InboundReject handler (TcpStream leak fix)
- [x] UDP idle timeout (60s)
- [x] Operation timeouts (30s default)
- [x] write_channels leak fix on relay end
- [x] Data pump error handling (close socket on transport error)

### Phase 6.2: "wsh into Browser" Relay
- [x] Server dispatch: ReverseRegister (0x50)
- [x] Server dispatch: ReverseList (0x51) → ReversePeers (0x52)
- [x] Server dispatch: ReverseConnect (0x53) with transport bridging
- [x] Server: peer_transports map + cleanup on disconnect
- [x] Browser: auto ReverseRegister on wsh connect
- [x] Browser: onReverseConnect callback wiring in WshClient
- [x] Browser: incoming session handler (clawser-wsh-incoming.js)
- [x] Browser CLI: `wsh reverse` implementation (replace stub)
- [x] Browser CLI: `wsh peers` implementation (replace stub)
- [x] Rust CLI: wire `run_reverse()` (connect + register + hold)
- [x] Rust CLI: wire `run_peers()` (connect + list + display)
- [x] Rust CLI: `wsh connect <fingerprint>` reverse connect mode

### Phase 6.3: Session Management (Server)
- [x] Server dispatch: Attach (0x30) — token validation + ring buffer replay
- [x] Server dispatch: Resume (0x31) — token + last_seq replay
- [x] Server dispatch: Open (0x10) — PTY/exec/meta channel creation
- [x] Server dispatch: Resize (0x13) — PTY resize
- [x] Server dispatch: Signal (0x14) — send to process group
- [x] Server dispatch: Close (0x16) — channel teardown + session GC
- [x] Session metadata: Rename (0x32)
- [x] Session metadata: Snapshot (0x35) — mark position in recording
- [x] Session metadata: Presence (0x36) — broadcast to attached clients
- [x] Session metadata: ControlChanged (0x37)
- [x] Session metadata: Metrics (0x38)
- [x] Session metadata: IdleWarning (0x33) — server idle timer
- [x] Session metadata: Shutdown (0x34) — on server SIGTERM

### Phase 6.4: MCP Dispatch
- [x] Server dispatch: McpDiscover (0x40) → McpTools (0x41)
- [x] Server dispatch: McpCall (0x42) → McpResult (0x43)
- [x] MCP HTTP proxy: discovery against remote servers
- [x] MCP HTTP proxy: forwarding calls to remote servers

### Phase 6.5: Protocol Improvements
- [x] Dynamic capability negotiation (replace hardcoded features)
- [x] Clipboard sync (OSC 52): add Clipboard message to spec + codegen
- [x] Clipboard sync: server-side OSC 52 detection in PTY output
- [x] Clipboard sync: client-side navigator.clipboard.writeText
- [x] Per-key permission enforcement (parse authorized_keys options)
- [x] Permission checks in dispatch (pty, exec, mcp, file-transfer, relay)
- [x] Auth rate limiting (5/min per IP)
- [x] Attach rate limiting (10/min per principal)
- [x] Password auth implementation (PAM or config hash)
- [x] Protocol version negotiation (version/min_version/max_version)

### Phase 6.6: Client Enhancements
- [x] URL read-only attach (#/wsh/session/<id>?token=X&mode=read)
- [x] Browser CLI: `wsh sessions` (list active)
- [x] Browser CLI: `wsh attach <session_id>` (reattach)
- [x] Browser CLI: `wsh scp <src> <dst>` (file transfer)
- [x] Browser CLI: `wsh connect <fingerprint>` (reverse connect)

### Phase 6.7: Protocol Extensions & Future
- [x] Session recording export (download JSONL/asciicast)
- [x] Session snapshots (time-travel markers)
- [x] Command journal (structured shell history with exit codes)
- [x] Device labels on attach (browser/cli/platform metadata)
- [x] Background jobs channel (kind: "job")
- [x] Server metrics channel (CPU/memory/sessions)
- [x] Idle suspend (SIGSTOP/SIGCONT instead of kill)
- [x] Graceful PTY restart (restart shell without killing session)
- [x] ghostty-web terminal frontend integration
- [x] Ephemeral guest sessions (short-lived share links)
- [x] Multi-attach read-only URL sharing
- [x] Stream compression negotiation (zstd)
- [x] Per-attachment rate control (slow consumer policy)
- [x] Cross-session linking (jump host support)
- [x] AI co-pilot attachment mode (read-only AI observer)
- [x] E2E encrypted session mode
- [x] Predictive local echo (mosh-style)
- [x] Terminal diff-based sync (true mosh replacement)
- [x] Horizontal scaling (stateless tokens, shared secret)
- [x] Shared sessions across principals
- [x] Structured file channel (SFTP replacement)
- [x] Policy engine (OPA-like enterprise control)

### Phase 6.8: Bug Fixes & Hardening — COMPLETE
**Critical:**
- [x] Guest token store — GuestInvite generates token but discards it; add HashMap store + return token
- [x] GuestJoin validation — always rejects because no token store exists; wire to token store
- [x] Session ownership checks — 12+ handlers lack caller ownership verification
- [x] Path traversal — sanitize session_id in RecordingExport/CommandJournal file paths

**High:**
- [x] PolicyEval default-deny — currently always returns allowed:true; change to default-deny
- [x] E2E relay to peer — KeyExchange/EncryptedFrame silently dropped; relay to target peer
- [x] CompressAck codec — claims accepted for zstd but never installs codec; reject until implemented

**Medium:**
- [x] RateControl handler — stub; needs per-channel rate state tracking
- [x] CopilotAttach handler — stub; needs session attachment in read-only mode
- [x] CopilotSuggest handler — stub; needs relay to attached copilot clients
- [x] CopilotDetach handler — stub; needs copilot session cleanup
- [x] SessionGrant handler — stub; needs principal ACL update
- [x] SessionRevoke handler — stub; needs principal ACL removal
- [x] PolicyUpdate handler — stub; needs policy store update
- [x] NodeAnnounce handler — stub; needs cluster node registry
- [x] TerminalConfig handler — stub; needs per-session terminal config store

**Low:**
- [x] EchoAck handler — stub; needs RTT measurement storage
- [x] EchoState handler — stub; needs echo state tracking

**Spec:**
- [x] Fix GatewayOk/GatewayFail descriptions (incorrectly reference ListenRequest)
- [x] Fix GuestInvite description (claims echo-back but no token field in response)
- [x] Add missing descriptions to 34 protocol messages

**Tests:**
- [x] Import 6 missing constructors (clipboard, recordingExport, commandJournal, metricsRequest, suspendSession, restartPty)
- [x] Add tests for 15 imported-but-untested constructors (authMethods, openFail, error, resume, rename, idleWarning, shutdown, snapshot, presence, controlChanged, mcpCall, mcpResult, reverseList, reversePeers, reverseConnect)

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
