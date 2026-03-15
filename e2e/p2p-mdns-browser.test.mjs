/**
 * E2E test: mDNS -> signaling -> browser discovery flow.
 *
 * Topology:
 *   Server Pod A <--mDNS--> Server Pod B
 *        |                       |
 *    signaling               signaling
 *        |                       |
 *        +--- Browser (alpha) ---+
 *
 * Flow:
 *   1. Start signaling server on ephemeral port
 *   2. Create 2 server pods (PeerNodeServer)
 *   3. Start mDNS on both pods
 *   4. Pods discover each other via mDNS
 *   5. Both pods register with signaling via WebSocket
 *   6. Open browser, set up vault + workspace
 *   7. Browser connects to signaling
 *   8. Browser discovers BOTH server pods via signaling peer list
 *
 * Prerequisites:
 *   - agent-browser installed + Chrome for Testing
 *   - Clawser app served on https://localhost:8080
 *   - multicast-dns npm package installed (server/kernel dependency)
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const exec = promisify(execCb)
const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Config ──────────────────────────────────────────────────────────

const APP_URL = 'https://localhost:8080'
const SESSION = 'mdns-alpha'
const PASSWORD = 'mdns-alpha'
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

describe('mDNS -> signaling -> browser discovery E2E', () => {
  let signalingServer
  let signalingPort
  let podA, podB
  let tmpDirA, tmpDirB
  let mdnsA, mdnsB
  let wsA, wsB

  before(async () => {
    // ── Start signaling server on ephemeral port ──
    const { createServer } = await import('../server/signaling/index.mjs')
    const sig = createServer({ port: 0 })
    signalingPort = await sig.listen(0)
    signalingServer = sig
    console.log(`  [setup] signaling on port ${signalingPort}`)

    // ── Create temp dirs for server pods ──
    tmpDirA = mkdtempSync(join(tmpdir(), 'clawser-mdns-a-'))
    tmpDirB = mkdtempSync(join(tmpdir(), 'clawser-mdns-b-'))

    // ── Create two server pods ──
    const { createServerKernel } = await import('../server/kernel/index.mjs')

    podA = await createServerKernel({
      dataDir: tmpDirA,
      label: 'mdns-alpha',
      agentName: 'agent-mdns-a',
      signalingUrl: `ws://127.0.0.1:${signalingPort}`,
      onLog: () => {},
    })
    await podA.start()
    console.log(`  [setup] pod A: ${podA.podId.slice(0, 12)} (${podA.identity.label})`)

    podB = await createServerKernel({
      dataDir: tmpDirB,
      label: 'mdns-beta',
      agentName: 'agent-mdns-b',
      signalingUrl: `ws://127.0.0.1:${signalingPort}`,
      onLog: () => {},
    })
    await podB.start()
    console.log(`  [setup] pod B: ${podB.podId.slice(0, 12)} (${podB.identity.label})`)

    // ── Clean stale browser session ──
    await closeSession(SESSION)
  })

  after(async () => {
    await closeSession(SESSION)
    if (mdnsA) await mdnsA.stop()
    if (mdnsB) await mdnsB.stop()
    if (wsA) { wsA.close(); wsA = null }
    if (wsB) { wsB.close(); wsB = null }
    if (podA) await podA.stop()
    if (podB) await podB.stop()
    if (signalingServer) await signalingServer.close()
    rmSync(tmpDirA, { recursive: true, force: true })
    rmSync(tmpDirB, { recursive: true, force: true })
    console.log('  [teardown] done')
  })

  // ── 1. Server pods have distinct identities ─────────────────────────

  it('server pods have unique identities', () => {
    assert.ok(podA.podId, 'pod A should have a podId')
    assert.ok(podB.podId, 'pod B should have a podId')
    assert.notEqual(podA.podId, podB.podId, 'pod IDs should differ')
    assert.equal(podA.identity.label, 'mdns-alpha')
    assert.equal(podB.identity.label, 'mdns-beta')
  })

  // ── 2. mDNS discovery between server pods ──────────────────────────

  it('server pods discover each other via mDNS', async () => {
    const { MdnsDiscovery } = await import('../server/kernel/mdns.mjs')

    mdnsA = new MdnsDiscovery({
      podId: podA.podId,
      port: signalingPort,
      label: 'mdns-alpha',
      onLog: (msg) => console.log(`  [mdns-a] ${msg}`),
    })
    mdnsB = new MdnsDiscovery({
      podId: podB.podId,
      port: signalingPort,
      label: 'mdns-beta',
      onLog: (msg) => console.log(`  [mdns-b] ${msg}`),
    })

    const discoveredByA = []
    const discoveredByB = []
    mdnsA.onPeerDiscovered((p) => discoveredByA.push(p))
    mdnsB.onPeerDiscovered((p) => discoveredByB.push(p))

    await mdnsA.start()
    await mdnsB.start()

    // Wait for mutual discovery (mDNS responses take a moment)
    await waitFor(() => {
      return discoveredByA.some(p => p.podId === podB.podId) &&
             discoveredByB.some(p => p.podId === podA.podId)
    }, { timeout: 10000, interval: 500, label: 'mDNS mutual discovery' })

    assert.ok(
      discoveredByA.some(p => p.podId === podB.podId),
      'Pod A should discover Pod B via mDNS'
    )
    assert.ok(
      discoveredByB.some(p => p.podId === podA.podId),
      'Pod B should discover Pod A via mDNS'
    )

    console.log(`  [mdns] A discovered ${discoveredByA.length} peer(s), B discovered ${discoveredByB.length} peer(s)`)
  })

  // ── 3. Both pods register with signaling ───────────────────────────

  it('both mDNS-discovered pods register with signaling', async () => {
    const WebSocket = (await import('ws')).default

    // Register pod A with signaling
    wsA = new WebSocket(`ws://127.0.0.1:${signalingPort}`)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('wsA register timeout')), 5000)
      wsA.on('open', () => {
        wsA.send(JSON.stringify({ type: 'register', podId: podA.podId }))
      })
      wsA.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'registered') {
          clearTimeout(timer)
          resolve()
        }
      })
      wsA.on('error', (err) => { clearTimeout(timer); reject(err) })
    })
    console.log(`  [signaling] pod A registered: ${podA.podId.slice(0, 12)}`)

    // Register pod B with signaling
    wsB = new WebSocket(`ws://127.0.0.1:${signalingPort}`)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('wsB register timeout')), 5000)
      wsB.on('open', () => {
        wsB.send(JSON.stringify({ type: 'register', podId: podB.podId }))
      })
      wsB.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'registered') {
          clearTimeout(timer)
          resolve()
        }
      })
      wsB.on('error', (err) => { clearTimeout(timer); reject(err) })
    })
    console.log(`  [signaling] pod B registered: ${podB.podId.slice(0, 12)}`)

    // Verify both are listed via the health endpoint
    const health = await fetch(`http://127.0.0.1:${signalingPort}/health`)
    const { peers } = await health.json()
    assert.ok(peers >= 2, `Signaling should have at least 2 peers, got ${peers}`)
    console.log(`  [signaling] ${peers} peer(s) registered`)
  })

  // ── 4. Open browser, set up vault + workspace ──────────────────────

  it('sets up vault and workspace in browser', async () => {
    // Open browser
    await ab(SESSION, `open "${APP_URL}"`)
    await ab(SESSION, 'wait 2000')

    // Create or unlock vault
    let snap = await ab(SESSION, 'snapshot -i')
    if (snap.includes('Create Vault')) {
      await ab(SESSION, `fill @e2 "${PASSWORD}"`)
      await ab(SESSION, `fill @e3 "${PASSWORD}"`)
      await ab(SESSION, 'click @e4')
      await ab(SESSION, 'wait 2000')
    } else if (snap.includes('Unlock Vault')) {
      await ab(SESSION, `fill @e2 "${PASSWORD}"`)
      await ab(SESSION, 'click @e3')
      await ab(SESSION, 'wait 2000')
    }

    // Create workspace if needed
    snap = await ab(SESSION, 'snapshot -i')
    if (snap.includes('New workspace')) {
      await ab(SESSION, `fill @e2 "mdns-e2e-test"`)
      await ab(SESSION, 'click @e3')
      await ab(SESSION, 'wait 2000')
    }

    // Verify we are in the workspace
    snap = await ab(SESSION, 'snapshot -i')
    assert.ok(snap.includes('panel'), 'Browser should be in workspace view')
    console.log('  [browser] vault + workspace ready')
  })

  // ── 5. Browser connects to signaling ───────────────────────────────

  it('browser connects to signaling and registers', async () => {
    await abEval(SESSION, `window.__sigPort = ${signalingPort}`)
    const result = await runScript(SESSION, 'step-signaling.mjs')
    assert.ok(result.registered, 'Browser should register with signaling')
    console.log('  [browser] registered with signaling')
  })

  // ── 6. Browser discovers BOTH mDNS-discovered server pods ──────────

  it('browser discovers both server pods via signaling peer list', async () => {
    // Both server pods were registered in test 3 and discovered each
    // other via mDNS in test 2. Now the browser should see them both
    // in the signaling peer list.
    const peerResult = await waitFor(async () => {
      const r = await runScript(SESSION, 'step-check-peers.mjs')
      // Browser should see at least 2 peers (podA + podB)
      return r.peerCount >= 2 ? r : null
    }, { timeout: 15000, interval: 1000, label: 'browser sees both server pods' })

    console.log(`  [browser] sees ${peerResult.peerCount} peer(s): ${peerResult.peers.join(', ')}`)

    assert.ok(
      peerResult.peerCount >= 2,
      `Browser should see at least 2 peers (both server pods), got ${peerResult.peerCount}`
    )

    // Verify both specific server pod IDs appear in the peer list
    // step-check-peers returns truncated (12-char) pod IDs
    const podAPrefix = podA.podId.slice(0, 12)
    const podBPrefix = podB.podId.slice(0, 12)

    assert.ok(
      peerResult.peers.some(p => p === podAPrefix),
      `Browser should see pod A (${podAPrefix}) in peer list, got: ${peerResult.peers.join(', ')}`
    )
    assert.ok(
      peerResult.peers.some(p => p === podBPrefix),
      `Browser should see pod B (${podBPrefix}) in peer list, got: ${peerResult.peers.join(', ')}`
    )

    console.log('  [result] browser discovered both mDNS-discovered server pods via signaling')
  })
})
