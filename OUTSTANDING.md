# Clawser — Outstanding Work

> Generated 2026-03-14 from a full audit of source code, tests, documentation,
> Heynote plans (72 blocks), extracted conversations, E2E testing sessions,
> and functional completeness analysis across 625+ source files.

---

## How to Read This Document

Items are organized by category, then ranked by impact within each category.
Each item has a severity tag:

- **CRITICAL** — blocks real usage or causes data loss
- **HIGH** — significant functionality gap or quality risk
- **MEDIUM** — incomplete feature or developer friction
- **LOW** — nice-to-have, polish, or future consideration

---

## 1. Architecture & Code Quality

### 1.1 God Module: workspace-lifecycle.js [HIGH]
`clawser-workspace-lifecycle.js` has 71 imports, 1,836 LOC, and is the highest-churn
file (40 commits). Single assembly point for the entire app. No `cleanupWorkspace()`
pairs with `initWorkspace()`. Needs splitting into phase-based initialization modules.

### 1.2 Circular Dependencies (3 chains) [MEDIUM]
- `tools ↔ cors-fetch` — tool registry imports CORS fetch, which imports tools
- `ui-chat ↔ ui-config` — mutual imports for shared UI state
- `shell ↔ shell-builtins` — builtins reference shell, shell loads builtins

Work via ES6 live bindings but fragile. Extract shared utilities to break cycles.

### 1.3 CDN Supply Chain Risk [MEDIUM]
- `ai.matey` loaded without version pinning
- No SRI (Subresource Integrity) hashes on any CDN import
- `esm.sh` imports use `@latest` or unpinned versions in some places

### 1.4 No Global `unhandledrejection` Handler [MEDIUM]
~10 silent `.catch(() => {})` fire-and-forget patterns. Combined with fire-and-forget
promises, errors silently disappear. Add a global handler that logs to the ring buffer.

### 1.5 Timer Leak in Promise.race [LOW]
`clawser-agent.js:1385` — tool timeout timer not cleared when the tool resolves
before the timeout. Causes a slow accumulation of dead timers.

### 1.6 Reader Lock Risk in MCP SSE Parser [LOW]
`clawser-mcp.js:125` — SSE reader can hold a lock on the ReadableStream if the
connection drops mid-parse. Add a `finally` block to release the reader.

### 1.7 Event Listener Accumulation [LOW]
Vault unlock dialog adds listeners on each open but doesn't remove them on close.

---

## 2. Testing

### 2.1 Unit Tests Not Run in CI [CRITICAL]
The GitHub Actions CI workflow only runs Playwright browser tests. The 236 Node.js
unit test files (6,196 test cases) are never executed in CI. A regression could ship
without detection. Fix: add `npm test` step to `.github/workflows/ci.yml`.

### 2.2 Core Modules Without Tests [HIGH]
These high-LOC, high-impact modules have zero test coverage:

| Module | LOC | Risk |
|--------|-----|------|
| `clawser-agent.js` | 3,765 | Agent run loop, memory, goals, scheduler |
| `clawser-shell.js` | 1,883 | Shell parser, executor, builtins |
| `clawser-providers.js` | 1,868 | 38+ LLM backends, streaming, cost |
| `clawser-tools.js` | 1,735 | 100+ browser tools, permissions |
| `clawser-codex.js` | ~500 | Code execution sandbox |
| `clawser-skills.js` | ~800 | Skill parser, storage, registry |
| `clawser-app.js` | ~500 | App startup, routing |

### 2.3 All 15 UI Modules Untested [MEDIUM]
Every `clawser-ui-*.js` file has zero test coverage. While UI testing is harder,
the render functions are pure (HTML string output) and could be unit tested.

### 2.4 Internal Packages Without Tests [MEDIUM]
5 of 7 internal packages have zero tests:

| Package | Modules | Tests |
|---------|---------|-------|
| `packages/kernel` | 16 | 16 (complete) |
| `packages/netway` | 10 | 0 |
| `packages/pod` | 7 | 0 |
| `packages/mesh-primitives` | 9 | 0 |
| `packages/wsh` | 9 | 0 |
| `packages/andbox` | 9 | 0 |
| `packages/ai-matey-middleware-andbox` | 5 | 0 |

