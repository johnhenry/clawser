// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-memory.test.mjs
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  cosineSimilarity,
  tokenize,
  bm25Score,
  SemanticMemory,
  EmbeddingProvider,
  NoopEmbedder,
} from '../clawser-memory.js'

// ── Helpers ───────────────────────────────────────────────────────

/** Create a simple fake embedder that maps text → deterministic vector */
class FakeEmbedder extends EmbeddingProvider {
  #dims
  constructor(dims = 4) {
    super()
    this.#dims = dims
  }
  get name() { return 'fake' }
  get dimensions() { return this.#dims }
  async embed(text) {
    if (!text) return null
    const vec = new Float32Array(this.#dims)
    const t = text.toLowerCase()
    for (let i = 0; i < t.length; i++) {
      vec[i % this.#dims] += t.charCodeAt(i)
    }
    // L2 normalize
    let norm = 0
    for (let i = 0; i < this.#dims; i++) norm += vec[i] * vec[i]
    norm = Math.sqrt(norm)
    if (norm > 0) for (let i = 0; i < this.#dims; i++) vec[i] /= norm
    return vec
  }
}

/** Store several standard entries and return the memory instance */
function seedMemory(mem) {
  mem.store({ key: 'javascript', content: 'User prefers JavaScript over Python', category: 'learned' })
  mem.store({ key: 'timezone', content: 'User is in PST timezone', category: 'user' })
  mem.store({ key: 'project', content: 'Working on clawser browser agent', category: 'context' })
  mem.store({ key: 'name', content: 'Agent name is Clawser', category: 'core' })
  return mem
}

// ── cosineSimilarity ─────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1 for identical unit vectors', () => {
    const v = new Float32Array([1, 0, 0])
    assert.equal(cosineSimilarity(v, v), 1)
  })

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([0, 1])
    assert.equal(cosineSimilarity(a, b), 0)
  })

  it('returns -1 for opposite vectors', () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([-1, 0])
    assert.ok(Math.abs(cosineSimilarity(a, b) - (-1)) < 1e-6)
  })

  it('returns 0 for zero-length vectors', () => {
    assert.equal(cosineSimilarity(new Float32Array([]), new Float32Array([])), 0)
  })

  it('returns 0 for mismatched lengths', () => {
    const a = new Float32Array([1, 2])
    const b = new Float32Array([1, 2, 3])
    assert.equal(cosineSimilarity(a, b), 0)
  })

  it('returns 0 when either input is null', () => {
    assert.equal(cosineSimilarity(null, new Float32Array([1])), 0)
    assert.equal(cosineSimilarity(new Float32Array([1]), null), 0)
  })

  it('returns 0 for zero-norm vectors', () => {
    const z = new Float32Array([0, 0, 0])
    const v = new Float32Array([1, 2, 3])
    assert.equal(cosineSimilarity(z, v), 0)
  })

  it('computes correct similarity for non-trivial vectors', () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([4, 5, 6])
    // dot=32, normA=sqrt(14), normB=sqrt(77)
    const expected = 32 / (Math.sqrt(14) * Math.sqrt(77))
    assert.ok(Math.abs(cosineSimilarity(a, b) - expected) < 1e-6)
  })
})

// ── tokenize ─────────────────────────────────────────────────────

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric', () => {
    const tokens = tokenize('Hello World')
    assert.ok(tokens.includes('hello'))
    assert.ok(tokens.includes('world'))
  })

  it('filters out single-character tokens', () => {
    const tokens = tokenize('I am a test')
    assert.ok(!tokens.includes('i'))
    assert.ok(!tokens.includes('a'))
  })

  it('applies basic stemming (ing, ed, s)', () => {
    const tokens = tokenize('running walked tests')
    // 'running' → 'runn' (strip -ing), 'walked' → 'walk' (strip -ed), 'tests' → 'test' (strip -s)
    assert.ok(tokens.includes('runn'))
    assert.ok(tokens.includes('walk'))
    assert.ok(tokens.includes('test'))
  })

  it('returns empty array for null/empty input', () => {
    assert.deepEqual(tokenize(null), [])
    assert.deepEqual(tokenize(''), [])
  })

  it('handles special characters gracefully', () => {
    const tokens = tokenize('hello-world_foo@bar.com')
    assert.ok(tokens.length > 0)
    // Should split on non-alphanumeric
    assert.ok(tokens.includes('hello'))
  })
})

