/**
 * Remote runtime registry.
 *
 * Merges BrowserMesh discovery, relay presence, direct host bookmarks, and
 * `wsh` reverse-peer metadata into one canonical descriptor set.
 */

import {
  createReachabilityDescriptor,
  createRemoteIdentity,
  createRemotePeerDescriptor,
  routeKey,
  wshPeerInfoToRemotePeerDescriptor,
  meshDiscoveryRecordToRemotePeerDescriptor,
} from './clawser-remote-runtime-types.js'

function unique(values) {
  return [...new Set((values || []).filter(Boolean))]
}

function normalizeTimestamp(value) {
  if (value == null) return null
  return Number.isFinite(value) ? value : null
}

function routeLastSeen(route) {
  return normalizeTimestamp(route?.lastSeen)
}

function mergeRoutes(existingRoutes, incomingRoutes) {
  const merged = new Map()
  for (const route of existingRoutes || []) {
    merged.set(routeKey(route), { ...route })
  }
  for (const route of incomingRoutes || []) {
    const key = routeKey(route)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...route })
      continue
    }

    const existingLastSeen = routeLastSeen(existing)
    const incomingLastSeen = routeLastSeen(route)
    const preferIncoming = incomingLastSeen != null
      && (existingLastSeen == null || incomingLastSeen >= existingLastSeen)

    merged.set(key, {
      ...existing,
      ...(preferIncoming ? route : {}),
      capabilities: unique([...(existing.capabilities || []), ...(route.capabilities || [])]),
      lastSeen: preferIncoming ? incomingLastSeen : existingLastSeen,
    })
  }
  return [...merged.values()]
}

function mergeIdentity(existing, incoming) {
  const canonicalId = existing?.canonicalId || incoming?.canonicalId
  const fingerprint = existing?.fingerprint || incoming?.fingerprint || null
  const podId = existing?.podId || incoming?.podId || null
  const aliases = unique([
    ...(existing?.aliases || []),
    ...(incoming?.aliases || []),
    fingerprint,
    podId,
  ])
  return createRemoteIdentity({ canonicalId, fingerprint, podId, aliases })
}

function preferredPeerType(left, right) {
  const rank = { host: 4, 'browser-shell': 3, 'vm-guest': 2, worker: 1 }
  return (rank[right] || 0) > (rank[left] || 0) ? right : left
}

function preferredShellBackend(left, right) {
  const rank = { pty: 4, 'virtual-shell': 3, 'vm-console': 2, 'exec-only': 1 }
  return (rank[right] || 0) > (rank[left] || 0) ? right : left
}

function maybeConflict(conflicts, label, before, after) {
  if (!before || !after || before === after) return conflicts
  return unique([...(conflicts || []), `${label}:${before}->${after}`])
}

function mergeDescriptors(existing, incoming) {
  const identity = mergeIdentity(existing.identity, incoming.identity)
  const peerType = preferredPeerType(existing.peerType, incoming.peerType)
  const shellBackend = preferredShellBackend(existing.shellBackend, incoming.shellBackend)

  return createRemotePeerDescriptor({
    identity,
    username: existing.username || incoming.username,
    peerType,
    shellBackend,
    capabilities: unique([...(existing.capabilities || []), ...(incoming.capabilities || [])]),
    supportsAttach: existing.supportsAttach || incoming.supportsAttach,
    supportsReplay: existing.supportsReplay || incoming.supportsReplay,
    supportsEcho: existing.supportsEcho || incoming.supportsEcho,
    supportsTermSync: existing.supportsTermSync || incoming.supportsTermSync,
    reachability: mergeRoutes(existing.reachability || [], incoming.reachability || []),
    sources: unique([...(existing.sources || []), ...(incoming.sources || [])]),
    conflicts: maybeConflict(
      maybeConflict(
        maybeConflict(existing.conflicts, 'username', existing.username, incoming.username),
        'peerType',
        existing.peerType,
        incoming.peerType,
      ),
      'shellBackend',
      existing.shellBackend,
      incoming.shellBackend,
    ),
    metadata: {
      ...(existing.metadata || {}),
      ...(incoming.metadata || {}),
      observations: unique([
        ...((existing.metadata || {}).observations || []),
        ...((incoming.metadata || {}).observations || []),
      ]),
    },
  })
}

function descriptorFromMeshPeerState(peerState, opts = {}) {
  const identity = createRemoteIdentity({
    canonicalId: peerState.fingerprint,
    fingerprint: peerState.fingerprint,
    aliases: [peerState.label].filter(Boolean),
  })
  return createRemotePeerDescriptor({
    identity,
    username: peerState.label || peerState.fingerprint.slice(0, 8),
    peerType: opts.peerType || 'worker',
    shellBackend: opts.shellBackend || 'exec-only',
    capabilities: peerState.capabilities || [],
    reachability: [
      createReachabilityDescriptor({
        kind: peerState.endpoint ? 'mesh-direct' : 'mesh-peer-state',
        source: 'mesh-peer-state',
        endpoint: peerState.endpoint || null,
        transport: peerState.transport || null,
        lastSeen: peerState.lastSeen || Date.now(),
        capabilities: peerState.capabilities || [],
      }),
    ],
    sources: ['mesh-peer-state'],
    metadata: {
      trustLevel: peerState.trustLevel ?? 0,
      status: peerState.status || 'disconnected',
      latency: peerState.latency ?? null,
    },
  })
}

