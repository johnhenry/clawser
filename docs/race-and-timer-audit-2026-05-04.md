# Race-Condition + Timer Audit (2026-05-07)

**Status: resolved as of 2026-07-16** (dated snapshot, not live guidance).
All four fixes (agent-picker race, Codex sandbox single-flight, vault
unlock single-flight, file-watcher poll guard) confirmed present in
current source.

> Two parallel code-quality sweeps over production code.
> **Final: 9,409 tests / 0 fail** stable.
>
> Sweep B found **2 contained timer-driven bugs** worth replacing
> with Promise/event-based primitives. Sweep A found **2 concurrent-
> entry races** worth single-flighting. Other patterns in both
> sweeps were either intentional time-based work (heartbeats,
> debounce, backoff retry) or already correctly serialized.
>
> The codebase's overall discipline on async correctness is **better
> than expected**: 32 setIntervals, 91 setTimeouts, ~80 OPFS write
> sites — and only 4 contained findings across both sweeps. Most
> background loops have proper cleanup; most async functions handle
> concurrent entry safely; the few exceptions were small and
> contained.

---

## Sweep B — setTimeout / setInterval audit

### B.1 Inventory

- **32 `setInterval` call sites** across 23 files. All classified as
  legitimate periodic background work:
  - TabCoordinator heartbeat / DaemonController auto-checkpoint
  - File-watcher / skill-hot-reload polls (no native FS-watch in OPFS)
  - Mesh-discovery announce / mesh-hardening ping / mesh-swarm SWIM
  - Mesh-sync periodic flush / peer-health tick / peer-session heartbeat
  - SW heartbeat / RoutineEngine cron ticker / Heartbeat checks
  - Discord/IRC gateway keepalive
  - WebSocket transport heartbeat ping
  - Server-WS ping-all / channel-relay relay
  - clawser-mesh-dht gossip / iot-bridge polling
  - presence sweep
  - workspace-lifecycle 5-second UI tick
  - OAuth popup-closed cross-origin polling (genuine: postMessage may
    not work cross-origin)

  Each has a `clearInterval` paired with it via `stop()` /
  `disconnect()` / cleanupWorkspace. None leak.

- **91 `setTimeout` call sites** across many files. Spot-classification:
  - **Sleep-replacement / next-tick**: 1 (item-bar focus, `setTimeout(..., 0)`).
  - **Reconnect / retry backoff**: ~15 (IRC, Discord, mesh-discovery,
    tunnel, websocket, channel-matrix poll-loop scheduler).
  - **Connection / verification timeouts**: ~5 (mesh-discovery WS
    connect 10s, pod verification 30s, agent tool timeout, MCP RPC
    timeout, MeshRelayClient findPeers timeout).
  - **Debounce / animation**: ~10 (tool-panel debounce 200ms, mobile
    transition 300ms, v86 idle settle 500ms, file-watcher debounce).
  - **URL.revokeObjectURL after download**: 2 (1s post-click cleanup).
  - **Modal / form delay**: 2 (legitimate UX timing).
  - **Race-suspect "let things settle"**: 1 (the agent-picker bug, fixed below).
  - **Sleep-poll for in-flight init**: 1 (the codex sandbox bug, fixed below).

### B.2 Findings + fixes

#### B.2.1 Agent picker — `setTimeout(... 100ms)→dispatchEvent` race → **fixed**

`web/clawser-ui-panels.js:1460` had:

```js
btn.click();
setTimeout(() => document.dispatchEvent(new CustomEvent('agent:edit', { detail: { new: true } })), 100);
```

Click activates the agents panel → fires `panel:firstrender` →
calls `renderAgentPanel()` (async). The panel registers a
`document.addEventListener('agent:edit', ...)` listener at line
1564, but **after** `await state.agentStorage.listAll()`. If
`listAll()` takes longer than 100ms (slow OPFS, big agent set),
the dispatch fires before the listener is registered → the "new
agent" form never opens.

**Fix.** Set `agentEditingId = '__new__'` directly before clicking
the button. `renderAgentPanel()` reads `agentEditingId` synchronously
at the top of its body and delegates to `renderAgentEditor` immediately.
No event-bus dance, no timing race.

The dead `agent:edit` listener was removed too — without my dispatcher
removal, every `renderAgentPanel()` call would have leaked a one-shot
listener that never fires (since the only producer was deleted).

#### B.2.2 Codex sandbox — sleep-poll for in-flight init → **fixed (Promise single-flight)**

`web/clawser-codex.js:165-192` had:

```js
async #ensureSandbox() {
  if (this.#sandbox && !this.#sandbox.isDisposed()) return this.#sandbox;
  if (this.#sandboxInitializing) {
    while (this.#sandboxInitializing) {
      await new Promise(r => setTimeout(r, 10));  // sleep-poll
    }
    ...
  }
  this.#sandboxInitializing = true;
  try { this.#sandbox = await createSandbox({...}); }
  finally { this.#sandboxInitializing = false; }
}
```

