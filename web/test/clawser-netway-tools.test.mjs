// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-netway-tools.test.mjs
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  configureRemoteRuntimeGateway,
  getVirtualNetwork,
  resetNetwayToolsForTests,
} from '../clawser-netway-tools.js'

function makeGatewayPeer(overrides = {}) {
  return {
    identity: { canonicalId: 'gateway-peer', fingerprint: 'gateway-peer', aliases: [] },
    peerType: 'host',
    shellBackend: 'pty',
    capabilities: ['gateway'],
    ...overrides,
  }
}

function makeGatewayClient() {
  const client = {
    state: 'authenticated',
    sent: [],
    onGatewayMessage: null,
    async sendControl(message) {
      client.sent.push(message)
      if (message.type === 0x70) {
        setTimeout(() => {
          client.onGatewayMessage?.({
            type: 0x73,
            gateway_id: message.gateway_id,
            resolved_addr: '127.0.0.1',
          })
        }, 0)
      }
      if (message.type === 0x75) {
        setTimeout(() => {
          client.onGatewayMessage?.({
            type: 0x75,
            gateway_id: message.gateway_id,
          })
        }, 0)
      }
    },
  }
  return client
}

describe('configureRemoteRuntimeGateway', () => {
  afterEach(async () => {
    await resetNetwayToolsForTests()
  })

  it('registers tcp and udp schemes on the shared virtual network', () => {
    configureRemoteRuntimeGateway({
      remoteSessionBroker: {
        listTargets: () => [makeGatewayPeer()],
        explainRoute: () => ({ route: { kind: 'reverse-relay', health: 'online' }, health: { failures: 0 } }),
        openSession: async () => ({ client: makeGatewayClient(), close: async () => {} }),
      },
    })

    const schemes = getVirtualNetwork().schemes.slice().sort()
    assert.ok(schemes.includes('tcp'))
    assert.ok(schemes.includes('udp'))
  })

  it('connects through the shared broker when opening tcp sockets', async () => {
    const brokerCalls = []
    const client = makeGatewayClient()
    configureRemoteRuntimeGateway({
      remoteSessionBroker: {
        listTargets: () => [makeGatewayPeer()],
        explainRoute: () => ({ route: { kind: 'reverse-relay', health: 'online' }, health: { failures: 0 } }),
        async openSession(selector, opts) {
          brokerCalls.push({ selector, opts })
          return { client, close: async () => { client.state = 'disconnected' } }
        },
      },
    })

    const socket = await getVirtualNetwork().connect('tcp://example.com:443')

    assert.ok(socket)
    assert.equal(brokerCalls.length, 1)
    assert.equal(brokerCalls[0].selector, 'gateway-peer')
    assert.equal(brokerCalls[0].opts.intent, 'gateway')
    assert.deepEqual(brokerCalls[0].opts.requiredCapabilities, ['gateway'])
    assert.equal(client.sent[0].type, 0x70)
    assert.equal(client.sent[0].host, 'example.com')
    assert.equal(client.sent[0].port, 443)

    await socket.close()
  })
})
