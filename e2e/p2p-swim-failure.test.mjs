/**
 * E2E test 10.2: SWIM failure detection
 *
 * Tests the SWIM protocol's ability to detect peer failure when a browser
 * is closed. Two Clawser instances connect via signaling + WebRTC, wire
 * SWIM with short intervals, then one browser is closed. The remaining
 * browser's SWIM instance should detect the peer as suspect then dead.
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

// Short SWIM intervals for fast failure detection
const SWIM_PING_INTERVAL = 500
const SWIM_PING_TIMEOUT = 300
const SWIM_SUSPECT_TIMEOUT = 2000

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

describe('P2P SWIM failure detection (2 nodes)', () => {
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
    // Close alpha (beta is already closed as part of the test)
    await closeSession('alpha')
    if (signalingServer) await signalingServer.close()
    console.log('  [teardown] done')
  })

  // ── 1. App setup ──────────────────────────────────────────────────

  it('sets up vault and workspace for each browser', async () => {
    for (const session of SESSIONS) {
      console.log(`  [setup] ${session}...`)

      await ab(session, `open "${APP_URL}"`)
      await ab(session, 'wait 2000')

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

      snap = await ab(session, 'snapshot -i')
      if (snap.includes('New workspace')) {
        await ab(session, `fill @e2 "${session}-workspace"`)
        await ab(session, 'click @e3')
        await ab(session, 'wait 2000')
      }

      snap = await ab(session, 'snapshot -i')
      assert.ok(snap.includes('panel'), `${session} should be in workspace view`)

      const result = await runScript(session, 'probe-podid.mjs')
      podIds[session] = result.podId
      console.log(`  [setup] ${session} podId: ${result.podId?.slice(0, 12)}`)
    }

    assert.equal(Object.keys(podIds).length, 2)
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
      await runScript(session, 'full-mesh-connect.mjs')
    }

    // Second pass for retries
    for (const session of SESSIONS) {
      const result = await runScript(session, 'full-mesh-connect.mjs')
      assert.ok(
        result.connectedPeers.length >= 1,
        `${session} should have >= 1 WebRTC connection`
      )
    }
  })

  // ── 4. Wire SWIM on both browsers ─────────────────────────────────

  it('wires SWIM membership on both nodes with short intervals', async () => {
    for (const session of SESSIONS) {
      // Set SWIM timing parameters before wiring
      await abEval(session, `window.__swimPingInterval = ${SWIM_PING_INTERVAL}`)
      await abEval(session, `window.__swimPingTimeout = ${SWIM_PING_TIMEOUT}`)
      await abEval(session, `window.__swimSuspectTimeout = ${SWIM_SUSPECT_TIMEOUT}`)

      const result = await runScript(session, 'step-wire-swim.mjs')
      assert.ok(result.wired, `${session} SWIM should be wired`)
      assert.ok(result.memberCount >= 2, `${session} should have >= 2 members (self + peer)`)
      assert.ok(result.aliveCount >= 2, `${session} should have >= 2 alive members`)
      console.log(`  [swim] ${session}: ${result.memberCount} members, ${result.aliveCount} alive`)
    }
  })

  // ── 5. Verify both peers are alive ─────────────────────────────────

  it('verifies both SWIM instances report peers as alive', async () => {
    // Let SWIM exchange a few ping rounds
    await new Promise(r => setTimeout(r, 2000))

    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-check-swim-state.mjs')
      assert.ok(result.aliveCount >= 2, `${session} should have >= 2 alive members`)
      console.log(`  [swim] ${session}: ${result.aliveCount} alive, members:`, result.memberStates)
    }
  })

  // ── 6. Close beta (simulate crash) ─────────────────────────────────

  it('closes beta to simulate a crash', async () => {
    console.log('  [swim] closing beta to simulate crash...')
    await closeSession('beta')

    // Give some time for the close to propagate
    await new Promise(r => setTimeout(r, 500))
    console.log('  [swim] beta closed')
  })

  // ── 7. Alpha detects beta as suspect then dead ─────────────────────

  it('alpha detects beta as suspect or dead via SWIM', async () => {
    // SWIM should detect the failure within:
    //   pingInterval (500ms) + pingTimeout (300ms) + suspectTimeout (2000ms)
    // Total: ~2800ms worst case. We wait up to 10s to be safe.

    console.log('  [swim] waiting for alpha to detect beta failure...')

    const result = await waitFor(
      async () => {
        const r = await runScript('alpha', 'step-check-swim-state.mjs')
        if (r.hasSuspectOrDead) return r
        // Also check member states directly
        const states = Object.values(r.memberStates || {})
        if (states.some(s => s === 'suspect' || s === 'dead')) return r
        return null
      },
      { timeout: 15000, interval: 500, label: 'alpha detects beta as suspect/dead' }
    )

    assert.ok(result, 'alpha should have detected beta failure')

    // Check the final state
    const memberStates = Object.values(result.memberStates || {})
    const hasSuspectOrDead = memberStates.some(s => s === 'suspect' || s === 'dead')
    assert.ok(hasSuspectOrDead, `alpha should report beta as suspect or dead, got: ${JSON.stringify(result.memberStates)}`)

    // Check events
    const events = result.events || []
    const failureEvents = events.filter(e => e.type === 'suspect' || e.type === 'dead')
    console.log(`  [swim] alpha detected ${failureEvents.length} failure event(s):`, failureEvents.map(e => e.type))
    console.log(`  [swim] final member states:`, result.memberStates)

    assert.ok(
      failureEvents.length >= 1,
      `alpha should have >= 1 suspect/dead event, got ${failureEvents.length}`
    )
  })
})
