# Clawser — Gaps & Action Plan

113 gaps identified across 12 categories. Each gap includes severity, affected files, a concrete action plan with estimated effort, and acceptance criteria.

**Severity levels**: CRITICAL (blocks usage), HIGH (significant quality impact), MEDIUM (polish), LOW (nice-to-have)

---

## 1. Documentation Gaps (12 items)

### 1.1 CRITICAL — No LICENSE file at project root
- **Files**: `/LICENSE` (missing)
- **Plan**:
  1. Create `LICENSE` with MIT text (referenced in README and Cargo.toml)
  2. Include copyright line: `Copyright (c) 2026 Clawser Contributors`
- **Effort**: 5 min
- **Acceptance**: `LICENSE` exists at root, matches MIT, referenced in README

### 1.2 CRITICAL — PRD.md severely outdated
- **Files**: `/PRD.md`
- **Plan**:
  1. Add prominent header noting the document describes the original Rust/WASM architecture
  2. Add "Current Architecture" section redirecting to ARCHITECTURE.md
  3. Update section 1 (Executive Summary) to reflect pure JS runtime
  4. Update section 3 (Architecture) to note WASM is archived
  5. Keep detailed specs as historical reference (they informed the JS implementation)
- **Effort**: 1 hour
- **Acceptance**: PRD clearly states it's a historical reference; links to current docs

### 1.3 HIGH — No CHANGELOG.md
- **Files**: `/CHANGELOG.md` (missing)
- **Plan**:
  1. Create CHANGELOG.md following Keep a Changelog format
  2. Extract version history from git log (30 block commits)
  3. Group by phase: Phase 1 (blocks 0-10), Phase 2 (UI/integration), Phase 3 (feature modules)
  4. Mark current version as `0.1.0-beta` (Unreleased)
- **Effort**: 1 hour
- **Acceptance**: CHANGELOG exists with entries for all major commits; follows semver

### 1.4 HIGH — No CONTRIBUTING.md
- **Files**: `/CONTRIBUTING.md` (missing)
- **Plan**:
  1. Create with sections: Getting Started, Development Setup, Code Style, Module Structure, Adding Tools, Adding Providers, Testing, Pull Requests
  2. Document the "no build step" philosophy
  3. Document module naming conventions (`clawser-{domain}.js`)
  4. Document tool registration pattern (extend BrowserTool, register in app.js)
  5. Reference ARCHITECTURE.md for system understanding
- **Effort**: 1 hour
- **Acceptance**: New contributor can set up, modify, and test the project using this guide alone

### 1.5 HIGH — No API reference documentation
- **Files**: `/docs/API.md` (missing)
- **Plan**:
  1. Create `docs/` directory
  2. Generate API reference from source code exports (manual extraction)
  3. Document each module's public exports: classes, methods, parameters, return types
  4. Start with core modules: agent, providers, tools, skills, mcp
  5. Add usage examples for each major class
- **Effort**: 4 hours
- **Acceptance**: Every public export from core 5 modules has documented signature and description

### 1.6 HIGH — No SECURITY.md
- **Files**: `/SECURITY.md` (missing)
- **Plan**:
  1. Create security policy document
  2. Document: permission model, autonomy levels, XSS prevention, domain allowlist, file size limits, eval risks
  3. Add responsible disclosure process
  4. Document known limitations (localStorage visibility, eval global scope)
- **Effort**: 1 hour
- **Acceptance**: Security model is self-contained in one document; includes disclosure contact

### 1.7 HIGH — No CLI documentation
- **Files**: README.md, `docs/CLI.md` (missing)
- **Plan**:
  1. Create `docs/CLI.md` documenting all 18 CLI subcommands
  2. Include usage examples for each command
  3. Add CLI section to README.md referencing the full doc
  4. Document terminal session management commands
- **Effort**: 1 hour
- **Acceptance**: Every CLI subcommand documented with usage and examples

### 1.8 HIGH — Missing GitHub templates
- **Files**: `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md` (missing)
- **Plan**:
  1. Create `.github/ISSUE_TEMPLATE/bug_report.md` with reproduction steps template
  2. Create `.github/ISSUE_TEMPLATE/feature_request.md`
  3. Create `.github/PULL_REQUEST_TEMPLATE.md` with checklist (tests, docs, no regressions)
- **Effort**: 30 min
- **Acceptance**: GitHub shows template prompts on new issue/PR creation

### 1.9 MEDIUM — .reference/ directory undocumented
- **Files**: `.reference/`, `.gitignore`
- **Plan**:
  1. Add comment in `.gitignore` explaining `.reference/` purpose
  2. Create `.reference/README.md` explaining it contains historical reference implementations (ironclaw, nullclaw, zeroclaw)
  3. Confirm it's properly gitignored
- **Effort**: 15 min
- **Acceptance**: Purpose of .reference/ is documented; directory remains gitignored

### 1.10 MEDIUM — No module dependency graph
- **Files**: `docs/MODULE_GRAPH.md` (missing)
- **Plan**:
  1. Create text-based dependency graph showing import relationships
  2. Group by layer: core, tools, UI, shell, features
  3. Note circular dependency risks if any
- **Effort**: 1 hour
- **Acceptance**: Graph covers all 48+ modules with clear layer boundaries

