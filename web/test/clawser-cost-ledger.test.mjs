import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Stub browser globals before import
globalThis.BrowserTool = class { constructor() {} }

import { ClawserAgent } from '../clawser-agent.js'
import { CostLedger } from '../clawser-providers.js'

describe('CostLedger Wiring', () => {
  it('agent accepts costLedger option in create()', async () => {
    const ledger = new CostLedger()
    const agent = await ClawserAgent.create({
      onLog: () => {},
      onEvent: () => {},
      costLedger: ledger,
    })
    assert.equal(agent.costLedger, ledger)
  })

  it('costLedger defaults to null when not provided', async () => {
    const agent = await ClawserAgent.create({
      onLog: () => {},
      onEvent: () => {},
    })
    assert.equal(agent.costLedger, null)
  })

  it('CostLedger.record() stores entries with timestamp', () => {
    const ledger = new CostLedger()
    ledger.record({
      model: 'gpt-4o',
      provider: 'openai',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.005,
    })
    assert.equal(ledger.size, 1)
    const entry = ledger.entries[0]
    assert.equal(entry.model, 'gpt-4o')
    assert.equal(entry.provider, 'openai')
    assert.equal(entry.inputTokens, 100)
    assert.equal(entry.outputTokens, 50)
    assert.equal(entry.costUsd, 0.005)
    assert.ok(entry.timestamp > 0)
  })

  it('CostLedger.summary() aggregates correctly', () => {
    const ledger = new CostLedger()
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.01 })
    ledger.record({ model: 'claude-sonnet', provider: 'anthropic', inputTokens: 200, outputTokens: 100, costUsd: 0.02 })
    const summary = ledger.summary()
    assert.equal(summary.totalCalls, 2)
    assert.equal(summary.totalInputTokens, 300)
    assert.equal(summary.totalOutputTokens, 150)
    assert.ok(Math.abs(summary.totalCostUsd - 0.03) < 0.0001)
  })

  it('CostLedger.totalByModel() groups by model', () => {
    const ledger = new CostLedger()
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.01 })
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 200, outputTokens: 75, costUsd: 0.02 })
    ledger.record({ model: 'claude-sonnet', provider: 'anthropic', inputTokens: 50, outputTokens: 25, costUsd: 0.005 })
    const byModel = ledger.totalByModel()
    assert.equal(byModel['gpt-4o'].calls, 2)
    assert.equal(byModel['gpt-4o'].inputTokens, 300)
    assert.equal(byModel['claude-sonnet'].calls, 1)
  })

  it('CostLedger.isOverThreshold() respects threshold', () => {
    const ledger = new CostLedger({ thresholdUsd: 1.0 })
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.5 })
    assert.equal(ledger.isOverThreshold(), false)
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.6 })
    assert.equal(ledger.isOverThreshold(), true)
  })

  it('CostLedger.clear() removes all entries', () => {
    const ledger = new CostLedger()
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.01 })
    assert.equal(ledger.size, 1)
    ledger.clear()
    assert.equal(ledger.size, 0)
  })
})
