# BrowserMesh Reference Implementation

> **Implementation Status**: This document describes the target `@browsermesh/*` package API.
> The current Clawser implementation uses equivalent JS modules in `web/` (not TypeScript packages).
> Entrypoints like `installPodRuntime()` are provided via `web/packages/pod/src/runtime.mjs`.
> Wire codes are consolidated in `web/packages/mesh-primitives/src/constants.mjs`.
> Status markers: **implemented** = code exists and is wired, **partial** = code exists but not fully integrated, **doc-only** = API defined here but not yet implemented.

## 1. Package Structure

```
@browsermesh/
├── core/                 # Core runtime and types
├── crypto/               # Ed25519, X25519, HKDF utilities
├── routing/              # Discovery and routing table
├── transport/            # Channel implementations
├── bridge/               # Server connection layer
├── federation/           # Cross-origin and WebRTC mesh
├── storage/              # Content-addressed storage (IPFS/Storacha)
├── compute/              # WASM execution and job routing
├── runtime/              # Unified pod runtime
└── cli/                  # Development tools
```

---

## 2. Module Breakdown

### 2.1 @browsermesh/core

The foundational types and interfaces.

```
core/
├── index.ts              # Public exports
├── types/
│   ├── pod.ts            # PodIdentity, PodKind, PodCapabilities
│   ├── envelope.ts       # MeshEnvelope, MessageType
│   ├── channel.ts        # ChannelType, ChannelInfo
│   └── errors.ts         # Error types and codes
├── cbor.ts               # CBOR encode/decode wrapper
├── base64url.ts          # URL-safe base64 utilities
└── events.ts             # Typed event emitter
```

**Key Exports:**

```typescript
// types/pod.ts
export interface PodIdentity {
  id: string;
  publicKey: Uint8Array;
  slotId?: number;
  slotName?: string;
  kind: PodKind;
  origin: string;
  createdAt: number;
}

export type PodKind =
  | 'window'
  | 'spawned'
  | 'frame'
  | 'worker'
  | 'shared-worker'
  | 'service-worker'
  | 'worklet';

export interface PodCapabilities {
  postMessage: boolean;
  messagePort: boolean;
  broadcastChannel: boolean | 'same-origin';
  sharedWorkerPorts: boolean;
  serviceWorkerMessaging: boolean;
  fetch: boolean;
  webSocket: boolean;
  webTransport: boolean;
  webRTC: { dataChannel: boolean; requiresSignaling: boolean };
  sharedArrayBuffer: { enabled: boolean; requires?: string[] };
  storage: { indexedDB: boolean; cacheAPI: boolean; opfs: boolean; localStorage: boolean };
  crypto: { ed25519: boolean; x25519: boolean; webCrypto: boolean };
}

// types/envelope.ts
export interface MeshEnvelope {
  v: 1;
  id: string;
  type: MessageType;
  from: string;
  to?: string;
  ts: number;
  route?: { hops: string[]; ttl: number };
  sig?: Uint8Array;
  enc?: { alg: string; nonce: Uint8Array; ephemeralKey?: Uint8Array };
  payload: Uint8Array;
}

export type MessageType =
  | 'hello' | 'ack' | 'upgrade'
  | 'request' | 'response'
  | 'stream-start' | 'stream-data' | 'stream-end'
  | 'error';
```

### 2.2 @browsermesh/crypto

Cryptographic primitives using Web Crypto API.

```
crypto/
├── index.ts
├── keys.ts               # Key generation and export
├── derivation.ts         # HKDF-based key derivation
├── signing.ts            # Ed25519 sign/verify
├── encryption.ts         # X25519 + AES-GCM
└── handshake.ts          # Cryptographic handshake protocol
```

**Key Exports:**

