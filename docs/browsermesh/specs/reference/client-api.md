# Client API

Public API surface for BrowserMesh client, server, and runtime packages.

**Related specs**: [pod-socket.md](../networking/pod-socket.md) | [message-envelope.md](../networking/message-envelope.md) | [service-model.md](../coordination/service-model.md) | [session-keys.md](../crypto/session-keys.md) | [streaming-protocol.md](../networking/streaming-protocol.md) | [presence-protocol.md](../coordination/presence-protocol.md) | [pubsub-topics.md](../coordination/pubsub-topics.md) | [state-sync.md](../coordination/state-sync.md) | [reactive-signals.md](../coordination/reactive-signals.md) | [message-middleware.md](../networking/message-middleware.md) | [observability.md](../operations/observability.md) | [dht-routing.md](../networking/dht-routing.md)

## 1. Overview

Specs reference `mesh.send()`, `MeshClient`, `@browsermesh/client`, `@browsermesh/server`, and `@browsermesh/runtime` without defining them. This spec defines the public API surface:

- **`@browsermesh/runtime`** — Core runtime: identity, boot, sessions, capabilities
- **`@browsermesh/client`** — Client-side API: connect, send, subscribe, request
- **`@browsermesh/server`** — Server-side API: listen, handle, middleware

## 2. Package Structure

```
@browsermesh/
├── runtime        # Core runtime (identity, sessions, capabilities)
├── client         # Client-side API (connect, send, request)
└── server         # Server-side API (listen, handle, middleware)
```

All three packages share types from `@browsermesh/runtime`.

## 3. MeshRuntime

The runtime is the foundation. It manages identity, boot, session lifecycle, and capabilities.

```typescript
interface MeshRuntime {
  /** Current pod identity */
  readonly identity: PodIdentity;

  /** Current pod ID (SHA-256 of public key) */
  readonly podId: string;

  /** Pod kind */
  readonly kind: PodKind;

  /** Runtime state */
  readonly state: RuntimeState;

  /** Boot the runtime */
  boot(options?: BootOptions): Promise<void>;

  /** Shutdown the runtime */
  shutdown(): Promise<void>;

  /** Get the session manager */
  readonly sessions: SessionManager;

  /** Get the capability manager */
  readonly capabilities: CapabilityManager;

  /** Get the presence manager */
  readonly presence: PresenceManager;

  /** Event emitter */
  on(event: RuntimeEvent, handler: (...args: unknown[]) => void): void;
  off(event: RuntimeEvent, handler: (...args: unknown[]) => void): void;
}

type RuntimeState = 'uninitialized' | 'booting' | 'ready' | 'shutting-down' | 'stopped';

type RuntimeEvent =
  | 'ready'
  | 'shutdown'
  | 'peer:connect'
  | 'peer:disconnect'
  | 'error';

interface BootOptions {
  /** Pod kind override (auto-detected by default) */
  kind?: PodKind;

  /** Custom scope for presence and discovery */
  scope?: string;

  /** Feature flags to advertise */
  features?: number;

  /** Pre-generated identity (for testing or migration) */
  identity?: PodIdentity;
}
```

### Creating a Runtime

```typescript
import { createRuntime } from '@browsermesh/runtime';

const runtime = createRuntime();
await runtime.boot();

console.log(`Pod ID: ${runtime.podId}`);
console.log(`Kind: ${runtime.kind}`);
```

## 4. MeshClient

The client provides the primary API for connecting to peers, sending messages, and subscribing to topics.

