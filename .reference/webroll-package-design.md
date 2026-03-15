# webroll — Browser-Native Mesh Rollup Framework

> A modular rollup framework that runs entirely in the browser.
> Build sovereign rollups where the users ARE the validators.

---

## Package Name: `webroll`

Short, memorable, immediately conveys "web + rollup." The name signals browser-native
without being exclusionary of Node.js. Sub-packages use `@webroll/` scope.

---

## Monorepo Structure

```
webroll/
├── packages/
│   ├── core/        — state machine, blocks, transactions (ZERO deps)
│   ├── consensus/   — PBFT + leader rotation (depends on core)
│   ├── mempool/     — tx ordering, gossip interface (depends on core)
│   ├── da/          — data availability (Celestia, ETH blobs, local)
│   ├── bridge/      — L1 deposit/withdraw (viem)
│   ├── contracts/   — Solidity (Foundry)
│   ├── validator/   — ties everything into a runnable node
│   └── sdk/         — developer-facing client API
└── examples/
    ├── browser-chat-rollup/
    ├── node-validator/
    └── clawser-integration/
```

## Tooling

| Decision | Choice | Why |
|----------|--------|-----|
| Monorepo | pnpm workspaces + turborepo | Standard, fast caching |
| Language | TypeScript | Standalone packages need type safety |
| Build | tsup (esbuild) | ESM + CJS dual output, tree-shakeable |
| Target | Browser primary, Node.js secondary | `globalThis.crypto` works in both |
| Testing | vitest | ESM-native, browser + Node modes |
| Linting | biome | Single tool, fast, zero config |

---

## Dependency Graph

```
                    ┌──────────┐
                    │   core   │  ← zero deps
                    └────┬─────┘
            ┌────────┬───┼────────┬──────────┐
            ▼        ▼   ▼        ▼          ▼
       consensus  mempool  da    bridge      sdk
            │        │     │      │
            └────┬───┘     │      │
                 ▼         ▼      ▼
              validator ───┘──────┘
```

Every arrow points down from core. No cycles. validator is the composition root.

---

## Package APIs (Key Interfaces)

### @webroll/core — Zero Dependencies

```typescript
// Injected interfaces — bring your own implementation
interface StateStore {
  get(key: Uint8Array): Promise<Uint8Array | null>
  put(key: Uint8Array, value: Uint8Array): Promise<void>
  delete(key: Uint8Array): Promise<void>
  root(): Promise<Uint8Array>
}

interface SignatureVerifier {
  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean>
}

// The core state machine
class StateMachine {
  constructor(store: StateStore, verifier: SignatureVerifier)
  applyBlock(block: Block): Promise<TransactionReceipt[]>
  applyTransaction(tx: Transaction): Promise<TransactionReceipt>
  stateRoot(): Promise<Uint8Array>
}
```

### @webroll/consensus — Transport Agnostic

```typescript
// Injected — the rollup doesn't know about WebRTC
interface NetworkTransport {
  broadcast(message: ConsensusMessage): void
  send(to: Uint8Array, message: ConsensusMessage): void
  onMessage(handler: (from: Uint8Array, msg: ConsensusMessage) => void): void
}

class PBFTConsensus {
  constructor(opts: {
    identity: { publicKey, sign, verify }
    validators: ValidatorSet
    transport: NetworkTransport
    stateMachine: StateMachine
    blockTime?: number        // default 2000ms
  })
  start(): void
  stop(): void
  onBlockFinalized(handler: (block: Block) => void): void
}
```

### @webroll/da — Pluggable Data Availability

```typescript
interface DALayer {
  submit(data: Uint8Array): Promise<DACommitment>
  retrieve(commitment: DACommitment): Promise<Uint8Array>
  verify(commitment: DACommitment): Promise<boolean>
}

class CelestiaDA implements DALayer { /* ... */ }
class EthBlobDA implements DALayer { /* ... */ }
class LocalDA implements DALayer { /* for testing */ }
```

### @webroll/validator — Composition Root

