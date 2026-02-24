# Clawser Roadmap

## Current Status (Feb 2026)

Clawser is a **beta-quality** browser-native AI agent platform. The core runtime is functionally complete with 48+ JS modules, 70+ tools, and 38+ LLM provider backends. The project has transitioned from a Rust/WASM architecture to pure JavaScript.

### What Works
- Full agent loop with streaming, tool calling, and context compaction
- Event-sourced conversation persistence with fork, replay, and export
- 3-tier provider system supporting 38+ LLM backends
- 29 browser tools with permission engine (auto/approve/denied)
- Skills system (agentskills.io standard) with OPFS storage and remote registry
- Virtual shell with 59 commands, pipes, and redirects
- Multi-workspace isolation with separate state per workspace
- Autonomy controls with rate and cost limiting
- Memory system with hybrid BM25+vector recall
- Goal tracking, scheduler (cron), hook pipeline, response cache

---

## Phase 1: Foundation (Now — 2 weeks)

Priority: Documentation, testing, and critical fixes.

### Documentation
- [x] README.md — Project overview and quick start
- [x] ARCHITECTURE.md — System design and module map
- [x] ROADMAP.md — This document
- [ ] LICENSE — Add MIT license file at project root
- [ ] CHANGELOG.md — Document version history from git log
- [ ] CONTRIBUTING.md — Contributor guidelines
- [ ] API.md — JSDoc-generated API reference for all modules

### Critical Fixes
- [ ] **Execution timeout** — Add Promise.race() timeout to Codex/vimble sandbox execution
- [ ] **MCP tool wiring** — Create McpToolAdapter to bridge MCP tools into agent's tool loop
- [ ] **Skill activation lock cleanup** — Move lock deletion to finally block

### Testing Infrastructure
- [ ] Evaluate browser test runners (Playwright, Puppeteer) for CI automation
- [ ] Set up GitHub Actions for automated test runs
- [ ] Add test coverage reporting

---

## Phase 2: Stability (2-4 weeks)

Priority: Robustness, error handling, and developer experience.

### Architecture Refactoring
- [ ] **Split clawser-app.js** into focused modules:
  - `clawser-bootstrap.js` — Service singleton creation
  - `clawser-workspace-lifecycle.js` — initWorkspace/switchWorkspace
  - `clawser-route-handler.js` — handleRoute logic
  - `clawser-home-views.js` — Home view rendering
- [ ] **State management** — Evaluate moving from global singleton to module-scoped state or lightweight DI
- [ ] **Router panel source of truth** — Consolidate PANEL_NAMES Set, allPanels Array, and panelMap Object into one

### Error Handling
- [ ] **Tool error recovery** — Catch tool failures in Codex instead of throwing (return error object)
- [ ] **Sub-agent recursion guard** — Maintain visited set in @agent reference processing
- [ ] **MCP timeout** — Add AbortController with configurable timeout to MCP RPC calls
- [ ] **Conversation locking** — Prevent state corruption when switching conversations mid-send

### Provider Improvements
- [ ] **MateyProvider streaming** — Return actual usage stats instead of stub
- [ ] **Chrome AI session pooling** — Reuse sessions for back-to-back requests
- [ ] **Cost estimation accuracy** — Account for prompt caching discounts
- [ ] **Anthropic message merging** — Handle string/array content type mismatch

### Configuration
- [ ] **Extract hardcoded limits** — Max iterations (20), result length (1500), cache size (500) to config
- [ ] **Configurable tool result truncation** — With user feedback when truncated

---

## Phase 3: Polish (1-2 months)

Priority: UX, accessibility, and production readiness.

### Accessibility & UX
- [ ] **ARIA labels** — Add semantic accessibility attributes to all interactive elements
- [ ] **Keyboard shortcuts** — Implement keyboard navigation for panels, conversations, tools
- [ ] **prefers-reduced-motion** — Respect user motion preferences
- [ ] **Light mode** — Add theme toggle (dark/light/system)
- [ ] **Responsive design** — Media queries for tablet and mobile layouts
- [ ] **Item bar search** — Add search/filter for long conversation and session lists
- [ ] **File browser pagination** — Incremental loading for large directory trees
- [ ] **Tool permission tooltips** — Explain what auto/approve/denied means in UI

