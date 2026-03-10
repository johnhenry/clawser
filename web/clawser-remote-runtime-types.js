/**
 * Canonical remote-runtime descriptor types used across BrowserMesh and wsh.
 *
 * The goal is to keep one peer/runtime shape in the browser regardless of
 * whether the source data comes from mesh discovery, relay presence, direct
 * host bookmarks, or `wsh` reverse peers.
 */

const HEX_FINGERPRINT = /^[0-9a-f]{32,}$/i

export const REMOTE_PEER_TYPES = Object.freeze([
  'host',
  'browser-shell',
  'vm-guest',
  'worker',
])

export const REMOTE_SHELL_BACKENDS = Object.freeze([
  'pty',
  'virtual-shell',
  'vm-console',
  'exec-only',
])

export const REMOTE_SESSION_INTENTS = Object.freeze([
  'terminal',
  'exec',
  'files',
  'tools',
  'gateway',
  'service',
  'automation',
])

export function supportHintsForRuntime({
  peerType = 'host',
  shellBackend = 'pty',
  supportsAttach = null,
  supportsReplay = null,
  supportsEcho = null,
  supportsTermSync = null,
} = {}) {
  const normalizedBackend = normalizeShellBackend(shellBackend)
  const normalizedPeerType = normalizePeerType(peerType)

  let replayMode = 'unsupported'
  if (normalizedBackend === 'pty') replayMode = 'lossless'
  if (normalizedBackend === 'virtual-shell') replayMode = 'stateful'
  if (normalizedBackend === 'vm-console') replayMode = 'partial'

  const defaultAttach = normalizedBackend !== 'exec-only'
  const defaultReplay = replayMode !== 'unsupported'
  const defaultEcho = normalizedBackend === 'virtual-shell'
  const defaultTermSync = normalizedBackend === 'virtual-shell'

  return {
    peerType: normalizedPeerType,
    shellBackend: normalizedBackend,
    supportsAttach: supportsAttach ?? defaultAttach,
    supportsReplay: supportsReplay ?? defaultReplay,
    supportsEcho: supportsEcho ?? defaultEcho,
    supportsTermSync: supportsTermSync ?? defaultTermSync,
    replayMode,
  }
}

