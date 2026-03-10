# Remote Runtime Contracts

This document freezes the canonical Phase 7A remote-runtime model shared by BrowserMesh and `wsh`.

## Layer Ownership

- BrowserMesh owns identity, discovery, naming, trust, ACL, and route hints.
- `wsh` owns endpoint authentication, session semantics, transport channels, and remote-runtime control.
- The browser runtime registry is the single merge point for remote peers discovered through either side.

## Canonical Types

### `RemoteIdentity`

- `canonicalId`: stable primary identifier used inside the runtime registry
- `fingerprint`: `wsh`/relay fingerprint when available
- `podId`: BrowserMesh identity when available
- `aliases`: human or compatibility selectors that may resolve to the same identity

Rules:
- prefer `podId` as `canonicalId` when known
- otherwise derive `canonicalId` from the full fingerprint
- short fingerprints are aliases, never primary identifiers

### `RemotePeerDescriptor`

- `identity`
- `username`
- `peerType`: `host`, `browser-shell`, `vm-guest`, `worker`
- `shellBackend`: `pty`, `virtual-shell`, `vm-console`, `exec-only`
- `capabilities`
- `supportsAttach`
- `supportsReplay`
- `supportsEcho`
- `supportsTermSync`
- `reachability`
- `sources`
- `conflicts`

Rules:
- merge capabilities by union
- preserve metadata conflicts explicitly; never silently flatten incompatible facts
- route metadata is append-only except when a newer observation replaces the same route key

### `ReachabilityDescriptor`

- `kind`: `direct-host`, `reverse-relay`, `mesh-direct`, `mesh-relay`, `mesh-discovery`
- `source`
- `endpoint`
- `relayHost`
- `relayPort`
- `transport`
- `lastSeen`
- `capabilities`

Rules:
- route identity is the tuple `(kind, source, endpoint, relayHost, relayPort, transport)`
- fresher observations replace older observations of the same route

### `SessionTarget`

- `selector`
- `intent`: `terminal`, `exec`, `files`, `tools`, `gateway`, `service`, `automation`
- `requiredCapabilities`
- `preferDirect`

Rules:
- selectors may be canonical IDs, aliases, names, or fingerprint prefixes
- intent validation runs before route selection

## Policy Precedence

1. Discovery visibility
2. Relay/path permission
3. Session admission
4. In-session capability scope

Rules:
- earlier layers can filter candidates before later layers run
- later layers cannot widen an earlier denial
- BrowserMesh trust can rank or filter, but cannot replace endpoint auth

## Route Selection

Default ranking order:

1. `direct-host` + `host/pty`
2. `reverse-relay` + `host/pty`
3. `mesh-direct`
4. `reverse-relay` + `browser-shell/virtual-shell`
5. `reverse-relay` + `vm-guest/vm-console`
6. `mesh-relay`

Intent modifiers:

- `terminal` prefers `pty`, then `virtual-shell`, then `vm-console`
- `files` requires `fs`
- `tools` requires `tools`
- `gateway` requires `gateway`

## Conflict Preservation

The registry must preserve, not erase, these mismatches:

- different `peerType` for the same identity
- different `shellBackend` for the same identity
- incompatible usernames or display names
- stale source disagreeing with fresher source data

Conflicts remain attached to the descriptor until explicitly reconciled.
