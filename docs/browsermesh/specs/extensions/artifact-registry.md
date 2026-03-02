# Artifact Registry

Content-addressable artifact storage and discovery for BrowserMesh.

**Related specs**: [storage-integration.md](storage-integration.md) | [service-model.md](../coordination/service-model.md) | [wire-format.md](../core/wire-format.md) | [capability-scope-grammar.md](../crypto/capability-scope-grammar.md)

## 1. Overview

[storage-integration.md](storage-integration.md) uses `registry.lookup()` and `registry.register()` with undefined interfaces. This spec defines:

- The `ArtifactRegistry` interface for registering and discovering content-addressed artifacts
- CID-based content addressing
- Local, distributed, and remote registry types
- Wire format for registry operations
- Garbage collection and pinning

## 2. ArtifactRegistry Interface

```typescript
interface ArtifactRegistry {
  /** Register an artifact in the registry */
  register(artifact: ArtifactDescriptor): Promise<RegistryEntry>;

  /** Look up an artifact by CID */
  lookup(cid: string): Promise<RegistryEntry | null>;

  /** Look up artifacts by name and optional version */
  resolve(name: string, version?: string): Promise<RegistryEntry | null>;

  /** List artifacts matching a query */
  list(query?: ArtifactQuery): Promise<RegistryEntry[]>;

  /** Remove an artifact from the registry */
  remove(cid: string): Promise<boolean>;

  /** Watch for changes to a specific artifact or pattern */
  watch(pattern: string, handler: (event: RegistryEvent) => void): WatchHandle;

  /** Pin an artifact (prevent GC) */
  pin(cid: string): Promise<void>;

  /** Unpin an artifact (allow GC) */
  unpin(cid: string): Promise<void>;
}
```

## 3. Artifact Descriptor

```typescript
interface ArtifactDescriptor {
  /** Content identifier (CID v1, base32) */
  cid: string;

  /** Human-readable name */
  name: string;

  /** Semantic version */
  version: string;

  /** Artifact type */
  type: ArtifactType;

  /** Size in bytes */
  size: number;

  /** SHA-256 content hash (for verification) */
  contentHash: Uint8Array;

  /** MIME type */
  mediaType?: string;

  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;

  /** Pod ID of the publisher */
  publisherId: string;

  /** Signature over the descriptor (Ed25519) */
  signature: Uint8Array;
}

type ArtifactType =
  | 'wasm-module'      // WebAssembly modules
  | 'js-bundle'        // JavaScript bundles
  | 'model-weights'    // ML model weights
  | 'prompt-pack'      // LLM prompt templates
  | 'pod-image'        // Executable pod bundles
  | 'data-snapshot'    // State snapshots
  | 'media'            // Images, video, audio
  | 'generic';         // Untyped blob
```

## 4. Registry Entry

```typescript
interface RegistryEntry extends ArtifactDescriptor {
  /** When the artifact was registered */
  registeredAt: number;

  /** When the artifact was last accessed */
  lastAccessedAt: number;

  /** Access count */
  accessCount: number;

  /** Whether this entry is pinned (immune to GC) */
  pinned: boolean;

  /** Registry that holds this entry */
  registryType: RegistryType;

  /** Storage location hints */
  locations: StorageLocation[];
}

interface StorageLocation {
  type: 'local' | 'ipfs' | 'storacha' | 'http';
  uri: string;
  available: boolean;
}
```

## 5. Registry Types

### 5.1 Local Registry

In-memory or IndexedDB-backed registry for the current pod's artifacts.

```typescript
class LocalRegistry implements ArtifactRegistry {
  private entries: Map<string, RegistryEntry> = new Map();
  private nameIndex: Map<string, Map<string, string>> = new Map(); // name -> version -> cid

  async register(artifact: ArtifactDescriptor): Promise<RegistryEntry> {
    // Verify signature
    await this.verifySignature(artifact);

    const entry: RegistryEntry = {
      ...artifact,
      registeredAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      pinned: false,
      registryType: 'local',
      locations: [],
    };

    this.entries.set(artifact.cid, entry);

    // Update name index
    if (!this.nameIndex.has(artifact.name)) {
      this.nameIndex.set(artifact.name, new Map());
    }
    this.nameIndex.get(artifact.name)!.set(artifact.version, artifact.cid);

    return entry;
  }

  async lookup(cid: string): Promise<RegistryEntry | null> {
    const entry = this.entries.get(cid);
    if (entry) {
      entry.lastAccessedAt = Date.now();
      entry.accessCount++;
    }
    return entry ?? null;
  }

  async resolve(name: string, version?: string): Promise<RegistryEntry | null> {
    const versions = this.nameIndex.get(name);
    if (!versions) return null;

    const cid = version
      ? versions.get(version)
      : this.getLatestVersion(versions);

    return cid ? this.lookup(cid) : null;
  }

  async list(query?: ArtifactQuery): Promise<RegistryEntry[]> {
    let results = [...this.entries.values()];

    if (query?.type) {
      results = results.filter(e => e.type === query.type);
    }
    if (query?.name) {
      results = results.filter(e => e.name.includes(query.name!));
    }
    if (query?.publisherId) {
      results = results.filter(e => e.publisherId === query.publisherId);
    }

    return results.slice(0, query?.limit ?? 100);
  }

  async remove(cid: string): Promise<boolean> {
    const entry = this.entries.get(cid);
    if (!entry || entry.pinned) return false;

    this.entries.delete(cid);

    const versions = this.nameIndex.get(entry.name);
    if (versions) {
      versions.delete(entry.version);
      if (versions.size === 0) this.nameIndex.delete(entry.name);
    }

    return true;
  }

  private getLatestVersion(versions: Map<string, string>): string | undefined {
    // Simple semver sort
    const sorted = [...versions.keys()].sort((a, b) => {
      const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
      const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
      return bMajor - aMajor || bMinor - aMinor || bPatch - aPatch;
    });
    return sorted[0] ? versions.get(sorted[0]) : undefined;
  }
}

interface ArtifactQuery {
  type?: ArtifactType;
  name?: string;
  publisherId?: string;
  limit?: number;
}
```

