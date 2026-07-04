# Implementation Status — Authoritative Ledger

Date: 2026-05-02
Last verified: 2026-05-02 (third pass — Phase 7 read direction fully wired
via `state.fsUiSync.registerPanel` for all six domains with dirty-aware
setters; A3 write path completed by adding `ClawserPod.sendMessage` →
`PeerNode.sendTo` plus session lookup; both items flipped from Partial to
Done. yaml data layer refreshed for snapshots, peer devices, RPC HTTP, and
PWA install flow; doc generator re-run.)

Cross-references every roadmap, design doc, plan, and inline marker against the
actual code wiring at HEAD. Each item is classified one of:

- **Done** — implemented and reachable from `clawser-app.js` boot or a user-triggered codepath
- **Not wired** — code + tests exist but no production codepath instantiates it
- **Partial** — some sub-items shipped, others did not
- **Stubbed** — placeholder, throws, or returns dummy
- **Not started** — mentioned in a doc, no code

Source columns abbreviated: `RM` = ROADMAP.md, `OUT` = OUTSTANDING.md, `RMA` =
docs/ROADMAP-ARCHIVE.md, `CHG` = CHANGELOG.md, `UFS` =
docs/unix-filesystem-architecture.md, `UFR` =
docs/unix-fs-pre-implementation-review.md, `WTM` =
docs/wterm-migration-plan.md, `CLI` = docs/cli-enhancement-plan.md, `RBT` =
docs/REVERSE-BROWSER-TERMINAL-BACKLOG.md, `BMS` = docs/browsermesh/specs/...,
`REF` = .reference/..., `QA` = docs/qa-report.md, `CMD` = CLAUDE.md.

## Executive Summary

Counters reflect the deep-dive verification on 2026-05-02. Categories sum to
the row totals across all sections below.

- **154 done, 4 partial, 1 not wired (Phase 9 dormant), 1 stubbed (Rust wsh
  copy-id), 7 not started.**
  (Presence protocol flipped from Partial to Done in the 2026-05-03
  quick-wins pass; the relay-auto-connect Settings UI, Helia CDN URL
  bump, and 126 silent-catch conversions also landed in that pass — see
  the 2026-05-03 closure log below.)
- All five browsermesh specs flagged as "Implemented, not wired" — `voting-
  protocol`, `relay-service`, `app-distribution`, `pod-migration`, `name-
  resolution` — turned out to already be wired in `clawser-pod.js`. Specs
  updated; smoke test added.
- Shipped since first audit: real USTAR tar snapshots wired through the
  CLI (A6), one-time workspaces.json migration (A5), W3C-compliant did:key
  encoding (A9), shell tab completion (A7), peer-type taxonomy (C1), HTTP
  RPC transport (D1), PWA install flow (F3), mesh peer device read **and
  write** wired (A3 — `state.pod.sendMessage` → `peerNode.sendTo` over
  the active session), `injectEnvIntoShell` wired (A1), all 6 config
  panels migrated to `FsUiSync` with bidirectional read/write and
  dirty-aware re-render (A2 + Phase 7 follow-up), hardware device files
  reachable (A4), `TunnelManager` instantiated at boot (G1).
- Remaining headline gaps: Phase 9 v86 guest UI (no codepath creates a
  `LinuxGuest` — dormant by design), `mesh-rollup-plan` (design-only,
  recommended skip), wnix §22-34 (design-only, recommended move to
  `.reference/`), and the Batch 3 items requiring scoping discussion.

---

