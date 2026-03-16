import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  GroupKeyManager,
  GroupState,
  GROUP_KEY_DISTRIBUTE,
  GROUP_KEY_ROTATE,
  GROUP_KEY_REQUEST,
  GROUP_KEY_ACK,
} from '../clawser-mesh-group-keys.js'

// ---------------------------------------------------------------------------
// Wire constants
// ---------------------------------------------------------------------------

describe('Wire constants', () => {
  it('GROUP_KEY_DISTRIBUTE is 0x80', () => {
    assert.equal(GROUP_KEY_DISTRIBUTE, 0x80)
  })
  it('GROUP_KEY_ROTATE is 0x81', () => {
    assert.equal(GROUP_KEY_ROTATE, 0x81)
  })
  it('GROUP_KEY_REQUEST is 0x82', () => {
    assert.equal(GROUP_KEY_REQUEST, 0x82)
  })
  it('GROUP_KEY_ACK is 0x83', () => {
    assert.equal(GROUP_KEY_ACK, 0x83)
  })
})

// ---------------------------------------------------------------------------
// GroupState
// ---------------------------------------------------------------------------

describe('GroupState', () => {
  it('stores epoch, key, members, and createdAt', () => {
    const gs = new GroupState({ epoch: 0, key: null, members: ['a', 'b'] })
    assert.equal(gs.epoch, 0)
    assert.equal(gs.key, null)
    assert.deepEqual(gs.members, ['a', 'b'])
    assert.equal(gs.memberCount, 2)
    assert.equal(typeof gs.createdAt, 'number')
  })

  it('accepts a custom createdAt', () => {
    const gs = new GroupState({ epoch: 1, key: null, members: ['x'], createdAt: 12345 })
    assert.equal(gs.createdAt, 12345)
  })

  it('throws on negative epoch', () => {
    assert.throws(() => new GroupState({ epoch: -1, key: null, members: [] }), /non-negative/)
  })

  it('throws on non-number epoch', () => {
    assert.throws(() => new GroupState({ epoch: 'bad', key: null, members: [] }), /non-negative/)
  })

  describe('hasMember', () => {
    it('returns true for a present member', () => {
      const gs = new GroupState({ epoch: 0, key: null, members: ['a', 'b'] })
      assert.equal(gs.hasMember('a'), true)
    })
    it('returns false for an absent member', () => {
      const gs = new GroupState({ epoch: 0, key: null, members: ['a'] })
      assert.equal(gs.hasMember('z'), false)
    })
  })

  describe('toJSON', () => {
    it('returns epoch, members, and createdAt without key', () => {
      const gs = new GroupState({ epoch: 3, key: null, members: ['a', 'b'], createdAt: 999 })
      const json = gs.toJSON()
      assert.deepEqual(json, { epoch: 3, members: ['a', 'b'], createdAt: 999 })
      assert.equal(json.key, undefined)
    })
  })
})

// ---------------------------------------------------------------------------
// GroupKeyManager
// ---------------------------------------------------------------------------

