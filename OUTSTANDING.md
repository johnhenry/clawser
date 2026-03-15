# Clawser — Outstanding Work

> Fresh audit generated 2026-03-14 from source code scan (625+ files),
> functional completeness analysis, documentation review, Heynote plans
> (72 blocks), E2E testing sessions, and consistency checks.

---

## Status Tags

- **BUG** — broken behavior that needs fixing
- **GAP** — missing feature or incomplete implementation
- **POLISH** — quality improvement, not blocking
- **ROADMAP** — new feature development for future phases
- **NICE** — nice-to-have, low priority

---

## 1. Bugs

### 1.1 Agent #runAbort not cleared after successful run [BUG]
`clawser-agent.js` — `run()` sets `this.#runAbort = new AbortController()` at the
start but never clears it on the success path. After a normal run completes,
`isRunning` returns `true` and `cancel()` aborts a stale controller. Must add
`this.#runAbort = null` before every `return` in `run()` and `runStream()`.

### 1.2 Three pre-existing test failures [BUG]
- `MeshACL.prototype.grant` — scaffolding test expects `grant()`/`revoke()` methods
  that don't exist (only `addEntry()`/`revokeAll()`)
- `ClawserEmbed.emit()` — test expects event emitter but `EmbeddedPod` has no `emit()`
- `MountableFs preset round-trip` — `exportPresets()` → `importPresets()` loses
  `source` and `metadata` fields

### 1.3 Conversation delete missing [BUG]
`clawser-conversations.js` has `loadConversations()`, `updateConversationMeta()`,
`generateConvId()` but no `deleteConversation()`. OPFS conversation files cannot
be cleaned up.

### 1.4 E2E file transfer dispatch format mismatch [BUG]
`p2p-mesh-subsystems.test.mjs` — 2 of 7 tests fail because `fileTransfer.dispatch()`
doesn't accept the envelope format sent via WebRTC `{ _mesh: 'file-transfer', payload }`.
The dispatch method expects a different message shape.

---

## 2. Gaps

### 2.1 Shell has no tab completion [GAP]
No autocomplete for commands or file paths. History command exists and works,
but interactive completion would significantly improve the terminal experience.

### 2.2 No vault recovery mechanism [GAP]
If the passphrase is forgotten, all vault data (API keys, OAuth tokens) is
permanently lost. No recovery codes, security questions, or backup export.

### 2.3 DID resolution is MVP only [GAP]
`toDID()` uses simplified `did:key:z<podId>` format instead of proper base58btc
multicodec encoding per the W3C DID spec. Sufficient for internal use but won't
interop with external DID systems.

### 2.4 Conversation export/import missing [GAP]
No way to export a conversation to JSON/file or import one from another workspace
or external source.

### 2.5 transformResponse hook never invoked [GAP]
The `transformResponse` hook point is defined in `HOOK_POINTS` and documented,
but the agent never calls `this.#hooks.run('transformResponse', ...)`. Any hooks
registered at this point are dead code.

### 2.6 Relay server auto-connect not functional [GAP]
`MeshRelayClient` defaults to `wss://relay.browsermesh.local` which doesn't exist.
The relay URL is configurable via localStorage but there's no UI to set it and
no default that points to a real server.

---

## 3. Polish

### 3.1 41 silent catch blocks [POLISH]
41 bare `catch {}` or `catch { /* ignore */ }` blocks across the codebase that
swallow errors without logging. Most critical in `clawser-agent.js` (6 blocks)
and `clawser-browser-auto.js` (4 completely empty blocks). Should add minimal
logging: `catch (e) { this.#log?.('warn', e.message) }`.

### 3.2 6 unhandled promise chains [POLISH]
`.then()` without `.catch()` in: `clawser-mesh-cross-origin.js:399`,
`clawser-mesh-websocket.js:750`, `clawser-mesh-webtransport.js:81`,
`clawser-peer-agent-swarm.js:563`, `clawser-peer-verification.js:354`,
`clawser-shell.js:1804`.

### 3.3 README LOC count understated [POLISH]
README.md claims "~65K LOC" but actual is ~120K LOC across all web/ modules
and internal packages.

