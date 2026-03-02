# Pub/Sub Topics

Topic-based publish/subscribe messaging for BrowserMesh.

**Related specs**: [wire-format.md](../core/wire-format.md) | [message-envelope.md](../networking/message-envelope.md) | [streaming-protocol.md](../networking/streaming-protocol.md) | [capability-scope-grammar.md](../crypto/capability-scope-grammar.md) | [channel-abstraction.md](../networking/channel-abstraction.md)

## 1. Overview

All BrowserMesh messaging is point-to-point or BroadcastChannel multicast. This spec adds pub/sub with topic filtering:

- Hierarchical topic naming with slash delimiters
- Wildcard matching (single-level and multi-level)
- Configurable delivery guarantees
- Topic-scoped capability authorization
- BroadcastChannel optimization for same-origin subscribers

## 2. Topic Naming

Topics use a hierarchical slash-delimited namespace:

```
chat/rooms/general
sensors/temperature/floor-3
app/state/user/123
```

### Rules

| Rule | Example | Valid |
|------|---------|-------|
| Slash-delimited segments | `a/b/c` | Yes |
| Non-empty segments | `a//b` | No |
| No leading/trailing slash | `/a/b/` | No |
| Alphanumeric + hyphen + underscore | `my-topic/sub_1` | Yes |
| Max depth 8 segments | `a/b/c/d/e/f/g/h` | Yes |
| Max segment length 64 chars | — | — |

```typescript
const TOPIC_REGEX = /^[a-zA-Z0-9_-]{1,64}(\/[a-zA-Z0-9_-]{1,64}){0,7}$/;

function isValidTopic(topic: string): boolean {
  return TOPIC_REGEX.test(topic);
}
```

## 3. Topic Matching

### 3.1 Exact Match

Subscription to `chat/rooms/general` only matches that exact topic.

### 3.2 Single-Level Wildcard (`+`)

The `+` wildcard matches exactly one segment at the position it occupies.

| Pattern | Matches | Doesn't Match |
|---------|---------|---------------|
| `chat/rooms/+` | `chat/rooms/general`, `chat/rooms/dev` | `chat/rooms/a/b` |
| `sensors/+/temperature` | `sensors/floor1/temperature` | `sensors/temperature` |

### 3.3 Multi-Level Wildcard (`#`)

The `#` wildcard matches zero or more trailing segments. It must be the last segment.

| Pattern | Matches |
|---------|---------|
| `chat/#` | `chat`, `chat/rooms`, `chat/rooms/general` |
| `sensors/temperature/#` | `sensors/temperature`, `sensors/temperature/floor-3` |

```typescript
function topicMatches(pattern: string, topic: string): boolean {
  const patternParts = pattern.split('/');
  const topicParts = topic.split('/');

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] === '#') {
      return true;  // Matches rest
    }
    if (i >= topicParts.length) {
      return false;  // Topic too short
    }
    if (patternParts[i] !== '+' && patternParts[i] !== topicParts[i]) {
      return false;  // Segment mismatch
    }
  }

  return patternParts.length === topicParts.length;
}
```

## 4. Wire Format Messages

Pub/sub messages use type codes 0x90-0x95 in the PubSub (0x9*) block.

```typescript
enum PubSubMessageType {
  SUBSCRIBE     = 0x90,
  UNSUBSCRIBE   = 0x91,
  PUBLISH       = 0x92,
  MESSAGE       = 0x93,
  SUB_ACK       = 0x94,
  UNSUB_ACK     = 0x95,
}
```

### 4.1 SUBSCRIBE (0x90)

```typescript
interface SubscribeMessage extends MessageEnvelope {
  t: 0x90;
  p: {
    subscriptionId: string;      // Client-chosen unique ID
    pattern: string;             // Topic pattern (may include wildcards)
    qos: QualityOfService;       // Delivery guarantee
  };
}
```

### 4.2 UNSUBSCRIBE (0x91)

```typescript
interface UnsubscribeMessage extends MessageEnvelope {
  t: 0x91;
  p: {
    subscriptionId: string;
  };
}
```

### 4.3 PUBLISH (0x92)