```typescript
class ValidatorNode {
  constructor(config: {
    identity: { publicKey, sign, verify }
    transport: NetworkTransport
    gossip: GossipTransport
    store: StateStore
    da: DALayer
    blockTime?: number
  })
  start(): Promise<void>
  stop(): Promise<void>
  onBlockFinalized(handler: (block: Block) => void): void
}
```

---

## Design Principles

1. **Zero Clawser dependencies in the core** — no imports from clawser-*.js
2. **Transport agnostic** — accepts any NetworkTransport interface
3. **Storage agnostic** — accepts any StateStore interface
4. **Identity agnostic** — accepts any signing function
5. **Pluggable DA** — Celestia, ETH blobs, or custom
6. **Browser-first but not browser-only** — works in Node.js too

---

## Clawser Integration (Single File)

`web/clawser-rollup-integration.js` — the ONLY file that imports both:

```javascript
import { ValidatorNode } from '@webroll/validator'
import { PeerNode } from './clawser-pod.js'

// Adapter: Clawser PeerNode → webroll NetworkTransport
class ClawserTransportAdapter {
  constructor(peerNode) { ... }
  broadcast(msg) { this.peerNode.broadcast('webroll:consensus', msg) }
  send(to, msg) { this.peerNode.send(to, 'webroll:consensus', msg) }
  onMessage(handler) { this.peerNode.on('webroll:consensus', handler) }
}

// Factory
export async function createClawserValidator(opts) {
  const node = new ValidatorNode({
    transport: new ClawserTransportAdapter(opts.peerNode),
    gossip: new ClawserGossipAdapter(opts.gossip),
    identity: new ClawserIdentityAdapter(opts.wallet),
    store: new InMemoryStateStore(),
    da: new LocalDA(),
  })
  await node.start()
  return node
}
```

| Clawser Module | webroll Interface | Adapter |
|---------------|-------------------|---------|
| PeerNode.broadcast | NetworkTransport | ClawserTransportAdapter |
| GossipProtocol | GossipTransport | ClawserGossipAdapter |
| IdentityWallet | SignatureVerifier + signer | ClawserIdentityAdapter |
| CreditLedger | StateStore initial state | syncLedgerToState() |
| SWIM membership | ValidatorSet | join/leave event listener |

---

## What Makes This Different

| Framework | Language | Runs In | Sequencer | Server Cost |
|-----------|---------|---------|-----------|-------------|
| OP Stack | Go | Server | Single operator | $5K-50K/mo |
| Arbitrum Orbit | Go/Rust | Server | Single operator | $5K-50K/mo |
| Sovereign SDK | Rust | Server/WASM | Configurable | $1K-10K/mo |
| Stackr | TypeScript | Server | Centralized | $500-5K/mo |
| **webroll** | **TypeScript** | **Browser** | **P2P PBFT** | **$0** |

Zero server cost. The users' browsers are the infrastructure.

Trade-offs:
- PBFT scales to ~100 validators, not 10,000 (app-specific, not global)
- Browser validators can go offline (view-change handles it, but >1/3 offline = chain halts)
- Optimistic only (no ZK — browser CPUs can't generate proofs)

---

## Size Estimates

| Package | LOC | External Deps |
|---------|-----|---------------|
| @webroll/core | 1,200 | none |
| @webroll/consensus | 1,500 | none |
| @webroll/mempool | 600 | none |
| @webroll/da | 800 | viem (peer, optional) |
| @webroll/bridge | 900 | viem (peer) |
| @webroll/contracts | 600 | OpenZeppelin |
| @webroll/validator | 700 | none |
| @webroll/sdk | 500 | none |
| **Total source** | **~6,800** | |
| Tests (~60%) | ~4,000 | vitest |
| Clawser integration | ~200 | both |
| **Grand total** | **~11,000** | |

---

## Build Order

1. `@webroll/core` — foundation, zero deps, TDD
2. `@webroll/consensus` — hardest part, extensive Byzantine testing
3. `@webroll/mempool` — straightforward, depends on core
4. `@webroll/validator` — integration: wire core + consensus + mempool
5. `@webroll/da` — Celestia client + local testing backend
6. `@webroll/bridge` + `@webroll/contracts` — L1 interaction
7. `@webroll/sdk` — developer-facing API
8. `clawser-rollup-integration.js` — connect to Clawser's mesh
