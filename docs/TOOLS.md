# Clawser Tool Reference

Complete reference for all ~100 registered tools. Tools extend `BrowserTool` and are managed by `BrowserToolRegistry` in `clawser-tools.js`.

## Permission Levels

| Level | Behavior |
|-------|----------|
| `auto` / `internal` / `read` | Runs without user confirmation |
| `approve` / `network` / `browser` / `write` | Requires user confirmation (configurable per-tool) |
| `denied` | Blocked — cannot execute |

Permissions are configurable per-tool, per-workspace via the Tools panel. Click a tool's permission badge to cycle: auto → approve → denied → auto.

---

## Core Browser Tools

**File**: `web/clawser-tools.js`

### browser_fetch

Fetch a URL via HTTP. Returns status, headers, and body text.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | yes | — | URL to fetch |
| `method` | enum | no | GET | GET, POST, PUT, DELETE, PATCH |
| `headers` | object | no | — | Request headers |
| `body` | string | no | — | Request body |

**Permission**: `network`
**Notes**: Enforces configurable domain allowlist. Body truncated at 50,000 chars.

### browser_dom_query

Query DOM elements using CSS selectors. Returns text content, attributes, and structure.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `selector` | string | yes | — | CSS selector |
| `limit` | number | no | 10 | Max elements to return |
| `include_html` | boolean | no | false | Include raw HTML |

**Permission**: `browser`

### browser_dom_modify

Modify DOM elements. Set text, attributes, styles, or innerHTML.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `selector` | string | yes | — | CSS selector |
| `action` | enum | yes | — | setText, setHTML, setAttribute, setStyle, addClass, removeClass, remove, insertHTML |
| `value` | string | no | — | New value |
| `attribute` | string | no | — | Attribute name (for setAttribute) |

**Permission**: `browser`
**Notes**: Sanitizes HTML — blocks `<script>`, `<iframe>`, `on*` handlers, `javascript:` and `data:text/html` URLs. Uses native Sanitizer API when available.

### browser_fs_read

Read a file from the Origin Private File System (OPFS).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | File path |

**Permission**: `read`
**Notes**: Scoped to workspace home via WorkspaceFs. Max read size 50MB.

### browser_fs_write

Write a file to OPFS. Creates parent directories as needed.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | File path |
| `content` | string | yes | File content |

**Permission**: `write`
**Notes**: Max file size configurable (default 10MB). Checks storage quota before writing — warns at 80%, blocks at 95%.

### browser_fs_list

List files and directories in OPFS.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | no | "/" | Directory path |

**Permission**: `read`

### browser_fs_delete

Delete a file or directory from OPFS.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | yes | — | Path to delete |
| `recursive` | boolean | no | false | Delete recursively |

**Permission**: `write`

### browser_storage_get

Read a value from localStorage by key.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | yes | localStorage key |

**Permission**: `read`
**Notes**: Blocks access to `clawser_*` keys (reserved for internal config).

### browser_storage_set

Write a value to localStorage.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | yes | localStorage key |
| `value` | string | yes | Value to store |

**Permission**: `write`
**Notes**: Blocks writing to `clawser_*` keys.

### browser_storage_list

List all keys in localStorage with value lengths.

**Permission**: `read`
**Notes**: Hides all `clawser_*` keys.

### browser_clipboard_read

Read text from the system clipboard.

**Permission**: `browser`

### browser_clipboard_write

Write text to the system clipboard.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | yes | Text to copy |

**Permission**: `browser`

### browser_navigate

Open a URL in a new browser tab or the current page.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | yes | — | URL to open |
| `new_tab` | boolean | no | true | Open in new tab |

**Permission**: `browser`
**Notes**: Only allows `http:` / `https:` protocols.

### browser_notify

Show a browser notification.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | yes | Notification title |
| `body` | string | no | Notification body |
| `icon` | string | no | Icon URL |

**Permission**: `browser`

### browser_eval_js

Evaluate JavaScript in the page global scope.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | yes | JavaScript code |

**Permission**: `approve`
**Notes**: Uses indirect eval for global scope. Requires explicit user confirmation.

### browser_screen_info

Get current page info: URL, title, viewport size, scroll position, and visible text summary.

**Permission**: `read`

### browser_web_search

Search the web using DuckDuckGo.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | — | Search query |
| `limit` | number | no | 5 | Max results |

**Permission**: `network`
**Notes**: Uses DuckDuckGo HTML lite endpoint (no API key required).

### browser_screenshot

Capture a screenshot as a data URL (PNG).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `selector` | string | no | CSS selector for specific element |