### 1.11 MEDIUM — No event log specification
- **Files**: `docs/EVENT_LOG_SPEC.md` (missing)
- **Plan**:
  1. Document all event types and their data schemas
  2. Document serialization format (JSONL)
  3. Document derivation operations (deriveSessionHistory, deriveToolCallLog, deriveGoals)
  4. Include migration path documentation (v2 → v1 → v0)
- **Effort**: 1 hour
- **Acceptance**: All event types documented with example payloads

### 1.12 LOW — No deployment guide
- **Files**: `docs/DEPLOYMENT.md` (missing)
- **Plan**:
  1. Document static file server setup (Python, Node, nginx)
  2. Document CDN dependency caching strategy
  3. Document CORS configuration for MCP servers
  4. Add Docker example
- **Effort**: 1 hour
- **Acceptance**: User can deploy Clawser to production following the guide

---

## 2. Code Gaps — Critical Fixes (3 items)

### 2.1 CRITICAL — No execution timeout on Codex/vimble sandbox
- **Files**: `web/clawser-codex.js` (line ~222)
- **Current**: `const returnValue = await run(code, context);` — no timeout
- **Plan**:
  1. Add configurable timeout constant (default 30 seconds):
     ```js
     static #EXEC_TIMEOUT_MS = 30_000;
     ```
  2. Wrap execution with Promise.race:
     ```js
     const timeout = new Promise((_, reject) =>
       setTimeout(() => reject(new Error('Code execution timed out')), Codex.#EXEC_TIMEOUT_MS)
     );
     const returnValue = await Promise.race([run(code, context), timeout]);
     ```
  3. Catch timeout error and record in results as `{success: false, error: 'Execution timed out after 30s'}`
  4. Add test case in test.html for timeout behavior (while(true){} should timeout)
- **Effort**: 30 min
- **Acceptance**: Infinite loop in code block times out after 30s; error message returned to agent

### 2.2 CRITICAL — MCP tools not wired into agent tool loop
- **Files**: `web/clawser-mcp.js`, `web/clawser-app.js`
- **Current**: McpManager created but no McpToolAdapter bridges tools to BrowserToolRegistry
- **Plan**:
  1. Create `McpToolAdapter` class in `clawser-mcp.js`:
     ```js
     export class McpToolAdapter extends BrowserTool {
       #manager; #toolName; #spec;
       constructor(manager, spec) {
         super();
         this.#manager = manager;
         this.#toolName = spec.name;
         this.#spec = spec;
       }
       get name() { return this.#spec.name; }
       get description() { return this.#spec.description; }
       get parameters() { return this.#spec.parameters; }
       get permission() { return 'network'; }
       async execute(params) {
         return this.#manager.executeTool(this.#toolName, params);
       }
     }
     ```
  2. Add `registerMcpTools(registry, manager)` helper function
  3. In `clawser-app.js` initWorkspace, after MCP server connections, call:
     ```js
     for (const spec of state.mcpManager.allToolSpecs()) {
       state.browserTools.register(new McpToolAdapter(state.mcpManager, spec));
     }
     ```
  4. Add MCP server add/remove UI event handlers that re-register tools
  5. Add test for McpToolAdapter in test.html
- **Effort**: 1 hour
- **Acceptance**: MCP tools appear in agent's tool list and can be invoked via agent tool calling

### 2.3 CRITICAL — Skill activation lock memory leak
- **Files**: `web/clawser-skills.js` (activate method)
- **Current**: Lock entry not cleaned up if `#doActivate()` throws
- **Plan**:
  1. Wrap activation in try/finally:
     ```js
     async activate(name, args) {
       // ... existing lock check ...
       const lockPromise = (async () => {
         try {
           return await this.#doActivate(name, args);
         } finally {
           this.#activationLocks.delete(name);
         }
       })();
       this.#activationLocks.set(name, lockPromise);
       return lockPromise;
     }
     ```
  2. Add test: simulate activation failure, verify lock is cleared, retry succeeds
- **Effort**: 20 min
- **Acceptance**: Failed activation clears lock; subsequent activation succeeds

---

## 3. Code Gaps — Provider Issues (4 items)

### 3.1 HIGH — MateyProvider streaming returns stub usage
- **Files**: `web/clawser-providers.js` (MateyProvider.chatStream)
- **Plan**:
  1. Track token usage during streaming by counting chunks
  2. Return accumulated usage in final response object
  3. If exact usage unavailable, estimate from character count (chars/4 ≈ tokens)
- **Effort**: 30 min
- **Acceptance**: MateyProvider stream responses include non-zero usage stats

### 3.2 HIGH — Chrome AI session pooling missing
- **Files**: `web/clawser-providers.js` (ChromeAIProvider)
- **Plan**:
  1. Add session pool (Map keyed by system prompt hash, max 3 sessions)
  2. Reuse session for same system prompt within 5-minute window
  3. Destroy sessions on provider switch or after idle timeout
  4. Add `destroyPool()` method for cleanup
- **Effort**: 1 hour
- **Acceptance**: Consecutive Chrome AI calls reuse session; pool cleaned on provider switch

