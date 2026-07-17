# Feature Modules

Feature modules extend the core agent with specialized capabilities. Each module registers tools, state, and UI components.

## Module Manifest

| Module | File | Tools | Description |
|--------|------|-------|-------------|
| Tool Builder | `clawser-tool-builder.js` | `tool_build`, `tool_test`, `tool_list_custom`, `tool_edit`, `tool_remove`, `tool_promote` | Dynamic tool creation at runtime |
| Channel Gateway | `clawser-gateway.js` | — | Central hub orchestrating channel plugins, scheduler lane, and mesh sessions into the agent. Per-channel serialized queuing, scope isolation, tenantId threading, response routing. |
| Multi-Channel | `clawser-channels.js` | `channel_create`, `channel_list`, `channel_send`, `channel_history`, `channel_delete` | Cross-tab and WebSocket messaging |
| Delegation | `clawser-delegate.js` | `agent_delegate` | Sub-agent task delegation |
| Git | `clawser-git.js` | `git_status`, `git_diff`, `git_commit`, `git_log`, `git_recall` | Git-aware operations via OPFS |
| Routines | `clawser-routines.js` | `routine_create`, `routine_list`, `routine_run`, `routine_delete` | Scheduled and triggered routines |
| Sandbox | `clawser-sandbox.js` | `sandbox_run`, `sandbox_status` | Sandboxed code execution (uses andbox Worker sandbox) |
| Hardware | `clawser-hardware.js` | `hw_list`, `hw_connect`, `hw_send`, `hw_read`, `hw_disconnect`, `hw_info`, `hw_monitor` | Hardware device integration |
| wsh Tools | `clawser-wsh-tools.js` | `wsh_connect`, `wsh_exec`, `wsh_fetch`, `wsh_upload`, `wsh_download`, `wsh_pty_open`, `wsh_pty_write`, `wsh_disconnect`, `wsh_sessions`, `wsh_mcp_call` | Remote shell, file transfer, CORS proxy |
| Goals | `clawser-goals.js` | `goal_add`, `goal_update`, `goal_add_artifact`, `goal_decompose`, `goal_list` | Hierarchical goal tracking |
| Skills | `clawser-skills.js` | `skill_activate`, `skill_deactivate`, `skill_search`, `skill_install` | Skill management and community registry |
| Terminal Sessions | `clawser-terminal-sessions.js` | — | `TerminalSessionManager` — persists terminal sessions (event log + state snapshot) to OPFS; no agent tools, driven by UI (item bar / panel switching) |
| Model Tools | `clawser-model-tools.js` | `model_list`, `model_pull`, `model_remove`, `model_status`, `transcribe`, `speak`, `caption`, `ocr`, `detect_objects`, `classify_image`, `classify_text` | Local AI model lifecycle + on-device ML pipelines (works with `clawser-models.js`) |
| OAuth | `clawser-oauth.js` | `oauth_list`, `oauth_connect`, `oauth_disconnect`, `oauth_api` | Third-party OAuth connection management |
| Virtual Servers | `clawser-server-tools.js` | `server_list`, `server_add`, `server_remove`, `server_update`, `server_start`, `server_stop`, `server_logs`, `server_test` | Virtual HTTP server subsystem |
| Extension Bridge | `clawser-extension-tools.js` | `ext_status`, `ext_capabilities`, `ext_tabs_list`, `ext_tab_open`, `ext_tab_close`, `ext_tab_activate`, `ext_tab_reload`, `ext_navigate`, `ext_go_back`, `ext_go_forward`, `ext_screenshot`, `ext_click`, `ext_type`, … (37 tools total) | Browser automation mediated by the companion Chrome extension (tabs, DOM, screenshots, console/network introspection, WebMCP) |
| Browser Automation | `clawser-browser-auto.js` | `browser_open`, `browser_read_page`, `browser_click`, `browser_fill`, `browser_wait`, `browser_select`, `browser_scroll`, `browser_evaluate`, `browser_list_tabs`, `browser_close_tab` | Extension-independent browser automation |
| Chrome AI Tools | `clawser-chrome-ai-tools.js` | `chrome_ai_write`, `chrome_ai_rewrite`, `chrome_ai_summarize` | Wraps Chrome 138+ on-device Writer/Rewriter/Summarizer APIs |
| Auth Profiles | `clawser-auth-profiles.js` | `auth_list_profiles`, `auth_switch_profile`, `auth_status` | Multiple credential-profile switching |
| Netway Tools | `clawser-netway-tools.js` | `netway_connect`, `netway_listen`, `netway_send`, `netway_read`, `netway_close`, `netway_resolve`, `netway_status`, `netway_udp_send` | Virtual TCP/UDP networking (sockets, listeners, DNS) |
| Mount | `clawser-mount.js` | `mount_list`, `mount_resolve` | Remote/virtual filesystem mount registry |
| Third-Party Integrations | `clawser-integration-calendar.js`, `clawser-integration-email.js`, `clawser-integration-github.js`, `clawser-integration-slack.js` | `calendar_awareness`, `calendar_freebusy`, `calendar_quick_add`, `email_draft`, `email_summarize`, `email_triage`, `github_pr_review`, `github_issue_create`, `github_code_search`, `slack_integration_monitor`, `slack_integration_draft_response` | Focused, opinionated helper tools layered on top of the generic OAuth/API integrations |
| Agent Storage | `clawser-agent-storage.js` | — | Agent definition persistence |
| OPFS Utility | `clawser-opfs.js` | — | Shared OPFS path traversal (`opfsWalk`, `opfsWalkDir`) |
| Snapshots | `clawser-snapshots.js` + `clawser-snapshot-cli.js` | `snapshot save/restore/list/delete/info` (top-level shell commands) | Atomic workspace snapshots. Tar-on-OPFS backend writes to `~/.local/share/clawser/snapshots/{id}.tar` (USTAR via `clawser-tar.mjs`); legacy IDB backend retained as one-release fallback. |
| USTAR Tar | `clawser-tar.mjs` | — | Pure-JS POSIX tar writer/reader. Used by snapshots and any future export/import flow. |
| FS Bootstrap | `clawser-fs-bootstrap.mjs` | — | Phase-0/1 OPFS directory tree creation + default-config writing. |
| FS Devices | `clawser-fs-devices.mjs` | — | Phase-5 device-file handler. `/dev/clawser/{providers,channels,hardware,mesh/peers,null,random,zero}`. |
| FS Env Loader | `clawser-fs-env.mjs` | — | Phase-6 `.env` parser + shell-env injection (`injectEnvIntoShell`). |
| FS UI Sync | `clawser-fs-ui-sync.mjs` | — | Phase-7 bidirectional UI ↔ file sync. `state.fsUiSync.saveValue(domain, value)` writes through to OPFS. |
| FS Kernel | `clawser-fs-kernel.mjs` | — | Phase-8 kernel introspection generators for `/proc/kernel/*` and `/sys/kernel/*`. |
| FS Guest Mount | `clawser-fs-guest-mount.mjs` | — | Phase-9 v86 guest filesystem mount + `autoMountGuest` lifecycle wiring. Dormant until a `LinuxGuest` UI is wired. |
| File Watcher | `clawser-file-watcher.mjs` | — | OPFS polling watcher with debounce + change detection. |
| Reactive Config | `clawser-reactive-config.mjs` | — | Watcher-backed config store with apply/validate/subscribe. `registerDefaultDomains` wires autonomy/identity/security/daemon/terminal/hooks. |
| Permissions | `clawser-permissions.js` | `chmod` (top-level shell command) | Phase-4 virtual permission layer with manifest-based enforcement. |
| Proc | `clawser-proc.js` + `clawser-runtime.js` | — | Phase-3 read-only `/proc/clawser/*` and `/run/clawser/*` virtual files. |
| RPC | `clawser-rpc.mjs` | `clawser rpc` (CLI subcommand) | JSON-RPC 2.0 server for programmatic agent access. Three transports: stdio (default), Unix socket (`--rpc-socket`), HTTP (`--rpc-http` with bearer-token auth). |
| Tunnels | `clawser-tunnel.js` | — | `TunnelManager` with `CloudflareTunnel` + `NgrokTunnel` providers. Instantiated at boot; UI surface still pending. |
| PWA Install | `clawser-pwa-install.js` | — | Captures `beforeinstallprompt`, exposes `tryInstall()`/`getInstallState()`/`onInstallStateChange()`/`isStandalone()`/`detectPlatform()`. |
| Workspaces | `clawser-workspaces.js` | — | Workspace registry. OPFS-first at `/etc/clawser/workspaces.json` with one-time localStorage migration. Synchronous accessors hit an in-memory cache primed by `initWorkspacesCache()`. |