**Permission**: `browser`
**Notes**: Lazy-loads `html2canvas` from CDN on first use.

### ask_user_question

Ask the user one or more questions with predefined options.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `questions` | array | yes | Array of question objects |

Each question: `{ question, header (max 12 chars), options: [{ label, description }], multiSelect }`. Max 4 questions, 2–4 options each.

**Permission**: `auto`

### switch_agent

Switch to a different agent configuration. Omit `agent` to list available agents.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | string | no | Agent name |
| `reason` | string | no | Reason for switch |

**Permission**: `approve`

### consult_agent

Send a message to another agent and get their response.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | string | yes | Agent name |
| `message` | string | yes | Message to send |

**Permission**: `auto`

---

## Agent Tools

**File**: `web/clawser-tools.js` (registered via `registerAgentTools()`)

All have permission `internal` (auto-allowed).

### agent_memory_store

Store a memory for later recall.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `key` | string | yes | — | Memory key |
| `content` | string | yes | — | Memory content |
| `category` | enum | no | learned | core, learned, user, context |

### agent_memory_recall

Search stored memories by keyword query. Returns top 10 results via hybrid BM25 + vector search.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query |

### agent_memory_forget

Delete a stored memory by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Memory ID (e.g. "mem_1") |

### agent_goal_add

Add a new goal.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `description` | string | yes | Goal description |

### agent_goal_update

Update goal status.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Goal ID |
| `status` | enum | yes | active, completed, failed |

### agent_schedule_add

Add a scheduled job.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `schedule_type` | enum | yes | once, interval, cron |
| `prompt` | string | yes | Prompt to execute |
| `delay_ms` | number | no | Delay for "once" type |
| `interval_ms` | number | no | Interval for "interval" type |
| `cron_expr` | string | no | 5-field cron expression |

### agent_schedule_list

List all scheduled jobs with status.

### agent_schedule_remove

Remove a scheduled job by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Job ID (e.g. "job_1") |

---

## Browser Automation Tools

**File**: `web/clawser-browser-auto.js`

All require a `session_id` returned from `browser_open`. Interact via an injectable bridge (Chrome extension or local server).

### browser_open

Open a URL in a new automated browser tab. Returns a session ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | yes | URL to open |

**Permission**: `approve`
**Notes**: Enforces domain allowlist and max-tabs limit (default 10).

### browser_read_page

Extract text content and interactive elements from a page.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Session ID |

**Permission**: `approve`

### browser_click

Click an element by selector, text, or coordinates.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Session ID |
| `selector` | string | no | CSS selector |
| `text` | string | no | Element text |
| `x` | number | no | X coordinate |
| `y` | number | no | Y coordinate |

**Permission**: `approve`

### browser_fill

Fill a form field.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Session ID |
| `selector` | string | yes | Field selector |
| `value` | string | yes | Value to fill |
| `field_type` | string | no | Field type |

**Permission**: `approve`
**Notes**: Refuses password, credit-card, and SSN fields.

### browser_wait

Wait for an element to appear.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `session_id` | string | yes | — | Session ID |
| `selector` | string | yes | — | CSS selector |
| `timeout` | number | no | 10000 | Timeout in ms |

**Permission**: `approve`

### browser_evaluate

Run JavaScript in the page context.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Session ID |
| `script` | string | yes | JavaScript code |

**Permission**: `approve`

### browser_list_tabs

List open automated browser tabs.

**Permission**: `read`

### browser_close_tab

Close an automated browser tab.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Session ID |

**Permission**: `approve`

---

## Git Tools

**File**: `web/clawser-git.js`

All have permission `approve`.

### git_status

Show working tree status.

### git_diff

Show changes (working tree or between commits).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `since` | string | no | HEAD~5 | Commit range |

**Notes**: Truncates patch output at 2,000 chars.

### git_log

Show commit history.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `depth` | number | no | 20 | Max commits |
| `filter` | string | no | — | Keyword filter |

### git_commit

Create a commit (auto-stages all changes).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | yes | Commit message |
| `type` | string | no | goal, experiment, fix, refactor, checkpoint |
| `id` | string | no | Related goal/experiment ID |

### git_branch

List, create, or switch branches.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | string | no | list | list, create, switch, abandon |
| `name` | string | no | — | Branch name |
| `reason` | string | no | — | Reason for branch |

### git_recall

Semantic search over commit messages.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `topic` | string | no | Search keyword |
| `goal_id` | string | no | Filter by goal |
| `experiments` | boolean | no | Show experiment branches |

---

## Channel Tools

**File**: `web/clawser-channels.js`

### channel_list

List connected channels and their status.