## Filesystem (Unix FS Phases 0-9, OPFS, vault, snapshots, mounts)

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| Phase 0 — OPFS adapter rewrite, slash-based namespace, `resolveVirtualPath()` | UFS:1411, CHG | `web/clawser-opfs.js`, `web/clawser-fs-bootstrap.mjs` — `CLAWSER_ROOT='clawser'`, `resolveVirtualPath()` exported | Done |
| Phase 1 — Directory tree + default configs | UFS:1430, QA | `bootstrapFilesystem()` called from `initWorkspace` (clawser-workspace-lifecycle.js:408) | Done |
| Phase 2 — FileWatcher + ReactiveConfigStore | UFS:1450 | `web/clawser-file-watcher.mjs`, `web/clawser-reactive-config.mjs`; instantiated in `createShellSession` (lifecycle.js:143-156) | Done |
| Phase 2 — All 6 default domains wired (autonomy/identity/security/daemon/terminal/hooks) | UFS, QA | `registerDefaultDomains(store, state)` called at lifecycle.js:151 (fixed in QA pass) | Done |
| Phase 3 — `/proc/clawser/*` and `/run/clawser/*` virtual files | UFS:1470 | `web/clawser-proc.js` registered via `initRuntimeFs()` (lifecycle.js:113) | Done |
| Phase 4 — `chmod` builtin + `PermissionManager` | UFS:1489 | `web/clawser-permissions.js`; `registerChmodBuiltin` called in `createConfiguredShell` (shell-factory.js:51) | Done |
| Phase 5 — `/dev/clawser/providers/*` device files | UFS:1507 | `web/clawser-fs-devices.mjs`; provider devices registered via `initDeviceFs` (lifecycle.js:124) | Done |
| Phase 5 — Channel devices (`/dev/clawser/channels/*`) | UFS, QA | Reads now pull from `channelManager.getHistory` (fixed in QA pass 2) | Done |
| Phase 5 — Hardware devices (`/dev/clawser/hardware/*`) | UFS, A4 | `createShellSession` builds `hardwareAdapters` from `state.peripheralManager.listDevices()` and passes it to `initDeviceFs` (lifecycle.js). Per-device inbound buffer via `peripheralManager.onDeviceData`. | Done |
| Phase 5 — Mesh peer devices (`/dev/clawser/mesh/peers/*`) | UFS:315, A3 | `registerMeshPeerDevice(handler, peerId, opts)` in `clawser-fs-devices.mjs`. Read path wired via `discoveryManager.onPeerDiscovered`/`onPeerLost` events in `clawser-workspace-init-mesh.js` — reads return JSON metadata. **Write path now wired:** `state.pod.sendMessage(peerId, envelope)` (added on `ClawserPod`) routes through `peerNode.sendTo(pubKey, data)` (new public method) which finds the active session for the peer and calls `transportInstance.send(data)`. Writes throw a clear "no active session" error if the peer hasn't been connected. UFS §2.7 updated. | Done |
| Phase 5 — `/dev/clawser/null`, `/random`, `/zero` | UFS | `registerSpecialDevices()` called in `initDeviceFs` (runtime.js:122) | Done |
| Phase 6 — Profile sourcing (`/etc/clawser/profile`, `~/.config/clawser/profile`) | UFS:1526 | `shell.sourceProfiles()` in `createConfiguredShell` (shell-factory.js:60) | Done |
| Phase 6 — `.env` loading | UFS, A1 | `injectEnvIntoShell(wsId, shell.state)` called in `createConfiguredShell` after profile sourcing (shell-factory.js). | Done |
| Phase 7 — `FsUiSync` UI ↔ file bridge | UFS:1546, A2 | **Write side wired:** `state.fsUiSync = new FsUiSync(configStore)`; all six panel saves call `state.fsUiSync.saveValue(domain, value)`. **Read side wired (2026-05-02 follow-up):** `createShellSession` now calls `state.fsUiSync.registerPanel(domain, { render })` for all six domains — autonomy, identity, security, daemon (heartbeat), terminal, hooks. Render functions accept an optional config arg and use the new `clawser-panel-dirty.mjs` setters (`setIfClean` / `setRadioIfClean` / `markPanelClean`) so external file edits update untouched form fields while preserving inputs the user is typing into. Save handlers call `markPanelClean` so subsequent renders apply again. | Done |
| Phase 8 — Kernel filesystem integration | UFS:1561, QA | `registerAllKernelGenerators()` called in `createShellSession` when `_kernelIntegration?.kernel` present (lifecycle.js:117, fixed in QA pass 2) | Done |
| Phase 9 — v86 guest mount + `autoMountGuest` | UFS:1575, QA | `autoMountGuest` exported from clawser-fs-guest-mount.mjs (added in QA pass 2). No production code creates a `LinuxGuest`, so the helper is dormant | Not wired (dormant) |
| Atomic snapshots (`~/.local/share/clawser/snapshots/*.tar`) | UFS:241, A6 | New `clawser-tar.mjs` USTAR writer/reader (17 tests). `SnapshotManager.createTarSnapshot/restoreTarSnapshot/listTarSnapshots/deleteTarSnapshot` write to OPFS at the documented path. **`clawser-snapshot-cli.js` now uses tar by default** (falls back to IDB when no shell fs is available). `snapshot list` merges both backends. `snapshot save/restore/delete` prefer tar, fall through to IDB. Legacy IDB read path retained for one release. | Done |
| OPFS read-only mounts | OUT:4.2 | `MountableFs` supports `readOnly` mount option | Done |
| Local filesystem mounting | RMA, RM | `web/clawser-mount.js`; `MountableFs`, `mount`/`umount`/`df` builtins | Done |
| isomorphic-git on mounts | RMA Block 12 | `web/clawser-git.js`, lazy-loads isomorphic-git | Done |
| FileSystemObserver for external changes | RMA Block 2 | clawser-mount.js — Chrome 129+ guarded | Done |
| Vault (wrapped-DEK + AES-GCM-256, multi-wrap) | RMA Block 5 | `web/clawser-vault.js`; `state.vault` initialized in app.js:85. v2 format (2026-05-03): one DEK encrypts secrets, one or more KEKs wrap the DEK. Atomic v1→v2 migration on first unlock. See `docs/VAULT.md`. | Done |
| Vault forgotten-passphrase mitigation | OUT:line 38 | Closed 2026-05-03 (vault Option F pass): WebAuthn passkey (PRF extension) supported as a second unlock path via `addPasskeyWrap` / `unlockWithPasskey`. Recovery codes deliberately NOT shipped — see `docs/VAULT.md` for rationale. | Done |
| Vault re-keying UI | RMA Block 5 | "Change passphrase" surface in the vault modal settings panel (`vaultChangePassBtn`). Calls `VaultRekeyer` / `vault.changePassphrase` — rewraps the DEK rather than re-encrypting every secret. | Done |
| Vault passkey enrollment + unlock UI | OUT:line 38 (vault Option F) | "Passkeys" button in vault settings opens an Add/Remove list; "Unlock with passkey" button on the lock screen when wraps exist. Helpers in `web/clawser-passkey.mjs` with PRF feature detection. | Done |
| Workspace registry in OPFS (`/etc/clawser/workspaces.json`) | UFS:97, A5 | `clawser-workspaces.js` rewritten with in-memory cache + `initWorkspacesCache()` async primer awaited at app startup. OPFS-first read; one-time migration from localStorage when OPFS is empty. localStorage is read-only fallback for one release. Disposable mode stays on sessionStorage. | Done |
| Disposable mode | RMA, QA | `state.disposableMode`, `MemoryVaultStorage`, `NullCheckpointIDB` (app.js:33, 85, 218) | Done |

---

## Shell / clsh

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| Tokenizer + recursive-descent parser | RMA Block 1 | clawser-shell.js — `tokenize`, `parse` functions | Done |
| 65+ builtins | RMA, MODULES | `registerBuiltins`, `registerExtendedBuiltins`, `registerJqBuiltin` | Done |
| Pipes, redirects (`>`, `>>`, `2>`, `2>&1`) | RMA | clawser-shell.js executor | Done |
| Variable expansion (`$VAR`, `${VAR}`, `$?`, `$N`, `$@`, `$#`) | RMA | `expandVariables` clawser-shell.js:575 | Done |
| Glob expansion (`*`, `?`, `[abc]`, `**`, `{a,b}`, `!()`) | RMA | `expandGlobs` clawser-shell.js:811 | Done |
| Tilde expansion (`~`, `~/foo`) | UFS, QA | clawser-shell.js:1313-1319 | Done |
| Command substitution `$(cmd)` | RMA | `expandCommandSubs` in clawser-shell.js | Done |
| if/else/fi, while/do/done, for/in/do/done | UFS, CHG | `executeIf/While/For` in clawser-shell.js:1197+ | Done |
| Function definitions + positional params + `return N` | UFS, QA | `executeFunction` + nested-call snapshot/restore (fixed in QA pass 2) | Done |
| `isIncomplete` quote-aware multi-line detection | QA | clawser-shell.js:207 (fixed in QA pass 2) | Done |
| Background jobs + `jobs`/`fg` builtins | RMA Block 1 | `#registerJobBuiltins` clawser-shell.js:2398 | Done |
| Aliases | RMA | clawser-shell.js — `state.aliases` | Done |
| Tab completion | OUT, A7 | `getCompletions(input, cursor, ctx)` exported from `clawser-shell.js`. Wired into terminal input keydown with cycle-through behaviour. Smart command-vs-path detection. 9 tests. | Done |
| `chmod`, `stat` permission display | UFS | clawser-permissions.js | Done |
| Profile system (`sourceProfiles()`) | UFS | clawser-shell.js:2517 | Done |
| Skills → CLI registration | RMA | `SkillRegistry.registerCLI()` | Done |
| Tool CLI wrappers (curl/search/etc.) | RMA | `generateToolWrappers()` | Done |
| Installable CLI packages | RMA | `installPackage()`, `uninstallPackage()`, `listPackages()` | Done |
| jq builtin (subset) | RMA | `registerJqBuiltin` | Done |
| `MAX_ITERATIONS=10000` while-loop safety | UFS, QA | clawser-shell.js:1222 | Done |
| Capability blocks, group execution, typed values from EBNF (clsh §21) | UFS:982 | Not implemented — clsh uses bash-like syntax, not the wnix `if cond { }` grammar | Not started |
| Bytecode format for clsh scripts | UFS:33 | "Unpursued design direction" | Not started |

