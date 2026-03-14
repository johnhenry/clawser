  Clawser Repository Audit Report                                                                                                                    
   
  1. Structure & Organization                                                                                                                        
                                                                                                                                                   
  ┌────────────────────┬────────┬─────────────────────────────────────────────────┐                                                                
  │      Category      │ Status │                      Notes                      │
  ├────────────────────┼────────┼─────────────────────────────────────────────────┤
  │ Module layout      │ Clean  │ 201 JS files, consistent clawser-*.js naming    │
  ├────────────────────┼────────┼─────────────────────────────────────────────────┤
  │ Orphaned files     │ None   │ Only types.d.ts (intentional shared types)      │
  ├────────────────────┼────────┼─────────────────────────────────────────────────┤
  │ Dead imports       │ None   │ All imports resolve                             │
  ├────────────────────┼────────┼─────────────────────────────────────────────────┤
  │ Circular deps      │ None   │ Clean import chains                             │
  ├────────────────────┼────────┼─────────────────────────────────────────────────┤
  │ TODO/FIXME/HACK    │ Zero   │ No tech debt markers in source                  │
  ├────────────────────┼────────┼─────────────────────────────────────────────────┤
  │ Legacy Rust crates │ Stale  │ 1.1 MB kept "for reference" — cleanup candidate │
  └────────────────────┴────────┴─────────────────────────────────────────────────┘

  2. Code Quality Issues

  High Severity:
  - Timer leak in clawser-agent.js:1385 — Promise.race timeout timer never cleared on success path. Can accumulate background timers.
  - Reader lock in clawser-mcp.js:125 — SSE response reader not released in finally block. Could cause "reader locked" errors on exceptions.

  Medium Severity:
  - Event listener accumulation in clawser-app.js:325,328 — Vault unlock dialog listeners not cleaned up; could pile up if dialog shown repeatedly.
  - No global unhandledrejection handler — Combined with fire-and-forget promises, errors could go silently missing.
  - Lazy module loading race in clawser-tools.js:16-23 — concurrent calls before first load completes could trigger duplicate imports.

  No Issues Found: Hardcoded secrets, XSS vulns, path traversal, permission bypasses, deprecated APIs, command injection.

  3. API & Interface Consistency

  ┌─────────────────────────────────────────────────────────────────────────────────────────┬──────────┬────────────────────────────────┐
  │                                          Issue                                          │ Severity │            Location            │
  ├─────────────────────────────────────────────────────────────────────────────────────────┼──────────┼────────────────────────────────┤
  │ StorageDeleteTool defined but never registered in default registry                      │ High     │ clawser-tools.js:849           │
  ├─────────────────────────────────────────────────────────────────────────────────────────┼──────────┼────────────────────────────────┤
  │ No cleanupWorkspace() to pair with initWorkspace() — workspace state may leak on switch │ High     │ clawser-workspace-lifecycle.js │
  ├─────────────────────────────────────────────────────────────────────────────────────────┼──────────┼────────────────────────────────┤
  │ EchoProvider.chat() signature doesn't match LLMProvider base class                      │ Medium   │ clawser-providers.js:660       │
  ├─────────────────────────────────────────────────────────────────────────────────────────┼──────────┼────────────────────────────────┤
  │ FS tool constructors inconsistent (FsListTool takes 3 args, siblings take 2)            │ Medium   │ clawser-tools.js:566-763       │
  ├─────────────────────────────────────────────────────────────────────────────────────────┼──────────┼────────────────────────────────┤
  │ Events emitted but never listened to: shutdown, delegate_*, peer:connect/disconnect     │ Medium   │ Multiple files                 │
  ├─────────────────────────────────────────────────────────────────────────────────────────┼──────────┼────────────────────────────────┤
  │ on('return ') — event name with trailing space, likely typo                             │ Low      │ clawser-ui-config.js           │
  ├─────────────────────────────────────────────────────────────────────────────────────────┼──────────┼────────────────────────────────┤
  │ EvalJsTool.execute(args) doesn't destructure like other tools                           │ Low      │ clawser-tools.js:1028          │
  ├─────────────────────────────────────────────────────────────────────────────────────────┼──────────┼────────────────────────────────┤
  │ Pod destroy()/shutdown() method unclear                                                 │ Medium   │ clawser-pod.js                 │
  └─────────────────────────────────────────────────────────────────────────────────────────┴──────────┴────────────────────────────────┘

  4. Test Coverage

  - 233 test files, 3,187 tests — all passing
  - 51 source modules lack any test file, including critical ones:
    - clawser-app.js, clawser-shell.js, clawser-tools.js, clawser-providers.js, clawser-skills.js
    - Entire UI layer (clawser-ui-*.js)
  - Redundant coverage: clawser-safety.test.mjs and clawser-safety-pipeline.test.mjs overlap
  - Inconsistent BrowserTool stubbing (30 files define it themselves, 200 rely on setup)
  - No skipped/todo tests, all tests have assertions, timer cleanup looks good

  5. Configuration & Infrastructure

  - PWA: Complete (manifest, icons, service worker with 68-file cache)
  - CSP: Strict with intentional unsafe-eval/unsafe-inline for agent sandbox
  - Docker: Production-ready nginx config
  - CI/CD: Tests on push/PR, auto-deploy to GitHub Pages
  - Minor: playwright.config.js references nonexistent ./tests dir; no engines field in package.json
  - Service worker sw.js: All 68 cached files verified as existing

  6. Security Posture

  - Permission system well-implemented (auto/approve/denied per tool)
  - Path traversal properly prevented in WorkspaceFs.resolve()
  - innerHTML sanitized comprehensively (strips scripts, iframes, event handlers, dangerous URLs)
  - Shell has proper tokenizer/parser — no injection vectors
  - SSRF protection in virtual server
  - Tradeoff: connect-src: * required for agent API access

