# Internals

Implementation details for Clawser's core subsystems. This document covers private class internals, algorithms, and design patterns used throughout the codebase.

## EventLog (clawser-agent.js)

Append-only JSONL event log for conversation persistence.

**Storage:** OPFS at `clawser_workspaces/{wsId}/.conversations/{convId}/events.jsonl`

**Event types:** `user_message`, `agent_message`, `tool_call`, `tool_result`, `tool_result_truncated`, `error`, `autonomy_blocked`, `cache_hit`, `context_compacted`, `memory_stored`, `memory_forgotten`, `goal_added`, `goal_updated`, `scheduler_added`, `scheduler_fired`, `scheduler_removed`, `safety_input_flag`, `safety_tool_blocked`, `safety_output_blocked`, `safety_output_redacted`, `provider_error`, `stream_error`, `channel_inbound`, `channel_outbound`

**Compaction:** When token count exceeds ~12K tokens, older messages are summarized into a single `system` event containing the conversation summary. This keeps context manageable while preserving essential history.

**Recovery:** On load, events are replayed to reconstruct conversation state. State snapshots (periodic) allow fast-forward recovery — replay from last snapshot instead of beginning.

## HookPipeline (clawser-agent.js)

Hooks execute in a defined order around agent operations:

```
beforeInbound → beforeToolCall → beforeOutbound → [LLM call] → transformResponse
```

Session lifecycle hooks: `onSessionStart`, `onSessionEnd`

**Error isolation:** Each hook runs in a try/catch. A failing hook logs but doesn't block the pipeline.

**Hook sources:** Agent core hooks, plugin hooks (via `PluginLoader.getHooks()`), skill hooks (active skill metadata).

## Context Compaction (clawser-agent.js)

Triggered automatically when conversation token count exceeds a threshold (~12K tokens).

**Algorithm:**
1. Count approximate tokens in `#history` (chars / 4 heuristic)
2. If over threshold, take all messages except the most recent 10
3. Concatenate old messages into a summary prompt
4. Send summary prompt to LLM with instruction: "Summarize this conversation concisely"
5. Replace old messages with a single `user` message containing the summary (followed by assistant acknowledgment)
6. Emit `context_compacted` event

## Codex (clawser-codex.js)

Sandboxed JavaScript execution engine using `andbox`.

**Execution flow:**
1. Parse model output for `` ```js `` code blocks
2. Create an andbox Worker sandbox with browser tools injected as host capabilities
3. Execute via `sandbox.evaluate()` with a 300s timeout
4. Capture return value as tool result

**Security:** Code runs in an isolated Worker sandbox (andbox). No access to the parent page's variables. DOM access blocked in worker contexts.

## Provider Tier System (clawser-providers.js)

Three tiers with different integration depths:

**Tier 1 — Built-in:** Echo, Chrome AI, OpenAI, Anthropic. Direct API integration with streaming and native tool use.

**Tier 2 — OpenAI-compatible:** Groq, OpenRouter, Together, Fireworks, Mistral, DeepSeek, xAI, Perplexity, Ollama, LM Studio. Share `OpenAICompatibleProvider` base class, differing only in base URL and model list.

**Tier 3 — ai.matey:** Lazy-loaded from CDN (`ai.matey` npm package). Bridge pattern supporting 24+ backends. Loaded only when selected.

**Streaming:** SSE readers parse `data: {...}` lines. Two parsers: `readSSE()` for OpenAI format, `readAnthropicSSE()` for Anthropic's event+data pairs.

**Cost tracking:** `MODEL_PRICING` table maps model names to per-token costs. `estimateCost(model, usage)` returns dollar amount.

## Tool Permission System (clawser-tools.js)

Three permission levels per tool:

| Level | Behavior |
|-------|----------|
| `auto` | Execute without confirmation |
| `approve` | Show confirmation dialog before execution |
| `denied` | Block execution entirely |

Permissions are persisted per-workspace in `localStorage` at key `clawser_tool_perms_{wsId}`.

**Domain allowlist:** `FetchTool` can restrict fetched URLs to specific domains. Requests outside the allowlist are blocked.

**File size limits:** `FsWriteTool` enforces configurable max file size (default 10MB).

## Safety Pipeline (clawser-safety.js)

Three-stage defense pipeline:

1. **InputSanitizer** — Strips zero-width characters, flags injection-like patterns (`ignore previous instructions`, `system:`, `[INST]`, etc.)

2. **ToolCallValidator** — Validates tool arguments before execution. Checks for path traversal (`..`), vault access, dangerous shell patterns (`;rm`, `curl|sh`, command substitution), blocked URL schemes (`file://`, `data:`), internal network URLs.

