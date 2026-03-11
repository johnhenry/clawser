/**
 * Remote session broker.
 *
 * Resolves selectors into canonical runtime descriptors, ranks routes for a
 * requested session intent, and optionally dispatches the open through injected
 * connector callbacks.
 */

import { createSessionTarget, normalizeIntent } from './clawser-remote-runtime-types.js'

function includesAllCapabilities(peer, requiredCapabilities) {
  return requiredCapabilities.every((cap) => peer.capabilities.includes(cap))
}

function intentIsSupported(peer, intent) {
  switch (intent) {
    case 'terminal':
      return peer.capabilities.includes('shell')
        || peer.shellBackend === 'pty'
        || peer.shellBackend === 'virtual-shell'
        || peer.shellBackend === 'vm-console'
    case 'exec':
      return peer.capabilities.includes('exec') || peer.capabilities.includes('shell')
    case 'files':
      return peer.capabilities.includes('fs')
    case 'tools':
      return peer.capabilities.includes('tools')
    case 'gateway':
      return peer.capabilities.includes('gateway')
    default:
      return true
  }
}

function connectionKindForRoute(route) {
  if (route.kind === 'direct-host') return 'direct'
  if (route.kind === 'reverse-relay') return 'reverse-relay'
  if (route.kind === 'mesh-direct') return 'mesh-direct'
  if (route.kind === 'mesh-relay') return 'mesh-relay'
  return 'unknown'
}

function routeHealthSummary(route) {
  return {
    health: route?.health || 'unknown',
    lastOutcome: route?.lastOutcome || null,
    lastOutcomeReason: route?.lastOutcomeReason || null,
    lastOutcomeLayer: route?.lastOutcomeLayer || null,
    failures: Number.isFinite(route?.failures) ? route.failures : 0,
  }
}

function sessionSupportSummary(descriptor) {
  return {
    attachSupported: !!descriptor?.supportsAttach,
    replaySupported: !!descriptor?.supportsReplay,
    replayMode: descriptor?.metadata?.replayMode || 'unsupported',
    echoSupported: !!descriptor?.supportsEcho,
    termSyncSupported: !!descriptor?.supportsTermSync,
  }
}

function routePreferenceScore(descriptor, route, intent) {
  let score = 0
  const policyScore = Number.isFinite(route?.policy?.scoreAdjustment)
    ? route.policy.scoreAdjustment
    : 0
  score += policyScore

  if (route?.kind === 'direct-host') score += 30
  if (route?.kind === 'reverse-relay') score += 20
  if (route?.kind === 'mesh-direct') score += 15
  if (route?.kind === 'mesh-relay') score += 10

  if (route?.health === 'healthy' || route?.health === 'online') score += 12
  if (route?.health === 'degraded') score -= 8
  if (route?.health === 'offline') score -= 25

  if ((intent === 'terminal' || intent === 'exec') && descriptor?.shellBackend === 'pty') {
    score += 6
  }
  if (intent === 'terminal' && descriptor?.shellBackend === 'vm-console') {
    score += 2
  }

  return score
}

function normalizeRemoteSessionError(error, fallback = {}) {
  if (error instanceof RemoteSessionError) {
    return error
  }
  return new RemoteSessionError(error?.message || 'Remote session open failed', {
    code: fallback.code || 'connector-failed',
    layer: fallback.layer || 'connector',
    selector: fallback.selector || null,
    intent: fallback.intent || null,
    details: { cause: error },
  })
}

function auditOperationForError(error) {
  return error.code === 'policy-denied' || error.layer === 'mesh-acl'
    ? 'remote_session_denied'
    : 'remote_session_failed'
}

export class RemoteSessionError extends Error {
  constructor(message, {
    code = 'remote-session-error',
    layer = 'session-broker',
    selector = null,
    intent = null,
    details = null,
  } = {}) {
    super(message)
    this.name = 'RemoteSessionError'
    this.code = code
    this.layer = layer
    this.selector = selector
    this.intent = intent
    this.details = details
  }
}

export class RemoteSessionBroker {
  #registry
  #nameResolver
  #connectors
  #policyAdapter
  #listeners
  #auditRecorder
  #telemetry

