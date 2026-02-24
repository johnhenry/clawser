# Clawser

Browser-native AI agent workspace with tools, memory, and goals.

Clawser is a pure JavaScript agent platform that runs entirely in the browser. It provides a complete agent runtime with persistent memory, goal tracking, scheduled tasks, 70+ tools, and support for 38+ LLM backends — all without a server.

## Features

- **Multi-Provider LLM Support** — 3-tier provider system: built-in (OpenAI, Anthropic, Chrome AI, Echo), OpenAI-compatible (Groq, OpenRouter, Together, Fireworks, Mistral, DeepSeek, xAI, Perplexity, Ollama, LM Studio), and ai.matey (24+ backends via CDN)
- **70+ Agent Tools** — Browser fetch, DOM manipulation, OPFS file system, clipboard, screenshots, web search, code execution, MCP integration, and more
- **Event-Sourced Persistence** — Full conversation history stored as append-only JSONL in OPFS. Fork, replay, and export any conversation
- **Memory System** — Persistent agent memory with TF-IDF and BM25+vector recall, automatic deduplication and hygiene
- **Goal Tracking** — Hierarchical goals with status tracking, progress bars, and artifact links
- **Scheduler** — Schedule tasks with one-shot, interval, or cron expressions (full 5-field cron support)
- **Skills System** — Install and activate portable agent skills following the [Agent Skills open standard](https://agentskills.io). Skills include YAML metadata, markdown instructions, and executable scripts
- **Workspaces** — Multiple isolated workspaces with separate history, memory, goals, and configuration
- **Virtual Shell** — AST-based shell with 59 commands, pipes, redirects, and OPFS file operations
- **Terminal Sessions** — Event-sourced terminal with session management, fork, and export
- **Streaming** — Progressive token rendering with async generator-based streaming
- **Context Compaction** — Automatic context window management via LLM-based summarization
- **Autonomy Controls** — Three levels (readonly, supervised, full) with per-hour rate limits and per-day cost limits
- **Hook Pipeline** — 6 lifecycle interception points for extending agent behavior
- **Response Caching** — LRU cache with TTL to avoid redundant API calls
- **MCP Client** — Connect to external Model Context Protocol servers for additional tools
- **PWA** — Installable as a Progressive Web App

## Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/your-org/clawser.git
   cd clawser
   ```

2. Serve the `web/` directory with any static file server:
   ```bash
   # Using Python
   python3 -m http.server 8080 --directory web

   # Using Node
   npx serve web

   # Using Deno
   deno run --allow-net --allow-read https://deno.land/std/http/file_server.ts web
   ```

3. Open `http://localhost:8080` in Chrome (131+ for Chrome AI, any modern browser otherwise).

4. Add an LLM provider account (OpenAI, Anthropic, etc.) in the Config panel.

5. Start chatting with your agent.

## Architecture

Clawser is built as a set of ES modules with no bundler, no build step, and no npm dependencies at runtime. All code runs directly in the browser.

```
┌─────────────────────────────────────────────────────┐
│                   index.html (SPA)                   │
├──────────┬──────────┬───────────┬───────────────────┤
│  UI Chat │ UI Panels│  Router   │    Shell / CLI     │
├──────────┴──────────┴───────────┴───────────────────┤
│              clawser-app.js (orchestrator)            │
├──────────┬──────────┬───────────┬───────────────────┤
│  Agent   │Providers │  Tools    │     Skills         │
│  Core    │ (38+)    │  (70+)    │  (agentskills.io)  │
├──────────┼──────────┼───────────┼───────────────────┤
│ EventLog │ SSE/REST │ Browser   │    OPFS + CDN      │
│  (JSONL) │          │ APIs      │                    │
├──────────┴──────────┴───────────┴───────────────────┤
│            Browser APIs (OPFS, Fetch, DOM)            │
└─────────────────────────────────────────────────────┘
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed breakdown.

## Module Map

| Module | Purpose |
|--------|---------|
| `clawser-agent.js` | Agent core: EventLog, HookPipeline, AutonomyController, run/stream loop |
| `clawser-providers.js` | LLM providers, SSE readers, cost tracking, response cache |
| `clawser-tools.js` | 29 browser tools with permission engine |
| `clawser-skills.js` | Skills parser, storage, registry, activation, remote install |
| `clawser-mcp.js` | MCP client for external tool servers |
| `clawser-codex.js` | Code execution sandbox via vimble |
| `clawser-shell.js` | Virtual shell: tokenizer, parser, executor, 22 builtins |
| `clawser-shell-builtins.js` | 37 extended shell commands |
| `clawser-cli.js` | AI-integrated CLI with 18 subcommands |
| `clawser-ui-chat.js` | Chat UI, streaming, conversations, replay |
| `clawser-ui-panels.js` | Panel UIs: files, memory, goals, tools, config |
| `clawser-state.js` | Global state singleton, event bus |
| `clawser-router.js` | Hash-based SPA router, 12 panels |
| `clawser-app.js` | App orchestration, workspace lifecycle |
| `clawser-agent-ref.js` | @agent sub-conversation dispatch |
| `clawser-agent-storage.js` | Agent definition CRUD |
| `clawser-terminal-sessions.js` | Terminal session management |
| `clawser-item-bar.js` | Reusable list UI component |

Plus 30+ feature modules for memory, goals, delegation, git, browser automation, sandbox, hardware, remote pairing, safety, self-repair, undo, routines, heartbeat, metrics, auth profiles, identity, intent routing, and more.

## Tool Categories

| Category | Tools | Permission |
|----------|-------|------------|
| **Network** | fetch, web_search | approve |
| **DOM** | dom_query, dom_modify | read / write |
| **File System** | fs_read, fs_write, fs_list, fs_delete | read / write |
| **Storage** | storage_get, storage_set, storage_list | read / write |
| **Clipboard** | clipboard_read, clipboard_write | read / write |
| **Navigation** | navigate, notify | browser |
| **Code** | eval_js | write |
| **Media** | screenshot, screen_info | read |
| **Memory** | memory_store, memory_recall, memory_forget | internal |
| **Goals** | goal_add, goal_update | internal |
| **Scheduler** | schedule_add, schedule_list, schedule_remove | internal |
| **Skills** | activate_skill, deactivate_skill, skill_search, skill_install, skill_update, skill_remove, skill_list | internal |
| **Agents** | switch_agent, consult_agent, ask_user_question | internal |
| **Shell** | shell_exec | write |
| **MCP** | mcp_* (dynamic from connected servers) | network |

## Provider Support

### Tier 1: Built-in
- **Echo** — Test/fallback (echoes input)
- **Chrome AI** — Local on-device inference (Chrome 131+, Gemini Nano)
- **OpenAI** — GPT-4o, GPT-4o-mini
- **Anthropic** — Claude Sonnet, Haiku, Opus

### Tier 2: OpenAI-Compatible
Groq, OpenRouter, Together, Fireworks, Mistral, DeepSeek, xAI, Perplexity, Ollama, LM Studio

### Tier 3: ai.matey
24+ backends via CDN lazy-load (universal adapter pattern)

## Skills

Clawser implements the [Agent Skills open standard](https://agentskills.io). Skills are portable packages containing:

- `SKILL.md` — YAML frontmatter (metadata) + markdown body (instructions)
- `scripts/` — Executable JS scripts (run in vimble sandbox)
- `references/` — Supporting documentation
- `assets/` — Static files

Skills can be installed globally or per-workspace, activated via slash commands (`/skill-name`) or the `activate_skill` tool, and browsed from a remote registry.

## Project Status

Clawser is in **beta**. The core agent, tool system, provider layer, and persistence are production-complete. See [ROADMAP.md](ROADMAP.md) for planned work.

## Development

No build step required. Edit JS files in `web/` and reload the browser.

**Running tests:**
Open `web/test.html` in Chrome to run the regression test suite (39 modules, browser-based).

**Rust reference crates:**
The `crates/` directory contains the original Rust/WASM core, kept as architectural reference. It is not used at runtime.

## `.reference/` Directory

The `.reference/` directory (gitignored) contains historical reference implementations from earlier stages of the project:

- **ironclaw** -- Original Rust/WASM agent core
- **nullclaw** -- Stripped-down null implementation used for testing the host bridge
- **zeroclaw** -- Zero-dependency JavaScript prototype that preceded the current architecture

These are kept locally for architectural reference and are not part of the runtime or distribution.

## License

MIT
