/**
 * Canonical remote-runtime query normalization and resolution helpers.
 */

function normalizeString(value) {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text : null
}

function normalizeArray(values = []) {
  return [...new Set((values || []).map(normalizeString).filter(Boolean))]
}

export function normalizeRemoteRuntimeQuery(input = {}) {
  if (typeof input === 'string') {
    return { selector: normalizeString(input) }
  }
  return {
    selector: normalizeString(input.selector || input.target || input.peer || input.canonicalId),
    text: normalizeString(input.text || input.search || input.q),
    peerType: normalizeString(input.peerType || input.type),
    shellBackend: normalizeString(input.shellBackend || input.backend),
    capability: normalizeString(input.capability),
    capabilities: normalizeArray(input.capabilities),
    intent: normalizeString(input.intent),
    source: normalizeString(input.source),
    status: normalizeString(input.status),
    serviceType: normalizeString(input.serviceType),
    serviceName: normalizeString(input.serviceName),
    podId: normalizeString(input.podId),
    limit: input.limit == null ? null : (Number.isFinite(Number(input.limit)) ? Number(input.limit) : null),
  }
}

export function registryFilterFromRuntimeQuery(input = {}) {
  const query = normalizeRemoteRuntimeQuery(input)
  return {
    text: query.text,
    peerType: query.peerType,
    shellBackend: query.shellBackend,
    capability: query.capability || query.capabilities[0] || null,
    intent: query.intent,
    source: query.source,
    status: query.status,
    serviceType: query.serviceType,
    serviceName: query.serviceName,
    podId: query.podId,
  }
}

export function resolveRuntimeQuerySelector(runtimeRegistry, input = {}) {
  const query = normalizeRemoteRuntimeQuery(input)
  if (!runtimeRegistry) {
    throw new Error('Remote runtime registry is not available')
  }
  if (query.selector) {
    return query.selector
  }
  const matches = runtimeRegistry.queryPeers(registryFilterFromRuntimeQuery(query))
  const limitedMatches = query.limit != null
    ? matches.slice(0, Math.max(0, query.limit))
    : matches
  if (limitedMatches.length === 1) {
    return limitedMatches[0].identity.canonicalId
  }
  if (limitedMatches.length === 0) {
    throw new Error('runtime query matched no peers')
  }
  throw new Error(`runtime query matched multiple peers: ${limitedMatches.map((peer) => peer.username || peer.identity.canonicalId).join(', ')}`)
}

export function parseRuntimeQueryFlags(flags = {}, positional = []) {
  return normalizeRemoteRuntimeQuery({
    text: positional?.join(' ') || null,
    peerType: flags.type,
    shellBackend: flags.backend,
    capability: flags.capability,
    intent: flags.intent,
    source: flags.source,
    status: flags.status,
    serviceType: flags['service-type'],
    serviceName: flags['service-name'],
  })
}
