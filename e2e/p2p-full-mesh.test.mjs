/**
 * E2E test: Three-node mesh — full Clawser instances connected via
 * signaling + WebRTC DataChannel with all mesh subsystems wired.
 *
 * Prerequisites:
 *   - agent-browser installed + Chrome for Testing
 *   - Clawser app served on https://localhost:8080
 *
 * Tests:
 *   1. Vault creation + workspace setup (3 browsers)
 *   2. Signaling server registration + peer discovery
 *   3. WebRTC DataChannel establishment (all 3 pairs)
 *   4. Bidirectional messaging over WebRTC
 *   5. Mesh subsystem wiring: router, file transfer, streams, sessions
 *   6. Mesh Chat (local CRDT)
 *   7. Service Directory registration
 *   8. Health Monitor heartbeats
 *   9. Mesh ACL permissions
 *  10. Consensus Manager propose + vote
 *  11. Audit Chain append + verify
 *  12. Mesh Scheduler task submission
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
const SESSIONS = ['alpha', 'beta', 'gamma']
const PASSWORDS = { alpha: 'alpha', beta: 'beta', gamma: 'gamma' }
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

async function abEvalFile(session, filePath, { timeout = 30000 } = {}) {
  const js = readFileSync(filePath, 'utf-8')
  return ab(session, `eval "${js.replace(/"/g, '\\"')}"`, { timeout })
}

/** Run a JS script file in browser, return parsed JSON result. */
async function runScript(session, filename, { timeout = 30000 } = {}) {
  const cmd = `agent-browser ${AB_OPTS} --session ${session} eval "$(cat ${join(__dirname, filename)})"`;
  try {
    const { stdout } = await exec(cmd, { encoding: 'utf-8', timeout })
    const clean = stripAnsi(stdout).trim()
    // agent-browser wraps eval results in quotes
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

describe('P2P full mesh E2E (3 nodes)', () => {
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

    assert.equal(Object.keys(podIds).length, 3)
    // All podIds should be unique
    const uniqueIds = new Set(Object.values(podIds))
    assert.equal(uniqueIds.size, 3, 'All podIds should be unique')
  })

  // ── 2. Signaling + peer discovery ─────────────────────────────────

  it('connects all 3 browsers to signaling and discovers peers', async () => {
    // Inject signaling port into each browser
    for (const session of SESSIONS) {
      await abEval(session, `window.__sigPort = ${signalingPort}`)
    }

    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-signaling.mjs')
      assert.ok(result.registered, `${session} should be registered`)
    }

    // Wait for all to see each other
    await new Promise(r => setTimeout(r, 1000))

    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-check-peers.mjs')
      assert.equal(result.peerCount, 2, `${session} should see 2 peers`)
    }
  })

  // ── 3. WebRTC DataChannel ─────────────────────────────────────────

  it('establishes WebRTC DataChannels between all pairs', async () => {
    // Run full-mesh-connect on all 3 (order matters — first sets up listeners)
    for (const session of SESSIONS) {
      const result = await runScript(session, 'full-mesh-connect.mjs')
      console.log(`  [webrtc] ${session}: ${result.connectedPeers?.length || 0} connected`)
    }

    // Second pass for any that need to retry
    for (const session of SESSIONS) {
      const result = await runScript(session, 'full-mesh-connect.mjs')
      assert.ok(
        result.connectedPeers.length >= 2,
        `${session} should have 2 WebRTC connections, got ${result.connectedPeers.length}`
      )
    }
  })

  // ── 4. Bidirectional messaging ────────────────────────────────────

  it('sends and receives messages over WebRTC between all pairs', async () => {
    // Each peer broadcasts a unique message
    for (const session of SESSIONS) {
      await runScript(session, 'step-broadcast.mjs')
    }

    await new Promise(r => setTimeout(r, 1000))

    // Each peer should have received messages from the other 2
    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-check-messages.mjs')
      assert.ok(
        result.receivedCount >= 2,
        `${session} should have received >= 2 messages, got ${result.receivedCount}`
      )
    }
  })

  // ── 5. Mesh subsystem wiring ──────────────────────────────────────

  it('wires mesh transport subsystems on all nodes', async () => {
    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-wire-transport.mjs')
      assert.ok(result.wired.length >= 5, `${session} should wire >= 5 subsystems`)
      console.log(`  [wire] ${session}: ${result.wired.length} wired, ${result.errors.length} errors`)
    }
  })

  // ── 6. Mesh Router ────────────────────────────────────────────────

  it('routes messages between peers via mesh router', async () => {
    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-test-router.mjs')
      assert.ok(result.routes >= 2, `${session} should have >= 2 routes`)
      assert.ok(result.directPeers >= 2, `${session} should have >= 2 direct peers`)
      assert.equal(result.routeSuccess, true, `${session} router.route() should succeed`)
    }
  })

  // ── 7. Chat ───────────────────────────────────────────────────────

  it('creates chat rooms and sends messages', async () => {
    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-test-chat.mjs')
      assert.ok(result.roomCreated, `${session} should create a chat room`)
      assert.ok(result.messageSent, `${session} should send a chat message`)
    }
  })

  // ── 8. Service Directory ──────────────────────────────────────────

  it('registers local services', async () => {
    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-test-services.mjs')
      assert.ok(result.registered, `${session} should register a service`)
      assert.ok(result.localCount >= 1, `${session} should have >= 1 local service`)
    }
  })

  // ── 9. Health Monitor ─────────────────────────────────────────────

  it('records heartbeats and reports healthy peers', async () => {
    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-test-health.mjs')
      assert.equal(result.healthyPeers, 2, `${session} should have 2 healthy peers`)
    }
  })

  // ── 10. Mesh ACL ──────────────────────────────────────────────────

  it('grants and checks peer permissions', async () => {
    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-test-acl.mjs')
      assert.ok(result.chatRead, `${session} peer should have chat:read`)
      assert.ok(result.filesWrite, `${session} peer should have files:write`)
    }
  })

  // ── 11. Consensus ─────────────────────────────────────────────────

  it('proposes and votes on consensus items', async () => {
    const result = await runScript('alpha', 'step-test-consensus.mjs')
    assert.ok(result.proposalId, 'should create a proposal')
    assert.ok(result.voted, 'should record a vote')
    assert.ok(result.tally, 'should have a tally')
  })

  // ── 12. Audit Chain ───────────────────────────────────────────────

  it('appends and verifies audit entries', async () => {
    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-test-audit.mjs')
      assert.ok(result.length >= 1, `${session} audit chain should have entries`)
      assert.ok(result.verified, `${session} audit chain should verify`)
    }
  })

  // ── 13. Mesh Scheduler ────────────────────────────────────────────

  it('submits tasks to the scheduler', async () => {
    const result = await runScript('alpha', 'step-test-scheduler.mjs')
    assert.ok(result.submitted, 'should submit a task')
    assert.ok(result.queueDepth >= 1, 'queue should have >= 1 task')
  })
})
