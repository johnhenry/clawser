# Test Transport

In-memory transport for unit and integration testing of BrowserMesh without real browsers.

**Related specs**: [channel-abstraction.md](../networking/channel-abstraction.md) | [chaos-testing.md](chaos-testing.md) | [boot-sequence.md](../core/boot-sequence.md)

## 1. Overview

Testing BrowserMesh protocols requires establishing channels between pods. In production, these channels run over real browser APIs (MessagePort, BroadcastChannel, WebSocket, etc.). For unit tests and CI pipelines, spinning up real browser contexts is slow and fragile.

This spec defines `LocalChannel`, an in-memory implementation of the `PodChannel` interface (see [channel-abstraction.md](../networking/channel-abstraction.md)) that provides:

- Zero-dependency, in-process message passing
- Configurable latency, jitter, and message loss
- Deterministic testing via seeded RNG
- `AsyncIterator` support for ergonomic test code
- `TestMesh` helper for multi-pod test topologies
- Direct integration with the chaos testing framework (see [chaos-testing.md](chaos-testing.md))

## 2. LocalChannel

`LocalChannel` implements `PodChannel` from [channel-abstraction.md](../networking/channel-abstraction.md) using paired in-memory queues. Messages sent on one end are delivered to the paired channel's `onmessage` handler.

```typescript
class LocalChannel implements PodChannel {
  readonly id: string;
  readonly type: PodChannelType = 'message-port'; // Simulates MessagePort
  state: PodChannelState = 'open';
  onmessage: ((event: PodChannelEvent) => void) | null = null;
  onerror: ((error: PodChannelError) => void) | null = null;
  onclose: (() => void) | null = null;

  private peer: LocalChannel | null = null;
  private queue: PodChannelEvent[] = [];
  private options: LocalChannelOptions;
  private rng: DeterministicRNG;

  constructor(id?: string, options?: LocalChannelOptions) {
    this.id = id ?? crypto.randomUUID();
    this.options = { ...LOCAL_CHANNEL_DEFAULTS, ...options };
    this.rng = new DeterministicRNG(this.options.seed);
  }

  /** Connect this channel to its peer (called by createLocalChannelPair) */
  _setPeer(peer: LocalChannel): void {
    this.peer = peer;
  }

  /**
   * Send a message to the paired channel.
   * Respects configured latency, jitter, drop rate, and reorder rate.
   */
  send(data: unknown, transfer?: Transferable[]): void {
    if (this.state !== 'open') {
      this.onerror?.({
        code: 'CHANNEL_CLOSED',
        message: 'Cannot send on closed channel',
        fatal: false,
      });
      return;
    }

    if (!this.peer || this.peer.state !== 'open') {
      this.onerror?.({
        code: 'PEER_CLOSED',
        message: 'Peer channel is closed',
        fatal: false,
      });
      return;
    }

    // Check queue capacity
    if (this.peer.queue.length >= this.options.maxQueueSize!) {
      this.onerror?.({
        code: 'QUEUE_FULL',
        message: `Queue size exceeded (max: ${this.options.maxQueueSize})`,
        fatal: false,
      });
      return;
    }

    // Simulate message drop
    if (this.rng.next() < this.options.dropRate!) {
      return; // Message silently dropped
    }

    const event: PodChannelEvent = {
      data: structuredClone(data),
      source: this,
    };

    // Compute delivery delay
    const baseLatency = this.options.latencyMs!;
    const jitter = this.options.jitterMs! * (this.rng.next() * 2 - 1);
    const delay = Math.max(0, baseLatency + jitter);

    // Simulate reordering by adding extra random delay
    const reorderDelay = this.rng.next() < this.options.reorderRate!
      ? this.rng.next() * baseLatency * 2
      : 0;

    const totalDelay = delay + reorderDelay;

    // Schedule delivery
    if (totalDelay === 0) {
      this.peer.deliver(event);
    } else {
      setTimeout(() => {
        if (this.peer?.state === 'open') {
          this.peer.deliver(event);
        }
      }, totalDelay);
    }
  }

  /** Close the channel and notify the peer */
  close(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.queue.length = 0;
    this.onclose?.();
  }

  /** Async iterator for consuming messages in tests */
  [Symbol.asyncIterator](): AsyncIterableIterator<PodChannelEvent> {
    return new LocalChannelIterator(this);
  }

  /** Internal: deliver a message to this channel's handler */
  private deliver(event: PodChannelEvent): void {
    if (this.state !== 'open') return;
    this.queue.push(event);
    this.onmessage?.(event);
  }
}
```

