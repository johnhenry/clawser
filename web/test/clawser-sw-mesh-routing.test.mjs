// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-sw-mesh-routing.test.mjs
//
// Tests the SW-side mesh routing logic (parseMeshUrl + handleMeshFetch relay)
// and the client-side mesh-fetch listener wiring.
//
// Since sw.js is a classic script (non-module), we test by simulating the
// SW ↔ client MessageChannel relay pattern.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Import the ES-module MeshFetchRouter (used client-side) ────────
import { MeshFetchRouter, parseMeshRequest } from '../clawser-mesh-sw-routing.js'

// ── parseMeshUrl parity tests ──────────────────────────────────────
// The SW inlines a copy of parseMeshRequest as parseMeshUrl.
// These tests verify the same logic the SW uses.

describe('SW parseMeshUrl parity with parseMeshRequest', () => {
  // We re-implement parseMeshUrl here exactly as inlined in sw.js
  // to verify the inlined copy stays in sync with the module.
  const MESH_PROTOCOL = 'mesh://'
  const MESH_LOCAL_SUFFIX = '.mesh.local'

  function parseMeshUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return null
    if (urlStr.startsWith(MESH_PROTOCOL)) {
      const rest = urlStr.slice(MESH_PROTOCOL.length)
      if (!rest) return null
      const slashIdx = rest.indexOf('/')
      let podId, path
      if (slashIdx === -1) {
        podId = rest
        path = '/'
      } else {
        podId = rest.slice(0, slashIdx)
        path = rest.slice(slashIdx) || '/'
      }
      if (!podId) return null
      return { podId, path }
    }
    const httpMatch = urlStr.match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?/)
    if (!httpMatch) return null
    const rawHost = httpMatch[1]
    const lowerHost = rawHost.toLowerCase()
    if (!lowerHost.endsWith(MESH_LOCAL_SUFFIX)) return null
    const podId = rawHost.slice(0, -MESH_LOCAL_SUFFIX.length)
    if (!podId) return null
    const path = httpMatch[2] || '/'
    return { podId, path }
  }

  const cases = [
    ['mesh://podA/api/v1', { podId: 'podA', path: '/api/v1' }],
    ['mesh://podC', { podId: 'podC', path: '/' }],
    ['mesh://podD/', { podId: 'podD', path: '/' }],
    ['https://podB.mesh.local/data', { podId: 'podB', path: '/data' }],
    ['http://podX.mesh.local/info', { podId: 'podX', path: '/info' }],
    ['https://example.com/foo', null],
    ['', null],
    [null, null],
    [undefined, null],
    ['mesh://', null],
    ['https://.mesh.local/path', null],
  ]

  for (const [input, expected] of cases) {
    it(`parseMeshUrl("${input}") matches parseMeshRequest`, () => {
      const swResult = parseMeshUrl(input)
      const moduleResult = parseMeshRequest(input)
      assert.deepEqual(swResult, expected)
      assert.deepEqual(swResult, moduleResult)
    })
  }
})

// ── SW → Client relay simulation ──────────────────────────────────
// Simulates the MessageChannel relay from handleMeshFetch (SW side)
// to the mesh-fetch listener (client side) backed by MeshFetchRouter.

