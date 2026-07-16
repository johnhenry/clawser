# Clawser API Reference

Public APIs for the core modules. All modules are ES modules with named exports.

## ClawserAgent

**File**: `web/clawser-agent.js`

The main agent orchestrator. Manages history, tools, memory, goals, scheduler, and the LLM run loop.

### Factory

```js
static async create(opts) => ClawserAgent
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts.browserTools` | `BrowserToolRegistry` | Tool registry |
| `opts.workspaceFs` | `WorkspaceFs` | Workspace-scoped filesystem |
| `opts.providers` | `ProviderRegistry` | LLM provider registry |
| `opts.mcpManager` | `McpManager` | MCP connection manager |
| `opts.responseCache` | `ResponseCache` | LRU response cache |
| `opts.autonomy` | `AutonomyController` | Autonomy level controller |
| `opts.hooks` | `HookPipeline` | Lifecycle hook pipeline (defaults to a fresh instance) |
| `opts.memory` | `SemanticMemory` | Memory backend |
| `opts.onEvent` | `Function` | Event callback `(type, data)` |
| `opts.onLog` | `Function` | Log callback `(level, msg)` |
| `opts.onToolCall` | `Function` | Tool call callback `(name, params, result)` |

### Lifecycle

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `init` | `init(config?)` | `number` | Initialize agent, register tools. Returns 0. |
| `reinit` | `reinit(config?)` | `number` | Reset history/goals/scheduler, re-register tools. Preserves memories. |
| `refreshToolSpecs` | `refreshToolSpecs()` | `void` | Re-scan browser and MCP tools for newly registered tools. |

### Run Loop

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `sendMessage` | `sendMessage(text, opts?)` | `void` | Push a user message onto history and event log. `opts.source` sets channel origin; `opts.tenantId` sets kernel tenant for resource tracking. |
| `run` | `async run()` | `{ status, data }` | Execute the agent loop (up to 20 tool iterations). Returns final response. |
| `runStream` | `async *runStream(options?)` | `AsyncGenerator<StreamChunk>` | Streaming variant. Yields `{ type, ... }` chunks. |

**StreamChunk types**: `text`, `tool_start`, `tool_delta`, `done`, `error`

### Provider Management

| Method | Signature | Description |
|--------|-----------|-------------|
| `setProvider` | `setProvider(name)` | Set the active LLM provider by name. |
| `setApiKey` | `setApiKey(key)` | Set the API key for the active provider. |
| `setModel` | `setModel(model)` | Set model override (`null` for provider default). |
| `getModel` | `getModel()` | Get the current model override. |
| `setSystemPrompt` | `setSystemPrompt(prompt)` | Set or update the system prompt. |

### Memory

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `memoryStore` | `memoryStore(entry)` | `string` | Store a memory entry. Returns the entry ID. |
| `memoryRecall` | `memoryRecall(query, opts?)` | `Array<MemoryEntry>` | Synchronous recall (BM25 only). |
| `memoryRecallAsync` | `async memoryRecallAsync(query, opts?)` | `Array<MemoryEntry>` | Async hybrid recall (BM25 + vector). |
| `memoryForget` | `memoryForget(id)` | `number` | Delete a memory entry. Returns 1 if deleted, 0 otherwise. |
| `persistMemories` | `persistMemories()` | `void` | Save all memories to localStorage. |
| `restoreMemories` | `restoreMemories()` | `number` | Load memories from localStorage. Returns count restored. |

**MemoryEntry shape**: `{ id, key, content, category, timestamp }`

**MemoryCategory values**: `"core"`, `"learned"`, `"user"`, `"context"`

### Goals

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `addGoal` | `addGoal(description)` | `string` | Add a goal. Returns the goal ID. |
| `updateGoal` | `updateGoal(id, status)` | `boolean` | Update goal status. |

### Scheduler

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `addSchedulerJob` | `addSchedulerJob(spec)` | `string` | Add a scheduled job. Returns the job ID. |
| `listSchedulerJobs` | `listSchedulerJobs()` | `Array<Job>` | List all scheduler jobs. |
| `removeSchedulerJob` | `removeSchedulerJob(id)` | `boolean` | Remove a job by ID. |

**Schedule types**: `"once"`, `"interval"`, `"cron"` (5-field)

