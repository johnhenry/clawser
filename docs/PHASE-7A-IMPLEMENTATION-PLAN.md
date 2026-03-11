# Phase 8 Remote Runtime Program (Formerly Phase 7A)

## Summary

Implement the remaining **Phase 8** roadmap only. **Phase 10 packageization is explicitly out of scope.**
When execution starts, first write this plan verbatim to `docs/PHASE-7A-IMPLEMENTATION-PLAN.md`, then implement it in order.

Chosen defaults:
- Primary reverse-host end state: **`wsh-agent` first**
- BrowserMesh owns **identity, discovery, trust, ACL, and route hints**
- `wsh` owns **authentication, session semantics, channel transport, and remote-runtime control**
- VM work starts with **browser-hosted VM console peer (Model A)**, not guest-side `wsh-server`
- No new primary direct peer-to-peer `wsh` transport in this program

This program is complete only when:
- reverse host parity is real
- BrowserMesh and `wsh` use one canonical peer/runtime model
- UI, CLI, automation, gateway, compute, and service flows all consume that same model
- the verification matrix in the roadmap passes end to end

## Status Snapshot

As of **March 11, 2026**, implementation is in progress with the following phase status:

- `[x]` Phase 0. Contract Freeze And Harness
- `[x]` Phase 1. Protocol And Descriptor Foundation
- `[x]` Phase 2. Remote Runtime Registry And Session Broker
- `[x]` Phase 3. Reverse Host Parity With `wsh-agent`
- `[x]` Phase 4. Attach, Replay, And Route Robustness
- `[x]` Phase 5. BrowserMesh Policy, Naming, And Trust Convergence
- `[x]` Phase 6. UI And CLI Convergence
- `[x]` Phase 7. Gateway, Compute, Service, Deployment, And Automation Convergence
- `[x]` Phase 8. Remote Filesystem And Audit Unification
- `[x]` Phase 9. VM Peer MVP
- `[x]` Phase 10. Final Verification And Readiness Gate

Current interpretation:

- `[x]` means the phase exit gate is substantially met for the current Phase 8 scope.
- `[~]` means major implementation is present, but at least one exit-gate item is still incomplete.
- `[ ]` means the phase has not yet reached implementation-ready completion.

## Interface Changes

Public and semi-public additions to implement:

- New canonical runtime types:
  - `RemoteIdentity`
  - `RemotePeerDescriptor`
  - `ReachabilityDescriptor`
  - `SessionTarget`
- `wsh` peer metadata expansion:
  - `peer_type`
  - `shell_backend`
  - refined capabilities
  - attach/replay/term-sync hints
- New CLI/runtime surfaces:
  - `wsh peers --json`
  - clearer session banners and backend labels
  - relay-backed name-based targeting for `wsh reverse-connect`
  - `only` / `last` reverse-peer convenience selectors
  - `wsh check relay ...` self-check diagnostics
  - `wsh-agent` daemon mode for reverse host presence
  - browser-side reverse exposure presets and per-session approval policy
  - `wsh vm ...` lifecycle/budget/snapshot controls for browser VM peers
- New internal integration surfaces:
  - remote runtime registry
  - session broker
  - mesh↔`wsh` policy adapter
  - reachability computation layer
  - peer sync bridge between mesh and `wsh` relay state

## Implementation Phases

### 0. Contract Freeze And Harness
Exit gate: all core contracts are explicit and test harnesses exist before feature expansion.

Status: `[x] Complete`

- [x] Define one canonical schema for:
  - `RemoteIdentity`
  - `RemotePeerDescriptor`
  - `ReachabilityDescriptor`
  - `SessionTarget`
- [x] Freeze peer vocabularies:
  - `peer_type`: `host`, `browser-shell`, `vm-guest`, `worker`
  - `shell_backend`: `pty`, `virtual-shell`, `vm-console`, `exec-only`
- [x] Freeze policy precedence:
  - discovery visibility
  - relay/path permission
  - session admission
  - in-session capability scope
