// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-consensus-transport.test.mjs
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  ConsensusManager,
  Proposal,
  VoteType,
  CONSENSUS_PROPOSE,
  CONSENSUS_VOTE,
  CONSENSUS_CLOSE,
  CONSENSUS_RESULT,
} from '../clawser-mesh-consensus.js'

describe('ConsensusManager wireTransport', () => {
  /** @type {ConsensusManager} */
  let mgr

  /** @type {Array<{type: number, payload: object}>} */
  let sent

  /** @type {Map<number, Array<(payload: object, fromPodId: string) => void>>} */
  let handlers

  /** @type {(type: number, payload: object) => void} */
  let broadcastFn

  /** @type {(type: number, handler: (payload: object, fromPodId: string) => void) => void} */
  let subscribeFn

  beforeEach(() => {
    mgr = new ConsensusManager()
    sent = []
    handlers = new Map()

    broadcastFn = (type, payload) => {
      sent.push({ type, payload })
    }

    subscribeFn = (type, handler) => {
      if (!handlers.has(type)) handlers.set(type, [])
      handlers.get(type).push(handler)
    }
  })

  // Helper to simulate an inbound message
  function deliver(type, payload, fromPodId) {
    const fns = handlers.get(type) || []
    for (const fn of fns) fn(payload, fromPodId)
  }

  // Helper to create a minimal proposal via the manager
  function createProposal(author = 'pod-a') {
    return mgr.propose(author, 'Test', ['yes', 'no'], VoteType.SIMPLE, { quorum: 1 })
  }

  // -------------------------------------------------------------------------
  // wireTransport validation
  // -------------------------------------------------------------------------

  describe('wireTransport requires functions', () => {
    it('throws if broadcastFn is not a function', () => {
      assert.throws(() => mgr.wireTransport('nope', subscribeFn), /must be functions/)
    })

    it('throws if subscribeFn is not a function', () => {
      assert.throws(() => mgr.wireTransport(broadcastFn, 42), /must be functions/)
    })

    it('throws if both are missing', () => {
      assert.throws(() => mgr.wireTransport(null, null), /must be functions/)
    })

    it('succeeds with two functions', () => {
      mgr.wireTransport(broadcastFn, subscribeFn)
      // no throw
    })
  })

  // -------------------------------------------------------------------------
  // Outbound broadcasts
  // -------------------------------------------------------------------------

  describe('broadcastProposal', () => {
    it('sends CONSENSUS_PROPOSE with proposal JSON', () => {
      mgr.wireTransport(broadcastFn, subscribeFn)
      const proposal = createProposal()
      mgr.broadcastProposal(proposal)

      assert.equal(sent.length, 1)
      assert.equal(sent[0].type, CONSENSUS_PROPOSE)
      assert.equal(sent[0].payload.proposalId, proposal.proposalId)
      assert.equal(sent[0].payload.title, 'Test')
      assert.deepEqual(sent[0].payload.options, ['yes', 'no'])
    })
  })

  describe('broadcastVote', () => {
    it('sends CONSENSUS_VOTE with vote payload', () => {
      mgr.wireTransport(broadcastFn, subscribeFn)
      mgr.broadcastVote('prop-1', 'pod-b', 'yes', 2)

      assert.equal(sent.length, 1)
      assert.equal(sent[0].type, CONSENSUS_VOTE)
      assert.deepEqual(sent[0].payload, {
        proposalId: 'prop-1',
        voterPodId: 'pod-b',
        choice: 'yes',
        weight: 2,
      })
    })
  })

  describe('broadcastClose', () => {
    it('sends CONSENSUS_CLOSE with proposalId', () => {
      mgr.wireTransport(broadcastFn, subscribeFn)
      mgr.broadcastClose('prop-1')

      assert.equal(sent.length, 1)
      assert.equal(sent[0].type, CONSENSUS_CLOSE)
      assert.deepEqual(sent[0].payload, { proposalId: 'prop-1' })
    })
  })

  describe('broadcastResult', () => {
    it('sends CONSENSUS_RESULT with proposalId and result', () => {
      mgr.wireTransport(broadcastFn, subscribeFn)
      const result = { winner: { choice: 'yes', votes: 3, weight: 3, passed: true } }
      mgr.broadcastResult('prop-1', result)

      assert.equal(sent.length, 1)
      assert.equal(sent[0].type, CONSENSUS_RESULT)
      assert.equal(sent[0].payload.proposalId, 'prop-1')
      assert.deepEqual(sent[0].payload.winner, result.winner)
    })
  })

  // -------------------------------------------------------------------------
  // Broadcast methods are no-ops before wireTransport
  // -------------------------------------------------------------------------

  describe('broadcast no-ops before wireTransport', () => {
    it('broadcastProposal is a no-op', () => {
      const proposal = createProposal()
      mgr.broadcastProposal(proposal) // should not throw
      assert.equal(sent.length, 0)
    })

    it('broadcastVote is a no-op', () => {
      mgr.broadcastVote('prop-1', 'pod-b', 'yes')
      assert.equal(sent.length, 0)
    })

    it('broadcastClose is a no-op', () => {
      mgr.broadcastClose('prop-1')
      assert.equal(sent.length, 0)
    })

    it('broadcastResult is a no-op', () => {
      mgr.broadcastResult('prop-1', {})
      assert.equal(sent.length, 0)
    })
  })

  // -------------------------------------------------------------------------
  // Inbound handlers
  // -------------------------------------------------------------------------

  describe('inbound CONSENSUS_PROPOSE', () => {
    it('creates a proposal in the manager', () => {
      mgr.wireTransport(broadcastFn, subscribeFn)
      assert.equal(mgr.size, 0)

      const proposalData = {
        proposalId: 'remote-prop-1',
        authorPodId: 'pod-remote',
        title: 'Remote proposal',
        description: null,
        options: ['a', 'b'],
        voteType: 'simple',
        weights: null,
        quorum: 1,
        deadline: null,
        createdAt: Date.now(),
        status: 'open',
      }

      deliver(CONSENSUS_PROPOSE, proposalData, 'pod-remote')

      assert.equal(mgr.size, 1)
      const p = mgr.getProposal('remote-prop-1')
      assert.ok(p)
      assert.equal(p.title, 'Remote proposal')
      assert.equal(p.authorPodId, 'pod-remote')
      assert.deepEqual(p.options, ['a', 'b'])
    })

    it('ignores malformed proposals', () => {
      mgr.wireTransport(broadcastFn, subscribeFn)
      deliver(CONSENSUS_PROPOSE, { bad: 'data' }, 'pod-x')
      assert.equal(mgr.size, 0)
    })
  })

  describe('inbound CONSENSUS_VOTE', () => {
    it('casts a vote on an existing proposal', () => {
      mgr.wireTransport(broadcastFn, subscribeFn)
      const proposal = createProposal('pod-a')

      deliver(CONSENSUS_VOTE, {
        proposalId: proposal.proposalId,
        choice: 'yes',
        weight: 1,
      }, 'pod-voter')

      const tally = mgr.getTally(proposal.proposalId)
      assert.ok(tally)
      assert.equal(tally.totalVotes, 1)
      assert.deepEqual(tally.voterList, ['pod-voter'])
    })

    it('uses fromPodId as the voter identity', () => {
      mgr.wireTransport(broadcastFn, subscribeFn)
      const proposal = createProposal('pod-a')

      deliver(CONSENSUS_VOTE, {
        proposalId: proposal.proposalId,
        choice: 'no',
      }, 'pod-special')

      const tally = mgr.getTally(proposal.proposalId)
      assert.deepEqual(tally.voterList, ['pod-special'])
    })

    it('ignores votes for nonexistent proposals', () => {
      mgr.wireTransport(broadcastFn, subscribeFn)
      // Should not throw
      deliver(CONSENSUS_VOTE, {
        proposalId: 'nonexistent',
        choice: 'yes',
      }, 'pod-x')
      assert.equal(mgr.size, 0)
    })
  })

  describe('inbound CONSENSUS_CLOSE', () => {
    it('closes an open proposal', () => {
      mgr.wireTransport(broadcastFn, subscribeFn)
      const proposal = createProposal('pod-a')
      assert.equal(proposal.status, 'open')

      deliver(CONSENSUS_CLOSE, { proposalId: proposal.proposalId }, 'pod-a')

      assert.equal(proposal.status, 'closed')
    })

    it('ignores close for nonexistent proposals', () => {
      mgr.wireTransport(broadcastFn, subscribeFn)
      deliver(CONSENSUS_CLOSE, { proposalId: 'nope' }, 'pod-x')
      // no throw, no side effects
      assert.equal(mgr.size, 0)
    })
  })
})