```typescript
// keys.ts
export async function generatePodKeyPair(): Promise<CryptoKeyPair>;
export async function exportPublicKey(keyPair: CryptoKeyPair): Promise<Uint8Array>;
export async function exportPrivateKey(keyPair: CryptoKeyPair): Promise<Uint8Array>;
export async function importPublicKey(bytes: Uint8Array): Promise<CryptoKey>;
export async function derivePodId(publicKey: Uint8Array): Promise<string>;

// derivation.ts
export interface DerivedKey {
  path: string;
  keyPair: CryptoKeyPair;
  id: string;
  parentId: string;
}
export async function deriveChildKey(parentSeed: Uint8Array, path: string): Promise<DerivedKey>;

// signing.ts
export async function sign(data: Uint8Array, privateKey: CryptoKey): Promise<Uint8Array>;
export async function verify(
  data: Uint8Array,
  signature: Uint8Array,
  publicKey: CryptoKey
): Promise<boolean>;

// encryption.ts
export interface EncryptedMessage {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}
export async function deriveSharedSecret(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<Uint8Array>;
export async function encrypt(
  plaintext: Uint8Array,
  sharedSecret: Uint8Array
): Promise<EncryptedMessage>;
export async function decrypt(
  encrypted: EncryptedMessage,
  sharedSecret: Uint8Array
): Promise<Uint8Array>;

// handshake.ts
export class HandshakeSession {
  state: 'idle' | 'hello_sent' | 'upgrading' | 'secured' | 'failed';
  async initiate(): Promise<HandshakeHello>;
  async respond(hello: HandshakeHello): Promise<HandshakeAck>;
  async handleAck(ack: HandshakeAck): Promise<UpgradeRequest>;
  async finalize(): Promise<SecureChannel>;
}
```

### 2.3 @browsermesh/routing

Discovery and message routing.

```
routing/
├── index.ts
├── discovery/
│   ├── broadcast-channel.ts
│   ├── shared-worker.ts
│   └── service-worker.ts
├── table.ts              # RoutingTable implementation
├── router.ts             # Message routing logic
├── heartbeat.ts          # Presence management
└── coordinator.ts        # SharedWorker coordinator
```

**Key Exports:**

```typescript
// table.ts
export class RoutingTable {
  upsert(podId: string, info: Partial<RoutingEntry>): void;
  resolve(podId: string): RoutingEntry | null;
  byOrigin(origin: string): RoutingEntry[];
  gc(): string[];
  entries(): IterableIterator<[string, RoutingEntry]>;
}

// router.ts
export class MeshRouter {
  constructor(table: RoutingTable);
  async route(envelope: MeshEnvelope): Promise<void>;
  async broadcast(envelope: MeshEnvelope, options: BroadcastOptions): Promise<void>;
}

// discovery/broadcast-channel.ts
export class BroadcastChannelDiscovery {
  constructor(channelName: string);
  announce(identity: PodIdentity, capabilities: PodCapabilities): void;
  onPeerDiscovered(callback: (peer: PeerInfo) => void): void;
  close(): void;
}

// coordinator.ts (runs in SharedWorker)
export class MeshCoordinator {
  onConnect(port: MessagePort): void;
  getPods(): ConnectedPod[];
  relay(message: RelayMessage): void;
}
```

### 2.4 @browsermesh/transport

Channel implementations.

```
transport/
├── index.ts
├── base.ts               # Abstract transport class
├── post-message.ts       # postMessage wrapper
├── message-port.ts       # MessageChannel/MessagePort
├── broadcast.ts          # BroadcastChannel
├── shared-worker-port.ts # SharedWorker port
├── service-worker.ts     # SW client messaging
├── websocket.ts          # WebSocket transport
├── webtransport.ts       # WebTransport (with Safari check)
├── webrtc.ts             # RTCDataChannel
└── shared-memory.ts      # SharedArrayBuffer (experimental)
```

**Key Exports:**

```typescript
// base.ts
export abstract class Transport {
  abstract readonly type: ChannelType;
  abstract readonly state: 'connecting' | 'open' | 'closing' | 'closed';
  abstract send(data: Uint8Array): Promise<void>;
  abstract close(): Promise<void>;
  abstract onMessage(callback: (data: Uint8Array) => void): void;
  abstract onClose(callback: () => void): void;
}

// Factory function
export function createTransport(
  type: ChannelType,
  options: TransportOptions
): Transport;

// Browser capability check
export function isWebTransportSupported(): boolean {
  return 'WebTransport' in globalThis;
}
```

### 2.5 @browsermesh/bridge

Server connection layer.

```
bridge/
├── index.ts
├── webtransport-bridge.ts
├── websocket-bridge.ts
├── multiplexer.ts        # WebSocket stream multiplexing
├── rpc-client.ts
├── rpc-server.ts
├── reconnection.ts       # Exponential backoff
└── resilient-bridge.ts   # Auto-reconnecting wrapper
```

**Key Exports:**

