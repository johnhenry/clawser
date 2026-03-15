# Clawser — Outstanding Work

> Fresh audit generated 2026-03-14 from deep source code verification,
> 7127-test full suite run (0 failures), and cross-reference of all
> Heynote plans against actual implementation.

---

## Current State: Clean

**7,127 tests passing. 0 failures. All previously reported bugs fixed.**

Many items from earlier audits were false positives — the features already existed
but the audit agents didn't look deep enough. This document reflects verified reality.

---

## Verified Done (was reported as missing, actually exists)

| Item | Reality |
|------|---------|
| deleteConversation() | Exists at `clawser-conversations.js:88` and `clawser-agent.js:3765` |
| Conversation export | `exportConversationAsJSON()` and `exportConversationAsText()` in `clawser-ui-chat.js:757` |
| transformResponse hook | Invoked on cache hit path at `clawser-agent.js:1769-1770` |
| FileTransfer.dispatch() | Exists at `clawser-mesh-files.js:550` |
| MeshACL grant/revoke | Added as aliases: `grant()→addEntry()`, `revoke()→revokeAll()` |
| EmbeddedPod.emit() | Event system implemented with `#listeners` Map |
| Preset round-trip | `source` and `metadata` fields preserved at import (lines 136-137) |
| Agent #runAbort | Cleared on all return paths in both `run()` and `runStream()` |

---

## Genuine Remaining Items

### Code Quality [NICE-TO-HAVE]

- [ ] **Shell tab completion** — No autocomplete for commands or file paths. `// TODO` added.
- [ ] **Vault recovery codes** — No recovery if passphrase forgotten. `// TODO` added.
- [ ] **DID spec compliance** — MVP `did:key:z<podId>` encoding, not W3C multicodec. `// TODO` added.
- [ ] **41 silent catch blocks** — Annotated but not all converted to structured logging.
- [ ] **Relay auto-connect UX** — Configurable via localStorage but no Settings UI field.

### Roadmap (from Heynote Plans)

- [ ] **4.1** Scheduler Overhaul (Block 61) — ~560 LOC
- [ ] **4.2** Read-Only OPFS Directories (Block 53) — ~60 LOC
- [ ] **4.3** Tab Watcher Extension Plugin (Block 70) — ~610 LOC
- [ ] **4.4** P2P Scenario Completion (Block 66) — ~3,070 LOC
- [ ] **4.5** Agent→Account→Provider Simplification (Block 52) — ~245 LOC
- [ ] **4.6** BrowserMesh Package Ecosystem (Phase 10) — 9 npm packages

### Ecosystem [NICE-TO-HAVE]

- [ ] **5.1** Publish npm embed package
- [ ] **5.2** Skills marketplace backend (agentskills.io)
- [ ] **5.3** Channel integrations with real API credentials
- [ ] **5.4** Chrome Web Store extension publication
- [ ] **5.5** Verify IPFS Helia CDN URL freshness
- [ ] **5.6** Verify IoT bridge with real hardware

---

## Summary

| Category | Count | Status |
|----------|-------|--------|
| Verified false positives | 8 | Features already existed |
| Bugs | 0 | All fixed, 7127 tests pass |
| Code quality TODOs | 5 | Nice-to-have, documented in source |
| Roadmap features | 6 | Future development phases |
| Ecosystem | 6 | External publishing/verification |
| **Total remaining** | **17** | **0 bugs, 5 polish, 12 future work** |
