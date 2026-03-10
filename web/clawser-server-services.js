/**
 * ServerManager <-> mesh service advertising bridge.
 */

import { SERVICE_TYPES } from './clawser-peer-services.js'

function routeServiceName(route) {
  return `server:${route.id}`
}

export function serverRouteToServiceDescriptor(route) {
  return {
    name: routeServiceName(route),
    type: SERVICE_TYPES.HTTP_PROXY,
    capabilities: ['service', 'http', 'virtual-server'],
    metadata: {
      managedBy: 'server-manager',
      routeId: route.id,
      hostname: route.hostname,
      port: route.port ?? 80,
      scope: route.scope || '_global',
      handlerType: route.handler?.type || 'function',
      runtime: 'local-virtual-server',
      execution: route.handler?.execution || 'page',
    },
  }
}

export async function bindServerManagerServices({
  serverManager,
  serviceAdvertiser,
  onLog = null,
} = {}) {
  if (!serverManager) throw new Error('serverManager is required')
  if (!serviceAdvertiser) throw new Error('serviceAdvertiser is required')

  const advertised = new Set()

  async function sync() {
    const routes = await serverManager.listRoutes()
    const next = new Set()

    for (const route of routes) {
      if (!route?.enabled) continue
      const descriptor = serverRouteToServiceDescriptor(route)
      next.add(descriptor.name)
      serviceAdvertiser.advertise(descriptor)
    }

    for (const name of advertised) {
      if (!next.has(name)) {
        serviceAdvertiser.withdraw(name)
      }
    }

    advertised.clear()
    for (const name of next) advertised.add(name)
    onLog?.(2, `Synced ${advertised.size} virtual server services`)
  }

  const unsubscribe = serverManager.onChange(() => {
    sync().catch((error) => onLog?.(0, `[server-services] ${error.message}`))
  })

  await sync()

  return () => {
    unsubscribe?.()
    for (const name of advertised) {
      serviceAdvertiser.withdraw(name)
    }
    advertised.clear()
  }
}
