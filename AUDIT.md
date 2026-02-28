# Clawser Full-Repo Audit Report

**Date:** 2026-02-27
**Scope:** ~126 JS source files across 4 packages + ~63 top-level modules
**Methods:** Automated skills (audit-consistency, audit-completeness, scan, review) + manual targeted audit

## Summary Statistics

| Severity | Count |
|----------|-------|
| Critical | 5 |
| High | 18 |
| Medium | 25 |
| Low | 15 |
| **Total** | **63** |

---

## Critical Findings

### C1. Unrestricted eval() in EvalJsTool
**File:** `web/clawser-tools.js:814`
**Source:** Security scan
**Status:** DOCUMENTED (intentional feature with `approve` permission gate)

Uses `(0, eval)(code)` in the page's global scope. Prompt injection could trick the agent into executing malicious code with full access to localStorage API keys.

**Fix:** Replace with sandboxed execution via andbox Worker, or remove tool entirely.

### C2. new Function() in ToolBuilder Initialization
**File:** `web/clawser-app.js:114`
**Source:** Security scan
**Status:** FIX APPLIED

The ToolBuilder sandbox fallback uses `new Function(code)()` in the main thread, bypassing Worker sandbox isolation. The regex-based validation in `clawser-tool-builder.js` can be bypassed.

**Fix:** Route through andbox sandbox instead of raw `new Function()`.

### C3. Missing `output` field in wsh-incoming ToolResult responses
**File:** `web/clawser-wsh-incoming.js:226-237`
**Source:** Consistency audit
**Status:** FIX APPLIED

`handleToolCall()` returns `{ success: false, error: '...' }` missing the required `output` field per the ToolResult contract `{success, output, error?}`.

### C4. No agent destroy/shutdown method
**File:** `web/clawser-agent.js`
**Source:** Completeness audit
**Status:** FIX APPLIED

`ClawserAgent` has `init()`/`reinit()` but no `destroy()`. The agent holds history, hooks, scheduler jobs, and tool registrations with no cleanup path.

### C5. No application-level shutdown
**File:** `web/clawser-app.js`
**Source:** Completeness audit
**Status:** DOCUMENTED (follow-up task)

~30+ service singletons created but no coordinated shutdown. Only `beforeunload` persists terminal sessions.

---

## High Findings

### H1. Insecure PRNG for security tokens
**File:** `web/clawser-remote.js:28,38-43`
**Source:** Security scan
**Status:** FIX APPLIED

`Math.random()` used for pairing codes and bearer tokens instead of `crypto.getRandomValues()`.

### H2. API keys stored in plaintext localStorage as fallback
**File:** `web/clawser-accounts.js:70-83`
**Source:** Security scan
**Status:** DOCUMENTED (requires UI workflow changes)

When vault is locked, API keys remain as plaintext in localStorage.

### H3. postMessage without origin validation
**File:** `web/clawser-bridge.js:274,293`
**Source:** Security scan
**Status:** FIX APPLIED

`ExtensionBridge` uses wildcard `'*'` target origin and no origin check on listener.

### H4. Regex-based code validation is bypassable
**File:** `web/clawser-tool-builder.js:14-23`
**Source:** Security scan
**Status:** DOCUMENTED (mitigation: defense-in-depth with sandbox)

`FORBIDDEN_PATTERNS` can be trivially bypassed via string concatenation, bracket notation, Unicode escapes.

### H5. Codex _fetch bypasses domain allowlist
**File:** `web/clawser-codex.js:150-153`
**Source:** Security scan + Code review
**Status:** FIX APPLIED

The Codex `_fetch` capability calls native `fetch()` directly, bypassing FetchTool domain allowlist.

### H6. Safety validator tool name mismatch
**File:** `web/clawser-safety.js:74-83`
**Source:** Code review
**Status:** FIX APPLIED

`ToolCallValidator` checks `fs_read` etc. but actual names are `browser_fs_read` etc.

### H7. switchWorkspace() doesn't create kernel tenant
**File:** `web/clawser-workspace-lifecycle.js:120-277`
**Source:** Cross-module audit
**Status:** FIX APPLIED

`switchWorkspace()` destroys old kernel tenant but never creates one for the new workspace.

### H8. Agent _kernelIntegration never set (traceLlmCall dead code)
**File:** `web/clawser-agent.js:2184,1175-1183`
**Source:** Cross-module audit
**Status:** FIX APPLIED

`_kernelIntegration` on the agent is never assigned from workspace lifecycle, making `traceLlmCall` dead code.

### H9. Provider name always 'unknown' in traceLlmCall
**File:** `web/clawser-agent.js:1178`
**Source:** Cross-module audit
**Status:** FIX APPLIED

`#activeProvider` is a string but `.name` is accessed (always undefined).

### H10. Duplicate goal tool implementations
**File:** `web/clawser-tools.js:934-972` vs `web/clawser-goals.js:406-500`
**Source:** Consistency audit
**Status:** DOCUMENTED (follow-up: remove duplicates from clawser-tools.js)

Both `agent_goal_add`/`agent_goal_update` and `goal_add`/`goal_update` get registered.