## 3. LocalChannelOptions

Configure fault injection behavior per channel pair.

```typescript
interface LocalChannelOptions {
  /** Simulated one-way latency in ms (default: 0) */
  latencyMs?: number;
  /** Random jitter range in ms, applied as +/- (default: 0) */
  jitterMs?: number;
  /** Probability of dropping a message, 0.0-1.0 (default: 0) */
  dropRate?: number;
  /** Probability of reordering a message, 0.0-1.0 (default: 0) */
  reorderRate?: number;
  /** Maximum buffered messages before backpressure error (default: 1000) */
  maxQueueSize?: number;
  /** RNG seed for deterministic test runs (default: random) */
  seed?: number;
}

const LOCAL_CHANNEL_DEFAULTS: Required<LocalChannelOptions> = {
  latencyMs: 0,
  jitterMs: 0,
  dropRate: 0,
  reorderRate: 0,
  maxQueueSize: 1000,
  seed: Date.now(),
};
```

## 4. createLocalChannelPair

Creates a connected pair of `LocalChannel` instances. Messages sent on one are delivered to the other.

```typescript
/**
 * Create two connected LocalChannel instances.
 * Like MessageChannel, but fully in-memory with configurable faults.
 */
function createLocalChannelPair(
  options?: LocalChannelOptions
): [LocalChannel, LocalChannel] {
  const idA = crypto.randomUUID();
  const idB = crypto.randomUUID();

  const channelA = new LocalChannel(idA, options);
  const channelB = new LocalChannel(idB, options);

  channelA._setPeer(channelB);
  channelB._setPeer(channelA);

  return [channelA, channelB];
}
```

### Usage

```typescript
const [alice, bob] = createLocalChannelPair({ latencyMs: 10 });

bob.onmessage = (event) => {
  console.log('Bob received:', event.data);
};

alice.send({ type: 'HELLO', from: 'alice' });
// Bob receives after ~10ms
```

## 5. AsyncIterator Support

`LocalChannel` implements `Symbol.asyncIterator` for ergonomic consumption in test code using `for await...of`.

```typescript
class LocalChannelIterator implements AsyncIterableIterator<PodChannelEvent> {
  private buffer: PodChannelEvent[] = [];
  private resolve: ((value: IteratorResult<PodChannelEvent>) => void) | null = null;
  private done: boolean = false;

  constructor(channel: LocalChannel) {
    const originalOnMessage = channel.onmessage;
    channel.onmessage = (event) => {
      originalOnMessage?.(event);
      if (this.resolve) {
        const r = this.resolve;
        this.resolve = null;
        r({ value: event, done: false });
      } else {
        this.buffer.push(event);
      }
    };

    const originalOnClose = channel.onclose;
    channel.onclose = () => {
      originalOnClose?.();
      this.done = true;
      if (this.resolve) {
        const r = this.resolve;
        this.resolve = null;
        r({ value: undefined as any, done: true });
      }
    };
  }

  async next(): Promise<IteratorResult<PodChannelEvent>> {
    if (this.buffer.length > 0) {
      return { value: this.buffer.shift()!, done: false };
    }
    if (this.done) {
      return { value: undefined as any, done: true };
    }
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<PodChannelEvent> {
    return this;
  }
}
```

### Ergonomic Test Code

