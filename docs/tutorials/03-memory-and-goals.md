# Memory & Goals

Teach the agent persistent facts and track multi-step objectives with hierarchical goals.

**Time:** ~8 minutes

**Prerequisites:**
- Completed [Getting Started](01-getting-started.md)
- An LLM provider account configured

---

## 1. How Memory Works

Clawser's memory system stores key-value entries that persist across conversations. When the agent processes your messages, it recalls relevant memories using hybrid search (BM25 + vector similarity) and injects them into its context.

Memories are organized into four categories:

| Category | Purpose |
|----------|---------|
| **core** | Fundamental facts about the workspace or project |
| **learned** | Patterns and knowledge the agent discovered |
| **user** | Your stated preferences and requirements |
| **context** | Temporary situational context |

## 2. The Memory Panel

Press `Cmd+4` to open the **Memory** panel.

![Memory with entries](../screenshots/17-memory-with-entries.png)

The panel shows:
- **Add toggle** — Click to expand the form for manually adding memories
- **Search bar** — Query memories by keyword or semantic similarity
- **Category filter** — Filter by memory category
- **Semantic toggle** — Switch between keyword and semantic (vector) search
- **Memory entries** — Each entry shows its key, category badge, and content

## 3. Teaching the Agent via Chat

The simplest way to add memories is through conversation. Tell the agent something you want it to remember:

```
Remember that I prefer TypeScript for all new projects.
```

The agent calls the `agent_memory_store` tool to save this as a `user` category memory. You'll see the tool call in chat confirming the store.

You can also ask the agent to recall what it knows:

```
What do you know about my preferences?
```

The agent uses `agent_memory_recall` to search its memory and returns matching entries.

## 4. Adding Memories Manually

Click the **Add** button in the Memory panel to expand the form:

1. Enter a **Key** — A short label (e.g., `deploy_target`)
2. Enter **Content** — The full text to remember
3. Select a **Category** — core, learned, user, or context
4. Click **Save**

Manual entry is useful for seeding the agent with project context before starting a conversation.

## 5. Memory Hygiene

Clawser automatically maintains memory health:
- **Deduplication** — Similar entries are merged on workspace init
- **Cleanup** — Old `context` entries are pruned periodically
- **Limits** — The system prevents memory bloat by enforcing entry count limits

You can delete individual memories by clicking the delete icon on any memory row. You can also ask the agent to forget something:

```
Forget the entry about deploy targets.
```

## 6. Goal Tracking

Press `Cmd+5` to open the **Goals** panel.

![Goals with entries](../screenshots/18-goals-with-entries.png)

Goals track multi-step objectives with status, progress, and sub-goals.

## 7. Adding Goals

Type a goal description in the input field and click **Add Goal**. Or ask the agent in chat:

```
Add a goal: Build tutorial documentation for Clawser
```

The agent calls `goal_add` and the goal appears in the panel with `active` status.

## 8. Sub-Goals and Progress

Goals support hierarchical structure. Ask the agent to add sub-goals:

```
Add a sub-goal under "Build tutorial documentation": Write the getting-started guide
```

The agent creates a child goal linked to the parent. As sub-goals complete, the parent's progress updates.

Goal statuses are:
- **active** — Currently in progress
- **paused** — Temporarily on hold
- **completed** — Done
- **failed** — Could not be achieved

Update status through chat or by using the goal panel controls. The agent also updates goals proactively as tasks complete.

## 9. Goal Artifacts

Link files or outputs to goals as **artifacts**. This connects deliverables to the objectives they fulfill:

```
Link the file docs/tutorials/01-getting-started.md to the documentation goal
```

The agent calls `goal_add_artifact` to associate the file path with the goal.

## Next Steps

- [Files & Web](04-files-and-web.md) — Work with the OPFS file system
- [Chat & Conversations](02-chat-and-conversations.md) — Manage conversation history
- [Routines & Automation](10-routines-and-automation.md) — Automate recurring tasks
