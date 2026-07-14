# Tools

Complete reference for ALL registered tools (285+)

## network

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `fetch` | HTTP/HTTPS requests with configurable domain allowlist. Returns status, headers, and body text (truncated at 50K chars). | `network` | ✅ Implemented |
| `web_search` | Search the web using DuckDuckGo HTML lite endpoint. No API key required. | `network` | ✅ Implemented |

## dom

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `dom_query` | Query DOM elements using CSS selectors. Returns text content, attributes, and structure. | `browser` | ✅ Implemented |
| `dom_modify` | Modify DOM elements — setText, setHTML, setAttribute, setStyle, addClass, removeClass, remove, insertHTML. Sanitizes HTML to block scripts, iframes, and event handlers. | `browser` | ✅ Implemented |

## filesystem

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `fs_read` | Read a file from the Origin Private File System (OPFS). Max read size 50MB. | `read` | ✅ Implemented |
| `fs_write` | Write a file to OPFS. Creates parent directories as needed. Max 10MB default. | `write` | ✅ Implemented |
| `fs_list` | List files and directories in OPFS. | `read` | ✅ Implemented |
| `fs_delete` | Delete a file or directory from OPFS with optional recursive flag. | `write` | ✅ Implemented |
| `fs_mkdir` | Create a directory in OPFS. Creates parent directories as needed. | `write` | ✅ Implemented |

## storage

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `storage_get` | Read a value from localStorage by key. Blocks access to clawser_* internal keys. | `read` | ✅ Implemented |
| `storage_set` | Write a value to localStorage. Blocks writing to clawser_* internal keys. | `write` | ✅ Implemented |
| `storage_delete` | Delete a localStorage key. Blocks deletion of clawser_* internal keys. | `write` | ✅ Implemented |
| `storage_list` | List all keys in localStorage with value lengths. Hides clawser_* internal keys. | `read` | ✅ Implemented |

## clipboard

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `clipboard_read` | Read text from the system clipboard. | `browser` | ✅ Implemented |
| `clipboard_write` | Write text to the system clipboard. | `browser` | ✅ Implemented |

## navigation

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `navigate` | Open a URL in a new browser tab or the current page. Only allows http/https protocols. | `browser` | ✅ Implemented |
| `notify` | Show a browser notification with title, body, and optional icon. | `browser` | ✅ Implemented |

## code

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `eval_js` | Evaluate JavaScript in the page global scope via indirect eval. Requires explicit user confirmation. | `approve` | ✅ Implemented |

## media

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `screenshot` | Capture a screenshot as a data URL (PNG). Lazy-loads html2canvas from CDN. | `browser` | ✅ Implemented |
| `screen_info` | Get current page info — URL, title, viewport size, scroll position, and visible text summary. | `read` | ✅ Implemented |

## memory

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `memory_store` | Store a memory for later recall. Categories — core, learned, user, context. | `internal` | ✅ Implemented |
| `memory_recall` | Search stored memories by keyword query. Returns top results via hybrid BM25 + vector search. | `internal` | ✅ Implemented |
| `memory_forget` | Delete a stored memory by ID. | `internal` | ✅ Implemented |

## goals

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `goal_add` | Add a new goal with optional parent and priority. | `approve` | ✅ Implemented |
| `goal_update` | Update goal status — active, paused, completed, or failed. | `approve` | ✅ Implemented |
| `goal_list` | List all goals with optional status and priority filters. | `read` | ✅ Implemented |
| `goal_remove` | Remove a goal by ID. | `approve` | ✅ Implemented |
| `goal_decompose` | Break a goal into sub-goals from a list of subtask descriptions. | `approve` | ✅ Implemented |
| `goal_add_artifact` | Attach a file path artifact to a goal. | `approve` | ✅ Implemented |
| `goal_remove_artifact` | Remove a file path artifact from a goal. | `approve` | ✅ Implemented |

## scheduler

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `schedule_add` | Add a scheduled job — once, interval, or cron expression. | `internal` | ✅ Implemented |
| `schedule_list` | List all scheduled jobs with status and next-fire time. | `internal` | ✅ Implemented |
| `schedule_remove` | Remove a scheduled job by ID. | `internal` | ✅ Implemented |

## skills

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `activate_skill` | Activate an installed skill by name with optional arguments. | `approve` | ✅ Implemented |
| `deactivate_skill` | Deactivate a currently active skill. | `internal` | ✅ Implemented |
| `skill_search` | Search the remote skill registry for skills matching a query. | `network` | ✅ Implemented |
| `skill_install` | Install a skill from the remote registry by name/version. | `network` | ✅ Implemented |
| `skill_update` | Update an installed skill to the latest registry version. | `network` | ✅ Implemented |
| `skill_remove` | Uninstall a skill from the workspace. | `write` | ✅ Implemented |
| `skill_list` | List all installed skills with activation status. | `read` | ✅ Implemented |

## agent

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `ask_user_question` | Ask the user one or more questions with predefined options. Max 4 questions, 2-4 options each. | `auto` | ✅ Implemented |
| `switch_agent` | Switch to a different named agent configuration. Omit agent param to list available agents. | `approve` | ✅ Implemented |
| `consult_agent` | Send a message to another agent and get their response without switching. | `approve` | ✅ Implemented |
| `delegate` | Spawn an isolated sub-agent for a focused sub-task. Sub-agent has own conversation history but shares parent provider and tools. Max depth 2, max concurrency 3. | `approve` | ✅ Implemented |

## channels

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `channel_list` | List all configured channels with connection status. | `read` | ✅ Implemented |
| `channel_send` | Send a message to a specific channel (Discord, Slack, Telegram, etc). | `approve` | ✅ Implemented |
| `channel_history` | Retrieve message history for a channel. | `read` | ✅ Implemented |
| `channel_create` | Create a new channel configuration with type, credentials, and allowlists. | `approve` | ✅ Implemented |
| `channel_delete` | Delete a channel configuration by name. | `approve` | ✅ Implemented |

## hardware

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `hw_list` | List all connected peripherals with type and status. | `approve` | ✅ Implemented |
| `hw_connect` | Connect to a serial, Bluetooth, or USB device. | `approve` | ✅ Implemented |
| `hw_send` | Send data to a connected peripheral. | `approve` | ✅ Implemented |
| `hw_read` | Read data from a connected peripheral. | `approve` | ✅ Implemented |
| `hw_disconnect` | Disconnect a peripheral by handle ID. | `approve` | ✅ Implemented |
| `hw_info` | Get detailed info about a connected peripheral. | `approve` | ✅ Implemented |

## oauth

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `oauth_list` | List all connected OAuth providers with connection status. | `read` | ✅ Implemented |
| `oauth_connect` | Initiate OAuth flow to connect a provider (Google, GitHub, Slack, etc). | `approve` | ✅ Implemented |
| `oauth_disconnect` | Disconnect an OAuth provider and revoke tokens. | `approve` | ✅ Implemented |
| `oauth_api` | Call an authenticated API endpoint using stored OAuth tokens. | `approve` | ✅ Implemented |

## routines

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `routine_create` | Create an automation routine with cron, event, or webhook trigger. | `approve` | ✅ Implemented |
| `routine_list` | List all routines with status, trigger info, and run history. | `read` | ✅ Implemented |
| `routine_delete` | Delete a routine by ID. | `approve` | ✅ Implemented |
| `routine_history` | Get execution history for a routine. | `read` | ✅ Implemented |
| `routine_run` | Manually trigger a routine execution. | `approve` | ✅ Implemented |
| `routine_toggle` | Enable or disable a routine. | `approve` | ✅ Implemented |
| `routine_update` | Update a routine definition (trigger, action, or guardrails). | `approve` | ✅ Implemented |

## wsh

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `wsh_connect` | Connect to a remote wsh server, optionally exposing reverse capabilities. | `approve` | ✅ Implemented |
| `wsh_exec` | Execute a command on a connected remote server. | `approve` | ✅ Implemented |
| `wsh_pty_open` | Open an interactive PTY session on a remote server. | `approve` | ✅ Implemented |
| `wsh_pty_write` | Write data (keystrokes) to an open PTY session. | `approve` | ✅ Implemented |
| `wsh_upload` | Upload a file from OPFS to a remote server. | `approve` | ✅ Implemented |
| `wsh_download` | Download a file from a remote server to OPFS. | `approve` | ✅ Implemented |
| `wsh_disconnect` | Close connection to a remote server. | `auto` | ✅ Implemented |
| `wsh_sessions` | List all active WSH sessions across connections. | `read` | ✅ Implemented |
| `wsh_mcp_call` | Call an MCP tool on a remote host via WSH bridge. | `approve` | ✅ Implemented |
| `wsh_fetch` | Perform an HTTP(S) fetch request on a remote host. | `approve` | ✅ Implemented |
| `wsh_compress` | Compress files on a remote host. | `approve` | ✅ Implemented |
| `wsh_file_op` | Remote file operations (copy/move). | `approve` | ✅ Implemented |

## shell

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `shell` | Execute shell commands in the browser-native virtual shell. | `approve` | ✅ Implemented |

## daemon

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `daemon_status` | Get daemon phase/state (stopped, starting, running, checkpointing, paused, recovering, error). | `read` | ✅ Implemented |
| `daemon_checkpoint` | Create a daemon checkpoint for state persistence. | `approve` | ✅ Implemented |
| `daemon_pause` | Pause the daemon loop. | `approve` | ✅ Implemented |
| `daemon_resume` | Resume daemon from paused state. | `approve` | ✅ Implemented |
| `daemon_restore` | Restore daemon from a stored checkpoint. | `approve` | ✅ Implemented |
| `cross_tab_tool_bridge` | Bridge tool execution across browser tabs via BroadcastChannel. | `—` | ✅ Implemented |

## auth

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `auth_list_profiles` | List all authentication profiles across providers. | `read` | ✅ Implemented |
| `auth_switch_profile` | Switch the active authentication profile for a provider. | `approve` | ✅ Implemented |
| `auth_status` | Show currently active authentication profiles. | `read` | ✅ Implemented |

## browser-automation

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `browser_open` | Open a URL in a new tab with domain allowlist enforcement. | `approve` | ✅ Implemented |
| `browser_read_page` | Get a page snapshot — URL, title, text, links, forms, interactive elements. | `approve` | ✅ Implemented |
| `browser_click` | Click an element on a page by selector or text. | `approve` | ✅ Implemented |
| `browser_fill` | Fill a form field on a page. | `approve` | ✅ Implemented |
| `browser_wait` | Wait for a CSS selector to appear on a page. | `approve` | ✅ Implemented |
| `browser_evaluate` | Execute JavaScript in a browser automation session. | `approve` | ✅ Implemented |
| `browser_list_tabs` | List open tabs in the automation session. | `read` | ✅ Implemented |
| `browser_close_tab` | Close a tab in the automation session. | `approve` | ✅ Implemented |