```typescript
// index.ts
export class Bridge {
  constructor(config: BridgeConfig);
  async connect(): Promise<void>;
  async disconnect(): Promise<void>;

  // Stream management
  async openStream(type: StreamType): Promise<StreamContext>;

  // RPC
  readonly rpc: RpcClient;

  // Events
  on(event: 'connected', callback: () => void): void;
  on(event: 'disconnected', callback: () => void): void;
  on(event: 'error', callback: (error: Error) => void): void;
}

// rpc-client.ts
export class RpcClient {
  async call<T>(method: string, args: unknown, options?: RpcOptions): Promise<T>;
}

// rpc-server.ts
export class RpcServer {
  register(method: string, handler: RpcHandler): void;
  unregister(method: string): void;
}
```

### 2.6 @browsermesh/federation

Cross-origin and multi-device support.

```
federation/
├── index.ts
├── cross-origin/
│   ├── bridge.ts         # postMessage cross-origin
│   ├── trust.ts          # Trust configuration
│   └── validator.ts      # Origin validation
├── webrtc/
│   ├── peer.ts           # RTCPeerConnection wrapper
│   ├── mesh.ts           # Full mesh topology
│   ├── signaling.ts      # Signaling protocol
│   └── stats.ts          # Connection monitoring
└── registry.ts           # Federated pod registry
```

**Key Exports:**

```typescript
// cross-origin/bridge.ts
export class CrossOriginBridge {
  constructor(config: FederationConfig);
  async sendToOrigin(origin: string, podId: string, request: FederateRequest): Promise<FederateResponse>;
  onRequest(callback: (origin: string, request: FederateRequest) => void): void;
}

// webrtc/mesh.ts
export class DeviceMesh extends EventEmitter {
  constructor(signaling: SignalingChannel, iceServers: RTCIceServer[]);
  broadcast(envelope: MeshEnvelope): void;
  sendTo(deviceId: string, envelope: MeshEnvelope): boolean;
  getConnectedDevices(): string[];

  on(event: 'device:connected', callback: (deviceId: string) => void): void;
  on(event: 'device:disconnected', callback: (deviceId: string) => void): void;
  on(event: 'message', callback: (data: { from: string; envelope: MeshEnvelope }) => void): void;
}

// registry.ts
export class FederatedRegistry {
  register(pod: FederatedPod): void;
  unregister(podId: string): void;
  findPod(podId: string): FederatedPod | undefined;
  findByDevice(deviceId: string): FederatedPod[];
  findByCapability(capability: keyof PodCapabilities): FederatedPod[];
}
```

### 2.7 @browsermesh/runtime

Unified pod runtime that ties everything together.

```
runtime/
├── index.ts
├── pod.ts                # Main Pod class
├── boot.ts               # Boot sequence
├── context.ts            # Execution context detection
├── install.ts            # Runtime installation
└── config.ts             # Configuration schema
```

**Key Exports:**

```typescript
// install.ts
export async function installPodRuntime(
  context: typeof globalThis,
  config?: Partial<PodConfig>
): Promise<Pod>;

// pod.ts
export class Pod extends EventEmitter {
  readonly id: string;
  readonly publicKey: Uint8Array;
  readonly kind: PodKind;
  readonly origin: string;
  readonly capabilities: PodCapabilities;
  readonly state: PodState;

  // Peer management
  readonly peers: ReadonlyMap<string, PeerInfo>;

  // Messaging
  async send(to: string, payload: unknown): Promise<void>;
  async request<T>(to: string, method: string, args: unknown): Promise<T>;
  broadcast(payload: unknown): void;

  // Request handling
  handle(method: string, handler: RequestHandler): void;

  // Streams
  async openStream(to: string): Promise<MeshStream>;
  onStream(callback: (stream: MeshStream) => void): void;

  // Lifecycle
  async shutdown(): Promise<void>;

  // Events
  on(event: 'peer:discovered', callback: (peer: PeerInfo) => void): void;
  on(event: 'peer:verified', callback: (peer: PeerInfo) => void): void;
  on(event: 'peer:lost', callback: (podId: string) => void): void;
  on(event: 'message', callback: (envelope: MeshEnvelope) => void): void;
  on(event: 'ready', callback: () => void): void;
  on(event: 'error', callback: (error: Error) => void): void;
}

// config.ts
export interface PodConfig {
  // Identity
  keyPair?: CryptoKeyPair;
  deriveFrom?: { seed: Uint8Array; path: string };

  // Discovery
  discovery?: {
    broadcastChannel?: boolean | string;
    sharedWorker?: boolean | string;
    serviceWorker?: boolean;
  };

  // Bridge
  bridge?: {
    url?: string;
    autoConnect?: boolean;
    reconnect?: boolean;
  };

  // Federation
  federation?: {
    trustedOrigins?: OriginTrustConfig[];
    announceToAll?: boolean;
    webrtc?: {
      enabled?: boolean;
      iceServers?: RTCIceServer[];
    };
  };
}
```

