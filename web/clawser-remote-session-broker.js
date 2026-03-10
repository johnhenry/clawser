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

export class RemoteSessionBroker {
  #registry
  #nameResolver
  #connectors
  #policyAdapter

  constructor({
    runtimeRegistry,
    nameResolver = null,
    connectors = {},
    policyAdapter = null,
  } = {}) {
    if (!runtimeRegistry) {
      throw new Error('runtimeRegistry is required')
    }
    this.#registry = runtimeRegistry
    this.#nameResolver = nameResolver
    this.#connectors = { ...connectors }
    this.#policyAdapter = policyAdapter
  }

  resolveTarget(selector, {
    intent = 'terminal',
    requiredCapabilities = [],
    preferDirect = true,
  } = {}) {
    const target = createSessionTarget({ selector, intent, requiredCapabilities, preferDirect })
    const descriptor = this.#resolveDescriptor(target.selector)
    if (!descriptor) {
      throw new Error(`Unknown remote target: ${target.selector}`)
    }
    if (!includesAllCapabilities(descriptor, target.requiredCapabilities)) {
      throw new Error(
        `Target ${target.selector} does not advertise required capabilities: ${target.requiredCapabilities.join(', ')}`
      )
    }
    if (!intentIsSupported(descriptor, target.intent)) {
      throw new Error(
        `Target ${target.selector} does not support ${target.intent} sessions on ${descriptor.peerType}/${descriptor.shellBackend}`
      )
    }

    if (this.#policyAdapter?.checkTargetAccess) {
      const decision = this.#policyAdapter.checkTargetAccess(descriptor, target)
      if (!decision?.allowed) {
        throw new Error(decision?.reason || 'Target denied by policy adapter')
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
      throw new Error(`No viable routes for ${target.selector}`)
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
    return {
      ...selected,
      connectionKind: connectionKindForRoute(selected.route),
      reason: `${selected.descriptor.peerType}/${selected.descriptor.shellBackend} via ${selected.route.kind}${policyReasons}`,
    }
  }

  async openSession(selector, opts = {}) {
    const selection = this.explainRoute(selector, opts)
    const connector = this.#connectorForRoute(selection.route)
    if (!connector) {
      return selection
    }

    return connector({
      ...selection,
      intent: normalizeIntent(selection.target.intent),
    })
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