```typescript
// Consume messages with for-await-of
const [sender, receiver] = createLocalChannelPair();

sender.send({ seq: 1 });
sender.send({ seq: 2 });
sender.send({ seq: 3 });
sender.close();

const received: number[] = [];
for await (const event of receiver) {
  received.push(event.data.seq);
}

assert.deepEqual(received, [1, 2, 3]);
```

## 6. TestMesh

`TestMesh` creates a fully-connected mesh of `TestPod` instances with `LocalChannel` pairs between every pod. This enables multi-pod integration tests without browsers.

```typescript
interface TestMeshOptions extends LocalChannelOptions {
  /** Pod kinds to assign (cycles through list). Default: all 'worker' */
  kinds?: PodKind[];
}

interface TestPod {
  /** Pod identity */
  id: string;
  /** Pod kind */
  kind: PodKind;
  /** Channels to other pods, keyed by target pod index */
  channels: Map<number, LocalChannel>;
}

class TestMesh {
  readonly pods: TestPod[];
  private channels: Map<string, LocalChannel> = new Map();

  private constructor(pods: TestPod[]) {
    this.pods = pods;
  }

  /**
   * Create a mesh of n pods with LocalChannel connections between all pairs.
   *
   * For n pods, creates n*(n-1)/2 channel pairs.
   */
  static async create(
    n: number,
    options?: TestMeshOptions
  ): Promise<TestMesh> {
    if (n < 2 || n > TESTMESH_LIMITS.maxPods) {
      throw new Error(`Pod count must be between 2 and ${TESTMESH_LIMITS.maxPods}`);
    }

    const kinds = options?.kinds ?? ['worker'];
    const pods: TestPod[] = [];

    // Create pods
    for (let i = 0; i < n; i++) {
      pods.push({
        id: `test-pod-${i}`,
        kind: kinds[i % kinds.length],
        channels: new Map(),
      });
    }

    const mesh = new TestMesh(pods);

    // Create channel pairs between all pods
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const [channelA, channelB] = createLocalChannelPair(options);
        pods[i].channels.set(j, channelA);
        pods[j].channels.set(i, channelB);
        mesh.channels.set(`${i}-${j}`, channelA);
        mesh.channels.set(`${j}-${i}`, channelB);
      }
    }

    return mesh;
  }

  /** Get the LocalChannel from pod at fromIndex to pod at toIndex */
  getChannel(fromIndex: number, toIndex: number): LocalChannel {
    const channel = this.channels.get(`${fromIndex}-${toIndex}`);
    if (!channel) {
      throw new Error(`No channel from pod ${fromIndex} to pod ${toIndex}`);
    }
    return channel;
  }

  /**
   * Inject a fault into the mesh.
   * Modifies LocalChannelOptions on affected channels at runtime.
   */
  injectFault(fault: FaultSpec): void {
    switch (fault.type) {
      case 'partition':
        this.injectPartition(fault);
        break;
      case 'latency':
        this.injectLatency(fault);
        break;
      case 'message-drop':
        this.injectMessageDrop(fault);
        break;
      default:
        throw new Error(`Unsupported fault type for TestMesh: ${(fault as any).type}`);
    }
  }

  private injectPartition(fault: PartitionFault): void {
    // Close channels between group A and group B
    for (const podA of this.pods) {
      if (!fault.groupA.includes(podA.id)) continue;
      for (const podB of this.pods) {
        if (!fault.groupB.includes(podB.id)) continue;
        const idxA = this.pods.indexOf(podA);
        const idxB = this.pods.indexOf(podB);

        // Close both directions
        this.channels.get(`${idxA}-${idxB}`)?.close();
        this.channels.get(`${idxB}-${idxA}`)?.close();
      }
    }

    // Auto-heal after duration
    if (fault.duration && fault.duration > 0) {
      setTimeout(() => this.healPartition(fault), fault.duration);
    }
  }

  private healPartition(fault: PartitionFault): void {
    // Recreate channels between group A and group B
    for (const podA of this.pods) {
      if (!fault.groupA.includes(podA.id)) continue;
      for (const podB of this.pods) {
        if (!fault.groupB.includes(podB.id)) continue;
        const idxA = this.pods.indexOf(podA);
        const idxB = this.pods.indexOf(podB);

        const [channelA, channelB] = createLocalChannelPair();
        podA.channels.set(idxB, channelA);
        podB.channels.set(idxA, channelB);
        this.channels.set(`${idxA}-${idxB}`, channelA);
        this.channels.set(`${idxB}-${idxA}`, channelB);
      }
    }
  }

  private injectLatency(fault: LatencyFault): void {
    for (const pod of this.pods) {
      if (fault.targets[0] !== '*' && !fault.targets.includes(pod.id)) continue;
      for (const [_, channel] of pod.channels) {
        (channel as any).options.latencyMs = fault.delayMs;
        (channel as any).options.jitterMs = fault.jitterMs ?? 0;
      }
    }
  }

  private injectMessageDrop(fault: MessageDropFault): void {
    for (const pod of this.pods) {
      if (!fault.targets.includes(pod.id)) continue;
      for (const [_, channel] of pod.channels) {
        (channel as any).options.dropRate = fault.dropRate;
      }
    }
  }

  /** Shut down all pods and close all channels */
  async shutdown(): Promise<void> {
    for (const [_, channel] of this.channels) {
      channel.close();
    }
    this.channels.clear();
    for (const pod of this.pods) {
      pod.channels.clear();
    }
  }
}
```

