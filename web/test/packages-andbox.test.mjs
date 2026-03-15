/**
 * packages-andbox — Module loading, export verification, and basic API tests.
 *
 * Run: node --import ./web/test/_setup-globals.mjs --test web/test/packages-andbox.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  createSandbox,
  resolveWithImportMap,
  gateCapabilities,
  createStdio,
  createNetworkFetch,
  makeDeferred, makeAbortError, makeTimeoutError,
  DEFAULT_TIMEOUT_MS, DEFAULT_LIMITS, DEFAULT_CAPABILITY_LIMITS,
  makeWorkerSource,
} from '../packages/andbox/src/index.mjs'

// ── 1. Exports exist ───────────────────────────────────────────────────

describe('andbox — exports', () => {
  it('exports all public functions', () => {
    assert.equal(typeof createSandbox, 'function')
    assert.equal(typeof resolveWithImportMap, 'function')
    assert.equal(typeof gateCapabilities, 'function')
    assert.equal(typeof createStdio, 'function')
    assert.equal(typeof createNetworkFetch, 'function')
    assert.equal(typeof makeDeferred, 'function')
    assert.equal(typeof makeAbortError, 'function')
    assert.equal(typeof makeTimeoutError, 'function')
    assert.equal(typeof makeWorkerSource, 'function')
  })

  it('exports constants', () => {
    assert.equal(typeof DEFAULT_TIMEOUT_MS, 'number')
    assert.equal(DEFAULT_TIMEOUT_MS, 30_000)
    assert.ok(DEFAULT_LIMITS)
    assert.equal(DEFAULT_LIMITS.maxConcurrent, 16)
    assert.ok(DEFAULT_CAPABILITY_LIMITS)
    assert.ok(Object.isFrozen(DEFAULT_LIMITS))
    assert.ok(Object.isFrozen(DEFAULT_CAPABILITY_LIMITS))
  })
})

// ── 2. resolveWithImportMap ────────────────────────────────────────────

describe('andbox — resolveWithImportMap', () => {
  it('resolves exact match in imports', () => {
    const map = { imports: { 'lodash': 'https://cdn.example.com/lodash.js' } }
    const url = resolveWithImportMap('lodash', map)
    assert.equal(url, 'https://cdn.example.com/lodash.js')
  })

  it('resolves prefix match in imports', () => {
    const map = { imports: { 'utils/': 'https://cdn.example.com/utils/' } }
    const url = resolveWithImportMap('utils/foo.js', map)
    assert.equal(url, 'https://cdn.example.com/utils/foo.js')
  })

  it('returns null when no match', () => {
    const map = { imports: { 'lodash': 'https://cdn.example.com/lodash.js' } }
    assert.equal(resolveWithImportMap('react', map), null)
  })

  it('returns null for null/undefined importMap', () => {
    assert.equal(resolveWithImportMap('foo', null), null)
  })

  it('scopes take priority over top-level imports', () => {
    const map = {
      imports: { 'lib': 'https://v1.example.com/lib.js' },
      scopes: {
        'https://app.local/': { 'lib': 'https://v2.example.com/lib.js' },
      },
    }
    const url = resolveWithImportMap('lib', map, 'https://app.local/main.js')
    assert.equal(url, 'https://v2.example.com/lib.js')
  })
})

// ── 3. gateCapabilities ────────────────────────────────────────────────

describe('andbox — gateCapabilities', () => {
  it('wraps capabilities and tracks stats', async () => {
    const { gated, stats } = gateCapabilities({
      echo: async (msg) => msg,
    })
    assert.equal(typeof gated.echo, 'function')

    const result = await gated.echo('hi')
    assert.equal(result, 'hi')

    const s = stats()
    assert.equal(s.totalCalls, 1)
    assert.ok(s.totalArgBytes > 0)
  })

  it('enforces global call limit', async () => {
    const { gated } = gateCapabilities(
      { noop: async () => {} },
      { limits: { maxCalls: 1 } },
    )
    await gated.noop()
    await assert.rejects(() => gated.noop(), /Global call limit/)
  })

  it('enforces per-capability call limit', async () => {
    const { gated } = gateCapabilities(
      { op: async () => 'ok' },
      { capabilities: { op: { maxCalls: 2 } } },
    )
    await gated.op()
    await gated.op()
    await assert.rejects(() => gated.op(), /call limit exceeded/)
  })
})

// ── 4. createStdio ─────────────────────────────────────────────────────

describe('andbox — createStdio', () => {
  it('push/stream round-trip', async () => {
    const { push, end, stream } = createStdio()
    push('hello')
    push('world')
    end()

    const iter = stream[Symbol.asyncIterator]()
    const r1 = await iter.next()
    assert.equal(r1.value, 'hello')
    assert.equal(r1.done, false)

    const r2 = await iter.next()
    assert.equal(r2.value, 'world')

    const r3 = await iter.next()
    assert.equal(r3.done, true)
  })

  it('stream.return() terminates early', async () => {
    const { push, stream } = createStdio()
    push('a')
    const iter = stream[Symbol.asyncIterator]()
    const done = await iter.return()
    assert.equal(done.done, true)
  })
})

// ── 5. Deferred utilities ──────────────────────────────────────────────

describe('andbox — deferred', () => {
  it('makeDeferred creates externally-resolvable promise', async () => {
    const { promise, resolve } = makeDeferred()
    resolve(42)
    assert.equal(await promise, 42)
  })

  it('makeAbortError creates DOMException', () => {
    const err = makeAbortError('test abort')
    assert.equal(err.name, 'AbortError')
    assert.equal(err.message, 'test abort')
  })

  it('makeTimeoutError creates named Error', () => {
    const err = makeTimeoutError(5000)
    assert.equal(err.name, 'TimeoutError')
    assert.ok(err.message.includes('5000'))
  })
})

// ── 6. createNetworkFetch ──────────────────────────────────────────────

describe('andbox — createNetworkFetch', () => {
  it('without allowlist wraps fetch directly', async () => {
    let calledWith = null
    const fakeFetch = async (url) => { calledWith = url; return 'ok' }
    const gatedFetch = createNetworkFetch(null, fakeFetch)
    const result = await gatedFetch('https://any.com/data')
    assert.equal(calledWith, 'https://any.com/data')
    assert.equal(result, 'ok')
  })

  it('with allowlist blocks disallowed hosts', async () => {
    const fakeFetch = async () => 'ok'
    const gatedFetch = createNetworkFetch(['allowed.com'], fakeFetch)
    await assert.rejects(() => gatedFetch('https://blocked.com/x'), /not in the allowlist/)
  })

  it('with allowlist permits allowed hosts', async () => {
    const fakeFetch = async () => 'ok'
    const gatedFetch = createNetworkFetch(['allowed.com'], fakeFetch)
    const result = await gatedFetch('https://allowed.com/data')
    assert.equal(result, 'ok')
  })
})

// ── 7. makeWorkerSource ────────────────────────────────────────────────

describe('andbox — makeWorkerSource', () => {
  it('returns a non-empty string', () => {
    const source = makeWorkerSource()
    assert.equal(typeof source, 'string')
    assert.ok(source.length > 100)
    assert.ok(source.includes('self.onmessage'))
  })
})
