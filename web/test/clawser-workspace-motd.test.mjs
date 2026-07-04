// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-workspace-motd.test.mjs
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Stub globals needed by the deep workspace lifecycle import chain
globalThis.BrowserTool = globalThis.BrowserTool || class { constructor() {} }
try { globalThis.crypto = globalThis.crypto || { subtle: {}, getRandomValues: (a) => a, randomUUID: () => 'test-uuid' } } catch {}
globalThis.fetch = globalThis.fetch || (async () => ({ ok: true, json: async () => ({}) }))
globalThis.MutationObserver = globalThis.MutationObserver || class { observe() {} disconnect() {} }
globalThis.IntersectionObserver = globalThis.IntersectionObserver || class { observe() {} disconnect() {} }
globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe() {} disconnect() {} }
const _origGetById = globalThis.document?.getElementById
if (globalThis.document) {
  globalThis.document.getElementById = (id) => _origGetById?.(id) ?? { value: '', textContent: '', innerHTML: '', className: '', style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false } }, addEventListener(){}, removeEventListener(){}, appendChild(){}, querySelector(){ return null }, querySelectorAll(){ return [] } }
}

import { displayMotd } from '../clawser-workspace-lifecycle.js'

describe('displayMotd', () => {
  it('shows the motd file content as a system message', async () => {
    const calls = []
    const shell = { fs: { readFile: async (p) => (p === '/etc/clawser/motd' ? '  Welcome aboard  \n' : '') } }
    await displayMotd({ shell, notify: (type, text) => calls.push([type, text]) })

    assert.deepEqual(calls, [['system', 'Welcome aboard']])
  })

  it('stays silent when the motd file is empty or whitespace', async () => {
    const calls = []
    const shell = { fs: { readFile: async () => '   \n' } }
    await displayMotd({ shell, notify: (...a) => calls.push(a) })

    assert.equal(calls.length, 0)
  })

  it('stays silent when the motd file is missing', async () => {
    const calls = []
    const shell = { fs: { readFile: async () => { throw new Error('ENOENT') } } }
    await displayMotd({ shell, notify: (...a) => calls.push(a) })

    assert.equal(calls.length, 0)
  })

  it('stays silent when no shell exists', async () => {
    const calls = []
    await displayMotd({ shell: null, notify: (...a) => calls.push(a) })

    assert.equal(calls.length, 0)
  })
})
