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
| **Phase 8** | Remote runtime access expansion (`wsh`) — canonical runtime registry, session broker, reverse host parity, VM console peers, route policy, remote filesystems, and audit convergence |
| **Phase 9** | BrowserMesh integration — 30 new modules for decentralized mesh: identity, trust, CRDT sync, P2P transport, naming, real transports, resource scheduling, payments, consensus, swarm coordination |
| **OpenClaw Final** | Channel Gateway (`clawser-gateway.js`) — scheduler/routine lane through gateway, kernel tenantId threading, per-channel serialized queues, virtual channel keys, 105 gateway tests |
| **Phase 9.11** | Subsystem wiring + doc-only features — wire code collision fix (21 codes migrated), 11 subsystems wired into bootstrap, SW mesh routing, WebTransport bridge, cross-origin comms, WebRTC mesh, mesh DevTools inspector (5 new modules, 139 new tests) |
| **Phase 10** | Package extraction — all core packages extracted to standalone npm repos, published, and deployed |

Historical phases (1–9) have been archived to [docs/ROADMAP-ARCHIVE.md](docs/ROADMAP-ARCHIVE.md).

---

## Phase 10: Package Extraction -- COMPLETE

Priority: Extract the internal `web/packages/*` modules into standalone npm packages with their own repos, CI/CD, and publishing pipelines.

### Extraction Status

All planned package extractions are complete. The internal `web/packages/*` directories now serve as bridge imports that re-export from the published npm packages.

#### Published npm Packages

| Package | npm Name | Status | Notes |
|---------|----------|--------|-------|
| `mesh-primitives` | `browsermesh-primitives` | Published | Wire protocol, constants, shared types |
| `pod` | `browsermesh-pod` | Published | Pod base class, detect-kind, capabilities, messages |
| `netway` | `browsermesh-netway` | Published | Network abstractions |
| `wsh` | `wsh-upon-star` | Published | Remote shell protocol |
| `andbox` | `andbox` | Published | Sandboxed JS execution |
| `ai-matey-middleware-andbox` | `ai-matey-middleware-andbox` | Published | ai.matey middleware for andbox integration |

#### Standalone Repos

| Repo | Status | Notes |
|------|--------|-------|
| `browsermesh-servers` | Deployed to Fly.io | Server infrastructure for BrowserMesh relay/signaling |
| `clawser-browser-control` | Extracted | Chrome extension with CWS (Chrome Web Store) CI/CD pipeline |
| `browsermesh-integration-tests` | Active | Cross-package integration tests + example apps |
| `raijin` | Standalone repo | Independent project |

### What Changed

- All test imports rewritten to use npm packages via bridge modules
- `web/packages-*.js` bridge files re-export from npm packages
- Internal `web/packages/*` directories kept as thin bridges for backward compatibility
- Cross-package tests consolidated in `browsermesh-integration-tests`

---

## Initiative: Guest-Native `wsh-server` In Browser Linux Guests (Model B)

Priority: separate, high-complexity follow-on initiative, not a prerequisite for BrowserMesh.

Goal: make a browser-hosted Linux guest behave like a real `wsh` host by running a native `wsh-server` inside the guest instead of routing everything through the browser-owned VM-console adapter.

Current status:

- [ ] Not started
- [ ] No guest-side `wsh-server` is packaged into browser-hosted Linux guests today
- [ ] No guest-network path or browser-to-guest relay bridge exists for a real in-guest host endpoint

Entry criteria before starting:

- [x] Phase 8 Model A VM-console path is implemented and usable
- [x] Canonical runtime registry, broker, policy, audit, and capability model are in place
- [x] VM filesystem/image/runtime management exists on the browser side
- [ ] There is a clear product reason to need guest-native Unix fidelity beyond the current VM-console model

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
