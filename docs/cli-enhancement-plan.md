# CLI Enhancement Plan — pi-Inspired Features

> **Date**: 2026-04-28 (plan), updated 2026-05-02 (status).
> **Status**: 4 of 5 features shipped; 1 partial.
> **Scope**: `web/clawser-cli.js` and related CLI modules.
>
> Implementation status (verified 2026-05-02):
>
> - Feature 1 (Tree-Based Session Branching): **Done** — `clawser session
>   branch` and `clawser session tree` wired via `ts.branch()`.
> - Feature 2 (RPC Mode): **Done** — stdio (default), Unix socket
>   (`--rpc-socket`), and HTTP (`--rpc-http`) all shipped. Bearer token
>   auth on HTTP. See `web/clawser-rpc.mjs`.
> - Feature 3 (JSON Output Mode): **Done** — `--json`/`-j` across
>   subcommands.
> - Feature 4 (Hot-Reloading Extensions): **Partial** — only skill hot
>   reload exists (`clawser-skill-hot-reload.js`). General-extension
>   hot reload remains a follow-up.
> - Feature 5 (Session Sharing): **Done** — `clawser-session-export.js`
>   with HTML/Markdown/JSON.
>
> See `docs/implementation-status.md` for cross-references (note: that
> ledger is a dated 2026-05-02/03 snapshot, not kept current — see
> `OUTSTANDING.md` and `CHANGELOG.md` for the latest status).

