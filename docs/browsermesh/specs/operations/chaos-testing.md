# Chaos Testing

Fault injection and distributed testing framework for BrowserMesh.

**Related specs**: [wire-format.md](../core/wire-format.md) | [channel-abstraction.md](../networking/channel-abstraction.md) | [test-transport.md](test-transport.md) | [session-keys.md](../crypto/session-keys.md) | [capability-scope-grammar.md](../crypto/capability-scope-grammar.md) | [observability.md](observability.md)

## 1. Overview

BrowserMesh operates across multiple browser contexts with unreliable connections. This spec defines a chaos testing framework for validating distributed scenarios:

- Controlled fault injection (partitions, latency, drops)
- Test harness with scenario DSL
- Capability-gated access (`chaos:inject`)
- Integration with observability (see [observability.md](observability.md))

## 2. ChaosController Interface

```typescript
interface ChaosController {
  /** Inject a fault into the mesh */
  inject(fault: FaultSpec): Promise<FaultHandle>;

  /** Remove a specific fault */
  remove(faultId: string): Promise<void>;

  /** Remove all active faults */
  removeAll(): Promise<void>;

  /** List active faults */
  list(): FaultStatus[];

  /** Get status of a specific fault */
  status(faultId: string): FaultStatus | undefined;
}

interface FaultHandle {
  /** Unique fault identifier */
  id: string;

  /** Remove this fault */
  remove(): Promise<void>;

  /** Check if fault is still active */
  isActive(): boolean;
}

interface FaultStatus {
  id: string;
  spec: FaultSpec;
  active: boolean;
  injectedAt: number;
  expiresAt?: number;
  affectedPods: string[];
  messagesAffected: number;
}
```

## 3. Fault Types

```typescript
type FaultSpec =
  | PartitionFault
  | LatencyFault
  | MessageDropFault
  | PodCrashFault
  | ClockSkewFault;

interface PartitionFault {
  type: 'partition';
  /** Pod IDs in partition group A */
  groupA: string[];
  /** Pod IDs in partition group B */
  groupB: string[];
  /** Duration in ms (0 = until removed) */
  duration?: number;
  /** Allow one-way traffic? */
  asymmetric?: boolean;
  /** Which direction for asymmetric (A→B or B→A) */
  allowDirection?: 'a-to-b' | 'b-to-a';
}

interface LatencyFault {
  type: 'latency';
  /** Target pod IDs (or '*' for all) */
  targets: string[];
  /** Base latency to add (ms) */
  delayMs: number;
  /** Random jitter range (ms) */
  jitterMs?: number;
  /** Latency distribution */
  distribution?: 'uniform' | 'normal' | 'pareto';
  /** Duration in ms */
  duration?: number;
}

interface MessageDropFault {
  type: 'message-drop';
  /** Target pod IDs */
  targets: string[];
  /** Drop probability (0.0 - 1.0) */
  dropRate: number;
  /** Only drop specific message types (wire format type codes) */
  messageTypes?: number[];
  /** Duration in ms */
  duration?: number;
}

interface PodCrashFault {
  type: 'pod-crash';
  /** Pod ID to crash */
  targetPod: string;
  /** Delay before crash (ms) */
  delay?: number;
  /** Auto-restart after crash (ms, 0 = no restart) */
  restartAfter?: number;
  /** Crash type */
  crashMode: 'immediate' | 'graceful' | 'hang';
}

interface ClockSkewFault {
  type: 'clock-skew';
  /** Target pod IDs */
  targets: string[];
  /** Clock offset (ms, positive = ahead, negative = behind) */
  offsetMs: number;
  /** Duration in ms */
  duration?: number;
}
```

## 4. Wire Format Messages

Chaos messages use type codes 0xE0-0xE2 in the Chaos (0xE*) block.

```typescript
enum ChaosMessageType {
  CHAOS_INJECT = 0xE0,
  CHAOS_REMOVE = 0xE1,
  CHAOS_STATUS = 0xE2,
}
```

### 4.1 CHAOS_INJECT (0xE0)