---
  ---                                                                                                        
  Application Portrait: Clawser                                                                              
                                                                                                             
  Executive Summary                                                                                        
                                                                                                           
  Clawser is a browser-native AI agent workspace that runs entirely client-side — no server, no bundler, no
  build step. It provides an autonomous agent runtime with ~100 tools, 38+ LLM backends, persistent memory, a
   virtual shell, P2P mesh networking, and multi-channel messaging (Slack, Discord, Telegram, etc.). Built by
   a solo developer over 21 days (204 commits), it has reached an impressive ~110K LOC across 209 modules
  with 236 test files — but the explosive velocity has left behind scaffolding gaps, stale documentation, and
   an untested UI layer. The project is approaching its first public release via the Chrome Web Store.

  Lenses Applied

  ┌──────────────────┬────────────────────────────────────────────────┐
  │       Lens       │                     Status                     │
  ├──────────────────┼────────────────────────────────────────────────┤
  │ Source code      │ Applied                                        │
  ├──────────────────┼────────────────────────────────────────────────┤
  │ Documentation    │ Applied                                        │
  ├──────────────────┼────────────────────────────────────────────────┤
  │ Tests            │ Applied                                        │
  ├──────────────────┼────────────────────────────────────────────────┤
  │ Commit history   │ Applied                                        │
  ├──────────────────┼────────────────────────────────────────────────┤
  │ Commit diffs     │ Skipped (covered by commit history + file age) │
  ├──────────────────┼────────────────────────────────────────────────┤
  │ Dependencies     │ Applied                                        │
  ├──────────────────┼────────────────────────────────────────────────┤
  │ CI/CD            │ Applied                                        │
  ├──────────────────┼────────────────────────────────────────────────┤
  │ Issues & PRs     │ Applied                                        │
  ├──────────────────┼────────────────────────────────────────────────┤
  │ File age & churn │ Applied                                        │
  ├──────────────────┼────────────────────────────────────────────────┤
  │ Import graph     │ Applied                                        │
  ├──────────────────┼────────────────────────────────────────────────┤
  │ Configuration    │ Applied                                        │
  ├──────────────────┼────────────────────────────────────────────────┤
  │ Error handling   │ Applied                                        │
  ├──────────────────┼────────────────────────────────────────────────┤
  │ Branches         │ Applied                                        │
  ├──────────────────┼────────────────────────────────────────────────┤
  │ Build output     │ Skipped (no build step)                        │
  └──────────────────┴────────────────────────────────────────────────┘

  ---
  What It Does

  Clawser gives users a complete AI agent that lives in the browser. Through a chat interface, users interact
   with an AI that can:

  - Execute 100+ browser-native tools — file I/O (OPFS), web fetch, DOM manipulation, screenshots, clipboard,
   web search, hardware access (Bluetooth/USB/Serial), OAuth, git, and more
  - Use 38+ LLM backends — OpenAI, Anthropic, Chrome AI, Groq, Ollama, Together, Fireworks, Mistral,
  DeepSeek, xAI, Perplexity, LM Studio, and 24+ more via the ai.matey adapter
  - Maintain persistent memory — BM25 keyword + cosine vector hybrid search across sessions
  - Track goals — lifecycle management (active, completed, failed)
  - Run a virtual shell — full tokenizer, recursive-descent parser, 59+ builtins, pipes, redirects, jq
  support, backed by OPFS
  - Install skills — Agent Skills open standard (agentskills.io), SKILL.md with YAML frontmatter
  - Automate routines — cron, event, and webhook triggers with guardrails
  - Network peer-to-peer — full mesh with DHT/gossip discovery, identity/trust, stream multiplexing,
  consensus, marketplace, payments
  - Receive messages from 8 channels — Telegram, Discord, Slack, IRC, Matrix, Email, Relay, WSH
  - Run as daemon — background execution with checkpoint/resume and "while you were away" summaries
  - Self-repair — detects stuck states (loops, timeouts, runaway costs) and auto-recovers

  Contradiction found: Documentation says "~100 tools" in some places but "70+" in ARCHITECTURE.md and "29
  tools" in the tool table header. The code registers 100+ tools during workspace init (code is source of
  truth).

  ---
  How It Was Built

  Technology Stack

  - Pure browser JavaScript — ES modules, zero npm runtime deps, zero bundler
  - CDN-loaded libraries — ai.matey (LLM adapter), fflate (compression), html2canvas (screenshots), marked
  (markdown), @xenova/transformers (local embeddings)
  - Browser APIs as OS — OPFS (filesystem), localStorage (config), IndexedDB (checkpoints), Web Crypto
  (secrets), WebRTC (mesh), BroadcastChannel (multi-tab IPC), Service Worker (background)
  - Testing — node:test primary (230 files), Vitest secondary (3 files)

  Architecture

  The codebase is organized into clear layers:

  Hub modules (most depended-on):
  - clawser-tools.js (41 importers) — BrowserTool base class + registry
  - clawser-state.js (31 importers) — global state, event bus, config cache
  - clawser-ui-chat.js (15 importers) — chat rendering + messaging APIs

  Assembly modules (most imports):
  - clawser-workspace-lifecycle.js (71 imports) — registers ALL tools, wires ALL subsystems
  - clawser-app.js (43 imports) — top-level orchestrator
  - clawser-pod.js (28 imports) — mesh assembly

  Well-isolated leaf modules: 98 modules have 0-1 local imports — small, focused, single-capability.

  Key Design Decisions

  1. No build step — Pure ES modules with import maps. Maximum simplicity, zero tooling overhead. Tradeoff:
  no tree-shaking or minification.
  2. Event-sourced persistence — All conversation state derives from append-only JSONL EventLog. Enables
  forking, replay, undo.
  3. Dual tool calling — Native API-based for capable providers, code-generation via sandbox for simpler
  models. Maximizes LLM compatibility.
  4. Browser-as-OS — Everything uses browser primitives. No server component. Maximum portability and
  privacy.
  5. Defense-in-depth safety — 3-stage pipeline (InputSanitizer → ToolCallValidator → LeakDetector),
  fail-open hooks, circuit breaker on providers.

  ---
  How It Operates

  Build & Deployment

  - Primary: GitHub Pages auto-deploy on push to main (no build step needed)
  - Docker: nginx:alpine for static frontend + node:20-slim for signaling/relay/kernel backend services
  - Extension: Chrome MV3 (Chrome 135+) + Firefox MV2 adaptation
  - PWA: Complete manifest, service worker with 68-file app shell cache

  Configuration

  - All runtime config centralized in a frozen DEFAULTS object in clawser-state.js
  - 16 per-workspace localStorage key types (versioned v1 prefix)
  - Autonomy levels: readonly → supervised → full with per-hour rate limits and per-day/month cost caps
  - Tool permissions: internal (auto), read (auto), write (approve), network (approve), browser (approve)
  - Demo mode via ?demo URL parameter

  Resilience & Observability

  Strengths (multi-lens confirmed):
  - Circuit breaker pattern (ProviderHealth) with 3-failure threshold and 30s cooldown
  - SelfRepairEngine watchdog detecting 6 stuck states with ordered recovery strategies
  - Error classification system (classifyError()) with retry/no-retry categorization
  - 3-tier logging: EventLog (structured JSONL), LogFacade (pluggable backends), MetricsCollector
  (counters/gauges/histograms)
  - Graceful degradation everywhere: mesh init, persistence, hooks, SSE parsing all fail safely

  Gaps:
  - No global unhandledrejection handler — uncaught async errors silently disappear (confirmed by both code
  quality audit and error handling analysis)
  - ~10 fire-and-forget .catch(() => {}) locations — silently swallow errors that might indicate real
  problems
  - Timer leak in Promise.race for tool timeouts (clawser-agent.js:1385) — timeout timer not cleared on
  success
  - Reader lock risk in MCP SSE parser (clawser-mcp.js:125) — reader not released in finally block

  ---
  How It Evolved

  Timeline (21 days, 204 commits)

  ┌─────────────────────┬───────────┬─────────┬──────────────────────────────────────────────────────┐
  │        Phase        │   Dates   │ Commits │                    What Happened                     │
  ├─────────────────────┼───────────┼─────────┼──────────────────────────────────────────────────────┤
  │ Foundation          │ Feb 22-23 │ 36      │ Entire core codebase in 2 days (30 "blocks")         │
  ├─────────────────────┼───────────┼─────────┼──────────────────────────────────────────────────────┤
  │ Hardening           │ Feb 24-25 │ 19      │ Security audit sweep, 7 batches of fixes             │
  ├─────────────────────┼───────────┼─────────┼──────────────────────────────────────────────────────┤
  │ wsh Protocol        │ Feb 26    │ 27      │ Remote shell + netway, 62 bugs fixed                 │
  ├─────────────────────┼───────────┼─────────┼──────────────────────────────────────────────────────┤
  │ Kernel              │ Feb 27    │ 13      │ Browser microkernel in 7 phases                      │
  ├─────────────────────┼───────────┼─────────┼──────────────────────────────────────────────────────┤
  │ Security Audit      │ Feb 28    │ 12      │ 8 rounds fixing SSRF, sandbox escape, path traversal │
  ├─────────────────────┼───────────┼─────────┼──────────────────────────────────────────────────────┤
  │ Mesh + Completeness │ Mar 1-3   │ 19      │ P2P mesh (9 sub-phases), TDD gap-filling             │
  ├─────────────────────┼───────────┼─────────┼──────────────────────────────────────────────────────┤
  │ Pod + wsh CLI       │ Mar 4-6   │ 8       │ Embeddable pod, CLI completion                       │
  ├─────────────────────┼───────────┼─────────┼──────────────────────────────────────────────────────┤
  │ Reverse Terminal    │ Mar 7-8   │ 16      │ Virtual terminal runtime, reverse handshake          │
  ├─────────────────────┼───────────┼─────────┼──────────────────────────────────────────────────────┤
  │ Runtime Convergence │ Mar 10-11 │ 36      │ Remote runtime broker, 29 commits in one day         │
  ├─────────────────────┼───────────┼─────────┼──────────────────────────────────────────────────────┤
  │ Polish              │ Mar 13-14 │ 4       │ Chrome Web Store prep, docs cleanup                  │
  └─────────────────────┴───────────┴─────────┴──────────────────────────────────────────────────────┘

  Key pattern: Explosive burst development (35 commits/day peak) followed by systematic multi-round auditing.
   Development is decelerating: 116 commits in week 1 → 40 in week 3.

  Current Activity

  - Active focus: Phase 8 planning (model splitting, roadmap restructuring)
  - Chrome Web Store assets prepared — approaching first public distribution
  - All 5 non-main branches are fully merged and stale (safe to delete)

  The "Frozen Core" Pattern

  The agent, providers, tools, and skills modules were heavily worked in week 1, then left untouched since
  ~Mar 5. They've stabilized into a platform that the rest of the system builds on.

  Write-Once Scaffolding Risk

  50+ JS files were created in a single commit and never modified again — primarily mesh/peer modules (Mar
  3-6). These represent significant surface area with zero iteration. They're either complete-and-correct or
  untested scaffolding.

  ---
  Strengths

  These findings are confirmed across multiple analysis lenses:

  1. Zero-dependency architecture — No npm runtime deps, no bundler, no framework. Radical simplicity
  confirmed by source, deps, and CI analyses.
  2. Comprehensive safety pipeline — InputSanitizer, ToolCallValidator, LeakDetector, path traversal
  prevention, SSRF protection, domain allowlists. Confirmed by source, tests, error handling, and docs
  analyses.
  3. Excellent encapsulation — Private class fields (#) throughout, clean layer separation for leaf modules.
  98 well-isolated modules. Confirmed by source and import graph.
  4. Strong test culture — 236 test files, 6,196 test cases, TDD workflow, completeness audit rounds (r2-r5),
   sprint acceptance gates. No skipped tests, all assertions present. Confirmed by tests, commits, and docs.
  5. Robust error handling in critical paths — Circuit breaker, exponential backoff with jitter, error
  classification, self-repair engine, history sanitization. Confirmed by source, error handling, and tests
  analyses.
  6. Event-sourced persistence — Enables undo, forking, replay, checkpoint/restore with multi-path fallback.
  Confirmed by source and docs.
  7. Clean state management — Centralized frozen DEFAULTS, versioned localStorage keys with migration,
  ConfigCache with debounced writes. Confirmed by config and source analyses.

  ---
  Weaknesses & Risks

  High Severity (multi-lens convergence)

  1. clawser-workspace-lifecycle.js is a God Module — 71 imports, 40 commits (highest churn), 1,836 LOC. It's
   the single assembly point for the entire app. Every new tool or panel requires modifying this file. No
  cleanupWorkspace() pairs with initWorkspace(), risking state leaks on workspace switch. (Import graph +
  file churn + API audit all flag this)
  2. 142-file Node.js test suite is NOT run in CI — CI only runs Playwright browser tests. The bulk of
  unit/integration tests are skipped. Combined with no dependency between CI and deploy, broken code can ship
   to GitHub Pages. (CI/CD + tests analyses)
  3. 51 source modules have zero test coverage — Including critical ones: clawser-app.js, clawser-shell.js,
  clawser-tools.js, clawser-providers.js, clawser-skills.js, all 14 UI modules. (Tests analysis)
  4. 50+ mesh/peer modules are write-once scaffolding — Created in single commits Mar 3-6, never iterated on.
   Represent significant surface area of unknown quality. (File churn + commit history)
  5. Documentation is significantly stale — LOC counts off by hundreds, CONTRIBUTING.md describes obsolete
  browser-only test system, CHANGELOG.md is a dead link, hook pipeline documented three different ways,
  localStorage key prefixes inconsistent across docs, tool names diverge between MODULES.md and code. (Docs
  analysis)

  Medium Severity

  6. Core-to-UI layer violations — workspace-lifecycle.js imports 7 UI modules directly; ui-chat.js has
  become a shared utility hub (15 importers) with a circular dependency against ui-config.js. (Import graph)
  7. 3 circular dependency chains — tools ↔ cors-fetch, ui-chat ↔ ui-config, shell ↔ shell-builtins. Work via
   ES module live bindings but are fragile. (Import graph)
  8. CDN supply chain risk — ai.matey (the Tier 3 provider system) loads without version pinning. webtorrent
  and helia use @latest. No SRI hashes on any CDN import. (Dependencies)
  9. StorageDeleteTool defined but never registered — The class exists in clawser-tools.js but is not added
  to the default registry, making it inaccessible to agents. (API audit)
  10. No global unhandledrejection handler + ~10 silent .catch(() => {}) fire-and-forget patterns. (Error
  handling + code quality)
  11. Dead event infrastructure — shutdown, delegate_*, peer:connect/disconnect events emitted but never
  listened to. on('return ') with trailing space likely a typo. (API audit)
  12. EchoProvider.chat() signature doesn't match base class — Violates Liskov Substitution. (API audit)

  Low Severity

  13. Timer leak in Promise.race tool timeout (clawser-agent.js:1385)
  14. Reader lock risk in MCP SSE parser (clawser-mcp.js:125)
  15. Event listener accumulation in vault unlock dialog (clawser-app.js:325,328)
  16. 5 stale branches — all fully merged, safe to delete
  17. Legacy Rust crates (1.1 MB) still in tree, no longer used
  18. Placeholder URL (your-org) in README and CONTRIBUTING quick start
  19. playwright.config.js references nonexistent ./tests directory
  20. No engines field in package.json

  ---
  Evolution Possibilities

  Quick Wins

  1. Add npm test to CI — One line in ci.yml to run the 3,187 unit tests before deploy
  2. Pin ai.matey CDN versions — Add version numbers to importmap entries
  3. Register StorageDeleteTool — One line in createDefaultRegistry()
  4. Delete 5 stale branches — All fully merged
  5. Fix dead CHANGELOG.md link in README
  6. Add global unhandledrejection handler in clawser-app.js
  7. Clear timeout timer in Promise.race tool execution
  8. Fix on('return ') typo in clawser-ui-config.js

  Medium-Term

  9. Break up workspace-lifecycle.js — Phase-based initialization (tools, UI, mesh, channels) with a cleanup
  counterpart
  10. Extract ui-chat utility functions — Move addMsg/addErrorMsg/setStatus into a dedicated messaging module
   to break the circular dependency
  11. Add SRI hashes for CDN imports
  12. Update stale documentation — LOC counts, CONTRIBUTING.md test instructions, hook pipeline docs,
  localStorage key prefixes
  13. Add tests for core modules — clawser-shell.js, clawser-tools.js, clawser-providers.js deserve dedicated
   test files
  14. Audit 50+ write-once mesh modules — Verify they're actually exercised or mark as experimental

  Long-Term Directions

  15. First public release — Chrome Web Store assets are ready; cut a versioned release with proper changelog
  16. Community infrastructure — Enable GitHub Issues, create issue templates, add discussion forums
  17. Lazy module loading strategy — 209 modules with no bundling means many HTTP requests on first load
  18. PR review workflow — Move from direct-to-main to branch protection with required CI checks
  19. Channel setup guide + mesh networking tutorial — Bridge the gap between the 57 formal specs and
  user-facing documentation
  20. Consider a lightweight module bundler — Even a simple concatenation step could improve load performance
   without sacrificing the no-build philosophy

  ---
  Appendix: Individual Analysis Summaries

  ┌───────────────┬──────────────────────────────────────────────────────────────────────────────────────┐
  │     Lens      │                                     Key Finding                                      │
  ├───────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ Source        │ 209 modules, ~110K LOC, clean layer separation with workspace-lifecycle as the God   │
  │               │ Module                                                                               │
  ├───────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ Docs          │ Extraordinary breadth (57 mesh specs, 10 tutorials, 28 screenshots) but              │
  │               │ significantly stale in places                                                        │
  ├───────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ Tests         │ 236 files, 6,196 cases; mesh networking most-tested (45% of cases); 51 modules       │
  │               │ untested                                                                             │
  ├───────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ Commits       │ 204 commits in 21 days by solo dev; burst development then audit pattern             │
  ├───────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ Deps          │ Zero npm runtime deps; ~10 CDN libs with inconsistent version pinning                │
  ├───────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ CI/CD         │ 2 workflows but unit tests not run in CI; deploy not gated on CI pass                │
  ├───────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ Import Graph  │ workspace-lifecycle (71 imports) is God Module; 3 circular deps; 9 core→UI           │
  │               │ violations                                                                           │
  ├───────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ File Churn    │ workspace-lifecycle highest churn (40 commits); 50+ files never modified after       │
  │               │ creation                                                                             │
  ├───────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ Error         │ 837 try/catch blocks, 3-tier logging, circuit breaker, self-repair; but no global    │
  │ Handling      │ rejection handler                                                                    │
  ├───────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ Branches      │ 5 stale branches, all merged; trunk-based workflow with AI worktrees                 │
  ├───────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ Config        │ 4 deployment targets; 16 per-workspace key types; autonomy + permission system       │
  │               │ well-designed                                                                        │
  ├───────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ Issues/PRs    │ Zero issues, 1 PR ever; no community engagement; approaching first public release    │
  └───────────────┴──────────────────────────────────────────────────────────────────────────────────────┘