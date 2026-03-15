/**
 * E2E test 10.1: Mesh subsystems over WebRTC
 *
 * Tests file transfer offer/accept, mesh router message delivery, and
 * stream multiplexer frame routing — all over live WebRTC DataChannels
 * between two Clawser browser instances.
 *
 * Prerequisites:
 *   - agent-browser installed + Chrome for Testing
 *   - Clawser app served on https://localhost:8080
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const exec = promisify(execCb)
const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Config ──────────────────────────────────────────────────────────

const APP_URL = 'https://localhost:8080'
const SESSIONS = ['alpha', 'beta']
const PASSWORDS = { alpha: 'alpha', beta: 'beta' }
const AB_OPTS = '--ignore-https-errors'

// ─── Helpers ──────────────────────────────────────────────────────────

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '')
}

async function ab(session, args, { timeout = 30000 } = {}) {
  const cmd = `agent-browser ${AB_OPTS} --session ${session} ${args}`
  try {
    const { stdout } = await exec(cmd, { encoding: 'utf-8', timeout })
    return stripAnsi(stdout).trim()
  } catch (err) {
    const stderr = stripAnsi(err.stderr?.toString() || '')
    const stdout = stripAnsi(err.stdout?.toString() || '')
    throw new Error(`ab failed: ${cmd}\nstdout: ${stdout}\nstderr: ${stderr}`)
  }
}

async function abEval(session, js, { timeout = 30000 } = {}) {
  const escaped = js.replace(/'/g, "'\\''")
  return ab(session, `eval '${escaped}'`, { timeout })
}

/** Run a JS script file in browser, return parsed JSON result. */
async function runScript(session, filename, { timeout = 30000 } = {}) {
  const cmd = `agent-browser ${AB_OPTS} --session ${session} eval "$(cat ${join(__dirname, filename)})"`
  try {
    const { stdout } = await exec(cmd, { encoding: 'utf-8', timeout })
    const clean = stripAnsi(stdout).trim()
    try { return JSON.parse(JSON.parse(clean)) } catch {
      try { return JSON.parse(clean) } catch { return clean }
    }
  } catch (err) {
    throw new Error(`runScript(${session}, ${filename}) failed: ${stripAnsi(err.stderr?.toString() || err.message)}`)
  }
}

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

