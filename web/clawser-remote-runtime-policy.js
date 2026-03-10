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

  constructor({ peerRegistry = null } = {}) {
    this.#peerRegistry = peerRegistry
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
}