**Permission**: `read`

### channel_send

Send a message to a specific channel.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channel` | string | yes | telegram, discord, slack, etc. |
| `channel_id` | string | yes | Channel identifier |
| `message` | string | yes | Message text |

**Permission**: `approve`
**Notes**: Formats for target channel (Telegram HTML, Slack mrkdwn, Discord markdown).

### channel_history

Recent messages from a channel.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channel` | string | no | — | Channel filter |
| `limit` | number | no | 20 | Max messages |

**Permission**: `read`

---

## Hardware Peripheral Tools

**File**: `web/clawser-hardware.js`

All have permission `approve`. Uses Web Serial, Web Bluetooth, and Web USB APIs.

### hw_list

List connected hardware peripherals and available Web APIs.

### hw_connect

Connect to a hardware peripheral (triggers native browser permission dialog).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | yes | serial, bluetooth, usb |
| `baudRate` | number | no | Serial baud rate |
| `filters` | array | no | Device filters |

### hw_send

Send data to a connected peripheral.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `device` | string | yes | Device ID |
| `data` | string | yes | Data to send |

### hw_read

Read data from a connected peripheral.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `device` | string | yes | — | Device ID |
| `timeout` | number | no | 5000 | Timeout in ms |

### hw_disconnect

Disconnect a hardware peripheral.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `device` | string | yes | Device ID or "all" |

### hw_info

Get device info (board type, firmware version).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `device` | string | yes | Device ID |

---

## Skills Tools

**File**: `web/clawser-skills.js`

### activate_skill

Activate an available skill to get its instructions and tools.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Skill name |
| `arguments` | string | no | Arguments to pass |

**Permission**: `internal`

### deactivate_skill

Deactivate a currently active skill.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Skill name |

**Permission**: `internal`

### skill_search

Search the skill registry for installable skills.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query |
| `tags` | string | no | Comma-separated tag filter |

**Permission**: `network`

### skill_install

Install a skill from the registry or a URL.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | yes | — | Registry name or HTTPS URL |
| `scope` | string | no | global | global or workspace |

**Permission**: `network`

### skill_update

Check for and install skill updates.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Skill name |

**Permission**: `network`

### skill_remove

Uninstall a skill.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Skill name |

**Permission**: `write`

### skill_list

List all installed skills with status.

**Permission**: `read`

---

## Tool Builder Tools

**File**: `web/clawser-tool-builder.js`

### tool_build

Build a new custom tool from JavaScript code.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Tool name |
| `description` | string | yes | Tool description |
| `code` | string | yes | JavaScript code (must define `execute(params)`) |
| `parameters_schema` | string | no | JSON Schema for parameters |
| `test_input` | string | no | JSON test input for dry-run |

**Permission**: `approve`
**Notes**: Validates code safety (blocks fetch, eval, DOM access, etc.), dry-runs with test input, auto-increments version.

### tool_test

Test tool code with sample input without registering.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | yes | JavaScript code |
| `test_input` | string | no | JSON test input |

**Permission**: `approve`

### tool_list_custom

List all dynamically created custom tools.

**Permission**: `read`

### tool_edit

Edit the code of an existing custom tool (creates new version).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Tool name |
| `code` | string | yes | New JavaScript code |
| `description` | string | no | New description |

**Permission**: `approve`

### tool_remove

Remove a dynamically created custom tool.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Tool name |

**Permission**: `write`

---

## Enhanced Goal Tools

**File**: `web/clawser-goals.js`

Supports hierarchy, priority, artifacts, and progress tracking (extends the simpler `agent_goal_add` / `agent_goal_update`).

### goal_add

Add a goal with optional parent and priority.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `description` | string | yes | — | Goal description |
| `parent_id` | string | no | — | Parent goal ID (for sub-goals) |
| `priority` | enum | no | medium | low, medium, high, critical |

**Permission**: `auto`

### goal_update

Update goal status with optional progress note.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `goal_id` | string | yes | Goal ID |
| `status` | enum | yes | active, paused, completed, failed |
| `progress_note` | string | no | Progress note |

**Permission**: `auto`

### goal_add_artifact

Link a workspace file as a goal artifact.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `goal_id` | string | yes | Goal ID |
| `file_path` | string | yes | Path to file |

**Permission**: `auto`

### goal_list

List goals with optional filters.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `status` | enum | no | all | active, completed, failed, paused, all |
| `parent_id` | string | no | — | Filter by parent |

**Permission**: `read`

---

## Routine Automation Tools

**File**: `web/clawser-routines.js`

### routine_create