### 3.3 MEDIUM — Cost estimation ignores prompt caching
- **Files**: `web/clawser-providers.js` (estimateCost)
- **Plan**:
  1. Add `cache_read_tokens` field to usage tracking
  2. Add cached input pricing to MODEL_PRICING table (typically 50% of input price)
  3. Update estimateCost to subtract cached portion from input cost
  4. Display cache savings in cost meter UI
- **Effort**: 1 hour
- **Acceptance**: Cost estimates account for cached tokens when reported by provider

### 3.4 MEDIUM — Anthropic message merging type mismatch
- **Files**: `web/clawser-providers.js` (AnthropicProvider, message building)
- **Plan**:
  1. Normalize all message content to array format before merging
  2. If existing content is string, wrap as `[{type: 'text', text: content}]`
  3. Concatenate arrays safely
  4. Add test case for string + array merge scenario
- **Effort**: 30 min
- **Acceptance**: Mixed string/array content messages merge correctly for Anthropic

---

## 4. Code Gaps — Tool & Shell Issues (5 items)

### 4.1 HIGH — Tool result truncation is silent
- **Files**: `web/clawser-agent.js` (result truncation constant)
- **Plan**:
  1. Extract `#MAX_RESULT_LEN` to agent config (default 1500)
  2. When truncating, append `\n[...truncated from {originalLen} to {maxLen} chars]`
  3. Log truncation event to EventLog
  4. Make configurable via agent config
- **Effort**: 30 min
- **Acceptance**: Truncated results include indicator; length configurable

### 4.2 HIGH — Tool errors halt Codex code blocks
- **Files**: `web/clawser-codex.js` (injected tool functions)
- **Plan**:
  1. Change tool injection to return error object instead of throwing:
     ```js
     ctx[name] = async (params = {}) => {
       const result = await tools.execute(name, params);
       if (!result.success) return { _error: true, message: result.error || 'Tool failed' };
       try { return JSON.parse(result.output); }
       catch { return result.output; }
     };
     ```
  2. Update `buildToolPrompt()` to document error return format
  3. Add test for tool failure in code block (should continue execution)
- **Effort**: 30 min
- **Acceptance**: Tool failure returns error object; code block continues; agent sees error in results

### 4.3 MEDIUM — Shell variable substitution not implemented
- **Files**: `web/clawser-shell.js` (tokenizer/executor)
- **Plan**:
  1. Add `expandVariables(token, state)` function in executor
  2. Handle `$VAR` and `${VAR}` by looking up `state.env.get(name)`
  3. Handle `$?` (last exit code)
  4. Call expandVariables after tokenization, before command dispatch
  5. Do NOT implement `$(cmd)` (command substitution) in first pass — too complex
  6. Add tests for variable expansion in various contexts (quoted, unquoted, concatenated)
- **Effort**: 2 hours
- **Acceptance**: `export FOO=bar && echo $FOO` outputs "bar"; `$?` returns last exit code

### 4.4 MEDIUM — Shell glob expansion not implemented
- **Files**: `web/clawser-shell.js` (tokenizer/executor)
- **Plan**:
  1. Add `expandGlobs(token, fs, cwd)` function
  2. Support `*` (any), `?` (single char), `[abc]` (char class)
  3. Convert glob to regex, match against `fs.listDir(cwd)` results
  4. Expand in executor before command dispatch
  5. If no matches, pass literal (POSIX behavior)
  6. Add tests for glob in ls, cat, rm commands
- **Effort**: 3 hours
- **Acceptance**: `ls *.js` lists JS files; `cat file?.txt` matches file1.txt, file2.txt

### 4.5 LOW — Shell stderr redirect not supported
- **Files**: `web/clawser-shell.js` (tokenizer/executor)
- **Plan**:
  1. Extend tokenizer to recognize `2>`, `2>>`, `2>&1`
  2. Add stderr field to command execution context
  3. Route error output through stderr channel when redirected
  4. Add tests for stderr redirection
- **Effort**: 2 hours
- **Acceptance**: `cmd 2>/dev/null` suppresses errors; `cmd 2>&1` merges streams

---

## 5. Architecture Issues (5 items)

### 5.1 HIGH — clawser-app.js god module (977 LOC)
- **Files**: `web/clawser-app.js`
- **Plan**:
  1. Extract `createShellSession()` + `initWorkspace()` + `switchWorkspace()` → `web/clawser-workspace-lifecycle.js`
  2. Extract `handleRoute()` + route listener → `web/clawser-route-handler.js`
  3. Extract `renderHomeWorkspaceList()` + `renderHomeAccountList()` + `initHomeListeners()` → `web/clawser-home-views.js`
  4. Keep `clawser-app.js` as thin orchestrator importing and wiring the above
  5. Move service singleton creation to top of app.js (already there) but freeze in dedicated function
  6. Update `index.html` imports if needed
  7. Run test.html to verify no regressions
- **Effort**: 4 hours
- **Acceptance**: Each extracted module is <300 LOC; app.js is <200 LOC; all tests pass

### 5.2 HIGH — Global state singleton with 55+ fields
- **Files**: `web/clawser-state.js`
- **Plan** (incremental, non-breaking):
  1. Group state fields into namespaces:
     ```js
     state.ui = { isSending, currentRoute, ... }
     state.agent = { agent, agentInitialized, ... }
     state.services = { providers, browserTools, mcpManager, ... }
     state.features = { toolBuilder, channelManager, ... }
     ```
  2. Add JSDoc `@typedef` for each namespace
  3. Update consuming modules incrementally (one module per PR)
  4. Keep flat access as deprecated aliases during migration
