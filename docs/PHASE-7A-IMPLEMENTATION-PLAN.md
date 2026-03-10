# Phase 7A Remote Runtime Program

## Summary

Implement the remaining **Phase 7A** roadmap only. **Phase 9 packageization is explicitly out of scope.**  
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
  - name-based targeting after naming integration
  - `wsh-agent` daemon mode for reverse host presence
- New internal integration surfaces:
  - remote runtime registry
  - session broker
  - mesh↔`wsh` policy adapter
  - reachability computation layer
  - peer sync bridge between mesh and `wsh` relay state

## Implementation Phases

### 0. Contract Freeze And Harness
Exit gate: all core contracts are explicit and test harnesses exist before feature expansion.

- Define one canonical schema for:
  - `RemoteIdentity`
  - `RemotePeerDescriptor`
  - `ReachabilityDescriptor`
  - `SessionTarget`
- Freeze peer vocabularies:
  - `peer_type`: `host`, `browser-shell`, `vm-guest`, `worker`
  - `shell_backend`: `pty`, `virtual-shell`, `vm-console`, `exec-only`
- Freeze policy precedence:
  - discovery visibility
  - relay/path permission
  - session admission
  - in-session capability scope
- Freeze route-selection algorithm and document it as normative.
- Build a deterministic multi-peer test harness covering:
  - direct host
  - reverse browser peer
  - reverse host peer
  - future VM peer stub
  - stale discovery
  - conflicting metadata
  - relay loss
  - capability mismatch
- Add ADR-style docs for:
  - layer ownership
  - relay separation
  - identity convergence
  - policy precedence
  - route selection

### 1. Protocol And Descriptor Foundation
Exit gate: both JS and Rust can represent the same peer/runtime metadata and expose it in machine-readable form.

- Extend the `wsh` schema and generated bindings with:
  - peer type/backend metadata
  - capability refinements
  - attach/echo/sync support hints
- Add shared descriptor conversion on both sides:
  - raw `wsh` peer listing -> `RemotePeerDescriptor`
  - mesh identity -> `RemoteIdentity`
- Update `wsh peers` output:
  - human table
  - JSON output
  - backend labels
- Add CLI-visible distinction between:
  - real PTY host sessions
  - browser virtual terminals
  - future VM consoles
- Ensure peer listings preserve source provenance and do not silently flatten conflicting facts.

### 2. Remote Runtime Registry And Session Broker
Exit gate: one canonical runtime registry exists, and all session opens route through a single broker.

- Implement the remote runtime registry in the browser runtime:
  - ingest mesh discovery
  - ingest mesh peer state
  - ingest mesh relay presence
  - ingest `wsh` reverse peers
  - ingest direct host bookmarks
- Implement deterministic merge rules:
  - canonical identity match
  - linked identity match
  - conflict preservation
  - stale/fresh liveness handling
- Implement reachability resolution:
  - direct host endpoint
  - reverse relay path
  - future mesh-stream path placeholder
- Implement a session broker:
  - resolve `SessionTarget`
  - choose best backend for session intent
  - open the `wsh` session through one code path
- Integrate the broker into `ClawserPod`-level service wiring so the runtime registry becomes the single dependency for remote access surfaces.

### 3. Reverse Host Parity With `wsh-agent`
Exit gate: a local machine can expose a real PTY through a relay as a first-class peer.

- Implement `wsh-agent` as the primary reverse-host runtime:
  - background registration
  - reconnect
  - policy-configured exposure
  - session status inspection
- Support foreground `wsh reverse` as a thin operational mode, not the architectural center.
- Add reverse host incoming session handling:
  - PTY backend
  - exec backend
  - control/data bridge
  - close/exit semantics
- Add reverse host capability policy:
  - shell
  - exec
  - file
  - tools/MCP
  - gateway
- Add host lifecycle semantics:
  - startup-on-login/boot support where practical
  - reconnect behavior
  - active-session tracking
- Ensure reverse-host interactive quality matches direct `wsh connect` closely enough to be the same product surface.

### 4. Attach, Replay, And Route Robustness
Exit gate: reconnects and reattach behavior are consistent across backends.

- Standardize attach/replay semantics across:
  - direct host PTY
  - reverse host PTY
  - browser virtual terminal
  - VM peer stub