function hexToBytes(hex) {
  if (!HEX_FINGERPRINT.test(hex) || hex.length % 2 !== 0) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function bytesToBase64url(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function canonicalIdForFingerprint(fingerprint) {
  if (!fingerprint || typeof fingerprint !== 'string') {
    throw new Error('fingerprint is required')
  }
  const normalized = fingerprint.trim()
  const bytes = hexToBytes(normalized)
  return bytes ? bytesToBase64url(bytes) : normalized
}

export function normalizePeerType(peerType) {
  return REMOTE_PEER_TYPES.includes(peerType) ? peerType : 'host'
}

export function normalizeShellBackend(shellBackend) {
  return REMOTE_SHELL_BACKENDS.includes(shellBackend) ? shellBackend : 'pty'
}

export function normalizeIntent(intent) {
  return REMOTE_SESSION_INTENTS.includes(intent) ? intent : 'terminal'
}

export function createRemoteIdentity({
  canonicalId,
  fingerprint = null,
  podId = null,
  aliases = [],
} = {}) {
  const nextCanonicalId = canonicalId || podId || (fingerprint ? canonicalIdForFingerprint(fingerprint) : null)
  if (!nextCanonicalId) {
    throw new Error('canonicalId, podId, or fingerprint is required')
  }

  const dedupedAliases = [...new Set(
    aliases
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )]

  return {
    canonicalId: nextCanonicalId,
    fingerprint,
    podId,
    aliases: dedupedAliases,
  }
}

export function createReachabilityDescriptor({
  kind,
  source,
  endpoint = null,
  relayHost = null,
  relayPort = null,
  transport = null,
  lastSeen = null,
  capabilities = [],
} = {}) {
  if (!kind || typeof kind !== 'string') {
    throw new Error('kind is required')
  }
  if (!source || typeof source !== 'string') {
    throw new Error('source is required')
  }

  return {
    kind,
    source,
    endpoint,
    relayHost,
    relayPort,
    transport,
    lastSeen,
    capabilities: [...new Set((capabilities || []).filter(Boolean))],
  }
}

export function createRemotePeerDescriptor({
  identity,
  username,
  peerType = 'host',
  shellBackend = 'pty',
  capabilities = [],
  supportsAttach = null,
  supportsReplay = null,
  supportsEcho = null,
  supportsTermSync = null,
  reachability = [],
  sources = [],
  conflicts = [],
  metadata = {},
} = {}) {
  if (!identity || typeof identity !== 'object') {
    throw new Error('identity is required')
  }
  if (!username || typeof username !== 'string') {
    throw new Error('username is required')
  }

  const supportHints = supportHintsForRuntime({
    peerType,
    shellBackend,
    supportsAttach,
    supportsReplay,
    supportsEcho,
    supportsTermSync,
  })

  return {
    identity: createRemoteIdentity(identity),
    username,
    peerType: supportHints.peerType,
    shellBackend: supportHints.shellBackend,
    capabilities: [...new Set((capabilities || []).filter(Boolean))],
    supportsAttach: supportHints.supportsAttach,
    supportsReplay: supportHints.supportsReplay,
    supportsEcho: supportHints.supportsEcho,
    supportsTermSync: supportHints.supportsTermSync,
    reachability: [...reachability],
    sources: [...new Set((sources || []).filter(Boolean))],
    conflicts: [...new Set((conflicts || []).filter(Boolean))],
    metadata: {
      replayMode: supportHints.replayMode,
      ...metadata,
    },
  }
}

export function createSessionTarget({
  selector,
  intent = 'terminal',
  requiredCapabilities = [],
  preferDirect = true,
} = {}) {
  if (!selector || typeof selector !== 'string') {
    throw new Error('selector is required')
  }

  return {
    selector,
    intent: normalizeIntent(intent),
    requiredCapabilities: [...new Set((requiredCapabilities || []).filter(Boolean))],
    preferDirect: !!preferDirect,
  }
}

export function remoteIdentityFromWshFingerprint(fingerprint, aliases = []) {
  return createRemoteIdentity({
    canonicalId: canonicalIdForFingerprint(fingerprint),
    fingerprint,
    aliases,
  })
}

export function remoteIdentityFromMeshPodId(podId, aliases = []) {
  return createRemoteIdentity({
    canonicalId: podId,
    podId,
    aliases,
  })
}

export function wshPeerInfoToRemotePeerDescriptor(peer, {
  relayHost,
  relayPort = 4422,
  transport = null,
} = {}) {
  if (!peer || typeof peer !== 'object') {
    throw new Error('peer is required')
  }
  if (!relayHost) {
    throw new Error('relayHost is required')
  }

  return createRemotePeerDescriptor({
    identity: remoteIdentityFromWshFingerprint(peer.fingerprint, [peer.fingerprint_short].filter(Boolean)),
    username: peer.username,
    peerType: peer.peer_type || 'host',
    shellBackend: peer.shell_backend || 'pty',
    capabilities: peer.capabilities || [],
    supportsAttach: peer.supports_attach,
    supportsReplay: peer.supports_replay,
    supportsEcho: peer.supports_echo,
    supportsTermSync: peer.supports_term_sync,
    reachability: [
      createReachabilityDescriptor({
        kind: 'reverse-relay',
        source: peer.source || 'wsh-relay',
        relayHost,
        relayPort,
        transport,
        lastSeen: peer.last_seen ?? null,
        capabilities: peer.capabilities || [],
      }),
    ],
    sources: [peer.source || 'wsh-relay'],
  })
}

export function meshDiscoveryRecordToRemotePeerDescriptor(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('record is required')
  }

  const metadata = record.metadata || {}
  const peerType = metadata.peerType || metadata.peer_type || 'worker'
  const shellBackend = metadata.shellBackend || metadata.shell_backend || 'exec-only'

  return createRemotePeerDescriptor({
    identity: remoteIdentityFromMeshPodId(record.podId, [
      metadata.wshFingerprint,
      record.label,
    ].filter(Boolean)),
    username: metadata.username || record.label || record.podId.slice(0, 8),
    peerType,
    shellBackend,
    capabilities: record.capabilities || [],
    supportsAttach: !!metadata.supportsAttach,
    supportsReplay: !!metadata.supportsReplay,
    supportsEcho: !!metadata.supportsEcho,
    supportsTermSync: !!metadata.supportsTermSync,
    reachability: [
      createReachabilityDescriptor({
        kind: record.endpoint ? 'mesh-direct' : 'mesh-discovery',
        source: record.source || 'mesh-discovery',
        endpoint: record.endpoint || null,
        transport: record.transport || null,
        lastSeen: record.discoveredAt ?? Date.now(),
        capabilities: record.capabilities || [],
      }),
    ],
    sources: [record.source || 'mesh-discovery'],
    metadata,
  })
}

export function routeKey(route) {
  return [
    route.kind || 'unknown',
    route.source || 'unknown',
    route.endpoint || '',
    route.relayHost || '',
    route.relayPort || '',
    route.transport || '',
  ].join('|')
}