### 5.2 Distributed Registry

Synchronizes entries across mesh peers using the state-sync protocol (see [state-sync.md](../coordination/state-sync.md)).

### 5.3 Remote Registry

Fetches from a remote HTTP endpoint or IPFS gateway. Read-only for browser pods.

## 6. Wire Format Messages

Registry messages use type codes 0xD0-0xD2 in the Registry (0xD*) block.

```typescript
enum RegistryMessageType {
  REGISTRY_LOOKUP   = 0xD0,
  REGISTRY_REGISTER = 0xD1,
  REGISTRY_NOTIFY   = 0xD2,
}
```

### 6.1 REGISTRY_LOOKUP (0xD0)

```typescript
interface RegistryLookupMessage extends MessageEnvelope {
  t: 0xD0;
  p: {
    cid?: string;                // Lookup by CID
    name?: string;               // Lookup by name
    version?: string;            // Specific version (with name)
    type?: ArtifactType;         // Filter by type
  };
}
```

### 6.2 REGISTRY_REGISTER (0xD1)

```typescript
interface RegistryRegisterMessage extends MessageEnvelope {
  t: 0xD1;
  p: {
    artifact: ArtifactDescriptor;
    locations: StorageLocation[];
  };
}
```

### 6.3 REGISTRY_NOTIFY (0xD2)

Broadcast when an artifact is registered, updated, or removed.

```typescript
interface RegistryNotifyMessage extends MessageEnvelope {
  t: 0xD2;
  p: {
    event: 'registered' | 'updated' | 'removed';
    cid: string;
    name: string;
    version: string;
  };
}
```

## 7. Capability Scoping

Registry operations require capabilities (see [capability-scope-grammar.md](../crypto/capability-scope-grammar.md)):

```
registry:read                    // Lookup and list
registry:write                   // Register and remove
registry:admin                   // Pin, unpin, GC
registry:read:wasm-module        // Type-scoped read
registry:write:pod-image         // Type-scoped write
```

## 8. Watch Interface

```typescript
interface WatchHandle {
  /** Stop watching */
  unwatch(): void;
}

interface RegistryEvent {
  type: 'registered' | 'updated' | 'removed';
  entry: RegistryEntry;
  timestamp: number;
}
```

## 9. Garbage Collection and Pinning

Unpinned artifacts are subject to garbage collection when storage limits are exceeded:

```typescript
const REGISTRY_DEFAULTS = {
  maxEntries: 10_000,
  maxTotalSize: 1024 * 1024 * 1024,  // 1 GB
  gcInterval: 300_000,                // 5 minutes
  accessThreshold: 7 * 24 * 60 * 60 * 1000, // 7 days
};

async function garbageCollect(registry: LocalRegistry): Promise<number> {
  const entries = await registry.list();
  const staleThreshold = Date.now() - REGISTRY_DEFAULTS.accessThreshold;

  let removed = 0;
  for (const entry of entries) {
    if (!entry.pinned && entry.lastAccessedAt < staleThreshold) {
      if (await registry.remove(entry.cid)) removed++;
    }
  }
  return removed;
}
```

### Pin Semantics

- **Pinned**: Artifact is immune to GC; must be explicitly unpinned
- **Unpinned**: Artifact may be collected if not accessed within threshold
- **Auto-pin**: Active pod images and in-use modules are auto-pinned

## 10. Limits

| Resource | Limit |
|----------|-------|
| Max registry entries | 10,000 |
| Max total storage | 1 GB |
| GC check interval | 5 minutes |
| Access staleness threshold | 7 days |
| Max artifact name length | 128 characters |
| Max version string length | 32 characters |
| Max metadata size | 16 KB |
