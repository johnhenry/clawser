/**
 * Wire-code registry uniqueness and range enforcement.
 *
 * Ensures:
 *  - All MESH_TYPE values are unique (no two keys share a value)
 *  - All values are in valid ranges (0xA0–0xD7, not in reserved 0xF0–0xFF)
 *  - Subsystem re-exports match the canonical registry
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { MESH_TYPE } from '../packages/mesh-primitives/src/constants.mjs'
import { SWARM_JOIN, SWARM_LEAVE, SWARM_HEARTBEAT, SWARM_TASK_ASSIGN } from '../clawser-mesh-swarm.js'
import { AUDIT_ENTRY, AUDIT_CHAIN_QUERY, AUDIT_CHAIN_RESPONSE } from '../clawser-mesh-audit.js'
import { RESOURCE_ADVERTISE, RESOURCE_DISCOVER, RESOURCE_DISCOVER_RESPONSE, COMPUTE_REQUEST, COMPUTE_RESULT, COMPUTE_PROGRESS } from '../clawser-mesh-resources.js'
import { QUOTA_UPDATE, QUOTA_VIOLATION, USAGE_REPORT } from '../clawser-mesh-quotas.js'
import { PAYMENT_OPEN, PAYMENT_UPDATE, PAYMENT_CLOSE, ESCROW_CREATE } from '../clawser-mesh-payments.js'
import { GPU_PROBE, GPU_SHARD_ASSIGN, GPU_GRADIENT_PUSH, GPU_TRAIN_CONTROL } from '../clawser-mesh-gpu.js'
import { ORCH_LIST_PODS, ORCH_POD_STATUS, ORCH_EXEC, ORCH_DEPLOY, ORCH_DRAIN, ORCH_EXPOSE, ORCH_ROUTE } from '../clawser-mesh-orchestrator.js'
import { LISTING_PUBLISH, LISTING_QUERY, LISTING_RESPONSE, LISTING_PURCHASE, REVIEW_SUBMIT, REVIEW_QUERY } from '../clawser-mesh-marketplace.js'
import { APP_MANIFEST, APP_INSTALL, APP_UNINSTALL, APP_STATE_SYNC, APP_RPC, APP_EVENT } from '../clawser-mesh-apps.js'
import { CONSENSUS_PROPOSE, CONSENSUS_VOTE, CONSENSUS_CLOSE, CONSENSUS_RESULT } from '../clawser-mesh-consensus.js'

describe('MESH_TYPE wire-code registry', () => {
  it('has no duplicate values', () => {
    const entries = Object.entries(MESH_TYPE)
    const seen = new Map()
    for (const [key, value] of entries) {
      if (seen.has(value)) {
        assert.fail(`Duplicate wire code 0x${value.toString(16)}: ${seen.get(value)} and ${key}`)
      }
      seen.set(value, key)
    }
  })

  it('all values are in valid range (0xA0–0xEF)', () => {
    for (const [key, value] of Object.entries(MESH_TYPE)) {
      assert.ok(
        value >= 0xa0 && value <= 0xef,
        `${key} = 0x${value.toString(16)} is outside valid range 0xA0–0xEF`
      )
    }
  })

  it('no values in reserved 0xF0–0xFF range', () => {
    for (const [key, value] of Object.entries(MESH_TYPE)) {
      assert.ok(
        value < 0xf0,
        `${key} = 0x${value.toString(16)} is in reserved 0xF0–0xFF range`
      )
    }
  })

  it('extended subsystem codes are in 0xC0–0xEC range', () => {
    const extended = [
      'SWARM_JOIN', 'SWARM_LEAVE', 'SWARM_HEARTBEAT', 'SWARM_TASK_ASSIGN',
      'AUDIT_ENTRY', 'AUDIT_CHAIN_QUERY', 'AUDIT_CHAIN_RESPONSE',
      'RESOURCE_ADVERTISE', 'RESOURCE_DISCOVER', 'RESOURCE_DISCOVER_RESPONSE',
      'COMPUTE_REQUEST', 'COMPUTE_RESULT', 'COMPUTE_PROGRESS',
      'QUOTA_UPDATE', 'QUOTA_VIOLATION', 'USAGE_REPORT',
      'PAYMENT_OPEN', 'PAYMENT_UPDATE', 'PAYMENT_CLOSE', 'ESCROW_CREATE',
      'GPU_PROBE', 'GPU_SHARD_ASSIGN', 'GPU_GRADIENT_PUSH', 'GPU_TRAIN_CONTROL',
      'ORCH_LIST_PODS', 'ORCH_POD_STATUS', 'ORCH_EXEC', 'ORCH_DEPLOY',
      'ORCH_DRAIN', 'ORCH_EXPOSE', 'ORCH_ROUTE',
      'LISTING_PUBLISH', 'LISTING_QUERY', 'LISTING_RESPONSE', 'LISTING_PURCHASE',
      'REVIEW_SUBMIT', 'REVIEW_QUERY',
      'APP_MANIFEST', 'APP_INSTALL', 'APP_UNINSTALL', 'APP_STATE_SYNC',
      'APP_RPC', 'APP_EVENT',
      'CONSENSUS_CLOSE', 'CONSENSUS_RESULT',
    ]
    for (const name of extended) {
      const value = MESH_TYPE[name]
      assert.ok(value !== undefined, `${name} missing from MESH_TYPE`)
      assert.ok(
        value >= 0xc0 && value <= 0xec,
        `${name} = 0x${value.toString(16)} is outside extended range 0xC0–0xEC`
      )
    }
  })
})

describe('Subsystem wire-code re-exports match registry', () => {
  it('swarm constants match MESH_TYPE', () => {
    assert.equal(SWARM_JOIN, MESH_TYPE.SWARM_JOIN)
    assert.equal(SWARM_LEAVE, MESH_TYPE.SWARM_LEAVE)
    assert.equal(SWARM_HEARTBEAT, MESH_TYPE.SWARM_HEARTBEAT)
    assert.equal(SWARM_TASK_ASSIGN, MESH_TYPE.SWARM_TASK_ASSIGN)
  })

  it('audit constants match MESH_TYPE', () => {
    assert.equal(AUDIT_ENTRY, MESH_TYPE.AUDIT_ENTRY)
    assert.equal(AUDIT_CHAIN_QUERY, MESH_TYPE.AUDIT_CHAIN_QUERY)
    assert.equal(AUDIT_CHAIN_RESPONSE, MESH_TYPE.AUDIT_CHAIN_RESPONSE)
  })

  it('resource constants match MESH_TYPE', () => {
    assert.equal(RESOURCE_ADVERTISE, MESH_TYPE.RESOURCE_ADVERTISE)
    assert.equal(RESOURCE_DISCOVER, MESH_TYPE.RESOURCE_DISCOVER)
    assert.equal(RESOURCE_DISCOVER_RESPONSE, MESH_TYPE.RESOURCE_DISCOVER_RESPONSE)
    assert.equal(COMPUTE_REQUEST, MESH_TYPE.COMPUTE_REQUEST)
    assert.equal(COMPUTE_RESULT, MESH_TYPE.COMPUTE_RESULT)
    assert.equal(COMPUTE_PROGRESS, MESH_TYPE.COMPUTE_PROGRESS)
  })

  it('quota constants match MESH_TYPE', () => {
    assert.equal(QUOTA_UPDATE, MESH_TYPE.QUOTA_UPDATE)
    assert.equal(QUOTA_VIOLATION, MESH_TYPE.QUOTA_VIOLATION)
    assert.equal(USAGE_REPORT, MESH_TYPE.USAGE_REPORT)
  })

  it('payment constants match MESH_TYPE', () => {
    assert.equal(PAYMENT_OPEN, MESH_TYPE.PAYMENT_OPEN)
    assert.equal(PAYMENT_UPDATE, MESH_TYPE.PAYMENT_UPDATE)
    assert.equal(PAYMENT_CLOSE, MESH_TYPE.PAYMENT_CLOSE)
    assert.equal(ESCROW_CREATE, MESH_TYPE.ESCROW_CREATE)
  })

  it('GPU constants match MESH_TYPE', () => {
    assert.equal(GPU_PROBE, MESH_TYPE.GPU_PROBE)
    assert.equal(GPU_SHARD_ASSIGN, MESH_TYPE.GPU_SHARD_ASSIGN)
    assert.equal(GPU_GRADIENT_PUSH, MESH_TYPE.GPU_GRADIENT_PUSH)
    assert.equal(GPU_TRAIN_CONTROL, MESH_TYPE.GPU_TRAIN_CONTROL)
  })

  it('orchestrator constants match MESH_TYPE', () => {
    assert.equal(ORCH_LIST_PODS, MESH_TYPE.ORCH_LIST_PODS)
    assert.equal(ORCH_POD_STATUS, MESH_TYPE.ORCH_POD_STATUS)
    assert.equal(ORCH_EXEC, MESH_TYPE.ORCH_EXEC)
    assert.equal(ORCH_DEPLOY, MESH_TYPE.ORCH_DEPLOY)
    assert.equal(ORCH_DRAIN, MESH_TYPE.ORCH_DRAIN)
    assert.equal(ORCH_EXPOSE, MESH_TYPE.ORCH_EXPOSE)
    assert.equal(ORCH_ROUTE, MESH_TYPE.ORCH_ROUTE)
  })

  it('marketplace constants match MESH_TYPE', () => {
    assert.equal(LISTING_PUBLISH, MESH_TYPE.LISTING_PUBLISH)
    assert.equal(LISTING_QUERY, MESH_TYPE.LISTING_QUERY)
    assert.equal(LISTING_RESPONSE, MESH_TYPE.LISTING_RESPONSE)
    assert.equal(LISTING_PURCHASE, MESH_TYPE.LISTING_PURCHASE)
    assert.equal(REVIEW_SUBMIT, MESH_TYPE.REVIEW_SUBMIT)
    assert.equal(REVIEW_QUERY, MESH_TYPE.REVIEW_QUERY)
  })

  it('app distribution constants match MESH_TYPE', () => {
    assert.equal(APP_MANIFEST, MESH_TYPE.APP_MANIFEST)
    assert.equal(APP_INSTALL, MESH_TYPE.APP_INSTALL)
    assert.equal(APP_UNINSTALL, MESH_TYPE.APP_UNINSTALL)
    assert.equal(APP_STATE_SYNC, MESH_TYPE.APP_STATE_SYNC)
    assert.equal(APP_RPC, MESH_TYPE.APP_RPC)
    assert.equal(APP_EVENT, MESH_TYPE.APP_EVENT)
  })

  it('consensus constants match MESH_TYPE', () => {
    assert.equal(CONSENSUS_PROPOSE, MESH_TYPE.CONSENSUS_PROPOSE)
    assert.equal(CONSENSUS_VOTE, MESH_TYPE.CONSENSUS_VOTE)
    assert.equal(CONSENSUS_CLOSE, MESH_TYPE.CONSENSUS_CLOSE)
    assert.equal(CONSENSUS_RESULT, MESH_TYPE.CONSENSUS_RESULT)
  })
})
