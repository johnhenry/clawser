import test from 'node:test'
import assert from 'node:assert/strict'

import { RemoteWshRuntimeConnector } from '../clawser-remote-runtime-wsh.js'
import { RemoteSessionBroker } from '../clawser-remote-session-broker.js'
import { RemoteRuntimeRegistry } from '../clawser-remote-runtime-registry.js'

function makeSelection(overrides = {}) {
  return {
    descriptor: {
      username: 'builder',
      identity: { canonicalId: 'peer-1', fingerprint: 'abcd1234' },
    },
    route: {
      kind: 'direct-host',
      endpoint: 'builder.local:4422',
    },
    target: {
      intent: 'exec',
    },
    sessionOptions: {
      intent: 'exec',
      command: 'printf hello',
    },
    ...overrides,
  }
}

function makeClient(log = []) {
  return {
    connect: async (url, { username }) => {
      log.push(['connect', url, username])
    },
    reverseConnect: async (fingerprint) => {
      log.push(['reverseConnect', fingerprint])
      return { type: 0x61 }
    },
    openSession: async ({ type, command }) => {
      log.push(['openSession', type, command])
      return {
        onData: null,
        onExit: null,
        onClose: null,
        async close() {
          log.push(['closeSession'])
        },
      }
    },
    disconnect: async () => {
      log.push(['disconnect'])
    },
    discoverTools: async () => {
      log.push(['discoverTools'])
      return [{ name: 'shell.exec' }]
    },
    callTool: async (name, args) => {
      log.push(['callTool', name, args])
      return { ok: true }
    },
    download: async (path) => {
      log.push(['download', path])
      return new Uint8Array([1, 2, 3])
    },
    upload: async (data, path) => {
      log.push(['upload', path, data instanceof Uint8Array ? data.byteLength : String(data).length])
      return { ok: true }
    },
    fileList: async (path) => {
      log.push(['fileList', path])
      return { metadata: { data: JSON.stringify([{ name: 'demo.txt', kind: 'file' }]) } }
    },
    fileRead: async (path) => {
      log.push(['fileRead', path])
      return { metadata: { data: 'hello file' } }
    },
    fileStat: async (path) => {
      log.push(['fileStat', path])
      return { metadata: { kind: 'file', size: 10 } }
    },
    fileMkdir: async (path) => {
      log.push(['fileMkdir', path])
      return { ok: true }
    },
    fileRemove: async (path) => {
      log.push(['fileRemove', path])
      return { ok: true }
    },
  }
}

function scheduleExecResult(client, data = 'hello', exitCode = 0) {
  const originalOpenSession = client.openSession
  client.openSession = async (opts) => {
    const session = await originalOpenSession(opts)
    setTimeout(() => {
      session.onData?.(new TextEncoder().encode(data))
      session.onExit?.(exitCode)
      session.onClose?.()
    }, 0)
    return session
  }
}

test('RemoteWshRuntimeConnector executes commands on direct hosts and caches the client', async () => {
  const log = []
  const client = makeClient(log)
  scheduleExecResult(client)
  let keyStoreOpened = 0

  const connector = new RemoteWshRuntimeConnector({
    clientFactory: () => client,
    keyStoreFactory: () => ({
      open: async () => { keyStoreOpened += 1 },
      getKeyPair: async () => ({ publicKey: {}, privateKey: {} }),
    }),
  })

  const first = await connector.openSelection(makeSelection())
  const second = await connector.openSelection(makeSelection())

  assert.equal(first.output, 'hello')
  assert.equal(first.exitCode, 0)
  assert.equal(second.output, 'hello')
  assert.equal(keyStoreOpened, 1)
  assert.equal(log.filter(([kind]) => kind === 'connect').length, 1)
})

test('RemoteWshRuntimeConnector reverse-connects through relays before exec sessions', async () => {
  const log = []
  const client = makeClient(log)
  scheduleExecResult(client, 'relay-ok')

  const connector = new RemoteWshRuntimeConnector({
    username: 'operator',
    clientFactory: () => client,
    keyStoreFactory: () => ({
      open: async () => {},
      getKeyPair: async () => ({ publicKey: {}, privateKey: {} }),
    }),
  })

  const result = await connector.openSelection(makeSelection({
    route: {
      kind: 'reverse-relay',
      relayHost: 'relay.local',
      relayPort: 4422,
    },
  }))

  assert.equal(result.output, 'relay-ok')
  assert.deepEqual(log.slice(0, 3), [
    ['connect', 'https://relay.local:4422', 'operator'],
    ['reverseConnect', 'abcd1234'],
    ['openSession', 'exec', 'printf hello'],
  ])
  assert.ok(log.some(([kind]) => kind === 'disconnect'))
})

test('RemoteWshRuntimeConnector supports reverse-relay file workflows through WshClient', async () => {
  const log = []
  const connector = new RemoteWshRuntimeConnector({
    clientFactory: () => makeClient(log),
    keyStoreFactory: () => ({
      open: async () => {},
      getKeyPair: async () => ({ publicKey: {}, privateKey: {} }),
    }),
    username: 'operator',
  })

  const result = await connector.openSelection(makeSelection({
    route: {
      kind: 'reverse-relay',
      relayHost: 'relay.local',
      relayPort: 4422,
    },
    target: { intent: 'files' },
    sessionOptions: { intent: 'files', operation: 'download', path: '/tmp/demo.txt' },
  }))

  assert.deepEqual(Array.from(result.data), [1, 2, 3])
  assert.deepEqual(log.slice(0, 3), [
    ['connect', 'https://relay.local:4422', 'operator'],
    ['reverseConnect', 'abcd1234'],
    ['download', '/tmp/demo.txt'],
  ])
  assert.ok(log.some(([kind]) => kind === 'disconnect'))
})

test('RemoteWshRuntimeConnector supports control-plane file list/read/write operations', async () => {
  const log = []
  const connector = new RemoteWshRuntimeConnector({
    clientFactory: () => makeClient(log),
    keyStoreFactory: () => ({
      open: async () => {},
      getKeyPair: async () => ({ publicKey: {}, privateKey: {} }),
    }),
  })

  const base = makeSelection({
    target: { intent: 'files' },
  })

  const listed = await connector.openSelection({
    ...base,
    sessionOptions: { intent: 'files', operation: 'list', path: '/workspace' },
  })
  const read = await connector.openSelection({
    ...base,
    sessionOptions: { intent: 'files', operation: 'read', path: '/workspace/demo.txt' },
  })
  await connector.openSelection({
    ...base,
    sessionOptions: { intent: 'files', operation: 'write', path: '/workspace/demo.txt', data: 'updated' },
  })

  assert.deepEqual(listed.entries, [{ name: 'demo.txt', kind: 'file' }])
  assert.equal(read.content, 'hello file')
  assert.ok(log.some(([kind]) => kind === 'upload'))
})

test('RemoteSessionBroker forwards session options into route connectors', async () => {
  const registry = new RemoteRuntimeRegistry()
  registry.ingestDirectHostBookmark({
    id: 'host:builder',
    host: 'builder.local',
    port: 4422,
    username: 'builder',
  })

  const broker = new RemoteSessionBroker({
    runtimeRegistry: registry,
    connectors: {
      connectDirectHost: async (selection) => selection,
    },
  })

  const result = await broker.openSession('host:builder', {
    intent: 'exec',
    command: 'printf hello',
  })

  assert.equal(result.sessionOptions.command, 'printf hello')
  assert.equal(result.sessionOptions.intent, 'exec')
})
