# pod — Browser Pod Base Class

A Pod is any browser execution context that can execute code, receive messages, and be discovered/addressed. This package provides the standalone base class with zero Clawser dependencies.

Pods automatically generate an Ed25519 cryptographic identity, detect their execution context, discover same-origin peers via BroadcastChannel, and establish roles (autonomous, child, peer). Clawser extends this into `ClawserPod` for the full agent workspace; the extension injects `InjectedPod` into arbitrary pages.

## Install

```js
// ESM import (browser, no bundler needed)
import { Pod, detectPodKind, detectCapabilities } from './packages/pod/src/index.mjs';

// Or via the bridge (from web/)
import { Pod, InjectedPod } from './packages-pod.js';
```

Zero dependencies beyond `mesh-primitives` (for Ed25519 identity).

## Quick Start

```js
import { Pod } from './packages/pod/src/pod.mjs';

const pod = new Pod();
await pod.boot();

console.log(pod.podId);        // base64url Ed25519 hash
console.log(pod.kind);         // 'window', 'worker', 'iframe', etc.
console.log(pod.role);         // 'autonomous', 'peer', or 'child'
console.log(pod.peers.size);   // number of discovered peers

pod.on('message', (msg) => {
  console.log('Received:', msg.payload);
});

// Send to a specific peer
pod.send(otherPodId, { text: 'hello' });

// Broadcast to all peers
pod.broadcast({ text: 'hello everyone' });

await pod.shutdown();
```

## Boot Sequence

The 6-phase boot sequence runs automatically when you call `pod.boot()`:

| Phase | Name | Action |
|-------|------|--------|
| 0 | Install Runtime | Generate Ed25519 identity, detect kind & capabilities, set `globalThis[Symbol.for('pod.runtime')]` |
| 1 | Install Listeners | Attach `window.message` handler, call `_onInstallListeners()` hook |
| 2 | Self-Classification | Detect parent/opener/SW relationships |
| 3 | Parent Handshake | Send `POD_HELLO` to parent/opener, wait for `POD_HELLO_ACK` (default 1s timeout) |
| 4 | Peer Discovery | Announce on BroadcastChannel, collect peer responses (default 2s timeout) |
| 5 | Role Finalization | Determine role, call `_onReady()` hook, emit `'ready'` event |

State transitions: `idle → booting → ready → shutdown`

## Boot Options

```js
await pod.boot({
  identity,           // PodIdentity — skip generation, reuse existing
  discoveryChannel,   // string — BroadcastChannel name (default: 'pod-discovery')
  handshakeTimeout,   // number — ms to wait for parent ACK (default: 1000)
  discoveryTimeout,   // number — ms to wait for peer responses (default: 2000)
  globalThis,         // object — override globalThis (for testing)
});
```

## API

### Getters

| Getter | Type | Description |
|--------|------|-------------|
| `podId` | `string \| null` | Base64url Ed25519 public key hash (43 chars) |
| `identity` | `PodIdentity \| null` | Ed25519 key pair wrapper |
| `capabilities` | `PodCapabilities \| null` | Detected runtime capabilities |
| `kind` | `PodKind \| null` | Execution context classification |
| `role` | `PodRole` | `'autonomous'`, `'child'`, or `'peer'` |
| `state` | `PodState` | `'idle'`, `'booting'`, `'ready'`, or `'shutdown'` |
| `peers` | `Map<string, object>` | Copy of known peers (podId → info) |

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `boot` | `async boot(opts?)` | Run 6-phase boot sequence |
| `shutdown` | `async shutdown(opts?)` | Broadcast `POD_GOODBYE`, close channels, clear peers. `opts.silent` skips the goodbye. |
| `send` | `send(targetPodId, payload)` | Send message to a specific peer via BroadcastChannel |
| `broadcast` | `broadcast(payload)` | Send message to all peers (address: `'*'`) |
| `on` | `on(event, cb)` | Register event listener |
| `off` | `off(event, cb)` | Remove event listener |
| `toJSON` | `toJSON()` | Serializable snapshot of pod state |

### Events