- **Effort**: 6 hours (spread across PRs)
- **Acceptance**: State fields organized into namespaces; JSDoc types defined; no runtime breakage

### 5.3 HIGH — Router panel source of truth triplicated
- **Files**: `web/clawser-router.js`
- **Plan**:
  1. Define single `PANELS` constant as frozen object:
     ```js
     const PANELS = Object.freeze({
       chat: { id: 'panelChat', btn: 'btnChat', label: 'Chat' },
       tools: { id: 'panelTools', btn: 'btnTools', label: 'Tools' },
       // ...
     });
     ```
  2. Derive `PANEL_NAMES`, `allPanels`, `panelMap` from PANELS
  3. Update all references to use the single source
- **Effort**: 1 hour
- **Acceptance**: Single PANELS definition; all panel logic references it; tests pass

### 5.4 MEDIUM — clawser-ui-panels.js too large (2,800+ LOC)
- **Files**: `web/clawser-ui-panels.js`
- **Plan**:
  1. Extract file browser → `web/clawser-ui-files.js`
  2. Extract memory panel → `web/clawser-ui-memory.js`
  3. Extract goals panel → `web/clawser-ui-goals.js`
  4. Extract config sections → `web/clawser-ui-config.js`
  5. Keep `clawser-ui-panels.js` as re-export hub or delete if empty
  6. Update imports in `clawser-app.js` and `index.html`
- **Effort**: 4 hours
- **Acceptance**: Each extracted module is <500 LOC; panels render correctly; tests pass

### 5.5 LOW — No feature module manifest
- **Files**: `docs/FEATURE_MODULES.md` (missing)
- **Plan**:
  1. Create manifest listing all 30+ feature modules
  2. For each: name, file, tools registered, state fields used, dependencies
  3. Document how to add a new feature module
- **Effort**: 2 hours
- **Acceptance**: Complete manifest with entry for every feature module

---

## 6. Testing Gaps (7 items)

### 6.1 HIGH — No CI/CD pipeline
- **Files**: `.github/workflows/` (missing)
- **Plan**:
  1. Create `.github/workflows/test.yml`:
     - Trigger on push/PR to main
     - Install Chrome via `browser-actions/setup-chrome`
     - Serve `web/` with Python HTTP server
     - Run test.html via Playwright
     - Parse pass/fail from console output
     - Report results
  2. Add status badge to README.md
- **Effort**: 3 hours
- **Acceptance**: Tests run automatically on every push; badge shows pass/fail

### 6.2 HIGH — No test framework
- **Files**: `web/test.html`
- **Plan**:
  1. Keep existing test.html as browser-runnable regression suite
  2. Add minimal test harness improvements:
     - Structured output (JSON summary)
     - Exit code for CI (pass=0, fail=1)
     - Test timing per section
     - Skip/only support
  3. Add Playwright wrapper script to run test.html headlessly
  4. Future: evaluate migrating to Vitest (browser mode) for better DX
- **Effort**: 3 hours
- **Acceptance**: test.html produces structured JSON output; Playwright script exits with correct code

### 6.3 HIGH — Missing test coverage for critical paths
- **Files**: `web/test.html`
- **Plan**: Add test sections for:
  1. MCP tool adapter integration (when built)
  2. Codex execution timeout behavior
  3. Skill activation failure + lock cleanup
  4. Streaming SSE parsing edge cases (partial JSON, premature close)
  5. Multi-workspace isolation (create two workspaces, verify no state leakage)
  6. Concurrent sendMessage handling
  7. Autonomy controller rate limit enforcement
- **Effort**: 4 hours
- **Acceptance**: All 7 scenarios have passing tests

### 6.4 HIGH — No performance benchmarks
- **Files**: `web/bench.html` or `web/test.html` (section)
- **Plan**:
  1. Create benchmark suite measuring:
     - Checkpoint create/restore time (target <50ms from PRD)
     - Memory footprint after 100 messages (target <64MB from PRD)
     - EventLog.deriveSessionHistory() with 500 events
     - Context compaction latency
     - Tool registry lookup time with 100 tools
  2. Run benchmarks in CI and track regressions
- **Effort**: 3 hours
- **Acceptance**: Benchmark results reported; checkpoint <50ms validated

### 6.5 MEDIUM — No test fixtures
- **Files**: `tests/fixtures/` (empty directory)
- **Plan**:
  1. Create fixture data for tests:
     - Sample EventLog JSONL files
     - Sample SKILL.md files (valid + invalid)
     - Sample provider responses (OpenAI, Anthropic formats)
     - Sample MCP server responses
  2. Load fixtures in test.html via fetch
- **Effort**: 2 hours
- **Acceptance**: Fixtures exist and are used in at least 5 test sections

### 6.6 MEDIUM — Rust test directories empty
- **Files**: `tests/e2e/`, `tests/integration/`, `tests/unit/`
- **Plan**:
  1. Remove empty test directories (Rust tests are not applicable anymore)
  2. OR repurpose for JS tests if CI framework needs file-based tests
- **Effort**: 5 min
- **Acceptance**: Empty directories removed or repurposed

