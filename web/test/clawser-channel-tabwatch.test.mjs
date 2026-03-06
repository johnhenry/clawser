/**
 * Tests for clawser-channel-tabwatch.js — TabWatcherPlugin + site profiles.
 *
 * Run:
 *   node --import ./web/test/_setup-globals.mjs --test web/test/clawser-channel-tabwatch.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// Stub BrowserTool before imports
globalThis.BrowserTool = class { constructor() {} }

import { TabWatcherPlugin, SITE_PROFILES } from '../clawser-channel-tabwatch.js'

// ── Mock RPC client ─────────────────────────────────────────────

function createMockRpc() {
  const calls = []
  return {
    calls,
    connected: true,
    async call(action, params) {
      calls.push({ action, params })

      if (action === 'tab_watch_start') {
        return { tabId: params.tabId, watching: true }
      }
      if (action === 'tab_watch_poll') {
        return { tabId: params.tabId, messages: [] }
      }
      if (action === 'tab_watch_stop') {
        return { tabId: params.tabId, watching: false }
      }
      if (action === 'type') {
        return { typed: '5 chars', submitted: false }
      }
      if (action === 'key') {
        return { key: params.key }
      }
      return {}
    },
  }
}

// ── Site Profiles ─────────────────────────────────────────────────

describe('SITE_PROFILES', () => {
  it('defines slack profile', () => {
    assert.ok(SITE_PROFILES.slack)
    assert.equal(SITE_PROFILES.slack.name, 'Slack')
    assert.ok(SITE_PROFILES.slack.containerSelector)
    assert.ok(SITE_PROFILES.slack.messageSelector)
    assert.ok(SITE_PROFILES.slack.senderSelector)
    assert.ok(SITE_PROFILES.slack.inputSelector)
    assert.equal(SITE_PROFILES.slack.sendMethod, 'enter')
  })

  it('defines gmail profile', () => {
    assert.ok(SITE_PROFILES.gmail)
    assert.equal(SITE_PROFILES.gmail.name, 'Gmail')
    assert.equal(SITE_PROFILES.gmail.sendMethod, 'ctrl+enter')
  })

  it('defines discord profile', () => {
    assert.ok(SITE_PROFILES.discord)
    assert.equal(SITE_PROFILES.discord.name, 'Discord')
    assert.equal(SITE_PROFILES.discord.sendMethod, 'enter')
  })

  it('is frozen', () => {
    assert.throws(() => { SITE_PROFILES.twitter = {} })
  })
})

// ── TabWatcherPlugin constructor ─────────────────────────────────

describe('TabWatcherPlugin constructor', () => {
  it('requires tabId', () => {
    const rpc = createMockRpc()
    assert.throws(() => new TabWatcherPlugin({ rpc }), /tabId is required/)
  })

  it('requires rpc', () => {
    assert.throws(() => new TabWatcherPlugin({ tabId: 1 }), /rpc client is required/)
  })

  it('creates with siteProfile', () => {
    const rpc = createMockRpc()
    const plugin = new TabWatcherPlugin({ tabId: 42, rpc, siteProfile: 'slack' })
    assert.equal(plugin.tabId, 42)
    assert.equal(plugin.siteProfile, 'slack')
    assert.equal(plugin.running, false)
  })

  it('creates with custom selector', () => {
    const rpc = createMockRpc()
    const plugin = new TabWatcherPlugin({ tabId: 7, rpc, selector: '.my-messages' })
    assert.equal(plugin.tabId, 7)
    assert.equal(plugin.siteProfile, null)
  })
})

// ── Lifecycle ─────────────────────────────────────────────────────

describe('TabWatcherPlugin lifecycle', () => {
  let rpc, plugin

  beforeEach(() => {
    rpc = createMockRpc()
    plugin = new TabWatcherPlugin({ tabId: 100, rpc, siteProfile: 'discord' })
  })

  afterEach(async () => {
    if (plugin.running) await plugin.stop()
  })

  it('start() calls tab_watch_start with siteProfile', async () => {
    await plugin.start()
    assert.equal(plugin.running, true)
    const startCall = rpc.calls.find(c => c.action === 'tab_watch_start')
    assert.ok(startCall)
    assert.equal(startCall.params.tabId, 100)
    assert.equal(startCall.params.siteProfile, 'discord')
  })

  it('start() with custom selector', async () => {
    const p = new TabWatcherPlugin({ tabId: 50, rpc, selector: '#chat-list' })
    await p.start()
    assert.equal(p.running, true)
    const startCall = rpc.calls.find(c => c.action === 'tab_watch_start')
    assert.equal(startCall.params.selector, '#chat-list')
    assert.equal(startCall.params.siteProfile, undefined)
    await p.stop()
  })

  it('start() requires siteProfile or selector', async () => {
    const p = new TabWatcherPlugin({ tabId: 50, rpc, siteProfile: undefined, selector: undefined })
    // Neither provided — should throw
    // Constructor allows it (validation at start time)
    await assert.rejects(() => p.start(), /siteProfile or selector/)
  })

  it('start() is idempotent', async () => {
    await plugin.start()
    await plugin.start()
    const startCalls = rpc.calls.filter(c => c.action === 'tab_watch_start')
    assert.equal(startCalls.length, 1)
  })

  it('stop() calls tab_watch_stop', async () => {
    await plugin.start()
    await plugin.stop()
    assert.equal(plugin.running, false)
    const stopCall = rpc.calls.find(c => c.action === 'tab_watch_stop')
    assert.ok(stopCall)
    assert.equal(stopCall.params.tabId, 100)
  })

  it('stop() is idempotent', async () => {
    await plugin.start()
    await plugin.stop()
    await plugin.stop()
    const stopCalls = rpc.calls.filter(c => c.action === 'tab_watch_stop')
    assert.equal(stopCalls.length, 1)
  })

  it('stop() handles rpc error gracefully', async () => {
    const failRpc = {
      async call(action) {
        if (action === 'tab_watch_start') return {}
        if (action === 'tab_watch_stop') throw new Error('Tab closed')
        return {}
      },
    }
    const p = new TabWatcherPlugin({ tabId: 1, rpc: failRpc, siteProfile: 'slack' })
    await p.start()
    await p.stop() // Should not throw
    assert.equal(p.running, false)
  })
})

// ── onMessage callback ────────────────────────────────────────────

describe('TabWatcherPlugin onMessage', () => {
  it('registers callback', () => {
    const rpc = createMockRpc()
    const plugin = new TabWatcherPlugin({ tabId: 1, rpc, siteProfile: 'slack' })
    const cb = () => {}
    plugin.onMessage(cb)
    assert.equal(plugin._callback, cb)
  })
})

// ── sendMessage ───────────────────────────────────────────────────

describe('TabWatcherPlugin sendMessage', () => {
  it('types text and presses Enter for slack profile', async () => {
    const rpc = createMockRpc()
    const plugin = new TabWatcherPlugin({ tabId: 10, rpc, siteProfile: 'slack' })

    const result = await plugin.sendMessage('Hello from agent')
    assert.equal(result, true)

    const typeCall = rpc.calls.find(c => c.action === 'type')
    assert.ok(typeCall)
    assert.equal(typeCall.params.tabId, 10)
    assert.equal(typeCall.params.text, 'Hello from agent')
    assert.equal(typeCall.params.selector, SITE_PROFILES.slack.inputSelector)

    const keyCall = rpc.calls.find(c => c.action === 'key')
    assert.ok(keyCall)
    assert.equal(keyCall.params.key, 'Enter')
  })

  it('uses ctrl+enter for gmail profile', async () => {
    const rpc = createMockRpc()
    const plugin = new TabWatcherPlugin({ tabId: 20, rpc, siteProfile: 'gmail' })

    await plugin.sendMessage('Reply text')

    const keyCall = rpc.calls.find(c => c.action === 'key')
    assert.equal(keyCall.params.key, 'ctrl+Enter')
  })

  it('returns false when no inputSelector available', async () => {
    const rpc = createMockRpc()
    // No siteProfile, no opts.inputSelector
    const plugin = new TabWatcherPlugin({ tabId: 5, rpc, selector: '.container' })

    const result = await plugin.sendMessage('test')
    assert.equal(result, false)
    assert.equal(rpc.calls.length, 0) // No RPC calls made
  })

  it('returns false on rpc error', async () => {
    const failRpc = {
      async call() { throw new Error('Tab crashed') },
    }
    const plugin = new TabWatcherPlugin({ tabId: 5, rpc: failRpc, siteProfile: 'slack' })

    const result = await plugin.sendMessage('test')
    assert.equal(result, false)
  })
})

// ── Message normalization ─────────────────────────────────────────

describe('TabWatcherPlugin message normalization', () => {
  it('normalizes polled messages via callback', async () => {
    const messages = []
    const rpc = {
      async call(action, params) {
        if (action === 'tab_watch_start') return {}
        if (action === 'tab_watch_poll') {
          return {
            messages: [
              { text: 'Hello world', sender: 'alice', timestamp: 1700000000000 },
              { text: 'Hi there', sender: 'bob', timestamp: 1700000001000 },
            ],
          }
        }
        if (action === 'tab_watch_stop') return {}
        return {}
      },
    }

    const plugin = new TabWatcherPlugin({
      tabId: 42,
      rpc,
      siteProfile: 'slack',
      pollInterval: 50, // Fast polling for test
    })

    plugin.onMessage((msg) => messages.push(msg))
    await plugin.start()

    // Wait for one poll cycle
    await new Promise(r => setTimeout(r, 120))
    await plugin.stop()

    assert.ok(messages.length >= 2, `Expected >=2 messages, got ${messages.length}`)

    const first = messages[0]
    assert.equal(first.channel, 'ext:slack')
    assert.equal(first.channelId, '42')
    assert.equal(first.sender.name, 'alice')
    assert.equal(first.content, 'Hello world')
    assert.ok(first.id.startsWith('tw_42_'))
    assert.equal(first.attachments.length, 0)
    assert.equal(first.replyTo, null)

    const second = messages[1]
    assert.equal(second.sender.name, 'bob')
    assert.equal(second.content, 'Hi there')
  })
})

// ── Polling ───────────────────────────────────────────────────────

describe('TabWatcherPlugin polling', () => {
  it('polls at configured interval', async () => {
    let pollCount = 0
    const rpc = {
      async call(action) {
        if (action === 'tab_watch_start') return {}
        if (action === 'tab_watch_poll') {
          pollCount++
          return { messages: [] }
        }
        if (action === 'tab_watch_stop') return {}
        return {}
      },
    }

    const plugin = new TabWatcherPlugin({
      tabId: 1,
      rpc,
      siteProfile: 'discord',
      pollInterval: 40,
    })

    await plugin.start()
    await new Promise(r => setTimeout(r, 150))
    await plugin.stop()

    // Should have polled multiple times
    assert.ok(pollCount >= 2, `Expected >=2 polls, got ${pollCount}`)
  })

  it('stops polling when stopped', async () => {
    let pollCount = 0
    const rpc = {
      async call(action) {
        if (action === 'tab_watch_start') return {}
        if (action === 'tab_watch_poll') {
          pollCount++
          return { messages: [] }
        }
        if (action === 'tab_watch_stop') return {}
        return {}
      },
    }

    const plugin = new TabWatcherPlugin({
      tabId: 1,
      rpc,
      siteProfile: 'slack',
      pollInterval: 30,
    })

    await plugin.start()
    await new Promise(r => setTimeout(r, 80))
    await plugin.stop()

    const countAtStop = pollCount
    await new Promise(r => setTimeout(r, 100))

    // No more polls after stop
    assert.equal(pollCount, countAtStop)
  })

  it('handles poll errors gracefully', async () => {
    let pollCount = 0
    const rpc = {
      async call(action) {
        if (action === 'tab_watch_start') return {}
        if (action === 'tab_watch_poll') {
          pollCount++
          if (pollCount === 1) throw new Error('Network error')
          return { messages: [] }
        }
        if (action === 'tab_watch_stop') return {}
        return {}
      },
    }

    const plugin = new TabWatcherPlugin({
      tabId: 1,
      rpc,
      siteProfile: 'slack',
      pollInterval: 30,
    })

    await plugin.start()
    await new Promise(r => setTimeout(r, 120))
    await plugin.stop()

    // Should have continued polling despite error
    assert.ok(pollCount >= 2)
  })
})

// ── toJSON ─────────────────────────────────────────────────────────

describe('TabWatcherPlugin toJSON', () => {
  it('serializes state', () => {
    const rpc = createMockRpc()
    const plugin = new TabWatcherPlugin({
      tabId: 99,
      rpc,
      siteProfile: 'gmail',
      pollInterval: 3000,
    })

    const json = plugin.toJSON()
    assert.equal(json.tabId, 99)
    assert.equal(json.siteProfile, 'gmail')
    assert.equal(json.selector, null)
    assert.equal(json.pollInterval, 3000)
    assert.equal(json.running, false)
  })
})

// ── Gateway integration ───────────────────────────────────────────

describe('TabWatcherPlugin gateway integration', () => {
  it('works as a channel plugin with gateway', async () => {
    const ingestedMessages = []

    // Mock gateway
    const gateway = {
      registered: new Map(),
      started: new Set(),
      register(channelId, plugin, config) {
        this.registered.set(channelId, { plugin, config })
      },
      start(channelId) {
        this.started.add(channelId)
        const entry = this.registered.get(channelId)
        if (entry?.plugin?.onMessage) {
          entry.plugin.onMessage((msg) => ingestedMessages.push(msg))
        }
        if (entry?.plugin?.start) entry.plugin.start()
      },
      stop(channelId) {
        this.started.delete(channelId)
        const entry = this.registered.get(channelId)
        if (entry?.plugin?.stop) entry.plugin.stop()
      },
      unregister(channelId) {
        this.registered.delete(channelId)
      },
    }

    const rpc = {
      async call(action) {
        if (action === 'tab_watch_start') return {}
        if (action === 'tab_watch_poll') {
          return {
            messages: [
              { text: 'New slack message', sender: 'charlie', timestamp: Date.now() },
            ],
          }
        }
        if (action === 'tab_watch_stop') return {}
        return {}
      },
    }

    const plugin = new TabWatcherPlugin({
      tabId: 200,
      rpc,
      siteProfile: 'slack',
      pollInterval: 50,
    })

    // Register and start via gateway
    gateway.register('ext:200', plugin, { scope: 'shared' })
    gateway.start('ext:200')

    // Wait for poll cycle
    await new Promise(r => setTimeout(r, 120))

    gateway.stop('ext:200')

    assert.ok(ingestedMessages.length >= 1)
    assert.equal(ingestedMessages[0].channel, 'ext:slack')
    assert.equal(ingestedMessages[0].content, 'New slack message')
  })
})