### 2.5 50+ Mesh/Peer Modules Are Write-Once Scaffolding [MEDIUM]
Created in single commits (Mar 3-6), never iterated. All marked `STATUS: EXPERIMENTAL`.
They have tests but the implementations haven't been exercised end-to-end (until this
session's E2E work began proving them out).

---

## 3. Missing API Counterparts (Functional Completeness)

### 3.1 ClawserAgent — No Cancel, No Memory/Goal Removal [CRITICAL]
- `run()` has no cancellation — agent cannot be interrupted mid-execution
- `addMemory()` has no `removeMemory()` or `forgetMemory()`
- `addGoal()` has no `removeGoal()` or `completeGoal()`
- No `updateMemory()` or `updateGoal()` — must delete and re-add

### 3.2 PeerNodeServer — No `unregisterService()` [HIGH]
`registerService()` exists but there's no way to remove a service. Services
accumulate forever. Add `unregisterService(name)`.

### 3.3 SwarmCoordinator — No Task Cancellation [HIGH]
`submitTask()` has no `cancelTask()` counterpart. Once submitted, a task can only
be completed or failed — never retracted. No pause/resume either.

### 3.4 GatewayNode — No Route Revocation [HIGH]
`advertiseRoute()` has no `revokeRoute()`. Routes rely solely on TTL expiration.
The `RouteTable` has `removeRoute()` internally but `GatewayNode` doesn't expose it.

### 3.5 HealthMonitor — Write-Only Configuration [MEDIUM]
`setThresholds()` has no `getThresholds()`. Configuration is write-only; cannot
verify current settings. Also missing: `clearHeartbeat()`, `untrack(podId)`.

### 3.6 MeshACL — No Granular Revocation [MEDIUM]
`revokeAll()` is all-or-nothing. No `revoke(identity, scope)` for per-scope
removal. No `updateEntry()` — must delete and re-add. `pruneExpired()` exists
but no `extendExpiration()`.

### 3.7 MeshChat — Irreversible Moderation [LOW]
`redactMessage()` has no undo. No explicit `deleteMessage()` (only redaction
which clears content but keeps the entry). `addMessage()` is write-only.

### 3.8 StorageDeleteTool Not Registered [LOW]
Class is defined in `clawser-tools.js` but never added to the default tool registry.

---

## 4. UI & Visual Issues

### 4.1 Mesh Panel Shows "0 Peers" When Peers Are Connected [HIGH]
The mesh panel renders once at first display and never updates. It reads
`state.peerNode?.registry?.listPeers()` at render time but has no reactive
subscriptions to `peer:connect` / `peer:disconnect` events. Need to add
event listeners that trigger re-render.

### 4.2 Mesh Panel Peer Object Shape Mismatch [HIGH]
`renderMeshPanel()` expects `p.podId` but `PeerNode.listPeers()` returns objects
with `p.fingerprint`. The UI never sees peers because the field name doesn't match.

### 4.3 Ghost HTML from renderMeshPanel Injection [MEDIUM]
When `renderMeshPanel()` is called programmatically (as we did in E2E testing),
the HTML goes into the wrong container and persists behind the sidebar across
all panel switches. The panel container selector needs fixing.

### 4.4 EmbeddedPod API Stubbed [MEDIUM]
`clawser-embed.js` defines the EmbeddedPod API but `sendMessage()` returns
empty responses (`{ content: '', toolCalls: [] }`). Not production-ready.

---

## 5. Unintegrated Subsystems

