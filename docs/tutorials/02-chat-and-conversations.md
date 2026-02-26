# Chat & Conversations

Send messages, watch tool calls execute inline, and manage conversations with forking, renaming, and exporting.

**Time:** ~8 minutes

**Prerequisites:**
- Completed [Getting Started](01-getting-started.md)
- An LLM provider account configured

---

## 1. The Chat Panel

Press `Cmd+1` or click **Chat** in the sidebar. The chat panel has three areas:

- **Conversation bar** (top) — Shows the active conversation name with a dropdown for history
- **Message area** (center) — Displays the conversation thread
- **Input area** (bottom) — Text field, command palette button, and send button

![Workspace entry showing chat panel](../screenshots/14-workspace-entry.png)

Type your message and press `Cmd+Enter` to send. If your provider supports streaming, tokens render progressively with a blinking cursor.

## 2. Tool Calls in Chat

When the agent needs to perform an action — fetching a URL, reading a file, searching the web — it executes **tool calls**. These appear inline in the chat as collapsible cards showing the tool name, parameters, and result.

If your **Autonomy** level is set to `supervised` (the default), the agent asks for approval before running tools that require it. You'll see an approval prompt with Accept/Deny buttons.

> **Tip:** Switch to `full` autonomy in the Config panel if you want the agent to run tools without asking. See [Tool Management](07-tool-management.md) for details.

## 3. Conversation History

Click the **conversation bar** at the top of the chat panel to open the conversation dropdown.

![Conversation item bar](../screenshots/16-conv-item-bar.png)

The dropdown shows all conversations in the current workspace, sorted by most recently used. From here you can:

- **Switch** — Click any conversation to load it
- **Rename** — Click the rename icon to give a conversation a meaningful name
- **Delete** — Remove conversations you no longer need
- **Fork** — Create a copy of a conversation to explore a different direction
- **Export** — Download the conversation in multiple formats

## 4. Starting a New Conversation

Press `Cmd+N` to create a new conversation. The chat panel clears and you start fresh. Your previous conversation is preserved in the history dropdown.

Each conversation has its own:
- Message history
- Tool call log
- Shell session state
- Cost tracking

## 5. Forking a Conversation

Forking creates a snapshot of the current conversation that you can take in a different direction without losing the original.

Open the conversation dropdown and click the **fork icon** next to the conversation you want to fork. The fork appears in the dropdown with a "(fork)" suffix. You can rename it afterward.

Use forking when you want to:
- Try a different approach to a task
- Explore alternative solutions
- Preserve a working conversation before experimenting

## 6. Exporting Conversations

Export conversations in four formats:

| Format | Use Case |
|--------|----------|
| **Script** | Shell-compatible log of commands |
| **Markdown** | Readable document with messages and tool calls |
| **JSON** | Structured data for programmatic use |
| **JSONL** | Event log format for replay |

Open the conversation dropdown and click the **export icon**. Select your preferred format and the file downloads.

## 7. The Events Panel

Press `Cmd+6` to open the **Events** panel. This shows a chronological log of everything that happened during your session — tool calls, memory operations, goal updates, and message metadata.

![Events panel](../screenshots/15-events-panel.png)

Each event row shows a timestamp, event type badge, and detail summary. The events panel is useful for:
- Auditing what tools the agent used
- Debugging unexpected behavior
- Understanding the agent's decision process

## Next Steps

- [Memory & Goals](03-memory-and-goals.md) — Teach the agent persistent information
- [Files & Web](04-files-and-web.md) — Work with files and web content
- [Tool Management](07-tool-management.md) — Control which tools the agent can use
