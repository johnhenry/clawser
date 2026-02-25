# Clawser Configuration Guide

All configuration is managed through the Config panel (Cmd+9). Settings are persisted per-workspace in localStorage.

---

## Security

**Storage key**: `clawser_v1_security_{wsId}`

| Setting | Default | Description |
|---------|---------|-------------|
| Domain Allowlist | empty | Comma-separated domains. When set, `browser_fetch` is restricted to these domains only. |
| Max File Size | 10 MB | Maximum file size for `browser_fs_write`. |

Also displays:
- **API Key Warning** — Banner noting API keys are stored in unencrypted localStorage. Includes a "Clear all API keys" button.
- **Storage Quota** — Visual bar showing OPFS usage (percentage, color-coded: orange at high, red at critical).

---

## Autonomy & Costs

**Storage key**: `clawser_v1_autonomy_{wsId}`

| Setting | Default | Description |
|---------|---------|-------------|
| Autonomy Level | supervised | `readonly` (no tool execution), `supervised` (approval required), `full` (auto-execute) |
| Max Actions/Hour | 100 | Rate limit on tool executions per hour |
| Daily Cost Limit | $5.00 | Maximum daily spend (USD) across all providers |

The header badge shows autonomy level with color coding: red = readonly, amber = supervised, green = full.

A cost meter in the header shows `$spent / $limit` with warning colors at 50% and 80%.

---

## Identity

**Storage key**: `clawser_v1_identity_{wsId}`

| Setting | Default | Description |
|---------|---------|-------------|
| Format | plain | `plain` (free-text system prompt) or `aieos` (structured AIEOS v1.1) |
| Plain Text | — | Free-form system prompt override (plain mode only) |
| Name | — | Agent display name (AIEOS mode) |
| Role | — | Agent bio/role description (AIEOS mode) |
| Personality | — | Tone and linguistics style (AIEOS mode) |

Changes are compiled via `IdentityManager.compile()` and applied immediately to the agent's system prompt.

---

## Model Routing

Displays the provider fallback chain in priority order. Shows health badges per provider with availability status.

The header provider selector (`<select>`) controls which provider handles the current turn.

---

## Auth Profiles

Lists saved authentication credential profiles per provider. Each profile shows:
- Active indicator (filled/outline dot)
- Profile name and provider label
- Switch and Delete buttons

---

## Self-Repair

**Storage key**: `clawser_v1_selfrepair_{wsId}`

All settings are adjustable via sliders with live value display.

| Setting | Default | Description |
|---------|---------|-------------|
| Tool Timeout | 60s | Seconds before a tool call is considered stuck |
| No Progress | 120s | Seconds of agent inactivity before detection |
| Loop Detection | 3 | Consecutive identical tool calls before loop declared |
| Consecutive Errors | 5 | Error count before triggering recovery |
| Cost Runaway | $2.00 | Per-turn cost threshold before pausing |

Changes are applied live to the `StuckDetector` instance.

---

## Cache & Limits

**Storage key**: Part of `clawser_v1_config_{wsId}`

| Setting | Default | Description |
|---------|---------|-------------|
| Cache TTL | 30 min | Time before cached LLM responses expire |
| Cache Max Entries | 500 | Maximum cached response entries |
| Max Tool Iterations | 20 | Maximum tool-use loop iterations per turn |

Also displays cache hit/miss/entry statistics.

---

## Sandbox Capabilities

**Storage key**: `clawser_v1_sandbox_{wsId}`

Checkboxes controlling which capabilities are available to sandboxed code. Unchecking sets the corresponding tool permission to `denied`.

| Capability | Default | Maps to |
|------------|---------|---------|
| net_fetch | on | `browser_fetch` permission |
| fs_read | on | `browser_fs_read` permission |
| fs_write | on | `browser_fs_write` permission |
| dom_access | on | `browser_dom_query` permission |
| eval | on | `browser_eval_js` permission |
| crypto | on | Informational |

---

## Heartbeat Checks

**Storage key**: `clawser_v1_heartbeat_{wsId}`

Configurable list of periodic health checks. Default checks:

| Check | Interval | Description |
|-------|----------|-------------|
| Memory health | 5 min | Verify memory system responsiveness |
| Provider connectivity | 5 min | Check active provider reachability |
| OPFS accessible | 5 min | Verify filesystem availability |
| Event bus responsive | 5 min | Check event dispatch system |

Checks can be removed individually. The heartbeat runner executes checks silently when passing; alerts only on failure.

---

## OAuth

Displays cards for each registered OAuth provider. Each shows connection status with Connect/Disconnect buttons.

Supported providers: Google, GitHub, Notion, Slack, Linear.

Connecting prompts for a Client ID, then starts the OAuth authentication flow.

---

## Clean Old Conversations

| Setting | Default | Description |
|---------|---------|-------------|
| Max Age | 90 days | Threshold for identifying old conversations |

Provides a scan button that finds conversations exceeding the age threshold. Results show conversation name, age, and checkboxes for selective deletion. Includes Select All / Select None toggles.

---

## Dashboard

The Dashboard panel (deferred until first visit) shows real-time metrics refreshed every 5 seconds:

| Metric | Source | Description |
|--------|--------|-------------|
| Requests | metricsCollector | Total API request count |
| Tokens | metricsCollector | Cumulative token usage |
| Errors | metricsCollector | Error count |
| Latency | metricsCollector | Average response latency (ms) |

Also includes a **Log Viewer** showing the last 50 entries from the ring buffer log with timestamp, level (debug/info/warn/error), and message.

---

## Header Badges

Three live badges in the app header:

| Badge | Description |
|-------|-------------|
| **Autonomy** | Current level with color dot (red=readonly, amber=supervised, green=full) |
| **Daemon** | Phase indicator (Paused/Running/Stopped). Hidden when stopped. |
| **Remote** | Count of active remote sessions. Hidden when 0. |

---

## Storage Keys Reference

All workspace-scoped keys follow the pattern `clawser_v1_{type}_{wsId}`.

| Key Pattern | Contents |
|-------------|----------|
| `clawser_v1_security_{wsId}` | Domain allowlist, max file size |
| `clawser_v1_autonomy_{wsId}` | Autonomy level, rate/cost limits |
| `clawser_v1_identity_{wsId}` | Identity format and fields |
| `clawser_v1_selfrepair_{wsId}` | Self-repair thresholds |
| `clawser_v1_sandbox_{wsId}` | Sandbox capability toggles |
| `clawser_v1_heartbeat_{wsId}` | Heartbeat check definitions |
| `clawser_v1_config_{wsId}` | Cache TTL, max entries, tool iterations |
| `clawser_v1_tool_perms_{wsId}` | Per-tool permission overrides |
| `clawser_workspaces` | Workspace list |
| `clawser_active_workspace` | Active workspace ID |
| `clawser_debug` | Debug mode flag |