### 6.7 LOW — 33 console.log calls scattered through codebase
- **Files**: Multiple `web/clawser-*.js` files
- **Plan**:
  1. Audit all console.log/warn/error calls
  2. Replace with `onLog` callback pattern where available
  3. Add `debug` flag to state that gates verbose logging
  4. Keep console.error for truly unexpected errors only
- **Effort**: 2 hours
- **Acceptance**: No stray console.log in production paths; debug logging gated

---

## 7. Security Gaps (7 items)

### 7.1 CRITICAL — No skill validation before activation
- **Files**: `web/clawser-skills.js`
- **Plan**:
  1. Add `validateScript(content)` static method to SkillParser
  2. Scan for dangerous patterns: `eval(`, `Function(`, `import(`, `document.cookie`, `localStorage`, `XMLHttpRequest`, `fetch(` (unless in tool call)
  3. Return `{safe, warnings: string[]}`
  4. Call before activation; show warnings to user
  5. Allow user to approve despite warnings (not block)
- **Effort**: 2 hours
- **Acceptance**: Skills with eval() trigger warning before activation; user can override

### 7.2 CRITICAL — eval_js tool runs in global scope
- **Files**: `web/clawser-tools.js` (EvalJsTool)
- **Plan**:
  1. Add prominent warning in tool description: "Executes in page global scope. Use for trusted code only."
  2. Set default permission to `'approve'` (require user confirmation)
  3. Document in SECURITY.md that skill scripts use vimble (sandboxed) vs eval_js (global)
  4. Consider future migration to vimble for all code execution
- **Effort**: 30 min
- **Acceptance**: eval_js requires approval by default; risk documented

### 7.3 HIGH — API keys stored in plain localStorage
- **Files**: `web/clawser-providers.js`, `web/clawser-state.js`
- **Plan**:
  1. Document the limitation in SECURITY.md (browser constraint, not a bug)
  2. Add UI warning when first storing API key: "Keys are stored in browser storage (visible in DevTools)"
  3. Future: evaluate Web Crypto API for encryption at rest (key derived from user passphrase)
  4. Add "Clear all keys" button in config panel
- **Effort**: 1 hour
- **Acceptance**: User warned about storage; clear button exists; documented in SECURITY.md

### 7.4 HIGH — No sub-agent recursion guard
- **Files**: `web/clawser-agent-ref.js`
- **Plan**:
  1. Add `visited` Set parameter to `processAgentRefs()`:
     ```js
     export async function processAgentRefs(prompt, opts, visited = new Set()) {
       // ... for each ref:
       if (visited.has(agentName)) {
         segments.push({ type: 'error', content: `Circular reference: @${agentName}` });
         continue;
       }
       visited.add(agentName);
       // pass visited to recursive calls
     }
     ```
  2. Set max depth (default 3) to prevent deep chains even without cycles
  3. Add test for circular reference (@A refs @B refs @A)
- **Effort**: 30 min
- **Acceptance**: Circular @agent references detected and reported; max depth enforced

### 7.5 HIGH — XSS prevention depends on Sanitizer API availability
- **Files**: `web/clawser-tools.js` (DomModifyTool)
- **Plan**:
  1. Audit fallback sanitization (template.innerHTML tag stripping)
  2. Add test cases for known bypass vectors in fallback mode
  3. Consider bundling DOMPurify as fallback instead of custom stripping
  4. Document which browsers have Sanitizer API support
- **Effort**: 2 hours
- **Acceptance**: Fallback sanitization passes OWASP XSS test vectors; bypass vectors documented

### 7.6 MEDIUM — No storage quota checking
- **Files**: `web/clawser-tools.js` (FsWriteTool)
- **Plan**:
  1. Check `navigator.storage.estimate()` before large writes
  2. Warn user when >80% quota used
  3. Add quota display in config panel
- **Effort**: 1 hour
- **Acceptance**: Quota warning shown; estimate displayed in UI

### 7.7 MEDIUM — Permission model not documented for users
- **Files**: UI (tool registry panel), SECURITY.md
- **Plan**:
  1. Add tooltip/help text in tool registry panel explaining each permission level
  2. Add color coding: green (auto), yellow (approve), red (denied)
  3. Document permission model in SECURITY.md with examples
- **Effort**: 1 hour
- **Acceptance**: User can understand permissions without reading source code

---

## 8. UX & Accessibility Gaps (9 items)

### 8.1 HIGH — No ARIA labels
- **Files**: `web/index.html`, `web/clawser-ui-*.js`
- **Plan**:
  1. Add `role` attributes to major landmarks: main, nav, complementary, dialog
  2. Add `aria-label` to all buttons, inputs, and interactive elements
  3. Add `aria-live="polite"` to status indicator and message area
  4. Add `aria-expanded` to collapsible sections
  5. Test with screen reader (VoiceOver on macOS)
- **Effort**: 3 hours
- **Acceptance**: All interactive elements have ARIA labels; status updates announced

### 8.2 HIGH — No keyboard shortcuts
- **Files**: `web/clawser-app.js` (or new `web/clawser-keys.js`)
- **Plan**:
  1. Create keyboard shortcut handler module
  2. Implement shortcuts:
     - `Cmd+Enter` — Send message
     - `Cmd+K` — Command palette
     - `Cmd+N` — New conversation
     - `Cmd+1-9` — Switch panels
     - `Escape` — Close modal/dropdown
     - `Cmd+Shift+N` — New workspace
  3. Add keyboard shortcut help (Cmd+/) showing all bindings
