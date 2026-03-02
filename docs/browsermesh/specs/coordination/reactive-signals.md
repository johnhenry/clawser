# Reactive Signals

Lightweight reactive state primitives for single-writer UI state synchronization across pods.

**Related specs**: [state-sync.md](state-sync.md) | [wire-format.md](../core/wire-format.md) | [presence-protocol.md](presence-protocol.md) | [pubsub-topics.md](pubsub-topics.md) | [client-api.md](../reference/client-api.md)

## 1. Overview

[state-sync.md](state-sync.md) provides CRDT-based multi-writer convergent state. However, many UI patterns (cursors, selections, form fields, typing indicators) are single-writer and need lower overhead than CRDTs. This spec adds:

- `MeshSignal<T>` — observable reactive value with version tracking
- `MeshComputed<T>` — derived signal with automatic dependency tracking
- `MeshEffect` — side-effect that re-runs on dependency change
- `batch()` — defer notifications until all updates complete
- `broadcastSignal()` — cross-tab sync via BroadcastChannel
- `remoteSignal()` — cross-pod sync via wire-format messages

### Signals vs CRDTs

| Aspect | Reactive Signals | CRDTs (state-sync) |
|--------|-----------------|---------------------|
| Writers | Single owner | Multiple concurrent |
| Conflict resolution | Last-writer-wins (version) | Automatic merge |
| Overhead | Minimal (value + version) | Higher (operation log / state vector) |
| Latency | Immediate propagation | Sync interval dependent |
| Use case | Cursors, selections, form fields | Shared documents, counters |
| Composition | `computed()` derivations | CRDT-specific merge functions |

**Rule of thumb**: Use signals when one pod owns the value and others observe. Use CRDTs when multiple pods write concurrently.

## 2. Wire Format Messages

Reactive signal messages use type codes 0xA6-0xA9, adjacent to the State Sync block (0xA0-0xA5). Messages use the `RSIGNAL_` prefix to avoid collision with `SIGNAL_` (signaling protocol 0x43-0x48).

```typescript
enum ReactiveSignalMessageType {
  RSIGNAL_DECLARE   = 0xA6,
  RSIGNAL_UPDATE    = 0xA7,
  RSIGNAL_SUBSCRIBE = 0xA8,
  RSIGNAL_BATCH     = 0xA9,
}
```

### 2.1 RSIGNAL_DECLARE (0xA6)

Announce a new signal to peers.

```typescript
interface RSignalDeclareMessage {
  t: 0xA6;
  p: {
    signalId: string;
    name: string;
    initialValue: unknown;
    version: 0;
    ownerId: string;  // Pod ID of the signal owner
  };
}
```

### 2.2 RSIGNAL_UPDATE (0xA7)

Propagate a value change.

```typescript
interface RSignalUpdateMessage {
  t: 0xA7;
  p: {
    signalId: string;
    value: unknown;
    version: number;       // Monotonically increasing
    timestamp: number;
    ownerId: string;
  };
}
```

### 2.3 RSIGNAL_SUBSCRIBE (0xA8)

Subscribe to updates for a signal.

```typescript
interface RSignalSubscribeMessage {
  t: 0xA8;
  p: {
    signalId: string;
    subscriberId: string;   // Pod ID of the subscriber
    lastKnownVersion: number;
  };
}
```

### 2.4 RSIGNAL_BATCH (0xA9)

Batched updates for multiple signals in a single message.

```typescript
interface RSignalBatchMessage {
  t: 0xA9;
  p: {
    updates: Array<{
      signalId: string;
      value: unknown;
      version: number;
    }>;
    batchId: string;
    ownerId: string;
    timestamp: number;
  };
}
```

## 3. Core Primitives

### 3.1 MeshSignal\<T\>

A reactive container holding a single value with version tracking.

```typescript
interface MeshSignal<T> {
  /** Get current value (tracks dependency in computed context) */
  readonly value: T;

  /** Get current value without tracking dependency */
  peek(): T;

  /** Set a new value (only callable by owner) */
  set(newValue: T): void;

  /** Subscribe to value changes */
  subscribe(listener: (value: T, prevValue: T) => void): () => void;

  /** Dispose the signal and unsubscribe all listeners */
  dispose(): void;

  /** Current version (monotonically increasing) */
  readonly version: number;

  /** Pod ID of the signal owner */
  readonly ownerId: string;

  /** Signal identifier */
  readonly id: string;
}
```

