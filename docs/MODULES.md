# Feature Modules

Feature modules extend the core agent with specialized capabilities. Each module registers tools, state, and UI components.

## Module Manifest

| Module | File | Tools | Description |
|--------|------|-------|-------------|
| Tool Builder | `clawser-tool-builder.js` | `tool_create`, `tool_edit`, `tool_delete`, `tool_list` | Dynamic tool creation at runtime |
| Multi-Channel | `clawser-channels.js` | `channel_create`, `channel_list`, `channel_send`, `channel_receive` | Cross-tab and WebSocket messaging |
| Delegation | `clawser-delegation.js` | `delegate_task`, `delegate_status`, `delegate_cancel` | Sub-agent task delegation |
| Git Behavior | `clawser-git-behavior.js` | `git_status`, `git_diff`, `git_commit`, `git_log` | Git-aware operations via OPFS |
| Git Memory | `clawser-git-memory.js` | `git_memory_store`, `git_memory_recall` | Version-controlled memory |
| Automation | `clawser-automation.js` | `routine_create`, `routine_list`, `routine_run`, `routine_delete` | Scheduled and triggered routines |
| Sandbox | `clawser-sandbox.js` | `sandbox_exec`, `sandbox_status` | Sandboxed code execution (uses andbox Worker sandbox) |
| Peripherals | `clawser-peripherals.js` | `peripheral_list`, `peripheral_connect`, `peripheral_send` | Hardware device integration |
| Pairing | `clawser-pairing.js` | `pair_request`, `pair_accept`, `pair_list` | Agent-to-agent pairing |
| wsh Tools | `clawser-wsh-tools.js` | `wsh_connect`, `wsh_exec`, `wsh_fetch`, `wsh_upload`, `wsh_download`, `wsh_pty_open`, `wsh_pty_write`, `wsh_disconnect`, `wsh_sessions`, `wsh_mcp_call` | Remote shell, file transfer, CORS proxy |
| Goals | `clawser-goals.js` | `goal_add`, `goal_update`, `goal_complete`, `goal_list` | Hierarchical goal tracking |
| Skill Registry | `clawser-skill-registry-client.js` | `skill_search`, `skill_install`, `skill_rate` | Community skill discovery |
| Terminal Sessions | `clawser-terminal-sessions.js` | `session_create`, `session_switch`, `session_list` | Multiple terminal sessions |
| Agent Storage | `clawser-agent-storage.js` | — | Agent definition persistence |

## Internal Packages

These are standalone packages in `web/packages/` with their own READMEs:

| Package | Path | Description |
|---------|------|-------------|
| **andbox** | `web/packages/andbox/` | Worker-based sandboxed JS runtime with RPC capabilities, import maps, and capability gating |
| **wsh** | `web/packages/wsh/` | Web Shell — browser-native remote command execution over WebTransport/WebSocket with Ed25519 auth |
| **ai-matey-middleware-andbox** | `web/packages/ai-matey-middleware-andbox/` | ai.matey middleware for LLM code extraction → andbox execution |

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
