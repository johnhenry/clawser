import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { MeshNameResolver } from '../clawser-mesh-naming.js'
import { RemoteRuntimePolicyAdapter } from '../clawser-remote-runtime-policy.js'
import { RemoteRuntimeRegistry } from '../clawser-remote-runtime-registry.js'
import { RemoteSessionBroker, RemoteSessionError } from '../clawser-remote-session-broker.js'
import {
  canonicalIdForFingerprint,
  createReachabilityDescriptor,
  createRemoteIdentity,
  createRemotePeerDescriptor,
} from '../clawser-remote-runtime-types.js'

describe('RemoteRuntimeRegistry', () => {
  it('merges linked mesh and wsh identities into one descriptor', () => {
    const registry = new RemoteRuntimeRegistry()
    const fingerprint = '0123456789abcdef0123456789abcdef'
    const canonicalId = canonicalIdForFingerprint(fingerprint)

    registry.ingestMeshDiscovery({
      podId: canonicalId,
      label: 'alice',
      endpoint: 'webrtc://alice',
      transport: 'webrtc',
      capabilities: ['shell'],
      metadata: {
        username: 'alice',
        peerType: 'browser-shell',
        shellBackend: 'virtual-shell',
        wshFingerprint: fingerprint,
      },
      discoveredAt: 100,
      source: 'mesh-discovery',
    })

    registry.ingestWshRelayPeer({
      fingerprint,
      fingerprint_short: fingerprint.slice(0, 8),
      username: 'alice',
      capabilities: ['shell', 'tools'],
      peer_type: 'browser-shell',
      shell_backend: 'virtual-shell',
      source: 'wsh-relay',
      supports_attach: true,
      supports_replay: true,
      supports_echo: true,
      supports_term_sync: true,
      last_seen: 5,
    }, {
      relayHost: 'relay.example',
      relayPort: 4422,
    })

    const peers = registry.listPeers()
    assert.equal(peers.length, 1)
    assert.deepEqual(peers[0].sources.sort(), ['mesh-discovery', 'wsh-relay'])
    assert.ok(peers[0].capabilities.includes('tools'))
    assert.equal(peers[0].identity.canonicalId, canonicalId)
  })

  it('preserves conflicts instead of flattening incompatible metadata', () => {
    const registry = new RemoteRuntimeRegistry()
    const fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

    registry.ingestWshRelayPeer({
      fingerprint,
      fingerprint_short: fingerprint.slice(0, 8),
      username: 'host-user',
      capabilities: ['shell'],
      peer_type: 'host',
      shell_backend: 'pty',
      source: 'wsh-relay',
      supports_attach: true,
      supports_replay: true,
      supports_echo: false,
      supports_term_sync: false,
      last_seen: 10,
    }, {
      relayHost: 'relay.example',
      relayPort: 4422,
    })

    registry.ingestWshRelayPeer({
      fingerprint,
      fingerprint_short: fingerprint.slice(0, 8),
      username: 'host-user',
      capabilities: ['shell'],
      peer_type: 'browser-shell',
      shell_backend: 'virtual-shell',
      source: 'wsh-relay',
      supports_attach: true,
      supports_replay: true,
      supports_echo: true,
      supports_term_sync: true,
      last_seen: 11,
    }, {
      relayHost: 'relay.example',
      relayPort: 4422,
    })

    const peer = registry.listPeers()[0]
    assert.ok(peer.conflicts.some((entry) => entry.startsWith('peerType:')))
    assert.ok(peer.conflicts.some((entry) => entry.startsWith('shellBackend:')))
  })

  it('keeps the freshest route observation for the same route key', () => {
    const registry = new RemoteRuntimeRegistry()
    const descriptor = createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'host:demo' }),
      username: 'operator',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'direct-host',
          source: 'direct-bookmark',
          endpoint: 'localhost:4422',
          transport: 'wt',
          lastSeen: 100,
          capabilities: ['shell'],
        }),
      ],
      sources: ['direct-bookmark'],
    })

    registry.ingestDescriptor(descriptor)
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'host:demo' }),
      username: 'operator',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'direct-host',
          source: 'direct-bookmark',
          endpoint: 'localhost:4422',
          transport: 'wt',
          lastSeen: 250,
          capabilities: ['shell'],
        }),
      ],
      sources: ['direct-bookmark'],
    }))

    const route = registry.listPeers()[0].reachability[0]
    assert.equal(route.lastSeen, 250)
  })

  it('records route outcomes back into reachability metadata', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDirectHostBookmark({
      id: 'host:builder',
      host: 'builder.local',
      port: 4422,
      username: 'builder',
    })

    const descriptor = registry.resolvePeer('host:builder')
    const route = descriptor.reachability[0]
    registry.recordRouteOutcome('host:builder', route, {
      status: 'failure',
      reason: 'relay timeout',
      layer: 'connector',
      timestamp: 123,
    })

    const updated = registry.resolvePeer('host:builder').reachability[0]
    assert.equal(updated.health, 'degraded')
    assert.equal(updated.lastOutcome, 'failure')
    assert.equal(updated.lastOutcomeReason, 'relay timeout')
    assert.equal(updated.failureCount, 1)
    assert.equal(updated.successRate, 0)
  })

  it('supports canonical peer queries and separates service lookup from peer lookup', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({
        canonicalId: 'host:alpha',
        aliases: ['alpha'],
      }),
      username: 'alpha',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell', 'exec', 'tools'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'direct-host',
          source: 'direct-bookmark',
          endpoint: 'alpha.local:4422',
        }),
      ],
      metadata: {
        services: ['shell-api'],
        serviceDetails: {
          'shell-api': {
            type: 'terminal',
            address: 'mesh://alpha/shell-api',
          },
        },
      },
    }))

    const query = registry.query({ text: 'shell-api', serviceName: 'shell-api' })

    assert.equal(query.peers.length, 1)
    assert.equal(query.services.length, 1)
    assert.equal(query.services[0].name, 'shell-api')
    assert.equal(registry.resolvePeer('shell-api'), null)
    assert.equal(registry.resolveService('shell-api')?.address, 'mesh://alpha/shell-api')
  })

  it('separates managed-server lookup from peer and service lookup', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({
        canonicalId: 'host:alpha',
        fingerprint: 'alpha-fingerprint',
        aliases: ['@alpha'],
      }),
      username: 'alpha',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell', 'fs'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'direct-host',
          source: 'direct-bookmark',
          endpoint: 'alpha.local:4422',
        }),
      ],
      metadata: {
        managedServers: ['dashboard'],
        serverDetails: {
          dashboard: {
            type: 'virtual-server',
            address: 'https://alpha.example.test/dashboard',
          },
        },
      },
    }))

    const servers = registry.listManagedServers()
    assert.equal(servers.length, 1)
    assert.equal(servers[0].name, 'dashboard')
    assert.equal(registry.resolveManagedServer('host:alpha', 'dashboard')?.address, 'https://alpha.example.test/dashboard')
    assert.equal(registry.resolveService('dashboard'), null)
  })

  it('resolves endpoint aliases independently from peer and service names', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({
        canonicalId: 'host:alpha',
        fingerprint: 'alpha-fingerprint',
        aliases: ['@alpha'],
      }),
      username: 'alpha',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'direct-host',
          source: 'direct-bookmark',
          endpoint: 'https://alpha.example.test:4422',
        }),
      ],
      metadata: {
        name: 'alpha',
        services: ['shell-api'],
        serviceDetails: {
          'shell-api': {
            type: 'terminal',
            address: 'mesh://alpha/shell-api',
          },
        },
      },
    }))

    const endpoint = registry.resolveEndpoint('alpha')

    assert.equal(endpoint.endpoint, 'https://alpha.example.test:4422')
    assert.equal(endpoint.routeKind, 'direct-host')
    assert.equal(registry.resolvePeer('@alpha').identity.canonicalId, 'host:alpha')
    assert.equal(registry.resolveService('shell-api')?.address, 'mesh://alpha/shell-api')
  })

  it('provides aggregate telemetry snapshots for peer health and relay usage', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'host:alpha' }),
      username: 'alpha',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'direct-host',
          source: 'direct-bookmark',
          endpoint: 'alpha.local:4422',
          health: 'healthy',
        }),
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
          health: 'degraded',
        }),
      ],
      metadata: {
        replayMode: 'lossless',
      },
    }))

    const telemetry = registry.telemetrySnapshot()
    assert.equal(telemetry.peerCount, 1)
    assert.equal(telemetry.health.healthy, 1)
    assert.equal(telemetry.relayUsage.relayRoutes, 1)
    assert.equal(telemetry.relayUsage.directRoutes, 1)
    assert.equal(telemetry.replayModes.lossless, 1)
  })

  it('demotes repeatedly failing routes during reachability ranking', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'host:builder' }),
      username: 'builder',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell', 'exec'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'direct-host',
          source: 'direct-bookmark',
          endpoint: 'builder.local:4422',
          capabilities: ['shell', 'exec'],
        }),
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
          capabilities: ['shell', 'exec'],
        }),
      ],
      sources: ['direct-bookmark', 'wsh-relay'],
    }))

    let [directRoute] = registry.computeReachability('host:builder', { intent: 'terminal' })
    assert.equal(directRoute.kind, 'direct-host')

    for (let attempt = 0; attempt < 3; attempt += 1) {
      registry.recordRouteOutcome('host:builder', directRoute, {
        status: 'failure',
        reason: 'connection reset',
        layer: 'connector',
        timestamp: 100 + attempt,
      })
      directRoute = registry.resolvePeer('host:builder').reachability.find((route) => route.kind === 'direct-host')
    }

    const ranked = registry.computeReachability('host:builder', { intent: 'terminal' })
    assert.equal(directRoute.health, 'offline')
    assert.equal(ranked[0].kind, 'reverse-relay')
  })

  it('keeps conflicting reverse relays as separate reachability options', () => {
    const registry = new RemoteRuntimeRegistry()
    const fingerprint = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

    registry.ingestWshRelayPeer({
      fingerprint,
      fingerprint_short: fingerprint.slice(0, 8),
      username: 'builder',
      capabilities: ['shell'],
      peer_type: 'host',
      shell_backend: 'pty',
      source: 'wsh-relay',
      supports_attach: true,
      supports_replay: true,
      supports_echo: false,
      supports_term_sync: false,
      last_seen: 10,
    }, {
      relayHost: 'relay-a.example',
      relayPort: 4422,
    })

    registry.ingestWshRelayPeer({
      fingerprint,
      fingerprint_short: fingerprint.slice(0, 8),
      username: 'builder',
      capabilities: ['shell'],
      peer_type: 'host',
      shell_backend: 'pty',
      source: 'wsh-relay',
      supports_attach: true,
      supports_replay: true,
      supports_echo: false,
      supports_term_sync: false,
      last_seen: 11,
    }, {
      relayHost: 'relay-b.example',
      relayPort: 4422,
    })

    const peer = registry.listPeers()[0]
    const relays = peer.reachability
      .filter((route) => route.kind === 'reverse-relay')
      .map((route) => route.relayHost)
      .sort()

    assert.deepEqual(relays, ['relay-a.example', 'relay-b.example'])
  })

  it('does not let an identity-link mismatch merge unrelated peers', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({
        canonicalId: 'mesh:alice',
        podId: 'mesh:alice',
      }),
      username: 'alice',
      peerType: 'browser-shell',
      shellBackend: 'virtual-shell',
      capabilities: ['shell'],
      sources: ['mesh-discovery'],
    }))
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({
        canonicalId: 'host:bob',
        fingerprint: 'host:bob',
      }),
      username: 'bob',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell'],
      sources: ['wsh-relay'],
    }))

    registry.linkIdentity({
      canonicalId: 'mesh:alice',
      alias: 'host:bob',
    })

    assert.equal(registry.resolvePeer('host:bob').username, 'bob')
    const alice = registry.resolvePeer('mesh:alice')
    const bob = registry.resolvePeer('host:bob')
    assert.ok(alice.conflicts.some((entry) => entry.includes('identityAlias:host:bob')))
    assert.ok(bob.conflicts.some((entry) => entry.includes('identityAlias:host:bob')))
  })

  it('keeps a canonical peer record stable across relay re-registration', () => {
    const registry = new RemoteRuntimeRegistry()
    const fingerprint = 'cccccccccccccccccccccccccccccccc'

    registry.ingestWshRelayPeer({
      fingerprint,
      fingerprint_short: fingerprint.slice(0, 8),
      username: 'builder',
      capabilities: ['shell'],
      peer_type: 'host',
      shell_backend: 'pty',
      source: 'wsh-relay',
      supports_attach: true,
      supports_replay: true,
      supports_echo: false,
      supports_term_sync: false,
      last_seen: 10,
    }, {
      relayHost: 'relay.example',
      relayPort: 4422,
    })

    registry.ingestWshRelayPeer({
      fingerprint,
      fingerprint_short: fingerprint.slice(0, 8),
      username: 'builder',
      capabilities: ['shell', 'fs'],
      peer_type: 'host',
      shell_backend: 'pty',
      source: 'wsh-relay',
      supports_attach: true,
      supports_replay: true,
      supports_echo: false,
      supports_term_sync: false,
      last_seen: 20,
    }, {
      relayHost: 'relay.example',
      relayPort: 4422,
    })

    const peers = registry.listPeers()
    assert.equal(peers.length, 1)
    assert.equal(peers[0].identity.fingerprint, fingerprint)
    assert.ok(peers[0].capabilities.includes('fs'))
    assert.equal(peers[0].reachability.length, 1)
    assert.equal(peers[0].reachability[0].lastSeen, 20)
  })
})

