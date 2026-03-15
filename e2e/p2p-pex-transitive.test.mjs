/**
 * E2E test: PEX Transitive Discovery across real browsers.
 *
 * Proves that Peer Exchange (PEX) enables transitive peer discovery:
 * alpha discovers gamma through beta, without any direct signaling
 * connection between alpha and gamma.
 *
 * Topology:
 *   alpha <--signaling+WebRTC--> beta <--signaling+WebRTC--> gamma
 *   alpha --- NO signaling ----> gamma
 *   alpha discovers gamma via PEX through beta
 *
 * Prerequisites:
 *   - agent-browser installed + Chrome for Testing
 *   - Clawser app served on https://localhost:8080
 *
 * Tests:
 *   1. Vault creation + workspace setup (3 browsers)
 *   2. Selective signaling: alpha sees beta, beta sees alpha+gamma, gamma sees beta
 *   3. WebRTC: alpha<->beta, beta<->gamma (no alpha<->gamma)
 *   4. PEX wiring on all 3 nodes
 *   5. Alpha discovers gamma transitively through beta's PEX exchange
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

// ─── Helpers ─────────────────────────────────────────────────────────

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

// ─── Tests ───────────────────────────────────────────────────────────

describe('PEX transitive discovery E2E (alpha -> beta -> gamma)', () => {
  let signalingServer
  let signalingPort
  const podIds = {}

  before(async () => {
    // Start signaling server
    const { createServer } = await import('../server/signaling/index.mjs')
    const sig = createServer({ port: 0 })
    signalingPort = await sig.listen(0)
    signalingServer = sig
    console.log(`  [setup] signaling on port ${signalingPort}`)

    // Clean stale sessions
    for (const s of SESSIONS) await closeSession(s)
  })

  after(async () => {
    for (const s of SESSIONS) await closeSession(s)
    if (signalingServer) await signalingServer.close()
    console.log('  [teardown] done')
  })

  // ── 1. App setup ─────────────────────────────────────────────────

  it('sets up vault and workspace for each browser', async () => {
    for (const session of SESSIONS) {
      console.log(`  [setup] ${session}...`)

      await ab(session, `open "${APP_URL}"`)
      await ab(session, 'wait 2000')

      // Create or unlock vault
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
        await ab(session, `fill @e2 "${session}-pex-ws"`)
        await ab(session, 'click @e3')
        await ab(session, 'wait 2000')
      }

      // Verify workspace
      snap = await ab(session, 'snapshot -i')
      assert.ok(snap.includes('panel'), `${session} should be in workspace view`)

      // Get podId
      const result = await runScript(session, 'probe-podid.mjs')
      podIds[session] = result.podId
      console.log(`  [setup] ${session} podId: ${result.podId?.slice(0, 12)}`)
    }

    assert.equal(Object.keys(podIds).length, 3)
    const uniqueIds = new Set(Object.values(podIds))
    assert.equal(uniqueIds.size, 3, 'All podIds should be unique')
  })

  // ── 2. Selective signaling ───────────────────────────────────────
  // alpha sees only beta, beta sees alpha+gamma, gamma sees only beta.
  // This ensures alpha CANNOT discover gamma through signaling.

  it('connects browsers to signaling with selective peer visibility', async () => {
    // Inject signaling port into each browser
    for (const session of SESSIONS) {
      await abEval(session, `window.__sigPort = ${signalingPort}`)
    }

    // Set allow lists: alpha sees beta, gamma sees beta, beta sees both
    await abEval('alpha', `window.__sigAllowList = ['${podIds.beta}']`)
    await abEval('beta', `window.__sigAllowList = ['${podIds.alpha}', '${podIds.gamma}']`)
    await abEval('gamma', `window.__sigAllowList = ['${podIds.beta}']`)

    // Register all with signaling (using selective script)
    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-pex-signaling-selective.mjs')
      assert.ok(result.registered, `${session} should be registered with signaling`)
    }

    // Wait for peer-joined broadcasts to propagate
    await new Promise(r => setTimeout(r, 1500))

    // Verify: alpha sees only beta
    const alphaCheck = await runScript('alpha', 'step-check-peers.mjs')
    console.log(`  [signaling] alpha sees ${alphaCheck.peerCount} peer(s): ${alphaCheck.peers}`)
    assert.equal(alphaCheck.peerCount, 1, 'alpha should see exactly 1 peer (beta)')

    // Verify: beta sees both
    const betaCheck = await runScript('beta', 'step-check-peers.mjs')
    console.log(`  [signaling] beta sees ${betaCheck.peerCount} peer(s): ${betaCheck.peers}`)
    assert.equal(betaCheck.peerCount, 2, 'beta should see 2 peers (alpha + gamma)')

    // Verify: gamma sees only beta
    const gammaCheck = await runScript('gamma', 'step-check-peers.mjs')
    console.log(`  [signaling] gamma sees ${gammaCheck.peerCount} peer(s): ${gammaCheck.peers}`)
    assert.equal(gammaCheck.peerCount, 1, 'gamma should see exactly 1 peer (beta)')
  })

  // ── 3. WebRTC: alpha<->beta and beta<->gamma ────────────────────

  it('establishes WebRTC between alpha<->beta and beta<->gamma (not alpha<->gamma)', async () => {
    // Connect alpha<->beta and beta<->gamma via WebRTC
    // Run on all 3 — each only connects to its signaling-visible peers
    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-pex-webrtc-pair.mjs')
      console.log(`  [webrtc] ${session}: ${result.connectedPeers?.length || 0} connected — ${JSON.stringify(result.connectedPeers)}`)
    }

    // Second pass for stragglers (answer side may need to process)
    await new Promise(r => setTimeout(r, 1000))
    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-pex-webrtc-pair.mjs')
      console.log(`  [webrtc pass 2] ${session}: ${result.connectedPeers?.length || 0} connected`)
    }

    // Verify alpha has exactly 1 WebRTC connection (to beta)
    const alphaResult = await runScript('alpha', 'step-pex-check-discovery.mjs')
    assert.equal(alphaResult.rtcConnections.length, 1, 'alpha should have 1 WebRTC connection (beta)')

    // Verify beta has 2 WebRTC connections (alpha + gamma)
    const betaResult = await runScript('beta', 'step-pex-check-discovery.mjs')
    assert.equal(betaResult.rtcConnections.length, 2, 'beta should have 2 WebRTC connections')

    // Verify gamma has exactly 1 WebRTC connection (to beta)
    const gammaResult = await runScript('gamma', 'step-pex-check-discovery.mjs')
    assert.equal(gammaResult.rtcConnections.length, 1, 'gamma should have 1 WebRTC connection (beta)')
  })

  // ── 4. Wire PEX on all 3 nodes ──────────────────────────────────

  it('wires PexStrategy on all 3 nodes', async () => {
    // Wire PEX on all 3 nodes — this creates PexStrategy, registers
    // connected WebRTC peers, and triggers initial exchange
    for (const session of SESSIONS) {
      const result = await runScript(session, 'step-pex-wire.mjs')
      console.log(`  [pex] ${session}: known=${result.knownPeers?.length}, connected=${result.connectedCount}`)
      assert.ok(result.connectedCount >= 1, `${session} PEX should have >= 1 connected peer`)
    }

    // Beta knows both alpha and gamma, so its PEX exchange should
    // propagate gamma to alpha and alpha to gamma.
    // Give PEX exchanges time to propagate through WebRTC messages.
    await new Promise(r => setTimeout(r, 2000))
  })

  // ── 5. Transitive discovery ──────────────────────────────────────

  it('alpha discovers gamma transitively through beta PEX exchange', async () => {
    const gammaPodId = podIds.gamma

    // Poll alpha until it discovers gamma via PEX
    const result = await waitFor(async () => {
      const check = await runScript('alpha', 'step-pex-check-discovery.mjs')
      console.log(`  [pex poll] alpha pexDiscovered: ${check.pexDiscovered}, sigPeers: ${check.sigPeers}`)

      // Gamma must appear in PEX discovered list
      const foundGamma = check.pexDiscoveredFull.includes(gammaPodId)
      if (foundGamma) return check
      return null
    }, { timeout: 20000, interval: 1000, label: 'alpha discovers gamma via PEX' })

    // Verify gamma was NOT in alpha's signaling peers
    assert.ok(
      !result.sigPeersFull.includes(gammaPodId),
      'gamma should NOT be in alpha signaling peers'
    )

    // Verify gamma IS in alpha's PEX discovered list
    assert.ok(
      result.pexDiscoveredFull.includes(gammaPodId),
      'gamma SHOULD be in alpha PEX discovered list'
    )

    console.log(`  [pex] SUCCESS: alpha discovered gamma (${gammaPodId.slice(0, 12)}) transitively through beta`)
  })

  it('gamma discovers alpha transitively through beta PEX exchange', async () => {
    const alphaPodId = podIds.alpha

    // Poll gamma until it discovers alpha via PEX
    const result = await waitFor(async () => {
      const check = await runScript('gamma', 'step-pex-check-discovery.mjs')
      console.log(`  [pex poll] gamma pexDiscovered: ${check.pexDiscovered}, sigPeers: ${check.sigPeers}`)

      const foundAlpha = check.pexDiscoveredFull.includes(alphaPodId)
      if (foundAlpha) return check
      return null
    }, { timeout: 20000, interval: 1000, label: 'gamma discovers alpha via PEX' })

    // Verify alpha was NOT in gamma's signaling peers
    assert.ok(
      !result.sigPeersFull.includes(alphaPodId),
      'alpha should NOT be in gamma signaling peers'
    )

    // Verify alpha IS in gamma's PEX discovered list
    assert.ok(
      result.pexDiscoveredFull.includes(alphaPodId),
      'alpha SHOULD be in gamma PEX discovered list'
    )

    console.log(`  [pex] SUCCESS: gamma discovered alpha (${alphaPodId.slice(0, 12)}) transitively through beta`)
  })
})
