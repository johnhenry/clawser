# Core

Agent engine, event log, hooks, autonomy, context, caching, cost, errors, identity

---

### ClawserAgent

**Status:** ✅ Implemented · **Category:** agent-engine · **Since:** v1.0.0

Main agent orchestrator class. Manages the decide-execute run loop (up to 20 tool iterations), coordinates providers, tools, memory, goals, scheduler, hooks, autonomy, and persistence. Supports streaming via async generators, pause/resume, context compaction, checkpoint/restore, and workspace isolation. Created via static factory method ClawserAgent.create().

**Source files:**

- `web/clawser-agent.js`
- `web/clawser-agent.d.ts`

**API surface:**

- `ClawserAgent.create`
- `ClawserAgent.estimateTokens`
- `ClawserAgent.parseCron`
- `init`
- `reinit`
- `run`
- `runStream`
- `sendMessage`
- `pauseAgent`
- `resumeAgent`
- `setProvider`
- `setApiKey`
- `setModel`
- `getModel`
- `setSystemPrompt`
- `setMaxToolIterations`
- `getProviders`
- `applyAgent`
- `applyAutonomyConfig`
- `setFallbackExecutor`
- `registerToolSpec`
- `unregisterToolSpec`
- `refreshToolSpecs`
- `executeToolDirect`
- `isToolExternal`
- `getCodexPrompt`
- `getState`
- `getCheckpointJSON`
- `setWorkspace`
- `getWorkspace`

> **Note:** The run loop calls the LLM, processes tool calls, and iterates until the model produces a final text response or hits the max iteration limit. Parallel execution is supported for read-only tools. Performance target is less than 100ms per tool execution.

**See also:**

- EventLog
- HookPipeline
- AutonomyController
- Context Compaction

---

### EventLog

**Status:** ✅ Implemented · **Category:** event-sourcing · **Since:** v1.0.0

Append-only JSONL event store that records every agent lifecycle event. Supports 18+ event types including user_message, agent_message, tool_call, tool_result, error, autonomy_blocked, cache_hit, context_compacted, memory operations, goal changes, scheduler events, safety events, and provider errors. Provides query, summary, JSONL serialization, and session history derivation.

**Source files:**

- `web/clawser-agent.js`
- `web/clawser-agent.d.ts`

**API surface:**

- `EventLog`
- `append`
- `query`
- `summary`
- `events`
- `size`
- `clear`
- `load`
- `toJSONL`
- `EventLog.fromJSONL`
- `deriveSessionHistory`

> **Note:** Event types: user_message, agent_message, tool_call, tool_result, tool_result_truncated, error, autonomy_blocked, cache_hit, context_compacted, memory_stored, memory_forgotten, goal_added, goal_updated, scheduler_added, scheduler_fired, scheduler_removed, safety_input_flag, safety_tool_blocked, safety_output_blocked, safety_output_redacted, provider_error, stream_error.

**See also:**

- ClawserAgent

---

### HookPipeline

**Status:** ✅ Implemented · **Category:** hooks · **Since:** v1.0.0

Lifecycle interception system with 6 hook points. Hooks can transform, block, or audit messages and tool calls at each stage of the agent pipeline. Supports registration, enable/disable toggling, and ordered execution. Includes a built-in audit logger hook factory.

**Source files:**

- `web/clawser-agent.js`
- `web/clawser-agent.d.ts`

**API surface:**

- `HookPipeline`
- `register`
- `unregister`
- `setEnabled`
- `run`
- `list`
- `clearAll`
- `size`
- `createAuditLoggerHook`
- `HOOK_POINTS`

> **Note:** Hook points: beforeInbound, beforeToolCall, beforeOutbound, transformResponse, onSessionStart, onSessionEnd. Each hook receives a context object and can modify or block execution by returning block true.

**See also:**

- ClawserAgent
- SafetyPipeline

---

### AutonomyController

**Status:** ✅ Implemented · **Category:** autonomy · **Since:** v1.0.0

Capability boundary and rate-limiting engine. Enforces three autonomy levels (readonly, supervised, full), action-per-hour limits, cost-per-day caps, allowed operating hours, and integrates with the PolicyEngine for fine-grained tool-level decisions. Records actions and costs for stats tracking.