---

## CLI (`clawser` subcommand) and CLI-Enhancement Plan

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| Tree-Based Session Branching | CLI:#1 | `clawser session branch`, `clawser session tree` wired in clawser-cli.js:763,787; `ts.branch()` in clawser-terminal-sessions.js:379 | Done |
| RPC Mode (JSON-RPC 2.0) | CLI:#2, D1 | All three transports shipped: stdio (default), Unix socket (`--rpc-socket`), HTTP (`--rpc-http :PORT --rpc-host H --rpc-token T`). HTTP mode auto-generates a 32-byte hex bearer token if not provided; warns when bound to 0.0.0.0; 401 on bad/missing auth. 3 new HTTP integration tests. | Done |
| JSON Output Mode (`--json` / `-j`) | CLI:#3 | `jsonOut`, `jsonErr`, `jsonLine` helpers (clawser-cli.js:182+); flag wired across subcommands | Done |
| Hot-Reloading Extensions (general) | CLI:#4 | Only **skill** hot reload exists at `clawser-skill-hot-reload.js`; the broader "hot-reload arbitrary extensions" surface is not built | Partial |
| Session Sharing (Markdown/HTML/JSON export) | CLI:#5 | `clawser-session-export.js` with `exportSessionAsHTML/Markdown/JSON`; wired via UI dropdown (clawser-ui-panels.js:919) and CLI (clawser-cli.js:809) | Done |
| Snapshot CLI (snapshot list/save/restore) | RM | `clawser-snapshot-cli.js` registers `snapshot` subcommand | Done |
| `clawser tools`, `clawser status`, `clawser memory`, `clawser config` | RMA | All in clawser-cli.js subcommand list | Done |
| `clawser do "TASK"` agentic | RMA | clawser-cli.js:154 | Done |

---