### 5.1 Service Worker Mesh Routing [HIGH]
`clawser-mesh-sw-routing.js` is complete (MeshFetchRouter, mesh:// URL parsing)
but NOT wired into the actual service worker fetch handler. Offline mesh requests
don't work.

### 5.2 All 38 EXPERIMENTAL Modules [MEDIUM]
These are complete implementations marked `STATUS: EXPERIMENTAL — not yet integrated`:

**Mesh layer (22 modules):** ACL, capabilities, chat, cross-origin, delta-sync,
devtools, files, gateway, handshake, migration, naming, peer, scheduler, stealth,
streams, SW routing, transport, WebRTC, WebSocket, WebTransport, wsh-bridge

**Peer features (16 modules):** agent-swarm, chat, collab, compute, encrypted-store,
escrow, files, health, IPFS, memory-sync, routing, services, session, terminal,
timestamp, torrent, verification

Each is individually tested but not wired into the main app lifecycle. The E2E tests
in this session proved many of them work end-to-end when manually wired.

### 5.3 RelayStrategy Wiring Not Automatic [MEDIUM]
We implemented RelayStrategy (connects to signaling server for discovery), but
`ClawserPod.initMesh()` only adds it when `opts.relayUrl` is provided. The app
doesn't pass a default signaling URL, so relay discovery is off by default.

### 5.4 PEX Strategy Not Auto-Wired [MEDIUM]
PexStrategy (peer exchange) is implemented but not added to the DiscoveryManager
in `initMesh()`. Needs to be created and wired when WebRTC connections are established.

### 5.5 SWIM Protocol Not Wired into Pod [MEDIUM]
SwimMembership is implemented with full test coverage but not instantiated in
`ClawserPod.initMesh()` or `createServerKernel()`. Need to create the instance
and pass it to SwarmCoordinator.

### 5.6 WebRTC Transport Not Auto-Negotiated [MEDIUM]
The WebRTC stack works (proven in E2E) but connections must be manually orchestrated.
The HandshakeCoordinator should auto-negotiate WebRTC when a peer is discovered
via signaling/PEX/mDNS.

---

## 6. Server Infrastructure

### 6.1 Kernel Agent Is a Stub [HIGH]
`ServerAgent.run()` returns echo responses, not LLM-backed. `executeTool()` only
has 3 basic tools (echo, time, info). For the server pod to be useful, it needs
a real LLM provider and the full tool registry.

### 6.2 AUTH_MODE=authenticated Now Works But Untested in Production [MEDIUM]
We implemented Ed25519 signature verification in the signaling server, but no
browser client sends signatures during registration (they all use `authMode: 'open'`).
Need to wire the browser-side identity system to sign registration messages.

### 6.3 No Relay Server Auto-Connect [MEDIUM]
The relay server (`server/relay/`) runs independently but no client automatically
connects to it. The `MeshRelayClient` in the browser defaults to
`wss://relay.browsermesh.local` which doesn't exist.

### 6.4 Docker Compose Missing Kernel Service [LOW]
`docker-compose.yml` defines signaling and relay but not the kernel service.
Add a third service for the always-on server pod.

### 6.5 Fly.toml Only Covers Signaling [LOW]
Deployment config exists only for the signaling server. Relay and kernel
need their own deployment configs (or a combined multi-process setup).

---

## 7. Documentation

### 7.1 Stale LOC Counts [MEDIUM]
ARCHITECTURE.md and MODULES.md reference LOC counts that are hundreds of lines off
from current reality. The codebase has grown significantly.

### 7.2 Hook Pipeline Documented Three Ways [MEDIUM]
The hook pipeline is described differently in ARCHITECTURE.md, the agent JSDoc,
and CLAUDE.md. Consolidate to a single source of truth.

### 7.3 CONTRIBUTING.md References Obsolete Test System [LOW]
Describes a test setup that no longer matches the current `node:test` + run-tests.mjs
infrastructure.

### 7.4 localStorage Key Prefix Inconsistency [LOW]
Some keys use `clawser_` prefix, others use `clawser-`. Document the canonical pattern.

### 7.5 Placeholder URLs [LOW]
`your-org` placeholder in README and CONTRIBUTING. Replace with actual GitHub org.

---

## 8. Planned But Not Started (from Heynote)

### 8.1 Scheduler Overhaul (Block 61) [HIGH]
Merge Agent Scheduler into RoutineEngine, add `cron` CLI command, Dashboard scheduler
section, register 3 missing tools, backward-compat migration. ~560 LOC, ~120 tests.

### 8.2 Read-Only Internal OPFS Directories (Block 53) [MEDIUM]
Make `.agents`, `.checkpoints`, `.skills`, `.conversations` readable but write-protected
through shell and file tools. ~60 LOC.

### 8.3 Tab Watcher Extension Plugin (Block 70) [MEDIUM]
TabWatcherPlugin with site profiles (Slack/Gmail/Discord), MutationObserver DOM
polling, 3 `ext_watch_*` tools, gateway integration. ~610 LOC.

### 8.4 Audit Remediation (Block 71) [MEDIUM]
12-lens Application Portrait findings: CI/CD fix, resource leaks, interface
consistency, workspace-lifecycle split, circular dep breaks, test coverage for
51 untested modules, doc refresh. ~1,765 LOC.

### 8.5 P2P Scenario Completion (Block 66) [MEDIUM]
8 protocol gaps to unlock 19 user stories: verification quorum, distributed
timestamps, escrow contracts, agent swarm, encrypted blobs, health monitor,
memory sync, federated compute. ~3,070 LOC, ~111 tests.

### 8.6 Agent → Account → Provider Wiring Simplification (Block 52) [LOW]
Extend SERVICES for echo/chrome-ai, wire AgentDefinition to require accountId,
update UI agent editor. ~245 LOC.

---

## 9. Ecosystem & External Connections

### 9.1 No Published npm Package [MEDIUM]
Clawser has no npm package for embedding. The `clawser-embed.js` EmbeddedPod API
is stubbed (see 4.4). Publishing a working embed package would enable third-party
integration.

### 9.2 No Skills Marketplace Backend [MEDIUM]
The skills registry UI exists but there's no hosted backend for the agentskills.io
marketplace. Skills can only be installed from URLs, not discovered/browsed.

### 9.3 Channel Integrations Are Scaffolding [MEDIUM]
12 channel modules exist (Discord, Slack, Telegram, IRC, Matrix, Email, etc.) but
are untested and likely need real API credentials + OAuth flows to verify.

### 9.4 IoT Bridge [LOW]
`clawser-iot-bridge.js` exists but is experimental/unverified.

### 9.5 IPFS Integration [LOW]
`clawser-peer-ipfs.js` exists with Helia CDN loading, but the CDN URL may be
stale (like the WebTorrent URL we fixed). Needs verification.

---

## 10. E2E Test Coverage Gaps

### 10.1 No WebRTC-to-Mesh Subsystem E2E [HIGH]
The E2E tests proved WebRTC works and each mesh subsystem works individually,
but there's no test that sends a chat message or transfers a file through
the full stack (WebRTC DataChannel → mesh subsystem → remote peer).

### 10.2 No SWIM Failure Detection E2E [MEDIUM]
SWIM is unit-tested but not proven in a real multi-browser scenario.
Need a test where one peer disconnects and SWIM detects it.

### 10.3 No PEX Transitive Discovery E2E [MEDIUM]
PEX is unit-tested (including transitive discovery) but not proven across
real browsers. Need a test where peer C is discovered by peer A only
through peer B's PEX exchange.

### 10.4 No mDNS-to-Browser E2E [MEDIUM]
mDNS discovery works between server pods (tested), but the full flow of
server pod discovers peer via mDNS → browser connects to server pod →
browser gets the mDNS-discovered peers via PEX is not tested end-to-end.

---

## 11. Dead Code & Cleanup

### 11.1 `broadcastPeerList()` Is Dead Code [LOW]
In `server/signaling/index.mjs`, the function still exists but is never called
after the switch to incremental `peer-joined`/`peer-left` events.

### 11.2 Dead Event Names [LOW]
`shutdown`, `delegate_*`, and some `peer:*` events are emitted but never listened to.
`on('return ')` has a trailing space (typo) in `clawser-ui-config.js`.

### 11.3 Legacy Rust Crates [LOW]
`crates/` directory (1.1 MB) is no longer used at runtime. Removed from Cargo
workspace but the source files remain as reference.

### 11.4 5 Stale Merged Branches [LOW]
Safe to delete: branches that were merged but not cleaned up.

### 11.5 playwright.config.js References Nonexistent Directory [LOW]
Points to `./tests` which doesn't exist. Tests are in `web/test/`.

---

## Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Architecture & Code Quality | 0 | 1 | 3 | 3 | 7 |
| Testing | 1 | 1 | 3 | 0 | 5 |
| Missing API Counterparts | 1 | 3 | 2 | 2 | 8 |
| UI & Visual | 0 | 2 | 2 | 0 | 4 |
| Unintegrated Subsystems | 0 | 1 | 5 | 0 | 6 |
| Server Infrastructure | 0 | 1 | 2 | 2 | 5 |
| Documentation | 0 | 0 | 2 | 3 | 5 |
| Planned (Heynote) | 0 | 1 | 4 | 1 | 6 |
| Ecosystem | 0 | 0 | 3 | 2 | 5 |
| E2E Coverage | 0 | 1 | 3 | 0 | 4 |
| Dead Code & Cleanup | 0 | 0 | 0 | 5 | 5 |
| **Total** | **2** | **11** | **29** | **18** | **60** |

**2 critical, 11 high, 29 medium, 18 low = 60 items total.**