### Tools

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `registerToolSpec` | `registerToolSpec(spec)` | `number` | Register a tool spec. Returns 0. |
| `unregisterToolSpec` | `unregisterToolSpec(name)` | `boolean` | Remove a tool spec by name. |
| `executeToolDirect` | `async executeToolDirect(name, params)` | `ToolResult` | Execute a tool directly (bypasses LLM). |
| `addMcpServer` | `async addMcpServer(name, endpoint)` | `McpClient` | Connect to an MCP server and register its tools. |

### Persistence

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `persistCheckpoint` | `async persistCheckpoint()` | `void` | Save binary checkpoint to OPFS. |
| `restoreCheckpoint` | `async restoreCheckpoint()` | `void` | Restore from OPFS checkpoint (v2 path, v1 fallback). |
| `persistConfig` | `persistConfig()` | `void` | Save provider/model to localStorage (API keys use vault). |
| `restoreConfig` | `restoreConfig()` | `object\|null` | Load config from localStorage. |
| `persistConversation` | `async persistConversation(convId, metadata?)` | `void` | Save conversation as OPFS directory (meta.json + events.jsonl). |
| `restoreConversation` | `async restoreConversation(convId)` | `object\|null` | Restore conversation from OPFS. |
| `getCheckpointJSON` | `getCheckpointJSON()` | `object` | Get full agent state as a JSON-serializable object. |

### State & Event Log

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `getState` | `getState()` | `object` | Get agent state summary (history length, goals, memory count, etc.). |
| `getEventLog` | `getEventLog()` | `EventLog` | Get the event log instance. |
| `clearEventLog` | `clearEventLog()` | `void` | Clear the event log. |
| `compactContext` | `async compactContext(opts?)` | `boolean` | Trigger context compaction. Returns true if compaction occurred. |

---

## EventLog

**File**: `web/clawser-agent.js`

Append-only event store for event-sourced conversation persistence.

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `append` | `append(type, data, source = 'system')` | `object` | Append an event. Returns the event object. |
| `query` | `query({type?, source?, limit?})` | `Array<object>` | Filter events by type/source, optionally limited to the last N. |
| `summary` | `summary()` | `Object<string, number>` | Count of events per type. |
| `events` | (getter) | `Array<object>` | Full event array. |
| `size` | (getter) | `number` | Number of recorded events. |
| `clear` | `clear()` | `void` | Reset the log. |
| `load` | `load(events)` | `void` | Restore from a parsed event array. |
| `toJSONL` | `toJSONL()` | `string` | Serialize to JSONL. |
| `fromJSONL` | `static fromJSONL(text)` | `EventLog` | Deserialize from JSONL. |
| `deriveSessionHistory` | `deriveSessionHistory(systemPrompt?)` | `Array<Message>` | Rebuild LLM-compatible message history. |
| `deriveToolCallLog` | `deriveToolCallLog()` | `Array<ToolLogEntry>` | Build tool audit trail. |
| `deriveGoals` | `deriveGoals()` | `Array<Goal>` | Rebuild goals from `goal_added`/`goal_updated`/`goal_edited`/`goal_removed` events. |
| `sliceToTurnEnd` | `sliceToTurnEnd(eventId)` | `Array<Event>\|null` | Slice events up to the turn containing the given event. |

---

## HookPipeline

**File**: `web/clawser-agent.js`

Lifecycle hook system with 6 interception points.

**Hook points**: `beforeInbound`, `beforeToolCall`, `beforeOutbound`, `transformResponse`, `onSessionStart`, `onSessionEnd`

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `register` | `register({name, point, priority?, enabled?, execute})` | `void` | Register a hook at a lifecycle point (throws if `point` is invalid). Hooks at the same point run in `priority` order (lower first, default 100). |
| `unregister` | `unregister(name, point)` | `void` | Remove a hook by name and point. |
| `setEnabled` | `setEnabled(name, enabled)` | `void` | Enable or disable a registered hook by name (searches all points). |
| `run` | `async run(point, ctx)` | `{blocked: boolean, reason?: string, ctx: object}` | Execute all enabled hooks at a point in priority order. A `block` result short-circuits with `blocked: true`; a `modify` result merges `data` into `ctx` for subsequent hooks. Hook errors are caught and logged (fail-open). |

---

## AutonomyController

**File**: `web/clawser-agent.js`

