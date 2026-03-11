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
  #serviceAliases = new Map()
  #endpointAliases = new Map()
  #auditRecorder

  constructor({ auditRecorder = null } = {}) {
    this.#auditRecorder = auditRecorder
  }

  ingestDescriptor(descriptor) {
    const normalized = createRemotePeerDescriptor(descriptor)
    const key = normalized.identity.canonicalId
    const existing = this.#descriptors.get(key)
    const merged = existing ? mergeDescriptors(existing, normalized) : normalized
    this.#descriptors.set(key, merged)
    this.#indexAliases(merged)
    void this.#auditRecorder?.record?.(
      existing ? 'remote_peer_updated' : 'remote_peer_discovered',
      {
        canonicalId: merged.identity.canonicalId,
        fingerprint: merged.identity.fingerprint,
        peerType: merged.peerType,
        shellBackend: merged.shellBackend,
        capabilities: merged.capabilities,
        sources: merged.sources,
      },
    )
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
    const existingCanonicalIds = [...(this.#aliases.get(alias) || [])]
    const conflictingCanonicalId = existingCanonicalIds.find((candidate) => candidate !== canonicalId)
    if (conflictingCanonicalId) {
      this.#recordConflict(conflictingCanonicalId, `identityAlias:${alias}->${canonicalId}`)
      this.#recordConflict(canonicalId, `identityAlias:${alias}->${conflictingCanonicalId}`)
      return
    }
    const conflictingDescriptor = [...this.#descriptors.values()].find((descriptor) => {
      if (descriptor.identity.canonicalId === canonicalId) return false
      return descriptor.identity.canonicalId === alias
        || descriptor.identity.fingerprint === alias
        || descriptor.identity.podId === alias
    })
    if (conflictingDescriptor) {
      this.#recordConflict(conflictingDescriptor.identity.canonicalId, `identityAlias:${alias}->${canonicalId}`)
      this.#recordConflict(canonicalId, `identityAlias:${alias}->${conflictingDescriptor.identity.canonicalId}`)
      return
    }
    this.#addAlias(alias, canonicalId)
  }

  linkName(name, canonicalId) {
    if (!name || !canonicalId) return
    const normalized = name.startsWith('@') ? name : `@${name}`
    this.#addAlias(normalized, canonicalId)
    this.#addAlias(normalized.slice(1), canonicalId)
  }

  queryPeers(filter = {}) {
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
    if (filter.intent) {
      peers = peers.filter((peer) => peerSupportsIntent(peer, filter.intent))
    }
    if (filter.source) {
      peers = peers.filter((peer) => (peer.sources || []).includes(filter.source))
    }
    if (filter.status) {
      peers = peers.filter((peer) => peerRuntimeStatus(peer) === filter.status)
    }
    if (filter.serviceType || filter.serviceName) {
      peers = peers.filter((peer) => {
        const services = descriptorServices(peer)
        if (filter.serviceType && !services.some((service) => service.type === filter.serviceType)) {
          return false
        }
        if (filter.serviceName && !services.some((service) => service.name === filter.serviceName)) {
          return false
        }
        return true
      })
    }
    if (filter.text) {
      const query = String(filter.text).trim().toLowerCase()
      peers = peers.filter((peer) => peerSearchText(peer).includes(query))
    }

    return peers.sort((left, right) => left.identity.canonicalId.localeCompare(right.identity.canonicalId))
  }

  listPeers(filter = {}) {
    return this.queryPeers(filter)
  }

  listServices(filter = {}) {
    const services = []
    for (const descriptor of this.queryPeers(filter.peerFilter || {})) {
      for (const service of descriptorServices(descriptor)) {
        if (filter.type && service.type !== filter.type) continue
        if (filter.name && service.name !== filter.name) continue
        if (filter.podId && service.podId !== filter.podId) continue
        services.push(service)
      }
    }
    return services.sort((left, right) => {
      const podCompare = (left.podId || '').localeCompare(right.podId || '')
      if (podCompare !== 0) return podCompare
      return (left.name || '').localeCompare(right.name || '')
    })
  }

  query(filter = {}) {
    return {
      peers: this.queryPeers(filter),
      services: this.listServices({
        type: filter.serviceType,
        name: filter.serviceName,
        podId: filter.podId,
        peerFilter: filter,
      }),
      telemetry: this.telemetrySnapshot(filter),
    }
  }

  getPeer(canonicalId) {
    return this.#descriptors.get(canonicalId) || null
  }

  matchPeers(selector) {
    if (!selector || typeof selector !== 'string') return null

    const aliasTargets = [...(this.#aliases.get(selector) || [])]
      .map((canonicalId) => this.#descriptors.get(canonicalId))
      .filter(Boolean)
    if (aliasTargets.length > 0) {
      return aliasTargets
    }

    if (this.#descriptors.has(selector)) {
      return [this.#descriptors.get(selector)]
    }

    const matches = [...this.#descriptors.values()].filter((descriptor) => {
      if (descriptor.identity.fingerprint?.startsWith(selector)) return true
      return descriptor.identity.aliases.includes(selector)
    })
    return matches
  }

  resolvePeer(selector) {
    const matches = this.matchPeers(selector)
    if (!matches?.length) return null
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

  resolveService(selector) {
    if (!selector || typeof selector !== 'string') return null
    const refs = [
      ...(this.#serviceAliases.get(selector) || []),
      ...(this.#serviceAliases.get(selector.startsWith('svc://') ? selector.slice('svc://'.length) : `svc://${selector}`) || []),
    ].filter((ref, index, all) => {
      return all.findIndex((candidate) => candidate.canonicalId === ref.canonicalId && candidate.serviceName === ref.serviceName) === index
    })
    if (refs.length !== 1) return null
    const descriptor = this.resolvePeer(refs[0].canonicalId)
    if (!descriptor) return null
    return descriptorServices(descriptor).find((service) => service.name === refs[0].serviceName) || null
  }

  resolveEndpoint(selector) {
    if (!selector || typeof selector !== 'string') return null
    const key = selector.startsWith('endpoint://') ? selector : `endpoint://${selector}`
    const refs = [
      ...(this.#endpointAliases.get(selector) || []),
      ...(this.#endpointAliases.get(key) || []),
    ].filter((ref, index, all) => {
      return all.findIndex((candidate) => (
        candidate.canonicalId === ref.canonicalId
        && candidate.endpoint === ref.endpoint
        && candidate.routeKind === ref.routeKind
      )) === index
    })
    if (refs.length !== 1) return null
    return { ...refs[0] }
  }

  resolvePeerService(selector, serviceName) {
    if (!selector || !serviceName) return null
    const descriptor = this.resolvePeer(selector)
    if (!descriptor) return null
    return descriptorServices(descriptor).find((service) => service.name === serviceName) || null
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
      const successCount = candidate.successCount || 0
      const failureCount = candidate.failureCount || 0
      const nextSuccessCount = status === 'success' ? successCount + 1 : successCount
      const nextFailureCount = status === 'failure' ? failureCount + 1 : failureCount
      const totalOutcomes = nextSuccessCount + nextFailureCount
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
        successCount: nextSuccessCount,
        failureCount: nextFailureCount,
        successRate: totalOutcomes > 0 ? nextSuccessCount / totalOutcomes : null,
      }
    })

    const nextDescriptor = createRemotePeerDescriptor({
      ...descriptor,
      reachability: nextRoutes,
      metadata: {
        ...(descriptor.metadata || {}),
        runtimeQuality: nextRuntimeQuality(descriptor.metadata?.runtimeQuality, {
          status,
          layer,
          timestamp,
        }),
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
    void this.#auditRecorder?.record?.('remote_route_outcome', {
      canonicalId: nextDescriptor.identity.canonicalId,
      route: routeKey(route),
      status,
      reason,
      layer,
      timestamp,
    })
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
    this.#indexServices(nextDescriptor)
    return nextDescriptor
  }

  telemetrySnapshot(filter = {}) {
    const peers = this.queryPeers(filter)
    const health = { healthy: 0, degraded: 0, offline: 0, unknown: 0 }
    const routeKinds = new Map()
    const denialLayers = new Map()
    const replayModes = new Map()
    let relayRoutes = 0
    let directRoutes = 0

    for (const peer of peers) {
      const status = peerRuntimeStatus(peer)
      health[status] = (health[status] || 0) + 1
      const replayMode = peer?.metadata?.replayMode || 'unsupported'
      replayModes.set(replayMode, (replayModes.get(replayMode) || 0) + 1)

      const denials = peer?.metadata?.runtimeQuality?.denials || {}
      for (const [layer, count] of Object.entries(denials)) {
        denialLayers.set(layer, (denialLayers.get(layer) || 0) + (count || 0))
      }

      for (const route of peer.reachability || []) {
        routeKinds.set(route.kind, (routeKinds.get(route.kind) || 0) + 1)
        if (route.kind === 'reverse-relay' || route.kind === 'mesh-relay') relayRoutes += 1
        if (route.kind === 'direct-host' || route.kind === 'mesh-direct') directRoutes += 1
      }
    }

    return {
      peerCount: peers.length,
      health,
      routeKinds: Object.fromEntries(routeKinds),
      relayUsage: {
        relayRoutes,
        directRoutes,
      },
      denialLayers: Object.fromEntries(denialLayers),
      replayModes: Object.fromEntries(replayModes),
      services: this.listServices({ peerFilter: filter }).length,
    }
  }

  #indexAliases(descriptor) {
    for (const alias of descriptor.identity.aliases || []) {
      this.#addAlias(alias, descriptor.identity.canonicalId)
    }
    if (descriptor.identity.fingerprint) {
      this.#addAlias(descriptor.identity.fingerprint, descriptor.identity.canonicalId)
    }
    if (descriptor.identity.podId) {
      this.#addAlias(descriptor.identity.podId, descriptor.identity.canonicalId)
    }
    this.#indexEndpoints(descriptor)
    this.#indexServices(descriptor)
  }

  #indexServices(descriptor) {
    for (const service of descriptorServices(descriptor)) {
      const keys = [
        service.name,
        `svc://${service.name}`,
        service.address,
      ].filter(Boolean)
      for (const key of keys) {
        if (!this.#serviceAliases.has(key)) {
          this.#serviceAliases.set(key, [])
        }
        const refs = this.#serviceAliases.get(key)
        if (!refs.some((ref) => ref.canonicalId === descriptor.identity.canonicalId && ref.serviceName === service.name)) {
          refs.push({
            canonicalId: descriptor.identity.canonicalId,
            serviceName: service.name,
          })
        }
      }
    }
  }

  #indexEndpoints(descriptor) {
    const names = unique([
      descriptor?.metadata?.name,
      descriptor?.username,
      descriptor?.identity?.canonicalId,
      ...(descriptor?.identity?.aliases || []),
    ])
    for (const route of descriptor?.reachability || []) {
      const endpoint = route.endpoint
        || (route.relayHost ? `https://${route.relayHost}:${route.relayPort || 4422}` : null)
      if (!endpoint) continue
      const ref = {
        canonicalId: descriptor.identity.canonicalId,
        endpoint,
        routeKind: route.kind || null,
      }
      for (const name of names.filter(Boolean)) {
        const key = name.startsWith('endpoint://') ? name : `endpoint://${name.replace(/^@/, '')}`
        if (!this.#endpointAliases.has(key)) {
          this.#endpointAliases.set(key, [])
        }
        const refs = this.#endpointAliases.get(key)
        if (!refs.some((candidate) => (
          candidate.canonicalId === ref.canonicalId
          && candidate.endpoint === ref.endpoint
          && candidate.routeKind === ref.routeKind
        ))) {
          refs.push(ref)
        }
      }
    }
  }

  #addAlias(alias, canonicalId) {
    if (!alias || !canonicalId) return
    if (!this.#aliases.has(alias)) {
      this.#aliases.set(alias, new Set())
    }
    this.#aliases.get(alias).add(canonicalId)
  }

  #recordConflict(canonicalId, conflict) {
    const descriptor = this.#descriptors.get(canonicalId)
    if (!descriptor) return
    const nextDescriptor = createRemotePeerDescriptor({
      ...descriptor,
      conflicts: unique([...(descriptor.conflicts || []), conflict]),
    })
    this.#descriptors.set(canonicalId, nextDescriptor)
    this.#indexAliases(nextDescriptor)
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
    if (Number.isFinite(route.successRate)) {
      score += Math.round((route.successRate - 0.5) * 20)
    }

    return score
  }
}