```typescript
interface ChaosInjectMessage extends MessageEnvelope {
  t: 0xE0;
  p: {
    faultId: string;
    spec: FaultSpec;
    expiresAt?: number;
  };
}
```

### 4.2 CHAOS_REMOVE (0xE1)

```typescript
interface ChaosRemoveMessage extends MessageEnvelope {
  t: 0xE1;
  p: {
    faultId: string;
  };
}
```

### 4.3 CHAOS_STATUS (0xE2)

```typescript
interface ChaosStatusMessage extends MessageEnvelope {
  t: 0xE2;
  p: {
    faults: FaultStatus[];
  };
}
```

## 5. Partition Simulation

Network partitions are simulated by intercepting messages at the channel layer (see [channel-abstraction.md](../networking/channel-abstraction.md)):

```typescript
class PartitionInterceptor {
  private partitions: Map<string, PartitionFault> = new Map();

  /** Check if a message should be blocked */
  shouldBlock(fromPod: string, toPod: string): boolean {
    for (const fault of this.partitions.values()) {
      const fromInA = fault.groupA.includes(fromPod);
      const toInB = fault.groupB.includes(toPod);
      const fromInB = fault.groupB.includes(fromPod);
      const toInA = fault.groupA.includes(toPod);

      if (fault.asymmetric) {
        if (fault.allowDirection === 'a-to-b' && fromInB && toInA) return true;
        if (fault.allowDirection === 'b-to-a' && fromInA && toInB) return true;
      } else {
        if ((fromInA && toInB) || (fromInB && toInA)) return true;
      }
    }
    return false;
  }

  /** Wrap a PodChannel with partition awareness */
  wrapChannel(channel: PodChannel, localPodId: string): PodChannel {
    const original = channel.send.bind(channel);
    channel.send = (data: unknown, transfer?: Transferable[]) => {
      const targetPod = extractTargetPod(data);
      if (targetPod && this.shouldBlock(localPodId, targetPod)) {
        return; // Silently drop
      }
      original(data, transfer);
    };
    return channel;
  }
}
```

## 6. Latency Profiles

```typescript
function applyLatency(fault: LatencyFault): number {
  const base = fault.delayMs;
  const jitter = fault.jitterMs ?? 0;

  switch (fault.distribution ?? 'uniform') {
    case 'uniform':
      return base + Math.random() * jitter;

    case 'normal':
      // Box-Muller transform
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.max(0, base + z * (jitter / 3));

    case 'pareto':
      // Heavy tail distribution (models network congestion)
      const alpha = 2;
      const u = Math.random();
      return base + jitter * (1 / Math.pow(u, 1 / alpha) - 1);
  }
}
```

## 7. Test Harness

### 7.1 Scenario DSL

```typescript
interface ChaosScenario {
  name: string;
  description: string;
  setup: ScenarioStep[];
  faults: FaultSpec[];
  assertions: Assertion[];
  teardown?: ScenarioStep[];
  timeout?: number;
}

interface ScenarioStep {
  action: 'create-pod' | 'send-message' | 'wait' | 'assert' | 'inject-fault' | 'remove-fault';
  params: Record<string, unknown>;
}

interface Assertion {
  type: 'pod-state' | 'message-delivered' | 'message-dropped' | 'session-count' | 'presence-state';
  target: string;
  expected: unknown;
  timeout?: number;
}
```

### 7.2 Example Scenario

```typescript
const partitionHealingScenario: ChaosScenario = {
  name: 'partition-healing',
  description: 'Verify state re-sync after network partition heals',
  setup: [
    { action: 'create-pod', params: { name: 'pod-a', kind: 'worker' } },
    { action: 'create-pod', params: { name: 'pod-b', kind: 'worker' } },
    { action: 'send-message', params: { from: 'pod-a', to: 'pod-b', payload: 'pre-partition' } },
    { action: 'wait', params: { ms: 1000 } },
  ],
  faults: [
    {
      type: 'partition',
      groupA: ['pod-a'],
      groupB: ['pod-b'],
      duration: 5000,
    },
  ],
  assertions: [
    {
      type: 'message-dropped',
      target: 'pod-b',
      expected: { from: 'pod-a', during: 'partition' },
      timeout: 6000,
    },
    {
      type: 'pod-state',
      target: 'pod-a',
      expected: { presence: 'online' },
      timeout: 10000,
    },
    {
      type: 'message-delivered',
      target: 'pod-b',
      expected: { from: 'pod-a', payload: 'post-partition' },
      timeout: 15000,
    },
  ],
};
```

