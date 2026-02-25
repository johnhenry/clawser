# Event Log System

Clawser uses an event-sourced persistence model. All conversation state is derived from an append-only event log rather than stored as mutable snapshots.

## Overview

The `EventLog` class in `clawser-agent.js` is the single source of truth for a conversation. Messages, tool calls, goal changes, memory operations, and errors are all recorded as immutable events. The full conversation state can be reconstructed by replaying the event stream.

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

| Type | Source | Data Shape | Description |
|------|--------|------------|-------------|
| `user_message` | `user` | `{ content: string }` | User input message |
| `agent_message` | `agent` | `{ content: string }` | Agent response text |
| `tool_call` | `agent` | `{ call_id, name, arguments }` | Agent requests tool execution |
| `tool_result` | `system` | `{ call_id, name, result: ToolResult }` | Tool execution result |
| `goal_added` | `system` | `{ id, description }` | New goal created |
| `goal_updated` | `system` | `{ id, status }` | Goal status changed |
| `memory_stored` | `system` | `{ id, key, category }` | Memory entry created |
| `memory_forgotten` | `system` | `{ id }` | Memory entry deleted |
| `scheduler_added` | `system` | `{ id, schedule_type, prompt }` | Scheduler job created |
| `scheduler_fired` | `system` | `{ id, prompt }` | Scheduler job executed |
| `scheduler_removed` | `system` | `{ id }` | Scheduler job deleted |
| `context_compacted` | `system` | `{ from_tokens, to_tokens, messages_removed }` | Context window was compacted |
| `autonomy_blocked` | `system` | `{ reason }` | Action blocked by autonomy controller |
| `cache_hit` | `system` | `{ hash }` | Response served from cache |
| `error` | `system` | `{ message, stack? }` | Runtime error recorded |

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

Conversations are stored in OPFS as directories:

```
/clawser_workspaces/{wsId}/
  .conversations/{convId}/
    meta.json          # Conversation metadata (title, created, updated)
    events.jsonl       # Full event stream
```

### meta.json

```json
{
  "id": "conv_abc123",
  "title": "Weather lookup",
  "created": 1708732800000,
  "updated": 1708732900000,
  "event_count": 42,
  "model": "gpt-4o-mini"
}
```

## Checkpoint Format

In addition to event logs, Clawser maintains a binary checkpoint for fast restore:

```
/clawser_workspaces/{wsId}/
  .checkpoints/latest.bin
```

The checkpoint is a UTF-8 encoded JSON blob containing:

```json
{
  "id": "ckpt_1708732800000",
  "timestamp": 1708732800000,
  "agent_state": "Idle",
  "session_history": [...],
  "active_goals": [...],
  "scheduler_jobs": [...]
}
```

Checkpoints are a performance optimization. The event log is the authoritative source. If the checkpoint is corrupted or missing, state is rebuilt from `events.jsonl`.

## Derivation Operations

The `EventLog` supports deriving different views from the event stream:

### deriveSessionHistory(systemPrompt?)

Rebuilds the LLM-compatible message array from events. Maps `user_message` to `{ role: 'user' }`, `agent_message` to `{ role: 'assistant' }`, `tool_call` to assistant `tool_calls` array entries, and `tool_result` to `{ role: 'tool' }` messages. Goal, memory, scheduler, and error events are not included in LLM context.

### deriveToolCallLog()

Builds a tool audit trail by pairing `tool_call` and `tool_result` events via `call_id`. Returns an array of `{ name, params, result, time }` objects (most recent first).

### deriveGoals()

Rebuilds the goals array by replaying `goal_added` and `goal_updated` events. Returns the final state of each goal.

### sliceToTurnEnd(eventId)

Returns all events from the start of the log up to the end of the turn containing the given event ID. A "turn" starts at a `user_message` and extends through all subsequent events until the next `user_message`. Used for conversation forking and undo.

## Migration

Clawser supports three persistence formats with automatic migration:

1. **v2** (current): OPFS directory with `meta.json` + `events.jsonl`
2. **v1**: Single OPFS file with JSON blob
3. **v0**: Binary checkpoint only

On restore, v1 and v0 formats are automatically migrated to v2.

---

## Checkpoint Format

Checkpoints serialize the agent's in-memory state to OPFS for crash recovery.

### Binary Encoding

Checkpoints are stored as JSON-encoded `Uint8Array` files:

1. Agent state object is constructed:
   ```json
   {
     "history": [...],
     "goals": [...],
     "schedulerJobs": [...],
     "goalIdCounter": 42
   }
   ```
2. Serialized to JSON string via `JSON.stringify()`
3. Encoded to `Uint8Array` via `TextEncoder`
4. Written to OPFS file (e.g., `latest.bin`)

### Storage Location

```
clawser_workspaces/{workspaceId}/.checkpoints/latest.bin
```

### Migration Chain

Checkpoint restore follows a 3-level fallback hierarchy:

1. **v2**: OPFS directory-based (`clawser_workspaces/{wsId}/.checkpoints/latest.bin`)
2. **v1**: OPFS single-file (`clawser_conversations/{conversationId}.bin`)
3. **v0**: Legacy binary format (raw `Uint8Array` without JSON wrapper)

Each level is attempted in order. If a higher-priority checkpoint is found, lower-priority ones are ignored.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `history` | `Message[]` | Full conversation history (role, content, tool_calls) |
| `goals` | `Goal[]` | Active goals with status, progress, artifacts |
| `schedulerJobs` | `SchedulerJob[]` | Pending scheduled tasks (once, interval, cron) |
| `goalIdCounter` | `number` | Auto-increment counter for goal IDs |
