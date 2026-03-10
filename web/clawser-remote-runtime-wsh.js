/**
 * Browser-side WSH runtime connector.
 *
 * Gives the canonical RemoteSessionBroker a real execution path for direct
 * hosts and reverse-relay peers using the browser WSH client.
 */

import { MSG, WshClient, WshKeyStore } from './packages-wsh.js'

function endpointToUrl(route) {
  if (typeof route?.endpoint !== 'string' || !route.endpoint.trim()) {
    throw new Error('Route endpoint is required for direct-host sessions')
  }
  if (/^[a-z]+:\/\//i.test(route.endpoint)) {
    return route.endpoint
  }
  return `https://${route.endpoint}`
}

function relayToUrl(route) {
  if (!route?.relayHost) {
    throw new Error('relayHost is required for reverse-relay sessions')
  }
  const port = Number(route.relayPort) || 4422
  return `https://${route.relayHost}:${port}`
}

async function collectExecResult(session) {
  const chunks = []
  let exitCode = 0

  await new Promise((resolve, reject) => {
    session.onData = (data) => chunks.push(data)
    session.onExit = (code) => {
      exitCode = Number.isFinite(code) ? code : 0
      resolve()
    }
    session.onClose = () => resolve()
    session.onError = (error) => reject(error instanceof Error ? error : new Error(String(error)))
  })

  const decoder = new TextDecoder()
  const output = chunks
    .map((chunk, index) => decoder.decode(chunk, { stream: index < chunks.length - 1 }))
    .join('')
  return { output, exitCode }
}

async function disconnectIfEphemeral(selection, client) {
  if (selection.route.kind === 'reverse-relay') {
    await client.disconnect().catch(() => {})
  }
}

function toUint8Array(data) {
  if (data instanceof Uint8Array) return data
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data == null) return new Uint8Array()
  return new TextEncoder().encode(String(data))
}

export class RemoteWshRuntimeConnector {
  #clientFactory
  #keyStoreFactory
  #keyName
  #username
  #onLog
  #directClients = new Map()
  #keyStorePromise = null

  constructor({
    keyName = 'default',
    username = 'browser',
    clientFactory = () => new WshClient(),
    keyStoreFactory = () => new WshKeyStore(),
    onLog = null,
  } = {}) {
    this.#keyName = keyName
    this.#username = username
    this.#clientFactory = clientFactory
    this.#keyStoreFactory = keyStoreFactory
    this.#onLog = onLog
  }

  async openSelection(selection, sessionOptions = null) {
    if (!selection?.route || !selection?.descriptor) {
      throw new Error('selection with route and descriptor is required')
    }

    const client = await this.#connectForSelection(selection)
    const effectiveOptions = sessionOptions || selection.sessionOptions || {}
    const intent = effectiveOptions.intent || selection.target?.intent || 'terminal'

    if (intent === 'exec') {
      const command = effectiveOptions.command
      if (!command) {
        throw new Error('command is required for exec intent')
      }
      const session = await client.openSession({ type: 'exec', command })
      const result = await collectExecResult(session)
      await session.close().catch(() => {})
      if (selection.route.kind === 'reverse-relay') {
        await client.disconnect().catch(() => {})
      }
      return { ...selection, client, session, ...result }
    }

    if (intent === 'terminal') {
      const session = await client.openSession({
        type: 'pty',
        command: effectiveOptions.command,
        cols: effectiveOptions.cols || 80,
        rows: effectiveOptions.rows || 24,
      })
      return { ...selection, client, session }
    }

    if (intent === 'tools') {
      if (effectiveOptions.toolName) {
        const toolName = effectiveOptions.toolName
        const result = await client.callTool(
          toolName,
          effectiveOptions.toolArgs || {},
          effectiveOptions.timeout || 30_000,
        )
        await disconnectIfEphemeral(selection, client)
        return { ...selection, client, result }
      }
      const tools = await client.discoverTools(effectiveOptions.timeout || 10_000)
      await disconnectIfEphemeral(selection, client)
      return { ...selection, client, tools }
    }

    if (intent === 'files') {
      const operation = effectiveOptions.operation || 'list'
      if (operation === 'list') {
        const result = await client.fileList(effectiveOptions.path, effectiveOptions.timeout || 10_000)
        await disconnectIfEphemeral(selection, client)
        return {
          ...selection,
          client,
          entries: normalizeFileEntries(result),
          metadata: result?.metadata || null,
          result,
        }
      }
      if (operation === 'stat') {
        const result = await client.fileStat(effectiveOptions.path, effectiveOptions.timeout || 10_000)
        await disconnectIfEphemeral(selection, client)
        return { ...selection, client, metadata: result?.metadata || null, result }
      }
      if (operation === 'read') {
        const result = await client.fileRead(
          effectiveOptions.path,
          effectiveOptions.offset,
          effectiveOptions.length,
          effectiveOptions.timeout || 10_000,
        )
        const text = typeof result?.metadata?.data === 'string' ? result.metadata.data : ''
        await disconnectIfEphemeral(selection, client)
        return {
          ...selection,
          client,
          content: text,
          text,
          metadata: result?.metadata || null,
          result,
        }
      }
      if (operation === 'write') {
        const result = await client.upload(
          toUint8Array(effectiveOptions.data),
          effectiveOptions.path,
          { onProgress: effectiveOptions.onProgress },
        )
        await disconnectIfEphemeral(selection, client)
        return { ...selection, client, result }
      }
      if (operation === 'mkdir') {
        const result = await client.fileMkdir(effectiveOptions.path, effectiveOptions.timeout || 10_000)
        await disconnectIfEphemeral(selection, client)
        return { ...selection, client, result }
      }
      if (operation === 'remove') {
        const result = await client.fileRemove(effectiveOptions.path, effectiveOptions.timeout || 10_000)
        await disconnectIfEphemeral(selection, client)
        return { ...selection, client, result }
      }
      if (operation === 'download') {
        const data = await client.download(effectiveOptions.path, {
          onProgress: effectiveOptions.onProgress,
        })
        await disconnectIfEphemeral(selection, client)
        return { ...selection, client, data }
      }
      if (operation === 'upload') {
        const result = await client.upload(toUint8Array(effectiveOptions.data), effectiveOptions.path, {
          onProgress: effectiveOptions.onProgress,
        })
        await disconnectIfEphemeral(selection, client)
        return { ...selection, client, result }
      }
      throw new Error(`Unsupported file operation: ${operation}`)
    }

    if (intent === 'gateway') {
      return {
        ...selection,
        client,
        close: async () => disconnectIfEphemeral(selection, client),
      }
    }

    if (intent === 'service') {
      const serviceName = effectiveOptions.serviceName || null
      const services = selection.descriptor.metadata?.serviceDetails
        || selection.descriptor.metadata?.services
        || []
      await disconnectIfEphemeral(selection, client)
      return { ...selection, client, serviceName, services }
    }

    if (intent === 'automation') {
      const command = effectiveOptions.command
      if (!command) {
        throw new Error('command is required for automation intent')
      }
      const session = await client.openSession({ type: 'exec', command })
      const result = await collectExecResult(session)
      await session.close().catch(() => {})
      await disconnectIfEphemeral(selection, client)
      return { ...selection, client, ...result }
    }

    return { ...selection, client }
  }

