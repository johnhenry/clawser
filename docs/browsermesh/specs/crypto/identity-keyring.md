# Identity Keyring

Key hierarchy and identity linking for BrowserMesh pods.

**Source**: `web/clawser-mesh-keyring.js`
**Related specs**: [identity-keys.md](identity-keys.md) | [identity-persistence.md](identity-persistence.md) | [trust-graph.md](../coordination/trust-graph.md)

## 1. Overview

The identity keyring manages directed parent-child relationships between mesh
identities. Each link carries a relation type, optional scope restrictions, and
optional expiration. The module provides unsigned links (`KeyLink`),
cryptographically signed links (`SignedKeyLink`), succession policies for
dead-man's-switch authority transfer, and a `MeshKeyring` graph that ties them
together.

## 2. Wire Codes

This module does not define its own wire codes. Links are exchanged via
higher-level protocols (`IDENTITY_ANNOUNCE 0xA5`, `CAP_GRANT 0xA2` in
`web/packages/mesh-primitives/src/constants.mjs`).

## 3. Constants

**VALID_RELATIONS**: `device`, `delegate`, `org`, `alias`, `recovery`.

## 4. API Surface

### 4.1 KeyLink

Directed link from parent to child. Fields: `parent`, `child`, `relation`,
`scope` (string[]|null), `expires` (number|null), `created` (number).

```
constructor({ parent, child, relation, scope?, expires?, created? })
isExpired(now?) -> boolean
toJSON() / static fromJSON(data)
```

### 4.2 SignedKeyLink (extends KeyLink)

Ed25519 dual signatures. Signed payload: UTF-8 of `parent|child|relation|created`.

```
get signedPayload -> Uint8Array
static async create(parentIdentity, childIdentity, relation, opts?) -> SignedKeyLink
async verifyParent(publicKey) / verifyChild(publicKey) / verifyBoth(parentPub, childPub) -> boolean
toJSON() / static fromJSON(data)      // signatures as base64url
```

### 4.3 SuccessionPolicy

Dead-man's-switch: if `primaryId` inactive longer than `inactivityThresholdMs`,
the action (`transfer` | `revoke` | `notify`) fires.

```
constructor({ primaryId, successorId, inactivityThresholdMs, action?, createdAt? })
isArmed(now?, lastActive) -> boolean
toJSON() / static fromJSON(data)
```

### 4.4 MeshKeyring

Graph of KeyLink relationships with chain traversal and succession management.

```
constructor(opts?)                       // opts.storage: optional adapter

// Link management
link(parentId, childId, relation, opts?) -> KeyLink
unlink(parentId, childId) -> boolean
async addVerifiedLink(signedLink, parentPub, childPub) -> SignedKeyLink

// Chain traversal
getChain(id) -> KeyLink[]              // walk child to root
getChildren(id) -> KeyLink[]
getParent(id) -> KeyLink|null
isDescendant(ancestorId, descendantId) -> boolean
resolveAuthority(id) -> string         // root pod ID
verifyChain(chain, now?) -> { valid, depth, expired }
async verifyCryptoChain(fromId, toId, getPublicKey) -> { valid, chain, brokenAt? }

// Succession
setSuccessor(primaryId, successorId, thresholdMs, action?) -> SuccessionPolicy
removeSuccessor(primaryId) -> boolean
recordActivity(podId) -> void
checkSuccession(now?) -> { policy, lastActive }[]
executeSuccession(primaryId) -> { action, primaryId, successorId, affected }

// Maintenance
pruneExpired(now?) -> number
get size -> number
listLinks() -> KeyLink[]
toJSON() / static fromJSON(data)
```

## 5. Succession Execution Semantics

| Action     | Behavior                                                    |
|------------|-------------------------------------------------------------|
| `transfer` | Re-links all children of primary to successor; removes old  |
| `revoke`   | Removes all child links of primary                          |
| `notify`   | Returns affected count without modifying links              |

The policy is deleted after execution in all cases.

## 6. Chain Verification

`verifyCryptoChain` walks the chain from `fromId` toward `toId`, verifying
each `SignedKeyLink` cryptographically and checking expiration. Unsigned nodes
pass without signature checks. Returns `{ valid: false, brokenAt }` on failure.

## 7. Implementation Status

| Aspect              | Status                                         |
|---------------------|------------------------------------------------|
| All classes         | Fully implemented                              |
| Serialization       | toJSON/fromJSON complete                       |
| Unit tests          | Yes (`web/test/clawser-mesh-keyring.test.mjs`) |
| App bootstrap wired | Yes                                            |