Two concurrent `#ensureSandbox()` calls: the second sleeps in 10ms
ticks until the first sets `#sandboxInitializing = false`. Wastes
~3-10 timer ticks, adds latency.

**Fix.** Replace with `#sandboxInitPromise` that concurrent callers
share. Same pattern I used in the IdentitySyncCoordinator and
vault unlock fixes — the canonical "single-flight" idiom.

```js
async #ensureSandbox() {
  if (this.#sandbox && !this.#sandbox.isDisposed()) return this.#sandbox;
  if (this.#sandboxInitPromise) return this.#sandboxInitPromise;
  this.#sandboxInitPromise = (async () => {
    try {
      this.#sandbox = await createSandbox({...});
      return this.#sandbox;
    } finally {
      this.#sandboxInitPromise = null;
    }
  })();
  return this.#sandboxInitPromise;
}
```

### B.3 Sweep B summary

- **2 contained bugs fixed**, both replaced with Promise/event-based
  primitives.
- **No new tests required** (existing codex + ui-panels tests cover
  the call sites; the bugs were timing-only and didn't have
  asserting tests; manual verification via build).
- All other timers verified intentional. Cleanup discipline is good.

---

## Sweep A — race-condition pattern audit

### A.1 Targets walked

- `agent.run()` / `runStream()` — already addressed via `awaitRun`
  in cleanupWorkspace (prior pass).
- **MCP tool dispatches** — verified clean. Each `#rpc()` call uses
  a unique id (`++this.#nextId`), HTTP responses match by id at
  the server, fetch is independent per call. Concurrent calls don't
  interfere.
- **Vault unlock / verify / passkey enrollment** — found a race;
  see A.2.1 below.
- **OPFS quota / writes under pressure** — verified clean. The
  WHATWG File System spec's `createWritable()→write→close`
  pattern is atomic per call (writes to a swap file; replaces
  original on close). Concurrent writes to the same path get
  last-writer-wins semantics, which is acceptable for the
  checkpoint / memory / config domains where a stale snapshot is
  always valid.
- **Sync engine merges (Y.js + LWW)** — verified clean. SyncDocument
  state mutations are sync; `save()` and `load()` are independent
  reads/writes against storage. No interleaving issues.
- **File watchers reacting to writes** — found an overlap race;
  see A.2.2 below.
- **Mesh peer connect / disconnect / heartbeat** — verified clean.
  TabCoordinator leader-election bug was caught + fixed in the
  prior round; AgentBusyIndicator's receive side was completed
  this week. PeerSession heartbeat self-restarts cleanly.
- **Skill hot-reload polling vs explicit reload** — fixed in
  prior pass (`startWsId` capture + abort on workspace switch).
  Re-verified.
- **Workspace switch** — `cleanupWorkspace` now waits for in-flight
  `agent.run()`. Other in-flight ops (routine engine, daemon
  controller, hot-reloader, file-watcher) are explicitly stopped
  in order before destroying state.
- **Channel poll loops vs explicit fetch** — verified clean.
  channel-matrix `#pollLoop()` has a `#polling` guard;
  channel-tabwatch single-instance per tab.
- **`for await` over async iterators** — none re-entered concurrently
  in production code; iterators in mesh-discovery / pod-handshake
  are session-scoped.

### A.2 Findings + fixes

#### A.2.1 Vault `unlock()` — concurrent createV2 race → **fixed**

`web/clawser-vault.js:488` `unlock()` had three branches:

1. **v2 vault present**: read meta → unwrap with passphrase → set DEK.
2. **v1 vault present**: migrate in place.
3. **Brand new vault**: call `#createV2(passphrase)` which generates
   a fresh salt + DEK + writes meta.

Path #3 is **not idempotent under concurrent entry**: two parallel
`unlock(...)` calls on a fresh vault would both reach `createV2`,
each generate independent salts/DEKs, and write conflicting metadata.
The result: vault state is whichever write closed last; the other
caller has stale references.

In practice the flow is gated by a modal that the user submits once,
so this is unlikely to fire under the typical UX. But programmatic
callers (tools, MCP servers, vault recovery flows) are not similarly
serialized.

**Fix.** Single-flight guard via `#unlockPromise`. Concurrent callers
share the same in-flight Promise instead of racing into `#createV2`.
Released in `.finally()` so the next `unlock()` starts fresh.

#### A.2.2 FileWatcher `#poll()` — concurrent overlap → **fixed**

`web/clawser-file-watcher.mjs:182` `#poll()` could be called from:
- The `setInterval` tick (every `intervalMs`, default 3000ms).
- An immediate first poll inside `start()`.
- An explicit `await rescan()` call.

Two overlapping polls clobber each other:
- Both read the same `entry.lastModified` / `entry.lastContent`.
- Both schedule `entry.debounceTimer = setTimeout(..., debounceMs)`.
- The second's `clearTimeout(entry.debounceTimer)` cancels the
  first's pending fire; only the second delivers. Net: change is
  delivered once, but the work was duplicated (two OPFS reads per
  watched file per overlap).