function descriptorFromMeshRelayPeer(peer, opts = {}) {
  const identity = createRemoteIdentity({
    canonicalId: peer.fingerprint,
    fingerprint: peer.fingerprint,
  })
  return createRemotePeerDescriptor({
    identity,
    username: peer.username || peer.fingerprint.slice(0, 8),
    peerType: opts.peerType || 'worker',
    shellBackend: opts.shellBackend || 'exec-only',
    capabilities: peer.capabilities || [],
    reachability: [
      createReachabilityDescriptor({
        kind: 'mesh-relay',
        source: 'mesh-relay',
        endpoint: peer.endpoint || null,
        transport: peer.transport || 'relay',
        lastSeen: peer.lastSeen || Date.now(),
        capabilities: peer.capabilities || [],
      }),
    ],
    sources: ['mesh-relay'],
  })
}

function descriptorFromDirectHostBookmark(bookmark) {
  const identity = bookmark.identity
    ? createRemoteIdentity(bookmark.identity)
    : createRemoteIdentity({
        canonicalId: bookmark.id || `host:${bookmark.host}:${bookmark.port || 4422}`,
        aliases: [bookmark.name, bookmark.host].filter(Boolean),
      })

  return createRemotePeerDescriptor({
    identity,
    username: bookmark.username || 'operator',
    peerType: bookmark.peerType || 'host',
    shellBackend: bookmark.shellBackend || 'pty',
    capabilities: bookmark.capabilities || ['shell', 'exec', 'fs', 'tools'],
    supportsAttach: bookmark.supportsAttach ?? true,
    supportsReplay: bookmark.supportsReplay ?? true,
    reachability: [
      createReachabilityDescriptor({
        kind: 'direct-host',
        source: 'direct-bookmark',
        endpoint: bookmark.endpoint || `${bookmark.host}:${bookmark.port || 4422}`,
        transport: bookmark.transport || null,
        capabilities: bookmark.capabilities || ['shell', 'exec', 'fs', 'tools'],
      }),
    ],
    sources: ['direct-bookmark'],
    metadata: {
      name: bookmark.name || null,
    },
  })
}

export class RemoteRuntimeRegistry {
  #descriptors = new Map()
  #aliases = new Map()

  ingestDescriptor(descriptor) {
    const normalized = createRemotePeerDescriptor(descriptor)
    const key = normalized.identity.canonicalId
    const existing = this.#descriptors.get(key)
    const merged = existing ? mergeDescriptors(existing, normalized) : normalized
    this.#descriptors.set(key, merged)
    this.#indexAliases(merged)
    return merged
  }

  ingestWshRelayPeer(peerInfo, opts = {}) {
    return this.ingestDescriptor(wshPeerInfoToRemotePeerDescriptor(peerInfo, opts))
  }

  ingestMeshDiscovery(record) {
    return this.ingestDescriptor(meshDiscoveryRecordToRemotePeerDescriptor(record))
  }

  ingestMeshPeerState(peerState, opts = {}) {
    return this.ingestDescriptor(descriptorFromMeshPeerState(peerState, opts))
  }

  ingestMeshRelayPeer(peer, opts = {}) {
    return this.ingestDescriptor(descriptorFromMeshRelayPeer(peer, opts))
  }

  ingestDirectHostBookmark(bookmark) {
    return this.ingestDescriptor(descriptorFromDirectHostBookmark(bookmark))
  }

  linkIdentity({ canonicalId, alias }) {
    if (!canonicalId || !alias) return
    this.#aliases.set(alias, canonicalId)
  }

  linkName(name, canonicalId) {
    if (!name || !canonicalId) return
    const normalized = name.startsWith('@') ? name : `@${name}`
    this.#aliases.set(normalized, canonicalId)
    this.#aliases.set(normalized.slice(1), canonicalId)
  }

  listPeers(filter = {}) {
    let peers = [...this.#descriptors.values()]

    if (filter.peerType) {
      peers = peers.filter((peer) => peer.peerType === filter.peerType)
    }
    if (filter.shellBackend) {
      peers = peers.filter((peer) => peer.shellBackend === filter.shellBackend)
    }
    if (filter.capability) {
      peers = peers.filter((peer) => peer.capabilities.includes(filter.capability))
    }

    return peers.sort((left, right) => left.identity.canonicalId.localeCompare(right.identity.canonicalId))
  }

  getPeer(canonicalId) {
    return this.#descriptors.get(canonicalId) || null
  }

  resolvePeer(selector) {
    if (!selector || typeof selector !== 'string') return null

    const aliasTarget = this.#aliases.get(selector)
    if (aliasTarget && this.#descriptors.has(aliasTarget)) {
      return this.#descriptors.get(aliasTarget)
    }

    if (this.#descriptors.has(selector)) {
      return this.#descriptors.get(selector)
    }

    const matches = [...this.#descriptors.values()].filter((descriptor) => {
      if (descriptor.identity.fingerprint?.startsWith(selector)) return true
      return descriptor.identity.aliases.includes(selector)
    })
    if (matches.length === 1) {
      return matches[0]
    }

    return null
  }