- **Effort**: 2 hours
- **Acceptance**: All shortcuts work; help modal lists them

### 8.3 MEDIUM — No light mode
- **Files**: `web/clawser.css`
- **Plan**:
  1. Define light theme CSS variables:
     ```css
     @media (prefers-color-scheme: light) {
       :root { --bg: #ffffff; --text: #1f2937; --accent: #2563eb; ... }
     }
     ```
  2. Add manual theme toggle button in header
  3. Persist preference in localStorage
  4. Test all panels in light mode for contrast issues
- **Effort**: 3 hours
- **Acceptance**: Light mode renders correctly; toggle persists; respects system preference

### 8.4 MEDIUM — No responsive design
- **Files**: `web/clawser.css`, `web/index.html`
- **Plan**:
  1. Add media queries for tablet (768px) and mobile (480px)
  2. Tablet: sidebar collapses to icons; panels stack
  3. Mobile: sidebar becomes bottom tab bar; single panel view
  4. Test on iOS Safari, Android Chrome
- **Effort**: 6 hours
- **Acceptance**: Usable on tablet and mobile; no horizontal scroll; touch-friendly

### 8.5 MEDIUM — No prefers-reduced-motion support
- **Files**: `web/clawser.css`
- **Plan**:
  1. Add media query:
     ```css
     @media (prefers-reduced-motion: reduce) {
       *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
     }
     ```
- **Effort**: 10 min
- **Acceptance**: Animations disabled when user prefers reduced motion

### 8.6 MEDIUM — Item bar search missing
- **Files**: `web/clawser-item-bar.js`
- **Plan**:
  1. Add search input at top of item bar dropdown
  2. Filter items by name on keyup (case-insensitive substring match)
  3. Show "No matches" when filter returns empty
- **Effort**: 1 hour
- **Acceptance**: User can filter 100+ conversations by typing; instant results

### 8.7 MEDIUM — File browser not paginated
- **Files**: `web/clawser-ui-panels.js` (refreshFiles)
- **Plan**:
  1. Limit initial render to 50 items
  2. Add "Load more" button or infinite scroll
  3. Show total count in header
- **Effort**: 1 hour
- **Acceptance**: Directories with 1000+ files render fast; pagination controls visible

### 8.8 LOW — Font size inconsistency (9px–16px)
- **Files**: `web/clawser.css`
- **Plan**:
  1. Define type scale CSS variables:
     ```css
     --text-xs: 11px; --text-sm: 13px; --text-base: 14px; --text-lg: 16px;
     ```
  2. Replace all hardcoded font sizes with variables
  3. Eliminate anything below 11px (WCAG minimum)
- **Effort**: 1 hour
- **Acceptance**: All text uses type scale variables; minimum 11px

### 8.9 LOW — No print styles
- **Files**: `web/clawser.css`
- **Plan**:
  1. Add `@media print` rules: hide sidebar, header, input area; show messages only
  2. Set body background to white, text to black
- **Effort**: 30 min
- **Acceptance**: Chat conversation prints cleanly

---

## 9. Build & Deploy Gaps (8 items)

### 9.1 CRITICAL — No CI/CD pipeline
(See 6.1 — consolidated there)

### 9.2 HIGH — PWA icons broken
- **Files**: `web/manifest.json`
- **Plan**:
  1. Create proper icon set: 192x192, 512x512 PNG
  2. Generate from SVG source (crab/claw icon design)
  3. Update manifest.json with multiple icon entries
  4. Add apple-touch-icon link in index.html
- **Effort**: 1 hour
- **Acceptance**: PWA installs with proper icon on all platforms

### 9.3 HIGH — 339MB target/ directory in repo
- **Files**: `.gitignore`, `target/`
- **Plan**:
  1. Verify `target/` is in .gitignore (it is: `/target`)
  2. If committed to git history, remove with:
     ```bash
     git rm -r --cached target/
     ```
  3. Add `Cargo.lock` to .gitignore (not needed for application)
  4. Commit the cleanup
- **Effort**: 15 min
- **Acceptance**: `target/` not tracked; .gitignore complete; repo clone size reduced

### 9.4 MEDIUM — No Service Worker
- **Files**: `web/sw.js` (missing)
- **Plan**:
  1. Create minimal Service Worker for offline caching
  2. Cache: index.html, all clawser-*.js, clawser.css, manifest.json
  3. Network-first strategy for CDN dependencies
  4. Register in index.html
- **Effort**: 2 hours
- **Acceptance**: App loads offline after first visit; SW updates on new deployment

### 9.5 MEDIUM — No Docker setup
- **Files**: `Dockerfile` (missing)
- **Plan**:
  1. Create minimal Dockerfile:
     ```dockerfile
     FROM nginx:alpine
     COPY web/ /usr/share/nginx/html/
     EXPOSE 80
     ```
  2. Add `.dockerignore` (exclude target/, .reference/, .git/)
  3. Document in deployment guide
- **Effort**: 30 min
- **Acceptance**: `docker build && docker run` serves working Clawser instance