### H11. Undeclared state properties
**File:** `web/clawser-app.js:76-110`
**Source:** Consistency audit
**Status:** DOCUMENTED (follow-up: declare in state schema)

16+ singleton properties assigned to `state` but not declared in `clawser-state.js`.

### H12. Undo handler stubs are empty
**File:** `web/clawser-app.js:86-87`
**Source:** Completeness audit
**Status:** DOCUMENTED (follow-up: implement undo handlers)

`revertHistory` and `revertMemory` handlers are comment-only, making undo non-functional.

### H13. Kernel integration stub methods return null
**Files:** `web/clawser-kernel-integration.js:125,225,292`
**Source:** Completeness audit
**Status:** DOCUMENTED (follow-up: implement when needed)

`createShellPipe()`, `createDaemonChannel()`, `createJobSignalController()` are stubs.

### H14. MCP disconnect doesn't notify server
**File:** `web/clawser-mcp.js:188-193`
**Source:** Completeness audit
**Status:** FIX APPLIED

`disconnect()` clears local state without sending termination notification.

### H15. Bluetooth event listener leak
**File:** `web/clawser-hardware.js:277`
**Source:** Completeness audit
**Status:** FIX APPLIED

`gattserverdisconnected` listener added on connect but never removed on disconnect.

### H16. Missing undo redo() counterpart
**File:** `web/clawser-undo.js`
**Source:** Completeness audit
**Status:** DOCUMENTED (follow-up: implement redo)

### H17. Silent error swallowing in SSE readers
**File:** `web/clawser-providers.js:57,91`
**Source:** Code review
**Status:** FIX APPLIED

Empty catch blocks silently swallow JSON parse errors in `readSSE()`/`readAnthropicSSE()`.

### H18. Unbounded history growth during agent run
**File:** `web/clawser-agent.js:1109-1290`
**Source:** Code review
**Status:** FIX APPLIED

No automatic context compaction triggered during the run loop. 20 iterations can add 40+ messages.

---

## Medium Findings

### M1. innerHTML usage throughout UI (XSS risk)
### M2. SSRF risk in browser_fetch
### M3. Pairing code brute-force vulnerability
### M4. No Content Security Policy
### M5. Missing OAuth state parameter (CSRF)
### M6. Skill script validation bypassable
### M7. Global mutable state for JSON-RPC ID counter
### M8. Missing AbortSignal propagation in streaming
### M9. Chrome AI session leak on error
### M10. EventLog event ID collision risk
### M11. WasmSandbox timeout timer leak
### M12. ResponseCache system prompt collision
### M13. compose() same transform both directions
### M14. AsyncBuffer high-water mark read-side hang
### M15. Tool naming convention inconsistencies
### M16. Four overlapping JS evaluation tools
### M17. Logging mechanism fragmentation
### M18. globalThis side-channel coupling in wsh-incoming
### M19. Dual sandbox runtimes (vimble vs andbox)
### M20. Event emission path duplication
### M21. onReverseConnect callback overwrite (no chaining)
### M22. stopListening() nulls relay handler instead of restore
### M23. chatStream() methods lack withRetry() wrapping
### M24. runStream() non-streaming fallback lacks try/catch
### M25. CheckpointManager.clear() doesn't delete stored data

---

## Low Findings

### L1. Math.random() for non-security identifiers
### L2. Safety pipeline can be disabled
### L3. No dependency lock file
### L4. Stale WASM comments in tools/agent
### L5. DaemonState history grows without bound
### L6. FsWriteTool reports string length not byte length
### L7. estimateCost returns negative for cached tokens
### L8. SignalController shutdownSignal leaks AbortController
### L9. Codex sequence counter is module-global
### L10. Missing PeripheralHandle offData/offDisconnect
### L11. No RateLimiter.reset() method
### L12. No CheckpointManager.deleteCheckpoint()
### L13. Skill regex patterns have unnecessary `g` flag
### L14. No ResourceTable.listAll()
### L15. WebSocketTransport doesn't handle text frames

---

## Fixes Applied Summary

| Finding | File | Change |
|---------|------|--------|
| C3 | clawser-wsh-incoming.js | Added `output: ''` to error returns |
| C4 | clawser-agent.js | Added `destroy()` method |
| H1 | clawser-remote.js | Replaced Math.random with crypto.getRandomValues |
| H3 | clawser-bridge.js | Added origin validation to postMessage listener |
| H5 | clawser-codex.js | Routed _fetch through FetchTool |
| H6 | clawser-safety.js | Added browser_fs_* tool names to validator |
| H7 | clawser-workspace-lifecycle.js | Create tenant + hook event log on workspace switch |
| H8 | clawser-workspace-lifecycle.js | Wire _kernelIntegration to agent |
| H9 | clawser-agent.js | Fixed provider name access (string, not .name) |
| H14 | clawser-mcp.js | Added session close notification on disconnect |
| H15 | clawser-hardware.js | Store and remove disconnect listener |
| H17 | clawser-providers.js | Added debug logging in SSE catch blocks |
| H18 | clawser-agent.js | Added token check + auto-compact in run loop |
| Bridge | packages-netway.js + index.mjs | Added missing re-exports (ServiceBackend, etc.) |