### Implementation

```typescript
class MeshSignalImpl<T> implements MeshSignal<T> {
  private _value: T;
  private _version = 0;
  private listeners: Set<(value: T, prev: T) => void> = new Set();
  private disposed = false;

  constructor(
    public readonly id: string,
    initialValue: T,
    public readonly ownerId: string
  ) {
    this._value = initialValue;
  }

  get value(): T {
    // Track dependency if inside a computed context
    if (currentComputed) {
      currentComputed.addDependency(this);
    }
    return this._value;
  }

  peek(): T {
    return this._value;
  }

  set(newValue: T): void {
    if (this.disposed) throw new Error('Signal disposed');
    if (Object.is(this._value, newValue)) return;

    const prev = this._value;
    this._value = newValue;
    this._version++;

    if (!batchDepth) {
      this.notify(prev);
    } else {
      pendingNotifications.add(this);
    }
  }

  get version(): number {
    return this._version;
  }

  subscribe(listener: (value: T, prev: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  /** @internal */
  notify(prev: T): void {
    for (const listener of this.listeners) {
      listener(this._value, prev);
    }
  }
}
```

### 3.2 MeshComputed\<T\>

A derived signal that automatically tracks its dependencies and recomputes when they change.

```typescript
interface MeshComputed<T> {
  /** Get the computed value (recomputes if dependencies changed) */
  readonly value: T;

  /** Subscribe to value changes */
  subscribe(listener: (value: T, prevValue: T) => void): () => void;

  /** Dispose the computed and stop tracking */
  dispose(): void;
}
```

```typescript
// Global tracking context
let currentComputed: MeshComputedImpl<any> | null = null;

class MeshComputedImpl<T> implements MeshComputed<T> {
  private _value: T;
  private dirty = true;
  private dependencies: Set<MeshSignal<any>> = new Set();
  private unsubscribers: (() => void)[] = [];
  private listeners: Set<(value: T, prev: T) => void> = new Set();

  constructor(private computation: () => T) {
    this._value = this.compute();
  }

  get value(): T {
    if (currentComputed) {
      currentComputed.addDependency(this as any);
    }
    if (this.dirty) {
      const prev = this._value;
      this._value = this.compute();
      this.dirty = false;
      if (!Object.is(prev, this._value)) {
        for (const listener of this.listeners) {
          listener(this._value, prev);
        }
      }
    }
    return this._value;
  }

  /** @internal */
  addDependency(signal: MeshSignal<any>): void {
    if (!this.dependencies.has(signal)) {
      this.dependencies.add(signal);
      const unsub = signal.subscribe(() => {
        this.dirty = true;
      });
      this.unsubscribers.push(unsub);
    }
  }

  subscribe(listener: (value: T, prev: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.dependencies.clear();
    this.listeners.clear();
  }

  private compute(): T {
    // Clear old dependencies
    for (const unsub of this.unsubscribers) unsub();
    this.dependencies.clear();
    this.unsubscribers = [];

    // Track new dependencies
    const prevComputed = currentComputed;
    currentComputed = this;
    try {
      return this.computation();
    } finally {
      currentComputed = prevComputed;
    }
  }
}
```

### 3.3 MeshEffect

A side-effect function that re-runs whenever its reactive dependencies change.

```typescript
interface MeshEffect {
  /** Dispose the effect and stop running */
  dispose(): void;
}

function createEffect(
  fn: () => void | (() => void)
): MeshEffect {
  let cleanup: (() => void) | void;
  let disposed = false;

  // Use a computed to track dependencies
  const tracker = new MeshComputedImpl(() => {
    if (disposed) return;
    if (cleanup) cleanup();
    cleanup = fn();
  });

  // Force initial evaluation
  tracker.value;

  return {
    dispose() {
      disposed = true;
      if (cleanup) cleanup();
      tracker.dispose();
    },
  };
}
```

## 4. Batching

Defer all notifications until the batch completes. Maps to `RSIGNAL_BATCH` for wire transmission.

```typescript
let batchDepth = 0;
const pendingNotifications: Set<MeshSignalImpl<any>> = new Set();

function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      const pending = [...pendingNotifications];
      pendingNotifications.clear();
      for (const signal of pending) {
        signal.notify(signal.peek());
      }
    }
  }
}
```