### 2.8 @browsermesh/storage

Content-addressed storage integration with IPFS/Storacha.

```
storage/
├── index.ts
├── cid.ts                # Content identifier utilities
├── manifest.ts           # Module/bundle manifests
├── gateway.ts            # HTTP gateway client
├── storacha.ts           # Storacha/Web3.Storage integration
└── cache.ts              # Local CID cache
```

**Key Exports:**

```typescript
// manifest.ts
export interface ModuleManifest {
  name: string;
  version: string;
  wasm?: string;           // CID of WASM binary
  js?: string;             // CID of JS bundle
  schema?: string;         // CID of interface schema
  config?: string;         // CID of default config
  capabilities: string[];
}

// storacha.ts
export class StorachaClient {
  constructor(config: StorachaConfig);

  async upload(data: Uint8Array): Promise<string>;  // Returns CID
  async fetch(cid: string): Promise<Uint8Array>;
  async pin(cid: string): Promise<void>;

  // Delegation using HD-derived keys
  async createDelegation(
    path: string,
    constraints: DelegationConstraints
  ): Promise<DelegationToken>;
}

// gateway.ts
export async function fetchFromGateway(
  cid: string,
  options?: GatewayOptions
): Promise<Uint8Array>;

// Cache hierarchy
export class StorageCache {
  // L1: In-memory (per pod)
  // L2: IndexedDB/OPFS (per origin)
  // L3: Gateway/Storacha (global)

  async get(cid: string): Promise<Uint8Array | null>;
  async put(cid: string, data: Uint8Array): Promise<void>;
}
```

**Content-Addressed Artifacts:**

```typescript
// Example: Deploy a WASM module via CID
const manifest: ModuleManifest = {
  name: 'image-resizer',
  version: '1.2.3',
  wasm: 'bafybeigdyrzt...',       // Immutable, content-addressed
  schema: 'bafkreigh2akisc...',
  capabilities: ['compute/wasm', 'image/resize'],
};

// Pods resolve by name, fetch by CID
const wasmBytes = await storage.fetch(manifest.wasm);
```

### 2.9 @browsermesh/compute

WASM execution engine and job routing.

```
compute/
├── index.ts
├── executor.ts           # WASM/JS execution sandbox
├── router.ts             # Job routing decisions
├── job.ts                # Job lifecycle management
└── metrics.ts            # Execution metrics
```

**Key Exports:**

```typescript
// job.ts
export interface ComputeJob {
  id: string;
  manifest: ModuleManifest;
  input: Uint8Array;
  constraints: ComputeConstraints;
  status: JobStatus;
  result?: ComputeResult;
}

export type JobStatus =
  | 'queued'
  | 'routing'
  | 'executing'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled';

// executor.ts
export class WasmExecutor {
  constructor(config: ExecutorConfig);

  async execute(job: ComputeJob): Promise<ComputeResult>;
  async stream(job: ComputeJob): AsyncGenerator<ProgressEvent>;
  cancel(jobId: string): void;
}

// router.ts
export class ComputeRouter {
  constructor(routingTable: RoutingTable, policy: RoutingPolicy);

  async route(job: ComputeJob): Promise<RoutingEntry>;

  // Routing heuristics
  private scoreCandidate(
    job: ComputeJob,
    candidate: RoutingEntry
  ): number {
    let score = 0;

    // Prefer server pods for heavy compute
    if (job.constraints.prefer === 'server' && candidate.kind === 'server') {
      score += 100;
    }

    // Prefer pods with cached module
    if (candidate.cachedModules?.includes(job.manifest.wasm)) {
      score += 50;
    }

    // Prefer lower load
    score += (1 - candidate.load) * 25;

    // Prefer lower latency
    score += Math.max(0, 25 - candidate.latency / 10);

    return score;
  }
}
```

### 2.7 @browsermesh/manifest

Manifest and artifact system for Docker-like deployments without Docker.