Capability boundaries and rate limiting.

### Constructor

```js
new AutonomyController({ level?, maxActionsPerHour?, maxCostPerDayCents?, maxCostPerMonthCents?, allowedHours? })
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `level` | `'readonly'\|'supervised'\|'full'` | `'supervised'` | Initial autonomy level. |
| `maxActionsPerHour` | `number` | `Infinity` | Rate limit. |
| `maxCostPerDayCents` | `number` | `Infinity` | Daily cost limit in cents. |
| `maxCostPerMonthCents` | `number` | `Infinity` | Monthly cost limit in cents. |
| `allowedHours` | `Array<{start: number, end: number}>` | `[]` | Time-of-day restriction windows (24h, supports overnight ranges). |

### Accessors (get/set)

| Property | Type | Description |
|----------|------|-------------|
| `level` | `'readonly'\|'supervised'\|'full'` | Current autonomy level. |
| `maxActionsPerHour` | `number` | Rate limit. |
| `maxCostPerDayCents` | `number` | Daily cost limit in cents. |
| `maxCostPerMonthCents` | `number` | Monthly cost limit in cents. |
| `allowedHours` | `Array<{start, end}>` | Time-of-day restriction windows. |
| `policyEngine` | `object\|null` | (get only) The currently set PolicyEngine, if any. |
| `stats` | `object` | (get only) `{ level, actionsThisHour, maxActionsPerHour, costTodayCents, maxCostPerDayCents, costThisMonthCents, maxCostPerMonthCents, allowedHours }`. |

### Methods

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `setPolicyEngine` | `setPolicyEngine(engine)` | `void` | Attach an optional `{evaluateToolCall(name, params) => {allowed, reason?}}` engine consulted by `canExecuteTool`. |
| `canExecuteTool` | `canExecuteTool(tool, params?)` | `boolean` | Whether a tool call is allowed at the current level. `readonly` blocks anything but `internal`/`read` permissions; otherwise defers to the PolicyEngine (if set). |
| `needsApproval` | `needsApproval(tool)` | `boolean` | Whether a tool needs user approval. `full` never needs approval; `readonly` is blocked outright (not "needs approval"); `supervised` requires approval for non-read permissions. |
| `checkLimits` | `checkLimits()` | `{ blocked: boolean, reason?: string, limitType?: 'time_of_day'\|'rate'\|'cost'\|'monthly_cost', resetTime?: number, stats?: object }` | Check time-of-day, rate, and cost limits. Resets hourly/daily/monthly counters on window rollover. |
| `recordAction` | `recordAction()` | `void` | Record an action for rate limiting. |
| `recordCost` | `recordCost(cents)` | `void` | Record cost for the daily and monthly budgets. |
| `reset` | `reset()` | `void` | Reset all counters (actions, cost, window start times). |

---

## BrowserToolRegistry

**File**: `web/clawser-tools.js`

Manages tool registration, lookup, permissions, and execution.

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `register` | `register(tool)` | `void` | Register a `BrowserTool` instance. |
| `get` | `get(name)` | `BrowserTool\|null` | Look up a tool by name. |
| `has` | `has(name)` | `boolean` | Check if a tool is registered. |
| `unregister` | `unregister(name)` | `boolean` | Remove a tool. |
| `setApprovalHandler` | `setApprovalHandler(handler)` | `void` | Set callback for approval requests. `handler(name, params) => Promise<boolean>` |
| `setPermission` | `setPermission(name, level)` | `void` | Override a tool's permission to `"auto"`, `"approve"`, or `"denied"`. |
| `getPermission` | `getPermission(name)` | `string` | Get effective permission level (falls back to `auto` for `internal`/`read` tools, `approve` otherwise). |
| `getAllPermissions` | `getAllPermissions()` | `Object<string, string>` | Get all permission overrides. |
| `loadPermissions` | `loadPermissions(perms)` | `void` | Bulk-load permission overrides from a plain object. |
| `resetAllPermissions` | `resetAllPermissions()` | `void` | Clear all permission overrides back to defaults. |
| `setSafety` | `setSafety(pipeline)` | `void` | Inject a `SafetyPipeline` for pre/post validation on `execute()`. |
| `getSpec` | `getSpec(name)` | `ToolSpec\|null` | Get a single tool's spec by name. |
| `execute` | `async execute(name, params)` | `ToolResult` | Execute a tool with permission checks. |
| `allSpecs` | `allSpecs()` | `Array<ToolSpec>` | Get all registered tool specs. |
| `names` | `names()` | `Array<string>` | Get all registered tool names. |

**ToolResult shape**: `{ success: boolean, output: string, error?: string }`

**Factory**: `createDefaultRegistry(workspaceFs?, getShellState?, showDotfiles?) => BrowserToolRegistry`

---

## ProviderRegistry

**File**: `web/clawser-providers.js`

Manages LLM provider instances.

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `register` | `register(provider)` | `void` | Register an `LLMProvider` instance. |
| `get` | `get(name)` | `LLMProvider\|null` | Look up a provider by name. |
| `has` | `has(name)` | `boolean` | Check if a provider is registered. |
| `remove` | `remove(name)` | `boolean` | Remove a provider by name. Returns true if found and removed. |
| `names` | `names()` | `Array<string>` | List all registered provider names. |
| `listWithAvailability` | `async listWithAvailability()` | `Array<ProviderInfo>` | List providers with availability status. |
| `getBestAvailable` | `async getBestAvailable()` | `LLMProvider\|null` | Get Chrome AI if available, otherwise Echo. |

**LLMProvider interface**:

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `name` | `string` | Provider identifier |
| `displayName` | `string` | Human-readable name |
| `requiresApiKey` | `boolean` | Whether an API key is needed |
| `supportsStreaming` | `boolean` | Whether `chatStream()` is available |
| `supportsNativeTools` | `boolean` | Whether native tool calling is supported |
| `chat(request, apiKey, modelOverride, options)` | `async => ChatResponse` | Blocking request |
| `chatStream(request, apiKey, modelOverride, options)` | `async* => StreamChunk` | Streaming request |
| `isAvailable()` | `async => boolean` | Availability check |

**ChatResponse shape**: `{ content, tool_calls, usage: { input_tokens, output_tokens }, model }`

**Factory**: `createDefaultProviders() => ProviderRegistry`

**Utilities**:
- `estimateCost(model, usage) => number` — total dollar cost (0 if the model has no `MODEL_PRICING` entry). Accounts for cache-read/cache-write token pricing where available.
- `classifyError(err) => { category, retryable, message }` — `category` is one of `rate_limit`, `server`, `auth`, `cors`, `timeout`, `network`, `content_filter`, `client`, `unknown`.
- `validateChatResponse(raw, fallbackModel?) => ChatResponse`

---

## SkillRegistry

**File**: `web/clawser-skills.js`

Skill discovery, activation, and prompt injection.

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `discover` | `async discover(wsId)` | `void` | Scan OPFS for installed skills. |
| `activate` | `async activate(name, args?)` | `object` | Activate a skill (load body, register script tools). |
| `deactivate` | `deactivate(name)` | `void` | Deactivate a skill (unregister tools, clean up). |
| `setEnabled` | `setEnabled(name, enabled)` | `void` | Enable or disable a skill. |
| `persistEnabledState` | `persistEnabledState(wsId)` | `void` | Save enabled state to localStorage. |
| `buildMetadataPrompt` | `buildMetadataPrompt()` | `string` | Build system prompt fragment listing available skills. |
| `buildActivationPrompt` | `buildActivationPrompt(name)` | `string` | Build system prompt for an activated skill. |
| `install` | `async install(scope, wsId, files)` | `object` | Install a skill from file objects. |
| `installFromZip` | `async installFromZip(scope, wsId, blob)` | `object` | Install a skill from a ZIP blob. |
| `uninstall` | `async uninstall(name, wsId)` | `void` | Remove a skill. |
| `getSlashCommandNames` | `getSlashCommandNames()` | `Array<string>` | List slash command names for active skills. |

**Supporting classes**: `SkillParser`, `SkillStorage`, `SkillRegistryClient`

---

## McpManager

**File**: `web/clawser-mcp.js`

Manages multiple MCP server connections.

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `addServer` | `async addServer(name, endpoint)` | `McpClient` | Connect to an MCP server. |
| `removeServer` | `removeServer(name)` | `void` | Disconnect and remove a server. |
| `disconnectAll` | `disconnectAll()` | `void` | Disconnect and remove all MCP servers. |
| `allToolSpecs` | `allToolSpecs()` | `Array<ToolSpec>` | Get tool specs from all connected servers. |
| `findClient` | `findClient(toolName)` | `McpClient\|null` | Find the client handling a tool name. |
| `executeTool` | `async executeTool(toolName, args)` | `ToolResult` | Execute a tool on the appropriate server. |
| `getClient` | `getClient(name)` | `McpClient\|null` | Get a client by server name. |
| `serverNames` | (getter) | `Array<string>` | List connected server names. |
| `serverCount` | (getter) | `number` | Count of connected servers. |

### McpClient

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `connect` | `async connect()` | `void` | Initialize connection and discover tools. |
| `disconnect` | `async disconnect()` | `void` | Close the connection. |
| `callTool` | `async callTool(name, args)` | `ToolResult` | Execute a tool on this server. |
| `tools` | (getter) | `Array<MCPTool>` | Raw MCP tool list. |
| `toolSpecs` | (getter) | `Array<ToolSpec>` | Tools in Clawser ToolSpec format (prefixed `mcp_*`). |

---

## ClawserShell

**File**: `web/clawser-shell.js`

Virtual shell with AST-based parsing and OPFS file operations.

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `exec` | `async exec(command)` | `{ stdout, stderr, exitCode }` | Parse and execute a shell command string. |

**Supporting classes**: `ShellState`, `CommandRegistry`, `ShellFs`, `MemoryFs`

**Exported utilities**: `tokenize(input)`, `parse(input)`, `normalizePath(p)`

---

## ChannelGateway

**File**: `web/clawser-gateway.js`

Central gateway orchestrating channel plugins, scheduler routines, and P2P mesh sessions into the agent. Provides per-channel serialized queuing, scope isolation, and response routing.

### Constructor

```js
new ChannelGateway({ agent, tenantId?, deviceHandler?, onIngest?, onRespond?, onLog? })
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `agent` | `object` | ClawserAgent instance |
| `tenantId` | `string\|null` | Default kernel tenant ID for resource tracking |
| `deviceHandler` | `object` | `DeviceFileHandler` for mirroring inbound messages to `/dev/clawser/channels/*` |
| `onIngest` | `Function` | `(channelId, message) => void` — called on inbound message |
| `onRespond` | `Function` | `(channelId, text) => void` — called on outbound response |
| `onLog` | `Function` | `(msg) => void` — logging callback |

