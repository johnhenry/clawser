/**
 * Remote filesystem mount integration.
 */

function ensureAbsolute(path) {
  if (!path || path === '/') return '/'
  return path.startsWith('/') ? path : `/${path}`
}

function joinRemotePath(basePath = '/', relativePath = '') {
  const base = ensureAbsolute(basePath).replace(/\/+$/, '') || '/'
  const relative = String(relativePath || '').replace(/^\/+/, '')
  if (!relative) return base || '/'
  return `${base === '/' ? '' : base}/${relative}` || '/'
}

function defaultMountPoint(selector) {
  const normalized = String(selector || 'peer').replace(/^@/, '').replace(/[^a-zA-Z0-9._-]+/g, '-')
  return `/mnt/peers/${normalized || 'peer'}`
}

function normalizeEntries(result) {
  if (Array.isArray(result?.entries)) return result.entries
  if (Array.isArray(result?.metadata?.entries)) return result.metadata.entries
  if (typeof result?.metadata?.data === 'string') {
    try {
      const parsed = JSON.parse(result.metadata.data)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // Ignore non-JSON fallbacks.
    }
  }
  return []
}

function normalizeContent(result) {
  if (typeof result?.text === 'string') return result.text
  if (typeof result?.content === 'string') return result.content
  if (result?.data instanceof Uint8Array) {
    return new TextDecoder().decode(result.data)
  }
  if (typeof result?.metadata?.data === 'string') return result.metadata.data
  return ''
}

export class RemoteMountManager {
  #mountableFs
  #runtimeRegistry
  #sessionBroker
  #auditRecorder

  constructor({
    mountableFs,
    runtimeRegistry,
    sessionBroker,
    auditRecorder = null,
  } = {}) {
    if (!mountableFs) throw new Error('mountableFs is required')
    if (!runtimeRegistry) throw new Error('runtimeRegistry is required')
    if (!sessionBroker) throw new Error('sessionBroker is required')
    this.#mountableFs = mountableFs
    this.#runtimeRegistry = runtimeRegistry
    this.#sessionBroker = sessionBroker
    this.#auditRecorder = auditRecorder
  }

  async mountPeer(selector, {
    mountPoint = defaultMountPoint(selector),
    remotePath = '/',
    readOnly = false,
  } = {}) {
    const resolved = this.#runtimeRegistry.resolvePeer(selector)
    if (!resolved) {
      throw new Error(`Unknown remote peer: ${selector}`)
    }

    const adapter = {
      kind: 'remote',
      readOnly,
      metadata: {
        selector,
        canonicalId: resolved.identity.canonicalId,
        remotePath: ensureAbsolute(remotePath),
      },
      listDirectory: async (relativePath = '') => {
        const result = await this.#sessionBroker.openSession(selector, {
          intent: 'files',
          operation: 'list',
          path: joinRemotePath(remotePath, relativePath),
        })
        return normalizeEntries(result)
      },
      readFile: async (relativePath = '') => {
        const result = await this.#sessionBroker.openSession(selector, {
          intent: 'files',
          operation: 'read',
          path: joinRemotePath(remotePath, relativePath),
        })
        return normalizeContent(result)
      },
      writeFile: async (relativePath = '', content = '') => {
        if (readOnly) throw new Error('Mount is read-only')
        return this.#sessionBroker.openSession(selector, {
          intent: 'files',
          operation: 'write',
          path: joinRemotePath(remotePath, relativePath),
          data: content,
        })
      },
      statPath: async (relativePath = '') => this.#sessionBroker.openSession(selector, {
        intent: 'files',
        operation: 'stat',
        path: joinRemotePath(remotePath, relativePath),
      }),
      removePath: async (relativePath = '') => {
        if (readOnly) throw new Error('Mount is read-only')
        return this.#sessionBroker.openSession(selector, {
          intent: 'files',
          operation: 'remove',
          path: joinRemotePath(remotePath, relativePath),
        })
      },
    }

    this.#mountableFs.mountAdapter(mountPoint, adapter, { readOnly })
    await this.#auditRecorder?.record('remote_mount', {
      selector,
      mountPoint,
      remotePath: ensureAbsolute(remotePath),
      readOnly,
    })
    return { success: true, mountPoint, selector }
  }

  async unmountPeer(mountPoint) {
    const removed = this.#mountableFs.unmount(mountPoint)
    if (removed) {
      await this.#auditRecorder?.record('remote_unmount', { mountPoint })
    }
    return removed
  }
}