### 9.6 MEDIUM — Cargo.toml edition field wrong
- **Files**: `Cargo.toml` (line 11)
- **Current**: `edition = "2024"`
- **Plan**: Change to `edition = "2021"` (latest stable Rust edition)
- **Effort**: 1 min
- **Acceptance**: `cargo check` passes without edition warning

### 9.7 LOW — Rust demo binaries likely broken
- **Files**: `demo/`
- **Plan**:
  1. Test each demo binary: `cargo run --bin health_investigation` etc.
  2. If broken, add `README.md` in demo/ noting they are historical reference
  3. Consider archiving the entire demo/ directory
- **Effort**: 1 hour
- **Acceptance**: Demo status documented; broken demos clearly marked

### 9.8 LOW — No manifest.json scope field
- **Files**: `web/manifest.json`
- **Plan**:
  1. Add `"scope": "/web/"` to manifest
  2. Update `start_url` to be relative: `"start_url": "index.html"`
- **Effort**: 5 min
- **Acceptance**: PWA scope correctly set

---

## 10. Performance Gaps (5 items)

### 10.1 MEDIUM — Memory recall not cached
- **Files**: `web/clawser-agent.js` (memoryRecall)
- **Plan**:
  1. Add simple LRU cache (50 entries, 2-min TTL) for recall results
  2. Invalidate on memoryStore/memoryForget
  3. Cache key: query + category + limit hash
- **Effort**: 1 hour
- **Acceptance**: Repeated queries return cached results; cache invalidated on mutation