### Channel Lifecycle

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `register` | `register(channelId, plugin, config?)` | `void` | Register a channel plugin. `config.scope`: `'isolated'` \| `'shared'` \| `'shared:group'`. |
| `unregister` | `unregister(channelId)` | `boolean` | Remove a channel plugin. Stops it first if active. |
| `start` | `start(channelId)` | `void` | Activate a plugin and wire its `onMessage` to `ingest()`. |
| `stop` | `stop(channelId)` | `void` | Deactivate a plugin. |
| `startAll` | `startAll()` | `void` | Start all registered channels. |
| `stopAll` | `stopAll()` | `void` | Stop all running channels. |
| `destroy` | `destroy()` | `void` | Stop all channels, clear state, null agent reference. |

### Messaging

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `ingest` | `async ingest(message, channelId, opts?)` | `Promise<string>` | Ingest inbound message. Queues per-channel, runs agent, returns response text. `opts.tenantId` overrides the gateway default. |
| `respond` | `async respond(channelId, text, originalMsg?)` | `Promise<void>` | Route response to channel plugin. Always fires `onRespond` and records outbound event, even for plugin-less virtual channels. |

### Accessors

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `setAgent` | `setAgent(agent)` | `void` | Replace agent reference. |
| `setDeviceHandler` | `setDeviceHandler(deviceHandler)` | `void` | Replace the `/dev/clawser/channels/*` device handler. |
| `setTenantId` | `setTenantId(tenantId)` | `void` | Update default tenant ID (e.g. on workspace switch). |
| `agent` | (getter) | `object\|null` | Current agent reference. |
| `getChannel` | `getChannel(channelId)` | `{plugin, config, scope}\|undefined` | Get a registered channel entry. |
| `listChannels` | `listChannels()` | `string[]` | All registered channel IDs. |
| `listChannelStatus` | `listChannelStatus()` | `Array<{id, scope, active}>` | All channels with status. |
| `isActive` | `isActive(channelId)` | `boolean` | Whether a channel is running. |
| `activeCount` | (getter) | `number` | Number of running channels. |
| `channelCount` | (getter) | `number` | Number of registered channels. |

