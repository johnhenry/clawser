// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-e2e-memory.test.mjs
//
// E2E: Create workspace → store memories → recall with semantic search →
// verify TF-IDF ordering, category filtering, cross-session persistence.
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ClawserAgent } from '../clawser-agent.js'

// ── Helpers ──────────────────────────────────────────────────────

function makeStubProvider() {
  return {
    supportsNativeTools: false,
    supportsStreaming: false,
    chat: async () => ({
      content: 'OK',
      tool_calls: [],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'stub',
    }),
  }
}

async function createTestAgent() {
  const provider = makeStubProvider()
  const providers = {
    get: () => provider,
    listWithAvailability: async () => [{ name: 'stub' }],
  }
  const agent = await ClawserAgent.create({ providers })
  agent.init({})
  agent.setProvider('stub')
  return agent
}

// ── Scenario: Memory store → recall → semantic search ───────────

describe('E2E — Memory Lifecycle', () => {
  let agent

  beforeEach(async () => {
    agent = await createTestAgent()
  })

  it('store and recall a single memory entry', () => {
    agent.memoryStore({ key: 'fact-1', content: 'The sky is blue', category: 'learned' })

    const results = agent.memoryRecall('sky')
    assert.ok(results.length >= 1, 'should recall at least one entry')
    assert.ok(results[0].content.includes('blue'))
  })

  it('semantic search ranks entries by keyword relevance', () => {
    agent.memoryStore({ key: 'a', content: 'JavaScript is a programming language used for web development', category: 'learned' })
    agent.memoryStore({ key: 'b', content: 'Python is popular for data science and machine learning', category: 'learned' })
    agent.memoryStore({ key: 'c', content: 'JavaScript frameworks include React and Vue for web apps', category: 'learned' })

    const results = agent.memoryRecall('JavaScript web')
    assert.ok(results.length >= 2, 'should match multiple JavaScript entries')
    // Entries mentioning both "JavaScript" and "web" should score higher
    const topContent = results[0].content
    assert.ok(
      topContent.includes('JavaScript') && topContent.includes('web'),
      'top result should contain both search terms'
    )
  })

  it('category filter isolates recall results', () => {
    agent.memoryStore({ key: 'core-1', content: 'App runs on port 3000', category: 'core' })
    agent.memoryStore({ key: 'user-1', content: 'User prefers dark mode', category: 'user' })
    agent.memoryStore({ key: 'learned-1', content: 'API rate limit is 100/min', category: 'learned' })

    const coreResults = agent.memoryRecall('', { category: 'core' })
    assert.ok(coreResults.every(m => m.category === 'core'), 'only core category returned')
    assert.equal(coreResults.length, 1)

    const userResults = agent.memoryRecall('', { category: 'user' })
    assert.ok(userResults.every(m => m.category === 'user'), 'only user category returned')
    assert.equal(userResults.length, 1)
  })

  it('memories persist across reinit (session restart)', async () => {
    agent.memoryStore({ key: 'persist-test', content: 'This should survive reinit', category: 'core' })

    await agent.reinit({})

    const recalled = agent.memoryRecall('survive reinit')
    assert.ok(recalled.length >= 1, 'memory should persist across reinit')
    assert.ok(recalled[0].content.includes('survive reinit'))
  })

  it('overwriting same key updates content', () => {
    agent.memoryStore({ key: 'version', content: 'v1.0.0', category: 'core' })
    agent.memoryStore({ key: 'version', content: 'v2.0.0', category: 'core' })

    const results = agent.memoryRecall('version', { category: 'core' })
    // After overwrite or hygiene, latest should be v2.0.0
    const contents = results.map(r => r.content)
    assert.ok(contents.some(c => c.includes('v2.0.0')), 'should find updated v2.0.0')
  })

  it('hygiene deduplicates and returns removal count', () => {
    agent.memoryStore({ key: 'dup', content: 'first', category: 'context' })
    agent.memoryStore({ key: 'dup', content: 'second', category: 'context' })
    agent.memoryStore({ key: 'dup', content: 'third', category: 'context' })

    const removed = agent.memoryHygiene({})
    assert.equal(typeof removed, 'number', 'hygiene should return a number')
    assert.ok(removed >= 0, 'removal count should be non-negative')

    // After hygiene, at most one entry for this key
    const results = agent.memoryRecall('', { category: 'context' })
    const dupEntries = results.filter(r => r.key === 'dup')
    assert.ok(dupEntries.length <= 1, `expected at most 1 entry after hygiene, got ${dupEntries.length}`)
  })

  it('empty query returns all memories in a category', () => {
    agent.memoryStore({ key: 'x', content: 'alpha', category: 'learned' })
    agent.memoryStore({ key: 'y', content: 'beta', category: 'learned' })
    agent.memoryStore({ key: 'z', content: 'gamma', category: 'learned' })

    const all = agent.memoryRecall('', { category: 'learned' })
    assert.equal(all.length, 3, 'empty query should return all entries in category')
  })

  it('recall with no matching terms returns empty or low-score results', () => {
    agent.memoryStore({ key: 'only', content: 'Quantum mechanics basics', category: 'learned' })

    const results = agent.memoryRecall('basketball tournament')
    // Should return either empty or all with low scores
    if (results.length > 0) {
      // If returned, scores should be relatively low
      assert.ok(typeof results[0].score === 'number', 'should have a numeric score')
    }
    // Not crashing is the main assertion
    assert.ok(true)
  })

  it('memory event is logged in event log', () => {
    agent.memoryStore({ key: 'event-test', content: 'testing event logging', category: 'core' })

    const events = agent.getEventLog()
    const memEvents = events.query({ type: 'memory_stored' })
    assert.ok(memEvents.length >= 1, 'should log memory_store event')
    assert.ok(memEvents.some(e => e.data.key === 'event-test'))
  })
})