## Internal Packages

`web/packages/kernel/` and `web/packages/browsermesh-{core,discovery,sync,transport,apps}/` are vendored locally under `web/packages/` (own `package.json` + `src/`; kernel also carries README/`test/`). The pod/andbox/wsh/netway/mesh-primitives packages, by contrast, were migrated to published npm packages (devDependencies) and are consumed through thin re-export bridge files at the top of `web/` — e.g. `import { Pod } from './packages-pod.js'` — so internal modules keep a stable import path even though the source now lives in `node_modules/`, not this repo.

| Package | npm name | Bridge file | Description |
|---------|----------|-------------|-------------|
| **kernel** | `browsermesh-kernel` (local, `web/packages/kernel/`) | `web/packages-kernel.js` | Capability-secure browser microkernel — resource handles, IPC, tracing, chaos engineering |
| **pod** | `browsermesh-pod` (external) | `web/packages-pod.js` | Pod base class — 6-phase boot sequence (identity, discovery, messaging), zero Clawser deps. Extended by ClawserPod, InjectedPod, EmbeddedPod |
| **andbox** | `andbox` (external) | `web/packages-andbox.js` | Worker-based sandboxed JS runtime with RPC capabilities, import maps, and capability gating |
| **wsh** | `wsh-upon-star` (external) | `web/packages-wsh.js` | Web Shell — browser-native remote command execution over WebTransport/WebSocket with Ed25519 auth |
| **netway** | `browsermesh-netway` (external) | `web/packages-netway.js` | Virtual networking — TCP/UDP sockets, listeners, policy-based routing |
| **mesh-primitives** | `browsermesh-primitives` (external) | `web/packages-mesh-primitives.js` | Mesh wire format, identity, capability tokens, trust graph, CRDTs |
| **ai-matey-middleware-andbox** | `ai-matey-middleware-andbox` (external) | none — not currently imported anywhere in `web/` | ai.matey middleware for LLM code extraction → andbox execution (present as a devDependency but dormant/unwired) |