async function closeSession(name) {
  try { await exec(`agent-browser --session ${name} close`, { timeout: 10000 }) } catch { /* ok */ }
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('P2P mesh subsystems over WebRTC (2 nodes)', () => {
  let signalingServer
  let signalingPort
  const podIds = {}

  before(async () => {
    // ── Start signaling server ──
    const { createServer } = await import('../server/signaling/index.mjs')
    const sig = createServer({ port: 0 })
    signalingPort = await sig.listen(0)
    signalingServer = sig
    console.log(`  [setup] signaling on port ${signalingPort}`)

    // ── Clean stale sessions ──
    for (const s of SESSIONS) await closeSession(s)
  })

  after(async () => {
    for (const s of SESSIONS) await closeSession(s)
    if (signalingServer) await signalingServer.close()
    console.log('  [teardown] done')
  })

  // ── 1. App setup ──────────────────────────────────────────────────

  it('sets up vault and workspace for each browser', async () => {
    for (const session of SESSIONS) {
      console.log(`  [setup] ${session}...`)

      // Open app
      await ab(session, `open "${APP_URL}"`)
      await ab(session, 'wait 2000')

      // Create vault
      let snap = await ab(session, 'snapshot -i')
      if (snap.includes('Create Vault')) {
        await ab(session, `fill @e2 "${PASSWORDS[session]}"`)
        await ab(session, `fill @e3 "${PASSWORDS[session]}"`)
        await ab(session, 'click @e4')
        await ab(session, 'wait 2000')
      } else if (snap.includes('Unlock Vault')) {
        await ab(session, `fill @e2 "${PASSWORDS[session]}"`)
        await ab(session, 'click @e3')
        await ab(session, 'wait 2000')
      }

      // Create workspace
      snap = await ab(session, 'snapshot -i')
      if (snap.includes('New workspace')) {
        await ab(session, `fill @e2 "${session}-workspace"`)
        await ab(session, 'click @e3')
        await ab(session, 'wait 2000')
      }

      // Verify we're in the workspace
      snap = await ab(session, 'snapshot -i')
      assert.ok(snap.includes('panel'), `${session} should be in workspace view`)

      // Get podId
      const result = await runScript(session, 'probe-podid.mjs')
      podIds[session] = result.podId
      console.log(`  [setup] ${session} podId: ${result.podId?.slice(0, 12)}`)
    }

    assert.equal(Object.keys(podIds).length, 2)
    const uniqueIds = new Set(Object.values(podIds))
    assert.equal(uniqueIds.size, 2, 'Both podIds should be unique')
  })

  // ── 2. Signaling + peer discovery ─────────────────────────────────

  it('connects both browsers to signaling and discovers peer', async () => {
    for (const session of SESSIONS) {
      await abEval(session, `window.__sigPort = ${signalingPort}`)
    }

    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-signaling.mjs')
      assert.ok(result.registered, `${session} should be registered`)
    }

    await new Promise(r => setTimeout(r, 1000))

    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-check-peers.mjs')
      assert.equal(result.peerCount, 1, `${session} should see 1 peer`)
    }
  })

  // ── 3. WebRTC DataChannel ─────────────────────────────────────────

  it('establishes WebRTC DataChannel between alpha and beta', async () => {
    for (const session of SESSIONS) {
      const result = await runScript(session, 'full-mesh-connect.mjs')
      console.log(`  [webrtc] ${session}: ${result.connectedPeers?.length || 0} connected`)
    }

    // Second pass for retries
    for (const session of SESSIONS) {
      const result = await runScript(session, 'full-mesh-connect.mjs')
      assert.ok(
        result.connectedPeers.length >= 1,
        `${session} should have >= 1 WebRTC connection, got ${result.connectedPeers.length}`
      )
    }
  })

  // ── 4. Wire transports ────────────────────────────────────────────

  it('wires mesh transport subsystems on both nodes', async () => {
    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-wire-transport.mjs')
      assert.ok(result.wired.length >= 5, `${session} should wire >= 5 subsystems`)
      console.log(`  [wire] ${session}: ${result.wired.length} wired, ${result.errors.length} errors`)
    }
  })

  // ── 5. File transfer offer/accept over WebRTC ─────────────────────

  it('alpha creates file offer and beta receives it via WebRTC', async () => {
    // Alpha creates a file offer destined for beta
    const alphaResult = await runScript('alpha', 'step-test-file-transfer.mjs')
    assert.ok(alphaResult.offerSent, 'alpha should create a file offer')
    assert.ok(alphaResult.offerId, 'offer should have a transferId')
    console.log(`  [files] alpha created offer: ${alphaResult.offerId?.slice(0, 12)}`)

    // Wait for the offer to propagate over WebRTC
    await new Promise(r => setTimeout(r, 1000))

    // Beta checks for received offers
    const betaResult = await waitFor(
      async () => {
        const r = await runScript('beta', 'step-check-file-offer.mjs')
        return r.hasOffer ? r : null
      },
      { timeout: 10000, interval: 500, label: 'beta receives file offer' }
    )

    assert.ok(betaResult.hasOffer, 'beta should have received the file offer')
    assert.ok(betaResult.totalTransfers >= 1, 'beta should have >= 1 transfer')
    console.log(`  [files] beta received ${betaResult.totalTransfers} transfer(s)`)
  })

  // ── 6. Mesh router message delivery over WebRTC ───────────────────

  it('alpha routes a message to beta via mesh router', async () => {
    // Alpha routes a message to beta through the mesh router
    const alphaResult = await runScript('alpha', 'step-test-router-delivery.mjs')
    assert.ok(alphaResult.routeResult?.success, 'alpha router.route() should succeed')
    console.log(`  [router] alpha routed to ${alphaResult.targetPodId}`)

    // Wait for message to arrive
    await new Promise(r => setTimeout(r, 1000))

    // Beta checks __rtcMessages for router-wrapped messages
    const betaResult = await waitFor(
      async () => {
        const r = await runScript('beta', 'step-check-router-messages.mjs')
        return r.receivedRouterMsg ? r : null
      },
      { timeout: 10000, interval: 500, label: 'beta receives router message' }
    )

    assert.ok(betaResult.receivedRouterMsg, 'beta should have received a router message')
    assert.ok(betaResult.routerMessages >= 1, 'beta should have >= 1 router message in __rtcMessages')
    console.log(`  [router] beta received ${betaResult.routerMessages} router message(s)`)
  })

  // ── 7. Stream multiplexer over WebRTC ─────────────────────────────

  it('alpha opens a stream and beta receives the STREAM_OPEN frame', async () => {
    // Alpha opens a stream via the multiplexer
    const alphaResult = await runScript('alpha', 'step-test-stream-mux.mjs')
    assert.ok(alphaResult.streamOpened, 'alpha should open a stream')
    assert.equal(alphaResult.method, 'e2e/test-stream', 'stream method should match')
    console.log(`  [stream] alpha opened stream: ${alphaResult.streamId}`)

    // Wait for the STREAM_OPEN frame to arrive at beta
    await new Promise(r => setTimeout(r, 1000))

    // Beta checks __rtcMessages for stream-mux frames
    const betaResult = await waitFor(
      async () => {
        const r = await runScript('beta', 'step-check-stream-received.mjs')
        return r.receivedStreamFrame ? r : null
      },
      { timeout: 10000, interval: 500, label: 'beta receives stream frame' }
    )

    assert.ok(betaResult.receivedStreamFrame, 'beta should have received a stream-mux message')
    assert.ok(betaResult.streamMuxMessages >= 1, 'beta should have >= 1 stream-mux message')
    console.log(`  [stream] beta received ${betaResult.streamMuxMessages} stream-mux message(s), ${betaResult.openFrames} STREAM_OPEN frame(s)`)
  })
})