  constructor({
    runtimeRegistry,
    nameResolver = null,
    connectors = {},
    policyAdapter = null,
    auditRecorder = null,
  } = {}) {
    if (!runtimeRegistry) {
      throw new Error('runtimeRegistry is required')
    }
    this.#registry = runtimeRegistry
    this.#nameResolver = nameResolver
    this.#connectors = { ...connectors }
    this.#policyAdapter = policyAdapter
    this.#listeners = new Map()
    this.#auditRecorder = auditRecorder
    this.#telemetry = {
      selectedByRoute: new Map(),
      openedByIntent: new Map(),
      failuresByLayer: new Map(),
      failuresByCode: new Map(),
      denialsByLayer: new Map(),
    }
  }

  on(event, callback) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set())
    }
    this.#listeners.get(event).add(callback)
  }

  off(event, callback) {
    this.#listeners.get(event)?.delete(callback)
  }

  listTargets(filter = {}) {
    return this.#registry.queryPeers?.(filter) || this.#registry.listPeers(filter)
  }

  queryTargets(filter = {}, routeOptions = {}) {
    const peers = this.listTargets(filter)
    return peers.map((peer) => {
      try {
        return {
          peer,
          route: this.explainRoute(peer.identity?.canonicalId, {
            intent: routeOptions.intent || filter.intent || 'terminal',
            requiredCapabilities: routeOptions.requiredCapabilities || [],
          }),
        }
      } catch (error) {
        return {
          peer,
          error: normalizeRemoteSessionError(error, {
            selector: peer.identity?.canonicalId,
            intent: routeOptions.intent || filter.intent || 'terminal',
          }),
        }
      }
    })
  }

  telemetrySnapshot() {
    return {
      registry: this.#registry.telemetrySnapshot?.() || null,
      selectedByRoute: Object.fromEntries(this.#telemetry.selectedByRoute),
      openedByIntent: Object.fromEntries(this.#telemetry.openedByIntent),
      failuresByLayer: Object.fromEntries(this.#telemetry.failuresByLayer),
      failuresByCode: Object.fromEntries(this.#telemetry.failuresByCode),
      denialsByLayer: Object.fromEntries(this.#telemetry.denialsByLayer),
    }
  }

  resolveTarget(selector, {
    intent = 'terminal',
    requiredCapabilities = [],
    preferDirect = true,
  } = {}) {
    const target = createSessionTarget({ selector, intent, requiredCapabilities, preferDirect })
    const descriptor = this.#resolveDescriptor(target)
    if (!descriptor) {
      throw new RemoteSessionError(`Unknown remote target: ${target.selector}`, {
        code: 'unknown-target',
        layer: 'discovery',
        selector: target.selector,
        intent: target.intent,
      })
    }
    if (!includesAllCapabilities(descriptor, target.requiredCapabilities)) {
      throw new RemoteSessionError(
        `Target ${target.selector} does not advertise required capabilities: ${target.requiredCapabilities.join(', ')}`,
        {
          code: 'capability-mismatch',
          layer: 'capabilities',
          selector: target.selector,
          intent: target.intent,
          details: { requiredCapabilities: [...target.requiredCapabilities] },
        }
      )
    }
    if (!intentIsSupported(descriptor, target.intent)) {
      throw new RemoteSessionError(
        `Target ${target.selector} does not support ${target.intent} sessions on ${descriptor.peerType}/${descriptor.shellBackend}`,
        {
          code: 'unsupported-intent',
          layer: 'session-backend',
          selector: target.selector,
          intent: target.intent,
          details: {
            peerType: descriptor.peerType,
            shellBackend: descriptor.shellBackend,
          },
        }
      )
    }

    if (this.#policyAdapter?.checkTargetAccess) {
      const decision = this.#policyAdapter.checkTargetAccess(descriptor, target)
      if (!decision?.allowed) {
        throw new RemoteSessionError(decision?.reason || 'Target denied by policy adapter', {
          code: 'policy-denied',
          layer: decision?.layer || 'policy-adapter',
          selector: target.selector,
          intent: target.intent,
          details: { decision },
        })
      }
    }

    return { target, descriptor }
  }

  selectRoute(selector, opts = {}) {
    const { descriptor, target } = this.resolveTarget(selector, opts)
    let ranked = this.#registry.computeReachability(descriptor, { intent: target.intent })
    if (this.#policyAdapter?.rankRoutes) {
      ranked = this.#policyAdapter.rankRoutes(descriptor, target, ranked)
    }
    if (!ranked.length) {
      throw new RemoteSessionError(`No viable routes for ${target.selector}`, {
        code: 'no-routes',
        layer: 'routing',
        selector: target.selector,
        intent: target.intent,
      })
    }
    return {
      target,
      descriptor,
      route: ranked[0],
      alternatives: ranked.slice(1),
    }
  }

  explainRoute(selector, opts = {}) {
    const selected = this.selectRoute(selector, opts)
    const policyReasons = selected.route?.policy?.reasons?.length
      ? ` (${selected.route.policy.reasons.join(', ')})`
      : ''
    const health = routeHealthSummary(selected.route)
    const resumability = sessionSupportSummary(selected.descriptor)
    const warnings = []
    if (health.health === 'degraded' || health.health === 'offline') {
      warnings.push(`route ${health.health}`)
    }
    if (health.lastOutcome === 'failure' && health.lastOutcomeReason) {
      warnings.push(`last failure: ${health.lastOutcomeReason}`)
    }
    if (resumability.replayMode === 'partial' || resumability.replayMode === 'unsupported') {
      warnings.push(`replay ${resumability.replayMode}`)
    }
    return {
      ...selected,
      connectionKind: connectionKindForRoute(selected.route),
      reason: `${selected.descriptor.peerType}/${selected.descriptor.shellBackend} via ${selected.route.kind}${policyReasons}`,
      health,
      resumability,
      warnings,
      alternatives: selected.alternatives.map((route) => ({
        kind: route.kind,
        connectionKind: connectionKindForRoute(route),
        health: route.health || 'unknown',
      })),
    }
  }

  async openSession(selector, opts = {}) {
    let selection = null
    try {
      selection = this.explainRoute(selector, opts)
      this.#incrementMetric(this.#telemetry.selectedByRoute, selection.route?.kind || 'unknown')
      this.#emit('route:selected', selection)
      await this.#auditRecorder?.record('remote_route_selected', {
        actor: opts.actor || 'operator',
        selector: selection.target.selector,
        intent: selection.target.intent,
        route: selection.route,
        descriptor: {
          peerType: selection.descriptor.peerType,
          shellBackend: selection.descriptor.shellBackend,
          fingerprint: selection.descriptor.identity.fingerprint,
        },
      })
      const connector = this.#connectorForRoute(selection.route)
      if (!connector) {
        throw new RemoteSessionError(
          `No session connector is available for route kind ${selection.route.kind}`,
          {
            code: 'unsupported-route',
            layer: 'routing',
            selector: selection.target.selector,
            intent: selection.target.intent,
            details: { routeKind: selection.route.kind },
          },
        )
      }

      const result = await connector({
        ...selection,
        intent: normalizeIntent(selection.target.intent),
        sessionOptions: { ...opts, intent: normalizeIntent(selection.target.intent) },
      })
      this.#registry.recordRouteOutcome(selection.descriptor, selection.route, {
        status: 'success',
        layer: 'connector',
      })
      this.#emit('session:opened', { selection, result })
      this.#policyAdapter?.observeOutcome?.(selection.descriptor, selection.route, {
        status: 'success',
        intent: selection.target.intent,
        actor: opts.actor || 'operator',
      })
      this.#incrementMetric(this.#telemetry.openedByIntent, selection.target.intent)
      await this.#auditRecorder?.record('remote_session_opened', {
        actor: opts.actor || 'operator',
        selector: selection.target.selector,
        intent: selection.target.intent,
        route: selection.route,
      })
      return {
        ...(result || {}),
        route: result?.route || selection.route,
        descriptor: result?.descriptor || selection.descriptor,
        routeProvenance: routeProvenance(selection),
      }
    } catch (error) {
      const wrapped = normalizeRemoteSessionError(error, {
        selector,
        intent: normalizeIntent(opts.intent || 'terminal'),
      })
      if (selection?.descriptor && selection?.route) {
        this.#registry.recordRouteOutcome(selection.descriptor, selection.route, {
          status: 'failure',
          layer: wrapped.layer || 'connector',
          reason: wrapped.message || 'connector failure',
        })
        this.#policyAdapter?.observeOutcome?.(selection.descriptor, selection.route, {
          status: 'failure',
          intent: selection.target.intent,
          actor: opts.actor || 'operator',
          layer: wrapped.layer,
          code: wrapped.code,
          reason: wrapped.message,
        })
      }
      this.#incrementMetric(this.#telemetry.failuresByLayer, wrapped.layer || 'unknown')
      this.#incrementMetric(this.#telemetry.failuresByCode, wrapped.code || 'remote-session-error')
      if (wrapped.code === 'policy-denied') {
        this.#incrementMetric(this.#telemetry.denialsByLayer, wrapped.layer || 'policy-adapter')
      }
      this.#emit('session:failed', { selection, error: wrapped })
      await this.#auditRecorder?.record(auditOperationForError(wrapped), {
        actor: opts.actor || 'operator',
        selector: selection?.target?.selector || wrapped.selector || selector,
        intent: selection?.target?.intent || wrapped.intent || normalizeIntent(opts.intent || 'terminal'),
        route: selection?.route || null,
        layer: wrapped.layer,
        code: wrapped.code,
        error: wrapped.message,
        details: wrapped.details || null,
      })
      throw wrapped
    }
  }

  #resolveDescriptor(target) {
    const selector = typeof target === 'string' ? target : target?.selector
    const named = this.#resolveNamedTarget(target)
    if (named) return named
    return this.#registry.resolvePeer(selector)
  }

  #resolveNamedTarget(target) {
    const selector = typeof target === 'string' ? target : target?.selector
    if (typeof selector !== 'string') return null
    if (!selector.startsWith('@') && !selector.startsWith('mesh://')) {
      return null
    }

    if (this.#nameResolver) {
      const resolved = this.#nameResolver.resolve(selector)
      if (resolved?.fingerprint) {
        return this.#registry.resolvePeer(resolved.fingerprint)
          || this.#registry.resolvePeer(resolved.record?.metadata?.podId || '')
          || null
      }
    }

    const alias = namedAlias(selector)
    if (!alias) return null
    const matches = [
      ...(this.#registry.matchPeers?.(alias) || []),
      ...(this.#registry.matchPeers?.(`@${alias}`) || []),
    ]
    if (!matches.length) return null
    if (matches.length === 1) return matches[0]
    return this.#pickBestDescriptor(matches, typeof target === 'string' ? createSessionTarget({ selector, intent: 'terminal' }) : target)
  }

  #pickBestDescriptor(candidates, target) {
    const ranked = candidates
      .map((descriptor, index) => {
        if (!includesAllCapabilities(descriptor, target.requiredCapabilities || [])) {
          return { descriptor, index, score: Number.NEGATIVE_INFINITY }
        }
        if (!intentIsSupported(descriptor, target.intent)) {
          return { descriptor, index, score: Number.NEGATIVE_INFINITY }
        }
        const decision = this.#policyAdapter?.checkTargetAccess?.(descriptor, target)
        if (decision && decision.allowed === false) {
          return { descriptor, index, score: Number.NEGATIVE_INFINITY }
        }
        let routes = this.#registry.computeReachability(descriptor, { intent: target.intent })
        if (this.#policyAdapter?.rankRoutes) {
          routes = this.#policyAdapter.rankRoutes(descriptor, target, routes)
        }
        const route = routes[0] || null
        return {
          descriptor,
          index,
          score: routePreferenceScore(descriptor, route, target.intent),
        }
      })
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        return left.index - right.index
      })

    return ranked[0]?.descriptor || null
  }

  #connectorForRoute(route) {
    switch (route.kind) {
      case 'direct-host':
        return this.#connectors.connectDirectHost || null
      case 'reverse-relay':
        return this.#connectors.connectReverseRelay || null
      case 'mesh-direct':
      case 'mesh-relay':
        return this.#connectors.connectMeshRuntime || null
      default:
        return null
    }
  }

  #emit(event, payload) {
    const listeners = this.#listeners.get(event)
    if (!listeners) return
    for (const callback of listeners) {
      callback(payload)
    }
  }

  #incrementMetric(map, key) {
    map.set(key, (map.get(key) || 0) + 1)
  }
}

function namedAlias(selector) {
  if (selector.startsWith('@')) {
    const withoutAt = selector.slice(1)
    if (withoutAt.includes('@')) return null
    return withoutAt || null
  }
  if (selector.startsWith('mesh://')) {
    const remainder = selector.slice('mesh://'.length)
    return remainder.split('/')[0] || null
  }
  return null
}

function routeProvenance(selection) {
  return {
    connectionKind: connectionKindForRoute(selection?.route),
    routeKind: selection?.route?.kind || 'unknown',
    relayHost: selection?.route?.relayHost || null,
    relayPort: selection?.route?.relayPort || null,
    endpoint: selection?.route?.endpoint || null,
    peerType: selection?.descriptor?.peerType || null,
    shellBackend: selection?.descriptor?.shellBackend || null,
  }
}