Five features inspired by [pi.dev](https://pi.dev/) that extend clawser's built-in CLI with branching conversations, machine-readable interfaces, live extension reloading, and session portability.

---

## Feature 1: Tree-Based Session Branching

**Priority**: 1 (highest)
**Complexity**: High
**Estimated effort**: 3–4 weeks

### Motivation

The current `session fork` command creates a flat copy — it duplicates the entire session and diverges from that point. There's no way to navigate back to the fork point, compare branches, or merge insights from parallel explorations. A tree model lets users treat conversations like git branches: explore a tangent, backtrack, try a different approach, and keep everything.

### Data Model Changes

The EventLog is currently a flat append-only array (`events[]`). To support branching, each event needs a parent pointer and each branch needs a named head.

```js
// New fields on each event
{
  id: "evt_...",
  type: "user_message",
  parentId: "evt_...",   // ← NEW: previous event in this branch (null for root)
  branchId: "main",      // ← NEW: which branch this event belongs to
  timestamp: 1708732800000,
  data: { content: "..." },
  source: "user"
}
```

New metadata structure stored alongside `events.jsonl`:

```js
// branches.json — stored in /clawser_workspaces/{wsId}/.conversations/{convId}/
{
  "branches": {
    "main": {
      "head": "evt_1708732800042_42",
      "createdAt": 1708732800000,
      "parentBranch": null,
      "forkPoint": null,
      "label": "main"
    },
    "try-different-model": {
      "head": "evt_1708732801000_55",
      "createdAt": 1708732801000,
      "parentBranch": "main",
      "forkPoint": "evt_1708732800020_20",
      "label": "try-different-model"
    }
  },
  "activeBranch": "main"
}
```

The EventLog class in `clawser-agent.js` gains:

- `branch(name, fromEventId?)` — create a new branch from a specific event (default: current head)
- `checkout(branchName)` — switch active branch, rebuild conversation state by walking parentId chain
- `getBranchTree()` — return the full tree structure for visualization
- `mergeBranch(source, target)` — append source events onto target as a "merge" meta-event
- `listBranches()` — return all branch metadata

Backward compatibility: events without `parentId`/`branchId` are treated as `main` branch with implicit sequential parentage.

### New CLI Subcommands

```
clawser branch                     List all branches (* marks active)
clawser branch create <name>       Fork from current position
clawser branch create <name> @N    Fork from event N in history
clawser checkout <branch>          Switch to a branch
clawser merge <source> [target]    Merge source into target (default: active)
clawser tree                       Print ASCII tree of branches
clawser diff <branch-a> <branch-b> Show divergence point and unique events
```

### Tree Visualization

The `clawser tree` command renders an ASCII graph:

```
* main (active, 42 events)
│
├─● try-different-model (12 events, forked @20)
│  └── head: "Switched to claude-3.5..."
│
└─● research-tangent (8 events, forked @35)
   └── head: "Found three relevant papers..."
```

### Interaction with Session Persistence

The existing OPFS layout extends naturally:

```
/clawser_workspaces/{wsId}/.conversations/{convId}/
  meta.json
  events.jsonl          # All events, all branches (parentId links them)
  branches.json         # Branch metadata
```

`session export` gains a `--branch` flag to export a single branch. `session fork` becomes sugar for `branch create` + `session new`.

### Files to Change

| File | Change |
|------|--------|
| `web/clawser-agent.js` | EventLog class: add `parentId`, `branchId`, branch CRUD methods |
| `web/clawser-cli.js` | New subcommands: `branch`, `checkout`, `merge`, `tree`, `diff` |
| `web/clawser-state.js` | Track `activeBranch` in app state |
| `docs/EVENT-LOG.md` | Document new event fields and branch metadata |
| `web/clawser-cli.d.ts` | Type declarations for new subcommands |

### Dependencies

- EventLog append path must support parentId injection
- Conversation persistence (OPFS) must handle `branches.json`
- Context reconstruction must walk the parentId chain, not assume array order

---

## Feature 2: RPC Mode

**Priority**: 2
**Complexity**: High
**Estimated effort**: 3–4 weeks

### Motivation

Other tools (editors, scripts, CI pipelines, browser extensions) should be able to talk to a running clawser agent without going through the terminal UI. An RPC interface turns clawser into a headless AI backend that anything can call.

### Protocol

JSON-RPC 2.0 over three transport options:

| Transport | Use Case | Binding |
|-----------|----------|---------|
| **stdin/stdout** | Piped processes, editor plugins | `clawser rpc --stdio` |
| **Unix socket** | Local IPC, multiple clients | `clawser rpc --socket /tmp/clawser.sock` |
| **HTTP** | Network access, webhooks | `clawser rpc --http :8422` |

All transports use the same JSON-RPC 2.0 envelope:

```json
// Request
{ "jsonrpc": "2.0", "method": "sendMessage", "params": { "content": "Hello" }, "id": 1 }

// Response
{ "jsonrpc": "2.0", "result": { "content": "Hi there!", "tokens": 42 }, "id": 1 }

// Notification (no id, no response expected)
{ "jsonrpc": "2.0", "method": "agent.stateChanged", "params": { "state": "thinking" } }
```

### Available RPC Methods

**Core**:
| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `sendMessage` | `{ content, branch? }` | `{ content, eventId, tokens }` | Send a message and get a response |
| `getStatus` | `{}` | `{ state, model, historyLen, ... }` | Agent state summary |
| `getHistory` | `{ limit?, branch? }` | `{ events[] }` | Conversation history |
| `clearHistory` | `{}` | `{ ok: true }` | Clear conversation |

**Tools**:
| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `listTools` | `{}` | `{ tools[] }` | Available tools |
| `executeTool` | `{ name, arguments }` | `{ result }` | Run a tool directly |
| `listSkills` | `{}` | `{ skills[] }` | Installed skills |

**Config**:
| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `getConfig` | `{}` | `{ model, ... }` | Current configuration |
| `setConfig` | `{ key, value }` | `{ ok: true }` | Update configuration |
| `getModel` | `{}` | `{ model }` | Current model |
| `setModel` | `{ model }` | `{ ok: true }` | Switch model |

**Session**:
| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `listSessions` | `{}` | `{ sessions[] }` | Terminal sessions |
| `switchSession` | `{ id }` | `{ ok: true }` | Switch session |
| `exportSession` | `{ format }` | `{ content }` | Export session |

**Notifications** (server → client):
| Notification | Params | Description |
|-------------|--------|-------------|
| `agent.stateChanged` | `{ state }` | Agent state transition |
| `agent.response.chunk` | `{ content, done }` | Streaming response chunk |
| `tool.called` | `{ name, arguments }` | Tool invocation started |
| `tool.result` | `{ name, result }` | Tool returned |

### Security Considerations

- **Authentication**: Unix socket inherits filesystem permissions. HTTP transport requires a bearer token generated on startup and printed to stderr.
- **Rate limiting**: Configurable per-method limits. Default: 60 req/min for `sendMessage`, unlimited for reads.
- **Tool execution**: RPC `executeTool` respects the same AutonomyController policies as interactive use. Dangerous tools still require approval — the RPC response includes an `approval_required` status and the client must send a follow-up `approveAction` call.
- **Origin restriction**: HTTP mode binds to `127.0.0.1` by default. Remote binding requires explicit `--bind 0.0.0.0` and prints a warning.

### Implementation Approach

New file `web/clawser-rpc.js`:

```js
export class RpcServer {
  #agent;
  #transport; // 'stdio' | 'socket' | 'http'
  #methods;   // Map<string, handler>

  constructor(agent, opts) { ... }
  start() { ... }
  stop() { ... }
}
```

The CLI gets a new subcommand:

```
clawser rpc [--stdio|--socket PATH|--http PORT]
clawser rpc status        # Show if RPC is running
clawser rpc stop          # Stop RPC server
```

### Integration with Other Tools

Example: VS Code extension calls clawser via Unix socket:

```js
const net = require('net');
const socket = net.connect('/tmp/clawser.sock');
socket.write(JSON.stringify({
  jsonrpc: '2.0', method: 'sendMessage',
  params: { content: 'Explain this function' }, id: 1
}) + '\n');
```

### Files to Change

| File | Change |
|------|--------|
| `web/clawser-rpc.js` | **NEW** — RPC server, method registry, transport handlers |
| `web/clawser-cli.js` | New `rpc` subcommand |
| `web/clawser-agent.js` | Expose methods needed by RPC (most already public) |
| `web/clawser-cli.d.ts` | RPC type declarations |
| `docs/API.md` | RPC method reference |

### Dependencies

- Node.js `net` module for Unix socket (or WebSocket polyfill for browser context)
- The agent's `sendMessage`/`run` must support non-interactive invocation (already does via `oneShot`)
- Streaming responses require the agent to emit chunk events

---

## Feature 3: JSON Output Mode

**Priority**: 2
**Complexity**: Low
**Estimated effort**: 1 week

### Motivation

Shell scripts and automation tools can't parse clawser's human-readable output. A `--json` flag makes every subcommand emit structured JSON, enabling pipelines like `clawser history --json | jq '.events[] | select(.type == "tool_call")'`.

### Output Format Specification

Every subcommand that currently returns `{ stdout, stderr, exitCode }` gains a JSON mode. When `--json` is active, `stdout` contains a single JSON object (for one-shot commands) or newline-delimited JSON objects (for streaming).

**One-shot format**:

```json
{
  "ok": true,
  "command": "clawser status",
  "data": {
    "model": "claude-sonnet-4-20250514",
    "state": "Idle",
    "history_len": 42,
    "memory_count": 3,
    "goals": 0,
    "scheduler_jobs": 1
  }
}
```

**Error format**:

```json
{
  "ok": false,
  "command": "clawser config set model",
  "error": { "code": "MISSING_VALUE", "message": "No value provided for 'model'" }
}
```

**Streaming format (JSONL)** — for `clawser "prompt" --json`:

```
{"type":"start","timestamp":1708732800000,"model":"claude-sonnet-4-20250514"}
{"type":"chunk","content":"Here's ","index":0}
{"type":"chunk","content":"my response","index":1}
{"type":"tool_call","name":"web_search","arguments":{"query":"weather"}}
{"type":"tool_result","name":"web_search","result":{"output":"Sunny"}}
{"type":"done","content":"Here's my response...","tokens":{"input":120,"output":45},"cost_cents":0.02}
```

### Subcommand Coverage

| Subcommand | JSON shape |
|------------|------------|
| `clawser "prompt"` | Streaming JSONL (chunks + done) |
| `clawser status` | `{ model, state, history_len, ... }` |
| `clawser config` | `{ model, provider, tool_count, ... }` |
| `clawser history` | `{ events: [...] }` (raw event objects) |
| `clawser tools` | `{ shell_commands: [...], agent_tools: N }` |
| `clawser cost` | `{ cost_cents, cost_dollars }` |
| `clawser model` | `{ model }` |
| `clawser memory list` | `{ memories: [...] }` |
| `clawser session` | `{ sessions: [...] }` |
| `clawser session export` | `{ format, content }` |
| `clawser branch` | `{ branches: [...], active }` |
| `clawser tree` | `{ tree: { ... } }` (nested branch objects) |

### Integration with Shell Pipes

```bash
# Extract all tool calls from history
clawser history --json | jq '.events[] | select(.type == "tool_call") | .data.name'

# Get the model name for a script
MODEL=$(clawser model --json | jq -r '.data.model')

# Stream a response and extract just the final text
clawser "summarize this" --json | grep '"type":"done"' | jq -r '.content'
```

### Backward Compatibility

- The `--json` / `-j` / `--output json` flag is opt-in. Default output is unchanged.
- Exit codes remain the same (0 = success, 1 = error).
- `stderr` is never JSON — it stays human-readable for debugging.

### Implementation Approach

Add to `parseFlags` spec:

```js
const FLAG_SPEC = {
  // ... existing flags
  j: 'json',
  json: true,
  output: 'value',  // --output json | --output text
};
```

Each subcommand handler checks `flags.json` and returns structured data instead of formatted strings. A helper wraps the pattern:

```js
const jsonOut = (data, command) => ({
  stdout: JSON.stringify({ ok: true, command, data }) + '\n',
  stderr: '', exitCode: 0,
});

const jsonErr = (error, command) => ({
  stdout: JSON.stringify({ ok: false, command, error }) + '\n',
  stderr: '', exitCode: 1,
});
```

### Files to Change

| File | Change |
|------|--------|
| `web/clawser-cli.js` | Add `--json` flag, update every subcommand handler |
| `web/clawser-cli.d.ts` | Type for JSON output envelope |
| `web/clawser-wsh-cli.js` | Already has `--json` on some commands — extend to all |

### Dependencies

- None. Pure output formatting change.

---

## Feature 4: Hot-Reloading Extensions

**Priority**: 3
**Complexity**: Medium
**Estimated effort**: 2 weeks

### Motivation

Currently, modifying a skill file requires restarting the session or manually re-registering it. During skill development, this is painful. Hot-reloading lets you edit a `SKILL.md` or tool definition and see changes reflected immediately.

### File Watcher Implementation

The watcher monitors the skill directories using the platform's file-watching API:

```js
// web/clawser-hot-reload.js

export class HotReloader {
  #registry;      // SkillRegistry
  #watchers;      // Map<string, FSWatcher | FileSystemObserver>
  #debounceMs;
  #onError;

  constructor(registry, opts = {}) {
    this.#registry = registry;
    this.#watchers = new Map();
    this.#debounceMs = opts.debounceMs ?? 300;
    this.#onError = opts.onError ?? console.error;
  }

  // Start watching a directory
  watch(dirPath) { ... }

  // Stop all watchers
  stop() { ... }

  // Handle a file change event
  async #handleChange(path, kind) { ... }
}
```

**Browser context**: Use the File System Observer API (available in Chrome 129+) or poll via `FileSystemDirectoryHandle` every 2 seconds as fallback.

**Node.js context**: Use `fs.watch` with recursive option.

### What Gets Reloaded

| Resource | Hot-Reloadable | Mechanism |
|----------|---------------|-----------|
| **Skill definitions** (`SKILL.md`) | Yes | Re-parse frontmatter, update registry entry |
| **Skill prompts** (body text) | Yes | Replace cached prompt text |
| **Tool definitions** (JS files registered by skills) | Yes | Re-import module, re-register tool spec |
| **System prompt fragments** | Yes | Rebuild system prompt on next request |
| **Custom commands** (shell commands from skills) | Yes | Re-register with CommandRegistry |

### What Can't Be Hot-Reloaded

| Resource | Why |
|----------|-----|
| **Provider connections** | Stateful WebSocket/HTTP connections can't be swapped |
| **Core agent class** | Too many internal references; requires full restart |
| **EventLog schema** | In-flight events would become inconsistent |
| **Active tool executions** | A tool mid-execution uses the old code; next call uses new |
| **MCP server bindings** | Server connections are stateful |

### Error Handling for Broken Extensions

When a reloaded file fails to parse or execute:

1. **Log the error** to the EventLog as a `system` event of type `hot_reload_error`.
2. **Keep the previous version** — the old skill/tool remains active.
3. **Notify the user** via a terminal status line: `⚠ Skill "my-skill" failed to reload: SyntaxError at line 12`.
4. **Retry on next save** — the watcher keeps running.

```js
async #handleChange(path, kind) {
  try {
    const content = await this.#readFile(path);
    const parsed = SkillParser.parse(content);
    this.#registry.update(parsed.metadata.name, parsed);
    this.#emit('reloaded', { path, name: parsed.metadata.name });
  } catch (err) {
    this.#onError(err);
    this.#emit('reload_failed', { path, error: err.message });
    // Previous version remains active — no rollback needed
  }
}
```

### Interaction with Existing Skill System

The `SkillRegistry` class (`web/clawser-skills.js`) already has an `update` path for skill installation. Hot-reload piggybacks on this:

1. `SkillStorage` detects file change → reads new content
2. `SkillParser.parse()` extracts metadata + body
3. `SkillRegistry.update()` replaces the entry (same as install-over-existing)
4. If the skill registered shell commands, `CommandRegistry.register()` overwrites the old handler
5. If the skill registered tools, the tool spec map is updated

### CLI Integration

```
clawser watch                  Start hot-reload watcher
clawser watch stop             Stop watcher
clawser watch status           Show watched paths and reload stats
clawser watch --verbose        Log every file change
```

The watcher also auto-starts when `--dev` is passed to any clawser command:

```
clawser chat --dev             Enter chat mode with hot-reload enabled
```

### Files to Change

| File | Change |
|------|--------|
| `web/clawser-hot-reload.js` | **NEW** — HotReloader class, file watchers |
| `web/clawser-skills.js` | Ensure `SkillRegistry.update()` handles mid-session replacement cleanly |
| `web/clawser-cli.js` | New `watch` subcommand, `--dev` flag |
| `web/clawser-agent.js` | Emit `hot_reload` events to EventLog |
| `web/clawser-shell.js` | `CommandRegistry.register()` must allow overwrite without warning |

### Dependencies

- `SkillRegistry.update()` must be idempotent
- `CommandRegistry` must support re-registration (it currently does via `register()` overwrite)
- File System Observer API or `fs.watch` availability

---

## Feature 5: Session Sharing

**Priority**: 3
**Complexity**: Medium
**Estimated effort**: 2 weeks

### Motivation

Conversations with an AI agent often produce valuable artifacts — debugging sessions, research threads, code generation logs. Users should be able to share these as standalone documents or import sessions from others.

### Export Formats

#### HTML (Standalone Viewer)

A single `.html` file with embedded CSS/JS that renders the conversation in a readable format. No external dependencies — works offline.

```html
<!-- clawser-session-export.html -->
<!DOCTYPE html>
<html>
<head>
  <title>Clawser Session: {title}</title>
  <style>/* Embedded dark theme matching clawser UI */</style>
</head>
<body>
  <div id="session-viewer">
    <header>
      <h1>{title}</h1>
      <p>Model: {model} · {eventCount} events · {date}</p>
    </header>
    <div id="messages"><!-- Rendered conversation --></div>
    <div id="metadata"><!-- Collapsed tool calls, timestamps --></div>
  </div>
  <script>
    const SESSION_DATA = /* embedded JSON */;
    // Render logic: message bubbles, collapsible tool calls,
    // syntax-highlighted code blocks, timestamp toggle
  </script>
</body>
</html>
```

Features of the HTML viewer:
- Toggle tool call details (collapsed by default)
- Syntax highlighting for code blocks
- Search within the conversation
- Dark/light theme toggle
- Print-friendly CSS

#### Markdown

Clean markdown suitable for GitHub, Obsidian, or any markdown renderer.

```markdown
# Session: {title}

**Model**: claude-sonnet-4-20250514 · **Date**: 2026-04-28 · **Events**: 42

---

**User** (14:30:02):
How do I implement a B-tree in Rust?

**Agent** (14:30:05):
Here's a basic B-tree implementation...

> 🔧 **Tool Call**: `web_search("B-tree Rust implementation")`
> **Result**: Found 3 relevant results...

---
```

#### JSON

Raw event data for programmatic consumption. Same format as `clawser session export --json` but with added metadata envelope:

```json
{
  "clawser_version": "0.1.0",
  "export_version": 1,
  "session": {
    "title": "B-tree Discussion",
    "model": "claude-sonnet-4-20250514",
    "created": "2026-04-28T14:30:00Z",
    "event_count": 42,
    "branch": "main"
  },
  "events": [ ... ]
}
```

### What's Included vs Excluded

| Included | Excluded (privacy) |
|----------|-------------------|
| User messages | API keys (`ANTHROPIC_API_KEY`, etc.) |
| Agent responses | Bearer tokens in tool results |
| Tool call names + arguments | Filesystem paths (optionally redacted) |
| Tool results (sanitized) | Memory entries marked `private` |
| Timestamps | Internal error stacks |
| Model name | Cost data (optionally included) |
| Branch structure | MCP server credentials |

### Privacy Sanitization

A sanitizer pass runs before export:

```js
const sanitize = (events) => events.map(evt => {
  const clean = structuredClone(evt);

  // Strip known secret patterns from all string values
  const secretPatterns = [
    /sk-[a-zA-Z0-9]{20,}/g,        // Anthropic keys
    /Bearer [a-zA-Z0-9._-]+/g,     // Bearer tokens
    /ghp_[a-zA-Z0-9]{36}/g,        // GitHub PATs
    /xoxb-[a-zA-Z0-9-]+/g,         // Slack tokens
  ];

  const scrub = (obj) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        for (const pat of secretPatterns) {
          obj[k] = obj[k].replace(pat, '[REDACTED]');
        }
      } else if (v && typeof v === 'object') {
        scrub(v);
      }
    }
  };

  scrub(clean.data);
  return clean;
});
```

### Import Support

```
clawser session import <file>          Import from JSON/JSONL file
clawser session import --url <url>     Import from URL (fetch + parse)
clawser session import --gist <id>     Import from GitHub Gist
```

Import reconstructs an EventLog from the exported events and creates a new session. The imported session is read-only by default (to preserve the original) but can be forked for continuation:

```
clawser session import session.json    # Creates "Imported: B-tree Discussion"
clawser session fork                   # Fork it to continue the conversation
```

### CLI Integration

Extends existing `clawser session export`:

```
clawser session export --html [file]       Export as standalone HTML
clawser session export --markdown [file]   Export as markdown
clawser session export --json [file]       Export as JSON with metadata
clawser session export --gist              Upload as GitHub Gist (requires gh auth)
clawser session export --clipboard         Copy markdown to clipboard
```

When `[file]` is omitted, output goes to stdout (except `--html` which defaults to `session-{timestamp}.html`).

### Files to Change

| File | Change |
|------|--------|
| `web/clawser-session-export.js` | **NEW** — HTML template, markdown formatter, sanitizer, Gist upload |
| `web/clawser-cli.js` | Extend `session export` with new formats, add `session import` |
| `web/clawser-state.js` | Support read-only imported sessions |
| `web/clawser-cli.d.ts` | Type declarations for export/import |

### Dependencies

- Session export already exists for `--script`, `--markdown`, `--json` in `clawser-cli.js` — this extends it
- HTML export needs a template engine (or just template literals — no dependency needed)
- Gist upload requires `gh` CLI or GitHub API token
- Import needs the same EventLog deserialization as `EventLog.fromJSONL()`

---

## Implementation Order

```
Phase 1 (Foundation)        Phase 2 (Machine Interface)     Phase 3 (DX Polish)
─────────────────────       ───────────────────────────      ──────────────────────
1. JSON Output Mode         3. RPC Mode                     4. Hot-Reloading Extensions
   (1 week, unblocks        (3-4 weeks, depends on          (2 weeks, independent)
    automation + testing)     JSON output for responses)

2. Tree-Based Branching     5. Session Sharing
   (3-4 weeks, core          (2 weeks, depends on
    data model change)        branching for --branch flag)
```

**Recommended start**: JSON Output Mode. It's low-risk, immediately useful for testing, and the structured output format becomes the foundation for RPC responses and session export.

---

## Summary Table

| # | Feature | Priority | Complexity | Est. Effort | Key New File |
|---|---------|----------|------------|-------------|--------------|
| 1 | Tree-Based Session Branching | 1 | High | 3–4 weeks | — (extends `clawser-agent.js`) |
| 2 | RPC Mode | 2 | High | 3–4 weeks | `web/clawser-rpc.js` |
| 3 | JSON Output Mode | 2 | Low | 1 week | — (modifies `clawser-cli.js`) |
| 4 | Hot-Reloading Extensions | 3 | Medium | 2 weeks | `web/clawser-hot-reload.js` |
| 5 | Session Sharing | 3 | Medium | 2 weeks | `web/clawser-session-export.js` |

**Total estimated effort**: 11–13 weeks (sequential) or ~6–7 weeks with parallelism (JSON + Branching in parallel; RPC + Hot-Reload in parallel; Session Sharing last).
