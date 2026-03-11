import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { MountableFs } from '../clawser-mount.js'
import { RemoteMountManager } from '../clawser-remote-mounts.js'

describe('RemoteMountManager', () => {
  it('mounts a remote peer through the shared broker and routes mounted reads/lists', async () => {
    const fs = new MountableFs()
    const calls = []
    const manager = new RemoteMountManager({
      mountableFs: fs,
      runtimeRegistry: {
        resolvePeer(selector) {
          if (selector !== 'peer-1') return null
          return { identity: { canonicalId: 'peer-1' } }
        },
      },
      sessionBroker: {
        async openSession(selector, opts) {
          calls.push({ selector, opts })
          if (opts.operation === 'list') {
            return { entries: [{ name: 'hello.txt', kind: 'file' }] }
          }
          if (opts.operation === 'read') {
            return { content: 'hello remote' }
          }
          if (opts.operation === 'write') {
            return { ok: true }
          }
          throw new Error(`unexpected operation: ${opts.operation}`)
        },
      },
    })

    const mounted = await manager.mountPeer('peer-1', {
      mountPoint: '/mnt/peers/demo',
      remotePath: '/workspace',
    })

    const entries = await fs.listMounted('/mnt/peers/demo')
    const content = await fs.readMounted('/mnt/peers/demo/hello.txt')
    await fs.writeMounted('/mnt/peers/demo/hello.txt', 'updated')

    assert.equal(mounted.success, true)
    assert.deepEqual(entries, [{ name: 'hello.txt', kind: 'file' }])
    assert.equal(content, 'hello remote')
    assert.equal(calls[0].opts.path, '/workspace')
    assert.equal(calls[1].opts.path, '/workspace/hello.txt')
    assert.equal(calls[2].opts.operation, 'write')
  })

  it('detaches mounts and records audit when the remote path fails fatally', async () => {
    const fs = new MountableFs()
    const records = []
    const manager = new RemoteMountManager({
      mountableFs: fs,
      runtimeRegistry: {
        resolvePeer(selector) {
          if (selector !== 'peer-1') return null
          return { identity: { canonicalId: 'peer-1' } }
        },
      },
      sessionBroker: {
        async openSession() {
          const error = new Error('Transport closed')
          error.layer = 'transport'
          error.code = 'transport-closed'
          throw error
        },
      },
      auditRecorder: {
        async record(operation, payload) {
          records.push({ operation, payload })
        },
      },
    })

    await manager.mountPeer('peer-1', {
      mountPoint: '/mnt/peers/demo',
      remotePath: '/workspace',
    })

    await assert.rejects(
      () => fs.readMounted('/mnt/peers/demo/hello.txt'),
      /Transport closed/,
    )

    assert.equal(fs.isMounted('/mnt/peers/demo'), false)
    assert.deepEqual(
      records.map((entry) => entry.operation),
      ['remote_mount', 'remote_mount_operation', 'remote_mount_detached'],
    )
    assert.equal(records[1].payload.outcome, 'failure')
  })

  it('enforces capability or policy gating through the shared broker for mounted paths', async () => {
    const fs = new MountableFs()
    const manager = new RemoteMountManager({
      mountableFs: fs,
      runtimeRegistry: {
        resolvePeer(selector) {
          if (selector !== 'peer-1') return null
          return { identity: { canonicalId: 'peer-1' } }
        },
      },
      sessionBroker: {
        async openSession() {
          const error = new Error('Target denied by policy adapter')
          error.layer = 'mesh-acl'
          error.code = 'policy-denied'
          throw error
        },
      },
    })

    await manager.mountPeer('peer-1', {
      mountPoint: '/mnt/peers/demo',
      remotePath: '/workspace',
    })

    await assert.rejects(
      () => fs.listMounted('/mnt/peers/demo'),
      /policy adapter/i,
    )

    assert.equal(fs.isMounted('/mnt/peers/demo'), false)
  })
})
