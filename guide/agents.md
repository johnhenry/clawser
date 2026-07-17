# Agents

Named agents, delegation, sub-agents, @mentions, import/export

---

### Agent Definitions

**Status:** ✅ Implemented · **Category:** definitions · **Since:** v1.0.0

Named agent configurations with custom system prompts, provider/model overrides, autonomy settings, tool restrictions, domain allowlists, cost caps, and max turns. Scoped as builtin (shipped), global (user-created), or workspace (project-specific). 5 built-in starter agents included.

**Source files:**

- `web/clawser-agent-storage.js`
- `web/clawser-agent-storage.d.ts`

**API surface:**

- `AgentDefinition`
- `BUILTIN_AGENTS`

> **Note:** AgentDefinition fields: id, name, description, color, icon, model, accountId, systemPrompt, temperature, maxTokens, contextWindow, autonomy, tools (mode/list/permissionOverrides), domainAllowlist, maxCostPerTurn, maxTurnsPerRun, scope, workspaceId, createdAt, updatedAt.

**See also:**

- AgentStorage
- Agent Picker Panel

---

### AgentStorage

**Status:** ✅ Implemented · **Category:** storage · **Since:** v1.0.0

Persistent agent definition storage with global and workspace scoping. OPFS-backed with listGlobal, listWorkspace, listAll, save, load, delete, getActive, setActive. Includes built-in agent seeding, export as JSON, and import with validation.

**Source files:**

- `web/clawser-agent-storage.js`
- `web/clawser-agent-storage.d.ts`

**API surface:**

- `AgentStorage`
- `AgentStorage.listGlobal`
- `AgentStorage.listWorkspace`
- `AgentStorage.listAll`
- `AgentStorage.save`
- `AgentStorage.load`
- `AgentStorage.delete`
- `AgentStorage.getActive`
- `AgentStorage.setActive`
- `AgentStorage.seedBuiltins`
- `AgentStorage.exportAgent`
- `AgentStorage.importAgent`
- `generateAgentId`
- `resolveAgentProvider`
- `migrateAgentAccounts`

---

### Agent Switching

**Status:** ✅ Implemented · **Category:** switching · **Since:** v1.0.0

Switch between named agent configurations at runtime. Applies the agent's system prompt, provider, model, autonomy settings, and tool restrictions. Also supports consulting another agent without switching (read-only query).

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `agent_switch`
- `agent_consult`

---

### Delegation

**Status:** ✅ Implemented · **Category:** delegation · **Since:** v1.5.0

Spawn isolated sub-agents for focused sub-tasks. Each sub-agent has its own conversation history but shares the parent's provider and tools. Supports concurrent execution via delegateAll. Max depth 2, max concurrency 3.

**Source files:**

- `web/clawser-delegate.js`
- `web/clawser-delegate.d.ts`

**API surface:**

- `SubAgent`
- `DelegateManager`
- `DelegateTool`
- `MAX_DELEGATION_DEPTH`
- `DEFAULT_MAX_ITERATIONS`
- `DEFAULT_MAX_CONCURRENCY`

> **Note:** SubAgentResult includes task, result, toolCalls, tokenUsage. SubAgentSummary aggregates multiple sub-agent results.

---

### Agent Import/Export

**Status:** ✅ Implemented · **Category:** portability · **Since:** v1.0.0

Export agent definitions as JSON for sharing. Import agent definitions from JSON with validation and deduplication.

**Source files:**

- `web/clawser-agent-storage.js`
- `web/clawser-agent-storage.d.ts`

**API surface:**

- `AgentStorage.exportAgent`
- `AgentStorage.importAgent`

---

---

[← Workspace](./workspace.md) | [Index](./index.md) | [Hardware →](./hardware.md)
