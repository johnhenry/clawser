# Reverse Browser Terminal Backlog

This backlog defines the clean implementation path for a high-fidelity browser-backed reverse `wsh` terminal in Clawser.

The goal is to let the Rust CLI open an interactive shell into a live browser tab without duplicating the shell stack, without weakening capability boundaries, and without regressing existing local terminal features.

## Scope

In scope:

- interactive reverse `wsh` shell into a live Clawser tab
- browser-side virtual terminal sessions with incremental output
- CLI support for interactive reverse-connect sessions
- capability enforcement for `shell`, `tools`, and `fs`
- replay and reattach for browser-backed virtual sessions
- reuse of existing shell runtime, local terminal sessions, and real PTY support

Out of scope:

- true OS PTY behavior inside the browser
- curses/full-screen TUI compatibility (`vim`, `tmux`, `top`, `less`, etc.)
- preserving the exact current internal `wsh` client API shape if a cleaner one is better

## Non-Negotiable Design Rules

1. `ClawserShell` remains the only shell runtime.
2. Remote reverse terminals get their own `ClawserShell` instances. They must not mutate `state.shell` or the visible terminal session directly.
3. Real host PTY support stays intact for `wsh-server`.
4. Browser-backed sessions use an explicit virtual session data path, not `GatewayData` as the long-term terminal protocol.
5. `ReverseConnect` gets an explicit accept/reject handshake before the CLI opens a terminal channel.
6. Existing reverse non-terminal flows stay working: MCP, agent chat, file ops, policy evaluation, guest/copilot flows.
7. Capability exposure (`shell`, `tools`, `fs`) must be enforced locally by the browser, not just advertised in peer discovery.

## Feature Preservation Checklist

Do not lose these while refactoring:

- local terminal session create/switch/fork/export in `web/clawser-terminal-sessions.js`
- local visible terminal behavior in `web/clawser-ui-panels.js`
- browser shell builtins, history, aliases, cwd/env, and background jobs in `web/clawser-shell.js`
- reverse peer registration and peer discovery in `web/clawser-wsh-cli.js` and `crates/wsh-cli/src/commands/relay.rs`
- real PTY sessions in `crates/wsh-server/src/session/pty.rs`
- reverse MCP/file/policy/agent routing in `web/clawser-wsh-incoming.js`

## Module Plan

### Reuse As-Is

- `web/clawser-shell.js`
  - Keep `ClawserShell`, `ShellState`, parsing, builtins, and job semantics as the shell engine.
- `crates/wsh-server/src/session/pty.rs`
  - Keep the real host PTY path unchanged.
- `web/shared-worker.js`
  - Leave local multi-tab coordination alone.
- `web/clawser-daemon.js`
  - Leave local daemon messaging alone.

### New Modules To Add

- `web/clawser-shell-factory.js`
  - Export `createConfiguredShell(...)` so local and remote shells share one registration path.
- `web/clawser-shell-factory.d.ts`
  - Type declarations for the shell factory.
- `web/clawser-terminal-session-store.js`
  - Extract shell-state snapshotting, event recording, and replay building from the current terminal session manager.
- `web/clawser-terminal-session-store.d.ts`
  - Type declarations for the shared terminal session store.
- `web/clawser-wsh-virtual-terminal-session.js`
  - One browser-backed virtual terminal channel. Owns line buffer, cursor, prompt rendering, shell instance, running command state, and replay buffer.
- `web/clawser-wsh-virtual-terminal-session.d.ts`
  - Type declarations for the virtual terminal session.
- `web/clawser-wsh-virtual-terminal-manager.js`
  - Registry of active remote peers and their terminal channels.
- `web/clawser-wsh-virtual-terminal-manager.d.ts`
  - Type declarations for the terminal manager.
- `web/packages/wsh/src/virtual-session.mjs`
  - Message-backed `WshSession` backend for browser virtual channels.
- `crates/wsh-client/src/virtual_session.rs`
  - Rust-side virtual session backend with the same surface as stream-backed sessions.
- `crates/wsh-cli/src/commands/interactive.rs`
  - Shared interactive terminal loop used by both `connect` and `reverse-connect`.

### Existing Files To Refactor

- `web/clawser-workspace-lifecycle.js`
  - Stop being the only place that knows how to build a configured shell.
- `web/clawser-terminal-sessions.js`
  - Delegate serialization/replay logic to the new shared store module.
- `web/clawser-wsh-incoming.js`
  - Replace one-shot `handleExec()` on `OPEN` with persistent virtual terminal session routing.
- `web/clawser-kernel-wsh-bridge.js`
  - Keep tenant lifecycle responsibilities, but key tenants by a stable participant ID instead of raw username.
