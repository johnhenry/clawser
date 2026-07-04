// clawser-skill-capabilities.test.mjs

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  createSkillCapabilityAPI,
  wrapSkillScript,
} from '../clawser-skill-capabilities.mjs'
import {
  buildCapabilityToken,
  enforceCapabilityRequest,
  CapabilityDeniedError,
} from '../clawser-deploy-target.mjs'

const makeFs = () => ({
  reads: [],
  writes: [],
  async readFile(path) { this.reads.push(path); return `content-of-${path}` },
  async writeFile(path, data) { this.writes.push({ path, data }) },
})

describe('createSkillCapabilityAPI — fetch', () => {
  it('allows requests to whitelisted hosts', async () => {
    const calls = []
    const innerFetch = async (url) => { calls.push(String(url)); return { ok: true } }
    const tok = buildCapabilityToken({ capabilities: { net: ['api.foo.io'] } })
    const api = createSkillCapabilityAPI(tok, { fetch: innerFetch })
    const r = await api.fetch('https://api.foo.io/v1/x')
    assert.equal(r.ok, true)
    assert.equal(calls.length, 1)
  })

  it('throws an actionable error on denied host with manifest pointer', async () => {
    const innerFetch = async () => { throw new Error('should not reach inner fetch') }
    const tok = buildCapabilityToken({ capabilities: { net: ['allowed.com'] } })
    const api = createSkillCapabilityAPI(tok, { fetch: innerFetch })
    await assert.rejects(
      () => api.fetch('https://evil.com/'),
      (err) => /Capability not granted: net access to "evil\.com"/.test(err.message)
            && /manifest\.capabilities\.net/.test(err.message)
            && /re-deploy/.test(err.message),
    )
  })

  it('records denial in the api.denied log', async () => {
    const tok = buildCapabilityToken({ capabilities: { net: [] } })
    const api = createSkillCapabilityAPI(tok)
    await assert.rejects(() => api.fetch('https://evil.com/'))
    assert.equal(api.denied.length, 1)
    assert.equal(api.denied[0].kind, 'net')
    assert.equal(api.denied[0].target, 'evil.com')
  })

  it('wildcard *.example.com matches subdomains but not bare', async () => {
    const innerFetch = async () => ({ ok: true })
    const tok = buildCapabilityToken({ capabilities: { net: ['*.example.com'] } })
    const api = createSkillCapabilityAPI(tok, { fetch: innerFetch })
    await api.fetch('https://api.example.com/x')           // OK
    await api.fetch('https://deep.sub.example.com/x')      // OK
    await assert.rejects(() => api.fetch('https://example.com/x')) // bare suffix denied
  })

  it('throws clean error when fetch is not available at all', async () => {
    const tok = buildCapabilityToken({ capabilities: { net: ['x'] } })
    const api = createSkillCapabilityAPI(tok, { fetch: null })
    // host 'x' IS allowed by token, so we get past the cap check
    // and then hit the "no fetch impl" guard
    await assert.rejects(() => api.fetch('https://x/'), /fetch is not available/)
  })
})

describe('createSkillCapabilityAPI — fs', () => {
  it('allows reads under a whitelisted path prefix', async () => {
    const fs = makeFs()
    const tok = buildCapabilityToken({ capabilities: { fs: ['/tmp/foo'] } })
    const api = createSkillCapabilityAPI(tok, { fs })
    const out = await api.fs.readFile('/tmp/foo/bar.txt')
    assert.equal(out, 'content-of-/tmp/foo/bar.txt')
    assert.deepEqual(fs.reads, ['/tmp/foo/bar.txt'])
  })

  it('rejects reads outside the prefix with manifest pointer', async () => {
    const fs = makeFs()
    const tok = buildCapabilityToken({ capabilities: { fs: ['/tmp/foo'] } })
    const api = createSkillCapabilityAPI(tok, { fs })
    await assert.rejects(
      () => api.fs.readFile('/tmp/baz/secret.txt'),
      (err) => /Capability not granted: fs/.test(err.message)
            && /manifest\.capabilities\.fs/.test(err.message)
            && /\/tmp\/baz\/secret\.txt/.test(err.message),
    )
    assert.deepEqual(fs.reads, [])
  })

  it('writeFile is gated by the same prefix rules', async () => {
    const fs = makeFs()
    const tok = buildCapabilityToken({ capabilities: { fs: ['/tmp/'] } })
    const api = createSkillCapabilityAPI(tok, { fs })
    await api.fs.writeFile('/tmp/log.txt', 'hello')
    await assert.rejects(() => api.fs.writeFile('/etc/passwd', 'oops'))
    assert.deepEqual(fs.writes, [{ path: '/tmp/log.txt', data: 'hello' }])
  })
})

