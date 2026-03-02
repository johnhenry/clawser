# Capability Scope Grammar

Formal grammar for capability scope strings in BrowserMesh.

**Related specs**: [identity-keys.md](identity-keys.md) | [security-model.md](../core/security-model.md) | [pod-types.md](../core/pod-types.md)

## 1. Overview

Capability tokens carry a `scope` field that specifies what operations the token authorizes. This spec defines the grammar, matching algorithm, and standard catalog for scope strings, replacing ad hoc conventions used across applications.

## 2. ABNF Grammar

```abnf
scope       = namespace ":" action
namespace   = segment *("/" segment)
segment     = 1*( ALPHA / DIGIT / "-" )
action      = actionName / wildcard
actionName  = 1*( ALPHA / DIGIT / "-" )
wildcard    = "*"
```

### Examples

| Scope String | Namespace | Action |
|-------------|-----------|--------|
| `canvas:write` | `canvas` | `write` |
| `data:emit` | `data` | `emit` |
| `game:move` | `game` | `move` |
| `storage:*` | `storage` | `*` (all) |
| `board/canvas:write` | `board/canvas` | `write` |
| `compute/wasm:execute` | `compute/wasm` | `execute` |

## 3. Wildcards

The wildcard `*` matches any action within a namespace:

```typescript
// "storage:*" matches:
//   "storage:read"   ✅
//   "storage:write"  ✅
//   "storage:delete" ✅

// "storage:*" does NOT match:
//   "storage/cache:read"  ❌ (different namespace)
//   "compute:read"        ❌ (different namespace)
```

Wildcards apply only to the action portion. There is no namespace wildcard — scopes must name a specific namespace.

## 4. Hierarchical Scopes

Namespaces can be hierarchical using `/` as a separator. A parent namespace does **not** implicitly grant access to child namespaces.

```typescript
// "board:write" does NOT grant "board/canvas:write"
// These are separate, explicit scopes.

// To grant both, issue two scopes:
//   ["board:write", "board/canvas:write"]
```

This prevents unintentional scope escalation through namespace nesting.

## 5. Reserved Namespaces

The following namespace prefixes are reserved for protocol use:

| Prefix | Purpose | Examples |
|--------|---------|----------|
| `pod:*` | Pod lifecycle operations | `pod:shutdown`, `pod:heartbeat` |
| `mesh:*` | Mesh coordination | `mesh:join`, `mesh:leave`, `mesh:elect` |
| `cap:*` | Capability management | `cap:grant`, `cap:revoke`, `cap:delegate` |
| `session:*` | Session management | `session:rekey`, `session:close` |

Applications **must not** use reserved prefixes. Implementations **must** reject capability tokens that grant reserved scopes to non-privileged pods.

## 6. Matching Algorithm

```typescript
/**
 * Check if a granted scope matches a required scope.
 *
 * @param granted - Scope string from a CapabilityToken
 * @param required - Scope string required by an operation
 * @returns true if granted covers required
 */
function matchScope(granted: string, required: string): boolean {
  const [gNamespace, gAction] = splitScope(granted);
  const [rNamespace, rAction] = splitScope(required);

  // Namespaces must match exactly
  if (gNamespace !== rNamespace) {
    return false;
  }

  // Wildcard action matches any action
  if (gAction === '*') {
    return true;
  }

  // Exact action match
  return gAction === rAction;
}

/**
 * Check if any scope in a set matches the required scope.
 */
function matchAnyScope(granted: string[], required: string): boolean {
  return granted.some(g => matchScope(g, required));
}

/**
 * Split a scope string into namespace and action.
 * Throws if the scope string is malformed.
 */
function splitScope(scope: string): [string, string] {
  const colonIdx = scope.lastIndexOf(':');
  if (colonIdx === -1 || colonIdx === 0 || colonIdx === scope.length - 1) {
    throw new Error(`Invalid scope: "${scope}"`);
  }
  return [scope.slice(0, colonIdx), scope.slice(colonIdx + 1)];
}
```

## 7. Validation