- `web/packages/wsh/spec/wsh-v1.yaml`
  - Add the reverse handshake and virtual-session protocol surface.
- `web/packages/wsh/src/client.mjs`
  - Support `stream` and `virtual` session data modes and expose a clean relay-send helper.
- `web/packages/wsh/src/session.mjs`
  - Become a thin shared session facade or shared base over stream-backed and virtual-backed sessions.
- `web/packages/wsh/src/index.mjs`
  - Export the new virtual-session pieces.
- `web/packages/wsh/src/index.d.ts`
  - Update typings for new message types, `OpenOk` fields, and client/session methods.
- `crates/wsh-server/src/server.rs`
  - Forward the new reverse handshake and virtual terminal messages.
- `crates/wsh-server/src/relay/broker.rs`
  - Support a pending reverse-connect handshake instead of assuming target readiness immediately.
- `crates/wsh-client/src/client.rs`
  - Branch `open_session()` on data mode.
- `crates/wsh-client/src/session.rs`
  - Share the public session API across stream-backed and virtual-backed backends.
- `crates/wsh-client/src/lib.rs`
  - Export the new virtual session support.
- `crates/wsh-cli/src/commands/connect.rs`
  - Extract the generic interactive loop.
- `crates/wsh-cli/src/commands/relay.rs`
  - After `ReverseAccept`, open a PTY-style virtual session and enter interactive mode.

## Protocol Changes

Edit `web/packages/wsh/spec/wsh-v1.yaml` first. Regenerate generated files with:

```bash
node web/packages/wsh/spec/codegen.mjs
```

Required protocol changes:

- Extend `OpenOk` with:
  - `data_mode: "stream" | "virtual"` with default `"stream"`
  - `capabilities: string[]` with default `[]`
- Add `SessionData`:
  - fields: `channel_id`, `data`
  - bidirectional message for virtual terminal bytes
- Add `ReverseAccept`:
  - sent by the target browser after it has created a peer context and is ready to receive `OPEN`
- Add `ReverseReject`:
  - sent by the target browser if it cannot or will not accept the connection
- Add relay forwarding for:
  - `SessionData`
  - `ReverseAccept`
  - `ReverseReject`
  - `EchoAck`
  - `EchoState`
  - `TermSync`
  - `TermDiff`

Generated outputs that should change:

- `web/packages/wsh/src/messages.gen.mjs`
- `crates/wsh-core/src/messages.gen.rs`

## Ordered Implementation Backlog

### Phase 0: Extract Shell Construction

Goal:

- make shell creation reusable without sharing shell state across local and remote terminals

File edits:

- add `web/clawser-shell-factory.js`
- add `web/clawser-shell-factory.d.ts`
- edit `web/clawser-workspace-lifecycle.js`

Tasks:

- move shell construction and command registration out of `createShellSession()`
- export `createConfiguredShell({ workspaceFs, getAgent, getRoutineEngine, getModelManager })`
- make workspace init use the factory for `state.shell`
- ensure remote sessions can create their own shell instances without touching `state.shell`

Done when:

- one factory builds both local and remote shells
- no command registration logic is duplicated

### Phase 1: Extract Shared Terminal Session Storage Logic

Goal:

- keep current local terminal session features while making replay/state code reusable by remote virtual sessions

File edits:

- add `web/clawser-terminal-session-store.js`
- add `web/clawser-terminal-session-store.d.ts`
- edit `web/clawser-terminal-sessions.js`
- edit `web/clawser-ui-panels.js` only if the manager API changes

Tasks:

- extract shell-state serialization/deserialization
- extract event recording helpers for command/result/state snapshots
- keep OPFS persistence in `TerminalSessionManager`
- let remote virtual sessions use the same store API with an in-memory backend first

Done when:

- local terminal session tests still pass unchanged in behavior
- remote sessions can build replay buffers without depending on visible UI terminal state

### Phase 2: Add Reverse Handshake and Virtual Session Protocol

Goal:

- remove race conditions from reverse-connect and make virtual terminal transport explicit

File edits:

- edit `web/packages/wsh/spec/wsh-v1.yaml`
- regenerate `web/packages/wsh/src/messages.gen.mjs`
- regenerate `crates/wsh-core/src/messages.gen.rs`
- edit `crates/wsh-server/src/server.rs`
- edit `crates/wsh-server/src/relay/broker.rs`

Tasks:

- add `ReverseAccept` and `ReverseReject`
- make relay pairing happen only after `ReverseAccept`, or track a pending route until accept
- add `SessionData`
- extend `OpenOk` with `data_mode` and `capabilities`
- add new relay-forwardable message types on both server and JS client routing surfaces