  async disconnectAll() {
    const clients = [...this.#directClients.values()]
    this.#directClients.clear()
    await Promise.allSettled(clients.map((client) => client.disconnect()))
  }

  async #connectForSelection(selection) {
    const route = selection.route
    if (route.kind === 'direct-host') {
      const url = endpointToUrl(route)
      if (this.#directClients.has(url)) {
        return this.#directClients.get(url)
      }
      const client = this.#clientFactory()
      await this.#connectClient(client, url, selection.descriptor.username || this.#username)
      this.#directClients.set(url, client)
      return client
    }

    if (route.kind === 'reverse-relay') {
      const client = this.#clientFactory()
      const url = relayToUrl(route)
      await this.#connectClient(client, url, this.#username)
      const response = await client.reverseConnect(
        selection.descriptor.identity.fingerprint,
        sessionOptionsTimeout(selection),
      )
      if (response?.type === MSG.REVERSE_REJECT) {
        throw new Error(response.reason || 'reverse peer rejected connection')
      }
      return client
    }

    throw new Error(`Unsupported WSH route kind: ${route.kind}`)
  }

  async #connectClient(client, url, username) {
    const keyStore = await this.#getKeyStore()
    const keyPair = await keyStore.getKeyPair(this.#keyName)
    if (!keyPair) {
      throw new Error(`WSH key "${this.#keyName}" not found`)
    }
    this.#onLog?.(2, `Connecting remote runtime via ${url}`)
    await client.connect(url, { username, keyPair })
  }

  async #getKeyStore() {
    if (!this.#keyStorePromise) {
      this.#keyStorePromise = (async () => {
        const keyStore = this.#keyStoreFactory()
        await keyStore.open?.()
        return keyStore
      })()
    }
    return this.#keyStorePromise
  }
}

function sessionOptionsTimeout(selection) {
  return selection?.sessionOptions?.timeout || 10_000
}

export function createRemoteWshConnectors(options = {}) {
  const connector = new RemoteWshRuntimeConnector(options)
  return {
    connectDirectHost: (selection) => connector.openSelection(selection, selection.sessionOptions),
    connectReverseRelay: (selection) => connector.openSelection(selection, selection.sessionOptions),
    disconnectAll: () => connector.disconnectAll(),
    connector,
  }
}

function normalizeFileEntries(result) {
  if (Array.isArray(result?.metadata?.entries)) return result.metadata.entries
  if (typeof result?.metadata?.data === 'string') {
    try {
      const parsed = JSON.parse(result.metadata.data)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // Ignore plain-text fallbacks.
    }
  }
  return []
}