### Shell Improvements
- [ ] **Variable substitution** — Implement $VAR, ${VAR}, $(cmd) expansion
- [ ] **Glob expansion** — Implement *, ?, [] pattern matching
- [ ] **Stderr redirect** — Support 2>, 2>&1 syntax
- [ ] **Shell builtins quality** — Add missing flags to grep (-A/-B/-C), sed (address ranges), diff (-u)

### Security Hardening
- [ ] **Security audit** — Review permission model, XSS prevention, eval safety
- [ ] **Skill validation** — Static analysis before activation (detect dangerous patterns)
- [ ] **eval_js documentation** — Clearly document global scope risks vs vimble sandbox

### Build & Distribution
- [ ] **PWA icons** — Proper multi-size icon set replacing SVG emoji
- [ ] **PWA scope** — Add scope field to manifest.json
- [ ] **Service Worker** — Offline support and caching
- [ ] **Clean up Rust artifacts** — Add target/ to .gitignore, remove from history if needed

---

## Phase 4: Advanced Features (2-4 months)

Priority: Multi-tab, background autonomy, and collaboration.

### Multi-Tab Coordination
- [ ] **SharedWorker** — Cross-tab state synchronization
- [ ] **Tab-aware agent** — Detect and coordinate with other Clawser tabs
- [ ] **Shared workspace** — Multiple tabs working in the same workspace without conflict

### Background Autonomy
- [ ] **Service Worker agent** — Run scheduled tasks when browser tab is closed
- [ ] **Push notifications** — Alert user when background task completes
- [ ] **Persistent daemon** — Long-running goal execution across sessions

### Skill Ecosystem
- [ ] **Skill dependency system** — Express inter-skill requirements
- [ ] **Skill versioning UI** — Show diffs before upgrade
- [ ] **Skill marketplace** — Browseable catalog with ratings and reviews
- [ ] **Skill templates** — Starter kits for common skill patterns

### Collaboration
- [ ] **Workspace sharing** — Export/import workspace state
- [ ] **Agent definition sharing** — Publish/discover agent configurations
- [ ] **Conversation export** — Rich export formats (HTML, PDF)

### Performance
- [ ] **Benchmark suite** — Validate 50ms checkpoint, <64MB footprint targets from PRD
- [ ] **Memory recall optimization** — Cache frequent queries
- [ ] **Lazy panel rendering** — Only render active panel DOM

---

## Phase 5: Ecosystem (4-6 months)

Priority: Integrations, API, and community.

### Integrations
- [ ] **GitHub integration** — PR review, issue management, code search
- [ ] **Calendar integration** — Schedule awareness, meeting prep
- [ ] **Email integration** — Draft, summarize, triage
- [ ] **Slack/Discord** — Channel monitoring, response drafting

### Developer API
- [ ] **Plugin API** — Formal extension point for third-party tools
- [ ] **TypeScript definitions** — .d.ts files for all modules
- [ ] **npm package** — Publish core agent as reusable library
- [ ] **Embedding API** — Drop Clawser into any web app

### Community
- [ ] **Skills registry** — Launch public skills registry
- [ ] **Documentation site** — Hosted docs with tutorials and examples
- [ ] **Demo site** — Live demo with Echo provider (no API key required)

---

## Legacy Cleanup

The following items address technical debt from the architecture transition:

- [ ] Update PRD.md to reflect pure JS architecture (currently describes Rust/WASM)
- [ ] Archive or remove Rust demo binaries (likely broken post-JS rewrite)
- [ ] Fix Cargo.toml edition field (says "2024", should be "2021")
- [ ] Remove .reference/ directory or document its purpose
- [ ] Clean up 339MB target/ directory from repository

---

## Design Principles

These principles guide development decisions:

1. **Browser-native** — No server required. OPFS for storage, Fetch for network, DOM for UI.
2. **Zero build step** — ES modules loaded directly. No webpack, no npm, no transpilation.
3. **Provider agnostic** — Any LLM backend works. Structured tool calls or code-based execution.
4. **Event-sourced** — Every state change is an event. Full auditability and replay.
5. **Graceful degradation** — Always have a fallback. Streaming → non-streaming, v2 → v1, LLM → truncation.
6. **Workspace isolation** — Projects don't interfere. Separate memory, history, config.
7. **Skills as standard** — Portable agent capabilities via open standard (agentskills.io).
8. **Permission-first** — Tools require explicit permission levels. User approves risky operations.