describe('GroupKeyManager', () => {
  let mgr

  beforeEach(() => {
    mgr = new GroupKeyManager({ localPodId: 'pod-local', groupId: 'group-1' })
  })

  it('exposes localPodId and groupId', () => {
    assert.equal(mgr.localPodId, 'pod-local')
    assert.equal(mgr.groupId, 'group-1')
  })

  it('starts with currentEpoch -1 and epochCount 0', () => {
    assert.equal(mgr.currentEpoch, -1)
    assert.equal(mgr.epochCount, 0)
  })

  it('getCurrentState returns null before init', () => {
    assert.equal(mgr.getCurrentState(), null)
  })

  it('throws if localPodId is missing', () => {
    assert.throws(() => new GroupKeyManager({ localPodId: '', groupId: 'g' }), /localPodId/)
  })

  it('throws if groupId is missing', () => {
    assert.throws(() => new GroupKeyManager({ localPodId: 'p', groupId: '' }), /groupId/)
  })

  // -----------------------------------------------------------------------
  // initGroup
  // -----------------------------------------------------------------------

  describe('initGroup', () => {
    it('creates epoch 0 with all members including localPodId', async () => {
      const state = await mgr.initGroup(['pod-a', 'pod-b'])
      assert.equal(state.epoch, 0)
      assert.equal(mgr.currentEpoch, 0)
      assert.equal(mgr.epochCount, 1)
      assert.ok(state.hasMember('pod-local'))
      assert.ok(state.hasMember('pod-a'))
      assert.ok(state.hasMember('pod-b'))
      assert.ok(state.key !== null)
    })

    it('auto-adds localPodId even if not in member list', async () => {
      const state = await mgr.initGroup(['pod-x'])
      assert.ok(state.hasMember('pod-local'))
      assert.ok(state.hasMember('pod-x'))
    })

    it('throws on empty members array', async () => {
      await assert.rejects(() => mgr.initGroup([]), /non-empty/)
    })

    it('throws on non-array members', async () => {
      await assert.rejects(() => mgr.initGroup('bad'), /non-empty/)
    })
  })

  // -----------------------------------------------------------------------
  // rotate
  // -----------------------------------------------------------------------

  describe('rotate', () => {
    it('advances epoch', async () => {
      await mgr.initGroup(['pod-a'])
      const rotated = await mgr.rotate()
      assert.equal(rotated.epoch, 1)
      assert.equal(mgr.currentEpoch, 1)
      assert.equal(mgr.epochCount, 2)
    })

    it('keeps same members when no newMembers passed', async () => {
      await mgr.initGroup(['pod-a', 'pod-b'])
      const rotated = await mgr.rotate()
      assert.ok(rotated.hasMember('pod-a'))
      assert.ok(rotated.hasMember('pod-b'))
      assert.ok(rotated.hasMember('pod-local'))
    })

    it('uses newMembers when passed', async () => {
      await mgr.initGroup(['pod-a'])
      const rotated = await mgr.rotate(['pod-z'])
      assert.ok(rotated.hasMember('pod-z'))
      assert.equal(rotated.hasMember('pod-a'), false)
    })
  })

  // -----------------------------------------------------------------------
  // removeMember — forward secrecy
  // -----------------------------------------------------------------------

  describe('removeMember', () => {
    it('rotates and excludes the removed member', async () => {
      await mgr.initGroup(['pod-a', 'pod-b'])
      const state = await mgr.removeMember('pod-a')
      assert.equal(state.hasMember('pod-a'), false)
      assert.ok(state.hasMember('pod-b'))
      assert.ok(state.hasMember('pod-local'))
      assert.equal(state.epoch, 1)
    })

    it('throws if pod is not a member', async () => {
      await mgr.initGroup(['pod-a'])
      await assert.rejects(() => mgr.removeMember('pod-nope'), /not a member/)
    })

    it('throws if no active group state', async () => {
      await assert.rejects(() => mgr.removeMember('pod-a'), /No active group state/)
    })

    it('throws when removing the last member', async () => {
      // localPodId is auto-added, so init with just localPodId
      await mgr.initGroup(['pod-local'])
      // Only pod-local is a member; removing it should fail
      await assert.rejects(() => mgr.removeMember('pod-local'), /last member/)
    })
  })

  // -----------------------------------------------------------------------
  // addMember
  // -----------------------------------------------------------------------

  describe('addMember', () => {
    it('rotates and includes the new member', async () => {
      await mgr.initGroup(['pod-a'])
      const state = await mgr.addMember('pod-new')
      assert.ok(state.hasMember('pod-new'))
      assert.ok(state.hasMember('pod-a'))
      assert.ok(state.hasMember('pod-local'))
      assert.equal(state.epoch, 1)
    })

    it('throws if pod is already a member', async () => {
      await mgr.initGroup(['pod-a'])
      await assert.rejects(() => mgr.addMember('pod-a'), /already a member/)
    })

    it('throws if no active group state', async () => {
      await assert.rejects(() => mgr.addMember('pod-a'), /No active group state/)
    })
  })

  // -----------------------------------------------------------------------
  // encrypt / decrypt round-trip
  // -----------------------------------------------------------------------

  describe('encrypt / decrypt', () => {
    it('round-trips successfully', async () => {
      await mgr.initGroup(['pod-a'])
      const plaintext = new TextEncoder().encode('hello mesh')
      const { ciphertext, iv, epoch } = await mgr.encrypt(plaintext)
      assert.ok(ciphertext instanceof Uint8Array)
      assert.ok(iv instanceof Uint8Array)
      assert.equal(iv.length, 12)
      assert.equal(epoch, 0)

      const decrypted = await mgr.decrypt(ciphertext, iv, epoch)
      assert.deepEqual(decrypted, plaintext)
    })

    it('throws on encrypt with no active key', async () => {
      await assert.rejects(() => mgr.encrypt(new Uint8Array([1])), /No active group key/)
    })

    it('throws on decrypt with wrong epoch', async () => {
      await mgr.initGroup(['pod-a'])
      const plaintext = new TextEncoder().encode('test')
      const { ciphertext, iv } = await mgr.encrypt(plaintext)
      await assert.rejects(() => mgr.decrypt(ciphertext, iv, 999), /No key for epoch 999/)
    })
  })

  // -----------------------------------------------------------------------
  // acceptEpoch
  // -----------------------------------------------------------------------

  describe('acceptEpoch', () => {
    it('stores an external epoch and advances currentEpoch', async () => {
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      )
      mgr.acceptEpoch(5, key, ['pod-local', 'pod-remote'])
      assert.equal(mgr.currentEpoch, 5)
      assert.equal(mgr.epochCount, 1)

      const state = mgr.getEpochState(5)
      assert.ok(state)
      assert.equal(state.epoch, 5)
      assert.ok(state.hasMember('pod-local'))
    })

    it('does not overwrite an existing epoch', async () => {
      await mgr.initGroup(['pod-a'])
      const originalState = mgr.getEpochState(0)
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      )
      mgr.acceptEpoch(0, key, ['other'])
      assert.equal(mgr.getEpochState(0), originalState)
    })

    it('does not regress currentEpoch for lower epoch numbers', async () => {
      await mgr.initGroup(['pod-a'])
      await mgr.rotate()
      assert.equal(mgr.currentEpoch, 1)

      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      )
      mgr.acceptEpoch(0, key, ['pod-local']) // lower epoch — already exists, skipped
      assert.equal(mgr.currentEpoch, 1)
    })
  })

  // -----------------------------------------------------------------------
  // wireTransport
  // -----------------------------------------------------------------------

  describe('wireTransport', () => {
    it('throws if arguments are not functions', () => {
      assert.throws(() => mgr.wireTransport('bad', () => {}), /must be functions/)
      assert.throws(() => mgr.wireTransport(() => {}, null), /must be functions/)
    })

    it('accepts valid functions', () => {
      assert.doesNotThrow(() => mgr.wireTransport(() => {}, () => {}))
    })
  })

  // -----------------------------------------------------------------------
  // Broadcast methods — no-ops before wireTransport
  // -----------------------------------------------------------------------

  describe('broadcast methods before wireTransport', () => {
    it('broadcastDistribute is a no-op', async () => {
      await mgr.initGroup(['pod-a'])
      assert.doesNotThrow(() => mgr.broadcastDistribute())
    })
    it('broadcastRotation is a no-op', async () => {
      await mgr.initGroup(['pod-a'])
      assert.doesNotThrow(() => mgr.broadcastRotation())
    })
    it('broadcastRequest is a no-op', () => {
      assert.doesNotThrow(() => mgr.broadcastRequest())
    })
    it('broadcastAck is a no-op', () => {
      assert.doesNotThrow(() => mgr.broadcastAck(0))
    })
  })

  // -----------------------------------------------------------------------
  // Broadcast methods — send correct wire types
  // -----------------------------------------------------------------------

  describe('broadcast methods after wireTransport', () => {
    let sent

    beforeEach(async () => {
      sent = []
      mgr.wireTransport(
        (wireType, payload) => sent.push({ wireType, payload }),
        (_wireType, _handler) => {},
      )
      await mgr.initGroup(['pod-a'])
    })

    it('broadcastDistribute sends GROUP_KEY_DISTRIBUTE', () => {
      mgr.broadcastDistribute()
      assert.equal(sent.length, 1)
      assert.equal(sent[0].wireType, GROUP_KEY_DISTRIBUTE)
      assert.equal(sent[0].payload.groupId, 'group-1')
      assert.equal(sent[0].payload.epoch, 0)
      assert.ok(Array.isArray(sent[0].payload.members))
    })

    it('broadcastRotation sends GROUP_KEY_ROTATE', () => {
      mgr.broadcastRotation()
      assert.equal(sent.length, 1)
      assert.equal(sent[0].wireType, GROUP_KEY_ROTATE)
      assert.equal(sent[0].payload.groupId, 'group-1')
      assert.equal(sent[0].payload.epoch, 0)
    })

    it('broadcastRequest sends GROUP_KEY_REQUEST', () => {
      mgr.broadcastRequest()
      assert.equal(sent.length, 1)
      assert.equal(sent[0].wireType, GROUP_KEY_REQUEST)
      assert.equal(sent[0].payload.groupId, 'group-1')
    })

    it('broadcastAck sends GROUP_KEY_ACK with epoch and podId', () => {
      mgr.broadcastAck(7)
      assert.equal(sent.length, 1)
      assert.equal(sent[0].wireType, GROUP_KEY_ACK)
      assert.equal(sent[0].payload.epoch, 7)
      assert.equal(sent[0].payload.podId, 'pod-local')
      assert.equal(sent[0].payload.groupId, 'group-1')
    })
  })

  // -----------------------------------------------------------------------
  // maxEpochHistory pruning
  // -----------------------------------------------------------------------

  describe('maxEpochHistory pruning', () => {
    it('prunes old epochs when history exceeds max', async () => {
      const small = new GroupKeyManager({
        localPodId: 'pod-local',
        groupId: 'group-1',
        maxEpochHistory: 3,
      })
      await small.initGroup(['pod-a'])        // epoch 0
      await small.rotate()                     // epoch 1
      await small.rotate()                     // epoch 2
      assert.equal(small.epochCount, 3)

      await small.rotate()                     // epoch 3 — triggers prune
      assert.equal(small.epochCount, 3)
      assert.equal(small.getEpochState(0), null)  // pruned
      assert.ok(small.getEpochState(1))
      assert.ok(small.getEpochState(2))
      assert.ok(small.getEpochState(3))
    })
  })
})
