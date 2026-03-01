# Virtual Server Subsystem (Phase 7)

Clawser's virtual server system runs HTTP servers entirely in the browser, with routes stored in IndexedDB and intercepted by the Service Worker.

## Architecture

```
Browser Tab              Service Worker              IndexedDB
┌────────────┐          ┌──────────────┐          ┌──────────┐
│ ServerMgr  │◄────────►│ fetch event  │◄────────►│  routes   │
│ (page ctx) │  relay   │ intercept    │  lookup   │  store    │
└────────────┘          └──────────────┘          └──────────┘
      ▲
      │ page-mode exec
      ▼
┌────────────┐
│  Handler   │  function / static / proxy / skill
└────────────┘
```

**Request flow:**
1. SW intercepts fetch to `http://<hostname>:<port>/...`
2. SW looks up matching route in IndexedDB
3. For `sw` execution: handler runs in the SW context (fast, limited)
4. For `page` execution: SW relays to the main page via `MessageChannel`, where `ServerManager` handles it with full access to agent, tools, and DOM

## Handler Types

| Type | Description | Execution Modes |
|------|-------------|-----------------|
| `function` | Inline JS module (Blob URL import) | `page`, `sw` |
| `static` | Serves files from OPFS | `page`, `sw` |
| `proxy` | Forwards to external URL with optional rewrite | `page` |
| `skill` | Routes to a registered skill (static API only, not via SW fetch) | `page` |

## Key Classes

### `ServerManager`

Central orchestrator for virtual servers. Singleton via `getServerManager()`.

**Route CRUD:**
- `addRoute(route)` — Register a new route, returns route ID
- `removeRoute(id)` — Delete a route
- `updateRoute(id, updates)` — Merge updates into existing route
- `getRoute(hostname, port)` — Find enabled route by host/port
- `getRouteById(id)` — Direct lookup
- `listRoutes(scope?)` — List all routes, optionally filtered by scope

**Lifecycle:**
- `startServer(id)` — Enable a route
- `stopServer(id)` — Disable and clear cached handler
- `compileHandler(code)` — Compile JS source into module via Blob URL
- `getHandler(route)` — Get or compile cached handler module

**Utilities:**
- `getLogs(routeId, limit?)` — Request log entries
- `testRequest(hostname, port, path, opts)` — Send test request through SW
- `onChange(fn)` — Subscribe to route changes

**Static helpers:**
- `ServerManager.createSkillHandler(skillName, opts)` — Build skill handler config
- `ServerManager.executeSkillHandler(skillName, request, registry)` — Run a skill as HTTP handler
- `ServerManager.createSSEResponse(events)` — Build SSE Response from event array
- `ServerManager.createSSEResponseFromGenerator(generator)` — Build SSE Response from async iterable

### `SSEChannel`

Bidirectional channel emulating WebSocket over SSE + POST.

- `send(message)` — Queue outbound message
- `drain()` — Collect and clear pending messages
- `receive(message)` — Process inbound message
- `onMessage(fn)` — Register callback
- `close()` — Close channel

## Route Record Shape

```js
{
  id: 'srv_...',
  hostname: 'myapp.internal',
  port: 80,
  scope: '_global' | '<workspaceId>',
  handler: {
    type: 'function' | 'static' | 'proxy' | 'skill',
    execution: 'page' | 'sw',
    code: '...',           // function type
    staticRoot: '/path',   // static type
    proxyTarget: 'https://...', // proxy type
    skillName: '...',      // skill type
  },
  env: { KEY: 'value' },
  enabled: true,
  created: '2025-...',
}
```

## Agent Tools

8 tools in `clawser-server-tools.js`:

| Tool | Permission | Description |
|------|-----------|-------------|
| `server_list` | read | List all registered virtual servers |
| `server_add` | approve | Register a new route |
| `server_remove` | approve | Delete a route |
| `server_update` | approve | Update route config |
| `server_start` | approve | Enable a route |
| `server_stop` | approve | Disable a route |
| `server_logs` | read | View request logs |
| `server_test` | approve | Send a test request |

## Scoping

Routes are scoped to workspaces or global (`_global`). Per-workspace routes take priority over global routes when resolving by hostname/port.

## MIME Types

Static serving auto-detects MIME from file extension: `html`, `htm`, `css`, `js`, `mjs`, `json`, `xml`, `txt`, `md`, `csv`, `svg`, `png`, `jpg`, `jpeg`, `gif`, `webp`, `ico`, `woff`, `woff2`, `ttf`, `pdf`, `zip`, `wasm`.

## Related Files

- `web/clawser-server.js` — ServerManager, SSEChannel, IndexedDB helpers
- `web/clawser-server-tools.js` — 8 agent tools
- `web/clawser-ui-servers.js` — Server management UI panel
- `web/sw.js` — Service Worker fetch intercept
