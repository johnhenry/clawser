import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  MigrationEngine,
  MIGRATION_INIT,
  MIGRATION_CHECKPOINT,
  MIGRATION_TRANSFER,
  MIGRATION_ACTIVATE,
} from '../clawser-mesh-migration.js'

describe('MigrationEngine wireTransport', () => {
  let engine
  const LOCAL_POD = 'pod-local'
  const TARGET_POD = 'pod-target'

  beforeEach(() => {
    engine = new MigrationEngine(LOCAL_POD)
  })

  // ---- 1. wireTransport requires functions --------------------------------

  it('throws when broadcastFn is not a function', () => {
    assert.throws(
      () => engine.wireTransport('not-a-fn', () => {}),
      /broadcastFn and subscribeFn must be functions/,
    )
  })

  it('throws when subscribeFn is not a function', () => {
    assert.throws(
      () => engine.wireTransport(() => {}, null),
      /broadcastFn and subscribeFn must be functions/,
    )
  })

  it('throws when both args are missing', () => {
    assert.throws(
      () => engine.wireTransport(),
      /broadcastFn and subscribeFn must be functions/,
    )
  })

  it('accepts two functions without throwing', () => {
    assert.doesNotThrow(() => {
      engine.wireTransport(() => {}, () => {})
    })
  })

  // ---- 6. Broadcast methods are no-ops before wireTransport ---------------

  it('broadcastInit is a no-op before wireTransport', async () => {
    const checkpoint = await engine.createCheckpoint({ x: 1 })
    const plan = engine.initiateMigration(TARGET_POD, checkpoint)
    // Should not throw — just silently does nothing
    assert.doesNotThrow(() => engine.broadcastInit(plan))
  })

  it('broadcastCheckpoint is a no-op before wireTransport', async () => {
    const checkpoint = await engine.createCheckpoint({ x: 1 })
    assert.doesNotThrow(() => engine.broadcastCheckpoint('mig_1', checkpoint))
  })

  it('broadcastTransfer is a no-op before wireTransport', () => {
    assert.doesNotThrow(() => engine.broadcastTransfer('mig_1', { hello: 'world' }))
  })

  it('broadcastActivate is a no-op before wireTransport', () => {
    assert.doesNotThrow(() => engine.broadcastActivate('mig_1'))
  })

  // ---- 2. broadcastInit sends MIGRATION_INIT with plan data ---------------

  it('broadcastInit sends MIGRATION_INIT with plan fields', async () => {
    const calls = []
    engine.wireTransport(
      (type, payload) => calls.push({ type, payload }),
      () => {},
    )

    const checkpoint = await engine.createCheckpoint({ state: 42 })
    const plan = engine.initiateMigration(TARGET_POD, checkpoint, {
      reason: 'scale-down',
      priority: 'urgent',
    })

    engine.broadcastInit(plan)

    assert.equal(calls.length, 1)
    assert.equal(calls[0].type, MIGRATION_INIT)
    assert.equal(calls[0].payload.migrationId, plan.migrationId)
    assert.equal(calls[0].payload.sourcePodId, LOCAL_POD)
    assert.equal(calls[0].payload.targetPodId, TARGET_POD)
    assert.equal(calls[0].payload.reason, 'scale-down')
    assert.equal(calls[0].payload.priority, 'urgent')
  })

  // ---- 3. broadcastCheckpoint sends MIGRATION_CHECKPOINT ------------------

  it('broadcastCheckpoint sends MIGRATION_CHECKPOINT with checkpoint JSON', async () => {
    const calls = []
    engine.wireTransport(
      (type, payload) => calls.push({ type, payload }),
      () => {},
    )

    const checkpoint = await engine.createCheckpoint({ key: 'value' })
    engine.broadcastCheckpoint('mig_test', checkpoint)

    assert.equal(calls.length, 1)
    assert.equal(calls[0].type, MIGRATION_CHECKPOINT)
    assert.equal(calls[0].payload.migrationId, 'mig_test')
    assert.equal(calls[0].payload.checkpointId, checkpoint.checkpointId)
    assert.equal(calls[0].payload.sourcePodId, LOCAL_POD)
    assert.deepStrictEqual(calls[0].payload.data, { key: 'value' })
    assert.equal(typeof calls[0].payload.dataHash, 'string') // hex string from toJSON
  })

  // ---- 4. broadcastTransfer sends MIGRATION_TRANSFER ----------------------

  it('broadcastTransfer sends MIGRATION_TRANSFER with data', () => {
    const calls = []
    engine.wireTransport(
      (type, payload) => calls.push({ type, payload }),
      () => {},
    )

    const transferData = { chunks: [1, 2, 3] }
    engine.broadcastTransfer('mig_xfer', transferData)

    assert.equal(calls.length, 1)
    assert.equal(calls[0].type, MIGRATION_TRANSFER)
    assert.equal(calls[0].payload.migrationId, 'mig_xfer')
    assert.deepStrictEqual(calls[0].payload.data, transferData)
  })

  // ---- 5. broadcastActivate sends MIGRATION_ACTIVATE ----------------------

  it('broadcastActivate sends MIGRATION_ACTIVATE with migrationId', () => {
    const calls = []
    engine.wireTransport(
      (type, payload) => calls.push({ type, payload }),
      () => {},
    )

    engine.broadcastActivate('mig_activate_1')

    assert.equal(calls.length, 1)
    assert.equal(calls[0].type, MIGRATION_ACTIVATE)
    assert.equal(calls[0].payload.migrationId, 'mig_activate_1')
  })

  // ---- 7. Inbound handlers ------------------------------------------------

  it('subscribes to all four wire types', () => {
    const subscribedTypes = []
    engine.wireTransport(
      () => {},
      (wireType, _handler) => subscribedTypes.push(wireType),
    )

    assert.ok(subscribedTypes.includes(MIGRATION_INIT))
    assert.ok(subscribedTypes.includes(MIGRATION_CHECKPOINT))
    assert.ok(subscribedTypes.includes(MIGRATION_TRANSFER))
    assert.ok(subscribedTypes.includes(MIGRATION_ACTIVATE))
    assert.equal(subscribedTypes.length, 4)
  })

  it('inbound MIGRATION_INIT handler does not throw on valid payload', () => {
    const handlers = {}
    engine.wireTransport(
      () => {},
      (wireType, handler) => { handlers[wireType] = handler },
    )

    assert.doesNotThrow(() => {
      handlers[MIGRATION_INIT](
        { migrationId: 'mig_1', sourcePodId: 'pod-a', targetPodId: LOCAL_POD },
        'pod-a',
      )
    })
  })

  it('inbound MIGRATION_CHECKPOINT handler does not throw on malformed payload', async () => {
    const handlers = {}
    engine.wireTransport(
      () => {},
      (wireType, handler) => { handlers[wireType] = handler },
    )

    // Malformed checkpoint: missing required fields — the handler catches errors
    await assert.doesNotReject(async () => {
      await handlers[MIGRATION_CHECKPOINT]({ bad: 'data' }, 'pod-remote')
    })
  })

  it('inbound MIGRATION_TRANSFER handler does not throw', () => {
    const handlers = {}
    engine.wireTransport(
      () => {},
      (wireType, handler) => { handlers[wireType] = handler },
    )

    assert.doesNotThrow(() => {
      handlers[MIGRATION_TRANSFER]({ migrationId: 'mig_1', data: {} }, 'pod-remote')
    })
  })

  it('inbound MIGRATION_ACTIVATE handler does not throw', () => {
    const handlers = {}
    engine.wireTransport(
      () => {},
      (wireType, handler) => { handlers[wireType] = handler },
    )

    assert.doesNotThrow(() => {
      handlers[MIGRATION_ACTIVATE]({ migrationId: 'mig_1' }, 'pod-remote')
    })
  })

  it('inbound MIGRATION_CHECKPOINT handler accepts valid checkpoint', async () => {
    const handlers = {}
    engine.wireTransport(
      () => {},
      (wireType, handler) => { handlers[wireType] = handler },
    )

    // Create a valid checkpoint and serialize it
    const checkpoint = await engine.createCheckpoint({ migrated: true })
    const json = { migrationId: 'mig_valid', ...checkpoint.toJSON() }

    // Should process without error
    await assert.doesNotReject(async () => {
      await handlers[MIGRATION_CHECKPOINT](json, 'pod-remote')
    })
  })
})
