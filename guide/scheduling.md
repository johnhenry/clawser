# Scheduling

Scheduler, Routines, triggers, guardrails, cron parser

---

### RoutineEngine

**Status:** ✅ Implemented · **Category:** engine · **Since:** v1.5.0

Central routine orchestrator. Creates, manages, and executes routines with configurable triggers (cron, event, webhook), actions (prompt execution, tool invocation, step chains), and guardrails. Approximately 90 lines of type definitions with full runtime implementation.

**Source files:**

- `web/clawser-routines.js`
- `web/clawser-routines.d.ts`

**API surface:**

- `RoutineEngine`
- `createRoutine`
- `matchFilter`
- `resetRoutineCounter`
- `TRIGGER_TYPES`
- `ACTION_TYPES`
- `DEFAULT_GUARDRAILS`
- `AUTO_DISABLE_THRESHOLD`

> **Note:** Trigger types: cron (5-field parser), event (EventTarget), webhook. Action types: prompt execution, tool invocation, step chains. Default guardrails: 3 runs/hour, $0.50/run, 5-minute timeout. Auto-disabled after 5 consecutive failures (AUTO_DISABLE_THRESHOLD).

**See also:**

- Routine Guardrails
- Cron Parser
- Scheduled Jobs

---

### Routine Guardrails

**Status:** ✅ Implemented · **Category:** guardrails · **Since:** v1.5.0

Safety limits for routine execution: max runs per hour, max cost per run, execution timeout, approval requirement, notifications on completion/failure, and auto-disable on consecutive failures. All configurable per-routine.

**Source files:**

- `web/clawser-routines.js`
- `web/clawser-routines.d.ts`

**API surface:**

- `DEFAULT_GUARDRAILS`

> **Note:** DEFAULT_GUARDRAILS: maxRunsPerHour (3), maxCostPerRunCents (50), timeoutMs (300000), requireApproval (false), notifyOnComplete (false), autoDisableOnFailure (true).

---

### Cron Parser

**Status:** ✅ Implemented · **Category:** cron · **Since:** v1.0.0

Five-field cron expression parser (minute, hour, day-of-month, month, day-of-week). Used by both the RoutineEngine and the agent's built-in scheduler.

**Source files:**

- `web/clawser-agent.js`

**API surface:**

- `ClawserAgent.parseCron`

---

### Routine Tools

**Status:** ✅ Implemented · **Category:** tools · **Since:** v1.5.0

Seven agent tools for routine management: routine_create, routine_list, routine_delete, routine_history, routine_run, routine_toggle, routine_update.

**Source files:**

- `web/clawser-routines.js`
- `web/clawser-routines.d.ts`

**API surface:**

- `RoutineCreateTool`
- `RoutineListTool`
- `RoutineDeleteTool`
- `RoutineHistoryTool`
- `RoutineRunTool`
- `RoutineToggleTool`
- `RoutineUpdateTool`

---

### Scheduler Lane

**Status:** ✅ Implemented · **Category:** execution · **Since:** v1.5.0

Routines execute through the Channel Gateway as virtual scheduler channels. Each routine gets key scheduler:{routineId} for serialization. Messages appear in chat with a green scheduler badge.

**Source files:**

- `web/clawser-routines.js`
- `web/clawser-gateway.js`

**API surface:**

- `RoutineEngine`

**See also:**

- Channel Gateway

---

### Scheduled Jobs (Agent Scheduler)

**Status:** ✅ Implemented · **Category:** agent-scheduler · **Since:** v1.0.0

Simpler one-shot and interval scheduling built into ClawserAgent. Supports once (with delay), interval (with period), and cron types. Agent-level tick() processes jobs.

**Source files:**

- `web/clawser-agent.js`

**API surface:**

- `addSchedulerJob`
- `listSchedulerJobs`
- `pauseSchedulerJob`
- `resumeSchedulerJob`
- `removeSchedulerJob`
- `tick`

> **Note:** Three schedule types: once (fire after delay), interval (fire every N ms), cron (fire on 5-field cron expression).

---

### Scheduler CLI

**Status:** ✅ Implemented · **Category:** cli · **Since:** v1.5.0

Shell command interface for routine management. 'cron' or 'schedule' command with subcommands for listing, adding, removing, pausing, resuming, inspecting history, and force-executing routines.

**Source files:**

- `web/clawser-scheduler-cli.js`

**API surface:**

- `registerSchedulerCli`

> **Note:** Subcommands: list, add, remove, pause, resume, history, run, status. Supports duration parsing (5m, 1h, 30s).

---

---

[← Daemon](./daemon.md) | [Index](./index.md) | [Safety →](./safety.md)