3. **LeakDetector** — Scans output for secrets (API keys, tokens, private keys, connection strings). Actions: `redact` (replace with placeholder), `warn` (flag but pass through), `block` (prevent output).

**Disable guard:** Disabling the pipeline requires calling `confirmDisable()` first — prevents accidental bypass.

## Memory System (clawser-memory.js)

**Categories:** `core`, `learned`, `user`, `context`

**Deduplication:** On workspace init, memory entries are scanned. Entries with identical `key` values are merged (newer wins).

**Embedding providers:**
- `TransformersEmbeddingProvider` — Local browser-based embeddings via `@xenova/transformers` CDN (384-dim MiniLM-L6-v2)
- Availability check: Verifies real browser environment (not just stubbed `document`)

**BM25 scoring:** Text search uses term-frequency scoring for ranked results when embedding search isn't available.

## Scheduler (clawser-agent.js)

Supports three schedule types:

- `once` — Single execution at a specific time
- `interval` — Repeated at fixed intervals (ms)
- `cron` — 5-field cron expressions (min hour dom month dow)

**Cron parser:** `ClawserAgent.parseCron(expr)` returns `{ minute, hour, dom, month, dow }` arrays. Supports `*`, ranges (`1-5`), lists (`1,3,5`), and steps (`*/5`).

**Execution:** `RoutineEngine.executeFn` routes through `ChannelGateway.ingest()` with `channel: 'scheduler'` and a virtual channel key `scheduler:{routineId}`. This provides per-routine serialization, event recording, and UI badge rendering. Falls back to direct `agent.run()` if the gateway is unavailable.

## ChannelGateway (clawser-gateway.js)

Central hub connecting channel plugins, scheduler routines, WSH, and mesh sessions to the agent.

**ChannelQueue:** Per-channel serialized task queue. Tasks for the same channel ID run sequentially (via `#drain()` loop); tasks for different channel IDs run concurrently. The queue map is keyed by `channelId` — for scheduler routines, this is `scheduler:{routineId}`.

**Scope modes:** `isolated` (separate conversation), `shared` (shared conversation), `shared:group-name` (named group). Stored per-channel at registration time. Currently informational — scope-switching is planned but all channels currently share the active conversation.

**Tenant context:** The gateway stores a default `#tenantId` set at construction (from `KernelIntegration.getWorkspaceTenantId(wsId)`) and updated via `setTenantId()` on workspace switch. Individual `ingest()` calls can override with `{ tenantId }` in opts. Resolution: explicit value (including `null`) overrides the default; `undefined` (omitted) falls through to the default. The resolved tenant ID flows to `agent.sendMessage()` opts and `channel_inbound` event data.

**respond() behavior:** Always fires `onRespond` callback and records `channel_outbound` event, regardless of whether the channel has a registered plugin. This is how plugin-less virtual channels (scheduler, direct WSH) still appear in the chat UI.

**Event types recorded:**
- `channel_inbound` — on message ingest. Data: `{ channelId, channel, sender, content, tenantId }`. Source: `user`.
- `channel_outbound` — on response routing. Data: `{ channelId, content }` (truncated to 500 chars). Source: `agent`.

## Workspace Isolation