```typescript
interface PublishMessage extends MessageEnvelope {
  t: 0x92;
  p: {
    topic: string;               // Exact topic (no wildcards)
    payload: unknown;            // CBOR-encodable data
    qos: QualityOfService;
    retain?: boolean;            // Store as last-known-good for new subscribers
    dedup?: string;              // Idempotency key for at-least-once
  };
}
```

### 4.4 MESSAGE (0x93)

Delivered to subscribers matching the topic pattern.

```typescript
interface TopicMessage extends MessageEnvelope {
  t: 0x93;
  p: {
    subscriptionId: string;      // Which subscription matched
    topic: string;               // Actual topic published to
    payload: unknown;
    publisherId: Uint8Array;     // Pod ID of the publisher
    messageId: string;           // For deduplication (at-least-once)
  };
}
```

### 4.5 SUB_ACK / UNSUB_ACK (0x94, 0x95)

```typescript
interface SubAckMessage extends MessageEnvelope {
  t: 0x94;
  p: {
    subscriptionId: string;
    success: boolean;
    error?: string;
  };
}

interface UnsubAckMessage extends MessageEnvelope {
  t: 0x95;
  p: {
    subscriptionId: string;
    success: boolean;
  };
}
```

## 5. Delivery Guarantees

```typescript
type QualityOfService = 0 | 1;
```

| QoS | Name | Behavior |
|-----|------|----------|
| 0 | At-most-once | Fire and forget. No ack, no retry. |
| 1 | At-least-once | Publisher retries until MESSAGE_ACK received. Receiver deduplicates by `messageId`. |

> **Design note**: QoS 2 (exactly-once) is omitted. Exactly-once requires distributed transactions, which conflicts with BrowserMesh's lightweight design. Applications that need exactly-once should use idempotency keys in their application protocol.

## 6. Topic Router

The topic router maintains subscription state and dispatches incoming publishes to matching subscribers.

```typescript
class TopicRouter {
  private subscriptions: Map<string, Subscription> = new Map();
  private retained: Map<string, PublishMessage> = new Map();

  subscribe(sub: SubscribeMessage, senderId: string): void {
    this.subscriptions.set(sub.p.subscriptionId, {
      id: sub.p.subscriptionId,
      pattern: sub.p.pattern,
      subscriberId: senderId,
      qos: sub.p.qos,
      createdAt: Date.now(),
    });

    // Deliver retained message if exists
    for (const [topic, msg] of this.retained) {
      if (topicMatches(sub.p.pattern, topic)) {
        this.deliver(sub.p.subscriptionId, senderId, msg);
      }
    }
  }

  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  publish(msg: PublishMessage): void {
    // Store retained
    if (msg.p.retain) {
      this.retained.set(msg.p.topic, msg);
    }

    // Match and deliver
    for (const [id, sub] of this.subscriptions) {
      if (topicMatches(sub.pattern, msg.p.topic)) {
        this.deliver(id, sub.subscriberId, msg);
      }
    }
  }

  private deliver(
    subscriptionId: string,
    subscriberId: string,
    msg: PublishMessage
  ): void {
    // Route MESSAGE to subscriber via session
  }
}

interface Subscription {
  id: string;
  pattern: string;
  subscriberId: string;
  qos: QualityOfService;
  createdAt: number;
}
```

## 7. AsyncIterator Consumer API

Subscriptions implement `Symbol.asyncIterator` for ergonomic consumption via `for await...of`.

### 7.1 TopicIterator

```typescript
interface TopicIterator<T = unknown> extends AsyncIterableIterator<TopicMessage<T>> {
  /** Cancel the iterator and unsubscribe */
  return(): Promise<IteratorResult<TopicMessage<T>>>;
}

class TopicIteratorImpl<T> implements TopicIterator<T> {
  private buffer: TopicMessage<T>[] = [];
  private resolve?: (result: IteratorResult<TopicMessage<T>>) => void;
  private done = false;
  private maxCredit: number;

  constructor(
    private subscription: Subscription,
    options: { maxCredit?: number } = {}
  ) {
    this.maxCredit = options.maxCredit ?? 64;

    // Wire subscription handler to feed the buffer
    subscription.onMessage((msg: TopicMessage<T>) => {
      if (this.resolve) {
        this.resolve({ value: msg, done: false });
        this.resolve = undefined;
      } else if (this.buffer.length < this.maxCredit) {
        this.buffer.push(msg);
      }
      // If buffer full, apply backpressure (drop with QoS 0, or pause with QoS 1)
    });
  }

  async next(): Promise<IteratorResult<TopicMessage<T>>> {
    if (this.done) return { value: undefined, done: true };

    if (this.buffer.length > 0) {
      return { value: this.buffer.shift()!, done: false };
    }

    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  async return(): Promise<IteratorResult<TopicMessage<T>>> {
    this.done = true;
    await this.subscription.unsubscribe();
    if (this.resolve) {
      this.resolve({ value: undefined, done: true });
    }
    return { value: undefined, done: true };
  }

  [Symbol.asyncIterator](): TopicIterator<T> {
    return this;
  }
}
```