### 7.3 Scenario Runner

```typescript
class ChaosRunner {
  private controller: ChaosController;

  async run(scenario: ChaosScenario): Promise<ScenarioResult> {
    const result: ScenarioResult = {
      name: scenario.name,
      passed: true,
      assertions: [],
      duration: 0,
    };

    const start = performance.now();

    try {
      // Setup
      for (const step of scenario.setup) {
        await this.executeStep(step);
      }

      // Inject faults
      const handles: FaultHandle[] = [];
      for (const fault of scenario.faults) {
        handles.push(await this.controller.inject(fault));
      }

      // Run assertions
      for (const assertion of scenario.assertions) {
        const assertResult = await this.checkAssertion(assertion);
        result.assertions.push(assertResult);
        if (!assertResult.passed) result.passed = false;
      }

      // Clean up faults
      for (const handle of handles) {
        if (handle.isActive()) await handle.remove();
      }

      // Teardown
      if (scenario.teardown) {
        for (const step of scenario.teardown) {
          await this.executeStep(step);
        }
      }
    } catch (error) {
      result.passed = false;
      result.error = String(error);
    }

    result.duration = performance.now() - start;
    return result;
  }
}

interface ScenarioResult {
  name: string;
  passed: boolean;
  assertions: AssertionResult[];
  duration: number;
  error?: string;
}

interface AssertionResult {
  type: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
  message?: string;
}
```

## 8. Capability Requirement

Chaos injection requires the `chaos:inject` capability (see [capability-scope-grammar.md](../crypto/capability-scope-grammar.md)):

```
chaos:inject            // Inject any fault type
chaos:inject:partition  // Partition faults only
chaos:inject:latency    // Latency faults only
chaos:status            // Read-only fault status
```

> **Security**: Chaos capabilities must never be granted in production environments. They should only be available in test harnesses and development builds.

## 9. Limits

| Resource | Limit |
|----------|-------|
| Max concurrent faults | 16 |
| Max fault duration | 300 seconds (5 minutes) |
| Max latency injection | 10,000 ms |
| Max drop rate | 1.0 (100%) |
| Max clock skew | 60,000 ms (1 minute) |
| Scenario timeout | 120 seconds |

## 10. In-Memory Testing with LocalChannel

The [test-transport.md](test-transport.md) spec provides `LocalChannel`, an in-memory `PodChannel` implementation that enables chaos testing **without real browsers**. This is the recommended approach for unit tests and CI pipelines.

### LocalChannel ↔ FaultSpec Mapping

`LocalChannelOptions` map directly to chaos `FaultSpec` types:

| LocalChannelOptions | Equivalent FaultSpec | Effect |
|---|---|---|
| `latencyMs` + `jitterMs` | `LatencyFault` | Simulated network delay |
| `dropRate` | `MessageDropFault` | Random message loss |
| `maxQueueSize: 0` | `PartitionFault` | Complete message blocking |
| `reorderRate` | (no direct equivalent) | Out-of-order delivery |

### TestMesh Integration

```typescript
// Create a 4-pod test mesh with fault injection
const mesh = await TestMesh.create(4, { latencyMs: 10 });

// Inject a partition between pods 0-1 and pods 2-3
mesh.injectFault({
  type: 'partition',
  groupA: [mesh.pods[0].id, mesh.pods[1].id],
  groupB: [mesh.pods[2].id, mesh.pods[3].id],
  duration: 5000,
});

// Run chaos scenario against in-memory mesh
const result = await runner.run(partitionHealingScenario);
```

> **Recommendation**: Use `TestMesh` with `LocalChannel` for fast, deterministic chaos tests in CI. Reserve real-browser chaos testing for integration and end-to-end validation.