Create a new routine (trigger + action + guardrails).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | yes | — | Routine name |
| `trigger_type` | string | no | — | cron, event, webhook |
| `cron` | string | no | — | Cron expression (5-field) |
| `event` | string | no | — | Event type to listen for |
| `prompt` | string | no | — | Prompt to execute |
| `max_runs_per_hour` | number | no | 3 | Rate limit |

**Permission**: `approve`

### routine_list

List all routines with status.

**Permission**: `read`

### routine_delete

Remove a routine.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Routine ID |

**Permission**: `approve`

### routine_run

Manually trigger a routine (bypass schedule).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Routine ID |

**Permission**: `approve`

---

## Undo Tools

**File**: `web/clawser-undo.js`

### undo

Undo the last N turns. Reverts conversation, files, memory, and goals.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `turns` | number | no | 1 | Number of turns to undo |

**Permission**: `approve`

### undo_status

Show undo history and preview what would be reverted.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `preview_turns` | number | no | 1 | Turns to preview |

**Permission**: `read`

---

## Heartbeat Tools

**File**: `web/clawser-heartbeat.js`

### heartbeat_status

Show heartbeat check status and recent results.

**Permission**: `read`

### heartbeat_run

Manually run heartbeat checks.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `group` | string | no | all | "all", "wake", or minutes (e.g. "5") |

**Permission**: `approve`

---

## wsh Tools

**File**: `web/clawser-wsh-tools.js`

### wsh_connect

Connect to a remote server via the wsh protocol.

**Permission**: `approve`

### wsh_exec

Execute a command on a remote server.

**Permission**: `approve`

### wsh_fetch

Fetch a URL via curl on the remote server (CORS bypass).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | yes | URL to fetch |
| `method` | string | no | HTTP method (default: GET) |
| `headers` | object | no | Request headers |
| `body` | string | no | Request body |
| `host` | string | no | Server host |
| `timeout_ms` | number | no | Timeout in ms (default: 30000) |

**Permission**: `approve`

### wsh_upload / wsh_download

Transfer files to/from a remote server.

**Permission**: `approve`

### wsh_pty_open / wsh_pty_write

Open and interact with a remote PTY session.

**Permission**: `approve`

### wsh_disconnect

Disconnect from a remote server.

**Permission**: `auto`

### wsh_sessions

List active wsh sessions.

**Permission**: `read`

### wsh_mcp_call

Call an MCP tool on a remote server.

**Permission**: `approve`

---

## Delegation Tool

**File**: `web/clawser-delegate.js`

### agent_delegate

Delegate a sub-task to a focused sub-agent with isolated context.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task` | string | yes | — | Task description |
| `max_iterations` | number | no | 10 | Max tool iterations |
| `tools` | array | no | — | Restrict to these tool names |

**Permission**: `approve`

---

## Self-Repair Tools

**File**: `web/clawser-self-repair.js`

### self_repair_status

Show self-repair engine status, thresholds, and recovery history.

**Permission**: `read`

### self_repair_configure

Configure self-repair thresholds.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `enabled` | boolean | no | Enable/disable engine |
| `toolTimeout` | number | no | Tool timeout (ms) |
| `noProgress` | number | no | Idle timeout (ms) |
| `loopDetection` | number | no | Consecutive identical calls threshold |
| `contextPressure` | number | no | Context usage ratio (0–1) |
| `consecutiveErrors` | number | no | Error count threshold |
| `costRunaway` | number | no | Per-turn cost threshold ($) |

**Permission**: `approve`

---

## Filesystem Mount Tools

**File**: `web/clawser-mount.js`

### mount_list

List all mounted local directories and their status.

**Permission**: `read`

### mount_resolve

Check whether a path resolves to a local mount or OPFS.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Path to resolve |

**Permission**: `read`

---

## Daemon Mode Tools

**File**: `web/clawser-daemon.js`

### daemon_status

Show daemon mode status, tab coordination, and checkpoint info.

**Permission**: `read`

### daemon_checkpoint

Create a checkpoint of current agent state.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reason` | string | no | Checkpoint reason |

**Permission**: `approve`

---

## Intent Classification Tools

**File**: `web/clawser-intent.js`

### intent_classify

Classify a message into an intent and return pipeline config.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | yes | Message to classify |
| `source` | string | no | Source metadata |

**Permission**: `read`
**Notes**: Returns `{ intent, config }` where config includes `useLLM`, `useTools`, `useMemory`, `modelHint`, `maxTokens`.

### intent_add_override