## extension

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `ext_status` | Check Chrome extension connection status. | `read` | ✅ Implemented |
| `ext_capabilities` | List available extension capabilities (tabs, scripting, cookies, network). | `read` | ✅ Implemented |
| `ext_tabs_list` | List all open browser tabs via extension. | `read` | ✅ Implemented |
| `ext_tab_open` | Open a new tab via extension. | `approve` | ✅ Implemented |
| `ext_tab_close` | Close a tab by ID via extension. | `approve` | ✅ Implemented |
| `ext_tab_activate` | Activate/focus a tab by ID. | `approve` | ✅ Implemented |
| `ext_tab_reload` | Reload a tab by ID. | `approve` | ✅ Implemented |
| `ext_navigate` | Navigate a tab to a URL. | `approve` | ✅ Implemented |
| `ext_go_back` | Navigate back in tab history. | `approve` | ✅ Implemented |
| `ext_go_forward` | Navigate forward in tab history. | `approve` | ✅ Implemented |
| `ext_screenshot` | Take a screenshot of a tab via extension. | `approve` | ✅ Implemented |
| `ext_resize` | Resize the browser window. | `approve` | ✅ Implemented |
| `ext_zoom` | Set page zoom level. | `approve` | ✅ Implemented |
| `ext_read_page` | Read page accessibility tree via extension. | `approve` | ✅ Implemented |
| `ext_find` | Find elements on page by selector or text. | `approve` | ✅ Implemented |
| `ext_get_text` | Extract text content from page. | `read` | ✅ Implemented |
| `ext_get_html` | Extract HTML content from page. | `read` | ✅ Implemented |
| `ext_click` | Click an element via extension. | `approve` | ✅ Implemented |
| `ext_double_click` | Double-click an element via extension. | `approve` | ✅ Implemented |
| `ext_triple_click` | Triple-click an element via extension. | `approve` | ✅ Implemented |
| `ext_right_click` | Right-click an element via extension. | `approve` | ✅ Implemented |
| `ext_hover` | Hover over an element. | `approve` | ✅ Implemented |
| `ext_drag` | Drag an element to a target. | `approve` | ✅ Implemented |
| `ext_scroll` | Scroll page or element. | `approve` | ✅ Implemented |
| `ext_type` | Type text into focused element. | `approve` | ✅ Implemented |
| `ext_key` | Press keyboard keys via extension. | `approve` | ✅ Implemented |
| `ext_form_input` | Set form field value. | `—` | ✅ Implemented |
| `ext_select_option` | Select a dropdown option. | `—` | ✅ Implemented |
| `ext_console` | Read browser console messages. | `—` | ✅ Implemented |
| `ext_network` | Read network requests. | `—` | ✅ Implemented |
| `ext_evaluate` | Execute JavaScript in page context via extension. | `—` | ✅ Implemented |
| `ext_wait` | Wait for a condition in the page. | `—` | ✅ Implemented |
| `ext_cookies` | Get/set cookies for a domain. | `—` | ✅ Implemented |
| `ext_webmcp_discover` | Discover WebMCP markers on the current page. | `—` | ✅ Implemented |
| `ext_cors_fetch` | CORS-aware HTTP fetch via the Chrome extension (bypasses same-origin). | `—` | ✅ Implemented |

## chrome-ai

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `chrome_ai_write` | Generate text using Chrome built-in AI (Gemini Nano). | `—` | ✅ Implemented |
| `chrome_ai_rewrite` | Rewrite existing text using Chrome AI (as-is, formal, casual). | `—` | ✅ Implemented |
| `chrome_ai_summarize` | Summarize content using Chrome AI (key-points, tldr, teaser, headline). | `—` | ✅ Implemented |