- [x] Freeze route-selection algorithm and document it as normative.
- [x] Build a deterministic multi-peer test harness covering:
  - direct host
  - reverse browser peer
  - reverse host peer
  - future VM peer stub
  - stale discovery
  - conflicting metadata
  - relay loss
  - capability mismatch
- [x] Add ADR-style docs for:
  - layer ownership
  - relay separation
  - identity convergence
  - policy precedence
  - route selection

### 1. Protocol And Descriptor Foundation
Exit gate: both JS and Rust can represent the same peer/runtime metadata and expose it in machine-readable form.

Status: `[x] Complete`

- [x] Extend the `wsh` schema and generated bindings with:
  - peer type/backend metadata
  - capability refinements
  - attach/echo/sync support hints
- [x] Add shared descriptor conversion on both sides:
  - raw `wsh` peer listing -> `RemotePeerDescriptor`
  - mesh identity -> `RemoteIdentity`
- [x] Update `wsh peers` output:
  - human table
  - JSON output
  - backend labels
- [x] Add CLI-visible distinction between:
  - real PTY host sessions
  - browser virtual terminals
  - future VM consoles
- [x] Ensure peer listings preserve source provenance and do not silently flatten conflicting facts.

### 2. Remote Runtime Registry And Session Broker
Exit gate: one canonical runtime registry exists, and all session opens route through a single broker.

Status: `[x] Complete`

- [x] Implement the remote runtime registry in the browser runtime:
  - ingest mesh discovery
  - ingest mesh peer state
  - ingest mesh relay presence
  - ingest `wsh` reverse peers
  - ingest direct host bookmarks
- [x] Implement deterministic merge rules:
  - canonical identity match
  - linked identity match
  - conflict preservation
  - stale/fresh liveness handling
- [x] Implement reachability resolution:
  - direct host endpoint
  - reverse relay path
  - future mesh-stream path placeholder
- [x] Implement a session broker:
  - resolve `SessionTarget`
  - choose best backend for session intent
  - open the `wsh` session through one code path
- [x] Integrate the broker into `ClawserPod`-level service wiring so the runtime registry becomes the single dependency for remote access surfaces.

### 3. Reverse Host Parity With `wsh-agent`
Exit gate: a local machine can expose a real PTY through a relay as a first-class peer.

Status: `[x] Complete`

- [x] Implement `wsh-agent` as the primary reverse-host runtime:
  - background registration
  - reconnect
  - policy-configured exposure
  - session status inspection
- [x] Support foreground `wsh reverse` as a thin operational mode, not the architectural center.
- [x] Add reverse host incoming session handling:
  - PTY backend
  - exec backend
  - control/data bridge
  - close/exit semantics
- [x] Add reverse host capability policy:
  - shell
  - exec
  - file
  - tools/MCP
  - gateway
- [x] Add host lifecycle semantics:
  - [x] startup-on-login/boot support where practical
  - [x] reconnect behavior
  - [x] active-session tracking
- [x] Ensure reverse-host interactive quality matches direct `wsh connect` closely enough to be the same product surface.

### 4. Attach, Replay, And Route Robustness
Exit gate: reconnects and reattach behavior are consistent across backends.

Status: `[x] Complete`

- [x] Standardize attach/replay semantics across:
  - direct host PTY
  - reverse host PTY
  - browser virtual terminal
  - VM peer stub
- [x] Standardize replay metadata and backend support hints.
- [x] Preserve session labels and identity across reconnect.
- [x] Ensure route failures are explainable:
  - stale discovery
  - relay denial
  - capability mismatch
  - auth failure
  - transport loss
- [x] Feed route outcomes back into runtime health and trust evidence without changing auth truth.

### 5. BrowserMesh Policy, Naming, And Trust Convergence
Exit gate: discovery, naming, ACL, and route ranking all inform remote access without replacing `wsh` semantics.

Status: `[x] Complete`

- [x] Map mesh ACL templates to `wsh` exposure presets.
- [x] Implement a canonical policy translation table and precedence order.
- [x] Surface which layer denied a request in UX and telemetry.
- [x] Integrate mesh naming into runtime resolution:
  - named peer lookup
  - qualified relay names
  - explicit disambiguation on conflicts