## 5. Cross-Tab Synchronization

`broadcastSignal()` syncs a signal across browser tabs sharing the same origin via BroadcastChannel.

```typescript
const SIGNAL_BC_PREFIX = 'pod:signal:';

function broadcastSignal<T>(signal: MeshSignal<T>): () => void {
  const channel = new BroadcastChannel(`${SIGNAL_BC_PREFIX}${signal.id}`);

  // Outbound: broadcast changes
  const unsub = signal.subscribe((value) => {
    channel.postMessage({
      signalId: signal.id,
      value,
      version: signal.version,
      ownerId: signal.ownerId,
    });
  });

  // Inbound: apply remote changes
  channel.onmessage = (event) => {
    const { value, version, ownerId } = event.data;
    if (ownerId === signal.ownerId && version > signal.version) {
      (signal as MeshSignalImpl<T>).set(value);
    }
  };

  return () => {
    unsub();
    channel.close();
  };
}
```

## 6. Cross-Pod Synchronization

`remoteSignal()` syncs a signal across pods using wire-format messages.

```typescript
function remoteSignal<T>(
  signal: MeshSignal<T>,
  session: PodSession
): () => void {
  // Declare signal to remote
  session.send({
    t: ReactiveSignalMessageType.RSIGNAL_DECLARE,
    p: {
      signalId: signal.id,
      name: signal.id,
      initialValue: signal.peek(),
      version: 0,
      ownerId: signal.ownerId,
    },
  });

  // Outbound: send updates
  const unsub = signal.subscribe((value) => {
    session.send({
      t: ReactiveSignalMessageType.RSIGNAL_UPDATE,
      p: {
        signalId: signal.id,
        value,
        version: signal.version,
        timestamp: Date.now(),
        ownerId: signal.ownerId,
      },
    });
  });

  // Inbound: apply remote updates
  session.on('message', (msg: any) => {
    if (msg.t === ReactiveSignalMessageType.RSIGNAL_UPDATE &&
        msg.p.signalId === signal.id) {
      applyRemoteUpdate(signal, msg.p);
    }
  });

  return unsub;
}
```

## 7. Conflict Resolution

Signals use monotonic version counters. When a remote update arrives:

```typescript
function applyRemoteUpdate<T>(
  signal: MeshSignal<T>,
  update: { value: T; version: number; ownerId: string }
): boolean {
  // Accept if incoming version is strictly greater
  if (update.version > signal.version) {
    (signal as MeshSignalImpl<T>).set(update.value);
    return true;
  }

  // Tie-break: higher Pod ID wins (deterministic)
  if (update.version === signal.version && update.ownerId > signal.ownerId) {
    (signal as MeshSignalImpl<T>).set(update.value);
    return true;
  }

  // Reject stale update
  return false;
}
```

### Conflict Resolution Rules

| Condition | Action |
|-----------|--------|
| `incomingVersion > localVersion` | Accept remote value |
| `incomingVersion === localVersion` AND `remotePodId > localPodId` | Accept (tie-break) |
| `incomingVersion < localVersion` | Reject (stale) |
| `incomingVersion === localVersion` AND `remotePodId < localPodId` | Reject (tie-break) |

## 8. Client API Integration

```typescript
// Usage with MeshClient (see client-api.md)

// Create a local signal
const cursor = client.signal<{ x: number; y: number }>('cursor-pos', { x: 0, y: 0 });

// Create a computed signal
const label = client.computed(() => `Cursor at (${cursor.value.x}, ${cursor.value.y})`);

// Create an effect
const cleanup = client.effect(() => {
  document.title = label.value;
});

// Batch updates
batch(() => {
  cursor.set({ x: 100, y: 200 });
  // Other signal updates...
});

// Sync across tabs
broadcastSignal(cursor);

// Sync across pods
const conn = await client.connect(remotePodId);
remoteSignal(cursor, conn.session);

// Cleanup
cleanup();
cursor.dispose();
label.dispose();
```

## 9. Limits

| Resource | Limit |
|----------|-------|
| Max signals per pod | 256 |
| Max subscribers per signal | 64 |
| Max batch size | 32 updates |
| Signal value max size | 16 KB (CBOR-encoded) |
| Update rate limit | 60 updates/second per signal |
| Cross-tab channel prefix | `pod:signal:` |
| Version counter | 64-bit integer |
| Computed dependency depth | 8 levels |