## 7. Integration with Chaos Testing

`LocalChannelOptions` map directly to `FaultSpec` types from [chaos-testing.md](chaos-testing.md), enabling the same fault scenarios to run in-memory.

### LocalChannel to FaultSpec Mapping

| LocalChannelOptions | FaultSpec | Effect |
|---|---|---|
| `latencyMs` + `jitterMs` | `LatencyFault` | Simulated network delay with optional jitter |
| `dropRate` | `MessageDropFault` | Random message loss at configured probability |
| `maxQueueSize: 0` | `PartitionFault` | Complete message blocking (queue immediately full) |
| `reorderRate` | (no direct equivalent) | Out-of-order delivery simulation |

### Converting FaultSpec to LocalChannelOptions

```typescript
/**
 * Convert a chaos FaultSpec into LocalChannelOptions for in-memory testing.
 */
function faultSpecToChannelOptions(fault: FaultSpec): Partial<LocalChannelOptions> {
  switch (fault.type) {
    case 'latency':
      return {
        latencyMs: fault.delayMs,
        jitterMs: fault.jitterMs ?? 0,
      };
    case 'message-drop':
      return {
        dropRate: fault.dropRate,
      };
    case 'partition':
      return {
        maxQueueSize: 0,
      };
    default:
      return {};
  }
}
```

## 8. Deterministic Testing

Flaky tests are unacceptable for distributed protocol validation. `LocalChannel` supports deterministic behavior via seeded pseudo-random number generation.

### Mulberry32 RNG

The `DeterministicRNG` class uses the mulberry32 algorithm, which produces a full-period 32-bit PRNG suitable for test-grade randomness.

```typescript
class DeterministicRNG {
  private state: number;

  constructor(seed?: number) {
    this.state = seed ?? Date.now();
  }

  /** Return a pseudo-random float in [0, 1) */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Reset to the original seed for replay */
  reset(seed: number): void {
    this.state = seed;
  }
}
```

### Deterministic Test Example

```typescript
// Same seed = same behavior every time
const seed = 42;

const [a, b] = createLocalChannelPair({
  latencyMs: 10,
  jitterMs: 5,
  dropRate: 0.1,
  seed,
});

// Run test — results are identical on every execution
const results = await runProtocolTest(a, b);
assert.deepEqual(results, expectedResults);
```

## 9. Example Test Scenarios

### 9.1 Basic Message Exchange