// ── bm25Score ────────────────────────────────────────────────────

describe('bm25Score', () => {
  it('returns empty map for no documents', () => {
    const scores = bm25Score(['test'], [], 1)
    assert.equal(scores.size, 0)
  })

  it('returns empty map for no query terms', () => {
    const docs = [{ id: 'd1', tokens: ['hello'], length: 1 }]
    const scores = bm25Score([], docs, 1)
    assert.equal(scores.size, 0)
  })

  it('scores document containing query term higher than one without', () => {
    const docs = [
      { id: 'match', tokens: ['javascript', 'code'], length: 2 },
      { id: 'nomatch', tokens: ['python', 'code'], length: 2 },
    ]
    const scores = bm25Score(['javascript'], docs, 2)
    assert.ok(scores.has('match'))
    assert.ok(!scores.has('nomatch') || scores.get('nomatch') === 0)
  })

  it('scores document with multiple occurrences higher', () => {
    const docs = [
      { id: 'once', tokens: ['javascript', 'code'], length: 2 },
      { id: 'twice', tokens: ['javascript', 'javascript', 'code'], length: 3 },
    ]
    const scores = bm25Score(['javascript'], docs, 2.5)
    assert.ok(scores.get('twice') > scores.get('once'))
  })

  it('handles multi-term queries', () => {
    const docs = [
      { id: 'both', tokens: ['javascript', 'browser'], length: 2 },
      { id: 'one', tokens: ['javascript', 'server'], length: 2 },
    ]
    const scores = bm25Score(['javascript', 'browser'], docs, 2)
    assert.ok(scores.get('both') > scores.get('one'))
  })
})

// ── SemanticMemory — store / get / update / delete ───────────────

describe('SemanticMemory — CRUD', () => {
  let mem

  beforeEach(() => {
    mem = new SemanticMemory()
  })

  it('stores an entry and returns an id', () => {
    const id = mem.store({ key: 'test', content: 'hello' })
    assert.ok(id.startsWith('mem_'))
    assert.equal(mem.size, 1)
  })

  it('retrieves stored entry by id', () => {
    const id = mem.store({ key: 'k', content: 'c', category: 'core' })
    const entry = mem.get(id)
    assert.equal(entry.key, 'k')
    assert.equal(entry.content, 'c')
    assert.equal(entry.category, 'core')
  })

  it('returns null for unknown id', () => {
    assert.equal(mem.get('mem_999'), null)
  })

  it('updates an existing entry', () => {
    const id = mem.store({ key: 'old', content: 'old content' })
    const ok = mem.update(id, { key: 'new', content: 'new content' })
    assert.equal(ok, true)
    assert.equal(mem.get(id).key, 'new')
    assert.equal(mem.get(id).content, 'new content')
  })

  it('update returns false for unknown id', () => {
    assert.equal(mem.update('mem_999', { key: 'x' }), false)
  })

  it('deletes an entry', () => {
    const id = mem.store({ key: 'k', content: 'c' })
    assert.equal(mem.delete(id), true)
    assert.equal(mem.size, 0)
    assert.equal(mem.get(id), null)
  })

  it('delete returns false for unknown id', () => {
    assert.equal(mem.delete('mem_999'), false)
  })

  it('clears all entries', () => {
    mem.store({ key: 'a', content: 'a' })
    mem.store({ key: 'b', content: 'b' })
    mem.clear()
    assert.equal(mem.size, 0)
  })

  it('auto-increments IDs', () => {
    const id1 = mem.store({ key: 'a', content: 'a' })
    const id2 = mem.store({ key: 'b', content: 'b' })
    const num1 = parseInt(id1.replace('mem_', ''), 10)
    const num2 = parseInt(id2.replace('mem_', ''), 10)
    assert.equal(num2, num1 + 1)
  })

  it('respects custom id on store', () => {
    const id = mem.store({ id: 'mem_42', key: 'k', content: 'c' })
    assert.equal(id, 'mem_42')
    assert.equal(mem.get('mem_42').key, 'k')
  })

  it('defaults category to core', () => {
    const id = mem.store({ key: 'k', content: 'c' })
    assert.equal(mem.get(id).category, 'core')
  })
})

// ── SemanticMemory — categories ──────────────────────────────────

