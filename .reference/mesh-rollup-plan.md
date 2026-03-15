# Clawser Mesh-Native Rollup — Full Plan

> A rollup where Clawser's P2P mesh peers collectively sequence transactions.
> No Coinbase. No OP Labs. No centralized sequencer. The mesh IS the sequencer.

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                    Browser Peers                        │
│                                                         │
│  Peer A ←──WebRTC──→ Peer B ←──WebRTC──→ Peer C        │
│    │                    │                    │          │
│    └────────── PBFT Consensus ───────────────┘          │
│                    │                                    │
│    Mempool → Block Production → State Transitions       │
│                    │                                    │
└────────────────────┼────────────────────────────────────┘
                     │
          ┌──────────┼──────────┐
          ▼                     ▼
   ┌─────────────┐    ┌──────────────┐
   │  Celestia   │    │ Ethereum L1  │
   │   (data)    │    │ (settlement) │
   │  ~$0.01/MB  │    │  state roots │
   └─────────────┘    └──────────────┘
```

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Consensus | Rotating leader + PBFT 3-phase | Proven BFT, maps to existing SwarmCoordinator |
| Block time | 2-3 seconds | Fast for micropayments, achievable in browser |
| Honest majority | 2/3 BFT (n ≥ 3f+1) | Standard BFT threshold |
| Min validators | 4 (recommended 7+) | Minimum for meaningful BFT |
| Finality | Soft: ~3s (2/3 sigs), Hard: daily (L1 anchor) | Two-tier for speed + security |
| Fraud proofs | Optimistic (not ZK) | Browser CPUs can't generate ZK proofs |
| DA layer | Celestia (~$0.01/MB) | 55x cheaper than ETH blobs |
| Settlement | Ethereum L1 | Maximum security, no dependency chain |
| Signatures | ECDSA on-chain, Ed25519 in mesh | EVM has native ecrecover; Ed25519 precompile pending |
| Browser lib | viem v2 | Tree-shakeable, smaller than ethers v6 |
| Contract framework | Foundry | Fastest, built-in fuzzing |

---

## Transaction Model

15 transaction types (0x01-0x0F):

| Type | Code | Description |
|------|------|-------------|
| Credit Transfer | 0x01 | Send credits between accounts |
| Reputation Attestation | 0x02 | Peer endorsement |
| Credential Mint | 0x03 | Issue skill badge |
| Credential Revoke | 0x04 | Remove credential |
| Governance Propose | 0x05 | Create proposal |
| Governance Vote | 0x06 | Cast vote |
| Service List | 0x07 | Advertise service |
| Service Delist | 0x08 | Remove service |
| Audit Anchor | 0x09 | Anchor EventLog hash |
| Identity Register | 0x0A | Register DID |
| Identity Update | 0x0B | Update identity |
| Identity Recover | 0x0C | Social recovery |
| Escrow Create | 0x0D | Lock funds in escrow |
| Escrow Release | 0x0E | Release escrow |
| Escrow Refund | 0x0F | Refund escrow |

Each transaction carries: DID sender, monotonic nonce, Ed25519 signature,
chainId, type-specific payload.

---

## State Machine

Sorted-key Merkle trie with 7 namespaces:

```
account:{did}     → { balance, nonce, reputation }
credential:{id}   → { holder, issuer, type, data, revoked }
proposal:{id}     → { author, title, votes, status, deadline }
service:{id}      → { provider, name, endpoint, metadata }
identity:{did}    → { pubKey, label, recoveryPeers, updated }
escrow:{id}       → { creator, recipient, amount, conditions, status }
validator:{addr}  → { peerId, stake, registered, slashed }
```

Pure function: `applyTransaction(state, tx, blockContext) → (newState, receipt)`

---

## Smart Contracts (Ethereum L1)

| Contract | Purpose | Gas (typical) |
|----------|---------|---------------|
| `ClawserRollup.sol` | State root submission, fraud proofs, force-include | ~180k per batch |
| `ValidatorRegistry.sol` | Staking, slashing, epoch management | ~95k register |
| `Bridge.sol` | ERC-20 deposit/withdraw with Merkle proofs | ~75k deposit |
| `ClawserToken.sol` | CLWSR ERC-20 (1B supply, non-upgradeable) | ~52k transfer |
| `Governance.sol` | OpenZeppelin Governor + Timelock | ~80k vote |
| `DisputeGame.sol` | Interactive fraud proof bisection | ~200-500k |

Deployed on Ethereum L1 for maximum security. Batch amortization: ~$0.01 per
L2 transaction in settlement fees.

---

## Escape Hatch

```
0-1h:   Active      — mesh producing blocks normally
1-24h:  Degraded    — force-include queue available on L1
24-48h: Halted      — auto-settlement triggered
48h+:   Emergency   — direct L1 withdrawal via Merkle proof
14d:    Sunset      — automatic full settlement
```

No admin can override. Purely time-based. Users can always exit.

---

## Integration with Existing Clawser

| Existing Module | Rollup Role |
|----------------|-------------|
| `SwimMembership` | Validator set membership + failure detection |
| `LeaderElection` | Block proposer rotation |
| `GossipProtocol` | Transaction mempool dissemination |
| `ConsensusManager` | Block voting (PREPARE/COMMIT phases) |
| `CreditLedger` | Account balance state |
| `TrustGraph` | Validator reputation weighting |
| `AuditChain` | Merkle proof primitives |
| `TimestampAuthority` | Block timestamp consensus |
| `IdentityWallet` | Transaction/block signing |
| `EscrowManager` | On-chain escrow lifecycle |

---

## New Files (32 total, ~10,520 LOC)

### Browser JavaScript (12 files, 4,150 LOC)
```
web/clawser-rollup-tx.js          (350) — transaction model + validation
web/clawser-rollup-block.js       (300) — block model + chain store
web/clawser-rollup-state.js       (400) — deterministic state machine
web/clawser-rollup-producer.js    (250) — single-peer block production
web/clawser-rollup-validators.js  (300) — validator set + leader rotation
web/clawser-rollup-consensus.js   (500) — multi-peer PBFT + view change
web/clawser-rollup-l1.js          (400) — browser-to-L1 via viem
web/clawser-rollup-da.js          (350) — block serialization + compression
web/clawser-rollup-celestia.js    (300) — Celestia DA client
web/clawser-rollup-ethblob.js     (250) — EIP-4844 blob client
web/clawser-rollup-x402.js        (250) — x402 payment adapter
web/clawser-rollup-fraud.js       (500) — fraud proof + bisection game
```

### Solidity (8 files, 1,820 LOC)
```
contracts/src/ClawserRollup.sol       (400) — state root anchoring
contracts/src/Bridge.sol              (350) — ERC-20 deposit/withdraw
contracts/src/ValidatorRegistry.sol   (300) — staking + slashing
contracts/src/ClawserToken.sol        (150) — CLWSR ERC-20
contracts/src/DisputeGame.sol         (400) — on-chain fraud resolution
contracts/script/Deploy.s.sol         (100) — Sepolia deploy
contracts/script/DeployMainnet.s.sol  (100) — mainnet deploy
contracts/foundry.toml                 (20) — config
```

### Tests (20 files, 4,550 LOC)
15 JS test files + 5 Foundry test files

---

## Implementation Phases

| Phase | Timeline | Effort | Deliverables |
|-------|----------|--------|-------------|
| **P1: Foundation** | Month 1-2 | 4 pw | Transaction model, single-peer blocks, state machine, gossip mempool |
| **P2: Consensus** | Month 2-3 | 5 pw | Rotating leader, 2/3 signatures, view change, 3-5 peer tests |
| **P3: Smart Contracts** | Month 3-4 | 6 pw | ClawserRollup, Bridge, ValidatorRegistry on Sepolia |
| **P4: Data Availability** | Month 4-5 | 4 pw | Celestia integration, ETH blob fallback, DA proofs |
| **P5: Bridge + Token** | Month 5-6 | 4 pw | CLWSR ERC-20, deposit/withdraw, x402 micropayments |
| **P6: Fraud Proofs** | Month 6-7 | 6 pw | Interactive bisection, DisputeGame.sol, slashing |
| **P7: Hardening** | Month 7-9 | 8 pw | 100+ peer stress test, security audit, mainnet deploy |

**Total: 37 person-weeks (~9 person-months), ~7 months critical path**

---

## Token Economics

```
CLWSR — 1 billion max supply, non-inflationary

Distribution:
  40% — Community/ecosystem (4-year vest)
  25% — Validator rewards (sequencer fees)
  20% — Team (4-year vest, 1-year cliff)
  10% — Treasury (governance-controlled)
   5% — Initial liquidity
```

---

## Security Model

- **Sybil resistance**: 10,000 CLWSR minimum stake per validator
- **Slashing**: 100% for double-signing, 50% for invalid state roots, 10% for censoring force-includes
- **Challenge period**: 7 days (optimistic)
- **Escape hatch**: Time-based, no admin override, purely trustless
- **Open validator set**: Anyone can stake and join (up to 100 validators)
- **Social recovery**: M-of-N peer attestation for lost keys

---

## Why This Matters

This is the first rollup where the sequencer IS the user community.

- No Coinbase controlling transaction ordering
- No OP Labs extracting MEV
- No single entity that can censor or go down
- The mesh network that already coordinates AI agents also sequences the chain
- Escape hatch ensures users can always leave, even if the mesh dies

*"Speed in the mesh, truth on the chain, sequencing by the community."*