Done when:

- `reverse-connect` has a clear ready/not-ready answer
- virtual terminal bytes no longer rely on `GatewayData`

### Phase 3: Refactor JS `wsh` Client for Dual Session Backends

Goal:

- make browser and JS tooling support stream-backed and virtual-backed sessions cleanly

File edits:

- add `web/packages/wsh/src/virtual-session.mjs`
- edit `web/packages/wsh/src/session.mjs`
- edit `web/packages/wsh/src/client.mjs`
- edit `web/packages/wsh/src/index.mjs`
- edit `web/packages/wsh/src/index.d.ts`

Tasks:

- add a public `sendRelayControl(msg)` helper so browser reverse handlers stop touching `client._transport`
- make `openSession()` branch on `OpenOk.data_mode`
- keep the public session surface stable at the useful layer: `write`, `resize`, `signal`, `close`, `onData`, `onExit`, `onClose`
- route `SessionData` to virtual sessions by `channel_id`
- route `EchoAck`, `EchoState`, `TermSync`, and `TermDiff` through session-specific handlers later in the rollout

Done when:

- JS clients can talk to both real PTY servers and browser virtual peers with the same top-level API

### Phase 4: Refactor Rust `wsh` Client for Dual Session Backends

Goal:

- give the Rust CLI the same session abstraction as the JS client

File edits:

- add `crates/wsh-client/src/virtual_session.rs`
- edit `crates/wsh-client/src/session.rs`
- edit `crates/wsh-client/src/client.rs`
- edit `crates/wsh-client/src/lib.rs`

Tasks:

- add a message-backed virtual session backend
- branch `open_session()` on `OpenOk.data_mode`
- keep `read`, `write`, `resize`, `signal`, and `close` working for both backends
- add control routing for `SessionData`, `EchoAck`, `EchoState`, `TermSync`, and `TermDiff`

Done when:

- the Rust CLI can use one interactive loop against either a real PTY or a browser virtual terminal

### Phase 5: Build Browser Virtual Terminal Runtime

Goal:

- replace one-shot browser exec with a real session-backed virtual terminal

File edits:

- add `web/clawser-wsh-virtual-terminal-session.js`
- add `web/clawser-wsh-virtual-terminal-session.d.ts`
- add `web/clawser-wsh-virtual-terminal-manager.js`
- add `web/clawser-wsh-virtual-terminal-manager.d.ts`
- edit `web/clawser-workspace-lifecycle.js`

Tasks:

- `VirtualTerminalSession` owns:
  - its own `ClawserShell`
  - shell state and history
  - current input buffer and cursor index
  - prompt rendering
  - running command state
  - rows/cols
  - replay ring buffer
- `VirtualTerminalManager` owns:
  - peer contexts keyed by a stable participant key, not just username
  - channel maps per peer
  - lifecycle hooks for open/write/resize/signal/close
- line editing lives in the browser session, not in the CLI
- initial output path is incremental `SessionData` frames

Done when:

- one remote peer can open multiple terminal channels cleanly
- remote commands do not mutate the visible terminal's shell state

### Phase 6: Rewrite Incoming Reverse Session Routing

Goal:

- turn `web/clawser-wsh-incoming.js` into a real reverse session router instead of a one-shot exec shim

File edits:

- edit `web/clawser-wsh-incoming.js`
- edit `web/clawser-wsh-incoming.d.ts`
- edit `web/clawser-kernel-wsh-bridge.js`
- edit `web/clawser-kernel-wsh-bridge.d.ts`

Tasks:

- replace `incomingSessions: Map<string, IncomingSession>` with a peer-context registry keyed by a stable participant key
- on `ReverseConnect`, create peer context, then send `ReverseAccept` or `ReverseReject`
- on `Open`, create a `VirtualTerminalSession` when `kind` is `pty` or `exec`
- on `SessionData`, feed bytes into the correct virtual terminal session
- on `Resize`, `Signal`, and `Close`, route to the correct channel
- keep MCP, file, policy, guest, copilot, and agent chat routing intact
- enforce capabilities:
  - reject `Open(kind=pty|exec)` unless `shell` is exposed
  - reject `McpCall`/`McpDiscover` unless `tools` is exposed
  - reject `FileOp` unless `fs` is exposed
- keep the kernel bridge lifecycle-only; do not make it responsible for terminal rendering or shell execution

Done when:

- `OPEN` no longer calls `handleExec()` directly
- reverse non-terminal message flows still work

### Phase 7: Reuse the CLI Interactive Loop for Reverse Sessions

Goal:

- make `wsh reverse-connect` open an interactive session instead of just waiting on Ctrl+C