## netway

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `netway_connect` | Connect to a network address (mem://, tcp://, etc). Returns a socket handle. | `—` | ✅ Implemented |
| `netway_listen` | Bind a listener on a network address to accept incoming connections. | `—` | ✅ Implemented |
| `netway_send` | Write data to an open stream socket. | `—` | ✅ Implemented |
| `netway_read` | Read data from socket or accept connection from listener. | `—` | ✅ Implemented |
| `netway_close` | Close a socket, listener, or datagram socket by handle. | `—` | ✅ Implemented |
| `netway_resolve` | Resolve a hostname to IP addresses via DNS. | `—` | ✅ Implemented |
| `netway_status` | List active sockets, listeners, and backends in the virtual network. | `—` | ✅ Implemented |
| `netway_udp_send` | Send a UDP datagram to an address. | `—` | ✅ Implemented |

## google

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `google_calendar_list` | List upcoming events from Google Calendar. | `—` | ✅ Implemented |
| `google_calendar_create` | Create a new event on Google Calendar. | `—` | ✅ Implemented |
| `google_gmail_search` | Search Gmail messages using Gmail query syntax. | `—` | ✅ Implemented |
| `google_gmail_send` | Send an email via Gmail. | `—` | ✅ Implemented |
| `google_drive_list` | List files in Google Drive. | `—` | ✅ Implemented |
| `google_drive_read` | Read metadata and content of a Google Drive file. | `—` | ✅ Implemented |
| `google_drive_create` | Create a new file in Google Drive. | `—` | ✅ Implemented |

## linear

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `linear_issues` | List or search Linear issues with optional filters. | `—` | ✅ Implemented |
| `linear_create_issue` | Create a new issue in Linear. | `—` | ✅ Implemented |
| `linear_update_issue` | Update an existing Linear issue. | `—` | ✅ Implemented |

## slack

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `slack_channels` | List Slack channels the bot has access to. | `—` | ✅ Implemented |
| `slack_post` | Post a message to a Slack channel. | `—` | ✅ Implemented |
| `slack_history` | Retrieve recent messages from a Slack channel. | `—` | ✅ Implemented |

## git

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `git_status` | Show working tree status. | `—` | ✅ Implemented |
| `git_diff` | Show changes between commits, working tree, etc. | `—` | ✅ Implemented |
| `git_log` | View commit history. | `—` | ✅ Implemented |
| `git_commit` | Commit staged changes with conventional commit support. | `—` | ✅ Implemented |
| `git_branch` | Manage branches (list, create, switch). | `—` | ✅ Implemented |
| `git_recall` | Query git history by natural language using episodic memory and full-text commit search. | `—` | ✅ Implemented |

## undo

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `undo` | Undo N turns of agent actions. | `—` | ✅ Implemented |
| `undo_status` | Preview what would be undone without executing. | `—` | ✅ Implemented |
| `redo` | Redo previously undone turns. | `—` | ✅ Implemented |

## tool-builder

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `tool_build` | Create a custom tool at runtime with spec and code. | `—` | ✅ Implemented |
| `tool_test` | Test a custom tool with sample parameters. | `—` | ✅ Implemented |
| `tool_list_custom` | List all custom-built tools. | `—` | ✅ Implemented |
| `tool_edit` | Edit a custom tool's code or spec with version history and rollback. | `—` | ✅ Implemented |
| `tool_remove` | Delete a custom tool. | `—` | ✅ Implemented |

## sandbox

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `sandbox_run` | Execute code in an isolated Worker or WASM sandbox. | `—` | ✅ Implemented |
| `sandbox_status` | Show sandbox state and capability tier. | `—` | ✅ Implemented |

## remote

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `remote_pair` | Create a remote pairing session with a code for another device. | `—` | ✅ Implemented |
| `remote_revoke` | Revoke a remote access session. | `—` | ✅ Implemented |
| `remote_status` | Show active remote sessions and connection status. | `—` | ✅ Implemented |

## mount

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `mount_list` | List all filesystem mount points. | `—` | ✅ Implemented |
| `mount_resolve` | Resolve a mount path to its backing directory handle. | `—` | ✅ Implemented |

## self-repair

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `self_repair_status` | Check system health and self-repair engine status. | `—` | ✅ Implemented |
| `self_repair_configure` | Set self-repair thresholds and policies. | `—` | ✅ Implemented |

## heartbeat

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `heartbeat_status` | Get current heartbeat check status. | `—` | ✅ Implemented |
| `heartbeat_run` | Manually trigger all heartbeat checks. | `—` | ✅ Implemented |

## intent

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `intent_classify` | Classify a user message into an intent category. | `—` | ✅ Implemented |
| `intent_override` | Manage custom intent prefix overrides. | `—` | ✅ Implemented |

## mesh-streams

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `mesh_stream_open` | Open a multiplexed data stream to a peer. | `—` | ✅ Implemented |
| `mesh_stream_close` | Close an open data stream by ID. | `—` | ✅ Implemented |
| `mesh_stream_list` | List active mesh streams, optionally filtered by peer. | `—` | ✅ Implemented |

## mesh-files

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `mesh_file_send` | Send files to a peer (creates transfer offer). | `—` | ✅ Implemented |
| `mesh_file_accept` | Accept an incoming file transfer. | `—` | ✅ Implemented |
| `mesh_file_list` | List pending and completed file transfers. | `—` | ✅ Implemented |
| `mesh_file_cancel` | Cancel an in-progress file transfer. | `—` | ✅ Implemented |
| `mesh_torrent_seed` | Seed a file for torrent-like distribution. | `—` | ✅ Implemented |
| `mesh_ipfs_store` | Store content to the mesh IPFS layer. | `—` | ✅ Implemented |
| `mesh_ipfs_retrieve` | Retrieve content from the mesh IPFS layer. | `—` | ✅ Implemented |

## mesh-chat

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `mesh_chat_create_room` | Create a mesh chat room. | `—` | ✅ Implemented |
| `mesh_chat_send` | Send a message to a mesh chat room. | `—` | ✅ Implemented |
| `mesh_chat_history` | Get message history for a mesh chat room. | `—` | ✅ Implemented |
| `mesh_chat_list_rooms` | List all mesh chat rooms. | `—` | ✅ Implemented |

## mesh-scheduler

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `mesh_scheduler_submit` | Submit a task to the distributed mesh scheduler. | `—` | ✅ Implemented |
| `mesh_scheduler_list` | List pending tasks on the mesh scheduler. | `—` | ✅ Implemented |

## mesh-identity

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `identity_create` | Create a new Ed25519 mesh identity. | `—` | ✅ Implemented |
| `identity_list` | List all mesh identities. | `—` | ✅ Implemented |
| `identity_switch` | Switch the active mesh identity. | `—` | ✅ Implemented |
| `identity_export` | Export identity as JWK (optionally encrypted with passphrase). | `—` | ✅ Implemented |
| `identity_import` | Import an identity from a JWK private key. | `—` | ✅ Implemented |
| `identity_delete` | Delete a mesh identity. | `—` | ✅ Implemented |
| `identity_link` | Create a cross-identity link. | `—` | ✅ Implemented |
| `identity_select_rule` | Set the identity selection rule for automatic switching. | `—` | ✅ Implemented |

## mesh-compute

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `federated_compute_submit` | Submit a compute job to the federated mesh GPU cluster. | `—` | ✅ Implemented |

## mesh-swarm

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `agent_swarm_create` | Create an agent swarm across mesh peers. | `—` | ✅ Implemented |
| `agent_swarm_status` | Get the status of an agent swarm. | `—` | ✅ Implemented |

## mesh-ops

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `mesh_health_status` | Get health status of mesh peers. | `—` | ✅ Implemented |
| `mesh_timestamp_proof` | Get a cryptographic timestamp proof from the mesh authority. | `—` | ✅ Implemented |
| `mesh_gateway_status` | Get mesh gateway node status. | `—` | ✅ Implemented |

## mesh-payments

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `mesh_escrow_create` | Create an escrow arrangement between peers. | `—` | ✅ Implemented |
| `mesh_escrow_list` | List escrow arrangements. | `—` | ✅ Implemented |
| `mesh_escrow_release` | Release funds from escrow. | `—` | ✅ Implemented |

## mesh-routing

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `mesh_router_add_route` | Add a routing entry to the mesh router. | `—` | ✅ Implemented |
| `mesh_router_lookup` | Lookup a route in the mesh router. | `—` | ✅ Implemented |

## mesh-privacy

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `mesh_stealth_save` | Save a stealth identity for anonymous mesh participation. | `—` | ✅ Implemented |
| `mesh_stealth_restore` | Restore a previously saved stealth identity. | `—` | ✅ Implemented |

## mesh-sync

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `mesh_delta_sync_status` | Get delta sync status for CRDT documents. | `—` | ✅ Implemented |

## mesh-acl

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `mesh_acl_add_entry` | Add an ACL entry for mesh resource access control. | `—` | ✅ Implemented |
| `mesh_acl_check` | Check ACL permission for a resource/action. | `—` | ✅ Implemented |
| `mesh_acl_list` | List all ACL entries. | `—` | ✅ Implemented |

## meshctl

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `meshctl_status` | Get mesh cluster status. | `—` | ✅ Implemented |
| `meshctl_pods` | List pods in the mesh cluster. | `—` | ✅ Implemented |
| `meshctl_compute` | Mesh compute operations. | `—` | ✅ Implemented |
| `meshctl_deploy` | Deploy a service to the mesh cluster. | `—` | ✅ Implemented |
| `meshctl_exec` | Execute a command in a mesh pod. | `—` | ✅ Implemented |
| `meshctl_expose` | Expose a service on the mesh. | `—` | ✅ Implemented |
| `meshctl_top` | Show resource usage across mesh peers. | `—` | ✅ Implemented |
| `meshctl_drain` | Drain a mesh node for maintenance. | `—` | ✅ Implemented |

## mesh-dht

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `dht_lookup` | Lookup a key in the distributed hash table. | `—` | ✅ Implemented |
| `dht_peers` | Get DHT peer list. | `—` | ✅ Implemented |
| `dht_store` | Store a value in the DHT. | `—` | ✅ Implemented |

## mesh-gpu

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `gpu_train_start` | Start a distributed GPU training job. | `—` | ✅ Implemented |
| `gpu_train_status` | Get the status of a GPU training job. | `—` | ✅ Implemented |

## server

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `server_add` | Register a virtual server with route definitions. | `—` | ✅ Implemented |
| `server_list` | List all registered virtual servers. | `—` | ✅ Implemented |
| `server_start` | Start a virtual server. | `—` | ✅ Implemented |
| `server_stop` | Stop a running virtual server. | `—` | ✅ Implemented |
| `server_update` | Update a virtual server configuration. | `—` | ✅ Implemented |
| `server_remove` | Unregister a virtual server. | `—` | ✅ Implemented |
| `server_logs` | Get server access and error logs. | `—` | ✅ Implemented |
| `server_test` | Test a server route with a sample request. | `—` | ✅ Implemented |

## vault

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `vault_store` | Encrypt and store a secret in the credential vault. | `—` | ✅ Implemented |
| `vault_retrieve` | Decrypt and retrieve a secret from the vault. | `—` | ✅ Implemented |

## mcp

| Tool | Description | Permission | Status |
|------|-------------|------------|--------|
| `MCP Tools (Dynamic)` | Tools dynamically discovered from connected MCP servers via JSON-RPC. Each MCP server exposes its own set of tools which are registered at runtime with svc:// prefix routing. Tool count varies based on connected servers. | `—` | ✅ Implemented |

---

## Detailed Reference

### fetch

**Status:** ✅ Implemented · **Category:** network · **Since:** v1.0.0

HTTP/HTTPS requests with configurable domain allowlist. Returns status, headers, and body text (truncated at 50K chars).

**Source files:**

- `web/clawser-tools.js`
- `web/clawser-tools.d.ts`

**API surface:**

- `fetch`

> **Note:** Parameters: url (required), method (GET/POST/PUT/DELETE/PATCH), headers (object), body (string). Enforces domain allowlist.

---

### web_search

**Status:** ✅ Implemented · **Category:** network · **Since:** v1.0.0

Search the web using DuckDuckGo HTML lite endpoint. No API key required.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `web_search`

> **Note:** Parameters: query (required), max_results (number). Uses DuckDuckGo lite.

---

### dom_query

**Status:** ✅ Implemented · **Category:** dom · **Since:** v1.0.0

Query DOM elements using CSS selectors. Returns text content, attributes, and structure.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `dom_query`

> **Note:** Parameters: selector (required), limit (default 10), include_html (boolean).

---

### dom_modify

**Status:** ✅ Implemented · **Category:** dom · **Since:** v1.0.0

Modify DOM elements — setText, setHTML, setAttribute, setStyle, addClass, removeClass, remove, insertHTML. Sanitizes HTML to block scripts, iframes, and event handlers.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `dom_modify`

> **Note:** Uses native Sanitizer API when available. XSS prevention built in.

---

### fs_read

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v1.0.0

Read a file from the Origin Private File System (OPFS). Max read size 50MB.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `fs_read`

> **Note:** Parameters: path (required), encoding (utf8/base64, default utf8).

---

### fs_write

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v1.0.0

Write a file to OPFS. Creates parent directories as needed. Max 10MB default.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `fs_write`

> **Note:** Parameters: path (required), content (required), encoding. Checks storage quota — warns at 80%, blocks at 95%.

---

### fs_list

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v1.0.0

List files and directories in OPFS.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `fs_list`

> **Note:** Parameters: path (default /), recursive (boolean).

---

### fs_delete

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v1.0.0

Delete a file or directory from OPFS with optional recursive flag.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `fs_delete`

> **Note:** Parameters: path (required), recursive (boolean).

---

### fs_mkdir

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v1.0.0

Create a directory in OPFS. Creates parent directories as needed.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `fs_mkdir`

---

### storage_get

**Status:** ✅ Implemented · **Category:** storage · **Since:** v1.0.0

Read a value from localStorage by key. Blocks access to clawser_* internal keys.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `storage_get`

---

### storage_set

**Status:** ✅ Implemented · **Category:** storage · **Since:** v1.0.0

Write a value to localStorage. Blocks writing to clawser_* internal keys.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `storage_set`

---

### storage_delete

**Status:** ✅ Implemented · **Category:** storage · **Since:** v1.0.0

Delete a localStorage key. Blocks deletion of clawser_* internal keys.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `storage_delete`

---

### storage_list

**Status:** ✅ Implemented · **Category:** storage · **Since:** v1.0.0

List all keys in localStorage with value lengths. Hides clawser_* internal keys.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `storage_list`

---

### clipboard_read

**Status:** ✅ Implemented · **Category:** clipboard · **Since:** v1.0.0

Read text from the system clipboard.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `clipboard_read`

> **Note:** Requires browser permission grant.

---

### clipboard_write

**Status:** ✅ Implemented · **Category:** clipboard · **Since:** v1.0.0

Write text to the system clipboard.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `clipboard_write`

---

### navigate

**Status:** ✅ Implemented · **Category:** navigation · **Since:** v1.0.0

Open a URL in a new browser tab or the current page. Only allows http/https protocols.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `navigate`

---

### notify

**Status:** ✅ Implemented · **Category:** navigation · **Since:** v1.0.0

Show a browser notification with title, body, and optional icon.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `notify`

---

### eval_js

**Status:** ✅ Implemented · **Category:** code · **Since:** v1.0.0

Evaluate JavaScript in the page global scope via indirect eval. Requires explicit user confirmation.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `eval_js`

> **Note:** Permission level approve — always requires user confirmation.

---

### screenshot

**Status:** ✅ Implemented · **Category:** media · **Since:** v1.0.0

Capture a screenshot as a data URL (PNG). Lazy-loads html2canvas from CDN.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `screenshot`

---

### screen_info

**Status:** ✅ Implemented · **Category:** media · **Since:** v1.0.0

Get current page info — URL, title, viewport size, scroll position, and visible text summary.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `screen_info`

---

### memory_store

**Status:** ✅ Implemented · **Category:** memory · **Since:** v1.0.0

Store a memory for later recall. Categories — core, learned, user, context.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `memory_store`

> **Note:** Parameters: key (required), content (required), category (core/learned/user/context).

---

### memory_recall

**Status:** ✅ Implemented · **Category:** memory · **Since:** v1.0.0

Search stored memories by keyword query. Returns top results via hybrid BM25 + vector search.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `memory_recall`

> **Note:** Parameters: query (required), limit (default 10), category (optional filter).

---

### memory_forget

**Status:** ✅ Implemented · **Category:** memory · **Since:** v1.0.0

Delete a stored memory by ID.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `memory_forget`

---

### goal_add

**Status:** ✅ Implemented · **Category:** goals · **Since:** v1.0.0

Add a new goal with optional parent and priority.

**Source files:**

- `web/clawser-goals.js`

**API surface:**

- `GoalAddTool`

> **Note:** Parameters: description (required), parentId (optional), priority (low/medium/high/critical).

---

### goal_update

**Status:** ✅ Implemented · **Category:** goals · **Since:** v1.0.0

Update goal status — active, paused, completed, or failed.

**Source files:**

- `web/clawser-goals.js`

**API surface:**

- `GoalUpdateTool`

---

### goal_list

**Status:** ✅ Implemented · **Category:** goals · **Since:** v1.0.0

List all goals with optional status and priority filters.

**Source files:**

- `web/clawser-goals.js`

**API surface:**

- `GoalListTool`

---

### goal_remove

**Status:** ✅ Implemented · **Category:** goals · **Since:** v1.0.0

Remove a goal by ID.

**Source files:**

- `web/clawser-goals.js`

**API surface:**

- `GoalRemoveTool`

---

### goal_decompose

**Status:** ✅ Implemented · **Category:** goals · **Since:** v1.0.0

Break a goal into sub-goals from a list of subtask descriptions.

**Source files:**

- `web/clawser-goals.js`

**API surface:**

- `GoalDecomposeTool`

---

### goal_add_artifact

**Status:** ✅ Implemented · **Category:** goals · **Since:** v1.0.0

Attach a file path artifact to a goal.

**Source files:**

- `web/clawser-goals.js`

**API surface:**

- `GoalAddArtifactTool`

---

### goal_remove_artifact

**Status:** ✅ Implemented · **Category:** goals · **Since:** v1.0.0

Remove a file path artifact from a goal.

**Source files:**

- `web/clawser-goals.js`

**API surface:**

- `GoalRemoveArtifactTool`

---

### schedule_add

**Status:** ✅ Implemented · **Category:** scheduler · **Since:** v1.0.0

Add a scheduled job — once, interval, or cron expression.

**Source files:**

- `web/clawser-agent.js`

**API surface:**

- `addSchedulerJob`

---

### schedule_list

**Status:** ✅ Implemented · **Category:** scheduler · **Since:** v1.0.0

List all scheduled jobs with status and next-fire time.

**Source files:**

- `web/clawser-agent.js`

**API surface:**

- `listSchedulerJobs`

---

### schedule_remove

**Status:** ✅ Implemented · **Category:** scheduler · **Since:** v1.0.0

Remove a scheduled job by ID.

**Source files:**

- `web/clawser-agent.js`

**API surface:**

- `removeSchedulerJob`

---

### activate_skill

**Status:** ✅ Implemented · **Category:** skills · **Since:** v1.0.0

Activate an installed skill by name with optional arguments.

**Source files:**

- `web/clawser-skills.js`
- `web/clawser-skills.d.ts`

**API surface:**

- `ActivateSkillTool`

---

### deactivate_skill

**Status:** ✅ Implemented · **Category:** skills · **Since:** v1.0.0

Deactivate a currently active skill.

**Source files:**

- `web/clawser-skills.js`

**API surface:**

- `DeactivateSkillTool`

---

### skill_search

**Status:** ✅ Implemented · **Category:** skills · **Since:** v1.0.0

Search the remote skill registry for skills matching a query.

**Source files:**

- `web/clawser-skills.js`

**API surface:**

- `SkillSearchTool`

---

### skill_install

**Status:** ✅ Implemented · **Category:** skills · **Since:** v1.0.0

Install a skill from the remote registry by name/version.

**Source files:**

- `web/clawser-skills.js`

**API surface:**

- `SkillInstallTool`

---

### skill_update

**Status:** ✅ Implemented · **Category:** skills · **Since:** v1.0.0

Update an installed skill to the latest registry version.

**Source files:**

- `web/clawser-skills.js`

**API surface:**

- `SkillUpdateTool`

---

### skill_remove

**Status:** ✅ Implemented · **Category:** skills · **Since:** v1.0.0

Uninstall a skill from the workspace.

**Source files:**

- `web/clawser-skills.js`

**API surface:**

- `SkillRemoveTool`

---

### skill_list

**Status:** ✅ Implemented · **Category:** skills · **Since:** v1.0.0

List all installed skills with activation status.

**Source files:**

- `web/clawser-skills.js`

**API surface:**

- `SkillListTool`

---

### ask_user_question

**Status:** ✅ Implemented · **Category:** agent · **Since:** v1.0.0

Ask the user one or more questions with predefined options. Max 4 questions, 2-4 options each.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `ask_user_question`

---

### switch_agent

**Status:** ✅ Implemented · **Category:** agent · **Since:** v1.0.0

Switch to a different named agent configuration. Omit agent param to list available agents.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `switch_agent`

> **Note:** Permission level approve.

---

### consult_agent

**Status:** ✅ Implemented · **Category:** agent · **Since:** v1.0.0

Send a message to another agent and get their response without switching.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `consult_agent`

---

### delegate

**Status:** ✅ Implemented · **Category:** agent · **Since:** v1.5.0

Spawn an isolated sub-agent for a focused sub-task. Sub-agent has own conversation history but shares parent provider and tools. Max depth 2, max concurrency 3.

**Source files:**

- `web/clawser-delegate.js`
- `web/clawser-delegate.d.ts`

**API surface:**

- `DelegateTool`

> **Note:** Parameters: task (required), tools (optional list), max_iterations (default from DEFAULT_MAX_ITERATIONS).

---

### channel_list

**Status:** ✅ Implemented · **Category:** channels · **Since:** v1.0.0

List all configured channels with connection status.

**Source files:**

- `web/clawser-channels.js`
- `web/clawser-channels.d.ts`

**API surface:**

- `ChannelListTool`

---

### channel_send

**Status:** ✅ Implemented · **Category:** channels · **Since:** v1.0.0

Send a message to a specific channel (Discord, Slack, Telegram, etc).

**Source files:**

- `web/clawser-channels.js`

**API surface:**

- `ChannelSendTool`

> **Note:** Parameters: channel (required), message (required).

---

### channel_history

**Status:** ✅ Implemented · **Category:** channels · **Since:** v1.0.0

Retrieve message history for a channel.

**Source files:**

- `web/clawser-channels.js`

**API surface:**

- `ChannelHistoryTool`

---

### channel_create

**Status:** ✅ Implemented · **Category:** channels · **Since:** v1.0.0

Create a new channel configuration with type, credentials, and allowlists.

**Source files:**

- `web/clawser-channels.js`

**API surface:**

- `ChannelCreateTool`

---

### channel_delete

**Status:** ✅ Implemented · **Category:** channels · **Since:** v1.0.0

Delete a channel configuration by name.

**Source files:**

- `web/clawser-channels.js`

**API surface:**

- `ChannelDeleteTool`

---

### hw_list

**Status:** ✅ Implemented · **Category:** hardware · **Since:** v1.5.0

List all connected peripherals with type and status.

**Source files:**

- `web/clawser-hardware.js`
- `web/clawser-hardware.d.ts`

**API surface:**

- `HwListTool`

---

### hw_connect

**Status:** ✅ Implemented · **Category:** hardware · **Since:** v1.5.0

Connect to a serial, Bluetooth, or USB device.

**Source files:**

- `web/clawser-hardware.js`

**API surface:**

- `HwConnectTool`

> **Note:** Parameters: type (serial/bluetooth/usb, required), options (baud rate, filters, etc).

---

### hw_send

**Status:** ✅ Implemented · **Category:** hardware · **Since:** v1.5.0

Send data to a connected peripheral.

**Source files:**

- `web/clawser-hardware.js`

**API surface:**

- `HwSendTool`

> **Note:** Parameters: id (required), data (required).

---

### hw_read

**Status:** ✅ Implemented · **Category:** hardware · **Since:** v1.5.0

Read data from a connected peripheral.

**Source files:**

- `web/clawser-hardware.js`

**API surface:**

- `HwReadTool`

---

### hw_disconnect

**Status:** ✅ Implemented · **Category:** hardware · **Since:** v1.5.0

Disconnect a peripheral by handle ID.

**Source files:**

- `web/clawser-hardware.js`

**API surface:**

- `HwDisconnectTool`

---

### hw_info

**Status:** ✅ Implemented · **Category:** hardware · **Since:** v1.5.0

Get detailed info about a connected peripheral.

**Source files:**

- `web/clawser-hardware.js`

**API surface:**

- `HwInfoTool`

---

### oauth_list

**Status:** ✅ Implemented · **Category:** oauth · **Since:** v1.5.0

List all connected OAuth providers with connection status.

**Source files:**

- `web/clawser-oauth.js`
- `web/clawser-oauth.d.ts`

**API surface:**

- `oauth_list`

---

### oauth_connect

**Status:** ✅ Implemented · **Category:** oauth · **Since:** v1.5.0

Initiate OAuth flow to connect a provider (Google, GitHub, Slack, etc).

**Source files:**

- `web/clawser-oauth.js`

**API surface:**

- `oauth_connect`

---

### oauth_disconnect

**Status:** ✅ Implemented · **Category:** oauth · **Since:** v1.5.0

Disconnect an OAuth provider and revoke tokens.

**Source files:**

- `web/clawser-oauth.js`

**API surface:**

- `oauth_disconnect`

---

### oauth_api

**Status:** ✅ Implemented · **Category:** oauth · **Since:** v1.5.0

Call an authenticated API endpoint using stored OAuth tokens.

**Source files:**

- `web/clawser-oauth.js`

**API surface:**

- `oauth_api`

> **Note:** Parameters: provider (required), url (required), method, headers, body.

---

### routine_create

**Status:** ✅ Implemented · **Category:** routines · **Since:** v1.5.0

Create an automation routine with cron, event, or webhook trigger.

**Source files:**

- `web/clawser-routines.js`
- `web/clawser-routines.d.ts`

**API surface:**

- `RoutineCreateTool`

> **Note:** Parameters: name (required), trigger (required), action (required), guardrails (optional).

---

### routine_list

**Status:** ✅ Implemented · **Category:** routines · **Since:** v1.5.0

List all routines with status, trigger info, and run history.

**Source files:**

- `web/clawser-routines.js`

**API surface:**

- `RoutineListTool`

---

### routine_delete

**Status:** ✅ Implemented · **Category:** routines · **Since:** v1.5.0

Delete a routine by ID.

**Source files:**

- `web/clawser-routines.js`

**API surface:**

- `RoutineDeleteTool`

---

### routine_history

**Status:** ✅ Implemented · **Category:** routines · **Since:** v1.5.0

Get execution history for a routine.

**Source files:**

- `web/clawser-routines.js`

**API surface:**

- `RoutineHistoryTool`

---

### routine_run

**Status:** ✅ Implemented · **Category:** routines · **Since:** v1.5.0

Manually trigger a routine execution.

**Source files:**

- `web/clawser-routines.js`

**API surface:**

- `RoutineRunTool`

---

### routine_toggle

**Status:** ✅ Implemented · **Category:** routines · **Since:** v1.5.0

Enable or disable a routine.

**Source files:**

- `web/clawser-routines.js`

**API surface:**

- `RoutineToggleTool`

---

### routine_update

**Status:** ✅ Implemented · **Category:** routines · **Since:** v1.5.0

Update a routine definition (trigger, action, or guardrails).

**Source files:**

- `web/clawser-routines.js`

**API surface:**

- `RoutineUpdateTool`

---

### wsh_connect

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v1.5.0

Connect to a remote wsh server, optionally exposing reverse capabilities.

**Source files:**

- `web/clawser-wsh-tools.js`
- `web/clawser-wsh-tools.d.ts`

**API surface:**

- `WshConnectTool`

> **Note:** Parameters: host (required), user (required), key_name (default), expose (object).

---

### wsh_exec

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v1.5.0

Execute a command on a connected remote server.

**Source files:**

- `web/clawser-wsh-tools.js`

**API surface:**

- `WshExecTool`

> **Note:** Parameters: command (required), host (optional), timeout_ms (default 30000).

---

### wsh_pty_open

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v1.5.0

Open an interactive PTY session on a remote server.

**Source files:**

- `web/clawser-wsh-tools.js`

**API surface:**

- `WshPtyOpenTool`

> **Note:** Parameters: host, command, cols (default 80), rows (default 24).

---

### wsh_pty_write

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v1.5.0

Write data (keystrokes) to an open PTY session.

**Source files:**

- `web/clawser-wsh-tools.js`

**API surface:**

- `WshPtyWriteTool`

> **Note:** Parameters: session_id (required), data (required).

---

### wsh_upload

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v1.5.0

Upload a file from OPFS to a remote server.

**Source files:**

- `web/clawser-wsh-tools.js`

**API surface:**

- `WshUploadTool`

> **Note:** Parameters: local_path (required), remote_path (required), host.

---

### wsh_download

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v1.5.0

Download a file from a remote server to OPFS.

**Source files:**

- `web/clawser-wsh-tools.js`

**API surface:**

- `WshDownloadTool`

> **Note:** Parameters: remote_path (required), local_path (required), host.

---

### wsh_disconnect

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v1.5.0

Close connection to a remote server.

**Source files:**

- `web/clawser-wsh-tools.js`

**API surface:**

- `WshDisconnectTool`

---

### wsh_sessions

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v1.5.0

List all active WSH sessions across connections.

**Source files:**

- `web/clawser-wsh-tools.js`

**API surface:**

- `WshSessionsTool`

---

### wsh_mcp_call

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v1.5.0

Call an MCP tool on a remote host via WSH bridge.

**Source files:**

- `web/clawser-wsh-tools.js`

**API surface:**

- `WshMcpCallTool`

> **Note:** Parameters: host, tool (required), arguments (object).

---

### wsh_fetch

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v1.5.0

Perform an HTTP(S) fetch request on a remote host.

**Source files:**

- `web/clawser-wsh-tools.js`

**API surface:**

- `WshFetchTool`

> **Note:** Parameters: url (required), method, headers, body, host, timeout_ms.

---

### wsh_compress

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v1.5.0

Compress files on a remote host.

**Source files:**

- `web/clawser-wsh-tools.js`

**API surface:**

- `wsh_compress`

---

### wsh_file_op

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v1.5.0

Remote file operations (copy/move).

**Source files:**

- `web/clawser-wsh-tools.js`

**API surface:**

- `wsh_file_op`

---

### shell

**Status:** ✅ Implemented · **Category:** shell · **Since:** v1.0.0

Execute shell commands in the browser-native virtual shell.

**Source files:**

- `web/clawser-shell.js`
- `web/clawser-shell.d.ts`

**API surface:**

- `ShellTool`

---

### daemon_status

**Status:** ✅ Implemented · **Category:** daemon · **Since:** v1.5.0

Get daemon phase/state (stopped, starting, running, checkpointing, paused, recovering, error).

**Source files:**

- `web/clawser-daemon.js`
- `web/clawser-daemon.d.ts`

**API surface:**

- `DaemonStatusTool`

---

### daemon_checkpoint

**Status:** ✅ Implemented · **Category:** daemon · **Since:** v1.5.0

Create a daemon checkpoint for state persistence.

**Source files:**

- `web/clawser-daemon.js`

**API surface:**

- `DaemonCheckpointTool`

---

### daemon_pause

**Status:** ✅ Implemented · **Category:** daemon · **Since:** v1.5.0

Pause the daemon loop.

**Source files:**

- `web/clawser-daemon.js`

**API surface:**

- `DaemonPauseTool`

---

### daemon_resume

**Status:** ✅ Implemented · **Category:** daemon · **Since:** v1.5.0

Resume daemon from paused state.

**Source files:**

- `web/clawser-daemon.js`

**API surface:**

- `DaemonResumeTool`

---

### daemon_restore

**Status:** ✅ Implemented · **Category:** daemon · **Since:** v1.5.0

Restore daemon from a stored checkpoint.

**Source files:**

- `web/clawser-daemon.js`

**API surface:**

- `DaemonRestoreTool`

---

### auth_list_profiles

**Status:** ✅ Implemented · **Category:** auth · **Since:** v1.5.0

List all authentication profiles across providers.

**Source files:**

- `web/clawser-auth-profiles.js`
- `web/clawser-auth-profiles.d.ts`

**API surface:**

- `AuthListProfilesTool`

---

### auth_switch_profile

**Status:** ✅ Implemented · **Category:** auth · **Since:** v1.5.0

Switch the active authentication profile for a provider.

**Source files:**

- `web/clawser-auth-profiles.js`

**API surface:**

- `AuthSwitchProfileTool`

---

### auth_status

**Status:** ✅ Implemented · **Category:** auth · **Since:** v1.5.0

Show currently active authentication profiles.

**Source files:**

- `web/clawser-auth-profiles.js`

**API surface:**

- `AuthStatusTool`

---

### browser_open

**Status:** ✅ Implemented · **Category:** browser-automation · **Since:** v1.5.0

Open a URL in a new tab with domain allowlist enforcement.

**Source files:**

- `web/clawser-browser-auto.js`
- `web/clawser-browser-auto.d.ts`

**API surface:**

- `BrowserOpenTool`

---

### browser_read_page

**Status:** ✅ Implemented · **Category:** browser-automation · **Since:** v1.5.0

Get a page snapshot — URL, title, text, links, forms, interactive elements.

**Source files:**

- `web/clawser-browser-auto.js`

**API surface:**

- `BrowserReadPageTool`

---

### browser_click

**Status:** ✅ Implemented · **Category:** browser-automation · **Since:** v1.5.0

Click an element on a page by selector or text.

**Source files:**

- `web/clawser-browser-auto.js`

**API surface:**

- `BrowserClickTool`

---

### browser_fill

**Status:** ✅ Implemented · **Category:** browser-automation · **Since:** v1.5.0

Fill a form field on a page.

**Source files:**

- `web/clawser-browser-auto.js`

**API surface:**

- `BrowserFillTool`

---

### browser_wait

**Status:** ✅ Implemented · **Category:** browser-automation · **Since:** v1.5.0

Wait for a CSS selector to appear on a page.

**Source files:**

- `web/clawser-browser-auto.js`

**API surface:**

- `BrowserWaitTool`

---

### browser_evaluate

**Status:** ✅ Implemented · **Category:** browser-automation · **Since:** v1.5.0

Execute JavaScript in a browser automation session.

**Source files:**

- `web/clawser-browser-auto.js`

**API surface:**

- `BrowserEvaluateTool`

---

### browser_list_tabs

**Status:** ✅ Implemented · **Category:** browser-automation · **Since:** v1.5.0

List open tabs in the automation session.

**Source files:**

- `web/clawser-browser-auto.js`

**API surface:**

- `BrowserListTabsTool`

---

### browser_close_tab

**Status:** ✅ Implemented · **Category:** browser-automation · **Since:** v1.5.0

Close a tab in the automation session.

**Source files:**

- `web/clawser-browser-auto.js`

**API surface:**

- `BrowserCloseTabTool`

---

### ext_status

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Check Chrome extension connection status.

**Source files:**

- `web/clawser-extension-tools.js`
- `web/clawser-extension-tools.d.ts`

**API surface:**

- `ExtStatusTool`

---

### ext_capabilities

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

List available extension capabilities (tabs, scripting, cookies, network).

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ExtCapabilitiesTool`

---

### ext_tabs_list

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

List all open browser tabs via extension.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_tabs_list`

---

### ext_tab_open

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Open a new tab via extension.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_tab_open`

---

### ext_tab_close

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Close a tab by ID via extension.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_tab_close`

---

### ext_tab_activate

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Activate/focus a tab by ID.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_tab_activate`

---

### ext_tab_reload

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Reload a tab by ID.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_tab_reload`

---

### ext_navigate

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Navigate a tab to a URL.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_navigate`

---

### ext_go_back

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Navigate back in tab history.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_go_back`

---

### ext_go_forward

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Navigate forward in tab history.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_go_forward`

---

### ext_screenshot

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Take a screenshot of a tab via extension.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_screenshot`

---

### ext_resize

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Resize the browser window.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_resize`

---

### ext_zoom

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Set page zoom level.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_zoom`

---

### ext_read_page

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Read page accessibility tree via extension.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_read_page`

---

### ext_find

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Find elements on page by selector or text.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_find`

---

### ext_get_text

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Extract text content from page.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_get_text`

---

### ext_get_html

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Extract HTML content from page.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_get_html`

---

### ext_click

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Click an element via extension.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_click`

---

### ext_double_click

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Double-click an element via extension.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_double_click`

---

### ext_triple_click

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Triple-click an element via extension.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_triple_click`

---

### ext_right_click

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Right-click an element via extension.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_right_click`

---

### ext_hover

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Hover over an element.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_hover`

---

### ext_drag

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Drag an element to a target.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_drag`

---

### ext_scroll

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Scroll page or element.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_scroll`

---

### ext_type

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Type text into focused element.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_type`

---

### ext_key

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Press keyboard keys via extension.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_key`

---

### ext_form_input

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Set form field value.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_form_input`

---

### ext_select_option

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Select a dropdown option.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_select_option`

---

### ext_console

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Read browser console messages.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_console`

---

### ext_network

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Read network requests.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_network`

---

### ext_evaluate

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Execute JavaScript in page context via extension.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_evaluate`

---

### ext_wait

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Wait for a condition in the page.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_wait`

---

### ext_cookies

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Get/set cookies for a domain.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_cookies`

---

### ext_webmcp_discover

**Status:** ✅ Implemented · **Category:** extension · **Since:** v2.0.0

Discover WebMCP markers on the current page.

**Source files:**

- `web/clawser-extension-tools.js`

**API surface:**

- `ext_webmcp_discover`

---

### chrome_ai_write

**Status:** ✅ Implemented · **Category:** chrome-ai · **Since:** v1.5.0

Generate text using Chrome built-in AI (Gemini Nano).

**Source files:**

- `web/clawser-chrome-ai-tools.js`
- `web/clawser-chrome-ai-tools.d.ts`

**API surface:**

- `ChromeWriterTool`

> **Note:** Parameters: prompt, tone, format, length, context.

---

### chrome_ai_rewrite

**Status:** ✅ Implemented · **Category:** chrome-ai · **Since:** v1.5.0

Rewrite existing text using Chrome AI (as-is, formal, casual).

**Source files:**

- `web/clawser-chrome-ai-tools.js`

**API surface:**

- `ChromeRewriterTool`

---

### chrome_ai_summarize

**Status:** ✅ Implemented · **Category:** chrome-ai · **Since:** v1.5.0

Summarize content using Chrome AI (key-points, tldr, teaser, headline).

**Source files:**

- `web/clawser-chrome-ai-tools.js`

**API surface:**

- `ChromeSummarizerTool`

---

### netway_connect

**Status:** ✅ Implemented · **Category:** netway · **Since:** v2.0.0

Connect to a network address (mem://, tcp://, etc). Returns a socket handle.

**Source files:**

- `web/clawser-netway-tools.js`
- `web/clawser-netway-tools.d.ts`

**API surface:**

- `NetwayConnectTool`

> **Note:** Parameters: address (required, e.g. mem://localhost:8080, tcp://example.com:443).

---

### netway_listen

**Status:** ✅ Implemented · **Category:** netway · **Since:** v2.0.0

Bind a listener on a network address to accept incoming connections.

**Source files:**

- `web/clawser-netway-tools.js`

**API surface:**

- `NetwayListenTool`

---

### netway_send

**Status:** ✅ Implemented · **Category:** netway · **Since:** v2.0.0

Write data to an open stream socket.

**Source files:**

- `web/clawser-netway-tools.js`

**API surface:**

- `NetwaySendTool`

> **Note:** Parameters: handle (required), data (required), encoding (utf8/base64).

---

### netway_read

**Status:** ✅ Implemented · **Category:** netway · **Since:** v2.0.0

Read data from socket or accept connection from listener.

**Source files:**

- `web/clawser-netway-tools.js`

**API surface:**

- `NetwayReadTool`

---

### netway_close

**Status:** ✅ Implemented · **Category:** netway · **Since:** v2.0.0

Close a socket, listener, or datagram socket by handle.

**Source files:**

- `web/clawser-netway-tools.js`

**API surface:**

- `NetwayCloseTool`

---

### netway_resolve

**Status:** ✅ Implemented · **Category:** netway · **Since:** v2.0.0

Resolve a hostname to IP addresses via DNS.

**Source files:**

- `web/clawser-netway-tools.js`

**API surface:**

- `NetwayResolveTool`

> **Note:** Parameters: name (required), type (A/AAAA, default A).

---

### netway_status

**Status:** ✅ Implemented · **Category:** netway · **Since:** v2.0.0

List active sockets, listeners, and backends in the virtual network.

**Source files:**

- `web/clawser-netway-tools.js`

**API surface:**

- `NetwayStatusTool`

---

### netway_udp_send

**Status:** ✅ Implemented · **Category:** netway · **Since:** v2.0.0

Send a UDP datagram to an address.

**Source files:**

- `web/clawser-netway-tools.js`

**API surface:**

- `NetwayUdpSendTool`

---

### google_calendar_list

**Status:** ✅ Implemented · **Category:** google · **Since:** v2.0.0

List upcoming events from Google Calendar.

**Source files:**

- `web/clawser-google-tools.js`

**API surface:**

- `GoogleCalendarListTool`

> **Note:** Parameters: calendar_id (default primary), max_results (default 10), time_min (ISO 8601).

---

### google_calendar_create

**Status:** ✅ Implemented · **Category:** google · **Since:** v2.0.0

Create a new event on Google Calendar.

**Source files:**

- `web/clawser-google-tools.js`

**API surface:**

- `GoogleCalendarCreateTool`

> **Note:** Parameters: summary (required), start (required), end (required), description, location, calendar_id.

---

### google_gmail_search

**Status:** ✅ Implemented · **Category:** google · **Since:** v2.0.0

Search Gmail messages using Gmail query syntax.

**Source files:**

- `web/clawser-google-tools.js`

**API surface:**

- `GoogleGmailSearchTool`

> **Note:** Parameters: query (required), max_results (default 10).

---

### google_gmail_send

**Status:** ✅ Implemented · **Category:** google · **Since:** v2.0.0

Send an email via Gmail.

**Source files:**

- `web/clawser-google-tools.js`

**API surface:**

- `GoogleGmailSendTool`

> **Note:** Parameters: to (required), subject (required), body (required), cc, bcc.

---

### google_drive_list

**Status:** ✅ Implemented · **Category:** google · **Since:** v2.0.0

List files in Google Drive.

**Source files:**

- `web/clawser-google-tools.js`

**API surface:**

- `GoogleDriveListTool`

> **Note:** Parameters: query, max_results (default 20), folder_id.

---

### google_drive_read

**Status:** ✅ Implemented · **Category:** google · **Since:** v2.0.0

Read metadata and content of a Google Drive file.

**Source files:**

- `web/clawser-google-tools.js`

**API surface:**

- `GoogleDriveReadTool`

> **Note:** Parameters: file_id (required).

---

### google_drive_create

**Status:** ✅ Implemented · **Category:** google · **Since:** v2.0.0

Create a new file in Google Drive.

**Source files:**

- `web/clawser-google-tools.js`

**API surface:**

- `GoogleDriveCreateTool`

> **Note:** Parameters: name (required), content, mime_type (default text/plain), folder_id.

---

### linear_issues

**Status:** ✅ Implemented · **Category:** linear · **Since:** v2.0.0

List or search Linear issues with optional filters.

**Source files:**

- `web/clawser-linear-tools.js`

**API surface:**

- `LinearIssuesTool`

> **Note:** Parameters: team_id, state_name, assignee_id, first (default 20), query.

---

### linear_create_issue

**Status:** ✅ Implemented · **Category:** linear · **Since:** v2.0.0

Create a new issue in Linear.

**Source files:**

- `web/clawser-linear-tools.js`

**API surface:**

- `LinearCreateIssueTool`

> **Note:** Parameters: title (required), team_id (required), description, priority (0-4), assignee_id, label_ids.

---

### linear_update_issue

**Status:** ✅ Implemented · **Category:** linear · **Since:** v2.0.0

Update an existing Linear issue.

**Source files:**

- `web/clawser-linear-tools.js`

**API surface:**

- `LinearUpdateIssueTool`

> **Note:** Parameters: issue_id (required), title, description, state_name, priority, assignee_id.

---

### slack_channels

**Status:** ✅ Implemented · **Category:** slack · **Since:** v2.0.0

List Slack channels the bot has access to.

**Source files:**

- `web/clawser-slack-tools.js`

**API surface:**

- `SlackChannelsTool`

> **Note:** Parameters: limit (default 100), types (default public_channel,private_channel).

---

### slack_post

**Status:** ✅ Implemented · **Category:** slack · **Since:** v2.0.0

Post a message to a Slack channel.

**Source files:**

- `web/clawser-slack-tools.js`

**API surface:**

- `SlackPostTool`

> **Note:** Parameters: channel (required), text (required), thread_ts, unfurl_links (default true).

---

### slack_history

**Status:** ✅ Implemented · **Category:** slack · **Since:** v2.0.0

Retrieve recent messages from a Slack channel.

**Source files:**

- `web/clawser-slack-tools.js`

**API surface:**

- `SlackHistoryTool`

> **Note:** Parameters: channel (required), limit (default 20), oldest, latest.

---

### git_status

**Status:** ✅ Implemented · **Category:** git · **Since:** v1.5.0

Show working tree status.

**Source files:**

- `web/clawser-git.js`
- `web/clawser-git.d.ts`

**API surface:**

- `GitStatusTool`

---

### git_diff

**Status:** ✅ Implemented · **Category:** git · **Since:** v1.5.0

Show changes between commits, working tree, etc.

**Source files:**

- `web/clawser-git.js`

**API surface:**

- `GitDiffTool`

---

### git_log

**Status:** ✅ Implemented · **Category:** git · **Since:** v1.5.0

View commit history.

**Source files:**

- `web/clawser-git.js`

**API surface:**

- `GitLogTool`

---

### git_commit

**Status:** ✅ Implemented · **Category:** git · **Since:** v1.5.0

Commit staged changes with conventional commit support.

**Source files:**

- `web/clawser-git.js`

**API surface:**

- `GitCommitTool`

---

### git_branch

**Status:** ✅ Implemented · **Category:** git · **Since:** v1.5.0

Manage branches (list, create, switch).

**Source files:**

- `web/clawser-git.js`

**API surface:**

- `GitBranchTool`

---

### git_recall

**Status:** ✅ Implemented · **Category:** git · **Since:** v1.5.0

Query git history by natural language using episodic memory and full-text commit search.

**Source files:**

- `web/clawser-git.js`

**API surface:**

- `GitRecallTool`

---

### undo

**Status:** ✅ Implemented · **Category:** undo · **Since:** v1.5.0

Undo N turns of agent actions.

**Source files:**

- `web/clawser-undo.js`
- `web/clawser-undo.d.ts`

**API surface:**

- `UndoTool`

---

### undo_status

**Status:** ✅ Implemented · **Category:** undo · **Since:** v1.5.0

Preview what would be undone without executing.

**Source files:**

- `web/clawser-undo.js`

**API surface:**

- `UndoStatusTool`

---

### redo

**Status:** ✅ Implemented · **Category:** undo · **Since:** v1.5.0

Redo previously undone turns.

**Source files:**

- `web/clawser-undo.js`

**API surface:**

- `RedoTool`

---

### tool_build

**Status:** ✅ Implemented · **Category:** tool-builder · **Since:** v1.5.0

Create a custom tool at runtime with spec and code.

**Source files:**

- `web/clawser-tool-builder.js`
- `web/clawser-tool-builder.d.ts`

**API surface:**

- `ToolBuildTool`

> **Note:** validateToolCode performs safety scanning before execution.

---

### tool_test

**Status:** ✅ Implemented · **Category:** tool-builder · **Since:** v1.5.0

Test a custom tool with sample parameters.

**Source files:**

- `web/clawser-tool-builder.js`

**API surface:**

- `ToolTestTool`

---

### tool_list_custom

**Status:** ✅ Implemented · **Category:** tool-builder · **Since:** v1.5.0

List all custom-built tools.

**Source files:**

- `web/clawser-tool-builder.js`

**API surface:**

- `ToolListCustomTool`

---

### tool_edit

**Status:** ✅ Implemented · **Category:** tool-builder · **Since:** v1.5.0

Edit a custom tool's code or spec with version history and rollback.

**Source files:**

- `web/clawser-tool-builder.js`

**API surface:**

- `ToolEditTool`

---

### tool_remove

**Status:** ✅ Implemented · **Category:** tool-builder · **Since:** v1.5.0

Delete a custom tool.

**Source files:**

- `web/clawser-tool-builder.js`

**API surface:**

- `ToolRemoveTool`

---

### sandbox_run

**Status:** ✅ Implemented · **Category:** sandbox · **Since:** v1.5.0

Execute code in an isolated Worker or WASM sandbox.

**Source files:**

- `web/clawser-sandbox.js`
- `web/clawser-sandbox.d.ts`

**API surface:**

- `SandboxRunTool`

> **Note:** Sandbox tiers: minimal, web, fs, full, agent.

---

### sandbox_status

**Status:** ✅ Implemented · **Category:** sandbox · **Since:** v1.5.0

Show sandbox state and capability tier.

**Source files:**

- `web/clawser-sandbox.js`

**API surface:**

- `SandboxStatusTool`

---

### remote_pair

**Status:** ✅ Implemented · **Category:** remote · **Since:** v1.5.0

Create a remote pairing session with a code for another device.

**Source files:**

- `web/clawser-remote.js`
- `web/clawser-remote.d.ts`

**API surface:**

- `RemotePairTool`

---

### remote_revoke

**Status:** ✅ Implemented · **Category:** remote · **Since:** v1.5.0

Revoke a remote access session.

**Source files:**

- `web/clawser-remote.js`

**API surface:**

- `RemoteRevokeTool`

---

### remote_status

**Status:** ✅ Implemented · **Category:** remote · **Since:** v1.5.0

Show active remote sessions and connection status.

**Source files:**

- `web/clawser-remote.js`

**API surface:**

- `RemoteStatusTool`

---

### mount_list

**Status:** ✅ Implemented · **Category:** mount · **Since:** v1.0.0

List all filesystem mount points.

**Source files:**

- `web/clawser-mount.js`
- `web/clawser-mount.d.ts`

**API surface:**

- `MountListTool`

---

### mount_resolve

**Status:** ✅ Implemented · **Category:** mount · **Since:** v1.0.0

Resolve a mount path to its backing directory handle.

**Source files:**

- `web/clawser-mount.js`

**API surface:**

- `MountResolveTool`

---

### self_repair_status

**Status:** ✅ Implemented · **Category:** self-repair · **Since:** v1.5.0

Check system health and self-repair engine status.

**Source files:**

- `web/clawser-self-repair.js`
- `web/clawser-self-repair.d.ts`

**API surface:**

- `SelfRepairStatusTool`

---

### self_repair_configure

**Status:** ✅ Implemented · **Category:** self-repair · **Since:** v1.5.0

Set self-repair thresholds and policies.

**Source files:**

- `web/clawser-self-repair.js`

**API surface:**

- `SelfRepairConfigureTool`

---

### heartbeat_status

**Status:** ✅ Implemented · **Category:** heartbeat · **Since:** v1.5.0

Get current heartbeat check status.

**Source files:**

- `web/clawser-heartbeat.js`

**API surface:**

- `heartbeat_status`

---

### heartbeat_run

**Status:** ✅ Implemented · **Category:** heartbeat · **Since:** v1.5.0

Manually trigger all heartbeat checks.

**Source files:**

- `web/clawser-heartbeat.js`

**API surface:**

- `heartbeat_run`

---

### intent_classify

**Status:** ✅ Implemented · **Category:** intent · **Since:** v1.5.0

Classify a user message into an intent category.

**Source files:**

- `web/clawser-intent.js`
- `web/clawser-intent.d.ts`

**API surface:**

- `IntentClassifyTool`

---

### intent_override

**Status:** ✅ Implemented · **Category:** intent · **Since:** v1.5.0

Manage custom intent prefix overrides.

**Source files:**

- `web/clawser-intent.js`

**API surface:**

- `IntentOverrideTool`

---

### mesh_stream_open

**Status:** ✅ Implemented · **Category:** mesh-streams · **Since:** v2.0.0

Open a multiplexed data stream to a peer.

**Source files:**

- `web/clawser-mesh-tools.js`

**API surface:**

- `MeshStreamOpenTool`

> **Note:** Parameters: peerId (required), method (required), ordered (default true), encrypted.

---

### mesh_stream_close

**Status:** ✅ Implemented · **Category:** mesh-streams · **Since:** v2.0.0

Close an open data stream by ID.

**Source files:**

- `web/clawser-mesh-tools.js`

**API surface:**

- `MeshStreamCloseTool`

---

### mesh_stream_list

**Status:** ✅ Implemented · **Category:** mesh-streams · **Since:** v2.0.0

List active mesh streams, optionally filtered by peer.

**Source files:**

- `web/clawser-mesh-tools.js`

**API surface:**

- `MeshStreamListTool`

---

### mesh_file_send

**Status:** ✅ Implemented · **Category:** mesh-files · **Since:** v2.0.0

Send files to a peer (creates transfer offer).

**Source files:**

- `web/clawser-mesh-tools.js`

**API surface:**

- `MeshFileSendTool`

---

### mesh_file_accept

**Status:** ✅ Implemented · **Category:** mesh-files · **Since:** v2.0.0

Accept an incoming file transfer.

**Source files:**

- `web/clawser-mesh-tools.js`

**API surface:**

- `mesh_file_accept`

---

### mesh_file_list

**Status:** ✅ Implemented · **Category:** mesh-files · **Since:** v2.0.0

List pending and completed file transfers.

**Source files:**

- `web/clawser-mesh-tools.js`

**API surface:**

- `mesh_file_list`

---

### mesh_file_cancel

**Status:** ✅ Implemented · **Category:** mesh-files · **Since:** v2.0.0

Cancel an in-progress file transfer.

**Source files:**

- `web/clawser-mesh-tools.js`

**API surface:**

- `mesh_file_cancel`

---

### mesh_chat_create_room

**Status:** ✅ Implemented · **Category:** mesh-chat · **Since:** v2.0.0

Create a mesh chat room.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `MeshChatCreateRoomTool`

> **Note:** Parameters: name (required), maxMembers.

---

### mesh_chat_send

**Status:** ✅ Implemented · **Category:** mesh-chat · **Since:** v2.0.0

Send a message to a mesh chat room.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `MeshChatSendTool`

> **Note:** Parameters: roomId (required), body (required), type.

---

### mesh_chat_history

**Status:** ✅ Implemented · **Category:** mesh-chat · **Since:** v2.0.0

Get message history for a mesh chat room.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `MeshChatHistoryTool`

---

### mesh_chat_list_rooms

**Status:** ✅ Implemented · **Category:** mesh-chat · **Since:** v2.0.0

List all mesh chat rooms.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `MeshChatListRoomsTool`

---

### mesh_scheduler_submit

**Status:** ✅ Implemented · **Category:** mesh-scheduler · **Since:** v2.0.0

Submit a task to the distributed mesh scheduler.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `MeshSchedulerSubmitTool`

> **Note:** Parameters: type (required), payload (required), priority (low/normal/high/critical).

---

### mesh_scheduler_list

**Status:** ✅ Implemented · **Category:** mesh-scheduler · **Since:** v2.0.0

List pending tasks on the mesh scheduler.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `MeshSchedulerListTool`

---

### identity_create

**Status:** ✅ Implemented · **Category:** mesh-identity · **Since:** v2.0.0

Create a new Ed25519 mesh identity.

**Source files:**

- `web/clawser-mesh-identity-tools.js`

**API surface:**

- `IdentityCreateTool`

> **Note:** Parameters: label (optional).

---

### identity_list

**Status:** ✅ Implemented · **Category:** mesh-identity · **Since:** v2.0.0

List all mesh identities.

**Source files:**

- `web/clawser-mesh-identity-tools.js`

**API surface:**

- `IdentityListTool`

---

### identity_switch

**Status:** ✅ Implemented · **Category:** mesh-identity · **Since:** v2.0.0

Switch the active mesh identity.

**Source files:**

- `web/clawser-mesh-identity-tools.js`

**API surface:**

- `IdentitySwitchTool`

---

### identity_export

**Status:** ✅ Implemented · **Category:** mesh-identity · **Since:** v2.0.0

Export identity as JWK (optionally encrypted with passphrase).

**Source files:**

- `web/clawser-mesh-identity-tools.js`

**API surface:**

- `IdentityExportTool`

---

### identity_import

**Status:** ✅ Implemented · **Category:** mesh-identity · **Since:** v2.0.0

Import an identity from a JWK private key.

**Source files:**

- `web/clawser-mesh-identity-tools.js`

**API surface:**

- `IdentityImportTool`

---

### identity_delete

**Status:** ✅ Implemented · **Category:** mesh-identity · **Since:** v2.0.0

Delete a mesh identity.

**Source files:**

- `web/clawser-mesh-identity-tools.js`

**API surface:**

- `IdentityDeleteTool`

---

### identity_link

**Status:** ✅ Implemented · **Category:** mesh-identity · **Since:** v2.0.0

Create a cross-identity link.

**Source files:**

- `web/clawser-mesh-identity-tools.js`

**API surface:**

- `identity_link`

---

### identity_select_rule

**Status:** ✅ Implemented · **Category:** mesh-identity · **Since:** v2.0.0

Set the identity selection rule for automatic switching.

**Source files:**

- `web/clawser-mesh-identity-tools.js`

**API surface:**

- `identity_select_rule`

---

### federated_compute_submit

**Status:** ✅ Implemented · **Category:** mesh-compute · **Since:** v2.0.0

Submit a compute job to the federated mesh GPU cluster.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `federated_compute_submit`

---

### agent_swarm_create

**Status:** ✅ Implemented · **Category:** mesh-swarm · **Since:** v2.0.0

Create an agent swarm across mesh peers.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `agent_swarm_create`

---

### agent_swarm_status

**Status:** ✅ Implemented · **Category:** mesh-swarm · **Since:** v2.0.0

Get the status of an agent swarm.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `agent_swarm_status`

---

### mesh_health_status

**Status:** ✅ Implemented · **Category:** mesh-ops · **Since:** v2.0.0

Get health status of mesh peers.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_health_status`

---

### mesh_escrow_create

**Status:** ✅ Implemented · **Category:** mesh-payments · **Since:** v2.0.0

Create an escrow arrangement between peers.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_escrow_create`

---

### mesh_escrow_list

**Status:** ✅ Implemented · **Category:** mesh-payments · **Since:** v2.0.0

List escrow arrangements.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_escrow_list`

---

### mesh_escrow_release

**Status:** ✅ Implemented · **Category:** mesh-payments · **Since:** v2.0.0

Release funds from escrow.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_escrow_release`

---

### mesh_router_add_route

**Status:** ✅ Implemented · **Category:** mesh-routing · **Since:** v2.0.0

Add a routing entry to the mesh router.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_router_add_route`

---

### mesh_router_lookup

**Status:** ✅ Implemented · **Category:** mesh-routing · **Since:** v2.0.0

Lookup a route in the mesh router.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_router_lookup`

---

### mesh_timestamp_proof

**Status:** ✅ Implemented · **Category:** mesh-ops · **Since:** v2.0.0

Get a cryptographic timestamp proof from the mesh authority.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_timestamp_proof`

---

### mesh_stealth_save

**Status:** ✅ Implemented · **Category:** mesh-privacy · **Since:** v2.0.0

Save a stealth identity for anonymous mesh participation.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_stealth_save`

---

### mesh_stealth_restore

**Status:** ✅ Implemented · **Category:** mesh-privacy · **Since:** v2.0.0

Restore a previously saved stealth identity.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_stealth_restore`

---

### mesh_delta_sync_status

**Status:** ✅ Implemented · **Category:** mesh-sync · **Since:** v2.0.0

Get delta sync status for CRDT documents.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_delta_sync_status`

---

### mesh_gateway_status

**Status:** ✅ Implemented · **Category:** mesh-ops · **Since:** v2.0.0

Get mesh gateway node status.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_gateway_status`

---

### mesh_torrent_seed

**Status:** ✅ Implemented · **Category:** mesh-files · **Since:** v2.0.0

Seed a file for torrent-like distribution.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_torrent_seed`

---

### mesh_ipfs_store

**Status:** ✅ Implemented · **Category:** mesh-files · **Since:** v2.0.0

Store content to the mesh IPFS layer.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_ipfs_store`

---

### mesh_ipfs_retrieve

**Status:** ✅ Implemented · **Category:** mesh-files · **Since:** v2.0.0

Retrieve content from the mesh IPFS layer.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_ipfs_retrieve`

---

### mesh_acl_add_entry

**Status:** ✅ Implemented · **Category:** mesh-acl · **Since:** v2.0.0

Add an ACL entry for mesh resource access control.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_acl_add_entry`

---

### mesh_acl_check

**Status:** ✅ Implemented · **Category:** mesh-acl · **Since:** v2.0.0

Check ACL permission for a resource/action.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_acl_check`

---

### mesh_acl_list

**Status:** ✅ Implemented · **Category:** mesh-acl · **Since:** v2.0.0

List all ACL entries.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `mesh_acl_list`

---

### meshctl_status

**Status:** ✅ Implemented · **Category:** meshctl · **Since:** v2.0.0

Get mesh cluster status.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `meshctl_status`

---

### meshctl_pods

**Status:** ✅ Implemented · **Category:** meshctl · **Since:** v2.0.0

List pods in the mesh cluster.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `meshctl_pods`

---

### meshctl_compute

**Status:** ✅ Implemented · **Category:** meshctl · **Since:** v2.0.0

Mesh compute operations.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `meshctl_compute`

---

### meshctl_deploy

**Status:** ✅ Implemented · **Category:** meshctl · **Since:** v2.0.0

Deploy a service to the mesh cluster.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `meshctl_deploy`

---

### meshctl_exec

**Status:** ✅ Implemented · **Category:** meshctl · **Since:** v2.0.0

Execute a command in a mesh pod.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `meshctl_exec`

---

### meshctl_expose

**Status:** ✅ Implemented · **Category:** meshctl · **Since:** v2.0.0

Expose a service on the mesh.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `meshctl_expose`

---

### meshctl_top

**Status:** ✅ Implemented · **Category:** meshctl · **Since:** v2.0.0

Show resource usage across mesh peers.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `meshctl_top`

---

### meshctl_drain

**Status:** ✅ Implemented · **Category:** meshctl · **Since:** v2.0.0

Drain a mesh node for maintenance.

**Source files:**

- `web/clawser-mesh-peer-tools.js`

**API surface:**

- `meshctl_drain`

---

### dht_lookup

**Status:** ✅ Implemented · **Category:** mesh-dht · **Since:** v2.0.0

Lookup a key in the distributed hash table.

**Source files:**

- `web/clawser-mesh-tools.js`

**API surface:**

- `dht_lookup`

---

### dht_peers

**Status:** ✅ Implemented · **Category:** mesh-dht · **Since:** v2.0.0

Get DHT peer list.

**Source files:**

- `web/clawser-mesh-tools.js`

**API surface:**

- `dht_peers`

---

### dht_store

**Status:** ✅ Implemented · **Category:** mesh-dht · **Since:** v2.0.0

Store a value in the DHT.

**Source files:**

- `web/clawser-mesh-tools.js`

**API surface:**

- `dht_store`

---

### gpu_train_start

**Status:** ✅ Implemented · **Category:** mesh-gpu · **Since:** v2.0.0

Start a distributed GPU training job.

**Source files:**

- `web/clawser-mesh-tools.js`

**API surface:**

- `gpu_train_start`

---

### gpu_train_status

**Status:** ✅ Implemented · **Category:** mesh-gpu · **Since:** v2.0.0

Get the status of a GPU training job.

**Source files:**

- `web/clawser-mesh-tools.js`

**API surface:**

- `gpu_train_status`

---

### server_add

**Status:** ✅ Implemented · **Category:** server · **Since:** v2.0.0

Register a virtual server with route definitions.

**Source files:**

- `web/clawser-server.js`
- `web/clawser-server.d.ts`

**API surface:**

- `server_add`

---

### server_list

**Status:** ✅ Implemented · **Category:** server · **Since:** v2.0.0

List all registered virtual servers.

**Source files:**

- `web/clawser-server.js`

**API surface:**

- `server_list`

---

### server_start

**Status:** ✅ Implemented · **Category:** server · **Since:** v2.0.0

Start a virtual server.

**Source files:**

- `web/clawser-server.js`

**API surface:**

- `server_start`

---

### server_stop

**Status:** ✅ Implemented · **Category:** server · **Since:** v2.0.0

Stop a running virtual server.

**Source files:**

- `web/clawser-server.js`

**API surface:**

- `server_stop`

---

### server_update

**Status:** ✅ Implemented · **Category:** server · **Since:** v2.0.0

Update a virtual server configuration.

**Source files:**

- `web/clawser-server.js`

**API surface:**

- `server_update`

---

### server_remove

**Status:** ✅ Implemented · **Category:** server · **Since:** v2.0.0

Unregister a virtual server.

**Source files:**

- `web/clawser-server.js`

**API surface:**

- `server_remove`

---

### server_logs

**Status:** ✅ Implemented · **Category:** server · **Since:** v2.0.0

Get server access and error logs.

**Source files:**

- `web/clawser-server.js`

**API surface:**

- `server_logs`

---

### server_test

**Status:** ✅ Implemented · **Category:** server · **Since:** v2.0.0

Test a server route with a sample request.

**Source files:**

- `web/clawser-server.js`

**API surface:**

- `server_test`

---

### vault_store

**Status:** ✅ Implemented · **Category:** vault · **Since:** v1.5.0

Encrypt and store a secret in the credential vault.

**Source files:**

- `web/clawser-vault.js`
- `web/clawser-vault.d.ts`

**API surface:**

- `vault_store`

---

### vault_retrieve

**Status:** ✅ Implemented · **Category:** vault · **Since:** v1.5.0

Decrypt and retrieve a secret from the vault.

**Source files:**

- `web/clawser-vault.js`

**API surface:**

- `vault_retrieve`

---

### ext_cors_fetch

**Status:** ✅ Implemented · **Category:** extension · **Since:** v2.0.0

CORS-aware HTTP fetch via the Chrome extension (bypasses same-origin).

**Source files:**

- `web/clawser-cors-fetch.js`

**API surface:**

- `ext_cors_fetch`

---

### cross_tab_tool_bridge

**Status:** ✅ Implemented · **Category:** daemon · **Since:** v2.0.0

Bridge tool execution across browser tabs via BroadcastChannel.

**Source files:**

- `web/clawser-daemon.js`

**API surface:**

- `cross_tab_tool_bridge`

---

### MCP Tools (Dynamic)

**Status:** ✅ Implemented · **Category:** mcp · **Since:** v2.0.0

Tools dynamically discovered from connected MCP servers via JSON-RPC. Each MCP server exposes its own set of tools which are registered at runtime with svc:// prefix routing. Tool count varies based on connected servers.

**Source files:**

- `web/clawser-mcp.js`
- `web/clawser-mcp.d.ts`

**API surface:**

- `McpClient`
- `McpManager`
- `WebMCPDiscovery`

> **Note:** MCP tools are not statically defined — they are discovered at runtime from connected servers. The McpManager supports multiple concurrent server connections with svc:// prefix routing.

---

---

[← Core](./core.md) | [Index](./index.md) | [Providers →](./providers.md)