| Event | Data | When |
|-------|------|------|
| `phase` | `{ phase: number, name: string }` | Each boot phase starts |
| `ready` | `{ podId, kind, role }` | Boot completes |
| `shutdown` | `{ podId }` | Pod shuts down |
| `error` | `{ phase, error }` | Boot phase fails |
| `peer:found` | `{ podId, kind, ... }` | New peer discovered |
| `peer:lost` | `{ podId }` | Peer departed (GOODBYE) |
| `message` | `{ type, from, to, payload, ts }` | Incoming message for this pod |

### Subclass Hooks

| Hook | Phase | Description |
|------|-------|-------------|
| `_onInstallListeners(g)` | 1 | Install additional message handlers |
| `_onReady()` | 5 | Boot complete callback |
| `_onMessage(msg)` | — | Handle incoming targeted message |

## Pod Kinds

`detectPodKind(globalThis)` returns one of:

| Kind | Detection |
|------|-----------|
| `service-worker` | `instanceof ServiceWorkerGlobalScope` |
| `shared-worker` | `instanceof SharedWorkerGlobalScope` |
| `worker` | `instanceof WorkerGlobalScope` |
| `worklet` | `instanceof AudioWorkletGlobalScope` |
| `server` | No `window` or `document` |
| `iframe` | `window !== window.parent` |
| `spawned` | `window.opener` is set |
| `window` | Default (top-level window) |

## Capabilities

`detectCapabilities(globalThis)` returns:

```js
{
  messaging: { postMessage, messageChannel, broadcastChannel, sharedWorker, serviceWorker },
  network:   { fetch, webSocket, webTransport, webRTC },
  storage:   { indexedDB, cacheAPI, opfs },
  compute:   { wasm, sharedArrayBuffer, offscreenCanvas },
}
```

All values are booleans.

## Wire Protocol

| Constant | Value | Purpose |
|----------|-------|---------|
| `POD_HELLO` | `'pod:hello'` | Discovery announcement |
| `POD_HELLO_ACK` | `'pod:hello-ack'` | Discovery response |
| `POD_GOODBYE` | `'pod:goodbye'` | Graceful departure |
| `POD_MESSAGE` | `'pod:message'` | Inter-pod message |
| `POD_RPC_REQUEST` | `'pod:rpc-request'` | RPC call |
| `POD_RPC_RESPONSE` | `'pod:rpc-response'` | RPC result |

Message factories: `createHello()`, `createHelloAck()`, `createGoodbye()`, `createMessage()`, `createRpcRequest()`, `createRpcResponse()`.

## Subclasses

| Class | File | Use Case |
|-------|------|----------|
| `ClawserPod` | `web/clawser-pod.js` | Full workspace — adds `initMesh()` for PeerNode + SwarmCoordinator |
| `InjectedPod` | `src/injected-pod.mjs` | Lightweight — page text extraction, visual overlay, extension bridge |
| `EmbeddedPod` | `web/clawser-embed.js` | Developer API — config-driven embedding with `sendMessage()` |

## Extension Injection

`extension/pod-inject.js` is a concatenated IIFE bundle of the pod modules. It guards against double-injection via `Symbol.for('pod.runtime')`.

Regenerate after editing source:

```bash
bash web/packages/pod/build.sh
```

## Tests

```bash
# All pod tests
node --import ./web/test/_setup-globals.mjs --test \
  web/test/clawser-pod.test.mjs \
  web/test/clawser-pod-detect-kind.test.mjs \
  web/test/clawser-pod-capabilities.test.mjs \
  web/test/clawser-pod-discovery.test.mjs \
  web/test/clawser-pod-messaging.test.mjs \
  web/test/clawser-pod-embed.test.mjs
```

55 tests across 6 files.

## File Layout

```
web/packages/pod/
  src/
    pod.mjs            — Pod base class (~300 LOC)
    detect-kind.mjs    — Environment classification (~55 LOC)
    capabilities.mjs   — Capability detection (~65 LOC)
    messages.mjs       — Wire protocol constants + factories (~135 LOC)
    injected-pod.mjs   — InjectedPod subclass (~155 LOC)
    index.mjs          — Barrel exports
  build.sh             — IIFE bundle generator
  README.md            — This file
```
