// clawser-transfer-controller.test.mjs

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  mapTransferRow,
  buildTransferViewModel,
  buildTransferController,
} from '../clawser-transfer-controller.mjs'

describe('mapTransferRow', () => {
  it('flattens an offer+state pair into the panel shape', () => {
    const row = {
      offer: { transferId: 't1', sender: 'me', recipient: 'peer', files: [{ name: 'a.txt', size: 5 }], totalSize: 5 },
      state: { transferId: 't1', status: 'transferring', bytesTransferred: 2, totalSize: 5, transferRate: 100, completedAt: null },
    }
    const m = mapTransferRow(row, 'me')
    assert.equal(m.id, 't1')
    assert.equal(m.filename, 'a.txt')
    assert.equal(m.peerId, 'peer')
    assert.equal(m.direction, 'upload')
    assert.equal(m.transferredSize, 2)
    assert.equal(m.totalSize, 5)
    assert.equal(m.speed, 100)
    assert.equal(m.status, 'transferring')
  })

  it('sets direction=download when local pod is recipient', () => {
    const row = {
      offer: { transferId: 't1', sender: 'peer', recipient: 'me', files: [{ name: 'b', size: 1 }] },
      state: { transferId: 't1', status: 'completed' },
    }
    assert.equal(mapTransferRow(row, 'me').direction, 'download')
  })

  it('summarizes multi-file offers', () => {
    const row = {
      offer: { transferId: 't', sender: 'me', recipient: 'p', files: [{ name: 'a' }, { name: 'b' }] },
      state: { transferId: 't', status: 'transferring' },
    }
    const m = mapTransferRow(row, 'me')
    // Multi-file: take first file's name for the ui
    assert.equal(m.filename, 'a')
  })

  it('handles missing offer (state-only)', () => {
    const row = { offer: null, state: { transferId: 't', status: 'failed', totalSize: 100 } }
    const m = mapTransferRow(row, 'me')
    assert.equal(m.id, 't')
    assert.equal(m.filename, 'unknown')
    assert.equal(m.totalSize, 100)
  })
})

describe('buildTransferViewModel', () => {
  it('splits transfers into active vs history by status', () => {
    const ft = {
      listTransfers: () => [
        { offer: { transferId: 'a', sender: 'me', recipient: 'p', files: [{ name: 'f1', size: 1 }] }, state: { transferId: 'a', status: 'transferring' } },
        { offer: { transferId: 'b', sender: 'me', recipient: 'p', files: [{ name: 'f2', size: 1 }] }, state: { transferId: 'b', status: 'completed' } },
        { offer: { transferId: 'c', sender: 'me', recipient: 'p', files: [{ name: 'f3', size: 1 }] }, state: { transferId: 'c', status: 'cancelled' } },
        { offer: { transferId: 'd', sender: 'me', recipient: 'p', files: [{ name: 'f4', size: 1 }] }, state: { transferId: 'd', status: 'offered' } },
      ],
    }
    const vm = buildTransferViewModel(ft, 'me')
    assert.equal(vm.active.length, 2)   // transferring + offered
    assert.equal(vm.history.length, 2)  // completed + cancelled
  })

  it('returns empty arrays when fileTransfer is missing', () => {
    const vm = buildTransferViewModel(null, 'me')
    assert.deepEqual(vm.active, [])
    assert.deepEqual(vm.history, [])
  })
})

describe('buildTransferController', () => {
  it('onSend creates an offer with descriptors derived from {name,size,mimeType}', async () => {
    const calls = { createOffer: [], cancelTransfer: [] }
    const ft = {
      createOffer: (recipient, files) => {
        calls.createOffer.push({ recipient, files })
        return { transferId: `t${calls.createOffer.length}` }
      },
      cancelTransfer: (id, reason) => calls.cancelTransfer.push({ id, reason }),
      // sendChunks omitted — controller should skip the pump when bytes are missing
    }
    const ctrl = buildTransferController({ fileTransfer: ft })
    const r = await ctrl.onSend([{ name: 'a.txt', size: 100 }], 'peer1')
    assert.equal(r.ok, true)
    assert.equal(r.transferId, 't1')
    assert.equal(calls.createOffer.length, 1)
    assert.equal(calls.createOffer[0].recipient, 'peer1')
    assert.equal(calls.createOffer[0].files[0].name, 'a.txt')
  })

  it('onSend rejects empty file list / missing target', async () => {
    const ctrl = buildTransferController({ fileTransfer: { createOffer: () => ({ transferId: 'x' }) } })
    assert.equal((await ctrl.onSend([], 'peer')).ok, false)
    assert.equal((await ctrl.onSend([{ name: 'a', size: 1 }], '')).ok, false)
  })

  it('onSend reports no fileTransfer error', async () => {
    const ctrl = buildTransferController({ fileTransfer: null })
    const r = await ctrl.onSend([{ name: 'a', size: 1 }], 'peer')
    assert.equal(r.ok, false)
    assert.match(r.error, /fileTransfer/)
  })

  it('onCancel calls cancelTransfer with reason', () => {
    const calls = []
    const ft = {
      createOffer: () => ({ transferId: 'x' }),
      cancelTransfer: (id, reason) => calls.push({ id, reason }),
    }
    const ctrl = buildTransferController({ fileTransfer: ft })
    const r = ctrl.onCancel('t-42')
    assert.equal(r.ok, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].id, 't-42')
    assert.equal(calls[0].reason, 'user-cancelled')
  })

  it('onCancel rejects missing id and missing transport', () => {
    const ctrl1 = buildTransferController({ fileTransfer: { createOffer: () => ({}), cancelTransfer: () => {} } })
    assert.equal(ctrl1.onCancel('').ok, false)
    const ctrl2 = buildTransferController({ fileTransfer: null })
    assert.equal(ctrl2.onCancel('t').ok, false)
  })

  it('onSend drives the chunk pump when bytes are present (full e2e simulation)', async () => {
    const chunkCalls = []
    const ft = {
      createOffer: () => ({ transferId: 't-bytes' }),
      cancelTransfer: () => {},
      sendChunks: async function* (id, fileData) {
        chunkCalls.push({ id, fileCount: fileData.length, totalBytes: fileData.reduce((s, b) => s + (b?.length || 0), 0) })
        // Yield one chunk per file
        for (let i = 0; i < fileData.length; i++) yield { cid: `c${i}`, data: fileData[i], fileIndex: i, offset: 0 }
      },
    }
    const ctrl = buildTransferController({ fileTransfer: ft })
    const bytes1 = new Uint8Array([1, 2, 3])
    const bytes2 = new Uint8Array([9, 9])
    await ctrl.onSend([
      { name: 'a', size: 3, bytes: bytes1 },
      { name: 'b', size: 2, bytes: bytes2 },
    ], 'peer')
    // Pump runs async — yield one microtask to let it execute
    await new Promise(r => setTimeout(r, 5))
    assert.equal(chunkCalls.length, 1)
    assert.equal(chunkCalls[0].fileCount, 2)
    assert.equal(chunkCalls[0].totalBytes, 5)
  })
})