```typescript
interface MeshClient {
  /** Underlying runtime */
  readonly runtime: MeshRuntime;

  /** Connect to a specific pod by ID */
  connect(podId: string, options?: ConnectOptions): Promise<MeshConnection>;

  /** Disconnect from a specific pod */
  disconnect(podId: string): Promise<void>;

  /** Send a fire-and-forget message */
  send(target: MessageTarget, payload: unknown): Promise<void>;

  /** Send a request and wait for response */
  request<T = unknown>(
    target: MessageTarget,
    method: string,
    args?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<T>;

  /** Subscribe to a pub/sub topic */
  subscribe(
    pattern: string,
    handler: (msg: TopicMessage) => void,
    options?: SubscribeOptions
  ): Promise<Subscription>;

  /** Register a message handler */
  onMessage(handler: (msg: IncomingMessage) => void): void;

  /** Close all connections and shutdown */
  close(): Promise<void>;
}

interface MessageTarget {
  /** Target a specific pod by ID */
  podId?: string;
  /** Target a service by name */
  service?: string;
  /** Target by required capability */
  capability?: string;
}

interface ConnectOptions {
  /** Connection timeout (ms) */
  timeout?: number;
  /** Attempt session resumption */
  resume?: boolean;
}

interface RequestOptions {
  /** Request timeout (ms) */
  timeout?: number;
  /** Priority */
  priority?: 'low' | 'normal' | 'high';
}

interface SubscribeOptions {
  /** Quality of service: 0 = at-most-once, 1 = at-least-once */
  qos?: 0 | 1;
}

interface Subscription {
  /** Subscription ID */
  readonly id: string;
  /** Topic pattern */
  readonly pattern: string;
  /** Unsubscribe */
  unsubscribe(): Promise<void>;
}

interface MeshConnection {
  /** Remote pod ID */
  readonly peerId: string;
  /** Connection state */
  readonly state: 'connecting' | 'connected' | 'disconnected';
  /** Send a message on this connection */
  send(payload: unknown): Promise<void>;
  /** Request/response on this connection */
  request<T = unknown>(method: string, args?: Record<string, unknown>): Promise<T>;
  /** Open a stream */
  stream(method: string, options?: StreamOptions): Promise<MeshStream>;
  /** Close the connection */
  close(): Promise<void>;
}

interface IncomingMessage {
  /** Sender's pod ID */
  from: string;
  /** Message payload */
  payload: unknown;
  /** Timestamp */
  timestamp: number;
}

interface TopicMessage {
  /** Topic the message was published to */
  topic: string;
  /** Publisher's pod ID */
  publisherId: string;
  /** Message payload */
  payload: unknown;
}
```

### Creating a Client

```typescript
import { createClient } from '@browsermesh/client';

const client = createClient();
await client.runtime.boot();

// Request/response
const result = await client.request(
  { service: 'compute' },
  'compute/run',
  { code: wasmBytes, input: data }
);

// Pub/sub
const sub = await client.subscribe('chat/rooms/general', (msg) => {
  console.log(`${msg.publisherId}: ${msg.payload}`);
});

// Cleanup
await sub.unsubscribe();
await client.close();
```

## 5. MeshServer

The server API is for pods that handle incoming requests and provide services.

```typescript
interface MeshServer {
  /** Underlying runtime */
  readonly runtime: MeshRuntime;

  /** Register a request handler */
  handle(method: string, handler: RequestHandler): void;

  /** Register middleware */
  use(middleware: Middleware): void;

  /** Start listening for requests */
  listen(options?: ListenOptions): Promise<void>;

  /** Stop listening */
  stop(): Promise<void>;

  /** Publish a message to a topic */
  publish(topic: string, payload: unknown, options?: PublishOptions): Promise<void>;
}

type RequestHandler = (
  req: MeshRequest,
  ctx: RequestContext
) => Promise<unknown> | unknown;

interface MeshRequest {
  /** Request ID */
  id: string;
  /** Caller's pod ID */
  from: string;
  /** Operation method */
  method: string;
  /** Operation arguments */
  args: Record<string, unknown>;
}

interface RequestContext {
  /** Caller's capabilities */
  capabilities: string[];
  /** Respond with a stream */
  stream(): MeshStream;
  /** Deadline (ms since epoch) */
  deadline: number;
}

type Middleware = (
  req: MeshRequest,
  ctx: RequestContext,
  next: () => Promise<unknown>
) => Promise<unknown>;

interface ListenOptions {
  /** Service name to register */
  service?: string;
  /** Capabilities to advertise */
  capabilities?: string[];
}

interface PublishOptions {
  /** Quality of service */
  qos?: 0 | 1;
  /** Retain as last-known-good */
  retain?: boolean;
}
```

### Creating a Server

```typescript
import { createServer } from '@browsermesh/server';

const server = createServer();

// Middleware
server.use(async (req, ctx, next) => {
  const start = Date.now();
  const result = await next();
  console.log(`${req.method} took ${Date.now() - start}ms`);
  return result;
});

// Request handler
server.handle('compute/run', async (req, ctx) => {
  const { code, input } = req.args;
  return executeWasm(code, input);
});

await server.listen({
  service: 'compute',
  capabilities: ['compute/run'],
});
```

## 6. Event System

All three packages share a common event system:

```typescript
interface MeshEventEmitter {
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  once(event: string, handler: (...args: unknown[]) => void): void;
}
```

### Events