  computeReachability(selector, { intent = 'terminal' } = {}) {
    const descriptor = typeof selector === 'string' ? this.resolvePeer(selector) : selector
    if (!descriptor) return []

    const routes = [...descriptor.reachability]
    const scored = routes.map((route) => ({
      route,
      score: this.#scoreRoute(descriptor, route, intent),
    }))

    scored.sort((left, right) => right.score - left.score)
    return scored.map((entry) => entry.route)
  }

  recordRouteOutcome(selector, route, {
    status = 'success',
    reason = null,
    layer = null,
    timestamp = Date.now(),
  } = {}) {
    const descriptor = typeof selector === 'string' ? this.resolvePeer(selector) : selector
    if (!descriptor || !route) return null

    const nextRoutes = descriptor.reachability.map((candidate) => {
      if (routeKey(candidate) !== routeKey(route)) return candidate
      const failures = candidate.failures || 0
      const nextFailures = status === 'success' ? 0 : failures + 1
      return {
        ...candidate,
        health: status === 'success'
          ? 'healthy'
          : nextFailures >= 3
            ? 'offline'
            : 'degraded',
        lastSeen: timestamp,
        lastOutcome: status,
        lastOutcomeReason: reason,
        lastOutcomeLayer: layer,
        failures: nextFailures,
      }
    })

    const nextDescriptor = createRemotePeerDescriptor({
      ...descriptor,
      reachability: nextRoutes,
      metadata: {
        ...(descriptor.metadata || {}),
        lastRouteOutcome: {
          status,
          reason,
          layer,
          timestamp,
        },
      },
    })

    this.#descriptors.set(descriptor.identity.canonicalId, nextDescriptor)
    this.#indexAliases(nextDescriptor)
    return nextDescriptor
  }

  ingestServiceAdvertisement(service) {
    if (!service?.podId) return null
    const descriptor = this.resolvePeer(service.podId)
      || this.resolvePeer(`@${service.podId}`)
    if (!descriptor) return null

    const services = unique([
      ...((descriptor.metadata || {}).services || []),
      service.name,
    ])

    const nextDescriptor = createRemotePeerDescriptor({
      ...descriptor,
      metadata: {
        ...(descriptor.metadata || {}),
        services,
        serviceDetails: {
          ...((descriptor.metadata || {}).serviceDetails || {}),
          [service.name]: { ...service },
        },
      },
    })

    this.#descriptors.set(descriptor.identity.canonicalId, nextDescriptor)
    this.#indexAliases(nextDescriptor)
    return nextDescriptor
  }

  #indexAliases(descriptor) {
    for (const alias of descriptor.identity.aliases || []) {
      this.#aliases.set(alias, descriptor.identity.canonicalId)
    }
    if (descriptor.identity.fingerprint) {
      this.#aliases.set(descriptor.identity.fingerprint, descriptor.identity.canonicalId)
    }
    if (descriptor.identity.podId) {
      this.#aliases.set(descriptor.identity.podId, descriptor.identity.canonicalId)
    }
  }

  #scoreRoute(descriptor, route, intent) {
    let score = 0

    if (route.kind === 'direct-host') score += 100
    if (route.kind === 'reverse-relay') score += 80
    if (route.kind === 'mesh-direct') score += 70
    if (route.kind === 'mesh-relay') score += 50

    if (intent === 'terminal') {
      if (descriptor.peerType === 'host' && descriptor.shellBackend === 'pty') score += 30
      if (descriptor.peerType === 'browser-shell' && descriptor.shellBackend === 'virtual-shell') score += 20
      if (descriptor.peerType === 'vm-guest' && descriptor.shellBackend === 'vm-console') score += 10
    }

    if (intent === 'files' && descriptor.capabilities.includes('fs')) score += 25
    if (intent === 'tools' && descriptor.capabilities.includes('tools')) score += 25
    if (intent === 'gateway' && descriptor.capabilities.includes('gateway')) score += 25

    if (route.transport === 'webrtc') score += 5
    if (route.lastSeen != null) score += Math.max(0, 10 - Math.floor((Date.now() - route.lastSeen) / 1000))
    if (route.health === 'healthy') score += 10
    if (route.health === 'degraded') score -= 8
    if (route.health === 'offline') score -= 25

    return score
  }
}

export {
  descriptorFromDirectHostBookmark,
  descriptorFromMeshPeerState,
  descriptorFromMeshRelayPeer,
  mergeDescriptors,
}