- [x] Integrate trust and relay health into route ranking:
  - trust affects ranking/filtering
  - never bypasses endpoint auth or session capability checks
- [x] Keep BrowserMesh relay and `wsh` relay logically separate while allowing shared operator deployment later.

### 6. UI And CLI Convergence
Exit gate: users see one remote-runtime product, not multiple overlapping systems.

Status: `[x] Complete`

- [x] Make the remote UI consume `RemotePeerDescriptor` records only.
- [x] Route terminal, file, and service openings through the session broker.
- [x] Replace duplicated peer cards/rows with one canonical display model.
- [x] Add one canonical peer picker and route explanation surface.
- [x] Update CLI UX:
  - `wsh peers --json`
  - richer peer table
  - backend-aware banners
  - filter-by-capability/filter-by-type selectors
  - `only`/`last` convenience selectors
- [x] Update docs:
  - topology diagram
  - support matrix
  - PTY vs virtual terminal vs VM console
  - relay bootstrap/self-check guidance

### 7. Gateway, Compute, Service, Deployment, And Automation Convergence
Exit gate: existing advanced subsystems target the canonical runtime model instead of private peer logic.

Status: `[x] Complete`

- [x] Netway/gateway:
  - expose gateway-capable peers in the runtime registry
  - policy-scope gateway separately from shell/tools
  - record gateway use in audit/telemetry
- [x] Federated compute:
  - schedule against runtime descriptors, not ad hoc peer lists
  - select peers by actual execution capability/backend
- [x] Virtual Server/service hosting:
  - let runtimes advertise hosted services
  - bind service browsing/routing to the same peer/runtime model
- [x] Apps/skills deployment:
  - define current deployable peer/runtime classes
  - expose deployment capability as peer metadata
  - route deployment actions through the runtime registry
- [x] Routines/daemon automation:
  - target canonical runtime descriptors
  - use the same session broker as interactive flows
  - apply the same policy/audit rules

### 8. Remote Filesystem And Audit Unification
Exit gate: remote runtimes have coherent file semantics and a unified audit story.

Status: `[x] Complete`

- [x] Define remote filesystem access modes:
  - transfer
  - live browse
  - mount
- [x] Integrate remote mounts with the shell/filesystem model.
- [x] Ensure disconnected peers fail cleanly without corrupting mount state.
- [x] Unify audit and observability across:
  - discovery
  - route selection
  - auth
  - session lifecycle
  - file transfer
  - tool invocation
  - gateway use
  - automation
- [x] Expose cross-stack telemetry:
  - peer health
  - relay usage
  - route quality
  - denial causes
  - attach/replay reliability

### 9. VM Peer MVP
Exit gate: one browser-hosted Linux VM can be discovered and reached as a real peer target.

Status: `[x] Complete`

- [x] Implement a VM console backend under the browser reverse-peer architecture.
- [x] Add runtime selection between browser shell and VM console.
- [x] Wire:
  - `SessionData`
  - `Resize`
  - `Ctrl+C`
  - `Ctrl+D`
  - attach/replay where practical
- [x] Expose VM-specific metadata and capabilities conservatively.
- [x] Expose guest execution as a first-class runtime class (`guest-exec`) for compute-aware scheduling.
- [x] Make the UX explicit that this is a VM console, not a host PTY.
- [x] Support one emulator/runtime cleanly.
- [x] Do not implement guest-side `wsh-server` in this program.

### 10. Final Verification And Readiness Gate
Exit gate: all roadmap deliverables before BrowserMesh dependency are satisfied.

Status: `[x] Complete`

- [x] Run the full verification matrix for:
  - identity merge
  - discovery merge
  - policy precedence
  - route selection
  - session behavior
  - attach/replay
  - relay loss
  - naming resolution
  - gateway/compute/service/automation targeting
  - VM peer behavior
