// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-pod-embed.test.mjs
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// Stub BrowserTool before importing embed
globalThis.BrowserTool = class { constructor() {} }

import { EmbeddedPod, ClawserEmbed } from '../clawser-embed.js'
import { Pod } from '../packages/pod/src/pod.mjs'

class StubBroadcastChannel {
  constructor() { this.onmessage = null }
  postMessage() {}
  close() {}
}

function makeGlobal() {
  return {
    BroadcastChannel: StubBroadcastChannel,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

describe('EmbeddedPod', () => {
  let pod

  afterEach(async () => {
    if (pod && pod.state !== 'shutdown' && pod.state !== 'idle') {
      await pod.shutdown({ silent: true })
    }
  })

  it('extends Pod', () => {
    pod = new EmbeddedPod()
    assert.ok(pod instanceof Pod)
  })

  it('accepts config in constructor', () => {
    pod = new EmbeddedPod({ containerId: 'my-app', provider: 'openai' })
    assert.equal(pod.config.containerId, 'my-app')
    assert.equal(pod.config.provider, 'openai')
  })

  it('boots as a pod', async () => {
    pod = new EmbeddedPod()
    const g = makeGlobal()
    await pod.boot({ globalThis: g, discoveryTimeout: 50, handshakeTimeout: 50 })
    assert.equal(pod.state, 'ready')
    assert.ok(pod.podId)
  })

  it('has sendMessage method', async () => {
    pod = new EmbeddedPod()
    const g = makeGlobal()
    await pod.boot({ globalThis: g, discoveryTimeout: 50, handshakeTimeout: 50 })
    const result = await pod.sendMessage('hello')
    assert.ok(result)
    assert.equal(result.content, '')
  })

  it('has event emitter (on/off)', () => {
    pod = new EmbeddedPod()
    const calls = []
    const fn = (d) => calls.push(d)
    pod.on('test', fn)
    pod.off('test', fn)
    // No error thrown
  })
})

describe('ClawserEmbed backward compat', () => {
  it('ClawserEmbed is EmbeddedPod', () => {
    assert.equal(ClawserEmbed, EmbeddedPod)
  })
})
