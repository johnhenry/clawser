/**
 * BrowserMesh -> wsh policy adapter.
 *
 * Translates mesh ACL templates into coarse `wsh` exposure presets and
 * session-intent gating decisions for the remote session broker.
 */

export const WSH_EXPOSURE_PRESETS = Object.freeze({
  guest: Object.freeze({
    shell: false,
    exec: false,
    fs: false,
    tools: true,
    gateway: false,
  }),
  collaborator: Object.freeze({
    shell: true,
    exec: true,
    fs: true,
    tools: true,
    gateway: false,
  }),
  admin: Object.freeze({
    shell: true,
    exec: true,
    fs: true,
    tools: true,
    gateway: true,
  }),
})

const INTENT_TO_EXPOSURE = Object.freeze({
  terminal: 'shell',
  exec: 'exec',
  files: 'fs',
  tools: 'tools',
  gateway: 'gateway',
  service: 'tools',
  automation: 'exec',
})

export function meshTemplateToWshExposure(templateName) {
  return WSH_EXPOSURE_PRESETS[templateName] || null
}

export class RemoteRuntimePolicyAdapter {
  #peerRegistry
  #relayHealthProvider

  constructor({ peerRegistry = null, relayHealthProvider = null } = {}) {
    this.#peerRegistry = peerRegistry
    this.#relayHealthProvider = relayHealthProvider
  }

  translateTemplate(templateName) {
    return meshTemplateToWshExposure(templateName)
  }

  checkTargetAccess(descriptor, target) {
    const exposureGate = INTENT_TO_EXPOSURE[target.intent]
    if (!exposureGate) {
      return { allowed: true, layer: 'policy-adapter', reason: 'no policy gate for intent' }
    }

    const templateName = descriptor?.metadata?.templateName
      || descriptor?.metadata?.aclTemplate
      || null
    const preset = templateName ? this.translateTemplate(templateName) : null
    if (preset && preset[exposureGate] === false) {
      return {
        allowed: false,
        layer: 'mesh-acl',
        reason: `mesh ACL template "${templateName}" denies ${target.intent}`,
      }
    }

    if (this.#peerRegistry && descriptor?.identity?.fingerprint) {
      const access = this.#peerRegistry.checkAccess?.(
        descriptor.identity.fingerprint,
        'remote-runtime',
        target.intent,
      )
      if (access && access.allowed === false) {
        return {
          allowed: false,
          layer: 'mesh-acl',
          reason: access.reason || `mesh ACL denied ${target.intent}`,
        }
      }
    }

    return {
      allowed: true,
      layer: 'policy-adapter',
      reason: templateName
        ? `mesh ACL template "${templateName}" permits ${target.intent}`
        : 'no mesh ACL template mapped to target',
    }
  }

  rankRoutes(descriptor, target, routes) {
    const scored = routes.map((route, index) => {
      const decision = this.evaluateRoute(descriptor, target, route)
      return {
        route,
        decision,
        index,
      }
    })

    scored.sort((left, right) => {
      if (right.decision.scoreAdjustment !== left.decision.scoreAdjustment) {
        return right.decision.scoreAdjustment - left.decision.scoreAdjustment
      }
      return left.index - right.index
    })

    return scored.map((entry) => ({
      ...entry.route,
      policy: entry.decision,
    }))
  }

  evaluateRoute(descriptor, target, route) {
    const reasons = []
    let scoreAdjustment = 0

    const trustLevel = this.#trustLevelFor(descriptor)
    if (trustLevel != null) {
      if (trustLevel >= 0.75) {
        scoreAdjustment += 15
        reasons.push(`trusted:${trustLevel.toFixed(2)}`)
      } else if (trustLevel >= 0.25) {
        scoreAdjustment += 5
        reasons.push(`moderately-trusted:${trustLevel.toFixed(2)}`)
      } else {
        scoreAdjustment -= 10
        reasons.push(`low-trust:${trustLevel.toFixed(2)}`)
      }
    }

    const latency = descriptor?.metadata?.latency
    if (Number.isFinite(latency)) {
      if (latency <= 75) {
        scoreAdjustment += 4
        reasons.push(`low-latency:${latency}`)
      } else if (latency >= 250) {
        scoreAdjustment -= 4
        reasons.push(`high-latency:${latency}`)
      }
    }

    const relayHealth = this.#relayHealthFor(route)
    if (relayHealth === 'healthy') {
      scoreAdjustment += 6
      reasons.push('relay-healthy')
    } else if (relayHealth === 'degraded') {
      scoreAdjustment -= 6
      reasons.push('relay-degraded')
    } else if (relayHealth === 'offline') {
      scoreAdjustment -= 30
      reasons.push('relay-offline')
    }

    if (target.intent === 'gateway' && trustLevel != null && trustLevel < 0.5) {
      scoreAdjustment -= 10
      reasons.push('gateway-requires-higher-trust')
    }

    return {
      allowed: true,
      layer: 'route-policy',
      scoreAdjustment,
      reasons,
    }
  }

  #trustLevelFor(descriptor) {
    const fingerprint = descriptor?.identity?.fingerprint
    if (this.#peerRegistry && fingerprint && this.#peerRegistry.getTrust) {
      return this.#peerRegistry.getTrust(fingerprint)
    }
    if (Number.isFinite(descriptor?.metadata?.trustLevel)) {
      return descriptor.metadata.trustLevel
    }
    return null
  }

  #relayHealthFor(route) {
    if (!route?.relayHost) return null
    if (!this.#relayHealthProvider) return route.health || null
    if (typeof this.#relayHealthProvider === 'function') {
      return this.#relayHealthProvider(route.relayHost, route) || null
    }
    if (typeof this.#relayHealthProvider.getHealth === 'function') {
      return this.#relayHealthProvider.getHealth(route.relayHost, route) || null
    }
    return route.health || null
  }
}
