import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { executeRoutineAction, normalizeRoutineTarget } from '../clawser-routine-runtime.js'

describe('normalizeRoutineTarget', () => {
  it('supports string selectors for routine targets', () => {
    assert.deepEqual(
      normalizeRoutineTarget({ target: '@builder', intent: 'automation' }),
      { selector: '@builder', intent: 'automation' },
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
