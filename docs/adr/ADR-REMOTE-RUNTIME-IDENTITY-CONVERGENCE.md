# ADR: Remote Runtime Identity Convergence

## Status
Accepted

## Decision

- `RemoteIdentity` is the canonical identity record for remote runtimes.
- Mesh `podId` and `wsh` fingerprint are linked identities, not competing ones.
- The runtime registry may store both on one descriptor with aliases.

## Consequences

- Name resolution, peer listings, and route selection can use one selector space.
- Reverse peers discovered through `wsh` can later merge cleanly with BrowserMesh discovery.
