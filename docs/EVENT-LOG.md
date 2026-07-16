# Event Log System

Clawser uses an event-sourced persistence model. All conversation state is derived from an append-only event log rather than stored as mutable snapshots.

## Overview

The `EventLog` class in `clawser-agent.js` is the single source of truth for a conversation. Messages, tool calls, goal changes, memory operations, and errors are all recorded as immutable events. The full conversation state can be reconstructed by replaying the event stream.

Core methods: `append(type, data, source)` records an event and returns it; `query({ type, source, limit })` filters events (optionally to the last `limit`); `summary()` returns a `{ [type]: count }` breakdown; `clear()` resets the log; `load(events)` restores a raw event array and re-derives the internal sequence counter from existing IDs.

`EventLog` can optionally be constructed with `{ maxSize }` (default `0` = unlimited) to cap the in-memory array — the oldest events are dropped once the cap is exceeded. This does not affect what's already been written to `events.jsonl`; it only bounds the in-memory/replay array.

`ClawserAgent` exposes an `onAppend` hook (`eventLog.onAppend = (event) => ...`, null by default) that fires after every `append()`. `clawser-workspace-lifecycle.js` wires this to a `RotatingLogWriter` (`clawser-fs-logs.mjs`) that mirrors each event as a line in the virtual shell file `/var/log/clawser/events.jsonl`, independent of the OPFS conversation persistence described below. That writer rotates the file once it exceeds 5 MB, keeping up to 3 rotated copies, and batches writes (flushes every 20 buffered lines or 2 seconds).

## Event Shape

Each event has the following structure:

```json
{
  "id": "evt_1708732800000_0",
  "type": "user_message",
  "timestamp": 1708732800000,
  "data": { "content": "Hello, agent" },
  "source": "user"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique ID: `evt_{timestamp}_{sequence}` |
| `type` | `string` | Event type (see table below) |
| `timestamp` | `number` | Unix milliseconds |
| `data` | `object` | Type-specific payload |
| `source` | `string` | `"user"`, `"agent"`, or `"system"` |

## Event Types

`clawser-agent.js` exports a frozen `KNOWN_EVENT_TYPES` set as the registry of every type `append()` may be called with; a test asserts nothing slips through uncategorized. Four types are **replayed** to reconstruct state (`deriveSessionHistory`/`deriveGoals`, below); the rest are **audit-only** — recorded for the Events panel and tool-call log, but not replayed (their canonical state lives elsewhere: memory backend, scheduler/routine engine, etc.).

| Type | Source | Data Shape | Description |
|------|--------|------------|-------------|
| `user_message` | `user` | `{ content }` | User input message |
| `agent_message` | `agent` | `{ content }` | Agent response text |
| `tool_call` | `agent` | `{ call_id, name, arguments }` | Agent requests tool execution |
| `tool_result` | `system` | `{ call_id, name, result: ToolResult }` | Tool execution result |
| `goal_added` | `system` | `{ id, description }` | New goal created |
| `goal_updated` | `system` | `{ id, status }` | Goal status changed |
| `goal_edited` | `system` | `{ id, ...changes }` | Goal description/priority edited |
| `goal_removed` | `system` | `{ id }` | Goal deleted |
| `memory_stored` | `system` | `{ id, key, content, category }` | Memory entry created |
| `memory_forgotten` | `system` | `{ id }` | Memory entry deleted |
| `scheduler_added` | `system` | `{ id, spec }` (`spec.schedule_type` is `'once'\|'interval'\|'cron'`, plus `prompt` and the relevant `fire_at`/`delay_ms`/`interval_ms`/`cron_expr`) | Scheduler job created |
| `scheduler_fired` | `system` | `{ job_id, prompt }` | Scheduler job executed |
| `scheduler_removed` | `system` | `{ id }` | Scheduler job deleted |
| `context_compacted` | `system` | `{ oldTokens, newTokens, messagesSummarized }` | Context window was compacted |
| `autonomy_blocked` | `system` | `{ reason, limitType }` | Action blocked by autonomy controller |
| `idle_resume` | `system` | `{ idleMs, timeoutMs }` | Agent resumed after an idle period (triggers a context compaction) |
| `cache_hit` | `system` | `{ key }` | Response served from cache |
| `error` | `system` | `{ message }` | Runtime error recorded |
| `provider_error` | `system` | `{ message }` | LLM provider call failed |
| `stream_error` | `system` | `{ message, partialContentLength }` | Streaming response failed mid-stream |
| `safety_input_flag` | `system` | `{ flags, warning }` | Input sanitizer flagged (not blocked) the user message |
| `safety_tool_blocked` | `system` | `{ tool, issues }` | Tool call rejected by `ToolCallValidator` |
| `safety_output_blocked` | `system` | `{ tool\|source, findings }` | Tool or LLM output blocked by the leak/output scanner |
| `safety_output_redacted` | `system` | `{ tool\|source, findings }` | Tool or LLM output redacted (findings present but not blocking) |
| `tool_result_truncated` | `system` | `{ tool, original, truncated }` | Oversized tool result truncated before being fed back to the LLM |
| `channel_inbound` | `user` | `{ channelId, channel, sender, content, tenantId }` | Inbound message from a channel (gateway, `clawser-gateway.js`) |
| `channel_outbound` | `agent` | `{ channelId, content }` | Outbound response to a channel (gateway, content truncated to 500 chars) |

`channel_inbound`/`channel_outbound` are recorded via `agent.recordEvent(...)` from the gateway rather than `append()` directly, and are not part of `KNOWN_EVENT_TYPES` (they're gateway-specific, not core agent events).

## JSONL Format

Events are serialized as JSONL (JSON Lines) -- one JSON object per line, no trailing comma or array wrapper.

```
{"id":"evt_1708732800000_0","type":"user_message","timestamp":1708732800000,"data":{"content":"Hello"},"source":"user"}
{"id":"evt_1708732800001_1","type":"agent_message","timestamp":1708732800100,"data":{"content":"Hi there!"},"source":"agent"}
{"id":"evt_1708732800002_2","type":"tool_call","timestamp":1708732800200,"data":{"call_id":"tc_1","name":"web_search","arguments":{"query":"weather"}},"source":"agent"}
{"id":"evt_1708732800003_3","type":"tool_result","timestamp":1708732800500,"data":{"call_id":"tc_1","name":"web_search","result":{"success":true,"output":"Sunny, 72F"}},"source":"system"}
```

### Serialization

```js
const jsonl = eventLog.toJSONL();    // Serialize to JSONL string
const log = EventLog.fromJSONL(text); // Deserialize from JSONL string
```

## OPFS Storage Layout

Conversations are stored in OPFS as directories, nested under a workspace
directory obtained via `root.getDirectoryHandle('clawser')` →
`.getDirectoryHandle('workspaces')` → `.getDirectoryHandle(wsId)`:

```
clawser/workspaces/{wsId}/
  .conversations/{convId}/
    meta.json          # Conversation metadata (name, created, lastUsed, version)
    events.jsonl       # Full event stream
