import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Stub browser globals before import
globalThis.BrowserTool = class { constructor() {} }

import { AutonomyController } from '../clawser-agent.js'

describe('AutonomyController — Monthly Cost Limits', () => {
  let ctrl

  beforeEach(() => {
    ctrl = new AutonomyController({
      maxCostPerMonthCents: 5000, // $50/month
      maxCostPerDayCents: 500,    // $5/day
    })
  })

  it('exposes maxCostPerMonthCents getter/setter', () => {
    assert.equal(ctrl.maxCostPerMonthCents, 5000)
    ctrl.maxCostPerMonthCents = 10000
    assert.equal(ctrl.maxCostPerMonthCents, 10000)
  })

  it('defaults to Infinity when not specified', () => {
    const c = new AutonomyController()
    assert.equal(c.maxCostPerMonthCents, Infinity)
  })

  it('tracks monthly cost in stats', () => {
    ctrl.recordCost(100)
    const stats = ctrl.stats
    assert.equal(stats.costThisMonthCents, 100)
    assert.equal(stats.maxCostPerMonthCents, 5000)
  })

  it('accumulates monthly cost across multiple recordCost calls', () => {
    ctrl.recordCost(100)
    ctrl.recordCost(200)
    ctrl.recordCost(300)
    assert.equal(ctrl.stats.costThisMonthCents, 600)
  })

  it('blocks when monthly limit is exceeded (no daily limit)', () => {
    // Use a controller with no daily limit to isolate monthly behavior
    const c = new AutonomyController({ maxCostPerMonthCents: 5000 })
    c.recordCost(5000)
    const check = c.checkLimits()
    assert.equal(check.blocked, true)
    assert.equal(check.limitType, 'monthly_cost')
    assert.ok(check.reason.includes('/month'))
  })

  it('does not block when under monthly limit', () => {
    const c = new AutonomyController({ maxCostPerMonthCents: 5000 })
    c.recordCost(4999)
    const check = c.checkLimits()
    assert.equal(check.blocked, false)
  })

  it('blocks at daily limit before monthly limit', () => {
    // Daily limit is 500, monthly is 5000
    ctrl.recordCost(500)
    const check = ctrl.checkLimits()
    assert.equal(check.blocked, true)
    assert.equal(check.limitType, 'cost') // daily, not monthly
  })

  it('resets monthly cost on reset()', () => {
    ctrl.recordCost(3000)
    ctrl.reset()
    assert.equal(ctrl.stats.costThisMonthCents, 0)
    assert.equal(ctrl.checkLimits().blocked, false)
  })

  it('includes monthly stats in stats object', () => {
    const stats = ctrl.stats
    assert.ok('costThisMonthCents' in stats)
    assert.ok('maxCostPerMonthCents' in stats)
  })

  it('monthly limit Infinity means no monthly blocking', () => {
    const c = new AutonomyController({ maxCostPerMonthCents: Infinity })
    c.recordCost(999999)
    assert.equal(c.checkLimits().blocked, false)
  })
})