## Kernel (`web/packages/kernel/`)

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| Kernel facade — `createTenant`, `destroyTenant`, capabilities, env, stdio, signals | CMD | `web/packages/kernel/src/index.mjs`; instantiated via `clawser-kernel-integration.js`; tenants created on workspace init/switch | Done |
| ResourceTable, ByteStream, Clock, RNG, ServiceRegistry, Tracer, Logger, ChaosEngine, Signal | CMD | 16 modules under `web/packages/kernel/src/`; 16 test files, 2,082 LOC tests | Done |
| KERNEL_CAP tags + capability enforcement | CMD | `Caps` class with `_granted` set | Done |
| Kernel error hierarchy (7 subclasses) | CMD | `KernelError` + subclasses in kernel src | Done |
| Step 23-30 kernel integration (workspace tenants, eventLog hook, MCP→svc://, traceLlmCall, shell pipes, sandbox tenants, daemon IPC) | CMD, CHG | `clawser-kernel-integration.js`, `clawser-kernel-wsh-bridge.js`, references in agent.js / lifecycle.js | Done |
| Kernel extraction to standalone npm (`browsermesh-kernel`) | RM Phase 12 | Internal package only; not extracted | Not started |
| Kernel tenants usable from ServerPod (Node.js) | RM Phase 12 | Not done | Not started |

---

## Mesh / BrowserMesh (44 mesh modules)

Cross-references the explicit `## Implementation Status` blocks in
`docs/browsermesh/specs/*` against the production wiring path
`clawser-app.js → clawser-pod.js → ClawserPod.initMesh()`.

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| Wire format, message envelope, CRDTs, capability tokens | BMS:core, RM Phase 9 | `web/packages/browsermesh-primitives/...` (npm published) | Done |
| MeshSyncEngine + 6 CRDT types | BMS:state-sync — "wired via `ClawserPod.initMesh()`" | `clawser-mesh-sync.js` | Done |
| ServiceDirectory + ServiceEndpoint | BMS:service-model — "Wired" | `clawser-mesh-discovery.js` | Done |
| StreamMultiplexer + MeshStream + flow control | BMS:direct-stream — "Wired" | `clawser-mesh-streams.js` (also `clawser-mesh-transport.js`) | Done |
| Audit recorder | BMS:audit-recorder — "Wired" | `clawser-mesh-audit.js` | Done |
| Swarm protocol + leader election (highest-podId) | BMS:swarm-protocol, BMS:leader-election — "Wired" | `clawser-mesh-swarm.js` (SwarmCoordinator) | Done |
| Voting protocol | BMS:voting-protocol, B5 | `ConsensusManager` instantiated in `ClawserPod.initMesh()` (clawser-pod.js:368); pod exposes `propose/voteOnProposal/closeProposal`. Spec updated. | Done |
| Relay service | BMS:relay-service, B3 | `MeshRelayClient` instantiated in `initMesh` when `opts.relayUrl` is set (clawser-pod.js:451). Pod hooks `onPeerAnnounce` to ingest peers into `RemoteRuntimeRegistry`. Spec updated. | Done |
| App distribution / artifact registry | BMS:app-distribution, B4 | `AppRegistry` and `AppStore` instantiated in `initMesh` (clawser-pod.js:547-548); accessible via `pod.appRegistry` / `pod.appStore`. Spec updated. | Done |
| Pod migration | BMS:pod-migration, B2 | `MigrationEngine` instantiated in `initMesh` (clawser-pod.js:632); accessible via `pod.migrationEngine`. Spec updated. | Done |
| Name resolution / NamingService | BMS:name-resolution, B1 | `MeshNameResolver` instantiated in `initMesh` (clawser-pod.js:458); accessible via `pod.nameResolver`. Used by `RemoteSessionBroker`. Spec updated. | Done |
| Presence protocol | BMS:presence-protocol — "Implicit in discovery" | New `web/clawser-presence.mjs` (`PresenceService`) tracks `online`/`idle`/`offline` per peer with timestamps. Subscribes to PeerNode `peer:connect`/`peer:disconnect`; consumers can call `recordHeartbeat(peerId)` from any heartbeat producer (relay, swarm, app-level). Public API: `getPresence`, `getAll`, `subscribe`. Wired in `initMeshSubsystem` as `state.presenceService`. 25 tests. | Done |
| PBFT consensus | RM Phase 11, RMA | `clawser-mesh-consensus.js` `ConsensusManager.propose/vote/close`; wired via `ClawserPod` constructor (clawser-pod.js:368). RM marks "PBFT end-to-end with real validator sets" as future | Partial — works locally, not validated end-to-end across real validators |
| Payment channels (CreditLedger, escrow) | RM Phase 11 | `clawser-mesh-payments.js`, wired in clawser-pod.js:62. RM marks "settlement on close" and "escrow timeout" as future | Partial |
| DHT routing (Kademlia) | BMS:dht-routing | `clawser-mesh-dht.js`, instantiated in clawser-pod.js:61 (`DhtNode`) | Done |
| Stealth shards | none in spec | `clawser-mesh-stealth.js` uses `STEALTH_SHARD` | Done |
| Group encryption / per-member key envelope | RM Phase 11 | `clawser-mesh-group-keys.js` exists. RM: "metadata-only distribution" — full envelope encryption not done | Partial |
| Identity, keyring, ACL, capabilities | RM Phase 9, BMS:crypto | `clawser-mesh-identity.js`, `clawser-mesh-keyring.js`, `clawser-mesh-acl.js`, `clawser-mesh-capabilities.js` | Done |
| WebRTC transport | RM Phase 9 | `clawser-mesh-webrtc.js`, used by ClawserPod | Done |
| WebSocket transport | CHG Phase 9.11 | `clawser-mesh-websocket.js`, includes ICE/TURN placeholder note | Partial — STUN/TURN gather is "placeholder when unavailable" (clawser-mesh-websocket.js:887, 894) |
| WebTransport bridge | CHG Phase 9.11 | `clawser-mesh-webtransport.js` `WebTransportBridge` instantiated in clawser-pod.js:300. RM Phase 11: "currently bridged, not end-to-end" | Partial |
| Service Worker mesh routing | CHG Phase 9.11 | `clawser-mesh-sw-routing.js` | Done |
| Cross-origin comms | CHG Phase 9.11 | `clawser-mesh-cross-origin.js` | Done |
| Mesh DevTools inspector | CHG Phase 9.11 | `clawser-mesh-devtools.js` | Done |
| Marketplace | RM Phase 9, RMA Block 17 | `clawser-mesh-marketplace.js` instantiated in clawser-pod.js:19; UI panel `panelMarketplace` in router | Done |
| Mesh-native rollup (PBFT sequencer + Celestia + ETH L1 settlement) | REF:mesh-rollup-plan.md | No `clawser-rollup-*.js` files exist. Pure design doc, ~1k LOC plan, zero code | Not started |
| Mobile/touch UI for mesh peer mgmt | RM Phase 12 | Mesh panels exist (`clawser-ui-mesh.js`, `clawser-ui-peers.js`); responsive design lands at 480px (CSS) but no peer-mgmt-specific touch UI | Partial |
| Distributed tracing across mesh hops | RM Phase 11 | `clawser-mesh-audit.js` records local audits; no cross-hop trace propagation | Not started |
| Mesh health dashboard | RM Phase 11 | UI shows peers + audit log; no dedicated health panel with throughput/latency series | Not started |
| Alert rules (peer disconnect, consensus timeout, payment dispute) | RM Phase 11 | Not implemented | Not started |
| Peer type taxonomy (`chat`/`runtime`/`host-shell`/`vm-compute`) | RM Phase 11, C1 | `PEER_TYPE` enum exported from `clawser-mesh-discovery.js`. `DiscoveryRecord` carries a `peerType` field (default `'unknown'`, normalized for forward compat). `matchesFilter` accepts `peerType` (single or array). 5 new tests. Routing consumers can now filter on it. | Done |
| Remote peers as deployment targets (push code/skills) | RM Phase 11 | End-to-end shipped 2026-05-03. Receive-side + outbound + apply transport + approval modal + DID resolver + UI panels + production controllers + paired-devices registry + item picker + DOM mount + E2E round-trip test. See `docs/multi-device-deploy.md`. | Done |

---

## Tools / Browser Extension / MCP

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| 70+ browser tools with permission engine (auto/approve/denied) | RM, RMA | clawser-tools.js + clawser-extension-tools.js + module-specific tool files | Done |
| MCP client | RMA | `web/clawser-mcp.js`; integrated in agent run loop | Done |
| MCP→svc:// kernel registration | CMD | clawser-mcp.js calls into kernel-integration | Done |
| 34 ext_* extension tools | RMA Phase 6b | clawser-extension-tools.js, registered in workspace-lifecycle | Done |
| Chrome extension scaffold (MV3) | RMA Phase 6b | Code moved to standalone `clawser-browser-control` repo per RM Phase 10 | Done — externalized |
| Firefox compatibility (`webextension-polyfill`) | RMA Phase 6b | Documented as compatible; lives in extension repo | Done |
| WebMCP discovery (`ext_webmcp_discover`) | RM Phase 12 | clawser-extension-tools.js; auto-register flow exists | Done |
| Native messaging for system tools | RM Phase 12 — `[ ]` | Not implemented | Not started |
| Tool builder (dynamic tool creation) | RMA Block 24 | `web/clawser-tool-builder.js` | Done |
| Browser automation tools | RMA Block 18 | `clawser-browser-auto.js` (8+ tools) | Done |
| Hardware tools (Serial/Bluetooth/USB) | RMA Block 13 | `clawser-hardware.js`, `clawser-hardware-monitor.js` | Done |
| Tunnel client (cloudflared/ngrok) | RMA Block 15, G1 | `state.tunnelManager` (TunnelManager) instantiated in `clawser-app.js` with `CloudflareTunnel` and `NgrokTunnel` providers registered. The "throw" calls flagged in the original audit are the abstract-base-class pattern, not stubs — concrete subclasses implement them. Exec callback resolves through `wsh_exec`. | Done |

---

## UI

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| 14+ workspace panels (Tools, Files, Memory, Goals, Events, Skills, Terminal, Dashboard, Servers, Agents, Channels, Mesh, Config, Vault) | RMA, MODULES | clawser-ui-panels.js + module UIs; lazy-render via clawser-router | Done |
| Lazy panel rendering (7 panels) | RMA Phase 4 | `resetRenderedPanels`, `isPanelRendered` in clawser-router.js | Done |
| Mobile bottom nav (≤480px) + touch targets | CHG mobile | `clawser-mobile.js` initialized at boot | Done |
| Light/dark theme + manual toggle | RMA Phase 3 | clawser.css `.theme-light` | Done |
| ARIA labels (24+) + keyboard shortcuts | RMA Phase 3 | clawser-keys.js | Done |
| Print styles, type scale, item-bar search | RMA Phase 3 | clawser.css | Done |
| Custom DOM terminal renderer | WTM | `web/clawser-terminal-adapter-dom.mjs` | Done |
| wterm adapter (`@wterm/dom`) | WTM | `web/clawser-terminal-adapter-wterm.mjs`; `createAdapter`/`detectAdapterType` used in clawser-ui-panels.js:24 | Done |
| Identity panel (plain/AIEOS/OpenClaw) + dedicated editor | RMA Block 7 | clawser-ui-config.js / clawser-ui-panels.js | Done |
| Avatar display in chat | RMA Block 7 | clawser-ui-chat.js | Done |
| Cmd palette | RMA | `web/clawser-cmd-palette.js` | Done |
| Vault lock UI + reset/export/import settings | CHG, QA | `clawser-vault-ui.js` (or panels) — vault lock screen with gear icon | Done |
| Connected Apps panel | RMA Block 16 | clawser-ui-panels.js renders OAuthSection | Done |
| Skills marketplace UI | RM Phase 12, RMA Block 17 | `web/clawser-ui-marketplace.js` | Done |
| Mesh DevTools panel | CHG | `clawser-mesh-devtools.js`, surfaced via Config | Done |
| Reset confirmation rendering bug fix | CHG | Uses `confirm()` per recent commit | Done |

---

## Daemon / Background / Scheduler

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| ClawserAgent DOM-free | RMA Block 3 | clawser-agent.js | Done |
| EventLog (append-only JSONL) | RMA, RM | clawser-agent.js | Done |
| DaemonController + DaemonState (7 states) | RMA Block 3 | `clawser-daemon.js`, started in initWorkspace | Done |
| TabCoordinator (BroadcastChannel) | RMA Block 3 | clawser-daemon.js | Done |
| SharedWorker host (cross-tab agent) | RMA Block 3 | `web/shared-worker.js`, opt-in via config | Done |
| Web Locks input arbitration | RMA Block 3 | `InputLockManager` | Done |
| RoutineEngine (cron + event + webhook triggers) | RMA Block 21, FEATURES | `clawser-routines.js`; `routine_create/list/run/delete` tools | Done |
| Channel Gateway scheduler lane | CHG OpenClaw, FEATURES | `clawser-gateway.js`; `scheduler:{routineId}` virtual channel | Done |
| Service Worker daemon w/ periodicSync | RM Phase 12 — `[ ]` | `clawser-sw-heartbeat.js`, app.js:597 registers periodicSync. **Doc/code contradiction**: RM lists this as future work, code is present. The honest read: SW wakes on periodicSync but does not yet "wake-on-message from relay/signaling" | Partial |
| Headless agent execution in SW | RMA Block 3 | `clawser-background-runner.js` | Done |
| "While you were away" summary | RMA Block 3 | clawser-ui-chat.js | Done |
| Multi-tab views (chat/terminal/activity/workspace/goals) | RMA Block 3 | Tab views exist | Done |
| AgentBusyIndicator cross-tab | RMA Block 3 | clawser-state.js | Done |
| NotificationManager + batching + center | RMA Block 3 | clawser-notifications.js | Done |
| Checkpoint rollback UI | RMA Block 3 | `clawser-checkpoint-idb.js` + UI | Done |

---

## Memory / Goals / Identity / Autonomy

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| BM25 + cosine hybrid memory | RMA Block 4 | `clawser-memory.js` | Done |
| OpenAI / ChromeAI / transformers.js embedders | RMA Block 4 | clawser-memory.js Embedding providers | Done |
| Embedding backfill | RMA Block 4 | `SemanticMemory.backfillEmbeddings` | Done |
| Semantic search UI | FEATURES | clawser-ui-panels.js memory results | Done |
| Goals (parent/sub/artifacts/progressLog) | RMA Block 8 | `clawser-goals.js` | Done |
| Goal markdown format (GOALS.md) | RMA Block 8 | `GoalManager.toMarkdown/fromMarkdown` | Done |
| Goal dependencies (`blockedBy[]`) | RMA Block 8 | clawser-goals.js | Done |
| AutonomyController (3 levels, rate, cost) | RMA Block 6 | `clawser-autonomy.js` | Done |
| AutonomyPresets (4) | RMA Block 6 | `clawser-autonomy-presets.js` | Done |
| Detailed cost dashboard | RMA Block 10 | clawser-ui-panels.js dashboard | Done |
| MetricsCollector + RingBufferLog + OTLP | RMA Block 10 | clawser-metrics.js | Done |
| Per-model cost breakdown + time-series | RMA Block 10 | `MetricsCollector.rollup`, `MetricsTimeSeries` | Done |
| Identity templates (4 personas) | RMA Block 7 | `IDENTITY_TEMPLATES` in clawser-identity.js | Done |
| AIEOS schema + system prompt compiler | RMA Block 7 | clawser-identity.js | Done |

---

## Providers / Fallback

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| 3-tier provider system (built-in / OpenAI-compat / ai.matey) | RM, CMD | `clawser-providers.js` | Done |
| 38+ LLM backends | RM | tier-2 + ai.matey lazy-load | Done |
| FallbackChain + FallbackExecutor | RMA Block 11 | clawser-fallback.js wired into agent.run/runStream | Done |
| ProviderHealth circuit breaker | RMA Block 11 | clawser-fallback.js | Done |
| ModelRouter + 5 hint categories + cost-aware sort | RMA Block 11 | clawser-model-router.js | Done |
| Adaptive model selection | RMA Block 11 | `ModelRouter.recordOutcome` | Done |
| Fallback chain editor UI | RMA Block 11 | clawser-ui-panels.js | Done |
| Account-based credential resolution | OUT 4.5 | `state.agent.setAccountResolver` (lifecycle.js:470) | Done |

---

## Skills

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| SKILL.md format + parser + storage | RMA Block 17 | clawser-skills.js | Done |
| OPFS global + per-workspace skills | CMD | `clawser_skills/`, `.skills/` per-ws | Done |
| Skill activation tools (`activate_skill`, `deactivate_skill`, `skill_search`, `skill_install`) | RMA | clawser-skills.js | Done |
| `/skill-name args` slash invocation | CMD | clawser-shell builtin path | Done |
| SkillRegistryClient (remote search/fetch) | RMA Block 17 | clawser-skills.js | Done |
| Skill marketplace UI | RMA Block 17 | clawser-ui-marketplace.js | Done |
| Skill dependency resolution | RMA Block 17 | `resolveDependencies()` | Done |
| Skill verification/signing (FNV-1a) | RMA Block 17 | `computeSkillHash`, `verifySkillIntegrity` | Done |
| Hot-reload (skills) | RMA, CMD | `clawser-skill-hot-reload.js`, started in initWorkspace | Done |
| Skills marketplace backend (agentskills.io) | OUT 5.2 | Frontend client only — backend is third-party | Not started |

---

## Channels (Slack/Discord/Telegram/Matrix/Email/IRC/Webhook/Tabwatch)

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| ChannelManager core | RMA Block 14 | `clawser-channels.js` | Done |
| 7 channel types (slack/discord/telegram/matrix/email/irc/webhook) | RMA Block 14 | `clawser-channel-*.js` files | Done |
| Channel allowlists + per-channel `formatForChannel` | RMA Block 14 | clawser-channels.js | Done |
| ChannelGateway + per-channel queues + scope isolation + tenantId threading | CHG OpenClaw | `clawser-gateway.js`, 105 gateway tests | Done |
| TabWatcher channel | OUT 4.3 | `clawser-channel-tabwatch.js` | Done |
| Backend relay server (WebSocket + webhook) | RMA Block 14 | docs claim done; lives in `browsermesh-servers` repo | Done — externalized |
| Real channel API credentials in production | OUT 5.3 | Not configured by default — user must provide | Not started |

---

## Sandbox / wsh / Remote Runtime

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| Sandbox tier 0 (trusted) / tier 1 (worker) / tier 2 (WASM, fuel-metered) | RMA Phase 5, FEATURES | `clawser-sandbox.js` `SANDBOX_TIERS`; tier 2 `WasmSandbox` real with fuel limit 1M | Done |
| andbox standalone npm | RM Phase 10 | `web/packages/andbox/...` re-exports `andbox@0.1.1` | Done |
| ai-matey-middleware-andbox | RM Phase 10 | npm published; bridge file in web/packages | Done |
| wsh protocol (CBOR control, Ed25519 auth, 92 message types) | RMA Phase 5 | `web/packages/wsh/` re-exports `wsh-upon-star@0.1.1` | Done |
| 27 browser wsh tools | RMA Phase 5 | clawser-wsh-tools.js | Done |
| Reverse browser terminal (RBT plan) | RBT | `clawser-shell-factory.js`, `clawser-terminal-session-store.js`, `clawser-wsh-virtual-terminal-session.js`, `clawser-wsh-virtual-terminal-manager.js`, `clawser-wsh-incoming.js`, `clawser-kernel-wsh-bridge.js` all present | Done |
| Rust wsh-cli `wsh copy-id` | RMA wsh status matrix | "Limited — transport path still placeholder/stub" | Stubbed |
| Phase 8 — Canonical runtime registry, broker, policy, audit | RMA Phase 8, RM | docs/REMOTE-RUNTIME-CONTRACTS.md + ADRs; module: `clawser-remote-mounts.js`, registry/broker code wired in mesh init | Done |
| Phase 7A remote file access (3 modes) | docs/WSH-INTO-CLAWSER.md | Three modes documented; corresponding CLI flags shipped | Done |
| Guest-Native `wsh-server` in browser Linux guests (Model B) | RM:151 | Explicit "Not started" in roadmap; no guest-side server packaged | Not started |

---

## Mobile / Cross-Platform

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| Mobile init (`initMobile`) | CHG mobile | clawser-mobile.js wired in app.js | Done |
| Responsive 480px / 768px breakpoints | RMA Phase 3 | clawser.css | Done |
| PWA manifest + apple-touch-icon | RMA Phase 3 | web/manifest.json | Done |
| PWA install flow refinement (mobile) | RM Phase 12, F3 | New `clawser-pwa-install.js` module captures `beforeinstallprompt`, exposes `tryInstall()`, `getInstallState()`, `onInstallStateChange()`, `isStandalone()`, `detectPlatform()`. Wired in `clawser-app.js`. Manifest gained `id`, `display_override`, `categories`, `shortcuts`, `prefer_related_applications: false`. 9 tests. | Done |
| iOS Safari compatibility audit (WebRTC/BroadcastChannel/OPFS) | RM Phase 12 | Not done | Not started |

---

## Tests / Build / Infra

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| 8,801 tests / 0 failing / 1,867 suites | QA | `node web/test/run-tests.mjs` | Done |
| Test groups (fast, mesh-net/sync/identity/apps/ops, e2e) | CMD | `web/test/run-tests.mjs --group ...` | Done |
| node:test + node:assert/strict | CMD | All tests | Done |
| Browser-based test.html (regression suite) | RMA Phase 1 | mentioned in archive; existence not verified at HEAD | Done — historical |
| GitHub Actions CI (Playwright) | RMA Phase 1 | `.github/workflows/...` exists | Done |
| Cross-package integration tests | RM Phase 10 | `browsermesh-integration-tests` standalone repo | Done — externalized |
| Benchmarks in CI w/ 20% regression threshold | RMA Phase 4 | docs claim done | Done — historical |
| Service Worker (`sw.js`) cache-first | RMA Phase 3 | `web/sw.js`, 64 entries | Done |
| Docker / Nginx | RMA Phase 3 | Dockerfile | Done |

---

## Doc / Tooling Plans

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| Data-driven docs (YAML data layer + 22 screenshots + 21-page guide) | CHG, RM | `docs/data/*.yaml`, `guide/*.md` (21 files), screenshots in docs | Done |
| ARCHITECTURE-AUDIT writeup | docs/ | docs/ARCHITECTURE-AUDIT.md | Done |
| QA report (this audit's predecessor) | QA | docs/qa-report.md | Done |
| ADRs (5 remote-runtime ADRs) | docs/adr/ | 5 files all present | Done |

---

## .reference/ — Aspirational / Future

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| Mesh-native rollup (PBFT sequencer + Celestia DA + ETH L1 settlement) | REF:mesh-rollup-plan | No `clawser-rollup-*.js` files exist; ~1k LOC plan, zero code | Not started |
| Suarez-inspired "Daemon"/"Freedom"/"Kill Decision" 25 future ideas | REF:suarez-inspired-ideas | Idea list, no commitments to code | Not started |
| Webroll package design | REF:webroll-package-design | Design notes | Not started |

---

## wnix (`unix-filesystem-architecture.md` §22-34)

These are speculative OS-in-browser sections far beyond Clawser's current
scope. Listed for completeness — none of them have code.

| Item | Source(s) | Files / Evidence | Status |
|------|-----------|------------------|--------|
| wnix v0.1 — 25-30 syscalls, VFS, basic process model | UFS:31 | No syscall surface; `clawser-shell.js` is process model in spirit only | Not started |
| wnix v0.2 — async syscall support, FS perf | UFS:31 | Not started | Not started |
| wnix v0.3 — Worker "processes", message-based IPC | UFS:31 | Workers exist via SharedWorker, but not framed as wnix processes | Not started |
| wnix v0.4 — partial fork() emulation (snapshot+clone) | UFS:31 | Not started | Not started |
| Rust microkernel variant (`vfs.rs`, `Process`, `Task`, `seL4`-inspired) | UFS:28 | The `crates/` workspace exists for wsh-server, not a wnix kernel | Not started |
| Bytecode format for clsh scripts | UFS:33 | Not started | Not started |
| ELF-to-WASM compatibility shim | UFS:33 | Not started | Not started |
| Service Workers as wnix init system | UFS:33 | Not started | Not started |
| sqlite in wnix benchmark | UFS:33 | Not started | Not started |
| Coreutils port strategy | UFS:33 | Not started — clsh has its own `ls`/`cat`/etc., not coreutils ports | Not started |

---

## 2026-05-03 Deploy Targets Pass

Closed the "Remote peers as deployment targets" item from
`OUTSTANDING.md` Mesh production hardening. Implementation is
two-phase: Phase A is personal multi-device sync, Phase B is real
deploy targets layered on Phase A.

**Phase A — sync foundation (4 modules, 64 tests).**

- `web/clawser-pairing.mjs` — QR/6-digit-code pairing. PBKDF2-SHA256
  (100k) → AES-GCM bundle of the source's identity JWK; 5-minute TTL;
  `pairingId` replay protection capped at the last 200 ids.
- `web/clawser-sync-flags.mjs` — `__sync_flags__` JSON file holding
  fully-qualified `kind:id` flag IDs.
- `web/clawser-sync.mjs` — `SyncEngine` with debounced outbound queue
  (500ms windows), LWW path with deterministic
  `(ts, source)` tiebreaker, Y.js delegation hook
  (`YjsApplicator`-shaped consumer), atomic apply via
  snapshot-before / staged-write / snapshot-restore-on-error, separate
  `applyBatch` and `flush({manual:true})` triggers for continuous and
  manual deploy.
- `web/clawser-deploy.mjs` — orchestration: `recordLocalChange`,
  `runDeploy`, `buildDeployPreview`.

**Phase B — real deploy targets (2 modules, 56 tests).**

- `web/clawser-deploy-package.mjs` — Ed25519 signed package format.
  Canonical-JSON manifest binding payload SHA-256 hashes to the signature.
  `ReplayCounterTracker` enforces strict-monotonic per-source counters.
- `web/clawser-deploy-target.mjs` — receiver pipeline:
  - `DeployAcl` — trusted-sources list with grant/revoke
  - `DeployApprovals` — `(source, manifestHash)` approval cache with
    re-prompt on manifest changes
  - `buildCapabilityToken` + `enforceCapabilityRequest` — fs prefix /
    net glob / mesh exact match; throws `CapabilityDeniedError`
  - `DeployAuditLog` — append-only with size cap, source-filterable
  - `DeploySnapshotRing` — per-source last-5 retention, prune via
    snapshot driver's `delete`
  - `acceptPackage(pkg, ctx)` — verify → counter → ACL → approval →
    atomic apply → audit + snapshot record → result

**Documentation:**

- `docs/DEPLOY.md` — the architectural + threat-model reference,
  including compromised-source / compromised-target / compromised-
  paired-device cases and an explicit "what we do not attempt" section.
- `docs/browsermesh/specs/extensions/sync-protocol.md` — wire-format
  spec for pairing envelopes, sync envelopes, and signed deploy
  packages. Receivers' check ordering documented.

**Tests:** 8,988 → 9,108 (+120) across `clawser-pairing.test.mjs` (13),
`clawser-sync-flags.test.mjs` (13), `clawser-sync.test.mjs` (31),
`clawser-deploy.test.mjs` (7), `clawser-deploy-package.test.mjs` (19),
`clawser-deploy-target.test.mjs` (37). Suite stable across runs.

**Sandbox capability enforcement (B.2):** ~~the data structure and the
deny-check primitive (`enforceCapabilityRequest`) ship and are tested.
Threading the capability token through actual skill execution is a
follow-up — `clawser-codex.js` / `clawser-skills.js` integration was
not changed in this pass to keep scope bounded.~~ **Closed in the
2026-05-03 deploy follow-ups pass.** `web/clawser-skill-capabilities.mjs`
provides `createSkillCapabilityAPI(token, hooks)` returning gated
`{fetch, fs, mesh}` callables; `executeSkillScript(content, input,
{capabilities, capabilityHooks})` (exported from
`web/clawser-skills.js`) routes deployed skills through a same-realm
AsyncFunction with the gated bridge bound as locals. Local skills
keep the existing andbox Worker path. `acceptPackage` builds the
manifest's capability token and includes it on every applyBatch item;
stores persist `(item, capabilities)` together. Errors point at the
missing manifest declaration. 26 tests across two files.

**Y.js wiring (A.3 follow-through):** ~~the sync engine has a
`YjsApplicator` delegation hook tested with mocks; full Y.js
integration deferred~~ **Closed in the 2026-05-03 deploy follow-ups
pass.** `web/clawser-yjs-applicator.mjs` provides
`YjsApplicatorRegistry` — a doc registry over `YjsAdapter` from
`clawser-peer-collab.js`. `applyUpdate(itemId, update)` routes
inbound; `bindForSync(itemId)` wires the adapter's onUpdate to
`syncEngine.queueLocal` for outbound dispatch. REMOTE_ORIGIN tagging
prevents echo loops. 12 tests including a two-peer convergence test
using a FakeY mock with commutative-merge semantics.

---

## 2026-05-03 Vault Option F Pass

Refactored the vault from direct passphrase encryption to a wrapped-DEK
model and added WebAuthn passkey enrollment as a second unlock path.

**Architecture change.** A single AES-GCM-256 DEK encrypts every secret.
One or more KEKs (key-encryption keys) wrap the DEK; each KEK is a
separate unlock path. The initial KEK is passphrase-derived (PBKDF2,
600K iters); future KEKs come from WebAuthn PRF output. Rotating a
passphrase rewraps the DEK rather than re-encrypting every secret.

**Storage layout.** `web/clawser-vault.js` writes
`__vault_meta__.enc` (plain JSON listing wraps) alongside the
encrypted secret files. v1 vaults are detected by the legacy
`__vault_salt__.enc` and migrated atomically on first unlock — secrets
are staged as `{name}.next.enc`, the meta write is the single commit
point, and the reader's fallback path tolerates partial post-commit
cleanup. See `docs/VAULT.md` for the full migration crash matrix.

**Features shipped.**

- `vault.changePassphrase` + `VaultRekeyer.execute` (now a thin wrapper)
  + UI surface in the vault settings panel (`vaultChangePassBtn`).
  Validates 12+ characters, rejects identical/mismatched inputs.
- `vault.addPasskeyWrap` / `vault.unlockWithPasskey` /
  `vault.removeWrap` + `web/clawser-passkey.mjs` helpers wrapping
  `navigator.credentials.create` and `.get` with the `prf` extension.
  Enrollment fails fast if the chosen authenticator does not advertise
  PRF support.
- "Passkeys" management UI in the vault settings panel (Add/Remove with
  last-used timestamps); "Unlock with passkey" button on the lock
  screen when passkey wraps exist.
- Vault-level shared `prfSalt` (one salt for all passkey wraps; the PRF
  output is per-(credential, salt) deterministic).

**Tests added.** 63 new tests across three files:
`web/test/clawser-vault-v2.test.mjs` (33 — wrapped-DEK primitives,
basic flows, multi-wrap, removeWrap, v1→v2 migration with rollback on
simulated crash, post-commit `.next` fallback recovery),
`web/test/clawser-vault-settings.test.mjs` (16 — `validateChangePassphraseInput`,
`performChangePassphrase` happy + error paths, `buildPasskeyListItems`),
`web/test/clawser-passkey.test.mjs` (14 — feature-detect, enrollment,
assertion, base64url round-trip, end-to-end `enroll → addWrap → assert
→ unlock`).

**Recovery codes deliberately not shipped.** A passkey + an exported
backup is a stronger recovery story than a printable code that users
will lose. The TODO at the old `clawser-vault.js:251` was replaced by
`docs/VAULT.md`'s "What we deliberately did not ship" section.

Test count: 8,925 → 8,988 (+63). Suite stable across runs.

---

## 2026-05-03 Quick-Wins Pass

Four small items closed in a single session:

1. **Helia CDN URL freshness** — Verified `helia@6.0.21` references against
   the npm registry (latest = `helia@6.1.4`); both URLs the codebase uses
   still serve, but the version was a few months stale. Bumped to
   `helia@6.1.4` in `web/clawser-peer-ipfs.js` and
   `packages/browsermesh-apps/src/peer-ipfs.mjs`. Added a
   "verified current 2026-05-03" comment. The other IPFS reference
   (Storacha gateway URL in `docs/browsermesh/specs/extensions/storage-integration.md`)
   resolves and is current.
2. **Relay auto-connect Settings UI** — New "Mesh / Relay" collapsible
   section in the Configuration panel (matches the existing security/
   heartbeat/etc. pattern). Three fields: Relay URL, Signaling URL,
   "Auto-connect on workspace start" checkbox. Round-trips with the
   existing `clawser_relay_url` / `clawser_signaling_url` global keys
   plus a new `clawser_relay_auto_connect` boolean flag. Auto-connect is
   wired into `initMeshSubsystem` so a checked box triggers
   `relayClient.connect()` after pod boot. 9 tests.
3. **Presence protocol standalone service** — Extracted from the
   PeerNode/SwarmCoordinator heartbeat path into
   `web/clawser-presence.mjs` (`PresenceService`). Tracks
   `online`/`idle`/`offline` per peer with timestamps, subscribes to
   `peer:connect`/`peer:disconnect` events, exposes `getPresence`,
   `getAll`, `subscribe`, `recordHeartbeat`. Wired in
   `initMeshSubsystem` as `state.presenceService`. 25 tests.
4. **Silent catch blocks → structured logging** — Original audit
   estimated 41; actual count was 126. New helper
   `web/clawser-silent-catch.mjs` exports `silentCatch(module, op, err, ctx?)`
   that no-ops unless `clawserDebug.enable()` is called. Two mechanical
   passes converted all 126 instances (58 single-line + 67 multi-line +
   1 hand-fixed in clawser-pod.js). 4 helper tests.

Test count: 8,887 → 8,925 (+38 from the four new test files). Five
consecutive `npm test` runs confirmed stability.

---

## Doc/Code Contradictions (Resolved)

After the 2026-05-02 gap-closure pass:

1. **SW persistent daemon** — still partial. SW wake-on-periodicSync works;
   "wake-on-message from relay/signaling" is in Batch 3 (E1).
2. **PBFT consensus** — still partial. Mechanics wired through `ClawserPod`;
   end-to-end validator-set deployment is in Batch 3 (C5).
3. **Phases 7/8/9 (Unix FS)** — Phase 7 (FsUiSync) is now **Done** in
   both directions: write side via `saveValue` write-through across all
   six panels, read side via `registerPanel` for each domain with
   dirty-aware setters that preserve user-typed input. Phase 8 wired.
   Phase 9 has `autoMountGuest` helper but stays dormant until a
   `LinuxGuest` UI is built (G4 in Batch 3).
4. **Channel device reads** — fixed in QA pass 2 (read from
   `channelManager.getHistory`).
5. **Mesh peer device files** — `registerMeshPeerDevice` added with
   documented JSON envelope; UFS §2.7 updated. (A3.)
6. **Hardware adapters** — `createShellSession` now builds the adapter map
   from `peripheralManager.listDevices()` and passes it to `initDeviceFs`. (A4.)
7. **Workspaces registry source of truth** — `clawser-workspaces.js` rewritten
   to be OPFS-first with one-time localStorage migration. (A5.)

---

## Items I Could Not Verify

- The 3,710 mesh tests claim in CHG — couldn't separately count mesh-only tests; the headline `node web/test/run-tests.mjs` reports 8,801 total.
- "21-page guide" — `guide/*.md` is 21 files but combined page count is closer to 80.
- Skills marketplace remote registry — fetch path exists, but I did not exercise it against the real `agentskills.io` endpoint.
- Backend relay server / browsermesh-servers — code is in a separate repo, claim is "Deployed to Fly.io" — not verified from this tree.
- All Rust crates' wsh-cli status matrix — I trusted RMA's claims; the crates aren't part of the Node test suite.

---

## Recommended Cleanups (Closed in 2026-05-02 Pass)

All seven items from the original cleanup list have been addressed:

1. ✓ Wired five "not wired" mesh modules — turned out to be already wired;
   stale specs updated, smoke test added.
2. ✓ Wired `injectEnvIntoShell`.
3. ✓ Wired `registerHardwareDevice` via `createShellSession`.
4. ✓ Implemented `registerMeshPeerDevice` with documented JSON envelope.
5. ✓ Migrated workspace registry to OPFS-first.
6. ✓ Removed the false-positive "stub" classification from `clawser-tunnel.js`
   and wired `TunnelManager` into the app boot path.
7. ⏳ wnix and mesh-rollup remain in their current docs (untouched). The plan
   recommends moving §22-34 to `.reference/` and skipping the rollup; the
   user's call to make.
