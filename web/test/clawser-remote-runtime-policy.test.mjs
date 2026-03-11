import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  meshTemplateToWshExposure,
  meshScopesToWshExposure,
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

  it('derives exposure presets from mesh ACL scopes for custom templates', () => {
    assert.deepEqual(meshScopesToWshExposure(['files:read', 'compute:submit']), {
      shell: true,
      exec: true,
      fs: true,
      tools: true,
      gateway: false,
    })
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

  it('uses mesh ACL template scopes when the template is not a built-in preset', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'scoped-peer' }),
      username: 'scoped',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell', 'fs', 'tools'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
          capabilities: ['shell', 'fs', 'tools'],
        }),
      ],
      sources: ['wsh-relay'],
      metadata: {
        templateName: 'readonly-tools',
      },
    }))

    const broker = new RemoteSessionBroker({
      runtimeRegistry: registry,
      policyAdapter: new RemoteRuntimePolicyAdapter({
        meshAcl: {
          getTemplate(name) {
            if (name !== 'readonly-tools') return null
            return { scopes: ['chat:*'] }
          },
        },
      }),
    })

    assert.throws(
      () => broker.resolveTarget('scoped-peer', { intent: 'terminal' }),
      /denies terminal/i,
    )
    assert.throws(
      () => broker.resolveTarget('scoped-peer', { intent: 'files' }),
      /denies files/i,
    )
    const tools = broker.resolveTarget('scoped-peer', { intent: 'tools' })
    assert.equal(tools.descriptor.username, 'scoped')
  })

  it('enforces minimum trust levels for sensitive intents', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'gateway-peer', fingerprint: 'gateway-peer' }),
      username: 'gateway',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell', 'gateway'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
          capabilities: ['shell', 'gateway'],
        }),
      ],
      sources: ['wsh-relay'],
      metadata: {
        trustLevel: 0.2,
      },
    }))

    const broker = new RemoteSessionBroker({
      runtimeRegistry: registry,
      policyAdapter: new RemoteRuntimePolicyAdapter(),
    })

    assert.throws(
      () => broker.resolveTarget('gateway-peer', { intent: 'gateway' }),
      /requires trust >= 0.50/i,
    )
  })

  it('requires deployment support and higher trust for deployment intents', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'deploy-peer', fingerprint: 'deploy-peer' }),
      username: 'deploy',
      peerType: 'browser-shell',
      shellBackend: 'virtual-shell',
      capabilities: ['fs', 'tools'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
          capabilities: ['fs', 'tools'],
        }),
      ],
      sources: ['wsh-relay'],
      metadata: {
        trustLevel: 0.3,
        deploymentSupport: { canDeploy: false },
      },
    }))

    const broker = new RemoteSessionBroker({
      runtimeRegistry: registry,
      policyAdapter: new RemoteRuntimePolicyAdapter(),
    })

    assert.throws(
      () => broker.resolveTarget('deploy-peer', { intent: 'deployment' }),
      /deployment support|requires trust >= 0.45/i,
    )
  })

  it('uses route success rate as a ranking signal', () => {
    const adapter = new RemoteRuntimePolicyAdapter()
    const descriptor = createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'peer-2', fingerprint: 'peer-2' }),
      username: 'builder',
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
          relayHost: 'steady.example',
          relayPort: 4422,
          successRate: 0.95,
        }),
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'flaky.example',
          relayPort: 4422,
          successRate: 0.4,
        }),
      ],
    )

    assert.equal(ranked[0].relayHost, 'steady.example')
    assert.match(ranked[0].policy.reasons.join(','), /high-success-rate/)
    assert.match(ranked[1].policy.reasons.join(','), /low-success-rate/)
  })

  it('folds observed runtime quality into later route ranking', () => {
    const adapter = new RemoteRuntimePolicyAdapter()
    const descriptor = createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'peer-3', fingerprint: 'peer-3' }),
      username: 'runtime',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell'],
      reachability: [],
      sources: ['wsh-relay'],
    })
    adapter.observeOutcome(descriptor, null, { status: 'success' })
    adapter.observeOutcome(descriptor, null, { status: 'success' })

    const ranked = adapter.rankRoutes(
      descriptor,
      { intent: 'terminal' },
      [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
        }),
      ],
    )

    assert.match(ranked[0].policy.reasons.join(','), /runtime-quality:/)
  })

  it('uses quota signals when ranking gateway routes', () => {
    const adapter = new RemoteRuntimePolicyAdapter({
      quotaEnforcer: {
        checkQuota() {
          return { allowed: false, resource: 'jobsPerHour' }
        },
      },
    })
    const descriptor = createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'peer-4', fingerprint: 'peer-4' }),
      username: 'gateway',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['gateway'],
      reachability: [],
      sources: ['wsh-relay'],
    })

    const ranked = adapter.rankRoutes(
      descriptor,
      { intent: 'gateway' },
      [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
        }),
      ],
    )

    assert.match(ranked[0].policy.reasons.join(','), /quota-blocked:jobsPerHour/)
  })

  it('records observed runtime quality back into peer reputation', () => {
    const peerRegistry = {
      recorded: [],
      checkAccess() {
        return { allowed: true }
      },
      recordObservedTrust(fingerprint, level) {
        this.recorded.push({ fingerprint, level })
      },
      getReputation() {
        return 0.6
      },
    }
    const adapter = new RemoteRuntimePolicyAdapter({ peerRegistry })
    const descriptor = createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'peer-5', fingerprint: 'peer-5' }),
      username: 'runtime',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell'],
      reachability: [],
      sources: ['wsh-relay'],
    })

    adapter.observeOutcome(descriptor, null, { status: 'success' })
    adapter.observeOutcome(descriptor, null, { status: 'failure' })

    assert.equal(peerRegistry.recorded.length, 2)
    assert.equal(peerRegistry.recorded[0].fingerprint, 'peer-5')
    assert.equal(typeof peerRegistry.recorded[0].level, 'number')
  })
})