Each workspace gets:
- Separate `localStorage` keys: `clawser_memories_{id}`, `clawser_config_{id}`, `clawser_tool_perms_{id}`
- Separate OPFS directory: `clawser_workspaces/{id}/`
- Separate conversation history, goals, skills (workspace skills override global)
- Independent agent configuration (provider, model, API key)

## Daemon Mode (clawser-daemon.js)

**State machine phases:** `STOPPED → STARTING → RUNNING → CHECKPOINTING → RECOVERING → PAUSED → ERROR`

Valid transitions are enforced. Invalid transitions silently fail (return `false`).

**CheckpointManager:** Stores agent state snapshots. Configurable max checkpoints (default 10). Uses injectable `readFn`/`writeFn` for storage abstraction.

**TabCoordinator:** Multi-tab awareness via `BroadcastChannel`. Heartbeat-based presence detection. Leader election by earliest join time. Stale tabs pruned after 3 missed heartbeats.

**NativeMessageCodec:** Chrome Native Messaging protocol — JSON with 4-byte little-endian length prefix.

## Undo System (clawser-undo.js)

Stack-based undo/redo with per-turn checkpoints.

**Operations tracked:** Memory writes/deletes, file operations, goal changes.

**Revert:** Category-specific revert handlers (`revertHistory`, `revertMemory`, `revertFile`, `revertGoal`) are invoked per checkpoint. Undo pops the latest checkpoint and dispatches each operation to its category handler.

**Limits:** Configurable `maxHistory` (default 20). Oldest checkpoints discarded when exceeded.

## Pod Subsystem (packages/pod/ + clawser-pod.js)

The Pod base class has zero Clawser dependencies. It imports only `PodIdentity` from `packages/mesh-primitives/src/identity.mjs` for Ed25519 key generation.

**Boot lifecycle:** `idle → booting → ready → shutdown`. Boot runs 6 phases sequentially. If any phase throws, state resets to `idle` and `error` event fires.

**Discovery protocol:** Pods announce themselves on a BroadcastChannel (default: `pod-discovery`). When a pod receives `POD_HELLO`, it responds with `POD_HELLO_ACK` and registers the peer. `POD_GOODBYE` removes a peer. Late arrivals after initial discovery are handled by the persistent `onmessage` listener.

**Message routing:** `POD_MESSAGE`, `POD_RPC_REQUEST`, and `POD_RPC_RESPONSE` are delivered to the target pod via BroadcastChannel. Messages addressed to `'*'` (broadcast) are delivered to all peers. The `_onMessage()` hook allows subclasses to handle incoming messages.

**ClawserPod.initMesh():** Creates `MeshIdentityManager` → `IdentityWallet` → `PeerRegistry` → `PeerNode` → `SwarmCoordinator` and returns `{ peerNode, swarmCoordinator }`. These are attached to `state.peerNode` and `state.swarmCoordinator` by `initMeshSubsystem()` in workspace lifecycle.

**Runtime marker:** `globalThis[Symbol.for('pod.runtime')]` stores `{ podId, kind, capabilities, pod }`. The extension injection IIFE checks this to prevent double-injection.

## Related Files

- `web/clawser-agent.js` — EventLog, HookPipeline, context compaction, scheduler
- `web/clawser-gateway.js` — ChannelGateway, ChannelQueue, CHANNEL_COLORS, CHANNEL_SCOPES
- `web/clawser-codex.js` — Sandboxed JS execution
- `web/clawser-providers.js` — LLM provider tiers, SSE parsing, cost tracking
- `web/clawser-tools.js` — Tool registry, permissions, domain allowlist
- `web/clawser-safety.js` — Input sanitization, tool validation, leak detection
- `web/clawser-memory.js` — Memory categories, embeddings, BM25
- `web/clawser-daemon.js` — Daemon state machine, checkpoints, tab coordination
- `web/clawser-undo.js` — Undo/redo stack
- `web/packages/pod/src/pod.mjs` — Pod base class (boot, discovery, messaging)
- `web/clawser-pod.js` — ClawserPod (Pod + mesh networking)
- `web/clawser-embed.js` — EmbeddedPod (embeddable pod for external apps)
