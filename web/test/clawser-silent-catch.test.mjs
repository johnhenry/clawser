// clawser-silent-catch.test.mjs — tiny coverage for the silentCatch helper

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

const { silentCatch, clawserDebug } = await import('../clawser-state.js')

describe('silentCatch', () => {
  let warned = []
  let originalWarn
  beforeEach(() => {
    warned = []
    originalWarn = console.warn
    console.warn = (...args) => { warned.push(args) }
  })
  afterEach(() => {
    console.warn = originalWarn
    clawserDebug.disable()
  })

  it('is a no-op when debug is disabled', () => {
    clawserDebug.disable()
    silentCatch('mod', 'op', new Error('boom'))
    assert.equal(warned.length, 0)
  })

  it('emits a structured warning when debug is enabled', () => {
    clawserDebug.enable()
    silentCatch('clawser-pod', 'relay-disconnect', new Error('boom'))
    assert.equal(warned.length, 1)
    assert.equal(warned[0][0], '[clawser:silent-catch]')
    assert.deepEqual(warned[0][1], {
      module: 'clawser-pod',
      operation: 'relay-disconnect',
      error: 'boom',
    })
  })

  it('merges extra context fields when provided', () => {
    clawserDebug.enable()
    silentCatch('m', 'o', new Error('e'), { peerId: 'p1', retry: 3 })
    assert.equal(warned[0][1].peerId, 'p1')
    assert.equal(warned[0][1].retry, 3)
  })

  it('stringifies non-Error throws', () => {
    clawserDebug.enable()
    silentCatch('m', 'o', 'plain string')
    assert.equal(warned[0][1].error, 'plain string')
  })
})
