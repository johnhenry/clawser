import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  PaymentRouter,
  PAYMENT_OPEN,
  PAYMENT_UPDATE,
  PAYMENT_CLOSE,
  ESCROW_CREATE,
} from '../clawser-mesh-payments.js'

describe('PaymentRouter wireTransport', () => {
  let router
  const LOCAL = 'pod-local'
  const REMOTE = 'pod-remote'

  /** Captured broadcasts: { type, payload } */
  let broadcasts
  /** Registered handlers: wireType -> handler */
  let handlers

  function makeBroadcastFn() {
    return (type, payload) => { broadcasts.push({ type, payload }) }
  }

  function makeSubscribeFn() {
    return (type, handler) => { handlers.set(type, handler) }
  }

  beforeEach(() => {
    broadcasts = []
    handlers = new Map()
    router = new PaymentRouter(LOCAL)
  })

  // 1. wireTransport requires functions
  it('throws if broadcastFn is not a function', () => {
    assert.throws(() => router.wireTransport('not-fn', () => {}), /must be functions/)
  })

  it('throws if subscribeFn is not a function', () => {
    assert.throws(() => router.wireTransport(() => {}, null), /must be functions/)
  })

  // 2. broadcastOpen sends PAYMENT_OPEN
  it('broadcastOpen sends PAYMENT_OPEN wire type', () => {
    router.wireTransport(makeBroadcastFn(), makeSubscribeFn())
    router.broadcastOpen(REMOTE, 500)

    assert.equal(broadcasts.length, 1)
    assert.equal(broadcasts[0].type, PAYMENT_OPEN)
    assert.equal(broadcasts[0].payload.remotePodId, REMOTE)
    assert.equal(broadcasts[0].payload.capacity, 500)
  })

  // 3. broadcastUpdate sends PAYMENT_UPDATE
  it('broadcastUpdate sends PAYMENT_UPDATE wire type', () => {
    router.wireTransport(makeBroadcastFn(), makeSubscribeFn())
    const update = { channelId: 'ch_1', sequence: 1, amount: 10 }
    router.broadcastUpdate(update)

    assert.equal(broadcasts.length, 1)
    assert.equal(broadcasts[0].type, PAYMENT_UPDATE)
    assert.deepEqual(broadcasts[0].payload, update)
  })

  // 4. broadcastClose sends PAYMENT_CLOSE
  it('broadcastClose sends PAYMENT_CLOSE wire type', () => {
    router.wireTransport(makeBroadcastFn(), makeSubscribeFn())
    const settlement = { channelId: 'ch_1', finalLocalBalance: 90, finalRemoteBalance: 10 }
    router.broadcastClose(REMOTE, settlement)

    assert.equal(broadcasts.length, 1)
    assert.equal(broadcasts[0].type, PAYMENT_CLOSE)
    assert.equal(broadcasts[0].payload.remotePodId, REMOTE)
    assert.equal(broadcasts[0].payload.channelId, 'ch_1')
  })

  // 5. broadcastEscrow sends ESCROW_CREATE
  it('broadcastEscrow sends ESCROW_CREATE wire type', () => {
    router.wireTransport(makeBroadcastFn(), makeSubscribeFn())
    const escrow = { payeePodId: REMOTE, amount: 100 }
    router.broadcastEscrow(escrow)

    assert.equal(broadcasts.length, 1)
    assert.equal(broadcasts[0].type, ESCROW_CREATE)
    assert.deepEqual(broadcasts[0].payload, escrow)
  })

  // 6. Inbound PAYMENT_OPEN opens a channel from the remote peer
  it('inbound PAYMENT_OPEN opens a channel from the remote peer', () => {
    router.wireTransport(makeBroadcastFn(), makeSubscribeFn())

    const handler = handlers.get(PAYMENT_OPEN)
    assert.ok(handler, 'PAYMENT_OPEN handler should be registered')

    // Remote pod sends an open request targeting us
    handler({ remotePodId: LOCAL, capacity: 200 }, REMOTE)

    const ch = router.getChannel(REMOTE)
    assert.ok(ch, 'channel should exist after inbound open')
    assert.equal(ch.capacity, 200)
  })

  // 7. Inbound PAYMENT_CLOSE closes a channel
  it('inbound PAYMENT_CLOSE closes a channel', () => {
    router.wireTransport(makeBroadcastFn(), makeSubscribeFn())

    // First open a channel and put it in open state
    const ch = router.openChannel(REMOTE, 500)
    ch.open(100)

    const closeHandler = handlers.get(PAYMENT_CLOSE)
    assert.ok(closeHandler, 'PAYMENT_CLOSE handler should be registered')

    closeHandler({}, REMOTE)

    assert.equal(router.getChannel(REMOTE), null, 'channel should be removed after close')
  })

  // 8. Inbound ESCROW_CREATE creates an escrow
  it('inbound ESCROW_CREATE creates an escrow', () => {
    router.wireTransport(makeBroadcastFn(), makeSubscribeFn())

    const escrowHandler = handlers.get(ESCROW_CREATE)
    assert.ok(escrowHandler, 'ESCROW_CREATE handler should be registered')

    escrowHandler({ payeePodId: LOCAL, amount: 50, conditions: { description: 'test' } }, REMOTE)

    const escrows = router.getEscrow().listByParty(REMOTE)
    assert.equal(escrows.length, 1)
    assert.equal(escrows[0].payerPodId, REMOTE)
    assert.equal(escrows[0].payeePodId, LOCAL)
    assert.equal(escrows[0].amount, 50)
  })

  // 9. Broadcast methods are no-ops before wireTransport
  it('broadcastOpen is a no-op before wireTransport', () => {
    // Should not throw
    router.broadcastOpen(REMOTE, 500)
  })

  it('broadcastUpdate is a no-op before wireTransport', () => {
    router.broadcastUpdate({ channelId: 'ch_1', sequence: 1, amount: 10 })
  })

  it('broadcastClose is a no-op before wireTransport', () => {
    router.broadcastClose(REMOTE, {})
  })

  it('broadcastEscrow is a no-op before wireTransport', () => {
    router.broadcastEscrow({ payeePodId: REMOTE, amount: 50 })
  })
})
