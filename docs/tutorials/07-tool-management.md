# Tool Management

Control tool permissions, configure autonomy levels, and use the command palette for quick tool access.

**Time:** ~8 minutes

**Prerequisites:**
- Completed [Getting Started](01-getting-started.md)
- Familiarity with [Chat & Conversations](02-chat-and-conversations.md)

---

## 1. The Permission System

Every tool in Clawser has a **permission level** that controls whether it runs automatically or needs your approval:

| Level | Behavior |
|-------|----------|
| **auto** / **internal** / **read** | Runs without confirmation |
| **approve** / **network** / **browser** / **write** | Requires user approval (configurable) |
| **denied** | Blocked from executing |

When the agent tries to use a tool set to `approve`, you'll see a prompt in chat with **Accept** and **Deny** buttons.

## 2. The Tool Management Panel

Click **Tool Management** in the sidebar to open the panel. It has two tabs:

**Browser Tools tab:**

![Tool detail expanded](../screenshots/25-tool-detail-expanded.png)

Lists all ~100 registered tools grouped by category. Each tool shows:
- Tool name and description
- **Permission badge** — Click to cycle: `auto` → `approve` → `denied` → `auto`
- Expandable detail view with parameters

Click any tool row to expand it and see its parameter schema, description, and current permission.

**Shell Commands tab:**

![Shell command expanded](../screenshots/26-shell-cmd-expanded.png)

A browsable interface for all 59 CLI commands. Each command is expandable, showing description, usage syntax, and available flags. Use the search bar to find specific commands.

## 3. Changing Tool Permissions

Click the **permission badge** on any tool to cycle through permission levels. Changes persist per-workspace in localStorage.

For example, if you want `browser_fetch` to run without asking:
1. Find `browser_fetch` in the Browser Tools tab
2. Click its badge until it shows `auto`

To block a tool entirely, cycle the badge to `denied`.

> **Tip:** Be cautious setting network or write tools to `auto`. The `supervised` autonomy level exists to protect against unintended actions.

## 4. Autonomy Levels

Press `Cmd+9` to open the **Config** panel, then expand the **Autonomy & Costs** section.

![Config autonomy section](../screenshots/23-config-autonomy.png)

Three autonomy levels control the agent's overall freedom:

| Level | Behavior |
|-------|----------|
| **readonly** | No tool execution at all — the agent can only respond with text |
| **supervised** | Tools with `approve` permission require confirmation |
| **full** | All tools run automatically (per-tool `denied` overrides still apply) |

The header badge shows the current level: red for readonly, amber for supervised, green for full.

**Rate limits** in this section prevent runaway usage:
- **Max Actions/Hour** — Default 100
- **Daily Cost Limit** — Default $5.00

The cost meter in the header shows `$spent / $limit` and changes color at 50% (amber) and 80% (red).

## 5. The Command Palette

Press `Cmd+K` (or click the palette button in the chat input area) to open the **Command Palette**.

![Command palette with params](../screenshots/27-cmd-palette-params.png)

The palette provides quick access to any tool:

1. **Search** — Type to filter the tool list
2. **Select** — Click a tool to see its parameter form
3. **Fill** — Enter parameter values in the typed form fields (required fields are marked)
4. **Run** — Click Run to execute the tool directly

Results appear in the chat panel. The palette shows permission badges so you know what will require approval.

This is useful for:
- Running tools without typing a chat message
- Exploring available tools and their parameters
- Quick one-off operations (e.g., fetch a URL, search the web)

## 6. MCP Tools

Tools from connected MCP servers appear alongside browser tools, prefixed with `mcp_`. They follow the same permission system (all default to `network` permission) and appear in the command palette.

See [MCP & Extensions](09-mcp-and-extensions.md) for connecting MCP servers.

## 7. Custom Tools

The agent can create new tools at runtime using the **Tool Builder**:

```
Build a tool called "format_json" that takes raw JSON text and returns it pretty-printed
```

The agent uses `tool_build` to create the tool, which then appears in the tool list and command palette. Custom tools maintain version history and can be edited, tested, or removed.

## Next Steps

- [Agents & Delegation](08-agents-and-delegation.md) — Restrict tools per agent
- [Skills](06-skills.md) — Install skill packages
- [Routines & Automation](10-routines-and-automation.md) — Automate tool execution
