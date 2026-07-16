# Clawser Tool Reference

Reference for the ~210 tools cataloged here (see "Known gaps" in the Summary section for additional registered-but-uncataloged tool families — the real app-wide total is closer to ~285). Tools extend `BrowserTool` and are managed by `BrowserToolRegistry` in `clawser-tools.js`.

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
**Notes**: For `setHTML`/`insertHTML`, uses the native Sanitizer API (`el.setHTML`) when available; otherwise strips `<script>`, `<iframe>`, `<object>`, `<embed>`, `<base>`, `<meta>`, `<link>`, `<form>`, `<svg>`, `<math>`, `<style>` elements, removes all `on*` event-handler attributes, and strips `javascript:`/`data:` URLs from `href`/`src`/`action`/`formaction`. For `setAttribute`, blocks setting any `on*` attribute outright and blocks `javascript:`/`data:` values in `href`/`src`/`action`/`formaction`.

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
**Notes**: Max file size configurable (default 10MB). Blocks the write if storage usage is at or above the 95% (critical) threshold via `checkQuota()`. (An 80% "warning" threshold also exists in `checkQuota()` but is only surfaced in the Tools/storage settings panel UI — this tool itself does not act on it.)

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

### browser_fs_mkdir

Create a directory in OPFS. Intermediate directories are created automatically.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Directory path to create |

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

### browser_storage_delete

Delete a key from localStorage.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | yes | Storage key to delete |

**Permission**: `write`
**Notes**: Blocks deleting `clawser_*` keys.

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

### browser_ask_user

Ask the user one or more questions with predefined options. (Registered tool name is `browser_ask_user`, not `ask_user_question`.)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `questions` | array | yes | Array of question objects |

Each question: `{ question, header (max 12 chars), options: [{ label, description }], multiSelect }`. Max 4 questions, 2–4 options each.

**Permission**: `auto`

### agent_switch

Switch to a different agent configuration. Omit `agent` to list available agents. (Registered tool name is `agent_switch`, not `switch_agent`.)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | string | no | Agent name or ID to switch to |
| `reason` | string | no | Reason for switch |

**Permission**: `approve`

### agent_consult

Send a message to another agent and get their response. (Registered tool name is `agent_consult`, not `consult_agent`.)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | string | yes | Agent name |
| `message` | string | yes | Message to send |

**Permission**: `approve`

---

## Agent Tools

**File**: `web/clawser-tools.js` (registered via `registerAgentTools()`)

All have permission `internal` (auto-allowed). (Note: goal management is *not* handled here — there is no `agent_goal_add`/`agent_goal_update` tool. Goals are handled entirely by the separate `goal_add`/`goal_update`/etc. tools registered from `web/clawser-goals.js`; see "Enhanced Goal Tools" below.)

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

### skill_activate

Activate an available skill to get its instructions and tools.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Skill name |
| `arguments` | string | no | Arguments to pass |
| `force` | boolean | no | Skip dependency checks (default: false) |

**Permission**: `internal`

### skill_deactivate

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

Supports hierarchy, priority, artifacts, and progress tracking. (Note: there is no separate, simpler `agent_goal_add`/`agent_goal_update` tool set — these `goal_*` tools are the only goal-management tools in the app; see the note in "Agent Tools" above.)

### goal_add

Add a goal with optional parent and priority.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `description` | string | yes | — | Goal description |
| `parent_id` | string | no | — | Parent goal ID (for sub-goals) |
| `priority` | enum | no | medium | low, medium, high, critical |

**Permission**: `approve`

### goal_update

Update goal status with optional progress note.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `goal_id` | string | yes | Goal ID |
| `status` | enum | yes | active, paused, completed, failed |
| `progress_note` | string | no | Progress note |

**Permission**: `approve`

### goal_add_artifact

Link a workspace file as a goal artifact.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `goal_id` | string | yes | Goal ID |
| `file_path` | string | yes | Path to file |

**Permission**: `approve`

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

### routine_history

Get execution history for a routine.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `id` | string | yes | — | Routine ID |
| `limit` | number | no | 20 | Max entries to return |

**Permission**: `read`

### routine_toggle

Enable or disable a routine.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `routine_id` | string | yes | Routine ID to toggle |
| `enabled` | boolean | yes | Whether to enable (true) or disable (false) |