function descriptorServices(descriptor) {
  const podId = descriptor?.identity?.podId
    || descriptor?.identity?.fingerprint
    || descriptor?.identity?.canonicalId
    || null
  const details = descriptor?.metadata?.serviceDetails || {}
  const names = unique([
    ...(descriptor?.metadata?.services || []),
    ...Object.keys(details),
  ])
  return names.map((name) => ({
    ...(details[name] || {}),
    name,
    podId,
  }))
}

function peerRuntimeStatus(peer) {
  const routes = peer?.reachability || []
  if (!routes.length) return 'unknown'
  if (routes.some((route) => route.health === 'healthy' || route.health === 'online')) return 'healthy'
  if (routes.some((route) => route.health === 'degraded')) return 'degraded'
  if (routes.every((route) => route.health === 'offline')) return 'offline'
  return 'unknown'
}

function peerSupportsIntent(peer, intent) {
  switch (intent) {
    case 'terminal':
      return (peer.capabilities || []).includes('shell')
        || peer.shellBackend === 'pty'
        || peer.shellBackend === 'virtual-shell'
        || peer.shellBackend === 'vm-console'
    case 'exec':
    case 'automation':
      return (peer.capabilities || []).includes('exec')
        || (peer.capabilities || []).includes('shell')
    case 'files':
      return (peer.capabilities || []).includes('fs')
    case 'tools':
    case 'service':
      return (peer.capabilities || []).includes('tools') || descriptorServices(peer).length > 0
    case 'gateway':
      return (peer.capabilities || []).includes('gateway')
    default:
      return true
  }
}

function peerSearchText(peer) {
  return [
    peer.username,
    peer.identity?.canonicalId,
    peer.identity?.fingerprint,
    peer.identity?.podId,
    ...(peer.identity?.aliases || []),
    peer.peerType,
    peer.shellBackend,
    ...(peer.capabilities || []),
    ...descriptorServices(peer).flatMap((service) => [service.name, service.type, service.address]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function nextRuntimeQuality(existing = {}, {
  status,
  layer,
  timestamp,
}) {
  const successCount = (existing.successCount || 0) + (status === 'success' ? 1 : 0)
  const failureCount = (existing.failureCount || 0) + (status === 'failure' ? 1 : 0)
  const total = successCount + failureCount
  const denials = { ...(existing.denials || {}) }
  if (status === 'failure' && layer) {
    denials[layer] = (denials[layer] || 0) + 1
  }
  return {
    successCount,
    failureCount,
    successRate: total > 0 ? successCount / total : null,
    lastStatus: status,
    lastTimestamp: timestamp || Date.now(),
    denials,
  }
}

export {
  descriptorFromDirectHostBookmark,
  descriptorFromMeshPeerState,
  descriptorFromMeshRelayPeer,
  mergeDescriptors,
}
