import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { executeRoutineAction, normalizeRoutineTarget } from '../clawser-routine-runtime.js'
import { RemoteRuntimeRegistry } from '../clawser-remote-runtime-registry.js'
import { createRemoteIdentity, createRemotePeerDescriptor, createReachabilityDescriptor } from '../clawser-remote-runtime-types.js'

describe('normalizeRoutineTarget', () => {
  it('supports string selectors for routine targets', () => {
    assert.deepEqual(
      normalizeRoutineTarget({ target: '@builder', intent: 'automation' }),
      { selector: '@builder', intent: 'automation' },
    )
  })

  it('preserves canonical runtime queries for deferred target resolution', () => {
    assert.deepEqual(
      normalizeRoutineTarget({
        target: {
          query: { type: 'host', capability: 'shell', text: 'builder' },
          intent: 'automation',
        },
      }),
      {
        selector: null,
        query: {
          selector: null,
          text: 'builder',
          peerType: 'host',
          shellBackend: null,
          capability: 'shell',
          capabilities: [],
          intent: null,
          source: null,
          status: null,
          serviceType: null,
          serviceName: null,
          podId: null,
          limit: null,
        },
        intent: 'automation',
        operation: null,
        path: null,
        data: null,
        requiredCapabilities: [],
        constraints: {},
      },
    )
  })
})

describe('executeRoutineAction', () => {
  it('routes targeted automation through the orchestrator', async () => {
    const calls = []
    const result = await executeRoutineAction({
      routine: {
        id: 'routine_1',
        name: 'health-check',
        action: { target: '@builder', command: 'echo ok', intent: 'automation', constraints: { cpu: 1 } },
        guardrails: { timeoutMs: 5000 },
      },
      orchestrator: {
        async runComputeTask(opts) {
          calls.push(opts)
          return { podId: '@builder', output: 'ok', exitCode: 0 }
        },
      },
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].selector, '@builder')
    assert.equal(calls[0].command, 'echo ok')
    assert.equal(result.output, 'ok')
  })

  it('routes non-compute targeted routines through the shared broker', async () => {
    const calls = []
    const result = await executeRoutineAction({
      routine: {
        id: 'routine_2',
        name: 'collect-config',
        action: {
          target: {
            selector: '@browser',
            intent: 'files',
            operation: 'read',
            path: '/etc/os-release',
            requiredCapabilities: ['fs'],
          },
        },
        guardrails: { timeoutMs: 3000 },
      },
      remoteSessionBroker: {
        async openSession(selector, opts) {
          calls.push({ selector, opts })
          return { content: 'NAME=demo' }
        },
      },
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].selector, '@browser')
    assert.equal(calls[0].opts.intent, 'files')
    assert.equal(calls[0].opts.actor, 'automation')
    assert.equal(result.content, 'NAME=demo')
  })

  it('resolves runtime queries through the canonical registry before broker open', async () => {
    const registry = new RemoteRuntimeRegistry()
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({
        canonicalId: 'host:builder',
        fingerprint: 'abcdef0123456789abcdef0123456789',
        aliases: ['@builder'],
      }),
      username: 'builder',
      peerType: 'host',
      shellBackend: 'pty',
      capabilities: ['shell', 'exec'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'direct-host',
          source: 'direct-bookmark',
          endpoint: 'builder.local:4422',
        }),
      ],
    }))
    const calls = []

    await executeRoutineAction({
      routine: {
        id: 'routine_2b',
        name: 'target-by-query',
        action: {
          target: {
            query: { type: 'host', capability: 'shell', text: 'builder' },
            intent: 'exec',
          },
          command: 'uname -a',
        },
      },
      remoteRuntimeRegistry: registry,
      remoteSessionBroker: {
        async openSession(selector, opts) {
          calls.push({ selector, opts })
          return { output: 'Linux', exitCode: 0 }
        },
      },
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].selector, 'host:builder')
    assert.equal(calls[0].opts.intent, 'exec')
  })

  it('falls back to the gateway path for local routines', async () => {
    const calls = []
    const result = await executeRoutineAction({
      routine: {
        id: 'routine_3',
        name: 'nightly-maintenance',
        action: { prompt: 'run cleanup' },
      },
      gateway: {
        async ingest(message, key) {
          calls.push({ message, key })
          return { ok: true }
        },
      },
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].message.content, 'run cleanup')
    assert.equal(calls[0].key, 'scheduler:routine_3')
    assert.deepEqual(result, { ok: true })
  })
})