describe('SW mesh-fetch relay integration', () => {
  let rpcCalls

  beforeEach(() => {
    rpcCalls = []
  })

  /**
   * Simulate the client-side mesh-fetch listener.
   * This mirrors the code in clawser-workspace-init-mesh.js.
   */
  function createClientListener(meshFetchRouter) {
    return async (messageData) => {
      const { port, pseudoRequest } = messageData
      if (!port || !pseudoRequest) return

      const headerEntries = pseudoRequest.headers || []
      const headersObj = {}
      for (const [k, v] of headerEntries) headersObj[k] = v

      const reqLike = {
        url: pseudoRequest.url,
        method: pseudoRequest.method || 'GET',
        headers: {
          forEach(cb) { for (const [k, v] of Object.entries(headersObj)) cb(v, k) },
          entries() { return Object.entries(headersObj) },
        },
        async text() {
          if (pseudoRequest.body instanceof ArrayBuffer) {
            return new TextDecoder().decode(pseudoRequest.body)
          }
          return pseudoRequest.body != null ? String(pseudoRequest.body) : ''
        },
      }

      const response = await meshFetchRouter.route(reqLike)
      if (response) {
        const body = typeof response._body !== 'undefined'
          ? response._body
          : await response.text?.() ?? ''
        const resHeaders = []
        if (response.headers) {
          if (typeof response.headers.entries === 'function') {
            for (const entry of response.headers.entries()) resHeaders.push(entry)
          } else if (typeof response.headers.forEach === 'function') {
            response.headers.forEach((v, k) => resHeaders.push([k, v]))
          }
        }
        port.postMessage({
          pseudoResponse: {
            status: response.status || 200,
            statusText: 'OK',
            headers: resHeaders,
            body,
          },
        })
      } else {
        port.postMessage({
          pseudoResponse: {
            status: 404,
            headers: [['content-type', 'application/json']],
            body: JSON.stringify({ error: 'No mesh route matched' }),
          },
        })
      }
    }
  }

  /**
   * Build the pseudo-request as the SW's handleMeshFetch would.
   */
  function buildPseudoRequest(url, opts = {}) {
    return {
      url,
      method: opts.method || 'GET',
      headers: Object.entries(opts.headers || {}),
      podId: parseMeshRequest(url)?.podId,
      path: parseMeshRequest(url)?.path,
      body: opts.body ?? null,
    }
  }

  it('routes mesh:// GET through relay and returns response', async () => {
    const router = new MeshFetchRouter({
      onRpc: async (params) => {
        rpcCalls.push(params)
        return { status: 200, body: { hello: 'mesh' } }
      },
    })

    const listener = createClientListener(router)

    // Simulate MessageChannel
    let resolvePort
    const portPromise = new Promise(r => { resolvePort = r })
    const fakePort = {
      postMessage(data) { resolvePort(data) },
    }

    const pseudo = buildPseudoRequest('mesh://pod1/api/hello')
    await listener({ type: 'mesh-fetch', port: fakePort, pseudoRequest: pseudo })

    const result = await portPromise
    assert.equal(result.pseudoResponse.status, 200)
    const body = JSON.parse(result.pseudoResponse.body)
    assert.deepEqual(body, { hello: 'mesh' })

    assert.equal(rpcCalls.length, 1)
    assert.equal(rpcCalls[0].podId, 'pod1')
    assert.equal(rpcCalls[0].path, '/api/hello')
    assert.equal(rpcCalls[0].method, 'GET')
  })

  it('routes *.mesh.local POST with body through relay', async () => {
    const router = new MeshFetchRouter({
      onRpc: async (params) => {
        rpcCalls.push(params)
        return { status: 201, body: { created: true } }
      },
    })

    const listener = createClientListener(router)

    let resolvePort
    const portPromise = new Promise(r => { resolvePort = r })
    const fakePort = { postMessage(data) { resolvePort(data) } }

    const pseudo = buildPseudoRequest('https://myPod.mesh.local/data', {
      method: 'POST',
      body: JSON.stringify({ key: 'val' }),
    })
    await listener({ type: 'mesh-fetch', port: fakePort, pseudoRequest: pseudo })

    const result = await portPromise
    assert.equal(result.pseudoResponse.status, 201)

    assert.equal(rpcCalls.length, 1)
    assert.equal(rpcCalls[0].podId, 'myPod')
    assert.equal(rpcCalls[0].method, 'POST')
    assert.deepEqual(rpcCalls[0].body, { key: 'val' })
  })

  it('returns 404 for non-mesh URL that somehow arrives', async () => {
    const router = new MeshFetchRouter({
      onRpc: async () => ({ body: {} }),
    })

    const listener = createClientListener(router)

    let resolvePort
    const portPromise = new Promise(r => { resolvePort = r })
    const fakePort = { postMessage(data) { resolvePort(data) } }

    // A non-mesh URL — route() returns null
    const pseudo = {
      url: 'https://example.com/api',
      method: 'GET',
      headers: [],
    }
    await listener({ type: 'mesh-fetch', port: fakePort, pseudoRequest: pseudo })

    const result = await portPromise
    assert.equal(result.pseudoResponse.status, 404)
  })

  it('propagates RPC errors as 502', async () => {
    const router = new MeshFetchRouter({
      onRpc: async () => { throw new Error('peer offline') },
    })

    const listener = createClientListener(router)

    let resolvePort
    const portPromise = new Promise(r => { resolvePort = r })
    const fakePort = { postMessage(data) { resolvePort(data) } }

    const pseudo = buildPseudoRequest('mesh://pod9/fail')
    await listener({ type: 'mesh-fetch', port: fakePort, pseudoRequest: pseudo })

    const result = await portPromise
    // MeshFetchRouter returns 502 on RPC error
    assert.equal(result.pseudoResponse.status, 502)
    const body = JSON.parse(result.pseudoResponse.body)
    assert.equal(body.error, 'peer offline')
  })

  it('preserves request headers through the relay', async () => {
    const router = new MeshFetchRouter({
      onRpc: async (params) => {
        rpcCalls.push(params)
        return { body: { ok: true } }
      },
    })

    const listener = createClientListener(router)

    let resolvePort
    const portPromise = new Promise(r => { resolvePort = r })
    const fakePort = { postMessage(data) { resolvePort(data) } }

    const pseudo = buildPseudoRequest('mesh://pod5/auth', {
      headers: { 'authorization': 'Bearer tok123', 'x-custom': 'val' },
    })
    await listener({ type: 'mesh-fetch', port: fakePort, pseudoRequest: pseudo })

    await portPromise
    assert.equal(rpcCalls[0].headers['authorization'], 'Bearer tok123')
    assert.equal(rpcCalls[0].headers['x-custom'], 'val')
  })
})