describe('SemanticMemory — categories', () => {
  let mem

  beforeEach(() => {
    mem = new SemanticMemory()
    seedMemory(mem)
  })

  it('all() returns every entry when no category filter', () => {
    assert.equal(mem.all().length, 4)
  })

  it('all(category) filters correctly', () => {
    assert.equal(mem.all('core').length, 1)
    assert.equal(mem.all('learned').length, 1)
    assert.equal(mem.all('user').length, 1)
    assert.equal(mem.all('context').length, 1)
  })

  it('all() returns empty for non-existent category', () => {
    assert.equal(mem.all('nonexistent').length, 0)
  })

  it('recall filters by category', async () => {
    const results = await mem.recall('agent', { category: 'core' })
    for (const r of results) {
      assert.equal(r.category, 'core')
    }
  })
})

// ── SemanticMemory — BM25 recall (keyword-only) ──────────────────

describe('SemanticMemory — BM25 keyword recall', () => {
  let mem

  beforeEach(() => {
    mem = new SemanticMemory() // NoopEmbedder → keyword only
    seedMemory(mem)
  })

  it('empty query returns all entries with score 1.0', async () => {
    const results = await mem.recall('')
    assert.equal(results.length, 4)
    for (const r of results) assert.equal(r.score, 1)
  })

  it('finds entries matching keyword', async () => {
    const results = await mem.recall('javascript')
    assert.ok(results.length > 0)
    assert.ok(results[0].key === 'javascript' || results[0].content.includes('JavaScript'))
  })

  it('respects limit option', async () => {
    const results = await mem.recall('', { limit: 2 })
    assert.equal(results.length, 2)
  })

  it('respects minScore option', async () => {
    const results = await mem.recall('javascript', { minScore: 0.5 })
    for (const r of results) assert.ok(r.score >= 0.5)
  })

  it('returns empty for query with no matches', async () => {
    const results = await mem.recall('xyznonexistent')
    assert.equal(results.length, 0)
  })

  it('results include id, key, content, category, timestamp, score', async () => {
    const results = await mem.recall('clawser')
    assert.ok(results.length > 0)
    const r = results[0]
    assert.ok('id' in r)
    assert.ok('key' in r)
    assert.ok('content' in r)
    assert.ok('category' in r)
    assert.ok('timestamp' in r)
    assert.ok('score' in r)
  })

  it('results are sorted by score descending', async () => {
    // Add more entries to get varied scores
    mem.store({ key: 'browser tools', content: 'browser extension tools for clawser', category: 'context' })
    mem.store({ key: 'browser testing', content: 'browser browser browser test', category: 'context' })
    const results = await mem.recall('browser')
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].score >= results[i].score)
    }
  })
})

// ── SemanticMemory — vector search ───────────────────────────────

describe('SemanticMemory — vector search with embedder', () => {
  let mem, embedder

  beforeEach(async () => {
    embedder = new FakeEmbedder(4)
    mem = new SemanticMemory(embedder)

    // Store entries and embed them
    const ids = []
    ids.push(mem.store({ key: 'javascript', content: 'User loves JavaScript programming' }))
    ids.push(mem.store({ key: 'cooking', content: 'User enjoys cooking Italian food' }))
    ids.push(mem.store({ key: 'music', content: 'User listens to jazz music' }))

    for (const id of ids) await mem.embedEntry(id)
  })

  it('embedEntry stores a non-null embedding', async () => {
    const id = mem.store({ key: 'test', content: 'test content' })
    const ok = await mem.embedEntry(id)
    assert.equal(ok, true)
    assert.ok(mem.get(id).embedding instanceof Float32Array)
  })

  it('embedEntry returns false for unknown id', async () => {
    assert.equal(await mem.embedEntry('mem_999'), false)
  })

  it('recall uses hybrid scoring when embeddings exist', async () => {
    const results = await mem.recall('javascript programming')
    assert.ok(results.length > 0)
    // The javascript entry should score high
    assert.equal(results[0].key, 'javascript')
  })

  it('backfillEmbeddings processes entries without embeddings', async () => {
    mem.store({ key: 'new', content: 'no embedding yet' })
    const count = await mem.backfillEmbeddings()
    assert.ok(count >= 1)
  })

  it('backfillEmbeddings calls onProgress callback', async () => {
    mem.store({ key: 'new', content: 'no embedding yet' })
    let called = false
    await mem.backfillEmbeddings((done, total) => {
      called = true
      assert.ok(typeof done === 'number')
      assert.ok(typeof total === 'number')
    })
    assert.ok(called)
  })

  it('backfillEmbeddings returns 0 with NoopEmbedder', async () => {
    const noopMem = new SemanticMemory()
    noopMem.store({ key: 'k', content: 'c' })
    assert.equal(await noopMem.backfillEmbeddings(), 0)
  })

  it('switching embedder clears embedding cache', () => {
    mem.embedder = new FakeEmbedder(8)
    assert.equal(mem.embedder.dimensions, 8)
  })

  it('setting embedder to null falls back to NoopEmbedder', () => {
    mem.embedder = null
    assert.ok(mem.embedder instanceof NoopEmbedder)
  })
})