**Source files:**

- `web/clawser-agent.js`
- `web/clawser-agent.d.ts`

**API surface:**

- `AutonomyController`
- `level`
- `maxActionsPerHour`
- `maxCostPerDayCents`
- `allowedHours`
- `setPolicyEngine`
- `policyEngine`
- `canExecuteTool`
- `needsApproval`
- `checkLimits`
- `recordAction`
- `recordCost`
- `stats`
- `reset`

> **Note:** Three levels: readonly (no tool execution), supervised (approval required for approve-level tools), full (all tools auto-approved). Rate limits and cost caps are enforced independently of the level.

**See also:**

- PolicyEngine
- SafetyPipeline
- Autonomy Presets

---

### Autonomy Presets

**Status:** ✅ Implemented · **Category:** autonomy · **Since:** v1.5.0

Pre-configured autonomy profiles that bundle level, rate limits, cost caps, and allowed hours into named presets for quick configuration.

**Source files:**

- `web/clawser-autonomy-presets.js`

**API surface:**

- `autonomyPresets`

**See also:**

- AutonomyController

---

### Context Compaction

**Status:** ✅ Implemented · **Category:** context-management · **Since:** v1.0.0

Automatic and manual context window management. When conversation history exceeds approximately 12K tokens, the agent summarizes older messages to reclaim context space. Supports configurable thresholds and emits context_compacted events to the EventLog. Also includes session idle timeout with automatic compaction.

**Source files:**

- `web/clawser-agent.js`
- `web/clawser-agent.d.ts`

**API surface:**

- `compactContext`
- `estimateHistoryTokens`
- `truncateHistory`

> **Note:** Auto-triggers at approximately 12K tokens. Target compaction time under 2 seconds.

**See also:**

- ClawserAgent
- Response Caching

---

### Response Caching

**Status:** ✅ Implemented · **Category:** caching · **Since:** v1.0.0

LRU response cache with 500-entry capacity and 30-minute TTL. Uses FNV-1a hashing to create cache keys from message history and model name. Prevents redundant LLM calls for identical conversation states. Emits cache_hit events.

**Source files:**

- `web/clawser-providers.js`
- `web/clawser-providers.d.ts`

**API surface:**

- `ResponseCache`
- `ResponseCache.hash`
- `ResponseCache.cacheKey`
- `get`
- `set`
- `delete`
- `clear`
- `enabled`
- `ttl`
- `maxEntries`
- `size`
- `stats`

> **Note:** FNV-1a hashing for cache keys. Default 500 entries, 30-min TTL. Per-workspace, resets on switch.

**See also:**

- Cost Tracking
- Context Compaction

---

### Cost Tracking

**Status:** ✅ Implemented · **Category:** cost-management · **Since:** v1.0.0

Per-token cost tracking with model-specific pricing tables. CostLedger records every LLM call cost grouped by model and provider with configurable USD thresholds. ProfileCostLedger extends this for multi-profile cost isolation. CostTracker provides rolling 30-day window with daily totals, hourly buckets, and per-model breakdowns.

**Source files:**

- `web/clawser-providers.js`
- `web/clawser-providers.d.ts`
- `web/clawser-cost-tracker.js`
- `web/clawser-cost-events.js`

**API surface:**

- `CostLedger`
- `CostLedger.record`
- `CostLedger.totalByModel`
- `CostLedger.totalByProvider`
- `CostLedger.summary`
- `CostLedger.isOverThreshold`
- `CostLedger.setThreshold`
- `ProfileCostLedger`
- `ProfileCostLedger.profileSummary`
- `ProfileCostLedger.setProfileThreshold`
- `ProfileCostLedger.isProfileOverThreshold`
- `CostTracker`
- `CostTracker.recordCost`
- `CostTracker.getDailyTotals`
- `CostTracker.getPerModelBreakdown`
- `CostTracker.getHourlyBuckets`
- `CostTracker.getTotalCost`
- `estimateCost`
- `MODEL_PRICING`
- `getCostTracker`
- `recordCostEvent`