### Exported Constants

| Constant | Type | Description |
|----------|------|-------------|
| `CHANNEL_SCOPES` | `{ISOLATED, SHARED}` | Scope mode enum. Runtime also allows `'shared:group-name'`. |
| `CHANNEL_COLORS` | `Record<string, string>` | Canonical badge colors per channel type (hex). Includes `scheduler` for cron/routine virtual channels. |

### Exported Classes

| Class | Description |
|-------|-------------|
| `ChannelQueue` | Per-channel serialized task queue. Same-channel tasks serial, cross-channel concurrent. Methods: `enqueue(channelId, task)`, `isProcessing(channelId)`, `pendingChannels` (getter), `clear()`. |

---

## Pod

**Package**: `browsermesh-pod` (npm package in `node_modules/`, source at `browsermesh-pod/src/pod.mjs`). Re-exported for internal use via the bridge module `web/packages-pod.js` (`import { Pod } from './packages-pod.js'`).

Base class for all pod types. Zero Clawser dependencies (depends only on the sibling `browsermesh-primitives` package for Ed25519 identity).

### Constructor

No-arg. All configuration is via `boot(opts)`.

### Lifecycle

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `boot` | `async boot(opts?)` | `void` | Run 6-phase boot sequence. Throws if not in `idle` state. |
| `shutdown` | `async shutdown(opts?)` | `void` | Broadcast `POD_GOODBYE`, close channels, clear peers, remove runtime marker. `opts.silent` skips the goodbye broadcast. Idempotent. |

