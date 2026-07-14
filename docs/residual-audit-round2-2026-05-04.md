# Residual Hiding Spots Audit — Round 2 (2026-05-06)

> Hunting the remaining 8% from the prior residual audit. Five named
> targets, four-round sweep. Found three real bugs (one HIGH-IMPACT)
> plus two structural gaps surfaced. Tests stayed green.
>
> **Final: 9406 / 0 fail**, +3 from prior baseline 9403.

---

## Round 1 — BroadcastChannel timing + agent/peerNode method enumeration

### 1.1 IdentitySyncCoordinator symmetric race-condition — **fixed (HIGH-IMPACT)**

`IdentitySyncCoordinator.acquireCreateLock(podId)` had a classic
symmetric-yield bug:

```
Tab A: pendingCreates.add(podId); broadcast intent; wait 100ms
Tab B: pendingCreates.add(podId); broadcast intent; wait 100ms
A receives B's intent → A.pendingCreates.has(podId) → true → DELETE  // yield
B receives A's intent → B.pendingCreates.has(podId) → true → DELETE  // yield
After 100ms: A returns false. B returns false. NEITHER acquired.
```

Concrete failure mode: two tabs racing to create an identity for the
same podId both fail. The next attempts succeed because by then one
tab has won the race naturally — but the initial race produces no
winner.

**Fix.** Two changes:
1. `acquireCreateLock` now sends a tiebreaker token in the intent
   broadcast.
2. `#handleMessage` for `create-intent` only yields if the peer's
   token compares lower than ours (lexicographic). Otherwise it
   *responds* with our own intent (with `_isResponse: true` to
   prevent ping-pong) so the asymmetric-arrival case still resolves:
   the lower-token tab eventually wins.

The asymmetric-arrival problem is subtle. In Promise.all:
- Tab A's sync portion runs first (sets pending, postMessage).
- B's onmessage fires, but B has nothing pending yet → no-op.
- Tab B's sync portion runs (sets pending, postMessage).
- A's onmessage fires; A has tokA, peer is tokB. Compare and resolve.

Without the response-broadcast, B never sees A's intent. With it, A
broadcasts back when it wins, and B then sees A and yields.

New test in `clawser-mesh-identity.test.mjs` builds two paired
coordinators and asserts XOR (exactly one acquires).

### 1.2 Other BroadcastChannel users — verified clean

- **mesh-discovery.js** `BroadcastChannelStrategy`: uses sender-supplied
  `discoveredAt` via `record.toJSON()` / `fromJSON()`. Correct.
- **tab-views.js**: pure broadcast/receive, no election semantics.
- **sw-heartbeat.js**: one-way SW → tab broadcast with sender's
  timestamp. No bug.
- **channel-relay.js**: uses `raw.timestamp || Date.now()` fallback.
  Correct.
- **AgentBusyIndicator** (clawser-daemon.js:796): broadcasts but never
  receives — `this.#channel.onmessage` is never set. **Orphan-ish**:
  no production caller, half-implemented class. Surfaced.
- **CrossTabToolBridge** (clawser-daemon.js:923): creates a channel
  but never sends or receives on it; `invoke()` runs locally only.
  **Orphan**: no production caller. Surfaced.

### 1.3 agent.X.method() and peerNode.X.method() enumeration — verified clean

Enumerated every `agent.<method>(` and `peerNode.<prop>` call across
UI modules, mapped to source classes. All methods exist. No new
ghost-method bugs found beyond those caught in prior passes.

`peerNode.wallet.<method>` calls (createIdentity, exportIdentity,
addContact, etc.) all live in `clawser-identity-wallet.js` (the
Wallet class), distinct from `clawser-mesh-identity.js`
(MeshIdentityManager). Verified.

**Round 1 delta: 1 HIGH-IMPACT bug fixed; 2 orphan classes
surfaced; +1 test.**

---

## Round 2 — transport variants

### 2.1 WebSocket reconnect-exhausted error surface — **fixed**

`WebSocketTransport._handleReconnect()` had a silent failure path
when the reconnect budget was exhausted:

```
if (this.#reconnectAttempts >= this.#maxReconnectAttempts) return;
```

After 5 failed reconnects (default), the function silently returned.
The `'error'` event was never fired. The user's transport sat at
`disconnected` state with no UI feedback.

Fix: fire `'error'` with a clear message when budget exhausted, and
also fire on the catch path's terminal failure (when retry can't
continue).

### 2.2 Relay transport not implemented in production — **surfaced (STRUCTURAL)**

`MeshRelayClient.connect()` has the comment:

```
// In production this would open a WebSocket to this.#relayUrl.
// For now only the mock path is supported.
```

Without a `mockServer` parameter, `connect()` just sets state to
'connected' without opening any actual connection. Fires the
'connect' callbacks. Production callers (`clawser-workspace-init-mesh.js:732`)
do `state.relayClient.connect()` with no mockServer.

**Concrete user impact:** the relay-based mesh is a stub. If the
user toggles "Relay auto-connect" in Settings → Mesh, the client
appears connected but no relay traffic flows. Peers connected via
relay never actually communicate.

