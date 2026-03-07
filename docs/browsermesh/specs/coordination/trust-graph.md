# Trust Graph

Scope-aware trust management with transitive computation and reputation scoring.

**Source**: `web/clawser-mesh-trust.js`
**Related specs**: [identity-keyring.md](../crypto/identity-keyring.md) | [peer-reputation.md](peer-reputation.md)

## 1. Overview

The TrustGraph stores directed trust edges between pod identities. Each edge
carries a float value in [0.0, 1.0], scope tags, an optional expiration, and a
trust category. The graph supports direct lookups, transitive trust with
multiplicative decay, scope-filtered peer queries, reputation aggregation,
time-based decay, and batch pruning. Trust primitives are imported from
`web/packages/mesh-primitives/src/trust.mjs` and re-exported.

## 2. Wire Codes

Trust attestation uses the core wire code `TRUST_ATTEST 0xA4` from
`web/packages/mesh-primitives/src/constants.mjs`. No additional wire codes.

## 3. Trust Categories

From mesh-primitives `TRUST_CATEGORIES`: `DIRECT`, `TRANSITIVE`, `VOUCHED`.

## 4. API Surface

### 4.1 TrustGraph

```
constructor(opts?)              // opts.storage: optional persistence adapter

// Edge management
addEdge(fromId, toId, level, scopes?, opts?) -> TrustEdge
removeEdge(fromId, toId) -> boolean
getEdge(fromId, toId) -> TrustEdge|null
getEdgeScopes(fromId, toId) -> string[]

// Trust computation
getTrustLevel(fromId, toId) -> number                        // direct then transitive
getTransitiveTrust(fromId, toId, maxDepth?) -> { level, direct }

// Peer queries
getTrustedPeers(fromId, minLevel?, scope?) -> string[]
isTrusted(fromId, toId, scope?, minLevel?) -> boolean

// Reputation
getReputation(toId) -> { trustCount, avgLevel, scopes }

// Decay
recordInteraction(fromId, toId, timestamp?) -> void
getLastInteraction(fromId, toId) -> number|null
getDecayedTrustLevel(fromId, toId, opts?) -> number          // opts: { decayRate?, now? }
applyDecay(maxAgeDays?) -> number                            // prune below 0.01

// Maintenance
pruneExpired(now?) -> number
get size -> number
toJSON() / static fromJSON(data)
```

`addEdge` replaces any existing edge between the same pair. Level must be in
[0.0, 1.0] or `RangeError` is thrown. Options: `category` (default `DIRECT`),
`timestamp`, `expires`.

## 5. Transitive Trust

Computed via `computeTransitiveTrust(edges, fromId, toId, maxDepth)`. BFS over
the edge set, multiplying values along each path. Maximum across all paths up
to `maxDepth` (default 3) is returned. Example: A --(0.8)--> B --(0.5)--> C
yields 0.4 from A to C.

## 6. Scope Filtering

Scopes are string tags (e.g., `['code', 'data']`). When filtering,
edges with non-empty scope lists that omit the requested scope are excluded.
Edges with empty scope lists are treated as universal.

## 7. Time-Based Decay

`getDecayedTrustLevel` applies: `level * decayRate^daysSinceLastInteraction`.
Default `decayRate` is 0.99. `applyDecay` batch-prunes edges decayed below
0.01 and optionally removes edges older than `maxAgeDays`.

## 8. Implementation Status

| Aspect                | Status                                       |
|-----------------------|----------------------------------------------|
| All classes           | Fully implemented                            |
| Transitive computation| Fully implemented (multiplicative decay)     |
| Scope filtering       | Fully implemented                            |
| Time-based decay      | Fully implemented                            |
| Serialization         | toJSON/fromJSON complete                     |
| Unit tests            | Yes (`web/test/clawser-mesh-trust.test.mjs`) |
| App bootstrap wired   | Yes                                          |
