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
| `sendMessage` | `sendMessage(text)` | `void` | Push a user message onto history and event log. |
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
| `append` | `append(type, data, source?)` | `object` | Append an event. Returns the event object. |
| `clear` | `clear()` | `void` | Reset the log. |
| `load` | `load(events)` | `void` | Restore from a parsed event array. |
| `toJSONL` | `toJSONL()` | `string` | Serialize to JSONL. |
| `fromJSONL` | `static fromJSONL(text)` | `EventLog` | Deserialize from JSONL. |
| `deriveSessionHistory` | `deriveSessionHistory(systemPrompt?)` | `Array<Message>` | Rebuild LLM-compatible message history. |
| `deriveToolCallLog` | `deriveToolCallLog()` | `Array<ToolLogEntry>` | Build tool audit trail. |
| `deriveGoals` | `deriveGoals()` | `Array<Goal>` | Rebuild goals from events. |
| `sliceToTurnEnd` | `sliceToTurnEnd(eventId)` | `Array<Event>\|null` | Slice events up to the turn containing the given event. |

---

## HookPipeline

**File**: `web/clawser-agent.js`

Lifecycle hook system with 6 interception points.

**Hook points**: `beforeInbound`, `beforeToolCall`, `beforeOutbound`, `transformResponse`, `onSessionStart`, `onSessionEnd`

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `register` | `register(point, hook)` | `void` | Register a hook at a lifecycle point. |
| `unregister` | `unregister(point, hookId)` | `void` | Remove a hook. |
| `run` | `async run(point, ctx)` | `object` | Execute all hooks at a point. Returns final context. |

---

## AutonomyController

**File**: `web/clawser-agent.js`

Capability boundaries and rate limiting.

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `setLevel` | `setLevel(level)` | `void` | Set autonomy level (`"readonly"`, `"supervised"`, `"full"`). |
| `checkLimits` | `checkLimits()` | `{ blocked, reason? }` | Check if rate/cost limits are exceeded. |
| `checkPermission` | `checkPermission(permLevel)` | `{ allowed, needsApproval? }` | Check if a permission level is allowed. |
| `recordAction` | `recordAction()` | `void` | Record an action for rate limiting. |
| `recordCost` | `recordCost(cents)` | `void` | Record cost for daily budget. |
| `getState` | `getState()` | `object` | Get current limits, counts, and cost. |

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
| `getPermission` | `getPermission(name)` | `string` | Get effective permission level. |
| `execute` | `async execute(name, params)` | `ToolResult` | Execute a tool with permission checks. |
| `allSpecs` | `allSpecs()` | `Array<ToolSpec>` | Get all registered tool specs. |
| `names` | `names()` | `Array<string>` | Get all registered tool names. |

**ToolResult shape**: `{ success: boolean, output: string, error?: string }`

**Factory**: `createDefaultRegistry(workspaceFs?) => BrowserToolRegistry`

---

## ProviderRegistry

**File**: `web/clawser-providers.js`

Manages LLM provider instances.

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `register` | `register(provider)` | `void` | Register an `LLMProvider` instance. |
| `get` | `get(name)` | `LLMProvider\|null` | Look up a provider by name. |
| `has` | `has(name)` | `boolean` | Check if a provider is registered. |
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
- `estimateCost(model, usage) => { inputCost, outputCost, totalCost }`
- `classifyError(err) => { type, retryable, message }`
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

## Additional References

For complete tool specifications (parameters, permissions, return values), see [TOOLS.md](TOOLS.md).

For configuration panel options and storage keys, see [CONFIG.md](CONFIG.md).

For advanced features (routines, delegation, channels, vault, self-repair, etc.), see [FEATURES.md](FEATURES.md).
