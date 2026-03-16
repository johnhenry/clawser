import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ConsensusBackedLedger } from '../clawser-raijin-state-view.js'
import { PodKeyMapping } from '../clawser-raijin-bridge.js'
import { CreditLedger } from '../clawser-mesh-payments.js'

// ---------------------------------------------------------------------------
// Mock StateMachine
// ---------------------------------------------------------------------------

class MockStateMachine {
  #accounts = new Map()

  async getAccount(address) {
    const hex = Array.from(address, (b) => b.toString(16).padStart(2, '0')).join('')
    return this.#accounts.get(hex) || { balance: 0n, nonce: 0n, reputation: 0n }
  }

  setAccount(address, account) {
    const hex = Array.from(address, (b) => b.toString(16).padStart(2, '0')).join('')
    this.#accounts.set(hex, { balance: 0n, nonce: 0n, reputation: 0n, ...account })
  }
}

function makeKey(id) {
  const key = new Uint8Array(32)
  key[0] = id
  return key
}

// ---------------------------------------------------------------------------
// ConsensusBackedLedger — with PBFT
// ---------------------------------------------------------------------------

describe('ConsensusBackedLedger (PBFT enabled)', () => {
  let mapping
  let sm
  let submitted
  let view

  beforeEach(() => {
    mapping = new PodKeyMapping()
    mapping.register('pod-0', makeKey(0))
    mapping.register('pod-1', makeKey(1))
    mapping.register('pod-2', makeKey(2))

    sm = new MockStateMachine()
    sm.setAccount(makeKey(0), { balance: 1000n })
    sm.setAccount(makeKey(1), { balance: 500n })

    submitted = []

    view = new ConsensusBackedLedger({
      podId: 'pod-0',
      mapping,
      stateMachine: sm,
      submitTx: async (tx) => {
        submitted.push(tx)
        return 'tx_hash_123'
      },
    })
  })

  it('reports PBFT as enabled', () => {
    assert.equal(view.isPBFTEnabled, true)
  })

  it('reads balance from StateMachine', async () => {
    const balance = await view.getBalance()
    assert.equal(balance, 1000n)
  })

  it('reads balance of another pod', async () => {
    const balance = await view.getBalanceOf('pod-1')
    assert.equal(balance, 500n)
  })

  it('returns 0n for unknown account', async () => {
    const balance = await view.getBalanceOf('pod-2')
    assert.equal(balance, 0n)
  })

  it('submits transfer as raijin transaction', async () => {
    const result = await view.transfer('pod-1', 100n, 'test payment')
    assert.equal(result.txHash, 'tx_hash_123')
    assert.equal(submitted.length, 1)
    assert.deepEqual(submitted[0].from, makeKey(0))
    assert.deepEqual(submitted[0].to, makeKey(1))
    assert.equal(submitted[0].value, 100n)
    assert.equal(submitted[0].nonce, 0n)
  })

  it('increments nonce on each transfer', async () => {
    await view.transfer('pod-1', 10n)
    await view.transfer('pod-1', 20n)
    assert.equal(submitted[0].nonce, 0n)
    assert.equal(submitted[1].nonce, 1n)
  })

  it('converts number amount to bigint', async () => {
    await view.transfer('pod-1', 50)
    assert.equal(submitted[0].value, 50n)
  })

  it('encodes memo in tx data', async () => {
    await view.transfer('pod-1', 10n, 'hello')
    const decoded = new TextDecoder().decode(submitted[0].data)
    assert.equal(decoded, 'hello')
  })

  it('uses empty data when no memo', async () => {
    await view.transfer('pod-1', 10n)
    assert.equal(submitted[0].data.length, 0)
  })

  it('setNonce overrides the counter', async () => {
    view.setNonce(42n)
    await view.transfer('pod-1', 10n)
    assert.equal(submitted[0].nonce, 42n)
  })
})

// ---------------------------------------------------------------------------
// ConsensusBackedLedger — without PBFT (backward compat)
// ---------------------------------------------------------------------------

describe('ConsensusBackedLedger (PBFT disabled)', () => {
  let ledger
  let view

  beforeEach(() => {
    ledger = new CreditLedger('pod-0')
    ledger.credit(500, 'external', 'initial')

    view = new ConsensusBackedLedger({
      podId: 'pod-0',
      localLedger: ledger,
    })
  })

  it('reports PBFT as disabled', () => {
    assert.equal(view.isPBFTEnabled, false)
  })

  it('reads balance from local ledger', async () => {
    const balance = await view.getBalance()
    assert.equal(balance, 500)
  })

  it('getBalanceOf throws without PBFT', async () => {
    await assert.rejects(
      () => view.getBalanceOf('pod-1'),
      /requires PBFT/
    )
  })

  it('transfer does local debit', async () => {
    const result = await view.transfer('pod-1', 100, 'local transfer')
    assert.ok(result.local)
    assert.equal(result.local.type, 'debit')
    assert.equal(result.local.amount, 100)
    assert.equal(ledger.balance, 400)
  })

  it('transfer converts bigint to number for local ledger', async () => {
    const result = await view.transfer('pod-1', 50n)
    assert.equal(result.local.amount, 50)
  })
})

// ---------------------------------------------------------------------------
// ConsensusBackedLedger — no source configured
// ---------------------------------------------------------------------------

describe('ConsensusBackedLedger (no source)', () => {
  it('returns 0 balance', async () => {
    const view = new ConsensusBackedLedger({ podId: 'pod-0' })
    const balance = await view.getBalance()
    assert.equal(balance, 0)
  })

  it('transfer throws', async () => {
    const view = new ConsensusBackedLedger({ podId: 'pod-0' })
    await assert.rejects(
      () => view.transfer('pod-1', 100n),
      /No state source/
    )
  })

  it('rejects invalid podId', () => {
    assert.throws(() => new ConsensusBackedLedger({ podId: '' }), /non-empty string/)
    assert.throws(() => new ConsensusBackedLedger({}), /non-empty string/)
  })
})