### 3.4 CLAUDE.md test file count stale [POLISH]
Claims 236 test files but actual is 249+. Minor undercount.

### 3.5 38 modules still marked EXPERIMENTAL [POLISH]
All mesh/peer modules have `STATUS: EXPERIMENTAL` headers despite many being
proven via E2E testing and wired into the pod lifecycle. Consider updating
status to `INTEGRATED` for the ones that are auto-wired (ACL, chat, files,
gateway, handshake, streams, transport, WebRTC, WebSocket, health, session,
routing, services, etc.).

### 3.6 MeshChat moderation is irreversible [POLISH]
`redactMessage()` has no undo. By CRDT design this is intentional, but a
`deleteMessage()` alternative or moderation log would improve usability.

### 3.7 Console.log in production [POLISH]
4 `console.log` statements in `clawser-app.js` and 2 in `clawser-pod.js`
that should use the structured logging system instead.

---

## 4. Roadmap (from Heynote Plans)

### 4.1 Scheduler Overhaul (Block 61) [ROADMAP]
Merge Agent Scheduler into RoutineEngine, add `cron` CLI command, Dashboard
scheduler section, register 3 missing tools. ~560 LOC, ~120 tests.

### 4.2 Read-Only Internal OPFS Directories (Block 53) [ROADMAP]
Write-protect `.agents`, `.checkpoints`, `.skills`, `.conversations` through
shell and file tools. ~60 LOC.

### 4.3 Tab Watcher Extension Plugin (Block 70) [ROADMAP]
TabWatcherPlugin with site profiles (Slack/Gmail/Discord), MutationObserver
DOM polling, 3 `ext_watch_*` tools. ~610 LOC.

### 4.4 P2P Scenario Completion (Block 66) [ROADMAP]
8 protocol gaps for 19 user stories: verification quorum, distributed timestamps,
escrow contracts, agent swarm, encrypted blobs, memory sync, federated compute.
~3,070 LOC, ~111 tests.

### 4.5 Agent → Account → Provider Simplification (Block 52) [ROADMAP]
Wire AgentDefinition to require accountId, update UI agent editor. ~245 LOC.

### 4.6 BrowserMesh Package Ecosystem (Phase 10) [ROADMAP]
9 npm packages: `@browsermesh/runtime`, `client`, `server`, `storage`, `compute`,
`manifest`, `schema`, `admission`, `cli`. Specs exist in `docs/browsermesh/specs/`.

---

## 5. Ecosystem & External

### 5.1 No published npm package [NICE]
EmbeddedPod API works but isn't packaged for npm. Would enable third-party embedding.

### 5.2 No skills marketplace backend [NICE]
UI exists for browsing/installing skills but no hosted registry at agentskills.io.

### 5.3 Channel integrations need real credentials [NICE]
8 channel modules (Discord, Slack, Telegram, IRC, Matrix, Email, TabWatch, Relay)
are implemented but untested with real API credentials/OAuth flows.

### 5.4 Browser extension not published [NICE]
Extension exists (v0.1.0, Chrome MV3) with 32 tools but not on Chrome Web Store.

### 5.5 IPFS CDN URL unverified [NICE]
`clawser-peer-ipfs.js` uses Helia CDN URL that may be stale (like the WebTorrent
URL we fixed). Needs verification.

### 5.6 IoT Bridge experimental [NICE]
`clawser-iot-bridge.js` exists but is unverified/untested in real scenarios.

---

## Summary

| Category | Count | Severity |
|----------|-------|----------|
| Bugs | 4 | Fix soon |
| Gaps | 6 | Address when relevant |
| Polish | 7 | Incremental improvement |
| Roadmap | 6 | Future phases |
| Ecosystem | 6 | Nice-to-have |
| **Total** | **29** | |

**Critical action items:**
1. Fix `#runAbort` cleanup in agent (1.1) — breaks isRunning/cancel state
2. Fix 3 pre-existing test failures (1.2) — grant/revoke, emit, preset fields
3. Add `deleteConversation()` (1.3) — data cleanup gap
4. Fix file transfer dispatch format (1.4) — E2E integration mismatch