```typescript
// Manifest structure (content-addressed)
export interface ModuleManifest {
  // Identity
  name: string;                     // e.g., 'image-resizer'
  version: string;                  // semver
  manifestCid: string;              // CID of this manifest

  // Code artifacts (CIDs)
  artifacts: {
    wasm?: string;                  // CID of WASM binary
    js?: string;                    // CID of JS bundle
    assets?: string;                // CID of asset directory
  };

  // Interface
  schema: {
    cid: string;                    // CID of schema definition
    version: string;                // Schema version
  };

  // Capabilities required
  capabilities: {
    required: string[];             // Must have
    optional: string[];             // Nice to have
  };

  // Runtime hints
  runtime: {
    minMemory?: number;             // bytes
    preferredEnvironment?: ('browser' | 'server')[];
    maxConcurrency?: number;
  };

  // Signatures
  signatures: {
    author: Uint8Array;             // Author's signature
    auditors?: Uint8Array[];        // Third-party audit signatures
  };
}

// Manifest operations
export class ManifestRegistry {
  private cache: Map<string, ModuleManifest> = new Map();

  // Fetch and verify manifest
  async fetch(cid: string): Promise<ModuleManifest> {
    // Check cache
    const cached = this.cache.get(cid);
    if (cached) return cached;

    // Fetch from storage
    const bytes = await storage.get(cid);
    const manifest = cbor.decode(bytes) as ModuleManifest;

    // Verify CID matches content
    const computedCid = await computeCid(bytes);
    if (computedCid !== cid) {
      throw new Error('Manifest CID mismatch');
    }

    // Verify signatures
    await this.verifySignatures(manifest);

    this.cache.set(cid, manifest);
    return manifest;
  }

  // Publish new manifest
  async publish(manifest: Omit<ModuleManifest, 'manifestCid'>): Promise<string> {
    // Compute CID
    const bytes = cbor.encode(manifest);
    const cid = await computeCid(bytes);

    // Store
    await storage.put(cid, bytes);

    return cid;
  }
}

// Reproducible bundle builder
export interface BundleConfig {
  entryPoint: string;
  target: 'browser' | 'server' | 'universal';
  format: 'esm' | 'cjs';
  minify: boolean;
  sourceMaps: boolean;
}

export async function buildBundle(
  config: BundleConfig
): Promise<{ js: string; wasm?: string; manifest: ModuleManifest }> {
  // Build JS bundle
  const jsBundle = await bundler.build(config);
  const jsCid = await storage.put(jsBundle);

  // Build WASM if applicable
  let wasmCid: string | undefined;
  if (config.hasWasm) {
    const wasmBundle = await wasmPack.build(config);
    wasmCid = await storage.put(wasmBundle);
  }

  // Create manifest
  const manifest: ModuleManifest = {
    name: config.name,
    version: config.version,
    manifestCid: '', // Will be set
    artifacts: {
      js: jsCid,
      wasm: wasmCid,
    },
    // ... other fields
  };

  const manifestCid = await registry.publish(manifest);
  manifest.manifestCid = manifestCid;

  return { js: jsCid, wasm: wasmCid, manifest };
}
```

### 2.8 @browsermesh/schema

Schema and interface definition for evolvable protocols.