File edits:

- add `crates/wsh-cli/src/commands/interactive.rs`
- edit `crates/wsh-cli/src/commands/connect.rs`
- edit `crates/wsh-cli/src/commands/relay.rs`
- edit `crates/wsh-cli/src/main.rs` if module wiring changes

Tasks:

- extract the raw-mode interactive pump from `connect.rs`
- after `ReverseConnect`, wait for `ReverseAccept`
- open a `pty` session against the now-ready reverse peer
- run the same interactive loop used by direct `connect`
- keep `Ctrl+]`, resize propagation, and stdout flushing identical to direct PTY sessions

Done when:

- `wsh reverse-connect <fingerprint> relay.example.com` behaves like the normal interactive connect path for supported shell workloads

### Phase 8: Replay and Reattach

Goal:

- recover cleanly from reconnects without binding remote session state to the visible terminal UI

File edits:

- edit `web/clawser-wsh-virtual-terminal-session.js`
- edit `web/clawser-wsh-virtual-terminal-manager.js`
- edit `web/packages/wsh/spec/wsh-v1.yaml` only if the current session/attach messages prove insufficient
- edit `web/packages/wsh/src/client.mjs`
- edit `crates/wsh-client/src/client.rs`

Tasks:

- keep an in-memory replay buffer and shell-state snapshot per virtual terminal channel
- allow a new reverse connection from the same participant to reattach if the old transport died
- if existing attach/resume semantics do not fit browser-owned sessions cleanly, add browser-specific virtual-session attach messages instead of bending server-owned session semantics beyond recognition

Done when:

- reconnecting does not destroy the browser terminal state by default

### Phase 9: Predictive Echo and Terminal Sync

Goal:

- improve latency and recovery quality after the basic interactive path is stable

File edits:

- edit `web/clawser-wsh-virtual-terminal-session.js`
- edit `web/packages/wsh/src/virtual-session.mjs`
- edit `crates/wsh-client/src/virtual_session.rs`
- edit `crates/wsh-server/src/server.rs`

Tasks:

- use `EchoAck` and `EchoState` for speculative local echo
- add `TermSync` and `TermDiff` for repair and low-bandwidth reattach
- keep plain `SessionData` as the baseline transport even after term sync lands

Done when:

- typing latency and resize redraws feel stable on lossy connections

### Phase 10: Tests and Verification

Goal:

- lock behavior down before polishing

File edits:

- add `web/test/clawser-wsh-virtual-terminal.test.mjs`
- add `web/test/clawser-wsh-incoming-virtual-terminal.test.mjs`
- edit `web/test/clawser-kernel-wsh-bridge.test.mjs`
- edit `web/test/clawser-wsh-phase5-integration.test.mjs`
- edit `crates/wsh-client/src/client.rs` test module
- add tests in `crates/wsh-client/src/virtual_session.rs`
- add tests in `crates/wsh-cli/src/commands/relay.rs` or a neighboring test module

Required test cases:

- reverse connect accept/reject handshake
- browser capability enforcement for `shell`, `tools`, and `fs`
- JS client `openSession()` with `data_mode=virtual`
- Rust client `open_session()` with `data_mode=virtual`
- browser virtual terminal line editing, prompt redraw, Ctrl-C, Ctrl-D, and resize
- multiple concurrent channels from one remote peer
- multiple peer contexts without username collision
- reverse non-terminal flows still working: MCP, file op, policy, agent chat
- CLI interactive reverse-connect round trip
- local terminal session features unchanged

Suggested verification commands:

```bash
node web/packages/wsh/spec/codegen.mjs
node web/test/run-tests.mjs --group changed
cargo test -p wsh-client
cargo test -p wsh-cli
```

## Recommended Implementation Sequence

Use this order exactly:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7
9. Phase 10 baseline tests
10. Phase 8
11. Phase 9
12. Phase 10 full regression pass

This order keeps the protocol and client abstractions settled before the browser runtime and CLI interactive work land.

## Explicit Things Not To Do

- Do not share `state.shell` between the visible terminal and reverse virtual terminals.
- Do not keep `IncomingSession.handleExec()` as the interactive shell implementation.
- Do not make `GatewayData` the permanent virtual terminal transport.
- Do not key reverse peer contexts by username alone.
- Do not move shell logic into the kernel bridge.
- Do not make local terminal UI state the storage layer for remote sessions.

## First PR Cut

The smallest reviewable first PR should contain only:

- Phase 0
- Phase 1
- the Phase 2 spec changes
- generated message updates

That gives the rest of the work a stable shell-construction path and a stable protocol surface before the runtime work starts.