**Boot options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `identity` | `PodIdentity` | (generated) | Pre-existing Ed25519 identity |
| `discoveryChannel` | `string` | `'pod-discovery'` | BroadcastChannel name |
| `handshakeTimeout` | `number` | `1000` | ms to wait for parent ACK |
| `discoveryTimeout` | `number` | `2000` | ms to wait for peer responses |
| `globalThis` | `object` | `globalThis` | Override for testing |

### Accessors

| Getter | Type | Description |
|--------|------|-------------|
| `podId` | `string \| null` | Base64url SHA-256 of Ed25519 public key (43 chars) |
| `identity` | `PodIdentity \| null` | Ed25519 key pair wrapper |
| `capabilities` | `PodCapabilities \| null` | Detected runtime capabilities |
| `kind` | `PodKind \| null` | `'window'` \| `'iframe'` \| `'worker'` \| `'service-worker'` \| `'shared-worker'` \| `'worklet'` \| `'spawned'` \| `'server'` |
| `role` | `PodRole` | `'autonomous'` \| `'child'` \| `'peer'` |
| `state` | `PodState` | `'idle'` \| `'booting'` \| `'ready'` \| `'shutdown'` |
| `peers` | `Map<string, object>` | Copy of known peers (podId → info) |

### Messaging

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `send` | `send(targetPodId, payload)` | `void` | Send to a specific peer via BroadcastChannel. Throws if not `ready`. |
| `broadcast` | `broadcast(payload)` | `void` | Send to all peers (address: `'*'`). |
| `on` | `on(event, cb)` | `void` | Register event listener. |
| `off` | `off(event, cb)` | `void` | Remove event listener. |
| `toJSON` | `toJSON()` | `object` | Serializable snapshot: `{ podId, kind, role, state, capabilities, peerCount, peers }` |

### Events

| Event | Data | Description |
|-------|------|-------------|
| `phase` | `{ phase, name }` | Each boot phase starts |
| `ready` | `{ podId, kind, role }` | Boot complete |
| `shutdown` | `{ podId }` | Pod shut down |
| `error` | `{ phase, error }` | Boot phase failed |
| `peer:found` | `{ podId, kind }` | New peer discovered |
| `peer:lost` | `{ podId }` | Peer departed |
| `message` | `{ type, from, to, payload, ts }` | Incoming message |

### Subclass Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `_onInstallListeners` | `_onInstallListeners(g)` | Phase 1: install custom handlers |
| `_onReady` | `_onReady()` | Phase 5: boot complete |
| `_onMessage` | `_onMessage(msg)` | Incoming targeted message |

---