- [x] Confirm all product surfaces consume the same canonical runtime model:
  - UI
  - CLI
  - routines
  - daemon
  - gateway
  - compute
  - services
  - deployment
- [x] Close only when the “Deliverables Before BrowserMesh Should Depend On This” checklist is fully satisfied.

Verification evidence recorded on **March 11, 2026**:

- Rust verification:
  - `cargo test -p wsh-cli -p wsh-client -p wsh-server -p wsh-core`
- Browser/runtime verification:
  - `node --import ./web/test/_setup-globals.mjs --test web/test/clawser-remote-runtime-registry.test.mjs web/test/clawser-remote-runtime-policy.test.mjs web/test/clawser-remote-runtime-wsh.test.mjs web/test/clawser-ui-remote-runtime.test.mjs web/test/clawser-mesh-orchestrator.test.mjs web/test/clawser-netway-tools.test.mjs web/test/clawser-remote-mounts.test.mjs web/test/clawser-vm-console.test.mjs web/test/clawser-wsh-incoming.test.mjs web/test/clawser-wsh-reverse-handshake.test.mjs web/test/clawser-wsh-virtual-terminal-runtime.test.mjs web/test/clawser-wsh-virtual-session.test.mjs web/test/clawser-pod.test.mjs web/test/clawser-mesh-bootstrap.test.mjs web/test/clawser-routine-runtime.test.mjs`
- Hygiene:
  - `git diff --check`

Verification matrix coverage:

- identity/discovery merge: `clawser-remote-runtime-registry.test.mjs`, `clawser-mesh-bootstrap.test.mjs`
- policy precedence / naming / route selection: `clawser-remote-runtime-policy.test.mjs`, `clawser-remote-runtime-registry.test.mjs`
- session behavior / attach / replay / relay loss: `clawser-wsh-incoming.test.mjs`, `clawser-wsh-virtual-terminal-runtime.test.mjs`, `clawser-wsh-virtual-session.test.mjs`, `reverse_host` Rust tests
- gateway / compute / services / automation targeting: `clawser-mesh-orchestrator.test.mjs`, `clawser-netway-tools.test.mjs`, `clawser-remote-runtime-wsh.test.mjs`
- canonical query / telemetry views: `clawser-remote-runtime-registry.test.mjs`, `clawser-ui-remote-runtime.test.mjs`
- VM peer behavior: `clawser-vm-console.test.mjs`, `clawser-wsh-reverse-handshake.test.mjs`

## Test Plan

### Core unit/integration coverage
- Descriptor merge tests:
  - identical identity from mesh and `wsh`
  - linked identity merge
  - conflicting metadata preserved
  - stale source does not overwrite fresh data
- Policy tests:
  - mesh ACL deny
  - relay policy deny
  - `wsh` auth deny
  - capability mismatch
  - precedence reporting
- Routing tests:
  - direct host preferred when valid
  - reverse host chosen when direct unavailable
  - browser peer not chosen for unsupported workloads
  - VM peer selected only when backend fits

### End-to-end scenarios
- Direct host PTY session
- Reverse browser shell session
- Reverse host PTY session via `wsh-agent`
- Reverse file and tool workflows against browser and host peers
- Naming-based connect flow
- Gateway-capable peer flow
- Routine/daemon-triggered remote action
- VM console peer discovery and session open

### Failure-mode scenarios
- Stale discovery record
- Conflicting relay state
- Identity-link mismatch
- Browser relay cert/trust failure
- Reverse peer disconnect mid-session
- Reattach after relay loss
- Capability revocation during target selection
- Mount target disappears while mounted

## Assumptions

- Scope excludes all Phase 9 BrowserMesh package-surface work.
- `wsh-agent` is the primary reverse-host architecture; foreground CLI reverse mode is a compatibility/operational mode.
- BrowserMesh remains optional for basic `wsh` deployments.
- No new primary direct peer-to-peer `wsh` transport is introduced in this program.
- VM implementation is limited to the browser-hosted VM-console model in this program.
- The existing remote UI, older peer UI flows, and duplicate peer/session views are migration targets and should not survive as parallel architectures.
