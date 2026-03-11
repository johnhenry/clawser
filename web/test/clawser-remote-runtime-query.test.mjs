import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeRemoteRuntimeQuery,
  parseRuntimeQueryFlags,
  resolveRuntimeQuerySelector,
} from '../clawser-remote-runtime-query.js'
import { RemoteRuntimeRegistry } from '../clawser-remote-runtime-registry.js'
import { createRemoteIdentity, createRemotePeerDescriptor, createReachabilityDescriptor } from '../clawser-remote-runtime-types.js'

function makeRegistry() {
  const registry = new RemoteRuntimeRegistry()
  registry.ingestDescriptor(createRemotePeerDescriptor({
    identity: createRemoteIdentity({
      canonicalId: 'host:builder',
      fingerprint: 'abcdef0123456789abcdef0123456789',
      aliases: ['@builder'],
    }),
    username: 'builder',
    peerType: 'host',
    shellBackend: 'pty',
    capabilities: ['shell', 'exec'],
    reachability: [
      createReachabilityDescriptor({ kind: 'direct-host', source: 'direct-bookmark', endpoint: 'builder.local:4422' }),
    ],
  }))
  return registry
}

describe('remote runtime query helpers', () => {
  it('normalizes runtime query aliases', () => {
    assert.deepEqual(
      normalizeRemoteRuntimeQuery({ type: 'host', backend: 'pty', q: 'builder', capability: 'shell' }),
      {
        selector: null,
        text: 'builder',
        peerType: 'host',
        shellBackend: 'pty',
        capability: 'shell',
        capabilities: [],
        intent: null,
        source: null,
        status: null,
        serviceType: null,
        serviceName: null,
        podId: null,
        limit: null,
      },
    )
  })

  it('parses CLI flags into the canonical query shape', () => {
    assert.deepEqual(
      parseRuntimeQueryFlags({ type: 'host', capability: 'shell', status: 'healthy' }, ['builder']),
      {
        selector: null,
        text: 'builder',
        peerType: 'host',
        shellBackend: null,
        capability: 'shell',
        capabilities: [],
        intent: null,
        source: null,
        status: 'healthy',
        serviceType: null,
        serviceName: null,
        podId: null,
        limit: null,
      },
    )
  })

  it('resolves a canonical selector when exactly one peer matches', () => {
    assert.equal(
      resolveRuntimeQuerySelector(makeRegistry(), { type: 'host', capability: 'shell', text: 'builder' }),
      'host:builder',
    )
  })
})