```typescript
// Schema definition (protobuf-like, but lighter)
export interface Schema {
  name: string;
  version: string;
  cid: string;

  // Message types
  messages: Record<string, MessageType>;

  // Service definitions
  services: Record<string, ServiceDefinition>;
}

export interface MessageType {
  fields: Record<string, FieldType>;
  reserved?: number[];
}

export interface FieldType {
  type: 'string' | 'bytes' | 'int32' | 'int64' | 'float' | 'bool' | 'message';
  messageType?: string;     // If type is 'message'
  repeated?: boolean;
  optional?: boolean;
  default?: unknown;
}

export interface ServiceDefinition {
  methods: Record<string, MethodDefinition>;
}

export interface MethodDefinition {
  input: string;            // Message type name
  output: string;           // Message type name
  streaming?: 'none' | 'client' | 'server' | 'bidirectional';
}

// Example schema
const imageResizerSchema: Schema = {
  name: 'image-resizer',
  version: '1.0.0',
  cid: 'bafybeischema...',
  messages: {
    ResizeRequest: {
      fields: {
        imageCid: { type: 'string' },
        width: { type: 'int32' },
        height: { type: 'int32' },
        format: { type: 'string', optional: true, default: 'webp' },
      }
    },
    ResizeResponse: {
      fields: {
        outputCid: { type: 'string' },
        width: { type: 'int32' },
        height: { type: 'int32' },
        bytes: { type: 'int64' },
      }
    },
    Progress: {
      fields: {
        percent: { type: 'int32' },
        stage: { type: 'string' },
      }
    }
  },
  services: {
    ImageResizer: {
      methods: {
        resize: {
          input: 'ResizeRequest',
          output: 'ResizeResponse',
          streaming: 'server',  // Server streams progress
        }
      }
    }
  }
};

// Schema validation
export class SchemaValidator {
  constructor(private schema: Schema) {}

  validate(messageName: string, data: unknown): ValidationResult {
    const messageType = this.schema.messages[messageName];
    if (!messageType) {
      return { valid: false, error: `Unknown message type: ${messageName}` };
    }

    return this.validateMessage(data, messageType);
  }

  private validateMessage(data: unknown, type: MessageType): ValidationResult {
    if (typeof data !== 'object' || data === null) {
      return { valid: false, error: 'Expected object' };
    }

    for (const [name, field] of Object.entries(type.fields)) {
      const value = (data as Record<string, unknown>)[name];

      if (value === undefined) {
        if (!field.optional && field.default === undefined) {
          return { valid: false, error: `Missing required field: ${name}` };
        }
        continue;
      }

      const fieldResult = this.validateField(value, field);
      if (!fieldResult.valid) {
        return { valid: false, error: `${name}: ${fieldResult.error}` };
      }
    }

    return { valid: true };
  }
}

// Schema versioning
export class SchemaRegistry {
  private schemas: Map<string, Schema[]> = new Map();

  register(schema: Schema): void {
    const versions = this.schemas.get(schema.name) || [];
    versions.push(schema);
    versions.sort((a, b) => semver.compare(a.version, b.version));
    this.schemas.set(schema.name, versions);
  }

  // Get compatible schema version
  getCompatible(name: string, minVersion: string): Schema | null {
    const versions = this.schemas.get(name) || [];
    return versions.find(s => semver.gte(s.version, minVersion)) || null;
  }

  // Check if two versions are wire-compatible
  areCompatible(v1: Schema, v2: Schema): boolean {
    // Check all required fields in v1 exist in v2
    for (const [name, msg] of Object.entries(v1.messages)) {
      const v2Msg = v2.messages[name];
      if (!v2Msg) return false;

      for (const [fname, field] of Object.entries(msg.fields)) {
        if (!field.optional && !v2Msg.fields[fname]) {
          return false;
        }
      }
    }
    return true;
  }
}
```

### 2.9 @browsermesh/admission

Admission control for validating pods before they join the mesh.

