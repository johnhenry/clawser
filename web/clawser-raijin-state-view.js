/**
 * clawser-raijin-state-view.js — Consensus-backed ledger adapter.
 *
 * Provides ConsensusBackedLedger: reads balances from raijin's StateMachine
 * and optionally submits transfers as raijin transactions. When PBFT is
 * disabled, falls back to CreditLedger's local-only behavior.
 *
 * No browser-only imports at module level.
 *
 * Run tests:
 *   cd /Users/johnhenry/Projects/clawser && node --import ./web/test/_setup-globals.mjs --test web/test/clawser-raijin-state-view.test.mjs
 */

import { PodKeyMapping } from './clawser-raijin-bridge.js'

// ---------------------------------------------------------------------------
// ConsensusBackedLedger
// ---------------------------------------------------------------------------

/**
 * Adapts CreditLedger to read from raijin StateMachine state.
 *
 * When a StateMachine is provided (PBFT enabled):
 * - `getBalance()` reads the consensus-committed balance
 * - `transfer()` submits a raijin Transaction and returns a pending tx hash
 *
 * When no StateMachine is provided (PBFT disabled / backward compat):
 * - `getBalance()` reads from the local CreditLedger
 * - `transfer()` does a local CreditLedger transfer
 *
 * @example
 * ```js
 * // With PBFT
 * const view = new ConsensusBackedLedger({
 *   podId: 'pod-0',
 *   mapping: podKeyMapping,
 *   stateMachine: sm,
 *   submitTx: (tx) => mempool.add(tx),
 * })
 *
 * const balance = await view.getBalance()
 * await view.transfer('pod-1', 100n, 'payment')
 *
 * // Without PBFT (backward compat)
 * const localView = new ConsensusBackedLedger({
 *   podId: 'pod-0',
 *   localLedger: creditLedger,
 * })
 * ```
 */
export class ConsensusBackedLedger {
  #podId
  #mapping
  #stateMachine
  #submitTx
  #localLedger
  #nonce = 0n

  /**
   * @param {object} opts
   * @param {string} opts.podId - This pod's ID
   * @param {PodKeyMapping} [opts.mapping] - Pod ↔ key mapping (required if stateMachine provided)
   * @param {object} [opts.stateMachine] - raijin StateMachine instance
   * @param {(tx: object) => Promise<string>} [opts.submitTx] - Function to submit a transaction
   * @param {import('./clawser-mesh-payments.js').CreditLedger} [opts.localLedger] - Fallback ledger
   */
  constructor(opts) {
    if (!opts.podId || typeof opts.podId !== 'string') {
      throw new Error('podId must be a non-empty string')
    }
    this.#podId = opts.podId
    this.#mapping = opts.mapping || null
    this.#stateMachine = opts.stateMachine || null
    this.#submitTx = opts.submitTx || null
    this.#localLedger = opts.localLedger || null
  }

  /** Whether this ledger is backed by consensus state. */
  get isPBFTEnabled() {
    return this.#stateMachine !== null
  }

  /** This pod's ID. */
  get podId() {
    return this.#podId
  }

  /**
   * Get the current balance.
   *
   * If PBFT enabled: reads from StateMachine (consensus-committed state).
   * If PBFT disabled: reads from local CreditLedger.
   *
   * @returns {Promise<bigint|number>} Balance (bigint if PBFT, number if local)
   */
  async getBalance() {
    if (this.#stateMachine) {
      const key = this.#mapping.podIdToKey(this.#podId)
      const account = await this.#stateMachine.getAccount(key)
      return account.balance
    }
    if (this.#localLedger) {
      return this.#localLedger.balance
    }
    return 0
  }

  /**
   * Get the balance for a specific pod.
   *
   * @param {string} podId
   * @returns {Promise<bigint>}
   */
  async getBalanceOf(podId) {
    if (!this.#stateMachine) {
      throw new Error('getBalanceOf requires PBFT to be enabled')
    }
    const key = this.#mapping.podIdToKey(podId)
    const account = await this.#stateMachine.getAccount(key)
    return account.balance
  }

  /**
   * Transfer credits to another pod.
   *
   * If PBFT enabled: creates and submits a raijin Transaction.
   * If PBFT disabled: uses CreditLedger.transfer() locally.
   *
   * @param {string} toPodId - Destination pod ID
   * @param {bigint|number} amount - Amount to transfer
   * @param {string} [memo] - Optional memo
   * @returns {Promise<{ txHash?: string, local?: object }>}
   */
  async transfer(toPodId, amount, memo) {
    if (this.#stateMachine && this.#submitTx && this.#mapping) {
      const fromKey = this.#mapping.podIdToKey(this.#podId)
      const toKey = this.#mapping.podIdToKey(toPodId)
      const value = typeof amount === 'number' ? BigInt(amount) : amount

      const tx = {
        from: fromKey,
        nonce: this.#nonce++,
        to: toKey,
        value,
        data: memo ? new TextEncoder().encode(memo) : new Uint8Array(0),
        signature: new Uint8Array(64), // Placeholder — real signing happens in SDK
        chainId: 1n,
      }

      const txHash = await this.#submitTx(tx)
      return { txHash }
    }

    if (this.#localLedger) {
      // Need a peer ledger reference — caller must provide via transfer()
      // For backward compat, just do a local debit
      const numAmount = typeof amount === 'bigint' ? Number(amount) : amount
      const entry = this.#localLedger.debit(numAmount, toPodId, memo)
      return { local: entry }
    }

    throw new Error('No state source configured')
  }

  /**
   * Set the nonce for transaction submission (for testing or sync).
   * @param {bigint} nonce
   */
  setNonce(nonce) {
    this.#nonce = nonce
  }
}
