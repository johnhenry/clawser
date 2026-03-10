import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { MeshNameResolver } from '../clawser-mesh-naming.js'
import { RemoteRuntimeRegistry } from '../clawser-remote-runtime-registry.js'
import { RemoteSessionBroker } from '../clawser-remote-session-broker.js'
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
})
