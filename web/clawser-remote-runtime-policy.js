/**
 * BrowserMesh -> wsh policy adapter.
 *
 * Translates mesh ACL templates into coarse `wsh` exposure presets and
 * session-intent gating decisions for the remote session broker.
 */

function unique(values) {
  return [...new Set((values || []).filter(Boolean))]
}

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

export const MESH_SCOPE_TO_WSH_EXPOSURE = Object.freeze([
  { scope: '*:*', grants: ['shell', 'exec', 'fs', 'tools', 'gateway'] },
  { scope: 'gateway:*', grants: ['gateway'] },
  { scope: 'network:*', grants: ['gateway'] },
  { scope: 'tools:*', grants: ['tools'] },
  { scope: 'agent:*', grants: ['tools'] },
  { scope: 'chat:*', grants: ['tools'] },
  { scope: 'files:read', grants: ['fs', 'tools'] },
  { scope: 'files:write', grants: ['fs'] },
  { scope: 'files:*', grants: ['fs', 'tools'] },
  { scope: 'compute:submit', grants: ['shell', 'exec'] },
  { scope: 'compute:*', grants: ['shell', 'exec'] },
  { scope: 'shell:*', grants: ['shell', 'exec'] },
  { scope: 'terminal:*', grants: ['shell', 'exec'] },
])

const INTENT_TO_EXPOSURE = Object.freeze({
  terminal: 'shell',
  exec: 'exec',
  files: 'fs',
  tools: 'tools',
  gateway: 'gateway',
  service: 'tools',
  automation: 'exec',
  deployment: 'fs',
})

const DEFAULT_MIN_TRUST_BY_INTENT = Object.freeze({
  gateway: 0.5,
  files: 0.35,
  automation: 0.4,
  deployment: 0.45,
})

export function meshTemplateToWshExposure(templateName) {
  return WSH_EXPOSURE_PRESETS[templateName] || null
}

function scopeMatches(ruleScope, actualScope) {
  if (actualScope === '*:*') return true
  if (ruleScope === '*:*') return actualScope === '*:*'
  if (ruleScope.endsWith(':*')) {
    return actualScope === ruleScope || actualScope.startsWith(ruleScope.slice(0, -1))
  }
  return actualScope === ruleScope
}

export function meshScopesToWshExposure(scopes = []) {
  const grants = new Set()
  for (const scope of scopes) {
    for (const rule of MESH_SCOPE_TO_WSH_EXPOSURE) {
      if (scopeMatches(rule.scope, scope)) {
        for (const grant of rule.grants) grants.add(grant)
      }
    }
  }
  return {
    shell: grants.has('shell'),
    exec: grants.has('exec'),
    fs: grants.has('fs'),
    tools: grants.has('tools'),
    gateway: grants.has('gateway'),
  }
}

export class RemoteRuntimePolicyAdapter {
  #peerRegistry
  #relayHealthProvider
  #meshAcl
  #quotaEnforcer
  #runtimeQuality

  constructor({ peerRegistry = null, relayHealthProvider = null, meshAcl = null, quotaEnforcer = null } = {}) {
    this.#peerRegistry = peerRegistry
    this.#relayHealthProvider = relayHealthProvider
    this.#meshAcl = meshAcl
    this.#quotaEnforcer = quotaEnforcer
    this.#runtimeQuality = new Map()
  }

  translateTemplate(templateName, descriptor = null) {
    const preset = meshTemplateToWshExposure(templateName)
    if (preset) return preset

    const template = this.#meshAcl?.getTemplate?.(templateName)
    if (template?.scopes) {
      return meshScopesToWshExposure(template.scopes)
    }

    const inlineScopes = unique([
      ...((descriptor?.metadata?.templateScopes) || []),
      ...((descriptor?.metadata?.aclScopes) || []),
    ])
    if (inlineScopes.length > 0) {
      return meshScopesToWshExposure(inlineScopes)
    }

    return null
  }

