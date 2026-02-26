# Routines & Automation

Set up cron schedules, event triggers, and webhook-based routines with built-in guardrails.

**Time:** ~10 minutes

**Prerequisites:**
- Completed [Getting Started](01-getting-started.md)
- Familiarity with [Tool Management](07-tool-management.md)

---

## 1. What Are Routines?

Routines are automated tasks that run on triggers — scheduled times, named events, or incoming webhooks. Each routine defines what the agent should do and when, with configurable guardrails to prevent runaway execution.

## 2. Trigger Types

Routines support three trigger types:

### Cron Triggers

Standard 5-field cron expressions for recurring schedules:

```
┌───────── minute (0–59)
│ ┌─────── hour (0–23)
│ │ ┌───── day of month (1–31)
│ │ │ ┌─── month (1–12)
│ │ │ │ ┌─ day of week (0–6, Sun=0)
│ │ │ │ │
* * * * *
```

Examples:
- `0 9 * * 1-5` — Weekdays at 9 AM
- `*/15 * * * *` — Every 15 minutes
- `0 0 1 * *` — First day of each month at midnight

### Event Triggers

Fire when a named event occurs within the agent system:

- `memory_store` — A memory was saved
- `goal_update` — A goal's status changed
- `tool_call` — Any tool was executed
- Custom event names you define

### Webhook Triggers

Fire when an external HTTP request hits the webhook endpoint. Useful for integrating with external services, CI/CD pipelines, or other tools.

## 3. Creating a Routine

Ask the agent to create a routine:

```
Create a routine that runs every morning at 9 AM to check my goals and summarize progress
```

The agent calls `routine_create` with:
- **Name** — Descriptive label
- **Trigger** — Type and configuration (cron expression, event name, or webhook path)
- **Prompt** — The instruction the agent executes when triggered
- **Guardrails** — Safety limits (optional, defaults apply)

You can also create routines through the `routine_create` tool in the command palette.

## 4. Guardrails

Every routine has configurable safety limits:

| Guardrail | Default | Description |
|-----------|---------|-------------|
| Max runs/hour | 3 | Prevents excessive execution |
| Max cost/run | $0.50 | Caps spending per execution |
| Timeout | 5 minutes | Kills long-running routines |
| Require approval | false | Ask before each run |
| Notify on failure | true | Alert when a run fails |
| Auto-retry | 1 | Retry count on failure |

**Auto-disable:** If a routine fails 5 consecutive times, it automatically disables itself. The last 50 run results are stored per routine for debugging.

## 5. Managing Routines

List all routines:

```
List my routines
```

The agent calls `routine_list` and shows each routine's name, trigger, status, and recent run history.

Delete a routine:

```
Delete the morning summary routine
```

Run a routine manually:

```
Run the morning summary routine now
```

The `routine_run` tool executes the routine immediately, bypassing its trigger schedule.

## 6. The Scheduler

In addition to routines, Clawser has a simpler **Scheduler** for one-off and repeating tasks:

| Type | Example |
|------|---------|
| **Once** | Run a task at a specific time |
| **Interval** | Run every N minutes/hours |
| **Cron** | Full 5-field cron expression |

Create scheduled jobs through chat:

```
Schedule a task to compact my context every 2 hours
```

The agent uses `agent_schedule_add` with the appropriate schedule type.

Manage jobs:

```
List scheduled jobs
Remove the context compaction job
```

## 7. Example: Daily Digest Routine

Here's a practical example combining multiple features:

```
Create a routine called "daily-digest" with a cron trigger "0 17 * * 1-5" that:
1. Lists all goals and their status
2. Summarizes memories added today
3. Reports total cost for the day
4. Writes the digest to files/daily-digest-{date}.md
```

This runs at 5 PM on weekdays, uses multiple tools (goal_list, memory_recall, fs_write), and produces a file artifact.

## 8. Event-Driven Workflows

Event triggers enable reactive automation:

```
Create a routine triggered by the "goal_update" event that:
- Checks if any goal reached 100% completion
- If so, sends a notification with the goal name
```

This fires whenever a goal is updated, checks for completions, and notifies you. Combined with sub-goals and artifacts, this creates a project tracking workflow.

## 9. Self-Repair Integration

The **Self-Repair** system (configurable in Config → Self-Repair) monitors for stuck conditions and automatically recovers. It watches for:

- Tool timeouts (default 60s)
- No progress (default 120s)
- Loop detection (3 consecutive identical operations)
- Cost runaway ($2.00/turn)

Self-repair activates automatically and doesn't require routine configuration. It complements routines by handling unexpected failures.

## Next Steps

- [Tool Management](07-tool-management.md) — Control which tools routines can access
- [Agents & Delegation](08-agents-and-delegation.md) — Delegate routine tasks to sub-agents
- [MCP & Extensions](09-mcp-and-extensions.md) — Trigger routines from external services