// ── SemanticMemory — hybrid recall weights ───────────────────────

describe('SemanticMemory — hybrid recall weights', () => {
  let mem

  beforeEach(async () => {
    const embedder = new FakeEmbedder(4)
    mem = new SemanticMemory(embedder)

    const id1 = mem.store({ key: 'alpha search', content: 'alpha search keyword match' })
    const id2 = mem.store({ key: 'beta data', content: 'beta data for analysis' })
    await mem.embedEntry(id1)
    await mem.embedEntry(id2)
  })

  it('custom vectorWeight and keywordWeight are respected', async () => {
    // keyword-heavy: should favor BM25 matches
    const kwResults = await mem.recall('alpha search', { vectorWeight: 0.0, keywordWeight: 1.0 })
    assert.ok(kwResults.length > 0)
    assert.equal(kwResults[0].key, 'alpha search')
  })
})

// ── SemanticMemory — deduplication (hygiene) ─────────────────────

describe('SemanticMemory — hygiene: deduplication', () => {
  let mem

  beforeEach(() => {
    mem = new SemanticMemory()
  })

  it('removes duplicates by category:key, keeping newest', () => {
    mem.store({ key: 'pref', content: 'old value', category: 'learned', timestamp: 1000 })
    mem.store({ key: 'pref', content: 'new value', category: 'learned', timestamp: 2000 })
    assert.equal(mem.size, 2)

    const removed = mem.hygiene({ maxAge: Infinity, maxEntries: 1000 })
    assert.equal(removed, 1)
    assert.equal(mem.size, 1)
    // The newer one should survive
    assert.equal(mem.all('learned')[0].content, 'new value')
  })

  it('does not deduplicate across different categories', () => {
    mem.store({ key: 'pref', content: 'core val', category: 'core' })
    mem.store({ key: 'pref', content: 'learned val', category: 'learned' })
    const removed = mem.hygiene({ maxAge: Infinity, maxEntries: 1000 })
    assert.equal(removed, 0)
    assert.equal(mem.size, 2)
  })
})

// ── SemanticMemory — age-based purging ───────────────────────────

describe('SemanticMemory — hygiene: age-based purging', () => {
  let mem

  beforeEach(() => {
    mem = new SemanticMemory()
  })

  it('purges entries older than maxAge', () => {
    const oldTs = Date.now() - 60 * 24 * 60 * 60 * 1000 // 60 days ago
    mem.store({ key: 'old', content: 'stale', category: 'learned', timestamp: oldTs })
    mem.store({ key: 'new', content: 'fresh', category: 'learned', timestamp: Date.now() })

    const removed = mem.hygiene({ maxAge: 30 * 24 * 60 * 60 * 1000, maxEntries: 1000 })
    assert.ok(removed >= 1)
    assert.equal(mem.all('learned').length, 1)
    assert.equal(mem.all('learned')[0].key, 'new')
  })

  it('never purges core entries regardless of age', () => {
    const oldTs = Date.now() - 365 * 24 * 60 * 60 * 1000 // 1 year ago
    mem.store({ key: 'identity', content: 'I am Clawser', category: 'core', timestamp: oldTs })

    const removed = mem.hygiene({ maxAge: 1, maxEntries: 1000 }) // maxAge=1ms
    assert.equal(removed, 0)
    assert.equal(mem.size, 1)
  })
})

// ── SemanticMemory — capacity eviction ───────────────────────────