  checkTargetAccess(descriptor, target) {
    const exposureGate = INTENT_TO_EXPOSURE[target.intent]
    if (!exposureGate) {
      return { allowed: true, layer: 'policy-adapter', reason: 'no policy gate for intent' }
    }

    const templateName = descriptor?.metadata?.templateName
      || descriptor?.metadata?.aclTemplate
      || null
    const preset = templateName ? this.translateTemplate(templateName, descriptor) : this.translateTemplate(null, descriptor)
    if (preset && preset[exposureGate] === false) {
      return {
        allowed: false,
        layer: 'mesh-acl',
        reason: `mesh ACL template "${templateName}" denies ${target.intent}`,
      }
    }

    if (target.intent === 'deployment' && descriptor?.metadata?.deploymentSupport?.canDeploy !== true) {
      return {
        allowed: false,
        layer: 'capability',
        reason: 'target does not advertise deployment support',
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

    const requiredTrust = this.#requiredTrustFor(descriptor, target)
    const trustLevel = this.#trustLevelFor(descriptor)
    if (requiredTrust != null && (trustLevel == null || trustLevel < requiredTrust)) {
      return {
        allowed: false,
        layer: 'route-policy',
        reason: `target ${target.intent} requires trust >= ${requiredTrust.toFixed(2)} (current: ${trustLevel == null ? 'unknown' : trustLevel.toFixed(2)})`,
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

    if (target.intent === 'deployment') {
      if (descriptor?.metadata?.deploymentSupport?.canDeploy) {
        scoreAdjustment += 12
        reasons.push('deployment-supported')
      } else {
        scoreAdjustment -= 20
        reasons.push('deployment-unsupported')
      }
    }

    const successRate = Number.isFinite(route?.successRate) ? route.successRate : null
    if (successRate != null) {
      if (successRate >= 0.95) {
        scoreAdjustment += 6
        reasons.push(`high-success-rate:${successRate.toFixed(2)}`)
      } else if (successRate >= 0.75) {
        scoreAdjustment += 2
        reasons.push(`steady-success-rate:${successRate.toFixed(2)}`)
      } else {
        scoreAdjustment -= 8
        reasons.push(`low-success-rate:${successRate.toFixed(2)}`)
      }
    }

    const runtimeQuality = this.#runtimeQuality.get(descriptor?.identity?.canonicalId || '')
    if (runtimeQuality && Number.isFinite(runtimeQuality.successRate)) {
      if (runtimeQuality.successRate >= 0.9) {
        scoreAdjustment += 4
        reasons.push(`runtime-quality:${runtimeQuality.successRate.toFixed(2)}`)
      } else if (runtimeQuality.successRate < 0.5) {
        scoreAdjustment -= 6
        reasons.push(`runtime-quality-low:${runtimeQuality.successRate.toFixed(2)}`)
      }
    }

    const quotaSignal = this.#quotaSignalFor(descriptor, target)
    if (quotaSignal?.allowed === false) {
      scoreAdjustment -= 20
      reasons.push(`quota-blocked:${quotaSignal.resource}`)
    } else if (quotaSignal?.remaining != null && quotaSignal.remaining <= 1) {
      scoreAdjustment -= 8
      reasons.push(`quota-low:${quotaSignal.resource}`)
    }

    return {
      allowed: true,
      layer: 'route-policy',
      scoreAdjustment,
      reasons,
    }
  }

  observeOutcome(descriptor, _route, {
    status,
    layer = null,
  } = {}) {
    const canonicalId = descriptor?.identity?.canonicalId
    if (!canonicalId) return
    const current = this.#runtimeQuality.get(canonicalId) || {
      successCount: 0,
      failureCount: 0,
      denials: {},
    }
    const successCount = current.successCount + (status === 'success' ? 1 : 0)
    const failureCount = current.failureCount + (status === 'failure' ? 1 : 0)
    const total = successCount + failureCount
    const denials = { ...(current.denials || {}) }
    if (status === 'failure' && layer) {
      denials[layer] = (denials[layer] || 0) + 1
    }
    this.#runtimeQuality.set(canonicalId, {
      successCount,
      failureCount,
      successRate: total > 0 ? successCount / total : null,
      denials,
    })
    const fingerprint = descriptor?.identity?.fingerprint
    if (fingerprint && this.#peerRegistry?.recordObservedTrust) {
      this.#peerRegistry.recordObservedTrust(
        fingerprint,
        total > 0 ? successCount / total : 0,
      )
    }
  }

  #trustLevelFor(descriptor) {
    const fingerprint = descriptor?.identity?.fingerprint
    if (this.#peerRegistry && fingerprint) {
      if (this.#peerRegistry.getReputation) {
        return this.#peerRegistry.getReputation(fingerprint)
      }
      if (this.#peerRegistry.getTrust) {
        return this.#peerRegistry.getTrust(fingerprint)
      }
    }
    if (Number.isFinite(descriptor?.metadata?.trustLevel)) {
      return descriptor.metadata.trustLevel
    }
    return null
  }

  #quotaSignalFor(descriptor, target) {
    if (!this.#quotaEnforcer || target.intent !== 'gateway') return null
    const podId = descriptor?.identity?.podId
      || descriptor?.identity?.fingerprint
      || descriptor?.identity?.canonicalId
    if (!podId) return null
    return this.#quotaEnforcer.checkQuota?.(podId, 'jobsPerHour', 1) || null
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

  #requiredTrustFor(descriptor, target) {
    const explicit = target?.minTrust ?? descriptor?.metadata?.minTrustByIntent?.[target.intent]
    if (Number.isFinite(explicit)) {
      return Number(explicit)
    }
    return DEFAULT_MIN_TRUST_BY_INTENT[target.intent] ?? null
  }
}