- Standardize replay metadata and backend support hints.
- Preserve session labels and identity across reconnect.
- Ensure route failures are explainable:
  - stale discovery
  - relay denial
  - capability mismatch
  - auth failure
  - transport loss
- Feed route outcomes back into runtime health and trust evidence without changing auth truth.

### 5. BrowserMesh Policy, Naming, And Trust Convergence
Exit gate: discovery, naming, ACL, and route ranking all inform remote access without replacing `wsh` semantics.

- Map mesh ACL templates to `wsh` exposure presets.
- Implement a canonical policy translation table and precedence order.
- Surface which layer denied a request in UX and telemetry.
- Integrate mesh naming into runtime resolution:
  - named peer lookup
  - qualified relay names
  - explicit disambiguation on conflicts
- Integrate trust and relay health into route ranking:
  - trust affects ranking/filtering
  - never bypasses endpoint auth or session capability checks
- Keep BrowserMesh relay and `wsh` relay logically separate while allowing shared operator deployment later.

### 6. UI And CLI Convergence
Exit gate: users see one remote-runtime product, not multiple overlapping systems.

- Make the remote UI consume `RemotePeerDescriptor` records only.
- Route terminal, file, and service openings through the session broker.
- Replace duplicated peer cards/rows with one canonical display model.
- Add one canonical peer picker and route explanation surface.
- Update CLI UX:
  - `wsh peers --json`
  - richer peer table
  - backend-aware banners
  - selectors for only/last/filter-by-capability/filter-by-type
- Update docs:
  - topology diagram
  - support matrix
  - PTY vs virtual terminal vs VM console
  - relay bootstrap/self-check guidance

### 7. Gateway, Compute, Service, Deployment, And Automation Convergence
Exit gate: existing advanced subsystems target the canonical runtime model instead of private peer logic.

- Netway/gateway:
  - expose gateway-capable peers in the runtime registry
  - policy-scope gateway separately from shell/tools
  - record gateway use in audit/telemetry
- Federated compute:
  - schedule against runtime descriptors, not ad hoc peer lists
  - select peers by actual execution capability/backend
- Virtual Server/service hosting:
  - let runtimes advertise hosted services
  - bind service browsing/routing to the same peer/runtime model
- Apps/skills deployment:
  - define deployable peer classes
  - expose deployment capability as peer metadata
  - route deployment actions through the runtime registry
- Routines/daemon automation:
  - target canonical runtime descriptors
  - use the same session broker as interactive flows
  - apply the same policy/audit rules

### 8. Remote Filesystem And Audit Unification
Exit gate: remote runtimes have coherent file semantics and a unified audit story.

- Define remote filesystem access modes:
  - transfer
  - live browse
  - mount
- Integrate remote mounts with the shell/filesystem model.
- Ensure disconnected peers fail cleanly without corrupting mount state.
- Unify audit and observability across:
  - discovery
  - route selection
  - auth
  - session lifecycle
  - file transfer
  - tool invocation
  - gateway use
  - automation
- Expose cross-stack telemetry:
  - peer health
  - relay usage
  - route quality
  - denial causes
  - attach/replay reliability

### 9. VM Peer MVP
Exit gate: one browser-hosted Linux VM can be discovered and reached as a real peer target.

- Implement a VM console backend under the browser reverse-peer architecture.
- Add runtime selection between browser shell and VM console.
- Wire:
  - `SessionData`
  - `Resize`
  - `Ctrl+C`
  - `Ctrl+D`
  - attach/replay where practical
- Expose VM-specific metadata and capabilities conservatively.
- Make the UX explicit that this is a VM console, not a host PTY.
- Support one emulator/runtime cleanly.
- Do not implement guest-side `wsh-server` in this program.

### 10. Final Verification And Readiness Gate
Exit gate: all roadmap deliverables before BrowserMesh dependency are satisfied.

- Run the full verification matrix for:
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
- Confirm all product surfaces consume the same canonical runtime model:
  - UI
  - CLI
  - routines
  - daemon
  - gateway
  - compute
  - services
  - deployment
- Close only when the “Deliverables Before BrowserMesh Should Depend On This” checklist is fully satisfied.

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