describe('createSkillCapabilityAPI — mesh', () => {
  it('allows declared capability names', async () => {
    let called = null
    const tok = buildCapabilityToken({ capabilities: { mesh: ['mesh:peer-list'] } })
    const api = createSkillCapabilityAPI(tok, { meshCall: async (name, args) => { called = { name, args }; return ['peerA'] } })
    const r = await api.mesh.call('mesh:peer-list', { filter: 'online' })
    assert.deepEqual(r, ['peerA'])
    assert.deepEqual(called, { name: 'mesh:peer-list', args: { filter: 'online' } })
  })

  it('rejects undeclared mesh capability with manifest pointer', async () => {
    const tok = buildCapabilityToken({ capabilities: { mesh: ['mesh:peer-list'] } })
    const api = createSkillCapabilityAPI(tok, { meshCall: async () => 'bad' })
    await assert.rejects(
      () => api.mesh.call('mesh:dangerous-rpc'),
      (err) => /Capability not granted: mesh/.test(err.message)
            && /manifest\.capabilities\.mesh/.test(err.message),
    )
  })
})

describe('createSkillCapabilityAPI — empty token (deployed skill with no caps)', () => {
  it('denies every kind of access', async () => {
    const tok = buildCapabilityToken({ capabilities: {} })
    const api = createSkillCapabilityAPI(tok, {
      fetch: async () => ({}), fs: makeFs(), meshCall: async () => 'x',
    })
    await assert.rejects(() => api.fetch('https://x/'),       /Capability not granted: net/)
    await assert.rejects(() => api.fs.readFile('/x'),         /Capability not granted: fs/)
    await assert.rejects(() => api.mesh.call('mesh:any'),     /Capability not granted: mesh/)
  })
})

describe('createSkillCapabilityAPI — guards', () => {
  it('rejects null token at construction', () => {
    assert.throws(() => createSkillCapabilityAPI(null), /token is required/)
  })
})

// ── wrapSkillScript ──────────────────────────────────────────────

describe('wrapSkillScript', () => {
  it('emits a header that aliases the bridge to fetch/fs/mesh', () => {
    const tok = buildCapabilityToken({ capabilities: { net: ['x'] } })
    const api = createSkillCapabilityAPI(tok)
    const w = wrapSkillScript('return await fetch("https://x/")', api)
    assert.match(w.wrappedSource, /const fetch = __cap_bridge\.fetch;/)
    assert.match(w.wrappedSource, /const fs = __cap_bridge\.fs;/)
    assert.match(w.wrappedSource, /const mesh = __cap_bridge\.mesh;/)
    assert.equal(w.hostBridge.fetch, api.fetch)
  })

  it('runner returns the async result when capabilities allow', async () => {
    const tok = buildCapabilityToken({ capabilities: { net: ['api.allowed.com'] } })
    const api = createSkillCapabilityAPI(tok, { fetch: async (url) => ({ url: String(url) }) })
    const w = wrapSkillScript(`return (await fetch("https://api.allowed.com/x")).url`, api)
    const result = await w.runner('input-value')
    assert.equal(result, 'https://api.allowed.com/x')
  })

  it('runner exposes the input parameter to the skill', async () => {
    const tok = buildCapabilityToken({ capabilities: {} })
    const api = createSkillCapabilityAPI(tok)
    const w = wrapSkillScript(`return input.toUpperCase()`, api)
    assert.equal(await w.runner('hello'), 'HELLO')
  })

  it('runner rejects with the actionable error on denied call', async () => {
    const tok = buildCapabilityToken({ capabilities: { net: [] } })
    const api = createSkillCapabilityAPI(tok, { fetch: async () => ({}) })
    const w = wrapSkillScript(`return await fetch("https://denied.com/")`, api)
    await assert.rejects(
      () => w.runner('any'),
      (err) => /Capability not granted: net/.test(err.message)
            && /denied\.com/.test(err.message),
    )
  })

  it('runner: deployed skill with FS cap "/tmp/foo" can read /tmp/foo/bar.txt but throws on /tmp/baz', async () => {
    const tok = buildCapabilityToken({ capabilities: { fs: ['/tmp/foo'] } })
    const fs = makeFs()
    const api = createSkillCapabilityAPI(tok, { fs })
    const ok = wrapSkillScript(`return await fs.readFile("/tmp/foo/bar.txt")`, api)
    const bad = wrapSkillScript(`return await fs.readFile("/tmp/baz")`, api)
    assert.equal(await ok.runner(''), 'content-of-/tmp/foo/bar.txt')
    await assert.rejects(() => bad.runner(''), /Capability not granted: fs/)
  })

  it('runner: deployed skill with no network capability throws on fetch', async () => {
    const tok = buildCapabilityToken({ capabilities: {} })
    const api = createSkillCapabilityAPI(tok, { fetch: async () => ({ ok: true }) })
    const w = wrapSkillScript(`return await fetch("https://anywhere.com/")`, api)
    await assert.rejects(
      () => w.runner(''),
      (err) => /Capability not granted: net/.test(err.message)
            && /manifest\.capabilities\.net/.test(err.message),
    )
  })
})