Separately, the repo-root `packages/*` directory (npm workspaces) holds the canonical, npm-publishable source for `browsermesh-core`, `browsermesh-transport`, `browsermesh-apps`, `browsermesh-discovery`, `browsermesh-sync`, and `clawser-embed`. Node-side consumers (the `node:test` suite, `npm run test:mesh*`) resolve these via normal npm workspace symlinks in `node_modules/`.

The browser can't reach the repo root — both deploy targets (GitHub Pages, Cloudflare Workers) ship only `web/` as the site root, and `web/index.html`'s import map originally pointed `browsermesh-*` at `../packages/...`, which 404s in every real deployment (and in any local static server rooted at `web/`). Following the kernel precedent, `web/packages/browsermesh-{core,discovery,sync,transport,apps}/src/` holds a **committed copy** of each package's `src/` (no `test/`), and the import map points there via `./packages/browsermesh-*/src/index.mjs`. This is a second, manually-synced copy of the source — there is no automated sync between `packages/browsermesh-*` and `web/packages/browsermesh-*`. When editing one of these packages, re-copy `src/*.mjs` (and `package.json` if it changed) into the matching `web/packages/browsermesh-*/src/` directory as part of the same change.

The original `web/clawser-mesh-*.js` / `web/clawser-peer-*.js` files these packages were extracted from still exist as duplicates; only a handful of `web/*.js` consumers (`clawser-pod.js`, `clawser-workspace-init-mesh.js`, `clawser-app.js`, `clawser-workspace-lifecycle.js`, `clawser-server-services.js`, `clawser-yjs-applicator.mjs`) have been rewired to import from the `browsermesh-*` packages instead; the rest of the internal mesh subsystem still imports the original `web/clawser-mesh-*.js` files directly.

## Module Lifecycle

1. **Import**: Module loaded via dynamic `import()` in `clawser-app.js`
2. **Instantiate**: Constructor receives agent instance and options
3. **Register tools**: Each module calls `browserTools.register()` for its tools
4. **Store reference**: Singleton stored in `state.features.{moduleName}`

## Adding a Module

1. Create `web/clawser-{name}.js`
2. Export a class with a constructor accepting `(agent, browserTools, opts)`
3. Register tools in the constructor via `browserTools.register(new YourTool())`
4. Import and instantiate in `clawser-app.js` during workspace init
5. Store in `state.features.{name}`