```typescript
// Admission webhook interface
export interface AdmissionController {
  name: string;
  phase: 'validate' | 'mutate';
  review(request: AdmissionRequest): Promise<AdmissionResponse>;
}

export interface AdmissionRequest {
  // Pod attempting to join
  pod: {
    id: string;
    publicKey: Uint8Array;
    kind: PodKind;
    origin: string;
    capabilities: PodCapabilities;
    manifest?: ModuleManifest;
  };

  // Context
  operation: 'join' | 'upgrade' | 'register-service';
  timestamp: number;
}

export interface AdmissionResponse {
  allowed: boolean;
  reason?: string;
  patches?: AdmissionPatch[];   // For mutating controllers
}

export interface AdmissionPatch {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: unknown;
}

// Built-in admission controllers
export class IdentityValidator implements AdmissionController {
  name = 'identity-validator';
  phase = 'validate' as const;

  async review(request: AdmissionRequest): Promise<AdmissionResponse> {
    // Verify public key matches pod ID
    const computedId = await computePodId(request.pod.publicKey);
    if (computedId !== request.pod.id) {
      return { allowed: false, reason: 'Pod ID does not match public key' };
    }
    return { allowed: true };
  }
}

export class PolicyEnforcer implements AdmissionController {
  name = 'policy-enforcer';
  phase = 'validate' as const;

  constructor(private policy: MeshPolicy) {}

  async review(request: AdmissionRequest): Promise<AdmissionResponse> {
    // Check origin allowlist
    if (!this.policy.allowedOrigins.includes(request.pod.origin)) {
      return { allowed: false, reason: `Origin not allowed: ${request.pod.origin}` };
    }

    // Check manifest requirements
    if (this.policy.requireManifest && !request.pod.manifest) {
      return { allowed: false, reason: 'Manifest required' };
    }

    // Check capability restrictions
    for (const restricted of this.policy.restrictedCapabilities) {
      if (request.pod.capabilities[restricted]) {
        return { allowed: false, reason: `Capability not allowed: ${restricted}` };
      }
    }

    return { allowed: true };
  }
}

export class QuotaAttacher implements AdmissionController {
  name = 'quota-attacher';
  phase = 'mutate' as const;

  constructor(private quotaPolicy: QuotaPolicy) {}

  async review(request: AdmissionRequest): Promise<AdmissionResponse> {
    // Attach quotas based on pod kind and origin
    const quota = this.quotaPolicy.getQuota(
      request.pod.kind,
      request.pod.origin
    );

    return {
      allowed: true,
      patches: [{
        op: 'add',
        path: '/quota',
        value: quota,
      }]
    };
  }
}

export class DerivedKeyAttacher implements AdmissionController {
  name = 'derived-key-attacher';
  phase = 'mutate' as const;

  async review(request: AdmissionRequest): Promise<AdmissionResponse> {
    // Derive mesh-specific keys for the pod
    const derivedKeys = await deriveKeysForPod(request.pod.id);

    return {
      allowed: true,
      patches: [{
        op: 'add',
        path: '/derivedKeys',
        value: derivedKeys,
      }]
    };
  }
}

// Admission chain
export class AdmissionChain {
  private validators: AdmissionController[] = [];
  private mutators: AdmissionController[] = [];

  register(controller: AdmissionController): void {
    if (controller.phase === 'validate') {
      this.validators.push(controller);
    } else {
      this.mutators.push(controller);
    }
  }

  async review(request: AdmissionRequest): Promise<AdmissionResponse> {
    // Run validators first
    for (const validator of this.validators) {
      const response = await validator.review(request);
      if (!response.allowed) {
        return response;
      }
    }

    // Run mutators and collect patches
    const allPatches: AdmissionPatch[] = [];
    for (const mutator of this.mutators) {
      const response = await mutator.review(request);
      if (!response.allowed) {
        return response;
      }
      if (response.patches) {
        allPatches.push(...response.patches);
      }
    }

    return { allowed: true, patches: allPatches };
  }
}
```

---

## 3. Usage Examples

### 3.1 Basic Pod

```typescript
import { installPodRuntime } from '@browsermesh/runtime';

// Install in current context
const pod = await installPodRuntime(globalThis);

console.log(`Pod ID: ${pod.id}`);
console.log(`Kind: ${pod.kind}`);

// Listen for peers
pod.on('peer:discovered', (peer) => {
  console.log(`Found peer: ${peer.id}`);
});

// Handle requests
pod.handle('echo', async (request) => {
  return { echoed: request.payload };
});

// Send messages
await pod.send(targetPodId, { hello: 'world' });

// Make RPC calls
const result = await pod.request(targetPodId, 'compute', { input: 42 });
```

### 3.2 Worker Pod

```typescript
// In worker.ts
import { installPodRuntime } from '@browsermesh/runtime';

const pod = await installPodRuntime(self);

// Heavy computation handler
pod.handle('compute/transform', async (request) => {
  const { data, operation } = request.payload;
  return transform(data, operation);
});

// Stream processing
pod.onStream(async (stream) => {
  for await (const chunk of stream) {
    const processed = await processChunk(chunk);
    await stream.write(processed);
  }
});
```

### 3.3 Multi-Device Sync

```typescript
import { installPodRuntime } from '@browsermesh/runtime';

const pod = await installPodRuntime(globalThis, {
  bridge: {
    url: 'https://mesh.example.com',
    autoConnect: true,
  },
  federation: {
    webrtc: {
      enabled: true,
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    },
  },
});

// Sync state across devices
pod.on('message', (envelope) => {
  if (envelope.type === 'state-update') {
    const state = cbor.decode(envelope.payload);
    applyStateUpdate(state);
  }
});

function broadcastStateUpdate(update: unknown) {
  pod.broadcast({ type: 'state-update', update });
}
```

---

## 4. Build Configuration