```typescript
const SCOPE_PATTERN = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*:[a-z0-9-]+|\*$/;
const RESERVED_PREFIXES = ['pod:', 'mesh:', 'cap:', 'session:'];

/**
 * Validate a scope string against the grammar.
 */
function validateScope(scope: string): { valid: boolean; error?: string } {
  if (!SCOPE_PATTERN.test(scope)) {
    return { valid: false, error: `Scope "${scope}" does not match grammar` };
  }

  return { valid: true };
}

/**
 * Validate a scope string, also checking reserved namespaces.
 * Use this when validating scopes in capability tokens from non-privileged pods.
 */
function validateScopeRestricted(scope: string): { valid: boolean; error?: string } {
  const base = validateScope(scope);
  if (!base.valid) return base;

  for (const prefix of RESERVED_PREFIXES) {
    if (scope.startsWith(prefix)) {
      return { valid: false, error: `Scope "${scope}" uses reserved namespace "${prefix}"` };
    }
  }

  return { valid: true };
}
```

## 8. Standard Scope Catalog

Common scopes used across BrowserMesh applications:

### Data Operations

| Scope | Description |
|-------|-------------|
| `data:read` | Read shared data |
| `data:write` | Write/update shared data |
| `data:emit` | Emit data events to peers |
| `data:subscribe` | Subscribe to data events |

### Canvas / Rendering

| Scope | Description |
|-------|-------------|
| `canvas:read` | Read canvas state |
| `canvas:write` | Draw to canvas |
| `canvas:clear` | Clear canvas |

### Compute

| Scope | Description |
|-------|-------------|
| `compute:execute` | Execute code/WASM |
| `compute:spawn` | Spawn worker pods |
| `compute:terminate` | Terminate worker pods |
| `compute/wasm:execute` | Execute WASM specifically |

### Storage

| Scope | Description |
|-------|-------------|
| `storage:read` | Read from storage |
| `storage:write` | Write to storage |
| `storage:delete` | Delete from storage |
| `storage:*` | Full storage access |

### Game / Interactive

| Scope | Description |
|-------|-------------|
| `game:move` | Submit a game move |
| `game:state` | Read game state |
| `game:admin` | Game administration |

### Audio / Media

| Scope | Description |
|-------|-------------|
| `audio:play` | Play audio |
| `audio:process` | Process audio (worklet) |
| `media:capture` | Capture media stream |

## 9. Capability-by-Pod-Kind Safety Matrix

Not all scopes are safe for all pod kinds. This matrix provides safety guidance.

| Scope Namespace | window | spawned | iframe | worker | shared-worker | service-worker | worklet |
|----------------|--------|---------|--------|--------|---------------|----------------|---------|
| `data:*` | safe | safe | safe | safe | safe | safe | caution |
| `canvas:*` | safe | safe | safe | safe | N/A | N/A | N/A |
| `compute:*` | safe | safe | caution | safe | safe | caution | N/A |
| `storage:*` | safe | safe | caution | safe | safe | safe | N/A |
| `game:*` | safe | safe | safe | safe | safe | caution | N/A |
| `audio:*` | safe | safe | caution | safe | N/A | N/A | safe |

**Legend**:
- **safe**: Scope is appropriate for this pod kind
- **caution**: Scope works but has caveats (e.g., iframe sandboxing may block, SW may sleep mid-operation)
- **N/A**: Pod kind lacks required APIs for this scope

Implementations **should** warn when granting scopes marked "caution" or "N/A" for a given pod kind. See [pod-types.md](../core/pod-types.md) Section 10 for the full safety matrix.

## 10. Integration with CapabilityManager

When granting capabilities (see [identity-keys.md](identity-keys.md) Section 9), the `scope` field must be validated:

```typescript
// In CapabilityManager.grant():
async grant(
  path: string,
  scope: string[],
  ttl: number = 3600000
): Promise<CapabilityToken> {
  // Validate all scopes before granting
  for (const s of scope) {
    const result = validateScope(s);
    if (!result.valid) {
      throw new Error(`Invalid scope in grant: ${result.error}`);
    }
  }

  // ... existing grant logic (see identity-keys.md)
}
```
