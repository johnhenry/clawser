# ADR: Remote Runtime Layer Ownership

## Status
Accepted

## Decision

- BrowserMesh owns discovery, naming, trust, ACL, and route hints.
- `wsh` owns authentication, session semantics, transport, and runtime control.
- The browser runtime registry is the shared state boundary between them.

## Consequences

- BrowserMesh does not become a second remote-shell protocol.
- `wsh` does not become a second peer-discovery stack.
- All higher-level consumers must depend on the runtime registry/broker instead of bespoke peer logic.