> **Note:** MODEL_PRICING contains per-token input/output prices for all known models. CostTracker uses a 30-day rolling window with 10K record cap. Cost caps enforced — agent refuses to run when daily cap is reached.

**See also:**

- Response Caching
- AutonomyController

---

### Error Classification

**Status:** ✅ Implemented · **Category:** error-handling · **Since:** v1.0.0

Classifies provider errors into 9 categories with retryability flags: auth, rate_limit, context_length, invalid_request, server_error, network, timeout, content_filter, and unknown. Used by the fallback chain and self-repair engine to determine recovery strategies.

**Source files:**

- `web/clawser-providers.js`
- `web/clawser-providers.d.ts`

**API surface:**

- `classifyError`
- `validateChatResponse`

> **Note:** 9 error categories: auth, rate_limit, context_length, invalid_request, server_error, network, timeout, content_filter, unknown. Each has a retryable boolean flag.

**See also:**

- Fallback Chain
- Self-Repair Engine

---

### Identity Compilation

**Status:** ✅ Implemented · **Category:** identity · **Since:** v1.5.0

System prompt compilation from identity definitions. Supports three formats: plain text, AIEOS (structured personality with psychology, linguistics, motivations, capabilities, history), and OpenClaw. The IdentityManager loads, validates, and compiles identities into system prompts with template variable injection.

**Source files:**

- `web/clawser-identity.js`
- `web/clawser-identity.d.ts`

**API surface:**

- `IdentityManager`
- `IdentityManager.load`
- `IdentityManager.compile`
- `IdentityManager.reset`
- `IdentityManager.fromJSON`
- `compileSystemPrompt`
- `detectIdentityFormat`
- `validateAIEOS`
- `DEFAULT_IDENTITY`

> **Note:** AIEOS identity format includes: version, names (display/full/aliases), bio, psychology (MBTI, OCEAN, moral compass, neural matrix), linguistics (formality, verbosity, catchphrases, forbidden words, vocabulary level, tone), motivations (core drive, goals, fears), capabilities (skills, tools, knowledge domains), physicality (avatar), and history.

**See also:**

- ClawserAgent
- Named Agents

---

### Intent Router

**Status:** ✅ Implemented · **Category:** routing · **Since:** v1.5.0

Message classification engine that routes user messages into intent categories (COMMAND, QUERY, TASK, CHAT, SYSTEM) with per-intent pipeline configuration controlling memory usage, tool access, LLM model hints, and token limits. Supports custom patterns, prefix overrides, and LLM-assisted classification for ambiguous cases.

**Source files:**

- `web/clawser-intent.js`
- `web/clawser-intent.d.ts`

**API surface:**

- `IntentRouter`
- `IntentRouter.classify`
- `IntentRouter.route`
- `IntentRouter.getPipelineConfig`
- `IntentRouter.addPattern`
- `IntentRouter.addOverride`
- `MessageIntent`
- `PIPELINE_CONFIG`
- `classifyWithLLM`
- `IntentClassifyTool`
- `IntentOverrideTool`

> **Note:** Pipeline config per intent controls: useMemory, useTools, useLLM, modelHint, maxTokens, useGoals, skipUI.

**See also:**

- ClawserAgent

---

### Fallback Chain

**Status:** ✅ Implemented · **Category:** reliability · **Since:** v1.5.0

Model fallback and routing system. Maintains a prioritized chain of provider/model pairs with health tracking, backoff, and cost-aware sorting. FallbackExecutor wraps the chain for automatic failover. ModelRouter adds intent-based model selection. ProviderHealth tracks per-provider availability.

**Source files:**

- `web/clawser-fallback.js`
- `web/clawser-fallback.d.ts`

**API surface:**

- `FallbackChain`
- `FallbackExecutor`
- `ProviderHealth`
- `ModelRouter`
- `createFallbackEntry`
- `backoff`
- `costAwareSort`
- `HINT_MODELS`

> **Note:** MAX_DELEGATION_DEPTH limits nested fallback. HINT_MODELS maps intent categories to recommended models.

**See also:**

- Error Classification
- ClawserAgent

