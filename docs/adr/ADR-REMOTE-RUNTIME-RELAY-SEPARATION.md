# ADR: Remote Runtime Relay Separation

## Status
Accepted

## Decision

- BrowserMesh relay and `wsh` relay remain logically separate in Phase 7A.
- Shared deployment is allowed later, but shared process does not imply shared protocol semantics.

## Consequences

- BrowserMesh relay remains optimized for discovery/signaling concerns.
- `wsh` relay remains optimized for authenticated remote-runtime access.
- Route selection can consider both, but policy and transport semantics stay explicit.
