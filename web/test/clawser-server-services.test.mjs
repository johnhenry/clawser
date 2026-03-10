import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  bindServerManagerServices,
  serverRouteToServiceDescriptor,
} from '../clawser-server-services.js'

describe('serverRouteToServiceDescriptor', () => {
  it('maps a virtual server route to a canonical service advertisement', () => {
    const descriptor = serverRouteToServiceDescriptor({
      id: 'srv_1',
      hostname: 'api.local',
      port: 8080,
      scope: '_global',
      handler: { type: 'proxy', execution: 'page' },
    })

    assert.equal(descriptor.name, 'server:srv_1')
    assert.equal(descriptor.type, 'http-proxy')
    assert.deepEqual(descriptor.capabilities, ['service', 'http', 'virtual-server'])
    assert.equal(descriptor.metadata.hostname, 'api.local')
    assert.equal(descriptor.metadata.port, 8080)
    assert.equal(descriptor.metadata.handlerType, 'proxy')
  })
})

describe('bindServerManagerServices', () => {
  it('advertises enabled routes and withdraws disabled ones on change', async () => {
    let routes = [
      {
        id: 'srv_1',
        hostname: 'api.local',
        port: 8080,
        enabled: true,
        scope: '_global',
        handler: { type: 'function', execution: 'page' },
      },
    ]
    let onChange = null
    const advertised = []
    const withdrawn = []

    const cleanup = await bindServerManagerServices({
      serverManager: {
        async listRoutes() {
          return routes
        },
        onChange(fn) {
          onChange = fn
          return () => {
            onChange = null
          }
        },
      },
      serviceAdvertiser: {
        advertise(service) {
          advertised.push(service)
          return service
        },
        withdraw(name) {
          withdrawn.push(name)
          return true
        },
      },
    })

    assert.equal(advertised.length, 1)
    assert.equal(advertised[0].name, 'server:srv_1')

    routes = [
      {
        id: 'srv_1',
        hostname: 'api.local',
        port: 8080,
        enabled: false,
        scope: '_global',
        handler: { type: 'function', execution: 'page' },
      },
    ]
    await onChange()

    assert.deepEqual(withdrawn, ['server:srv_1'])

    cleanup()
  })
})