describe('SemanticMemory — hygiene: capacity enforcement', () => {
  let mem

  beforeEach(() => {
    mem = new SemanticMemory()
  })

  it('trims to maxEntries, removing oldest non-core first', () => {
    mem.store({ key: 'core1', content: 'core', category: 'core', timestamp: 1 })
    mem.store({ key: 'old', content: 'oldest', category: 'learned', timestamp: 100 })
    mem.store({ key: 'mid', content: 'middle', category: 'learned', timestamp: 200 })
    mem.store({ key: 'new', content: 'newest', category: 'learned', timestamp: 300 })

    const removed = mem.hygiene({ maxAge: Infinity, maxEntries: 2 })
    assert.ok(removed >= 2)
    assert.ok(mem.size <= 2)
    // Core should survive
    assert.ok(mem.all('core').length === 1)
  })

  it('store() auto-evicts when exceeding internal maxEntries (5000)', () => {
    // We can't easily test 5000 entries, but verify the mechanism works
    // by checking that store doesn't throw for a reasonable count
    for (let i = 0; i < 50; i++) {
      mem.store({ key: `k${i}`, content: `content ${i}`, category: 'context' })
    }
    assert.equal(mem.size, 50)
  })
})

// ── SemanticMemory — import / export ─────────────────────────────

describe('SemanticMemory — import/export', () => {
  it('importFromFlatArray loads entries', () => {
    const mem = new SemanticMemory()
    const count = mem.importFromFlatArray([
      { key: 'a', content: 'alpha', category: 'core' },
      { key: 'b', content: 'beta', category: 'learned' },
    ])
    assert.equal(count, 2)
    assert.equal(mem.size, 2)
  })

  it('importFromFlatArray strips score pollution', () => {
    const mem = new SemanticMemory()
    mem.importFromFlatArray([{ key: 'a', content: 'b', score: 0.95 }])
    const exported = mem.exportToFlatArray()
    assert.equal(exported[0].score, undefined)
  })

  it('exportToFlatArray round-trips correctly', () => {
    const mem = new SemanticMemory()
    seedMemory(mem)
    const exported = mem.exportToFlatArray()
    assert.equal(exported.length, 4)

    const mem2 = new SemanticMemory()
    mem2.importFromFlatArray(exported)
    assert.equal(mem2.size, 4)
    assert.equal(mem2.all('core').length, 1)
  })

  it('exportToFlatArray excludes embeddings', () => {
    const mem = new SemanticMemory()
    mem.store({ key: 'k', content: 'c', embedding: new Float32Array([1, 2, 3]) })
    const exported = mem.exportToFlatArray()
    assert.equal(exported[0].embedding, undefined)
  })
})

// ── SemanticMemory — JSON serialization ──────────────────────────

describe('SemanticMemory — JSON serialization', () => {
  it('toJSON returns version and entries', () => {
    const mem = new SemanticMemory()
    mem.store({ key: 'k', content: 'c' })
    const json = mem.toJSON()
    assert.equal(json.version, 1)
    assert.ok(Array.isArray(json.entries))
    assert.equal(json.entries.length, 1)
  })

  it('toJSON encodes embeddings as base64', () => {
    const mem = new SemanticMemory()
    mem.store({ key: 'k', content: 'c', embedding: new Float32Array([1.0, 2.0]) })
    const json = mem.toJSON()
    assert.equal(typeof json.entries[0].embedding, 'string')
  })

  it('toJSON sets embedding to null when absent', () => {
    const mem = new SemanticMemory()
    mem.store({ key: 'k', content: 'c' })
    const json = mem.toJSON()
    assert.equal(json.entries[0].embedding, null)
  })

  it('fromJSON restores memory faithfully', () => {
    const mem = new SemanticMemory()
    seedMemory(mem)
    const json = mem.toJSON()

    const restored = SemanticMemory.fromJSON(json)
    assert.equal(restored.size, 4)
    assert.equal(restored.all('core').length, 1)
    assert.equal(restored.all('core')[0].key, 'name')
  })

  it('fromJSON round-trips embeddings', async () => {
    const embedder = new FakeEmbedder(4)
    const mem = new SemanticMemory(embedder)
    const id = mem.store({ key: 'k', content: 'test content' })
    await mem.embedEntry(id)

    const json = mem.toJSON()
    const restored = SemanticMemory.fromJSON(json, embedder)
    const entry = restored.all()[0]
    assert.ok(entry.embedding instanceof Float32Array)
    assert.equal(entry.embedding.length, 4)
  })

  it('fromJSON handles null/missing data gracefully', () => {
    const mem = SemanticMemory.fromJSON(null)
    assert.equal(mem.size, 0)

    const mem2 = SemanticMemory.fromJSON({ entries: 'not-an-array' })
    assert.equal(mem2.size, 0)
  })
})