Add a prefix override for intent routing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prefix` | string | yes | Prefix string (e.g. "!task:") |
| `intent` | enum | yes | command, query, task, chat, system |

**Permission**: `approve`

---

## Remote Access Tools

**File**: `web/clawser-remote.js`

### remote_status

Show remote access status and active sessions.

**Permission**: `read`

### remote_pair

Generate a 6-digit pairing code for remote access. Code expires in 5 minutes.

**Permission**: `approve`

### remote_revoke

Revoke remote access sessions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `all` | boolean | no | Revoke all sessions |

**Permission**: `approve`

---

## OAuth Tools

**File**: `web/clawser-oauth.js`

### oauth_list

List connected OAuth apps and available providers.

**Permission**: `read`
**Notes**: Supported providers: google, github, notion, slack, linear.

### oauth_connect

Start an OAuth authentication flow.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | string | yes | Provider name |
| `scopes` | array | no | OAuth scopes |

**Permission**: `approve`

### oauth_disconnect

Disconnect from an OAuth provider.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | string | yes | Provider name |

**Permission**: `approve`

### oauth_api

Make an API call to a connected OAuth provider.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | string | yes | Provider name |
| `path` | string | yes | API path |
| `method` | string | no | HTTP method |
| `body` | string | no | JSON body |

**Permission**: `approve`

---

## Auth Profile Tools

**File**: `web/clawser-auth-profiles.js`

### auth_list_profiles

List all auth profiles with active indicators.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | string | no | Filter by provider |

**Permission**: `read`

### auth_switch_profile

Switch the active auth profile for a provider.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | string | yes | Provider name |
| `profile_id` | string | yes | Profile ID |

**Permission**: `approve`

### auth_status

Show current active auth profiles.

**Permission**: `read`

---

## Sandbox Tools

**File**: `web/clawser-sandbox.js`

### sandbox_run

Run code in a sandboxed environment.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sandbox` | string | yes | Sandbox name |
| `code` | string | yes | Code to execute |
| `args` | object | no | Arguments |

**Permission**: `approve`

### sandbox_status

Show active sandboxes and their status (tier, exec count, capabilities).

**Permission**: `read`

---

## Shell Tool

**File**: `web/clawser-shell.js`

### shell

Execute commands in the virtual browser shell.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | yes | Shell command string |

**Permission**: `internal`
**Notes**: Supports pipes, redirects, logical operators, variable substitution, and glob expansion. 59 built-in commands including `ls`, `cat`, `grep`, `find`, `sed`, `sort`, `diff`, `base64`, `sha256sum`, `xargs`, and more. All filesystem operations use workspace OPFS.

---

## MCP Tools (Dynamic)

**File**: `web/clawser-mcp.js`

MCP tools are dynamically registered from connected MCP servers. Each tool is prefixed with `mcp_` and has permission `network`. Parameters are passed through from the MCP server's `inputSchema`. Uses Streamable HTTP transport (2025 spec) with JSON-RPC.

---

## Codex (Code Execution Engine)

**File**: `web/clawser-codex.js`

Not a tool itself — Codex is the code execution engine for non-native-tool providers. When a model writes fenced code blocks, Codex extracts them, applies Python-to-JS adaptation, auto-inserts missing `await` keywords, and executes via vimble sandbox. All registered tools are exposed as async functions by full name and camelCase alias (e.g. `browser_fs_read` → `fsRead`).

---

## Summary

| Category | File | Count |
|----------|------|-------|
| Core browser | clawser-tools.js | 19 + 8 agent |
| Browser automation | clawser-browser-auto.js | 8 |
| Git | clawser-git.js | 6 |
| Channels | clawser-channels.js | 3 |
| Hardware | clawser-hardware.js | 6 |
| Skills | clawser-skills.js | 7 |
| Tool builder | clawser-tool-builder.js | 5 |
| Enhanced goals | clawser-goals.js | 4 |
| Routines | clawser-routines.js | 4 |
| Undo | clawser-undo.js | 2 |
| Heartbeat | clawser-heartbeat.js | 2 |
| wsh | clawser-wsh-tools.js | 10 |
| Delegation | clawser-delegate.js | 1 |
| Self-repair | clawser-self-repair.js | 2 |
| Mount | clawser-mount.js | 2 |
| Daemon | clawser-daemon.js | 2 |
| Intent | clawser-intent.js | 2 |
| Remote | clawser-remote.js | 3 |
| OAuth | clawser-oauth.js | 4 |
| Auth profiles | clawser-auth-profiles.js | 3 |
| Sandbox | clawser-sandbox.js | 2 |
| Shell | clawser-shell.js | 1 (wraps 59 commands) |
| MCP | clawser-mcp.js | dynamic |
| **Total** | | **~100 named tools** |