This is a structural gap, not a contained fix — the WebSocket relay
client implementation is missing. Surfaced.

### 2.3 WebTransport — verified clean

`WebTransportBridge`: error handling on `transport.closed` →
`_fire('error', ...)`. Datagram/stream read loops swallow errors
silently, which is OK because `transport.closed` fires on real
disconnect. No auto-reconnect (feature gap, not bug).

**Round 2 delta: 1 contained fix; 1 structural gap surfaced.**

---

## Round 3 — EventLog replay completeness

### 3.1 Built the matrix

**Event types appended in clawser-agent.js (25 total):**

Replayed by `deriveSessionHistory`: `user_message`, `agent_message`,
`tool_call`, `tool_result`.

Replayed by `deriveToolCallLog`: `tool_call`, `tool_result`.

Replayed by `deriveGoals`: `goal_added`, `goal_updated`, `goal_edited`,
`goal_removed`.

Audit-only (intentional non-replay): `memory_stored`, `memory_forgotten`,
`scheduler_added`, `scheduler_fired`, `scheduler_removed`, `cache_hit`,
`error`, `provider_error`, `stream_error`, `autonomy_blocked`,
`idle_resume`, `context_compacted`, `safety_input_flag`,
`safety_tool_blocked`, `safety_output_blocked`, `safety_output_redacted`,
`tool_result_truncated`.

After the prior pass added `goal_edited` + `goal_removed` replay,
**all silent-skip event types are now correctly replayed or marked
audit-only.**

### 3.2 Defensive registry — **added**

To prevent future silent-skip bugs (the pattern that caught
`goal_edited`/`goal_removed`), added an exported `KNOWN_EVENT_TYPES`
constant in `clawser-agent.js` listing every event type with its
disposition (replayed or audit-only) in a comment.

Added a lint-style test in `clawser-agent.test.mjs` that:
1. Reads the agent source file.
2. Greps for every `eventLog.append('X', ...)` call.
3. Asserts each event type is in `KNOWN_EVENT_TYPES`.

If a developer adds a new event type without entering it in the
registry, the test fails with a clear message pointing at the
required updates.

**Round 3 delta: 1 defensive lint check added; +1 test.**

---

## Round 4 — skill hot-reload + kernel tenant on workspace switch

### 4.1 SkillHotReloader workspace-switch race — **fixed**

The hot-reloader polls in the background (`setTimeout`-driven). If
the user switches workspaces while a poll is in flight:

```
1. Tab is on workspace A. Poll fires. #wsId=A. Scans A's skill dir.
2. Mid-scan, user switches to B. cleanupWorkspace → stop().
3. setWorkspace(B) clears #hashes/#timestamps and sets #wsId=B.
4. In-flight poll resumes. It writes A's currentHashes back into
   #hashes. Now #hashes=A's data, #wsId=B. State is corrupt.
5. Next poll for B sees all-changed (because #hashes are A's),
   triggers wasteful reactivation.
```

Severity: minor (corrects on next poll) but causes spurious
re-activation work and momentarily wrong active-skill state.

Fix: capture `startWsId = this.#wsId` at the start of `#doPoll()`.
After scanning, if `this.#wsId !== startWsId`, abort the poll
without writing back — the next poll will rebuild correctly from
empty `#hashes` (since `setWorkspace` cleared them).

New test in `clawser-skill-hot-reload.test.mjs` triggers the race
synthetically: starts a poll, calls `setWorkspace` mid-poll,
asserts the abort path fires + returns empty.

### 4.2 Kernel tenant boundaries on workspace switch — **verified clean**

Walked the lifecycle:
- `cleanupWorkspace`: persists state, then `destroyWorkspaceTenant(oldWsId)`.
- `switchWorkspace` calls cleanup, then `agent.reinit({})` (which clears
  `_kernelIntegration` to null), then `createWorkspaceTenant(newId)`.
- `_kernelIntegration` use in agent (line 1954) is optional-chained,
  so the brief window between destroy and create is safe.

One **edge case surfaced** (not fixed): `cleanupWorkspace` doesn't
await any in-flight `agent.run()` before destroying the tenant.
If the user switches workspaces mid-turn:
- The in-flight run continues with a destroyed tenant.
- Optional-chain on `_kernelIntegration` saves a crash, but the run's
  output (tool calls, llm responses) is being persisted to the new
  workspace's state via the still-shared `state.agent` reference.

Severity: rare race in practice (users don't typically switch
workspaces mid-LLM-turn). Real fix requires awaiting the in-flight
turn or aborting it cleanly. Surfaced for future pass.

**Round 4 delta: 1 contained fix; 1 edge case surfaced; +1 test.**

---

## Convergence

Round 4 produced one contained fix. Round 5 cap was set at 4.
**Stopped at 4 per spec.**

Sanity sweep at end of Round 4:
- Re-ran `state.X.method()` enumeration after Round 1's fix —
  no regressions.
- Verified the IdentitySyncCoordinator fix doesn't break in
  mixed-version (tab without token gracefully loses).
- Verified the EventLog registry lint test fires when a fake event
  is added.
