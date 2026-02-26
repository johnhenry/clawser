# Agents & Delegation

Create custom agent definitions, reference other agents inline, and delegate tasks to sub-agents.

**Time:** ~10 minutes

**Prerequisites:**
- Completed [Getting Started](01-getting-started.md)
- Familiarity with [Chat & Conversations](02-chat-and-conversations.md)

---

## 1. What Are Agent Definitions?

An agent definition is a named configuration that controls the agent's personality and capabilities. Each definition includes:

- **Name** — A unique identifier
- **System prompt** — Custom instructions for the agent
- **Provider override** — Optionally use a different LLM provider
- **Tool restrictions** — Limit which tools the agent can access

Clawser ships with 5 built-in starter agents. You can create unlimited custom definitions.

## 2. The Agents Panel

Click **Agents** in the sidebar to open the panel.

![Agents panel](../screenshots/28-agents-form.png)

The panel shows all available agent definitions. Click any agent card to view or edit its configuration. The active agent is highlighted.

## 3. Switching Agents

Switch between agents in three ways:

**Header dropdown** — Click the workspace name area in the header to access the **Agent Picker** dropdown. Select any agent to switch.

**Chat command:**

```
Switch to the code-review agent
```

The agent uses the `switch_agent` tool to change the active definition.

**Keyboard:** The agent picker is accessible from the header without a keyboard shortcut.

When you switch agents, the system prompt changes but your conversation history remains. The new agent picks up where the previous one left off, just with different instructions.

## 4. Creating a Custom Agent

In the Agents panel, click the **New Agent** button (or ask the agent to create one). Fill in:

- **Name** — e.g., "researcher"
- **System Prompt** — Detailed instructions for this agent's role and behavior
- **Provider** — Optional override (e.g., use GPT-4o for this agent specifically)
- **Allowed Tools** — Optional whitelist of tools this agent can use

Example system prompt for a researcher agent:

```
You are a research assistant. Focus on gathering and synthesizing information.
Always cite your sources. Prefer web search and fetch tools.
Do not modify files unless explicitly asked.
```

Agent definitions are stored in OPFS — globally (`clawser_agents/`) or per-workspace (`.agents/`). Per-workspace agents override global ones with the same name.

## 5. @Agent References

Reference another agent inline with the `@agent-name` syntax:

```
@researcher Find the latest documentation on the Playwright testing framework
```

This creates a sub-conversation with the referenced agent. The referenced agent processes the message with its own system prompt and returns the result to the current conversation.

**Safeguards:**
- Maximum nesting depth of 3 to prevent circular references
- Visited-set tracking prevents infinite loops
- Each @agent reference runs in its own context

## 6. Consulting Agents

Use `consult_agent` to ask another agent for input without switching:

```
Consult the code-review agent about this implementation
```

The agent calls `consult_agent`, which sends your message to the target agent and returns its response. The active agent remains unchanged — you get a second opinion without switching context.

## 7. Delegating Tasks

For complex multi-step tasks, the agent can spawn isolated **sub-agents** via the `agent_delegate` tool:

```
Delegate: Research the top 5 JavaScript testing frameworks and write a comparison to docs/testing-comparison.md
```

Sub-agents run with:
- **Isolation** — Separate context from the parent agent
- **Tool restrictions** — Default to read/internal tools only; additional tools must be explicitly granted
- **Iteration limits** — Default max 10 iterations per sub-agent
- **Concurrency** — Up to 3 sub-agents can run simultaneously
- **Nesting** — Maximum depth of 2

The parent agent receives the sub-agent's result when it completes.

## 8. Agent Import/Export

Share agent configurations across workspaces:
- **Export** — Download an agent definition as a JSON file
- **Import** — Load an agent definition from a JSON file

This lets you build a library of specialized agents and reuse them across projects.

## Next Steps

- [Skills](06-skills.md) — Extend agents with skill packages
- [Tool Management](07-tool-management.md) — Fine-tune tool access per agent
- [Routines & Automation](10-routines-and-automation.md) — Automate agent tasks
