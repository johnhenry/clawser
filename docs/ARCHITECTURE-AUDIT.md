# Architecture Audit — March 2026

Comprehensive audit of the Clawser codebase for wiring bugs, architectural mismatches, and dead code.

## Findings & Fixes

### 1. Missing UI Toggle Bindings (FIXED)

Four new config sections had HTML elements but no `bindToggle()` calls in `clawser-ui-panels.js`:

- `checkpointToggle` / `checkpointSection` — Checkpoints & Rollback
- `hooksToggle` / `hooksSection` — Hooks management
- `discoveredToolsToggle` / `discoveredToolsSection` — Discovered Tools
- `identityEditorToggle` / `identityEditorSection` — Full Identity Editor

**Fix:** Added `bindToggle()` calls with `onOpen` callbacks to render section content. Added missing arrow span IDs (`checkpointArrow`, `identityEditorArrow`) to index.html.

### 2. Accounts vs Providers Disconnect (FIXED)

**Problem:** Agents selected providers by name ("openai") rather than by account ID. The FallbackExecutor—which supports account-based credential resolution—was never initialized despite being fully implemented.

**Data flow before fix:**
```
Agent -> provider name -> no credentials -> fails
```

**Data flow after fix:**
```
Agent -> FallbackExecutor -> accountResolver -> vault -> API key
```

**Fixes applied:**
- `clawser-workspace-lifecycle.js`: Initialize `FallbackExecutor` from saved chain at startup
- `clawser-agent.js`: `applyAgent()` now resolves credentials via `accountId` + `#accountResolver`
- `clawser-ui-config.js`: `_saveFallbackChain()` now updates the live FallbackExecutor on the agent

### 3. 28 New Tools Never Registered (FIXED)

All Phase 8 tools (Google, Notion, Slack, Linear, GitHub, Calendar, Email integrations) existed as standalone files but were never imported or registered in `clawser-workspace-lifecycle.js`.

**Fix:** Added imports and `state.browserTools.register()` calls for all 28 tools:
- 7 Google tools (Calendar, Gmail, Drive)
- 4 Notion tools
- 3 Slack tools
- 3 Linear tools
- 3 GitHub integration tools
- 3 Calendar integration tools
- 3 Email integration tools
- 2 Slack integration tools

All tools receive the `OAuthManager` instance and call `getClient(provider)` internally.

### 4. CORS Fetch Proxy Not Wired (FIXED)

`ExtCorsFetchTool` was never registered. Now registered with `getExtensionClient()` as the RPC client.

### 5. Gateway Server Not Initialized (FIXED)

`GatewayServer` was never instantiated. Now created during workspace init with `pairingManager`, `agent`, and `serverManager` dependencies.

### 6. FsObserver & TabViewManager Not Initialized (FIXED)

Both Phase 5 modules existed but were never instantiated. Now created during workspace init.

### 7. Shell pwd/cd (NO BUG FOUND)

Thorough investigation of `ShellState.cwd`, `cd`, `pwd`, `resolvePath`, and `normalizePath` found the logic to be correct. The truthiness check in the setter (`typeof value === 'string' && value`) works as intended for all paths.

## Remaining Items (Not Bugs, Just Incomplete Integration)

These are not bugs but areas where full integration requires user-facing decisions:

1. **Channel plugins** (Telegram, Discord, etc.) — defined but no channel configuration UI exists to create/configure channels
2. **Marketplace UI** — `clawser-ui-marketplace.js` exists but needs a panel in the navigation
3. **SharedWorker** — infrastructure exists but requires opt-in architecture decisions
4. **Mesh system** (Phase 8 BrowserMesh) — 16 modules exist on a separate branch, not yet merged

## Files Modified

| File | Changes |
|------|---------|
| `web/index.html` | Added `checkpointArrow`, `identityEditorArrow` IDs |
| `web/clawser-ui-panels.js` | Added 4 `bindToggle()` calls |
| `web/clawser-workspace-lifecycle.js` | Added 15 imports, 28 tool registrations, FallbackExecutor init, GatewayServer init, FsObserver init, TabViewManager init |
| `web/clawser-ui-config.js` | Added FallbackChain/FallbackExecutor import, live executor updates on chain save |
| `web/clawser-agent.js` | `applyAgent()` now resolves account credentials via accountId |