### 7.2 Usage

```typescript
const sub = await client.subscribe('sensors/temperature/#', { qos: 0 });

// Consume as async iterator
for await (const msg of sub) {
  console.log(`${msg.topic}: ${msg.payload}`);
  if (shouldStop) break;  // Automatically unsubscribes
}
```

### 7.3 Credit-Based Backpressure

The iterator maintains a credit window (`maxCredit`) that maps to QoS behavior:

| QoS | Buffer Full Behavior |
|-----|---------------------|
| 0 (at-most-once) | Newest messages dropped silently |
| 1 (at-least-once) | Consumer pauses until credit available; publisher retries |

### 7.4 Fork Pattern

`sub.fork()` returns an independent iterator that receives a copy of every message. Useful for one-to-many fan-out from a single subscription:

```typescript
interface ForkableSubscription extends Subscription {
  /** Create an independent iterator fork */
  fork(): TopicIterator;
}

// Example: fan-out to logger and UI
const sub = await client.subscribe('chat/rooms/general');
const logFork = sub.fork();
const uiFork = sub.fork();

// Each fork receives all messages independently
(async () => {
  for await (const msg of logFork) {
    appendToLog(msg);
  }
})();

(async () => {
  for await (const msg of uiFork) {
    renderMessage(msg);
  }
})();
```

## 8. BroadcastChannel Optimization (same-origin)

For same-origin pods, pub/sub can be optimized using BroadcastChannel (see [channel-abstraction.md](../networking/channel-abstraction.md)):

```typescript
const PUBSUB_BC_PREFIX = 'pod:pubsub:';

/**
 * For exact topic subscriptions within same origin,
 * use a dedicated BroadcastChannel per topic.
 * This avoids routing through a central broker.
 */
function getSameOriginChannel(topic: string): BroadcastChannel {
  return new BroadcastChannel(`${PUBSUB_BC_PREFIX}${topic}`);
}
```

The optimization applies when:
- Subscriber and publisher are same-origin
- Subscription pattern is exact (no wildcards)
- QoS is 0 (at-most-once)

For wildcard patterns or cross-origin, messages route through the normal mesh session layer.

## 9. Topic-Scoped Capabilities

Publishing and subscribing require topic-scoped capabilities (see [capability-scope-grammar.md](../crypto/capability-scope-grammar.md)):

```
pubsub:subscribe:chat/rooms/*
pubsub:publish:chat/rooms/general
pubsub:subscribe:sensors/#
```

### Scope Format

```
pubsub:{action}:{topic_pattern}
```

| Action | Description |
|--------|-------------|
| `subscribe` | Subscribe to matching topics |
| `publish` | Publish to matching topics |
| `admin` | Create/delete topics, view all subscriptions |

```typescript
function checkPubSubCapability(
  caps: string[],
  action: 'subscribe' | 'publish' | 'admin',
  topic: string
): boolean {
  for (const cap of caps) {
    const match = cap.match(/^pubsub:(\w+):(.+)$/);
    if (!match) continue;

    const [, capAction, capPattern] = match;
    if (capAction !== action && capAction !== 'admin') continue;
    if (topicMatches(capPattern, topic)) return true;
  }
  return false;
}
```

## 10. Limits

| Resource | Limit |
|----------|-------|
| Max topic depth | 8 segments |
| Max segment length | 64 characters |
| Max subscriptions per pod | 256 |
| Max retained messages | 1000 |
| Retained message TTL | 1 hour |
| Max publish payload | 63 KB (wire-format limit) |
| Dedup window (at-least-once) | 60 seconds |