## ClawserPod

**File**: `web/clawser-pod.js`

Extends `Pod` with mesh networking.

### Methods

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `initMesh` | `async initMesh(opts?)` | `{ peerNode, swarmCoordinator, ... }` | Create the mesh subsystem: MeshIdentityManager, IdentityWallet, PeerRegistry, PeerNode, SwarmCoordinator, and 25+ other mesh components (transport, audit, sync, marketplace, consensus, etc. — see `docs/browsermesh/` for the full subsystem map). Returns all instantiated components. Tears down and recreates the peer node if already running, so it's safe to call multiple times. |
| `shutdown` | `async shutdown(opts?)` | `void` | Shuts down PeerNode then calls `Pod.shutdown()`. |

### Accessors

| Getter | Type | Description |
|--------|------|-------------|
| `peerNode` | `PeerNode \| null` | Mesh peer node |
| `swarmCoordinator` | `SwarmCoordinator \| null` | Swarm task coordinator |
| `wallet` | `IdentityWallet \| null` | Identity wallet |
| `registry` | `PeerRegistry \| null` | Peer registry |

---

## EmbeddedPod

**File**: `web/clawser-embed.js`

Extends `Pod` for embedding into external web apps. Also exported as `ClawserEmbed` for backward compatibility.

### Constructor

```js
new EmbeddedPod(config?)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `containerId` | `string` | `'clawser'` | DOM element ID to render into |
| `provider` | `string` | `null` | Default LLM provider |
| `model` | `string` | `null` | Default model |
| `tools` | `object` | `{}` | Tool configuration overrides |
| `theme` | `object` | `{}` | UI theme overrides |
| `agent` | `ClawserAgent` | `null` | Pre-configured agent instance (can also be attached later via `setAgent()`) |

### Methods

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `setAgent` | `setAgent(agent)` | `void` | Attach or replace the agent instance. |
| `sendMessage` | `async sendMessage(text, opts?)` | `{ content: string, toolCalls: Array, usage?, model?, error?: boolean }` | Send a user message to the agent (throws if no agent is attached). On success returns `{content, toolCalls, usage, model}`; on error/blocked returns `{content, toolCalls, error: true, usage}`. |
| `on` | `on(event, fn)` | `void` | Register an event listener. |
| `off` | `off(event, fn)` | `void` | Remove an event listener. |
| `emit` | `emit(event, ...args)` | `void` | Emit an event to registered listeners. |

### Accessors

| Getter | Type | Description |
|--------|------|-------------|
| `config` | `object` | Copy of the configuration |
| `agent` | `ClawserAgent\|null` | The attached agent instance, if any |

---

## Exported Functions (browsermesh-pod)

All of these are available from the bridge module `web/packages-pod.js`, which re-exports them from the `browsermesh-pod` npm package.

### detectPodKind

```js
import { detectPodKind } from './packages-pod.js';
detectPodKind(globalThis) // => 'window' | 'iframe' | 'worker' | 'service-worker' | 'shared-worker' | 'worklet' | 'spawned' | 'server'
```

### detectCapabilities

```js
import { detectCapabilities } from './packages-pod.js';
detectCapabilities(globalThis) // => { messaging, network, storage, compute }
```

### Message Factories

```js
import { createHello, createHelloAck, createGoodbye, createMessage,
         createRpcRequest, createRpcResponse } from './packages-pod.js';
```

| Factory | Required Fields | Description |
|---------|----------------|-------------|
| `createHello` | `podId`, `kind` | Discovery announcement |
| `createHelloAck` | `podId`, `kind`, `targetPodId` | Discovery response |
| `createGoodbye` | `podId` | Graceful departure |
| `createMessage` | `from`, `to`, `payload` | Inter-pod message |
| `createRpcRequest` | `from`, `to`, `method`, `requestId` | RPC call (optional `params`) |
| `createRpcResponse` | `from`, `to`, `requestId` | RPC result (optional `result`, `error`) |

All factories add a `ts` (timestamp) and `type` field automatically.

---

## Additional References

For complete tool specifications (parameters, permissions, return values), see [TOOLS.md](TOOLS.md).

For configuration panel options and storage keys, see [CONFIG.md](CONFIG.md).

For advanced features (routines, delegation, channels, vault, self-repair, etc.), see [FEATURES.md](FEATURES.md).
