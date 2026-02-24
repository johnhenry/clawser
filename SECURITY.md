# Security

Clawser runs entirely in the browser. There is no server component. All code, data, and API keys reside on the user's machine. This document describes the security model, known limitations, and responsible disclosure process.

## Permission Model

Every tool has a `required_permission` level that maps to an enforcement policy:

| Permission Level | Default Policy | Description |
|-----------------|---------------|-------------|
| `internal` | `auto` | Always allowed. Agent-internal operations (memory, goals, scheduler). |
| `read` | `auto` | Always allowed. Read-only operations with no side effects. |
| `write` | `approve` | Requires user confirmation. Modifies files, DOM, or storage. |
| `network` | `approve` | Requires user confirmation. Makes HTTP requests or MCP calls. |
| `browser` | `approve` | Requires user confirmation. Navigation, notifications. |

Users can override the policy for any tool to `auto`, `approve`, or `denied` via the Config panel. Overrides are stored per-workspace in localStorage (`clawser_tool_perms_{wsId}`).

The `denied` policy blocks tool execution entirely, regardless of the agent's request.

## Autonomy Levels

The AutonomyController enforces three levels:

- **readonly** -- Only `internal` and `read` tools are allowed. No writes, no network.
- **supervised** -- Non-read tools require user approval before each execution.
- **full** -- All tools execute without prompting (subject to per-tool overrides).

Rate limiting is enforced per-hour (action count) and per-day (cost in cents). When limits are hit, the agent loop is blocked until the window resets.

## Code Execution Sandbox

When the LLM produces code blocks (used by Chrome AI and other non-native-tool providers), code runs in a [vimble](https://www.npmjs.com/package/vimble) sandbox:

- Code executes in an isolated `data:` URI module (separate realm)
- Only explicitly injected functions are available (browser tools, `fetch`, `print`)
- No access to `document`, `window`, `localStorage`, or other global APIs
- Results are captured and returned to the agent as tool results

### eval_js Tool

The `eval_js` tool executes JavaScript in the **global scope** (not sandboxed). This is intentional for power users who need DOM access. It has `write` permission (requires approval by default). Users who do not need it should set its permission to `denied`.

## Domain Allowlist

The `FetchTool` supports domain restriction. When configured, only URLs matching the allowlist are fetched. All other domains are rejected before the request is made. Configure via the workspace config panel.

## File Size Limits

The `FsWriteTool` enforces a maximum file size (default 10MB, configurable). Write operations exceeding this limit are rejected. The `FsReadTool` has a 50MB read limit.

## XSS Prevention

The `DomModifyTool` sanitizes HTML before injection:

1. **Sanitizer API** (preferred): Uses the browser's built-in `Sanitizer` API when available
2. **Fallback stripping**: Removes `<script>`, `<iframe>`, `<object>`, `<embed>`, event handlers (`on*` attributes), and `javascript:` URLs

The `NavigateTool` only permits `http:` and `https:` URL schemes, blocking `javascript:`, `data:`, and `file:` URLs.

## Storage Key Protection

The `StorageGetTool`, `StorageSetTool`, and `StorageListTool` block access to keys prefixed with `clawser_*`. This prevents the agent from reading or modifying its own configuration, API keys, or workspace data through the storage tools.

## API Key Storage

API keys are stored in `localStorage` as part of the workspace config (`clawser_config_{wsId}`). This is a known limitation:

- Keys are accessible to any JavaScript running on the same origin
- Keys are not encrypted at rest (the optional `SecretVault` module provides Web Crypto encryption, but localStorage remains the transport)
- Keys persist until explicitly cleared

**Recommendations**:
- Use API keys with minimal required permissions
- Set spending limits on your LLM provider accounts
- Clear keys when using shared machines
- Consider the `SecretVault` feature module for encrypted storage

## Hook Pipeline

The `HookPipeline` provides 6 interception points where custom hooks can inspect, modify, or block operations:

- `beforeInbound` -- Block or filter user messages
- `beforeToolCall` -- Prevent specific tool executions
- `beforeOutbound` -- Filter agent responses
- `transformResponse` -- Reshape LLM output
- `onSessionStart` / `onSessionEnd` -- Lifecycle events

Hooks can return `{ blocked: true, reason: '...' }` to halt execution.

## Safety Pipeline

The `SafetyPipeline` module (`clawser-safety.js`) provides defense-in-depth scanning of both inputs and outputs, including pattern matching for common injection techniques.

## Workspace Isolation

Each workspace has separate:
- Conversation history and event logs
- Memory entries
- Goal lists
- Tool permission overrides
- Configuration (provider, API key, model)
- OPFS file directory

Workspaces do not share state. Switching workspaces fully reinitializes the agent.

## Responsible Disclosure

If you discover a security vulnerability in Clawser, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainers with a description of the vulnerability, steps to reproduce, and any proof-of-concept code
3. Allow reasonable time for a fix before public disclosure
4. We will acknowledge receipt and provide updates on the fix timeline

We appreciate responsible disclosure and will credit reporters (with permission) in the changelog.