**Permission**: `approve`
**Notes**: Uses `routine_id` as the parameter name (inconsistent with the other routine tools, which use `id`).

### routine_update

Update a routine's configuration (name, trigger, action).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `routine_id` | string | yes | Routine ID to update |
| `name` | string | no | New routine name |
| `trigger` | object | no | New trigger configuration |
| `action` | object | no | New action configuration |

**Permission**: `approve`

---

## Undo Tools

**File**: `web/clawser-undo.js`

### agent_undo

Undo the last N turns. Reverts conversation, files, memory, and goals. (Registered tool name is `agent_undo`, not `undo`.)

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `turns` | number | no | 1 | Number of turns to undo |

**Permission**: `approve`

### agent_undo_status

Show undo history and preview what would be reverted. (Registered tool name is `agent_undo_status`, not `undo_status`.)

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `preview_turns` | number | no | 1 | Turns to preview |

**Permission**: `read`

### agent_redo

Redo previously undone operations.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `turns` | number | no | 1 | Number of turns to redo |

**Permission**: `approve`

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

`registerWshTools()` registers **27 tools** (not 10 — this section previously covered only a subset).

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

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `local_path` | string | yes (upload) | Local (OPFS) path |
| `remote_path` | string | yes | Remote path |
| `host` | string | no | Server host |

**Permission**: `approve`

### wsh_pty_open / wsh_pty_write

Open and interact with a remote PTY session.

`wsh_pty_open`: `host`, `command`, `cols` (default 80), `rows` (default 24) — all optional.
`wsh_pty_write`: `session_id` (string, required), `data` (string, required).

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

### wsh_file_op

Perform structured file operations on a remote wsh host (stat, list, read, write, mkdir, remove, rename).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `op` | string | yes | Operation: stat, list, read, write, mkdir, remove, rename |
| `path` | string | yes | Remote path |
| `offset` | number | no | Byte offset (for partial read/write) |
| `length` | number | no | Byte length (for partial read/write) |
| `host` | string | no | Server host |

**Permission**: `approve`

### wsh_policy_eval

Evaluate a policy action on a connected wsh server.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | yes | Action to evaluate |
| `principal` | string | yes | Principal to evaluate against |
| `context` | object | no | Extra evaluation context |
| `host` | string | no | Server host |

**Permission**: `read`

### wsh_policy_update

Update a policy on a connected wsh server.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `policy_id` | string | yes | Policy ID |
| `rules` | object | yes | New policy rules |
| `version` | number | yes | Policy version |
| `host` | string | no | Server host |

**Permission**: `approve`

### wsh_gpu_probe

