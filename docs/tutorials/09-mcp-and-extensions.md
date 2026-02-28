# MCP & Extensions

Connect external MCP servers, use wsh remote tools, and mount local folders for expanded tool access.

**Time:** ~8 minutes

**Prerequisites:**
- Completed [Getting Started](01-getting-started.md)
- Familiarity with [Tool Management](07-tool-management.md)

---

## 1. What Is MCP?

The **Model Context Protocol (MCP)** is a standard for connecting AI agents to external tool servers. Clawser's MCP client uses Streamable HTTP transport with JSON-RPC to discover and call tools exposed by any MCP server.

MCP tools appear alongside browser tools in the tool list, command palette, and chat — prefixed with `mcp_`.

## 2. Connecting an MCP Server

Press `Cmd+9` to open the **Config** panel, then expand the **MCP Servers** section.

![Config MCP section](../screenshots/24-config-mcp.png)

To connect:

1. Enter the server's **Endpoint URL** in the input field (e.g., `http://localhost:8080/mcp`)
2. Click **Connect**
3. Clawser discovers the server's available tools via JSON-RPC

Connected servers appear in the server list with their name and tool count. Each server's tools are automatically registered in the tool system.

**Via chat:**

```
Connect to the MCP server at http://localhost:8080/mcp
```

The agent calls `addMcpServer()` to establish the connection.

## 3. Using MCP Tools

Once connected, MCP tools work like any other tool. The agent discovers them automatically and can call them during conversations:

```
Use the database query tool to find all users created this week
```

MCP tools:
- Default to `network` permission (requires approval in supervised mode)
- Appear in the command palette with the `mcp_` prefix
- Have a 30-second configurable timeout
- Show in the Tool Management panel alongside browser tools

## 4. wsh Remote Tools

The **wsh** (WebSocket shell) protocol provides remote command execution, file transfer, PTY sessions, and CORS proxy capabilities.

Connect to a remote server:

```
Connect to my server via wsh
```

The agent calls `wsh_connect` to establish the connection.

## 5. wsh Tools

Ten tools interact with remote servers via wsh:

| Tool | Permission | Description |
|------|-----------|-------------|
| `wsh_connect` | approve | Connect to a remote server |
| `wsh_exec` | approve | Execute a command on the remote server |
| `wsh_fetch` | approve | Fetch a URL via curl on the server (CORS bypass) |
| `wsh_upload` | approve | Upload a file to the remote server |
| `wsh_download` | approve | Download a file from the remote server |
| `wsh_pty_open` | approve | Open an interactive PTY session |
| `wsh_pty_write` | approve | Write to a PTY session |
| `wsh_disconnect` | auto | Disconnect from a server |
| `wsh_sessions` | read | List active sessions |
| `wsh_mcp_call` | approve | Call an MCP tool on the server |

The CORS proxy (`wsh_fetch`) is useful for accessing URLs blocked by browser CORS restrictions, routing the request through the remote server via curl.

## 6. Mounting Local Folders

Click the **Mount Folder** button in the **Files** panel (`Cmd+3`) to grant Clawser access to a local directory using the File System Access API.

Mounted folders:
- Appear under `/mnt/` in the virtual file system
- Are read-only by default
- Can be listed and read using standard file tools
- Persist until the page is closed or the mount is removed

This lets the agent read your local project files, documentation, or configuration without copying them into OPFS.

Check current mounts:

```
List all mounted folders
```

The agent calls `mount_list` to show active mounts.

Resolve a file from a mount:

```
Read the file at /mnt/my-project/README.md
```

The agent uses `mount_resolve` to access the file from the mounted directory.

## 7. Managing Connections

| Action | How |
|--------|-----|
| Disconnect MCP server | Click remove in the MCP Servers section |
| Check server health | `wsh_sessions` or MCP server list in Config |
| View available tools | Tool Management panel |
| Remove mount | Unmount from the Files panel |

## Next Steps

- [Tool Management](07-tool-management.md) — Manage MCP tool permissions
- [Skills](06-skills.md) — Install skill packages for additional capabilities
- [Routines & Automation](10-routines-and-automation.md) — Automate MCP tool usage
