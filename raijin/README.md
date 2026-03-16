# ⚡ Raijin

A browser-native mesh rollup framework. Build sovereign rollups where
the users ARE the validators.

## What is this?

Raijin is a modular rollup framework that runs entirely in the browser.
No Go sequencer. No Rust node. No Docker. Users visiting your web app
form a P2P consensus network and produce blocks together.

Think of it as the OP Stack, but for browsers.

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `raijin-core` | State machine, blocks, transactions | ✅ Built |
| `raijin-consensus` | PBFT consensus + leader rotation | 🔜 Next |
| `raijin-mempool` | Transaction pool + ordering | Planned |
| `raijin-da` | Data availability (Celestia, ETH blobs) | Planned |
| `raijin-bridge` | L1 deposit/withdraw | Planned |
| `raijin-contracts` | Solidity bridge contracts | Planned |
| `raijin-validator` | Full validator node | Planned |
| `raijin-sdk` | Client SDK | Planned |

## Quick Start

```bash
pnpm install
pnpm test
pnpm build
```

## Design Principles

- **Transport agnostic.** The rollup doesn't know about WebRTC.
- **Storage agnostic.** State uses a `StateStore` interface.
- **Identity agnostic.** Accepts any signing function.
- **Browser-first, not browser-only.** Works in Node.js too.
- **Zero server cost.** Your users' browsers are the infrastructure.

## Name

Raijin (雷神) — the Japanese god of lightning, thunder, and storms.
Like lightning connecting sky to earth, Raijin connects browser peers
into a consensus network.

## License

MIT