---

### Codex

**Status:** ✅ Implemented · **Category:** code-execution · **Since:** v1.0.0

Code execution engine that extracts code blocks from LLM responses and runs them in the andbox sandbox. Supports Python-to-JS adaptation, auto-await for async code, and tool call extraction from execution results. Builds tool prompts for the system message.

**Source files:**

- `web/clawser-codex.js`
- `web/clawser-codex.d.ts`

**API surface:**

- `Codex`
- `extractCodeBlocks`
- `stripCodeBlocks`
- `adaptPythonisms`
- `autoAwait`
- `buildToolPrompt`

> **Note:** Executes in andbox Worker sandbox with configurable capability profiles.

**See also:**

- Sandbox
- Andbox CLI

---

### Logging

**Status:** ✅ Implemented · **Category:** observability · **Since:** v1.0.0

Structured logging system with four log levels (DEBUG, INFO, WARN, ERROR) and pluggable backends. Ships with ConsoleBackend, CallbackBackend, and EventLogBackend. LogFacade provides a unified interface with module context and data enrichment.

**Source files:**

- `web/clawser-log.js`
- `web/clawser-log.d.ts`

**API surface:**

- `LogLevel`
- `LogFacade`
- `ConsoleBackend`
- `CallbackBackend`
- `EventLogBackend`

**See also:**

- EventLog

---

### Metrics

**Status:** ✅ Implemented · **Category:** observability · **Since:** v1.5.0

Performance metrics collection for monitoring agent runtime behavior, including tool execution times, LLM latencies, and resource utilization.

**Source files:**

- `web/clawser-metrics.js`

**API surface:**

- `metrics`

**See also:**

- Logging
- Cost Tracking

---

### Undo/Redo System

**Status:** ✅ Implemented · **Category:** undo · **Since:** v1.5.0

Turn-based undo/redo with checkpoint snapshots. Each turn captures history length, memory operations, file operations, and goal operations. Supports preview before reverting and full redo capability. Handlers manage revert/restore/apply across memory, file, and goal layers.

**Source files:**

- `web/clawser-undo.js`
- `web/clawser-undo.d.ts`

**API surface:**

- `UndoManager`
- `TurnCheckpoint`
- `UndoTool`
- `UndoStatusTool`
- `RedoTool`

> **Note:** Tool names are undo, undo_status, and redo.

**See also:**

- ClawserAgent

---

### Goal System

**Status:** ✅ Implemented · **Category:** goals · **Since:** v1.0.0

Hierarchical goal tracking with decomposition, artifacts, dependencies, and cascading completion. Goals have priority levels (low/medium/high/critical), status tracking (active/paused/completed/failed), progress logging, and markdown import/export. Completion callbacks fire when goals finish.

**Source files:**

- `web/clawser-goals.js`
- `web/clawser-goals.d.ts`

**API surface:**

- `GoalManager`
- `GoalManager.addGoal`
- `GoalManager.updateStatus`
- `GoalManager.addSubGoal`
- `GoalManager.decompose`
- `GoalManager.addArtifact`
- `GoalManager.removeArtifact`
- `GoalManager.logProgress`
- `GoalManager.progress`
- `GoalManager.addDependency`
- `GoalManager.isBlocked`
- `GoalManager.toMarkdown`
- `GoalManager.fromMarkdown`
- `Goal`
- `GoalAddTool`
- `GoalUpdateTool`
- `GoalListTool`
- `GoalRemoveTool`
- `GoalDecomposeTool`
- `GoalAddArtifactTool`
- `GoalRemoveArtifactTool`

> **Note:** 7 tools covering goal_add, goal_update, goal_list, goal_remove, goal_decompose, goal_add_artifact, goal_remove_artifact.

**See also:**

- ClawserAgent

---

### State Management

**Status:** ✅ Implemented · **Category:** state · **Since:** v1.0.0

Centralized application state via clawser-state.js. Manages approximately 55 global fields including conversation history, workspace config, provider settings, tool permissions, and runtime flags. State is persisted to OPFS and restored on workspace load.

**Source files:**

- `web/clawser-state.js`

**API surface:**

