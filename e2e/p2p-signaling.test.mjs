/**
 * E2E test: Two browser instances connect through the signaling server
 * and exchange a message.
 *
 * Prerequisites:
 *   - agent-browser installed (`npm install -g agent-browser`)
 *   - Chrome for Testing installed (`agent-browser install`)
 *
 * What this tests:
 *   1. Signaling server starts and accepts connections
 *   2. Browser A registers as pod-alpha
 *   3. Browser B registers as pod-beta
 *   4. Both peers discover each other via the peer list
 *   5. Browser A sends a signal message to Browser B
 *   6. Browser B receives the message
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const exec = promisify(execCb)
const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Helpers ──────────────────────────────────────────────────────────

/** Strip ANSI escape codes from a string. */
function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '')
}

/** Run agent-browser CLI command and return stdout (async — doesn't block event loop). */
async function ab(session, args, { timeout = 30000 } = {}) {
  const cmd = `agent-browser --session ${session} ${args}`
  try {
    const { stdout } = await exec(cmd, { encoding: 'utf-8', timeout })
    return stripAnsi(stdout).trim()
  } catch (err) {
    const stderr = err.stderr?.toString() || ''
    const stdout = err.stdout?.toString() || ''
    throw new Error(`agent-browser failed: ${cmd}\nstdout: ${stripAnsi(stdout)}\nstderr: ${stripAnsi(stderr)}`)
  }
}

/** Execute JavaScript in an agent-browser session and return the result. */
async function abEval(session, js, { timeout = 30000 } = {}) {
  const escaped = js.replace(/'/g, "'\\''")
  return ab(session, `eval '${escaped}'`, { timeout })
}

/** Wait for a condition by polling. */
async function waitFor(fn, { timeout = 15000, interval = 500, label = 'condition' } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const result = await fn()
      if (result) return result
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, interval))
  }
  throw new Error(`Timed out waiting for: ${label}`)
}

/** Quietly close a session, ignoring errors. */
async function closeSession(name) {
  try { await exec(`agent-browser --session ${name} close`, { timeout: 10000 }) } catch { /* ok */ }
}

// ─── Test ─────────────────────────────────────────────────────────────

describe('P2P signaling E2E', () => {
  let signalingServer
  let signalingPort
  let fileServer
  let filePort
  const SESSION_A = 'clawser-e2e-alpha'
  const SESSION_B = 'clawser-e2e-beta'

  before(async () => {
    // ── Start signaling server ──
    const { createServer } = await import('../server/signaling/index.mjs')
    const sig = createServer({ port: 0 })
    signalingPort = await sig.listen(0)
    signalingServer = sig
    console.log(`  [setup] signaling server on port ${signalingPort}`)

    // ── Start static file server for test page ──
    const testPageHtml = readFileSync(join(__dirname, 'p2p-test-page.html'), 'utf-8')
    fileServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(testPageHtml)
    })
    await new Promise((resolve, reject) => {
      fileServer.once('error', reject)
      fileServer.listen(0, () => {
        filePort = fileServer.address().port
        fileServer.removeListener('error', reject)
        resolve()
      })
    })
    console.log(`  [setup] file server on port ${filePort}`)

    // ── Clean up stale sessions ──
    await closeSession(SESSION_A)
    await closeSession(SESSION_B)
  })

  after(async () => {
    await closeSession(SESSION_A)
    await closeSession(SESSION_B)

    if (signalingServer) await signalingServer.close()
    if (fileServer) await new Promise(r => fileServer.close(r))
    console.log('  [teardown] done')
  })

  it('two browsers discover each other and exchange a message via signaling', async () => {
    const urlA = `http://127.0.0.1:${filePort}/?podId=pod-alpha&signalingUrl=ws://127.0.0.1:${signalingPort}`
    const urlB = `http://127.0.0.1:${filePort}/?podId=pod-beta&signalingUrl=ws://127.0.0.1:${signalingPort}`

    // ── Step 1: Open both browsers ──
    console.log('  [test] opening browsers...')
    await ab(SESSION_A, `open "${urlA}"`)
    await ab(SESSION_B, `open "${urlB}"`)

    // ── Step 2: Wait for both to register ──
    console.log('  [test] waiting for registration...')
    await waitFor(async () => {
      const s = await ab(SESSION_A, 'get text "#status"')
      return s.includes('registered')
    }, { label: 'browser A registered' })

    await waitFor(async () => {
      const s = await ab(SESSION_B, 'get text "#status"')
      return s.includes('registered')
    }, { label: 'browser B registered' })

    console.log('  [test] both registered')

    // ── Step 3: Verify peer discovery ──
    console.log('  [test] checking peer discovery...')
    await waitFor(async () => {
      const peers = await ab(SESSION_A, 'get text "#peers"')
      return peers.includes('pod-beta')
    }, { label: 'A sees B' })

    await waitFor(async () => {
      const peers = await ab(SESSION_B, 'get text "#peers"')
      return peers.includes('pod-alpha')
    }, { label: 'B sees A' })

    console.log('  [test] peers discovered')

    // ── Step 4: A sends signal to B ──
    console.log('  [test] A -> B message...')
    await abEval(SESSION_A, `window.clawserTest.sendSignal('pod-beta', { text: 'hello from alpha' })`)

    // ── Step 5: B received it ──
    await waitFor(async () => {
      const msgs = await ab(SESSION_B, 'get text "#messages"')
      return msgs.includes('hello from alpha')
    }, { label: 'B received message' })

    const messagesRaw = await ab(SESSION_B, 'get text "#messages"')
    const messages = JSON.parse(messagesRaw)
    assert.equal(messages.length, 1)
    assert.equal(messages[0].from, 'pod-alpha')
    assert.deepEqual(messages[0].data, { text: 'hello from alpha' })

    // ── Step 6: B replies to A ──
    console.log('  [test] B -> A reply...')
    await abEval(SESSION_B, `window.clawserTest.sendSignal('pod-alpha', { text: 'reply from beta' })`)

    await waitFor(async () => {
      const msgs = await ab(SESSION_A, 'get text "#messages"')
      return msgs.includes('reply from beta')
    }, { label: 'A received reply' })

    const messagesA = JSON.parse(await ab(SESSION_A, 'get text "#messages"'))
    assert.equal(messagesA.length, 1)
    assert.equal(messagesA[0].from, 'pod-beta')
    assert.deepEqual(messagesA[0].data, { text: 'reply from beta' })

    console.log('  [test] bidirectional messaging verified!')
  })
})
