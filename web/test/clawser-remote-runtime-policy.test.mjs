import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  meshTemplateToWshExposure,
  RemoteRuntimePolicyAdapter,
} from '../clawser-remote-runtime-policy.js'
import { RemoteRuntimeRegistry } from '../clawser-remote-runtime-registry.js'
import { RemoteSessionBroker } from '../clawser-remote-session-broker.js'
import {
  createReachabilityDescriptor,
  createRemoteIdentity,
  createRemotePeerDescriptor,
} from '../clawser-remote-runtime-types.js'

describe('RemoteRuntimePolicyAdapter', () => {
  it('translates mesh ACL templates into wsh exposure presets', () => {
    assert.deepEqual(meshTemplateToWshExposure('guest'), {
      shell: false,
      exec: false,
      fs: false,
      tools: true,
      gateway: false,
    })
    assert.equal(meshTemplateToWshExposure('unknown'), null)
  })

  it('denies broker target resolution when the mapped mesh ACL template blocks the intent', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'guest-peer' }),
      username: 'guest',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell', 'tools'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
          capabilities: ['shell', 'tools'],
        }),
      ],
      sources: ['wsh-relay'],
      metadata: {
        templateName: 'guest',
      },
    }))

    const broker = new RemoteSessionBroker({
      runtimeRegistry: registry,
      policyAdapter: new RemoteRuntimePolicyAdapter(),
    })

    assert.throws(
      () => broker.resolveTarget('guest-peer', { intent: 'terminal' }),
      /denies terminal/i,
    )
    const tools = broker.resolveTarget('guest-peer', { intent: 'tools' })
    assert.equal(tools.descriptor.username, 'guest')
  })

  it('ranks routes using relay health signals', () => {
    const adapter = new RemoteRuntimePolicyAdapter({
      relayHealthProvider: (relayHost) => (relayHost === 'healthy.example' ? 'healthy' : 'degraded'),
    })
    const descriptor = createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'peer-1', fingerprint: 'peer-1' }),
      username: 'operator',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell'],
      reachability: [],
      sources: ['wsh-relay'],
    })

    const ranked = adapter.rankRoutes(
      descriptor,
      { intent: 'terminal' },
      [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'degraded.example',
          relayPort: 4422,
        }),
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'healthy.example',
          relayPort: 4422,
        }),
      ],
    )

    assert.equal(ranked[0].relayHost, 'healthy.example')
    assert.match(ranked[0].policy.reasons.join(','), /relay-healthy/)
    assert.match(ranked[1].policy.reasons.join(','), /relay-degraded/)
  })
})