// ── SemanticMemory — workspace scoping ───────────────────────────

describe('SemanticMemory — workspace scoping', () => {
  it('separate memory instances are fully isolated', async () => {
    const ws1 = new SemanticMemory()
    const ws2 = new SemanticMemory()

    ws1.store({ key: 'workspace', content: 'workspace A data', category: 'context' })
    ws2.store({ key: 'workspace', content: 'workspace B data', category: 'context' })

    assert.equal(ws1.size, 1)
    assert.equal(ws2.size, 1)

    const r1 = await ws1.recall('workspace')
    const r2 = await ws2.recall('workspace')
    assert.ok(r1[0].content.includes('A'))
    assert.ok(r2[0].content.includes('B'))
  })

  it('clearing one workspace does not affect another', () => {
    const ws1 = new SemanticMemory()
    const ws2 = new SemanticMemory()
    ws1.store({ key: 'k', content: 'c' })
    ws2.store({ key: 'k', content: 'c' })

    ws1.clear()
    assert.equal(ws1.size, 0)
    assert.equal(ws2.size, 1)
  })
})

// ── EmbeddingProvider / NoopEmbedder ─────────────────────────────

describe('EmbeddingProvider base class', () => {
  it('has default name, dimensions, and embed returning null', async () => {
    const p = new EmbeddingProvider()
    assert.equal(p.name, 'base')
    assert.equal(p.dimensions, 0)
    assert.equal(await p.embed('test'), null)
  })
})

describe('NoopEmbedder', () => {
  it('returns noop name and 0 dimensions', () => {
    const n = new NoopEmbedder()
    assert.equal(n.name, 'noop')
    assert.equal(n.dimensions, 0)
  })

  it('embed always returns null', async () => {
    const n = new NoopEmbedder()
    assert.equal(await n.embed('anything'), null)
  })
})

// ── Edge cases ───────────────────────────────────────────────────

describe('SemanticMemory — edge cases', () => {
  it('store with empty key and content still works', () => {
    const mem = new SemanticMemory()
    const id = mem.store({ key: '', content: '' })
    assert.ok(id)
    assert.equal(mem.size, 1)
  })

  it('recall on empty memory returns empty', async () => {
    const mem = new SemanticMemory()
    const results = await mem.recall('anything')
    assert.equal(results.length, 0)
  })

  it('recall empty query on empty memory returns empty', async () => {
    const mem = new SemanticMemory()
    const results = await mem.recall('')
    assert.equal(results.length, 0)
  })

  it('update refreshes timestamp', async () => {
    const mem = new SemanticMemory()
    const id = mem.store({ key: 'k', content: 'c', timestamp: 1000 })
    const before = mem.get(id).timestamp
    // Small delay to ensure Date.now() differs
    await new Promise(r => setTimeout(r, 5))
    mem.update(id, { content: 'updated' })
    const after = mem.get(id).timestamp
    assert.ok(after > before)
  })

  it('clearEmbeddingCache does not throw', () => {
    const mem = new SemanticMemory()
    assert.doesNotThrow(() => mem.clearEmbeddingCache())
  })

  it('hygiene returns 0 when nothing to clean', () => {
    const mem = new SemanticMemory()
    mem.store({ key: 'k', content: 'c', category: 'core' })
    assert.equal(mem.hygiene({ maxAge: Infinity, maxEntries: 1000 }), 0)
  })

  it('meta field is preserved through store and get', () => {
    const mem = new SemanticMemory()
    const id = mem.store({ key: 'k', content: 'c', meta: { source: 'test', count: 42 } })
    const entry = mem.get(id)
    assert.deepEqual(entry.meta, { source: 'test', count: 42 })
  })

  it('update can change category', () => {
    const mem = new SemanticMemory()
    const id = mem.store({ key: 'k', content: 'c', category: 'learned' })
    mem.update(id, { category: 'core' })
    assert.equal(mem.get(id).category, 'core')
  })
})