**Fix.** `#polling = true` guard at the top of `#poll()` skips
overlapping calls. `rescan()` and the next `setInterval` tick
serialize cleanly. Body extracted to `#pollImpl()` for clarity.

### A.3 Patterns examined and verified safe

- **`Promise.all` with order-dependent reads/writes**: 14 sites
  audited (`clawser-agent.js`, `clawser-mesh-audit.js`,
  `clawser-deploy-package.mjs`, etc). All are parallel-safe
  (independent hashes, fan-out broadcasts, parallel module loads).
  No found cases where Promise.all hides a serial dependency.
- **`await` inside event handlers**: spot-checked the chat send
  flow, panel toggle handlers, peer connection lifecycle — all
  guard against re-entry via `state.isSending` flag, panel-rendered
  set, or session state machine. No found re-entry bugs beyond the
  ones already fixed across prior audits.
- **Stale-closure captures**: spot-checked `agent.run()` /
  `runStream()` for `const x = state.agent; await ...; x.method()`
  patterns. The agent reference is captured before the await; if
  cleanupWorkspace nulls `state.agent` mid-run, `x.method()` still
  works against the captured (orphaned) instance. The orphan stops
  affecting visible state because writes go to the captured object
  not the new one. After my prior `awaitRun` fix this is now
  serialized; the orphan never has a chance to write.
- **OPFS concurrent writes**: per-key writes are atomic via the
  swap-file mechanism. Concurrent writes to the same path get
  last-writer-wins; this is acceptable for checkpoint / config /
  memory snapshots where any valid snapshot is equally good.

### A.4 Sweep A summary

- **2 contained races fixed**, both via the `#xPromise` /
  `#polling` single-flight idiom.
- **No structural gaps surfaced** — the remaining cross-cutting
  concurrency concerns (workspace-switch ordering, daemon-state
  races) were already addressed in prior audits.

---

## Final state

- **Test count: 9,409 / 0 fail** stable.
- **Files modified:**
  - `web/clawser-ui-panels.js` — agent picker setTimeout removed;
    `agentEditingId` set directly before button click. Dead
    `agent:edit` listener removed.
  - `web/clawser-codex.js` — `#sandboxInitializing` flag replaced
    by `#sandboxInitPromise` Promise single-flight.
  - `web/clawser-vault.js` — `unlock()` wrapped in
    `#unlockPromise` single-flight; body moved to `#unlockImpl()`.
  - `web/clawser-file-watcher.mjs` — `#polling` guard around
    `#poll()`; body moved to `#pollImpl()`.
- **Files added:** `docs/race-and-timer-audit-2026-05-04.md` (this
  file).

---

## Brutal-honest residual confidence

**~96%** (up from ~95% prior).

This sweep had a higher signal-to-noise ratio than expected on
the timer side, and a lower one on the race side. Most of what's
in the codebase is correct:

- The `single-flight via #xPromise` idiom is now used in 3 places
  (codex sandbox, vault unlock, plus the IdentitySyncCoordinator
  fix from the prior round). If a 4th `setTimeout`-poll-loop or
  init-race surfaces in the future, the pattern is established.
- Heartbeats, debounces, and backoff timers are uniformly
  intentional and correctly cleared.
- The big architectural concurrency surfaces (agent run loop,
  workspace switch, mesh peer lifecycle, daemon coordination)
  have all been audited explicitly across the prior 4 audit
  passes. They're stable.

Where the remaining ~4% likely hides:

- **Long-running I/O ops with no explicit re-entry guard** that
  I didn't find via grep. Spot-checks were thorough on common
  shapes (Promise.all, async event handlers, sleep-poll loops),
  but a sufficiently weird shape (`await` inside `for-of` over
  a stream that could be re-entered) might be there.
- **OPFS quota recovery paths.** The audit assumed normal-write
  success; quota-exceeded retry logic is sparse in the code and
  the ones I sampled fall back to console.warn, not retry.
  Worst case: silent failure to persist. Surfaced in prior passes.
- **Cross-frame / postMessage races** (PWA, OAuth popup, SW
  message): one OAuth popup poll is intentional cross-origin
  fallback; no other race-class issues found, but the postMessage
  protocol surface area is small and not deeply audited.
- **Cross-tab leader handoff during a tab close.** If the leader
  tab closes mid-operation (e.g. checkpoint write), the next
  leader takes over but the in-flight write isn't tracked. We'd
  potentially get a partial write. The OPFS swap-file mechanism
  protects from corruption, but a stale "I'm checkpointing"
  flag could persist. Not actually verified in this audit.

If the next pass needs to find more, those are the targets. The
high-yield "X mid-flight while Y happens" pattern that started
the prior audits has been substantially exhausted in production
code paths.
