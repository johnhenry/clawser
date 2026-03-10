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
    return this.#registry.listPeers(filter)
  }

  resolveTarget(selector, {
    intent = 'terminal',
    requiredCapabilities = [],
    preferDirect = true,
  } = {}) {
    const target = createSessionTarget({ selector, intent, requiredCapabilities, preferDirect })
    const descriptor = this.#resolveDescriptor(target.selector)
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
    const selection = this.explainRoute(selector, opts)
    this.#emit('route:selected', selection)
    await this.#auditRecorder?.record('remote_route_selected', {
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
      this.#registry.recordRouteOutcome(selection.descriptor, selection.route, {
        status: 'success',
        layer: 'broker',
      })
      return selection
    }

    try {
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
      await this.#auditRecorder?.record('remote_session_opened', {
        selector: selection.target.selector,
        intent: selection.target.intent,
        route: selection.route,
      })
      return result
    } catch (error) {
      this.#registry.recordRouteOutcome(selection.descriptor, selection.route, {
        status: 'failure',
        layer: 'connector',
        reason: error?.message || 'connector failure',
      })
      this.#emit('session:failed', { selection, error })
      await this.#auditRecorder?.record('remote_session_failed', {
        selector: selection.target.selector,
        intent: selection.target.intent,
        route: selection.route,
        error: error?.message || String(error),
      })
      if (error instanceof RemoteSessionError) {
        throw error
      }
      throw new RemoteSessionError(error?.message || 'Remote session open failed', {
        code: 'connector-failed',
        layer: 'connector',
        selector: selection.target.selector,
        intent: selection.target.intent,
        details: { cause: error },
      })
    }
  }

  #resolveDescriptor(selector) {
    const named = this.#resolveNamedTarget(selector)
    if (named) return named
    return this.#registry.resolvePeer(selector)
  }

  #resolveNamedTarget(selector) {
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
    return this.#registry.resolvePeer(alias) || this.#registry.resolvePeer(`@${alias}`) || null
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
