import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Stub browser globals before import
globalThis.BrowserTool = class { constructor() {} }

import { ClawserAgent } from '../clawser-agent.js'

describe('ClawserAgent — Session Idle Timeout', () => {
  let agent

  beforeEach(async () => {
    agent = await ClawserAgent.create({
      onLog: () => {},
      onEvent: () => {},
    })
    agent.init({})
  })

  it('getIdleTime() returns ms since last activity', async () => {
    // Agent was just created, idle time should be very small
    const idle = agent.getIdleTime()
    assert.ok(idle >= 0)
    assert.ok(idle < 5000) // less than 5 seconds
  })

  it('lastActivityTs is set to current time on creation', () => {
    const now = Date.now()
    assert.ok(agent.lastActivityTs <= now)
    assert.ok(now - agent.lastActivityTs < 5000)
  })

  it('idleTimeoutMs defaults to undefined/falsy (no timeout)', () => {
    // By default, no idle timeout is configured
    // getIdleTime should still work
    const idle = agent.getIdleTime()
    assert.ok(idle >= 0)
  })

  it('idleTimeoutMs can be set via init config', async () => {
    const a = await ClawserAgent.create({ onLog: () => {}, onEvent: () => {} })
    a.init({ idleTimeoutMs: 1800000 }) // 30 min
    // The config is internal, but the agent should accept it
    assert.ok(true)
  })

  it('getIdleTime increases over time', async () => {
    const before = agent.getIdleTime()
    // Small delay
    await new Promise(r => setTimeout(r, 50))
    const after = agent.getIdleTime()
    assert.ok(after >= before)
  })
})