### 4.1 TypeScript Config

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "WebWorker"],
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "types": []
  }
}
```

### 4.2 Package Exports

```json
{
  "name": "@browsermesh/runtime",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./worker": {
      "types": "./dist/worker.d.ts",
      "import": "./dist/worker.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "vitest",
    "lint": "eslint src"
  }
}
```

---

## 5. Testing Strategy

### 5.1 Unit Tests

```typescript
// __tests__/crypto/keys.test.ts
import { describe, it, expect } from 'vitest';
import { generatePodKeyPair, derivePodId, exportPublicKey } from '@browsermesh/crypto';

describe('Key Generation', () => {
  it('generates valid Ed25519 key pair', async () => {
    const keyPair = await generatePodKeyPair();
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey).toBeDefined();
  });

  it('derives consistent pod ID from public key', async () => {
    const keyPair = await generatePodKeyPair();
    const publicKey = await exportPublicKey(keyPair);

    const id1 = await derivePodId(publicKey);
    const id2 = await derivePodId(publicKey);

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[A-Za-z0-9_-]+$/);  // base64url
  });
});
```

### 5.2 Integration Tests

```typescript
// __tests__/integration/discovery.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { installPodRuntime } from '@browsermesh/runtime';

describe('Pod Discovery', () => {
  let pod1: Pod;
  let pod2: Pod;

  beforeAll(async () => {
    pod1 = await installPodRuntime(globalThis, { discovery: { broadcastChannel: 'test' } });
    pod2 = await installPodRuntime(globalThis, { discovery: { broadcastChannel: 'test' } });
  });

  afterAll(async () => {
    await pod1.shutdown();
    await pod2.shutdown();
  });

  it('pods discover each other via BroadcastChannel', async () => {
    const discovered = new Promise<string>((resolve) => {
      pod1.on('peer:discovered', (peer) => resolve(peer.id));
    });

    const peerId = await discovered;
    expect(peerId).toBe(pod2.id);
  });
});
```

---

## 6. Development Tools

### 6.1 @browsermesh/cli

```bash
# Create new project
npx @browsermesh/cli create my-app

# Generate key pair
npx @browsermesh/cli keygen > identity.json

# Start dev server with mesh inspector
npx @browsermesh/cli dev --inspect
```

### 6.2 Mesh Inspector

Browser DevTools extension for debugging:

- Pod graph visualization
- Message tracing
- Routing table inspection
- Performance metrics

---

## 7. Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Ed25519/X25519 | ✅ 137+ | ✅ 115+ | ✅ 17+ | ✅ 137+ |
| WebTransport | ✅ 97+ | ✅ 115+ | ❌ | ✅ 98+ |
| SharedArrayBuffer | ⚠️ COOP/COEP | ⚠️ COOP/COEP | ⚠️ COOP/COEP | ⚠️ COOP/COEP |
| WebRTC DataChannel | ✅ | ✅ | ✅ | ✅ |
| SharedWorker | ✅ | ✅ | ✅ | ✅ |
| ServiceWorker | ✅ | ✅ | ✅ | ✅ |

**Legend:** ✅ Full support, ⚠️ Conditional, ❌ Not supported

---

## 8. Roadmap

### Phase 1: Core — **implemented**
- [x] Pod model and types (`web/packages/pod/`)
- [x] Cryptographic primitives (`web/clawser-mesh-identity.js`, `web/clawser-mesh-keyring.js`)
- [x] Basic discovery — BroadcastChannel (`web/clawser-mesh-discovery.js`)
- [x] Message routing (`web/clawser-mesh-peer.js`)

### Phase 2: Mesh — **partial**
- [x] SharedWorker coordination (`SharedWorkerRelayStrategy` in discovery module)
- [ ] ServiceWorker routing — doc-only
- [x] Channel upgrades (`web/clawser-mesh-transport.js` — transport negotiation)

### Phase 3: External — **partial**
- [ ] WebTransport bridge — doc-only
- [x] WebSocket fallback (`web/clawser-mesh-relay.js`)
- [x] RPC protocol (Pod RPC via `createRpcRequest`/`createRpcResponse`)

### Phase 4: Federation — **partial**
- [ ] Cross-origin communication — doc-only
- [ ] WebRTC mesh — doc-only (signaling spec exists)
- [x] Multi-device sync (`web/clawser-mesh-sync.js` — CRDT engine)

### Phase 5: Tooling — **doc-only**
- [ ] CLI tools
- [ ] DevTools extension
- [ ] Documentation site