- Verified the hot-reload test catches the race even when poll
  completes before the wsId change (race-free path).

---

## Final status

- **Test count:** 9406 / 0 fail (+3 from baseline 9403: identity
  tiebreaker test + EventLog registry lint test + hot-reload race
  test).
- **Reports:** `docs/residual-audit-round2-2026-05-04.md` (this file),
  `docs/residual-audit-2026-05-04.md`, `docs/panel-convergence-2026-05-04.md`,
  `docs/panel-audit-2026-05-04.md`.
- **Files modified:**
  - `web/clawser-mesh-identity.js` — `IdentitySyncCoordinator`
    tiebreaker token + response-broadcast
  - `web/clawser-mesh-websocket.js` — fire 'error' on reconnect
    budget exhaustion
  - `web/clawser-agent.js` — `KNOWN_EVENT_TYPES` constant + comment
  - `web/clawser-skill-hot-reload.js` — abort stale poll on
    wsId change mid-scan
  - `web/test/clawser-mesh-identity.test.mjs` — +1 test
  - `web/test/clawser-agent.test.mjs` — +1 lint test
  - `web/test/clawser-skill-hot-reload.test.mjs` — +1 test

---

## Surfaced — closure (2026-05-06 follow-up pass)

All three structural items from this audit were closed in a
focused follow-up pass on 2026-05-06:

1. **~~Relay transport unimplemented in production.~~** **CLOSED.**
   `MeshRelayClient.connect()` now opens a real WebSocket to
   `relayUrl` when no `MockRelayServer` argument is supplied. Wire
   protocol (register / announce / find / signal outbound;
   peer_announce / signal / find_response / error inbound) mirrors
   the mock's in-memory semantics exactly. Auto-reconnect with
   exponential backoff and budget exhaustion → 'error' event.
   6 new tests using a paired-WS fixture.
   Production wiring also surfaces relay errors via `addErrorMsg`.

2. **~~AgentBusyIndicator + CrossTabToolBridge orphans.~~** **CLOSED
   (split decision).**
   - AgentBusyIndicator: completed. Added receive side
     (`onmessage` handler), peer-state map, `subscribe(cb)`,
     `peerStates()`, `isAnyPeerBusy()`, stale-peer pruning. 3 new
     paired-channel tests.
   - CrossTabToolBridge: **deleted.** The class docstring promised
     cross-tab tool invocation but `invoke()` ran locally only and
     the channel was never used. The receive side, request/response
     routing, and timeout handling were all unimplemented. No
     production caller existed. Tests removed with explanatory note.

3. **~~Workspace-switch-during-agent-turn race.~~** **CLOSED.**
   Added `agent.awaitRun({timeoutMs, onWaiting, gracePeriodMs})`
   that polls `isRunning` and resolves when the current turn
   settles. `cleanupWorkspace` now awaits it (5s budget) before
   destroying the kernel tenant and persisting state — surfaces
   "finishing agent turn..." in the status bar after a 150ms
   grace period. Times out gracefully via `agent.cancel()` if
   needed. 3 new agent tests.

---

## Brutal-honest residual-gap assessment

Confidence after this pass: **~95%** (up from 92% prior). Key
findings this round:

- The IdentitySyncCoordinator bug was a real symmetric-yield
  race with the same shape as the TabCoordinator leader-election
  bug. Both required reading protocol semantics carefully — static
  enumeration cannot catch them.
- The relay-not-implemented gap is significant. It was not a "bug"
  per se (the code is honest in its comment), but the production
  wiring uses it as if it were complete. This is an integration gap
  worth flagging at high priority.
- The EventLog registry/lint check institutionalizes the lesson
  from the goal_edited/goal_removed silent-skip pattern. New event
  types now get caught at test time.
- The hot-reload race was easy to find by reading the code, not
  via grep. It illustrates that there's a class of bugs that only
  surface from "what if X fires while Y is in flight" mental
  simulation.

Where the remaining ~5% likely hides:

- **More "X mid-flight while Y happens" race conditions.** The
  hot-reload race was found by reading the code with that lens.
  Other long-running async operations (agent.run, MCP queries,
  vault unlock, OPFS quota recovery) might have similar shape.
- **The relay protocol complete implementation** would itself
  introduce new failure modes once built. The current state is
  "not implemented" — auditing the future implementation is
  out of scope.
- **Unhandled promise rejections** from background tasks. Some
  silent catches in transport / hot-reload paths swallow errors.
  Not all are "bugs" — some are intentional. A targeted
  unhandledrejection global handler audit could surface real ones.
- **State observability across kernel tenants.** Multi-tenant
  isolation means a service registered under tenant A is invisible
  to tenant B. If a UI panel uses kernel services and the tenant
  changes, the panel could show data that's no longer reachable.
  Not yet exercised since most UI bypasses the kernel layer.
- **Cross-component state inconsistency under crash.** If a
  persistConfig fails mid-write, localStorage could have partial
  data. Fallback paths (default values) cover most, but not
  exhaustively verified.

If a 5th-round audit is needed, the "X mid-flight while Y happens"
pattern is the highest-yield target.
