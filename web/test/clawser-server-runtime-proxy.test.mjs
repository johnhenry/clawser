import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { resolveRuntimeProxyTarget } from '../clawser-server.js'

describe('resolveRuntimeProxyTarget', () => {
  it('passes through raw HTTP proxy targets', async () => {
    const url = await resolveRuntimeProxyTarget('https://api.example.test/base', '/v1/ping?x=1')

    assert.equal(url, 'https://api.example.test/base/v1/ping?x=1')
  })

  it('resolves service aliases via the runtime service resolver', async () => {
    const url = await resolveRuntimeProxyTarget('svc://calendar', '/events', async ({ kind, serviceName }) => {
      assert.equal(kind, 'service')
      assert.equal(serviceName, 'calendar')
      return { address: 'https://calendar.example.test/api' }
    })

    assert.equal(url, 'https://calendar.example.test/api/events')
  })

  it('resolves runtime-scoped services via the runtime service resolver', async () => {
    const url = await resolveRuntimeProxyTarget('runtime://host:alpha/http', '/healthz', async ({ kind, selector, serviceName }) => {
      assert.equal(kind, 'runtime-service')
      assert.equal(selector, 'host:alpha')
      assert.equal(serviceName, 'http')
      return { address: 'https://alpha.example.test/root' }
    })

    assert.equal(url, 'https://alpha.example.test/root/healthz')
  })

  it('rejects non-http runtime service addresses', async () => {
    await assert.rejects(
      () => resolveRuntimeProxyTarget('svc://calendar', '/events', async () => ({ address: 'mesh://alpha/calendar' })),
      /not bound to an HTTP endpoint/,
    )
  })

  it('resolves endpoint aliases through the runtime service resolver', async () => {
    const url = await resolveRuntimeProxyTarget('endpoint://alpha', '/healthz', async ({ kind, endpointName }) => {
      assert.equal(kind, 'endpoint')
      assert.equal(endpointName, 'alpha')
      return { endpoint: 'https://alpha.example.test:4422/base' }
    })

    assert.equal(url, 'https://alpha.example.test:4422/base/healthz')
  })
})