| Event | Source | Payload |
|-------|--------|---------|
| `ready` | Runtime | `void` |
| `shutdown` | Runtime | `void` |
| `peer:connect` | Runtime | `{ peerId: string }` |
| `peer:disconnect` | Runtime | `{ peerId: string, reason: string }` |
| `message` | Client | `IncomingMessage` |
| `request` | Server | `MeshRequest` |
| `stream` | Client/Server | `MeshStream` |
| `error` | All | `Error` |

## 7. Configuration and Builder Pattern

```typescript
interface MeshConfig {
  /** Custom identity (otherwise auto-generated) */
  identity?: PodIdentity;

  /** Discovery scope */
  scope?: string;

  /** Feature flags */
  features?: number;

  /** Timeouts */
  timeouts?: {
    handshake?: number;
    request?: number;
    discovery?: number;
  };

  /** Session resumption */
  resumption?: {
    enabled?: boolean;
    ticketLifetime?: number;
  };
}

// Builder pattern
const client = createClient({
  scope: 'my-app',
  features: FeatureFlag.STREAMING | FeatureFlag.PUBSUB,
  timeouts: { request: 10_000 },
  resumption: { enabled: true },
});
```

## 8. TypeScript Type Exports

```typescript
// @browsermesh/runtime
export type {
  MeshRuntime,
  PodIdentity,
  PodKind,
  BootOptions,
  RuntimeState,
  RuntimeEvent,
  MeshConfig,
  CapabilityManager,
  SessionManager,
  PresenceManager,
};

// @browsermesh/client
export type {
  MeshClient,
  MeshConnection,
  MessageTarget,
  ConnectOptions,
  RequestOptions,
  SubscribeOptions,
  Subscription,
  IncomingMessage,
  TopicMessage,
  MeshStream,
  StreamOptions,
};

// @browsermesh/server
export type {
  MeshServer,
  RequestHandler,
  MeshRequest,
  RequestContext,
  Middleware,
  ListenOptions,
  PublishOptions,
};
```

## 9. Quick-Start Examples

### Chat Application

```typescript
import { createClient } from '@browsermesh/client';

const chat = createClient({ scope: 'chat-app' });
await chat.runtime.boot();

// Subscribe to messages
await chat.subscribe('chat/rooms/general', (msg) => {
  displayMessage(msg.publisherId, msg.payload);
});

// Send a message
sendButton.onclick = () => {
  chat.send(
    { service: 'chat' },
    { text: input.value, room: 'general' }
  );
};
```

### Compute Service

```typescript
import { createServer } from '@browsermesh/server';

const compute = createServer();

compute.handle('compute/run', async (req) => {
  const { module, input } = req.args;
  const wasm = await WebAssembly.instantiate(module);
  return wasm.exports.run(input);
});

await compute.listen({
  service: 'compute',
  capabilities: ['compute/run'],
});
```

### State Synchronization

```typescript
import { createClient } from '@browsermesh/client';

const client = createClient();
await client.runtime.boot();

// Request current state
const state = await client.request(
  { service: 'state-sync' },
  'sync/subscribe',
  { documentId: 'shared-doc' }
);

// Listen for updates
await client.subscribe('sync/shared-doc', (msg) => {
  applyDelta(msg.payload);
});
```

## 10. Extended API Surface

### 10.1 Reactive Signals

Lightweight reactive state primitives (see [reactive-signals.md](../coordination/reactive-signals.md)):

```typescript
interface MeshClient {
  /** Create a reactive signal owned by this pod */
  signal<T>(name: string, initialValue: T): MeshSignal<T>;

  /** Create a computed signal derived from other signals */
  computed<T>(computation: () => T): MeshComputed<T>;

  /** Create a side-effect that re-runs on dependency change */
  effect(fn: () => void | (() => void)): MeshEffect;
}
```

### 10.2 Message Middleware

Composable transform pipeline (see [message-middleware.md](../networking/message-middleware.md)):

```typescript
interface MeshServer {
  /** Add a message middleware to the processing pipeline */
  useMiddleware(middleware: MessageMiddleware): void;
}

interface MeshClient {
  /** Add a message middleware to the processing pipeline */
  useMiddleware(middleware: MessageMiddleware): void;
}
```

### 10.3 Traffic Capture

HAR-based traffic recording and replay (see [observability.md](../operations/observability.md) Section 11):

```typescript
interface MeshRuntime {
  /** Traffic recorder for HAR capture */
  readonly recorder: TrafficRecorder;
}
```

### 10.4 DHT Routing

Proximity-based peer discovery (see [dht-routing.md](../networking/dht-routing.md)):

```typescript
interface MeshRuntime {
  /** DHT routing table for proximity-based discovery */
  readonly dht: DhtRoutingTable;
}
```