```typescript
import { describe, it, expect } from 'vitest';
import { createLocalChannelPair } from '@browsermesh/test-transport';

describe('PodChannel message exchange', () => {
  it('delivers messages between paired channels', async () => {
    const [alice, bob] = createLocalChannelPair();
    const received: unknown[] = [];

    bob.onmessage = (event) => received.push(event.data);

    alice.send({ type: 'PING' });
    alice.send({ type: 'PONG' });

    // With zero latency, delivery is synchronous
    expect(received).toEqual([
      { type: 'PING' },
      { type: 'PONG' },
    ]);

    alice.close();
    bob.close();
  });
});
```

### 9.2 Latency Simulation

```typescript
describe('Latency simulation', () => {
  it('delivers messages after configured delay', async () => {
    const [alice, bob] = createLocalChannelPair({ latencyMs: 50 });

    const deliveryPromise = new Promise<PodChannelEvent>((resolve) => {
      bob.onmessage = resolve;
    });

    const start = performance.now();
    alice.send({ type: 'TIMED' });

    const event = await deliveryPromise;
    const elapsed = performance.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small timing variance
    expect(event.data).toEqual({ type: 'TIMED' });

    alice.close();
    bob.close();
  });
});
```

### 9.3 Partition and Healing with TestMesh

```typescript
describe('TestMesh partition healing', () => {
  it('blocks messages during partition and restores after', async () => {
    const mesh = await TestMesh.create(4, { latencyMs: 5 });

    // Inject a partition: pods 0-1 vs pods 2-3
    mesh.injectFault({
      type: 'partition',
      groupA: [mesh.pods[0].id, mesh.pods[1].id],
      groupB: [mesh.pods[2].id, mesh.pods[3].id],
      duration: 1000,
    });

    // Messages within the same group still work
    const intraGroupReceived: unknown[] = [];
    mesh.getChannel(0, 1).onmessage = (e) => intraGroupReceived.push(e.data);
    mesh.getChannel(0, 1); // This is pod 1's view — wrong direction
    // Correct: send from pod 0 to pod 1
    mesh.pods[0].channels.get(1)!.send({ group: 'A' });

    // Messages across partition are blocked
    // (channel was closed by injectFault)
    const crossGroupChannel = mesh.getChannel(0, 2);
    expect(crossGroupChannel.state).toBe('closed');

    // Wait for partition to heal
    await sleep(1100);

    // New channels should be available after healing
    const healed = mesh.getChannel(0, 2);
    expect(healed.state).toBe('open');

    await mesh.shutdown();
  });
});
```

### 9.4 Deterministic Drop Rate

```typescript
describe('Deterministic message drops', () => {
  it('drops messages reproducibly with seed', async () => {
    const seed = 12345;

    // Run 1
    const [a1, b1] = createLocalChannelPair({ dropRate: 0.3, seed });
    const received1: number[] = [];
    b1.onmessage = (e) => received1.push(e.data);
    for (let i = 0; i < 100; i++) a1.send(i);

    // Run 2 (same seed)
    const [a2, b2] = createLocalChannelPair({ dropRate: 0.3, seed });
    const received2: number[] = [];
    b2.onmessage = (e) => received2.push(e.data);
    for (let i = 0; i < 100; i++) a2.send(i);

    // Both runs produce identical results
    expect(received1).toEqual(received2);

    a1.close(); b1.close();
    a2.close(); b2.close();
  });
});
```

## 10. Limits

| Resource | Limit |
|----------|-------|
| Max queue size per channel | 10,000 messages |
| Max simulated latency | 10,000 ms |
| Max jitter | 5,000 ms |
| Max TestMesh pod count | 64 |
| Max channel pairs per TestMesh | 2,016 (64 * 63 / 2) |
| Max concurrent TestMesh instances | 8 |

```typescript
const TESTMESH_LIMITS = {
  maxPods: 64,
  maxQueueSize: 10_000,
  maxLatencyMs: 10_000,
  maxJitterMs: 5_000,
  maxConcurrentMeshes: 8,
};
```