describe('RemoteSessionBroker', () => {
  it('prefers a direct host route over reverse relay for terminal work', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'host:builder' }),
      username: 'builder',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell', 'fs'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
          capabilities: ['shell', 'fs'],
        }),
        createReachabilityDescriptor({
          kind: 'direct-host',
          source: 'direct-bookmark',
          endpoint: 'builder.local:4422',
          transport: 'wt',
          capabilities: ['shell', 'fs'],
        }),
      ],
      sources: ['wsh-relay', 'direct-bookmark'],
    }))

    const broker = new RemoteSessionBroker({ runtimeRegistry: registry })
    const selection = broker.explainRoute('host:builder', { intent: 'terminal' })

    assert.equal(selection.route.kind, 'direct-host')
  })

  it('chooses reverse relay when direct host is unavailable', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'host:builder' }),
      username: 'builder',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell', 'exec'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'direct-host',
          source: 'direct-bookmark',
          endpoint: 'builder.local:4422',
          capabilities: ['shell', 'exec'],
        }),
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
          capabilities: ['shell', 'exec'],
        }),
      ],
      sources: ['direct-bookmark', 'wsh-relay'],
    }))

    let directRoute = registry.resolvePeer('host:builder').reachability.find((route) => route.kind === 'direct-host')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      registry.recordRouteOutcome('host:builder', directRoute, {
        status: 'failure',
        reason: 'connection reset',
        layer: 'connector',
        timestamp: 100 + attempt,
      })
      directRoute = registry.resolvePeer('host:builder').reachability.find((route) => route.kind === 'direct-host')
    }

    const broker = new RemoteSessionBroker({ runtimeRegistry: registry })
    const selection = broker.explainRoute('host:builder', { intent: 'terminal' })

    assert.equal(selection.route.kind, 'reverse-relay')
  })

  it('rejects unsupported workloads before route selection', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'browser:alice' }),
      username: 'alice',
      peerType: 'browser-shell',
      shellBackend: 'virtual-shell',
      capabilities: ['shell'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
          capabilities: ['shell'],
        }),
      ],
      sources: ['wsh-relay'],
    }))

    const broker = new RemoteSessionBroker({ runtimeRegistry: registry })
    assert.throws(
      () => broker.resolveTarget('browser:alice', { intent: 'files', requiredCapabilities: ['fs'] }),
      /required capabilities/i,
    )
  })

  it('chooses VM peers only for workloads they actually support', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'vm:demo' }),
      username: 'vm',
      peerType: 'vm-guest',
      shellBackend: 'vm-console',
      capabilities: ['shell'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
          capabilities: ['shell'],
        }),
      ],
      sources: ['wsh-relay'],
    }))

    const broker = new RemoteSessionBroker({ runtimeRegistry: registry })
    const terminal = broker.resolveTarget('vm:demo', { intent: 'terminal' })
    assert.equal(terminal.descriptor.shellBackend, 'vm-console')
    assert.throws(
      () => broker.resolveTarget('vm:demo', { intent: 'files', requiredCapabilities: ['fs'] }),
      /required capabilities/i,
    )
  })

  it('resolves mesh names through the shared name resolver', () => {
    const registry = new RemoteRuntimeRegistry()
    const nameResolver = new MeshNameResolver()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({
        canonicalId: 'fp-alice',
        fingerprint: 'fp-alice',
      }),
      username: 'alice',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'direct-host',
          source: 'direct-bookmark',
          endpoint: 'alice.local:4422',
          capabilities: ['shell'],
        }),
      ],
      sources: ['direct-bookmark'],
    }))
    nameResolver.register('alice', 'fp-alice')

    const broker = new RemoteSessionBroker({
      runtimeRegistry: registry,
      nameResolver,
    })
    const resolved = broker.resolveTarget('@alice', { intent: 'terminal' })

    assert.equal(resolved.descriptor.username, 'alice')
  })

  it('resolves @name through runtime registry aliases without a name resolver', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({
        canonicalId: 'builder-peer',
        aliases: ['builder'],
      }),
      username: 'builder',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'direct-host',
          source: 'direct-bookmark',
          endpoint: 'builder.local:4422',
          capabilities: ['shell'],
        }),
      ],
      sources: ['direct-bookmark'],
    }))
    registry.linkName('builder', 'builder-peer')

    const broker = new RemoteSessionBroker({ runtimeRegistry: registry })
    const resolved = broker.resolveTarget('@builder', { intent: 'terminal' })

    assert.equal(resolved.descriptor.identity.canonicalId, 'builder-peer')
  })

  it('uses trust-aware route ranking to choose among ambiguous aliases', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({
        canonicalId: 'host:low-trust',
        aliases: ['ops'],
      }),
      username: 'ops-low',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay-low.example',
          relayPort: 4422,
          health: 'degraded',
          capabilities: ['shell'],
        }),
      ],
      sources: ['wsh-relay'],
      metadata: {
        trustLevel: 0.1,
      },
    }))
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({
        canonicalId: 'host:high-trust',
        aliases: ['ops'],
      }),
      username: 'ops-high',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay-high.example',
          relayPort: 4422,
          health: 'healthy',
          capabilities: ['shell'],
        }),
      ],
      sources: ['wsh-relay'],
      metadata: {
        trustLevel: 0.9,
      },
    }))

    const broker = new RemoteSessionBroker({
      runtimeRegistry: registry,
      policyAdapter: new RemoteRuntimePolicyAdapter(),
    })
    const resolved = broker.resolveTarget('@ops', { intent: 'terminal' })

    assert.equal(resolved.descriptor.identity.canonicalId, 'host:high-trust')
  })

  it('includes route-policy reasons in route explanations', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'host:relay' }),
      username: 'relay-host',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
          capabilities: ['shell'],
        }),
      ],
      sources: ['wsh-relay'],
    }))

    const broker = new RemoteSessionBroker({
      runtimeRegistry: registry,
      policyAdapter: {
        checkTargetAccess() {
          return { allowed: true }
        },
        rankRoutes(_descriptor, _target, routes) {
          return routes.map((route) => ({
            ...route,
            policy: {
              allowed: true,
              layer: 'route-policy',
              scoreAdjustment: 6,
              reasons: ['relay-healthy'],
            },
          }))
        },
      },
    })

    const selection = broker.explainRoute('host:relay', { intent: 'terminal' })
    assert.match(selection.reason, /relay-healthy/)
  })

  it('includes health, warnings, and fallbacks in route explanations', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'host:builder' }),
      username: 'builder',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell', 'exec'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'direct-host',
          source: 'direct-bookmark',
          endpoint: 'builder.local:4422',
          capabilities: ['shell', 'exec'],
        }),
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
          capabilities: ['shell', 'exec'],
        }),
      ],
      sources: ['direct-bookmark', 'wsh-relay'],
    }))

    const directRoute = registry.resolvePeer('host:builder').reachability.find((route) => route.kind === 'direct-host')
    registry.recordRouteOutcome('host:builder', directRoute, {
      status: 'failure',
      reason: 'timeout',
      layer: 'connector',
      timestamp: 200,
    })

    const broker = new RemoteSessionBroker({ runtimeRegistry: registry })
    const selection = broker.explainRoute('host:builder', { intent: 'terminal' })

    assert.equal(selection.health.health, 'degraded')
    assert.equal(selection.health.lastOutcomeReason, 'timeout')
    assert.equal(selection.resumability.replayMode, 'lossless')
    assert.match(selection.warnings.join(' '), /route degraded/)
    assert.match(selection.warnings.join(' '), /last failure: timeout/)
    assert.equal(selection.alternatives[0].kind, 'reverse-relay')
  })

  it('raises structured errors for missing capabilities', () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'browser:alice' }),
      username: 'alice',
      peerType: 'browser-shell',
      shellBackend: 'virtual-shell',
      capabilities: ['shell'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
          capabilities: ['shell'],
        }),
      ],
      sources: ['wsh-relay'],
    }))

    const broker = new RemoteSessionBroker({ runtimeRegistry: registry })
    assert.throws(
      () => broker.resolveTarget('browser:alice', { intent: 'files', requiredCapabilities: ['fs'] }),
      (error) => error instanceof RemoteSessionError
        && error.code === 'capability-mismatch'
        && error.layer === 'capabilities'
    )
  })

  it('wraps connector failures in structured route errors', async () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'host:builder' }),
      username: 'builder',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell', 'exec'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'direct-host',
          source: 'direct-bookmark',
          endpoint: 'builder.local:4422',
          capabilities: ['shell', 'exec'],
        }),
      ],
      sources: ['direct-bookmark'],
    }))

    const broker = new RemoteSessionBroker({
      runtimeRegistry: registry,
      connectors: {
        connectDirectHost: async () => {
          throw new Error('connection reset')
        },
      },
    })

    await assert.rejects(
      broker.openSession('host:builder', { intent: 'exec', command: 'printf hello' }),
      (error) => error instanceof RemoteSessionError
        && error.code === 'connector-failed'
        && error.layer === 'connector'
    )
  })

  it('does not open sessions on discovery-only routes without a wsh connector', async () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestMeshDiscovery({
      podId: 'mesh:ghost',
      label: 'ghost',
      capabilities: ['shell'],
      metadata: {
        username: 'ghost',
        peerType: 'worker',
        shellBackend: 'exec-only',
      },
      discoveredAt: Date.now(),
      source: 'mesh-discovery',
    })

    const broker = new RemoteSessionBroker({ runtimeRegistry: registry })
    await assert.rejects(
      broker.openSession('mesh:ghost', { intent: 'terminal' }),
      (error) => error instanceof RemoteSessionError
        && error.code === 'unsupported-route'
        && error.layer === 'routing'
    )
  })

  it('keeps wsh auth denial authoritative even when trust is high', async () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'host:trusted' }),
      username: 'trusted',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'direct-host',
          source: 'direct-bookmark',
          endpoint: 'trusted.local:4422',
          capabilities: ['shell'],
        }),
      ],
      sources: ['direct-bookmark'],
      metadata: {
        trustLevel: 0.95,
      },
    }))

    const broker = new RemoteSessionBroker({
      runtimeRegistry: registry,
      connectors: {
        connectDirectHost: async () => {
          throw new RemoteSessionError('host key not authorized', {
            code: 'auth-denied',
            layer: 'wsh-auth',
          })
        },
      },
    })

    await assert.rejects(
      broker.openSession('host:trusted', { intent: 'terminal' }),
      (error) => error instanceof RemoteSessionError
        && error.code === 'auth-denied'
        && error.layer === 'wsh-auth'
    )
  })

  it('emits broker events and audit records when a connector succeeds', async () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDirectHostBookmark({
      id: 'host:builder',
      host: 'builder.local',
      port: 4422,
      username: 'builder',
    })

    const events = []
    const records = []
    const broker = new RemoteSessionBroker({
      runtimeRegistry: registry,
      connectors: {
        connectDirectHost: async (selection) => ({ ...selection, ok: true }),
      },
      auditRecorder: {
        async record(operation, data) {
          records.push({ operation, data })
        },
      },
    })
    broker.on('route:selected', (payload) => events.push(['route:selected', payload.route.kind]))
    broker.on('session:opened', () => events.push(['session:opened']))

    const result = await broker.openSession('host:builder', { intent: 'terminal' })

    assert.equal(result.route.kind, 'direct-host')
    assert.deepEqual(events, [['route:selected', 'direct-host'], ['session:opened']])
    assert.equal(records[0].operation, 'remote_route_selected')
    assert.equal(records[1].operation, 'remote_session_opened')
    assert.equal(registry.resolvePeer('host:builder').reachability[0].health, 'healthy')
  })

  it('audits policy denials with structured layer metadata', async () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDirectHostBookmark({
      id: 'host:blocked',
      host: 'blocked.local',
      port: 4422,
      username: 'blocked',
    })

    const records = []
    const events = []
    const broker = new RemoteSessionBroker({
      runtimeRegistry: registry,
      policyAdapter: {
        checkTargetAccess() {
          return {
            allowed: false,
            layer: 'mesh-acl',
            reason: 'mesh ACL denied exec',
          }
        },
      },
      auditRecorder: {
        async record(operation, data) {
          records.push({ operation, data })
        },
      },
    })
    broker.on('session:failed', ({ error }) => events.push(error))

    await assert.rejects(
      broker.openSession('host:blocked', { intent: 'exec', command: 'uname -a' }),
      (error) => error instanceof RemoteSessionError
        && error.code === 'policy-denied'
        && error.layer === 'mesh-acl'
    )

    assert.equal(events.length, 1)
    assert.equal(events[0].layer, 'mesh-acl')
    assert.equal(records.length, 1)
    assert.equal(records[0].operation, 'remote_session_denied')
    assert.equal(records[0].data.layer, 'mesh-acl')
    assert.equal(records[0].data.code, 'policy-denied')
  })

  it('surfaces relay policy denials as explainable routing failures', async () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({ canonicalId: 'host:relay-blocked' }),
      username: 'blocked',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'relay.example',
          relayPort: 4422,
          capabilities: ['shell'],
        }),
      ],
      sources: ['wsh-relay'],
    }))

    const broker = new RemoteSessionBroker({
      runtimeRegistry: registry,
      policyAdapter: {
        checkTargetAccess() {
          return {
            allowed: false,
            layer: 'relay-policy',
            reason: 'relay policy denied this route',
          }
        },
      },
    })

    await assert.rejects(
      broker.openSession('host:relay-blocked', { intent: 'terminal' }),
      (error) => error instanceof RemoteSessionError
        && error.code === 'policy-denied'
        && error.layer === 'relay-policy'
    )
  })
})
