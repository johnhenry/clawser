# Getting Started with Clawser

Set up Clawser, create your first workspace, connect an LLM provider, and send your first message.

**Time:** ~10 minutes

**Prerequisites:**
- Chrome 131+ (for Chrome AI) or any modern browser
- Clawser served via a static file server (see [Quick Start](../../README.md#quick-start))

---

## 1. Launch Clawser

Serve the `web/` directory with any static file server and open it in your browser:

```bash
# Python
python3 -m http.server 8080 --directory web

# Node
npx serve web

# Docker
docker build -t clawser . && docker run -p 8080:80 clawser
```

Navigate to `http://localhost:8080`. You'll see the **Home Screen** with a list of workspaces and an **Accounts** section.

![Home screen](../screenshots/13-home-screen.png)

The home screen shows your workspace cards on the left and account management on the right. On a fresh install, you'll see one default workspace.

## 2. Add an LLM Provider Account

Before you can chat, Clawser needs access to an LLM provider. Click the **Add Account** button in the Accounts section on the home screen.

Fill in the form:

- **Service** — Select your provider (OpenAI, Anthropic, Groq, etc.)
- **Name** — A label for this account (e.g., "Work OpenAI")
- **API Key** — Your provider's API key
- **Model** — The default model to use (e.g., `gpt-4o`, `claude-sonnet-4-20250514`)

Click **Save**. The account appears in your account list with a green indicator.

> **Tip:** You can add multiple accounts for different providers. Clawser supports 38+ LLM backends across three tiers: built-in (OpenAI, Anthropic, Chrome AI), OpenAI-compatible (Groq, OpenRouter, Together, etc.), and ai.matey (24+ backends via CDN).

## 3. Enter a Workspace

Click on a **workspace card** to enter it. The view switches from the home screen to the workspace interface.

![Workspace entry](../screenshots/14-workspace-entry.png)

The workspace view has three main areas:

- **Sidebar** (left) — Panel navigation buttons. Click any button or use `Cmd+1` through `Cmd+9` to switch panels.
- **Main area** (center) — The active panel content. Starts on the **Chat** panel.
- **Header** (top) — Shows the workspace name, active provider, cost display, and status badges for autonomy, daemon, and remote sessions.

The green **status dot** in the header indicates the agent is ready.

## 4. Send Your First Message

With the **Chat** panel active, type a message in the input field at the bottom and press `Cmd+Enter` (or click the send button).

Try something simple:

```
What can you help me with?
```

The agent responds with a summary of its capabilities. If streaming is supported by your provider, you'll see tokens appear progressively with a blinking cursor.

## 5. Explore the Sidebar

Use the sidebar to navigate between panels. Here's what each panel does:

| Panel | Shortcut | Purpose |
|-------|----------|---------|
| Chat | `Cmd+1` | Conversations with the agent |
| Tool Calls | `Cmd+2` | History of tool executions |
| Files | `Cmd+3` | Browse OPFS file system |
| Memory | `Cmd+4` | Agent's persistent memory |
| Goals | `Cmd+5` | Track goals and sub-goals |
| Events | `Cmd+6` | Event log of all actions |
| Skills | `Cmd+7` | Install and manage skills |
| Terminal | `Cmd+8` | Virtual shell with 59 commands |
| Config | `Cmd+9` | All settings and configuration |

Additional panels (Tool Management, Agents, Dashboard) are accessible from the sidebar below the main nine.

## 6. Quick Configuration Check

Press `Cmd+9` to open the **Config** panel. Verify:

- Your **provider** is selected in the dropdown at the top
- The **system prompt** is set (or leave the default)
- The **Autonomy** level is set to `supervised` (the safe default — the agent asks before running tools)

You can explore the collapsible sections (Security, Autonomy & Costs, MCP Servers, etc.) as you grow more comfortable. See the [Configuration Guide](../CONFIG.md) for details on every option.

## Next Steps

- [Chat & Conversations](02-chat-and-conversations.md) — Learn about conversations, forking, and exporting
- [Memory & Goals](03-memory-and-goals.md) — Teach the agent and track progress
- [Terminal & CLI](05-terminal-and-cli.md) — Use the built-in virtual shell