Probe a remote host for GPU capabilities (runs `nvidia-smi`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `host` | string | yes | Remote host to probe |

**Permission**: `read`

### wsh_suspend_session

Suspend a remote wsh session.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `session_id` | string | yes | — | Session ID |
| `action` | string | no | suspend | suspend or hibernate |
| `host` | string | no | — | Server host |

**Permission**: `approve`

### wsh_restart_pty

Restart the PTY process in a remote wsh session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Session ID |
| `command` | string | no | New command to run |
| `host` | string | no | Server host |

**Permission**: `approve`

### wsh_metrics

Request server metrics (CPU, memory, sessions) from a connected wsh host.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `host` | string | no | Server host |

**Permission**: `read`

### wsh_guest_invite

Invite a guest to a wsh session with time-limited access.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `session_id` | string | yes | — | Session ID |
| `ttl` | number | yes | — | TTL in seconds |
| `permissions` | array | no | `['read']` | read/write/control |
| `host` | string | no | — | Server host |

**Permission**: `approve`

### wsh_guest_revoke

Revoke a guest invitation token.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token` | string | yes | Guest token to revoke |
| `reason` | string | no | Revocation reason |
| `host` | string | no | Server host |

**Permission**: `approve`

### wsh_share_session

Share a wsh session for multi-attach access.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `session_id` | string | yes | — | Session ID |
| `mode` | string | no | read | read or control |
| `ttl` | number | no | — | TTL in seconds |
| `host` | string | no | — | Server host |

**Permission**: `approve`

### wsh_share_revoke

Revoke a session share.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `share_id` | string | yes | Share ID to revoke |
| `reason` | string | no | Revocation reason |
| `host` | string | no | Server host |

**Permission**: `approve`

### wsh_compress

Negotiate compression with a connected wsh server.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `algorithm` | string | yes | — | Compression algorithm |
| `level` | number | no | 3 | Compression level |
| `host` | string | no | — | Server host |

**Permission**: `approve`

### wsh_rate_control

Set rate control parameters for a wsh session.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `session_id` | string | yes | — | Session ID |
| `max_bytes_per_sec` | number | yes | — | Byte-rate cap |
| `policy` | string | no | pause | pause or drop |
| `host` | string | no | — | Server host |

**Permission**: `approve`

### wsh_link_session

Link a wsh session to another host for cross-session routing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source_session` | string | yes | Source session ID |
| `target_host` | string | yes | Target host |
| `target_port` | number | yes | Target port |
| `target_user` | string | no | Target user |
| `host` | string | no | Server host |

**Permission**: `approve`

### wsh_unlink_session

Unlink a previously linked wsh session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `link_id` | string | yes | Link ID to remove |
| `reason` | string | no | Reason |
| `host` | string | no | Server host |

**Permission**: `approve`

### wsh_copilot_attach

Attach an AI copilot to a wsh session for suggestions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Session ID |
| `model` | string | yes | Copilot model to use |
| `context_window` | number | no | Context window size |
| `host` | string | no | Server host |

**Permission**: `approve`

### wsh_copilot_detach

Detach the copilot from a wsh session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Session ID |
| `reason` | string | no | Reason |
| `host` | string | no | Server host |

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
**Notes**: Returns `{ intent, config }` where config includes `useLLM`, `useTools`, `useMemory`, `useGoals`, `skipUI`, `modelHint`, `maxTokens`.

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
**Notes**: Supports pipes, redirects, logical operators, variable substitution, and glob expansion. 67 built-in commands (29 from `registerBuiltins()` + 37 from `registerExtendedBuiltins()` + `jq` from `registerJqBuiltin()`, all wired up by default) including `ls`, `cat`, `grep`, `find`, `sed`, `sort`, `diff`, `base64`, `sha256sum`, `xargs`, and more. All filesystem operations use workspace OPFS.

---

## Mesh Stream & File Tools

**File**: `web/clawser-mesh-tools.js`

Mesh stream and file transfer tools for P2P data exchange, plus DHT, distributed GPU training, and IoT device tools. Registered via `registerMeshTools()` — **15 tools total** (not 7 — this section previously covered only the stream/file subset).

### mesh_stream_open

Open a multiplexed data stream to a peer.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `peerId` | string | yes | — | Target peer identity |
| `method` | string | yes | — | Stream purpose (e.g., "chat", "storage/upload") |
| `ordered` | boolean | no | true | Whether delivery must be ordered |
| `encrypted` | boolean | no | false | Whether to use per-stream encryption |

**Permission**: `network`

### mesh_stream_close

Close an open data stream by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `streamId` | string | yes | Hex stream ID to close |

**Permission**: `network`

### mesh_stream_list

List active mesh streams, optionally filtered by peer.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `peerId` | string | no | Filter by peer identity |

**Permission**: `read`

### mesh_file_send

Send files to a peer. Creates a transfer offer with file metadata.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `peerId` | string | yes | Recipient peer identity |
| `files` | array | yes | Files to send: `[{ name, size, mimeType? }]` |

**Permission**: `approve`

### mesh_file_accept

Accept an incoming file transfer offer.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `transferId` | string | yes | Transfer ID from the incoming offer |

**Permission**: `approve`

### mesh_file_list

List file transfers, optionally filtered by status or peer.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | no | Filter: offered, accepted, transferring, completed, failed, cancelled |
| `peerId` | string | no | Filter by peer identity |

**Permission**: `read`

### mesh_file_cancel

Cancel an in-progress file transfer.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `transferId` | string | yes | Transfer ID to cancel |
| `reason` | string | no | Cancellation reason |

**Permission**: `write`

### dht_store

Store a key-value pair in the distributed hash table.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | yes | DHT key |
| `value` | string | yes | Value to store |
| `ttl` | number | no | Time-to-live in ms |

**Permission**: `network`

### dht_lookup

Look up a value by key in the DHT.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | yes | DHT key to look up |

**Permission**: `read`

### dht_peers

List peers in the DHT routing table.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `count` | number | no | 20 | Max peers to return |

**Permission**: `read`

### gpu_train_start

Start a distributed GPU training job across mesh peers.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `jobId` | string | yes | — | Job identifier |
| `modelConfig` | object | yes | — | Model configuration |
| `datasetRef` | string | yes | — | Dataset reference |
| `epochs` | number | no | 1 | Training epochs |
| `batchSize` | number | no | 32 | Batch size |
| `learningRate` | number | no | 0.001 | Learning rate |
| `strategy` | string | no | — | sync_allreduce, async_parameter_server, federated_avg |
| `shardCount` | number | no | 1 | Number of shards |

**Permission**: `approve`

### gpu_train_status

Check the status of a distributed GPU training job.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `jobId` | string | yes | Job identifier |

**Permission**: `read`

### iot_list

List registered IoT devices, optionally filtered by protocol or capability.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `protocol` | string | no | mqtt, http, direct, coap |
| `capability` | string | no | read, write, stream, command |

**Permission**: `read`

### iot_send

Send a command or payload to an IoT device.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `deviceId` | string | yes | Target device ID |
| `payload` | object | yes | Command/payload to send |

**Permission**: `approve`

### iot_telemetry

Query telemetry data from an IoT device.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `deviceId` | string | yes | — | Device ID |
| `since` | number | no | — | Start timestamp |
| `until` | number | no | — | End timestamp |
| `stats` | boolean | no | false | Return aggregate stats instead of raw readings |

**Permission**: `read`

---

## Mesh Identity Tools

**File**: `web/clawser-mesh-identity-tools.js`

Identity management tools for the mesh cryptographic layer. Registered via `registerIdentityTools()`.

### identity_create

Create a new Ed25519 mesh identity with an optional label.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `label` | string | no | Human-readable name for the identity |

**Permission**: `approve`

### identity_list

List all mesh identities with their pod IDs, labels, and active status.

**Permission**: `read`

### identity_switch

Switch the active mesh identity to a different pod ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `podId` | string | yes | Pod ID of the identity to activate |

**Permission**: `write`

### identity_export

Export an identity as a JWK (optionally encrypted with a passphrase).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `podId` | string | yes | Pod ID to export |
| `passphrase` | string | no | Optional passphrase for encryption |

**Permission**: `approve`

### identity_import

Import an identity from a JWK private key.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `keyData` | object | yes | JWK private key object |
| `label` | string | no | Human-readable label |

**Permission**: `approve`

### identity_delete

Delete a mesh identity by pod ID. Cannot delete the last remaining identity.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `podId` | string | yes | Pod ID to delete |

**Permission**: `approve`

### identity_link

Create a signed link between two identities (parent endorses child).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `parentPodId` | string | yes | Parent identity pod ID |
| `childPodId` | string | yes | Child identity pod ID |
| `relation` | string | yes | Relation type: device, delegate, org, alias, recovery |

**Permission**: `approve`

### identity_select_rule

Set a rule to use a specific identity when connecting to a peer.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `peerId` | string | yes | Peer ID to set the rule for |
| `podId` | string | yes | Pod ID of the identity to use |

**Permission**: `write`

---

## Server Tools

**File**: `web/clawser-server-tools.js`

Tools for managing virtual HTTP servers (function/static/proxy handlers served through a Service Worker intercept). Registered via `registerServerTools()`. This entire file was previously undocumented.

### server_list

List all registered virtual servers (global + workspace).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scope` | string | no | Filter by scope: `_global` or a workspace ID. Omit for all. |

**Permission**: `read`

### server_add

Register a new virtual server route.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hostname` | string | yes | Virtual hostname (e.g. `myapp.internal`) |
| `type` | enum | yes | function, static, proxy, skill |
| `port` | number | no | Port number (default: 80) |
| `execution` | enum | no | page, sw (default: page) |
| `code` | string | no | Inline handler code (function type) |
| `staticRoot` | string | no | OPFS path to serve (static type) |
| `proxyTarget` | string | no | Target URL (proxy type) |
| `proxyRewrite` | string | no | Path rewrite rule "pattern -> replacement" (proxy type) |
| `env` | object | no | Environment variables |
| `scope` | string | no | `_global` or workspace ID (defaults to current workspace) |

**Permission**: `approve`

### server_remove

Remove a registered virtual server by its route ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Route ID to remove |

**Permission**: `approve`

### server_update

Update a virtual server's configuration (handler code, env vars, enabled state).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Route ID to update |
| `code` | string | no | New handler code (function type only) |
| `env` | object | no | Environment variables to merge |
| `enabled` | boolean | no | Enable/disable the server |
| `proxyTarget` | string | no | New proxy target URL |
| `staticRoot` | string | no | New OPFS path for static serving |

**Permission**: `approve`

### server_start / server_stop

Enable/start or disable/stop a virtual server.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Route ID |

**Permission**: `approve`

### server_logs

Read request/response logs for a virtual server.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `id` | string | yes | — | Route ID to read logs for |
| `limit` | number | no | 20 | Max entries to return |

**Permission**: `read`

### server_test

Send a test HTTP request to a virtual server and return the response (routes through the SW intercept).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `hostname` | string | yes | — | Target hostname |
| `port` | number | no | 80 | Target port |
| `path` | string | no | / | Request path |
| `method` | string | no | GET | HTTP method |
| `headers` | object | no | — | Request headers |
| `body` | string | no | — | Request body |

**Permission**: `approve`

---

## Chrome AI Tools

**File**: `web/clawser-chrome-ai-tools.js`

Wraps Chrome 138+ on-device Writer/Rewriter/Summarizer APIs (`self.ai.*` fallback for older Chrome). Registered via `registerChromeAITools()`, called directly from `clawser-app.js`. This entire file was previously undocumented.

### chrome_ai_write

Generate text using Chrome's on-device Writer API.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | yes | Writing prompt describing what to generate |
| `tone` | enum | no | formal, neutral (default), casual |
| `format` | enum | no | plain-text, markdown (default) |
| `length` | enum | no | short, medium (default), long |
| `sharedContext` | string | no | Shared context for the writing session |
| `context` | string | no | Per-call context for this specific write |

**Permission**: `auto`

### chrome_ai_rewrite

Rewrite text using Chrome's on-device Rewriter API.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | yes | The text to rewrite |
| `tone` | enum | no | as-is (default), more-formal, more-casual |
| `format` | enum | no | as-is (default), plain-text, markdown |
| `length` | enum | no | as-is (default), shorter, longer |
| `context` | string | no | Context to guide the rewriting |

**Permission**: `auto`

### chrome_ai_summarize

Summarize text using Chrome's on-device Summarizer API.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | yes | The text to summarize |
| `type` | enum | no | key-points (default), tldr, teaser, headline |
| `format` | enum | no | plain-text, markdown (default) |
| `length` | enum | no | short, medium (default), long |
| `context` | string | no | Context to guide summarization |

**Permission**: `auto`

**Notes**: All three tools throw (returning `success: false`) if the relevant Chrome AI API is unavailable on-device. These are on-device model capabilities, not LLM provider calls.

---

## Google Integration Tools

**File**: `web/clawser-google-tools.js`

Calendar/Gmail/Drive tools that call the Google APIs via `OAuthManager` (see OAuth Tools). Registered directly in `registerAllTools()`. This entire file was previously undocumented.

**Caveat**: unlike other `BrowserTool` subclasses in this codebase, these classes extend a local `GoogleToolBase` that does *not* extend `BrowserTool` and has no `get permission()` override. `BrowserToolRegistry.getPermission()` falls back to `approve` for any tool whose `permission` isn't `internal`/`read`, so these tools behave as `approve` in practice, but this isn't an explicit declaration in source the way it is for other tools.

### google_calendar_list

List upcoming events from a Google Calendar.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `calendar_id` | string | no | primary | Calendar ID |
| `max_results` | number | no | 10 | Max events to return |
| `time_min` | string | no | now | Start time (ISO 8601) |

**Permission**: `approve` (default fallback — see caveat above)

### google_calendar_create

Create a new event on Google Calendar.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `summary` | string | yes | — | Event title |
| `start` | string | yes | — | Start time (ISO 8601) |
| `end` | string | yes | — | End time (ISO 8601) |
| `description` | string | no | — | Event description |
| `location` | string | no | — | Event location |
| `calendar_id` | string | no | primary | Calendar ID |

**Permission**: `approve` (default fallback)

### google_gmail_search

Search Gmail messages using Gmail query syntax.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | — | Gmail search query (e.g. `from:boss subject:urgent`) |
| `max_results` | number | no | 10 | Max messages to return |

**Permission**: `approve` (default fallback)

### google_gmail_send

Send an email via Gmail.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string | yes | Recipient email address |
| `subject` | string | yes | Email subject |
| `body` | string | yes | Email body (plain text) |
| `cc` | string | no | CC recipients (comma-separated) |
| `bcc` | string | no | BCC recipients (comma-separated) |

**Permission**: `approve` (default fallback)

### google_drive_list

List files in Google Drive.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | no | — | Drive search query |
| `max_results` | number | no | 20 | Max files to return |
| `folder_id` | string | no | — | Folder ID to list |

**Permission**: `approve` (default fallback)

### google_drive_read

Read metadata of a Google Drive file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_id` | string | yes | Google Drive file ID |

**Permission**: `approve` (default fallback)

### google_drive_create

Create a new file in Google Drive (metadata-only; does not upload file content).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | yes | — | File name |
| `content` | string | no | — | File content (accepted but not actually uploaded — see Notes) |
| `mime_type` | string | no | text/plain | MIME type |
| `folder_id` | string | no | — | Parent folder ID |

**Permission**: `approve` (default fallback)
**Notes**: Source comment states this uses "metadata-only upload"; the `content` parameter is currently not sent to the Drive API.

---

## Linear Integration Tools

**File**: `web/clawser-linear-tools.js`

Tools that call the Linear GraphQL API (`https://api.linear.app/graphql`) via `OAuthManager`. Registered directly in `registerAllTools()`. This entire file was previously undocumented. Same caveat as Google Integration Tools above: classes extend a local `LinearToolBase` that doesn't extend `BrowserTool`, so permission resolves to `approve` via the registry's default fallback rather than an explicit declaration.

### linear_issues

List or search Linear issues with optional filters.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `team_id` | string | no | — | Filter by team ID |
| `state_name` | string | no | — | Filter by state name (e.g. "In Progress") |
| `assignee_id` | string | no | — | Filter by assignee user ID |
| `first` | number | no | 20 | Max issues to return |
| `query` | string | no | — | Search query string |

**Permission**: `approve` (default fallback)

### linear_create_issue

Create a new issue in Linear.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | yes | Issue title |
| `team_id` | string | yes | Team ID to create the issue in |
| `description` | string | no | Issue description (Markdown) |
| `priority` | number | no | 0=none, 1=urgent, 2=high, 3=medium, 4=low |
| `assignee_id` | string | no | Assignee user ID |
| `label_ids` | array | no | Label IDs to attach |

**Permission**: `approve` (default fallback)

### linear_update_issue

Update an existing Linear issue.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `issue_id` | string | yes | Issue ID to update |
| `title` | string | no | New title |
| `description` | string | no | New description |
| `state_name` | string | no | New state name (e.g. "Done") |
| `priority` | number | no | New priority level |
| `assignee_id` | string | no | New assignee user ID |

**Permission**: `approve` (default fallback)

---

## Chrome Extension Bridge Tools

**File**: `web/clawser-extension-tools.js`

**37 tools** (`ext_*`) that proxy actions through the companion Clawser Chrome Extension via an RPC bridge, for controlling the user's real Chrome tabs (as opposed to the automated/headless sessions of the Browser Automation Tools). Registered via `registerExtensionTools()`, called directly from `clawser-workspace-init-tools.js`. This entire file was previously undocumented. All calls fail gracefully with `success: false` if the extension isn't connected, and check a required `capability` (e.g. `tabs`, `scripting`, `cookies`, `network`) before calling through.

| Category | Count | Tools |
|----------|-------|-------|
| Status & info | 2 | `ext_status` (read), `ext_capabilities` (read) |
| Tabs | 5 | `ext_tabs_list` (read), `ext_tab_open` (approve), `ext_tab_close`, `ext_tab_activate`, `ext_tab_reload` |
| Navigation | 3 | `ext_navigate`, `ext_go_back`, `ext_go_forward` |
| Screenshots & window | 3 | `ext_screenshot`, `ext_resize`, `ext_zoom` |
| DOM | 4 | `ext_read_page`, `ext_find`, `ext_get_text`, `ext_get_html` |
| Input | 9 | `ext_click`, `ext_double_click`, `ext_triple_click`, `ext_right_click`, `ext_hover`, `ext_drag`, `ext_scroll`, `ext_type`, `ext_key` |
| Form | 2 | `ext_form_input`, `ext_select_option` |
| Monitoring | 2 | `ext_console`, `ext_network` |
| Execution | 2 | `ext_evaluate`, `ext_wait` |
| Cookies | 1 | `ext_cookies` |
| WebMCP | 1 | `ext_webmcp_discover` |
| Tab watch | 3 | `ext_watch_tab`, `ext_watch_poll`, `ext_watch_stop` |

**Permission**: mostly `read` for list/query-style tools (`ext_status`, `ext_capabilities`, `ext_tabs_list`) and `approve` for anything that acts on a tab (open/close/navigate/click/type/etc.) — see individual tool classes in source for exact per-tool values.
**Notes**: Tool output is capped at 100,000 characters (truncated with a notice beyond that). Screenshots taken via the extension bridge (`createExtensionBridge()`) are written to OPFS at `clawser_screenshots/` rather than returned inline, to avoid context overflow.

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
| Core browser | clawser-tools.js | 23 + 6 agent |
| Browser automation | clawser-browser-auto.js | 8 |
| Git | clawser-git.js | 6 |
| Channels | clawser-channels.js | 3 |
| Hardware | clawser-hardware.js | 6 |
| Skills | clawser-skills.js | 7 |
| Tool builder | clawser-tool-builder.js | 5 |
| Enhanced goals | clawser-goals.js | 4 |
| Routines | clawser-routines.js | 7 |
| Undo | clawser-undo.js | 3 |
| Heartbeat | clawser-heartbeat.js | 2 |
| wsh | clawser-wsh-tools.js | 27 |
| Delegation | clawser-delegate.js | 1 |
| Self-repair | clawser-self-repair.js | 2 |
| Mount | clawser-mount.js | 2 |
| Daemon | clawser-daemon.js | 2 |
| Intent | clawser-intent.js | 2 |
| Remote | clawser-remote.js | 3 |
| OAuth | clawser-oauth.js | 4 |
| Auth profiles | clawser-auth-profiles.js | 3 |
| Sandbox | clawser-sandbox.js | 2 |
| Shell | clawser-shell.js | 1 (wraps 67 commands) |
| Mesh streams/files/DHT/GPU/IoT | clawser-mesh-tools.js | 15 |
| Mesh identity | clawser-mesh-identity-tools.js | 8 |
| Server | clawser-server-tools.js | 8 |
| Chrome AI | clawser-chrome-ai-tools.js | 3 |
| Google integration | clawser-google-tools.js | 7 |
| Linear integration | clawser-linear-tools.js | 3 |
| Chrome extension bridge | clawser-extension-tools.js | 37 |
| MCP | clawser-mcp.js | dynamic |
| **Total (cataloged above)** | | **~210 named tools** |

**Known gaps — registered but not yet cataloged in this file** (found during a source audit; add sections for these if/when this doc is next revised):

| File | Approx. tool count |
|------|---------------------|
| clawser-model-tools.js (model_list/pull/remove/status, transcribe, speak, caption, ocr, detect_objects, classify_image, classify_text) | 11 |
| clawser-netway-tools.js (netway_connect/listen/send/read/close/resolve/status/udp_send) | 8 |
| clawser-notion-tools.js | 4 |
| clawser-slack-tools.js | 3 |
| clawser-integration-github.js (PR review, issue create, code search) | 3 |
| clawser-integration-calendar.js | 3 |
| clawser-integration-email.js | 3 |
| clawser-integration-slack.js (monitor/draft-response) | 2 |
| clawser-cors-fetch.js (`ext_cors_fetch`) | 1 |
| clawser-mesh-peer-tools.js (chat, scheduler, federated compute, swarms, escrow, router, ACL, gateway, torrent/IPFS, credits, migration/delta-sync) | ~29 |
| clawser-mesh-orchestrator.js (`meshctl_*` builtins) | 8 |
| clawser-mesh-devtools.js (`MeshInspectTool`, conditionally registered) | 1 |

Including these gaps, the real total is closer to **~285 registered tools app-wide** — the "~100 tools" figure in this file's introduction and in the top-level `CLAUDE.md` is significantly stale and should be treated as a rough historical figure, not a current count.
