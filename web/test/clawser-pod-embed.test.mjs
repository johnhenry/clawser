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

  it('throws when sendMessage called without agent', async () => {
    pod = new EmbeddedPod()
    await assert.rejects(
      () => pod.sendMessage('hello'),
      { message: /No agent attached/ }
    )
  })

  it('routes sendMessage through agent', async () => {
    const messages = []
    const toolCallEvents = []
    const stubAgent = {
      sendMessage(text, opts) { messages.push({ text, opts }) },
      getEventLog() {
        return {
          query({ type }) {
            return type === 'tool_call' ? toolCallEvents : []
          }
        }
      },
      async run() {
        return { status: 1, data: 'Hello back!', usage: { input_tokens: 10, output_tokens: 5 }, model: 'test-model' }
      }
    }

    pod = new EmbeddedPod({ agent: stubAgent })
    const result = await pod.sendMessage('hello')
    assert.equal(result.content, 'Hello back!')
    assert.deepEqual(result.toolCalls, [])
    assert.equal(result.model, 'test-model')
    assert.equal(messages.length, 1)
    assert.equal(messages[0].text, 'hello')
  })

  it('extracts tool calls from event log', async () => {
    const toolCallEvents = []
    const stubAgent = {
      sendMessage() {},
      getEventLog() {
        return {
          query({ type }) {
            return type === 'tool_call' ? [...toolCallEvents] : []
          }
        }
      },
      async run() {
        // Simulate tool calls appearing during run
        toolCallEvents.push({
          data: { call_id: 'tc_1', name: 'fetch', arguments: '{"url":"https://example.com"}' }
        })
        return { status: 1, data: 'Fetched the page.' }
      }
    }

    pod = new EmbeddedPod()
    pod.setAgent(stubAgent)
    const result = await pod.sendMessage('fetch example.com')
    assert.equal(result.content, 'Fetched the page.')
    assert.equal(result.toolCalls.length, 1)
    assert.equal(result.toolCalls[0].name, 'fetch')
    assert.equal(result.toolCalls[0].id, 'tc_1')
  })

  it('returns error flag on agent failure', async () => {
    const stubAgent = {
      sendMessage() {},
      getEventLog() { return { query() { return [] } } },
      async run() { return { status: -1, data: 'Provider error: timeout' } }
    }

    pod = new EmbeddedPod({ agent: stubAgent })
    const result = await pod.sendMessage('hello')
    assert.equal(result.error, true)
    assert.equal(result.content, 'Provider error: timeout')
  })

  it('exposes agent via getter and setAgent', () => {
    pod = new EmbeddedPod()
    assert.equal(pod.agent, null)
    const stub = { sendMessage() {} }
    pod.setAgent(stub)
    assert.equal(pod.agent, stub)
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
