# Payment Channels

Double-entry credit ledger, bidirectional micropayment channels, and escrow for
BrowserMesh pods.

**Source**: `web/clawser-mesh-payments.js`
**Related specs**: [resource-marketplace.md](../coordination/resource-marketplace.md) | [quota-metering.md](../coordination/quota-metering.md)

## 1. Overview

Four cooperating classes: `CreditLedger` for double-entry accounting,
`PaymentChannel` for off-chain bidirectional micropayments, `EscrowManager` for
conditional fund holds, and `PaymentRouter` that composes them into a single
per-pod facade. Wire codes are imported from the canonical registry.

## 2. Wire Codes

From `MESH_TYPE` in `web/packages/mesh-primitives/src/constants.mjs`:

| Name            | Hex    | Description                   |
|-----------------|--------|-------------------------------|
| PAYMENT_OPEN    | `0xD0` | Open a payment channel        |
| PAYMENT_UPDATE  | `0xD1` | Update channel balance        |
| PAYMENT_CLOSE   | `0xD2` | Close a payment channel       |
| ESCROW_CREATE   | `0xD3` | Create an escrow hold         |

## 3. API Surface

### 3.1 CreditLedger

Each mutation produces an immutable `LedgerEntry`:
`{ id, type, amount, counterparty, memo, timestamp, balance }`.

```
constructor(ownerId)
get ownerId / balance / entryCount
credit(amount, fromPodId, memo?) -> LedgerEntry
debit(amount, toPodId, memo?) -> LedgerEntry     // throws if insufficient
transfer(peerLedger, amount, memo?) -> { debit, credit }
getEntries(opts?) -> LedgerEntry[]                // opts: { since?, limit? }
toJSON() / static fromJSON(data)
```

### 3.2 PaymentChannel

Bidirectional channel with sequenced updates. States: `idle` -> `open` -> `closed`.
Defaults: capacity = 1000 credits, TTL = 1 hour.

```
constructor(localPodId, remotePodId, opts?)   // opts: { capacity?, ttlMs? }
get channelId / state / localBalance / remoteBalance / capacity / sequence
open(initialDeposit) -> void
pay(amount) -> PaymentUpdate
receive(update) -> void                       // validates sequence > current
close() -> ChannelSettlement
isExpired() -> boolean
toJSON() / static fromJSON(data)
```

`PaymentUpdate`: `{ channelId, sequence, amount, localBalance, remoteBalance, timestamp, signature }`.
`ChannelSettlement`: `{ channelId, finalLocalBalance, finalRemoteBalance, entryCount, closedAt }`.

### 3.3 EscrowManager

Conditional fund holds. Statuses: `held`, `released`, `refunded`, `expired`.

```
constructor()
get size
create(payerPodId, payeePodId, amount, conditions?) -> Escrow
get(escrowId) -> Escrow|null
release(escrowId) / refund(escrowId) / expire(escrowId) -> boolean
listByParty(podId) -> Escrow[]
pruneExpired(now?) -> number
```

Conditions: `{ timeout?, description? }`. `pruneExpired` auto-expires holds
that exceed their timeout.

### 3.4 PaymentRouter

Per-pod facade composing ledger, channels, and escrow.

```
constructor(localPodId)
getLedger() -> CreditLedger
openChannel(remotePodId, capacity?) -> PaymentChannel
getChannel(remotePodId) -> PaymentChannel|null
closeChannel(remotePodId) -> ChannelSettlement|null
listChannels() -> PaymentChannel[]
getEscrow() -> EscrowManager
```

One channel per remote peer at a time; `openChannel` throws on duplicates.

## 4. Channel Lifecycle

`idle --[open(deposit)]--> open --[pay/receive]--> open --[close]--> closed`

Payments are sequenced; `receive` rejects stale sequence numbers.

## 5. Implementation Status

| Aspect              | Status                                          |
|---------------------|-------------------------------------------------|
| All classes         | Fully implemented                               |
| Wire code imports   | From canonical constants registry               |
| Serialization       | toJSON/fromJSON complete                        |
| Unit tests          | Yes (`web/test/clawser-mesh-payments.test.mjs`) |
| App bootstrap wired | No -- not wired to app bootstrap                |