```

Both `meta.json` and `events.jsonl` are written with the createWritable()
swap-file pattern, so a write is atomic — the previous file is only
replaced once `close()` succeeds.

### meta.json

```json
{
  "id": "conv_abc123",
  "name": "Weather lookup",
  "created": 1708732800000,
  "lastUsed": 1708732900000,
  "version": 2
}
```

There is no `event_count` or `model` field in the persisted `meta.json` —
event count is read directly off the loaded `EventLog` (`.events.length`)
when needed, and model is tracked as part of agent config, not per-conversation
metadata.

## Checkpoint Format

In addition to event logs, `ClawserAgent` maintains a single latest
checkpoint per workspace as a crash-recovery fallback (`persistCheckpoint()` /
`restoreCheckpoint()`), separate from per-conversation persistence above:

```
clawser/workspaces/{wsId}/.checkpoints/latest.bin
```

`checkpoint()` builds the object below via `getCheckpointJSON()`, JSON-stringifies
it, and encodes it to a `Uint8Array` with `TextEncoder` (so `latest.bin` is a
UTF-8-encoded JSON string, not a packed binary format):

```json
{
  "id": "ckpt_1708732800000",
  "timestamp": 1708732800000,
  "agent_state": "Idle",
  "session_history": [...],
  "active_goals": [...],
  "scheduler_snapshot": [...],
  "version": "1.0.0"
}
```

`restore(bytes)` reads `session_history`, `active_goals`, and
`scheduler_snapshot` back into the agent (there is no persisted
`goalIdCounter`/`schedulerNextId` field — both ID counters are re-derived
by scanning the restored goals'/jobs' IDs for the highest numeric suffix).

Checkpoints are a performance optimization. The event log is the authoritative source. If the checkpoint is corrupted or missing, state is rebuilt from `events.jsonl`.

`restoreCheckpoint()` tries three OPFS locations in order, falling back if a higher-priority one is missing or fails to parse:

1. `clawser/workspaces/{wsId}/.checkpoints/latest.bin` (current)
2. `clawser_checkpoints/{wsId}/latest.bin` (old, pre-nested-workspace layout)
3. `clawser_checkpoints/latest.bin` (ancient, non-scoped — only tried for the `default` workspace)

All three levels use the same JSON-over-`Uint8Array` encoding described above; there is no separate "raw bytes without JSON wrapper" format. `restoreConversation()` has its own, similar fallback chain for a single saved conversation's binary blob, whose oldest path is `clawser_checkpoints/{wsId}/{convId}.bin`.

## Derivation Operations

The `EventLog` supports deriving different views from the event stream:

### deriveSessionHistory(systemPrompt?)

Rebuilds the LLM-compatible message array from events. Maps `user_message` to `{ role: 'user' }`, `agent_message` to `{ role: 'assistant' }`, `tool_call` to assistant `tool_calls` array entries, and `tool_result` to `{ role: 'tool' }` messages. Only these four types are replayed; every other event type (goals, memory, scheduler, safety, cache, errors, etc.) is audit-only and excluded from LLM context.

### deriveToolCallLog()

Builds a tool audit trail by pairing `tool_call` and `tool_result` events via `call_id`. Returns an array of `{ name, params, result, time }` objects (most recent first).

### deriveGoals()

Rebuilds the goals array by replaying `goal_added`, `goal_updated`, `goal_edited`, and `goal_removed` events. Returns the final state of each remaining goal.

### sliceToTurnEnd(eventId)

Returns all events from the start of the log up to the end of the turn containing the given event ID. A "turn" starts at a `user_message` and extends through all subsequent events until the next `user_message`. Used for conversation forking and undo.

## Migration

Clawser supports three persistence formats with automatic migration:

1. **v2** (current): OPFS directory with `meta.json` + `events.jsonl`
2. **v1**: Single OPFS file with JSON blob
3. **v0**: Binary checkpoint only

On restore, v1 and v0 formats are automatically migrated to v2.
