# Clawser — Project Guide for AI Assistants

## What This Is

Clawser is a browser-native AI agent workspace. It runs entirely in the browser — no server, no bundler, no build step. Pure ES modules loaded directly from `web/`. Users get a complete agent runtime with persistent memory, goal tracking, ~100 tools, a virtual shell, scheduled tasks, and 38+ LLM backends.

## Architecture at a Glance

```
index.html (SPA)
  └─ clawser-app.js (orchestrator)
       ├─ ClawserAgent (clawser-agent.js) — run loop, memory, goals, scheduler
       │    ├─ EventLog — append-only JSONL persistence in OPFS
       │    ├─ HookPipeline — 6 lifecycle interception points
       │    └─ AutonomyController — readonly / supervised / full
       ├─ Providers (clawser-providers.js) — 3 tiers, 38+ LLM backends
       ├─ Tools (clawser-tools.js) — ~100 browser tools with permission system
       ├─ Skills (clawser-skills.js) — SKILL.md files, agentskills.io standard
       ├─ Shell (clawser-shell.js) — virtual terminal with pipes, builtins, jq
       └─ UI — clawser-ui-chat.js, clawser-ui-panels.js, clawser-ui-*.js
```

**Key principle**: the browser IS the OS. OPFS for files, Fetch for network, DOM for UI, Web Workers for sandboxing, localStorage for config.

## Module Layout

All source files are in `web/` and follow the naming pattern `clawser-{domain}.js`:

- **clawser-agent.js** — Agent core: EventLog, HookPipeline, AutonomyController, ClawserAgent
- **clawser-providers.js** — LLM providers (Tier 1: built-in, Tier 2: OpenAI-compatible, Tier 3: ai.matey)
- **clawser-tools.js** — BrowserTool base class, 70+ tools, permission system
- **clawser-codex.js** — Code-based tool execution via vimble sandbox
- **clawser-skills.js** — SkillParser, SkillStorage, SkillRegistry
- **clawser-shell.js** — Virtual shell with tokenizer, parser, command registry
- **clawser-gateway.js** — ChannelGateway: per-channel queues, scope isolation, scheduler lane, tenantId threading
- **clawser-pod.js** — ClawserPod: Pod base class + mesh networking (PeerNode, SwarmCoordinator)
- **clawser-embed.js** — EmbeddedPod: embeddable pod for external apps (backward-compat: ClawserEmbed)
- **clawser-mcp.js** — MCP client for external tool servers
- **clawser-state.js** — Global state, event bus, config cache
- **clawser-app.js** — Top-level orchestrator, workspace lifecycle

## Code Conventions

- Pure ES modules with named exports (no default exports)
- Private fields use `#` prefix (ES private class fields)
- `async`/`await` throughout; tools return `{ success, output, error? }`
- No semicolon enforcement — match the style of the file you're editing
- Zero npm runtime deps; external libs (vimble, ai.matey, fflate) loaded via CDN
- `BrowserTool` subclasses define: `name`, `description`, `parameters`, `permission`, `execute()`

## Testing — Test-Driven Development

**Always write or update tests when changing behavior.** The project uses `node:test` with `node:assert/strict`.

### Test Runner

```bash
# Run everything (249+ test files)
npm test

# Fast feedback loop (core + channels, 97 files)
npm run test:fast

# Individual groups
npm run test:core          # 89 files — agent, tools, providers, shell, etc.
npm run test:mesh          # 31 files — all mesh networking
npm run test:mesh-net      # 7 files — peer, transport, relay, gateway, websocket
npm run test:mesh-sync     # 4 files — sync, delta-sync, streams, migration
npm run test:mesh-identity # 6 files — identity, keyring, trust, acl, capabilities
npm run test:mesh-apps     # 6 files — apps, marketplace, payments, quotas
npm run test:mesh-ops      # 8 files — audit, consensus, scheduler, tools, wsh-bridge
npm run test:e2e           # 1 file — end-to-end scenarios
npm run test:changed       # only files with git changes

# Direct runner with options
node web/test/run-tests.mjs --group fast --concurrency 4
node web/test/run-tests.mjs --group mesh-net --list  # dry-run
```

### TDD Workflow

1. **Write the test first** in `web/test/clawser-<module>.test.mjs`
2. **Run it and watch it fail**: `node --import ./web/test/_setup-globals.mjs --test web/test/clawser-<module>.test.mjs`
3. **Implement the minimum code** to make it pass
4. **Run the relevant group** to check for regressions: `npm run test:fast`
5. **Refactor** with confidence — tests catch breakage

### Writing Tests

```js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub browser globals BEFORE importing the module
globalThis.BrowserTool = class { constructor() {} };

import { MyClass } from '../clawser-foo.js';

describe('MyClass', () => {
  it('does something', () => {
    assert.equal(new MyClass().value, 42);
  });
});
```

**Key rules:**
- Stub browser globals (`BrowserTool`, `window`, `document`) before importing modules
- Use `async` test functions, never callback-style `done`
- Clean up timers in `afterEach` to prevent process hangs
- `_setup-globals.mjs` provides localStorage, document, navigator stubs

### Adding a Tool (with tests)

1. Write tests for the new tool's `execute()` behavior
2. Create the class extending `BrowserTool` in `clawser-tools.js`
3. Register in `createDefaultRegistry()`
4. Run `npm run test:core` to verify

## Security Model

- **Permission levels**: `internal` (auto), `read` (auto), `write` (approve), `network` (approve), `browser` (approve)
- **Autonomy**: `readonly` → `supervised` → `full`, with per-hour rate limits and per-day cost limits
- **Safety pipeline**: InputSanitizer, ToolCallValidator, LeakDetector — always on by default
- **Storage**: API keys in localStorage (user's machine only), file size limits on OPFS writes, domain allowlist on fetch

## Plans & Session Notes

Please use the heynote skill to save plans in the `clawser-plans` buffer — one plan per block.
Block 0 is the index. Check for existing plans before creating new ones.