### 10.2 MEDIUM — No lazy panel rendering
- **Files**: `web/clawser-ui-panels.js`, `web/clawser-app.js`
- **Plan**:
  1. Only render panel DOM when panel becomes active
  2. Cache rendered panels (don't re-render on re-visit unless data changed)
  3. Add `dirty` flag per panel, set on relevant events
- **Effort**: 3 hours
- **Acceptance**: Inactive panels have empty DOM; switching renders on demand; no visible delay

### 10.3 MEDIUM — Response cache TTL hardcoded
- **Files**: `web/clawser-providers.js` (ResponseCache)
- **Plan**:
  1. Accept `ttlMs` and `maxEntries` in constructor
  2. Expose via agent config
  3. Default: 30min TTL, 500 entries (current values)
- **Effort**: 30 min
- **Acceptance**: Cache TTL and size configurable via agent config

### 10.4 MEDIUM — localStorage access unoptimized
- **Files**: Multiple modules
- **Plan**:
  1. Create `ConfigCache` class that reads localStorage once, writes on mutation
  2. Replace direct `localStorage.getItem/setItem` in hot paths
  3. Flush cache on workspace switch
- **Effort**: 2 hours
- **Acceptance**: Hot-path reads hit in-memory cache; writes batch-flush

### 10.5 LOW — Hardcoded limits not configurable
- **Files**: `web/clawser-agent.js`, `web/clawser-codex.js`, `web/clawser-providers.js`
- **Plan**:
  1. Extract to agent config object:
     - `maxToolIterations` (default 20)
     - `maxResultLength` (default 1500)
     - `cacheMaxEntries` (default 500)
     - `cacheTtlMs` (default 1800000)
     - `execTimeoutMs` (default 30000)
     - `maxFileReadSize` (default 50MB)
     - `maxFileWriteSize` (default 10MB)
  2. Load from workspace config on init
  3. Expose in config panel UI
- **Effort**: 2 hours
- **Acceptance**: All limits configurable; defaults match current behavior

---

## 11. Error Handling Gaps (5 items)

### 11.1 HIGH — MCP requests have no timeout
- **Files**: `web/clawser-mcp.js` (#rpc method)
- **Plan**:
  1. Add AbortController with configurable timeout (default 30s):
     ```js
     const controller = new AbortController();
     const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
     const resp = await fetch(this.#endpoint, { ...opts, signal: controller.signal });
     clearTimeout(timeout);
     ```
  2. Catch AbortError and return meaningful message
  3. Make timeout configurable per-server
- **Effort**: 30 min
- **Acceptance**: Hung MCP requests timeout after 30s; error message returned to agent

### 11.2 HIGH — Conversation locking missing
- **Files**: `web/clawser-ui-chat.js`
- **Plan**:
  1. Set `state.isSending = true` at start of sendMessage (already done)
  2. Disable conversation switching while isSending is true
  3. In switchConversation, check `state.isSending` and reject with UI feedback
  4. Add visual indicator (lock icon) on active conversation during send
- **Effort**: 1 hour
- **Acceptance**: Cannot switch conversations while message is being processed

### 11.3 HIGH — No rate limit exceeded feedback
- **Files**: `web/clawser-agent.js` (AutonomyController), `web/clawser-ui-chat.js`
- **Plan**:
  1. When AutonomyController blocks action, emit event with details
  2. Show user-facing message: "Rate limit reached: {X} actions/hour. Resets in {Y} minutes."
  3. Add rate limit status to config panel (current usage / limit)
- **Effort**: 1 hour
- **Acceptance**: User sees clear message when rate limited; can check current usage

### 11.4 MEDIUM — Dynamic import in agent hot path
- **Files**: `web/clawser-agent.js` (ResponseCache import in run())
- **Plan**:
  1. Move `import('./clawser-providers.js')` to top-level static import
  2. Or pass ResponseCache via constructor DI (preferred)
  3. Remove dynamic import from run() loop
- **Effort**: 15 min
- **Acceptance**: No dynamic imports in run() or runStream() methods

### 11.5 MEDIUM — autoAwait regex too aggressive
- **Files**: `web/clawser-codex.js`
- **Plan**:
  1. Improve regex to skip matches inside string literals and comments
  2. Simple approach: pre-strip string contents before matching, apply transforms to original
  3. Or use a basic tokenizer to identify code vs string/comment regions
  4. Add test cases for: `const s = "browser_fetch()"` (should NOT add await)
- **Effort**: 1 hour
- **Acceptance**: autoAwait skips strings and comments; test cases pass

---

## 12. Storage & Persistence Gaps (4 items)

### 12.1 HIGH — No OPFS quota management
- **Files**: `web/clawser-tools.js` (WorkspaceFs)
- **Plan**:
  1. Check `navigator.storage.estimate()` on workspace init
  2. Log warning if usage > 80% of quota
  3. Show quota bar in config panel (used / total)
  4. Add "Clean up old conversations" action
- **Effort**: 1 hour
- **Acceptance**: Quota visible in config; warning shown at 80%

### 12.2 MEDIUM — Old conversations accumulate indefinitely
- **Files**: `web/clawser-ui-chat.js`, `web/clawser-app.js`
- **Plan**:
  1. Add conversation age display in item bar
  2. Add "Delete conversations older than X days" option
  3. Add storage usage per conversation (approximate from event count)
  4. Add bulk delete UI
- **Effort**: 2 hours
- **Acceptance**: User can bulk-clean old conversations; storage freed

### 12.3 MEDIUM — Checkpoint binary format undocumented
- **Files**: `web/clawser-agent.js` (checkpoint/restore)
- **Plan**:
  1. Document in EVENT_LOG_SPEC.md: checkpoint is JSON-encoded Uint8Array
  2. Document fields: history, goals, schedulerJobs, goalIdCounter
  3. Document migration chain: v2 OPFS dir → v1 OPFS file → v0 binary
- **Effort**: 30 min
- **Acceptance**: Checkpoint format fully documented

### 12.4 LOW — localStorage keys not versioned
- **Files**: `web/clawser-state.js` (lsKey)
- **Plan**:
  1. Add version prefix to key builders: `clawser_v1_memories_{wsId}`
  2. Add migration function for existing keys on first load
  3. Document versioning strategy
- **Effort**: 1 hour
- **Acceptance**: Keys include version; migration handles existing data

---

## 13. Untracked Files — Commit Plan (1 item)

### 13.1 HIGH — 9 untracked files need committing
- **Files**: All `??` files from git status
- **Plan**:
  1. Stage new feature files:
     ```
     web/clawser-agent-ref.js
     web/clawser-agent-storage.js
     web/clawser-cli.js
     web/clawser-item-bar.js
     web/clawser-shell-builtins.js
     web/clawser-terminal-sessions.js
     ```
  2. Stage new documentation:
     ```
     README.md
     ARCHITECTURE.md
     ROADMAP.md
     ```
  3. Stage modified files (12 files from git status)
  4. Create commit with descriptive message
- **Effort**: 10 min
- **Acceptance**: All files tracked; clean git status

---

## Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Documentation | 2 | 6 | 3 | 1 | 12 |
| Code — Critical Fixes | 3 | 0 | 0 | 0 | 3 |
| Code — Providers | 0 | 2 | 2 | 0 | 4 |
| Code — Tools & Shell | 0 | 2 | 2 | 1 | 5 |
| Architecture | 0 | 3 | 1 | 1 | 5 |
| Testing | 0 | 4 | 2 | 1 | 7 |
| Security | 2 | 3 | 2 | 0 | 7 |
| UX & Accessibility | 0 | 2 | 5 | 2 | 9 |
| Build & Deploy | 0 | 2 | 4 | 2 | 8 |
| Performance | 0 | 0 | 4 | 1 | 5 |
| Error Handling | 0 | 3 | 2 | 0 | 5 |
| Storage | 0 | 1 | 2 | 1 | 4 |
| Git Cleanup | 0 | 1 | 0 | 0 | 1 |
| **Total** | **7** | **29** | **29** | **10** | **75** |

### Estimated Total Effort

| Priority | Items | Estimated Hours |
|----------|-------|----------------|
| Critical | 7 | ~7 hours |
| High | 29 | ~45 hours |
| Medium | 29 | ~45 hours |
| Low | 10 | ~15 hours |
| **Total** | **75** | **~112 hours** |

### Recommended Execution Order

**Week 1**: Critical fixes (2.1–2.3) + LICENSE (1.1) + git cleanup (13.1) + CI setup (6.1)
**Week 2**: High-priority code fixes (3.1–3.2, 4.1–4.2) + security (7.1–7.4) + docs (1.3–1.7)
**Week 3**: Architecture refactoring (5.1–5.3) + testing (6.2–6.4) + error handling (11.1–11.3)
**Week 4**: UX & accessibility (8.1–8.2, 8.3) + build/deploy (9.2–9.5) + performance (10.1–10.3)
**Ongoing**: Medium and low priority items as capacity allows