- `state`

> **Note:** Approximately 55 global state fields managed centrally.

**See also:**

- Workspace Management

---

### CLI JSON Output Mode

**Status:** ✅ Implemented · **Category:** cli · **Since:** v2.1.0

Machine-readable JSON output mode for the clawser CLI. All subcommands support --json flag that emits structured JSON instead of human-readable text. Enables scripting and integration with external tools.

**Source files:**

- `web/clawser-cli.js`

**See also:**

- Clawser CLI

---

### CLI RPC Mode

**Status:** ✅ Implemented · **Category:** cli · **Since:** v2.1.0

JSON-RPC interface for the clawser CLI. Accepts tool calls over stdin/stdout or via WebSocket, enabling external programs to drive the agent programmatically. Supports all registered tools and returns structured results.

**Source files:**

- `web/clawser-rpc.mjs`
- `web/clawser-cli.js`

**API surface:**

- `RpcServer`

> **Note:** Can be exposed over a tunneled port via WISP transport for remote programmatic access.

**See also:**

- WISP Transport

---

### Session Branching

**Status:** ✅ Implemented · **Category:** sessions · **Since:** v2.1.0

Fork a terminal session at any point in its history, creating a new branch that shares the parent's history up to the fork point but diverges from there. Enables exploring alternative command sequences without losing the original session.

**Source files:**

- `web/clawser-terminal-sessions.js`

**See also:**

- Terminal Sessions

---

### Session Export

**Status:** ✅ Implemented · **Category:** sessions · **Since:** v2.1.0

Export terminal sessions in three formats: Markdown (readable), HTML (self-contained with syntax highlighting), and JSON (machine-readable). Includes automatic credential stripping for safe sharing — API keys, bearer tokens, and other secrets are redacted before export.

**Source files:**

- `web/clawser-session-export.js`

**API surface:**

- `exportSessionMarkdown`
- `exportSessionHTML`
- `exportSessionJSON`
- `SECRET_PATTERNS`

> **Note:** Sanitizes Anthropic, OpenAI, GitHub, Slack, and AWS credentials.

**See also:**

- Terminal Sessions

---

### Hot-Reload Extensions

**Status:** ✅ Implemented · **Category:** skills · **Since:** v2.1.0

File watcher that automatically re-discovers and re-activates skills when their source files change. Browser mode polls OPFS modification timestamps; Node.js/CLI mode uses native fs.watch. No restart required to pick up skill changes.

**Source files:**

- `web/clawser-skill-hot-reload.js`

**API surface:**

- `SkillHotReloader`

**See also:**

- Skills

---

### Embedded Linux Guest (v86 Proof of Concept)

**Status:** ✅ Implemented · **Category:** terminal · **Since:** v2.1.0

Proof-of-concept embedding a v86 WASM x86 Linux guest as a real terminal option. Loads v86 WASM + BIOS + Linux image from CDN, exposes a serial-console interface for sending commands and receiving output. AI shell handles agent commands; real Linux binaries execute in the guest.

**Source files:**

- `web/clawser-v86-guest.mjs`
- `web/clawser-v86-demo.html`

**API surface:**

- `LinuxGuest`

> **Note:** v86 is BSD-2-Clause. Demo page at clawser-v86-demo.html. Foundation for future full guest integration.

---

### Guest Mount Points

**Status:** ✅ Implemented · **Category:** mount · **Since:** v2.1.0

Mount v86 guest filesystem into the clawser virtual filesystem at /mnt/guest/. Shell commands on guest paths delegate to the guest OS via serial commands (ls, cat, stat). Uses MountableFs.mountAdapter() to hook into the VirtualFs layer.

**Source files:**

- `web/clawser-fs-guest-mount.mjs`

**API surface:**

- `mountGuest`
- `umountGuest`
- `GuestFsAdapter`

> **Note:** Phase 9 of Unix filesystem architecture. Requires a running v86 guest.

**See also:**

- Embedded Linux Guest (v86 Proof of Concept)
- Guest Filesystem Panel

---

---

[← Getting Started](./getting-started.md) | [Index](./index.md) | [Tools →](./tools.md)
