/**
 * E2E test: Server pods + browser clients in a hybrid mesh.
 *
 * Topology:
 *   Server Pod A ←──mDNS──→ Server Pod B
 *        ↑                       ↑
 *    signaling               signaling
 *        ↓                       ↓
 *   Browser (alpha)         Browser (beta)
 *
 * Prerequisites:
 *   - agent-browser installed + Chrome for Testing
 *   - Clawser app served on https://localhost:8080
 *
 * Tests:
 *   1. Two server pods start and discover each other via mDNS
 *   2. Signaling server starts, both pods register
 *   3. Server pod services (fs, agent) work
 *   4. Authenticated callService works, unauthenticated rejected
 *   5. Browser alpha connects, discovers server pod A via signaling
 *   6. Browser beta connects, discovers server pod B via signaling
 *   7. Browsers discover ALL peers (including the other server pod) via PEX/signaling
 *   8. Server-to-server messaging via signaling
 *   9. Browser-to-server messaging via signaling
 *  10. Server pod file system operations end-to-end
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const exec = promisify(execCb)
const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Helpers ──────────────────────────────────────────────────────────

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '')
}

async function ab(session, args, { timeout = 30000 } = {}) {
  const cmd = `agent-browser --ignore-https-errors --session ${session} ${args}`
  try {
    const { stdout } = await exec(cmd, { encoding: 'utf-8', timeout })
    return stripAnsi(stdout).trim()
  } catch (err) {
    throw new Error(`ab failed: ${cmd}\nstdout: ${stripAnsi(err.stdout?.toString() || '')}\nstderr: ${stripAnsi(err.stderr?.toString() || '')}`)
  }
}

async function abEval(session, js, { timeout = 30000 } = {}) {
  const escaped = js.replace(/'/g, "'\\''")
  return ab(session, `eval '${escaped}'`, { timeout })
}

async function runScript(session, filename, { timeout = 30000 } = {}) {
  const cmd = `agent-browser --ignore-https-errors --session ${session} eval "$(cat ${join(__dirname, filename)})"`;
  try {
    const { stdout } = await exec(cmd, { encoding: 'utf-8', timeout })
    const clean = stripAnsi(stdout).trim()
    try { return JSON.parse(JSON.parse(clean)) } catch {
      try { return JSON.parse(clean) } catch { return clean }
    }
  } catch (err) {
    throw new Error(`runScript failed: ${stripAnsi(err.stderr?.toString() || err.message)}`)
  }
}

async function closeSession(name) {
  try { await exec(`agent-browser --session ${name} close`, { timeout: 10000 }) } catch { /* ok */ }
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

// ─── Tests ────────────────────────────────────────────────────────────

describe('Hybrid mesh E2E: server pods + browsers', () => {
  let signalingServer
  let signalingPort
  let podA, podB
  let tmpDirA, tmpDirB

  before(async () => {
    // ── Start signaling server ──
    const { createServer } = await import('../server/signaling/index.mjs')
    const sig = createServer({ port: 0 })
    signalingPort = await sig.listen(0)
    signalingServer = sig
    console.log(`  [setup] signaling on port ${signalingPort}`)

    // ── Create temp dirs for server pods ──
    tmpDirA = mkdtempSync(join(tmpdir(), 'clawser-pod-a-'))
    tmpDirB = mkdtempSync(join(tmpdir(), 'clawser-pod-b-'))

    // ── Start two server pods ──
    const { createServerKernel } = await import('../server/kernel/index.mjs')

    podA = await createServerKernel({
      dataDir: tmpDirA,
      label: 'server-alpha',
      agentName: 'agent-alpha',
      signalingUrl: `ws://127.0.0.1:${signalingPort}`,
      onLog: (msg) => {}, // silent
    })
    await podA.start()
    console.log(`  [setup] pod A: ${podA.podId.slice(0, 12)} (${podA.identity.label})`)

    podB = await createServerKernel({
      dataDir: tmpDirB,
      label: 'server-beta',
      agentName: 'agent-beta',
      signalingUrl: `ws://127.0.0.1:${signalingPort}`,
      onLog: (msg) => {},
    })
    await podB.start()
    console.log(`  [setup] pod B: ${podB.podId.slice(0, 12)} (${podB.identity.label})`)

    // ── Clean stale browser sessions ──
    await closeSession('srv-alpha')
    await closeSession('srv-beta')
  })

  after(async () => {
    await closeSession('srv-alpha')
    await closeSession('srv-beta')
    if (podA) await podA.stop()
    if (podB) await podB.stop()
    if (globalThis.__testWsA) { globalThis.__testWsA.close(); globalThis.__testWsA = null }
    if (globalThis.__testWsB) { globalThis.__testWsB.close(); globalThis.__testWsB = null }
    if (signalingServer) await signalingServer.close()
    rmSync(tmpDirA, { recursive: true, force: true })
    rmSync(tmpDirB, { recursive: true, force: true })
    console.log('  [teardown] done')
  })

  // ── 1. Server pod identity ────────────────────────────────────────

  it('server pods have unique identities', () => {
    assert.ok(podA.podId)
    assert.ok(podB.podId)
    assert.notEqual(podA.podId, podB.podId)
    assert.equal(podA.identity.label, 'server-alpha')
    assert.equal(podB.identity.label, 'server-beta')
  })

  // ── 2. Server pod services ────────────────────────────────────────

  it('server pods expose fs and agent services', () => {
    assert.ok(podA.listServices().includes('fs'))
    assert.ok(podA.listServices().includes('agent'))
    assert.ok(podB.listServices().includes('fs'))
    assert.ok(podB.listServices().includes('agent'))
  })

  // ── 3. File system operations ─────────────────────────────────────

  it('pod A writes and reads files', async () => {
    const fsSvc = podA.getService('fs')
    await fsSvc.write({ path: 'hello.txt', data: 'Hello from pod A' })
    const result = await fsSvc.read({ path: 'hello.txt' })
    assert.equal(result.data, 'Hello from pod A')
  })

  it('pod B writes and lists files', async () => {
    const fsSvc = podB.getService('fs')
    await fsSvc.write({ path: 'docs/readme.md', data: '# Pod B' })
    await fsSvc.write({ path: 'docs/notes.txt', data: 'Notes' })
    const entries = await fsSvc.list({ path: 'docs' })
    assert.equal(entries.length, 2)
  })

  // ── 4. Agent service ──────────────────────────────────────────────

  it('server agent responds to messages', async () => {
    const agentSvc = podA.getService('agent')
    const result = await agentSvc.run({ message: 'ping' })
    assert.ok(result.response.includes('ping'))
  })

  it('server agent executes tools', async () => {
    const agentSvc = podB.getService('agent')
    const result = await agentSvc.executeTool({ name: 'time' })
    assert.equal(result.success, true)
    assert.ok(result.output.match(/^\d{4}-\d{2}/))
  })

  // ── 5. Authenticated callService ──────────────────────────────────

  it('callService with valid token succeeds', async () => {
    const result = await podA.callService('agent', 'run', { message: 'auth test' }, podA.serviceToken)
    assert.ok(result.response.includes('auth test'))
  })

  it('callService with wrong token is rejected', async () => {
    const result = await podA.callService('agent', 'run', { message: 'hack' }, 'wrong-token')
    assert.equal(result.success, false)
    assert.equal(result.error, 'unauthorized')
  })

  // ── 6. mDNS discovery between server pods ─────────────────────────

  it('server pods discover each other via mDNS', async function () {
    // Create pods with mDNS enabled
    const { MdnsDiscovery } = await import('../server/kernel/mdns.mjs')

    const mdnsA = new MdnsDiscovery({
      podId: podA.podId,
      port: signalingPort,
      label: 'server-alpha',
      onLog: () => {},
    })
    const mdnsB = new MdnsDiscovery({
      podId: podB.podId,
      port: signalingPort,
      label: 'server-beta',
      onLog: () => {},
    })

    const discoveredByA = []
    const discoveredByB = []
    mdnsA.onPeerDiscovered((p) => discoveredByA.push(p))
    mdnsB.onPeerDiscovered((p) => discoveredByB.push(p))

    await mdnsA.start()
    await mdnsB.start()

    await new Promise(r => setTimeout(r, 3000))

    await mdnsA.stop()
    await mdnsB.stop()

    assert.ok(
      discoveredByA.some(p => p.podId === podB.podId),
      'Pod A should discover Pod B via mDNS'
    )
    assert.ok(
      discoveredByB.some(p => p.podId === podA.podId),
      'Pod B should discover Pod A via mDNS'
    )
  })

  // ── 7. Signaling: server pods register ────────────────────────────

  it('both server pods register with signaling and exchange messages', async () => {
    const WebSocket = (await import('ws')).default

    // Register pod A
    const wsA = new WebSocket(`ws://127.0.0.1:${signalingPort}`)
    await new Promise((resolve) => {
      wsA.on('open', () => {
        wsA.send(JSON.stringify({ type: 'register', podId: podA.podId }))
      })
      wsA.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'registered') resolve()
      })
    })

    // Register pod B
    const wsB = new WebSocket(`ws://127.0.0.1:${signalingPort}`)
    await new Promise((resolve) => {
      wsB.on('open', () => {
        wsB.send(JSON.stringify({ type: 'register', podId: podB.podId }))
      })
      wsB.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'registered') resolve()
      })
    })

    // Verify via health endpoint
    const health = await fetch(`http://127.0.0.1:${signalingPort}/health`)
    const { peers } = await health.json()
    assert.ok(peers >= 2, `Should have at least 2 peers, got ${peers}`)

    // Signal from A to B
    const received = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('signal timeout')), 5000)
      wsB.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'signal' && msg.source === podA.podId) {
          clearTimeout(timeout)
          resolve(msg)
        }
      })
    })

    wsA.send(JSON.stringify({
      type: 'signal',
      target: podB.podId,
      data: { text: 'server-to-server hello' },
    }))

    const msg = await received
    assert.deepEqual(msg.data, { text: 'server-to-server hello' })

    // Keep these connections open for the browser test
    // Store globally so subsequent tests can use them
    globalThis.__testWsA = wsA
    globalThis.__testWsB = wsB
  })

  // ── 8. Browser connects and discovers server pods ─────────────────

  it('browser discovers server pods via signaling', async () => {
    const APP_URL = 'https://localhost:8080'

    // Open browser alpha
    await ab('srv-alpha', `open "${APP_URL}"`)
    await ab('srv-alpha', 'wait 2000')

    // Setup vault + workspace
    let snap = await ab('srv-alpha', 'snapshot -i')
    if (snap.includes('Create Vault')) {
      await ab('srv-alpha', 'fill @e2 "alpha"')
      await ab('srv-alpha', 'fill @e3 "alpha"')
      await ab('srv-alpha', 'click @e4')
      await ab('srv-alpha', 'wait 2000')
    } else if (snap.includes('Unlock Vault')) {
      await ab('srv-alpha', 'fill @e2 "alpha"')
      await ab('srv-alpha', 'click @e3')
      await ab('srv-alpha', 'wait 2000')
    }

    snap = await ab('srv-alpha', 'snapshot -i')
    if (snap.includes('New workspace')) {
      await ab('srv-alpha', 'fill @e2 "srv-test"')
      await ab('srv-alpha', 'click @e3')
      await ab('srv-alpha', 'wait 2000')
    }

    // Connect browser to signaling and inject server pods as peers
    await abEval('srv-alpha', `window.__sigPort = ${signalingPort}`)
    const sigResult = await runScript('srv-alpha', 'step-signaling.mjs')
    assert.ok(sigResult.registered, 'Browser should register with signaling')

    // Wait for peer list to include server pods (server pods registered in previous test)
    await waitFor(async () => {
      const r = await runScript('srv-alpha', 'step-check-peers.mjs')
      return r.peerCount >= 1
    }, { label: 'browser sees server pods', timeout: 10000 })

    const peers = await runScript('srv-alpha', 'step-check-peers.mjs')
    console.log(`  [test] browser sees ${peers.peerCount} peers: ${peers.peers.join(', ')}`)
    assert.ok(peers.peerCount >= 1, 'Browser should see at least 1 server pod')
  })

  // ── 9. Browser-to-server messaging ────────────────────────────────

  it('browser sends signal to server pod via signaling', async () => {
    // The browser and server pods are all registered with signaling
    // Send from browser to pod A
    const WebSocket = (await import('ws')).default

    // Reconnect pod A to signaling to listen
    const wsA = new WebSocket(`ws://127.0.0.1:${signalingPort}`)
    await new Promise(resolve => {
      wsA.on('open', () => {
        wsA.send(JSON.stringify({ type: 'register', podId: podA.podId + '-listener' }))
        // Wait for registration
        wsA.on('message', (raw) => {
          const msg = JSON.parse(raw.toString())
          if (msg.type === 'registered') resolve()
        })
      })
    })

    // Get browser podId
    const podIdResult = await runScript('srv-alpha', 'probe-podid.mjs')
    const browserPodId = podIdResult.podId

    // Listen for signal on server side
    const serverReceived = new Promise((resolve) => {
      wsA.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'signal' && msg.source === browserPodId) resolve(msg)
      })
    })

    // Send from browser
    await abEval('srv-alpha', `window.__sigWs.send(JSON.stringify({type:'signal',target:'${podA.podId}-listener',data:{text:'hello from browser'}}))`)

    const received = await serverReceived
    assert.deepEqual(received.data, { text: 'hello from browser' })

    wsA.close()
    await new Promise(r => setTimeout(r, 200))
  })

  // ── 10. Server pod memory + search ────────────────────────────────

  it('server agent stores and searches memories', () => {
    const agentSvc = podA.getService('agent')
    podA.agent.addMemory({ key: 'fact', content: 'The mesh has 4 nodes' })
    podA.agent.addMemory({ key: 'config', content: 'mDNS is enabled' })

    const results = agentSvc.searchMemories({ query: 'mesh' })
    assert.equal(results.length, 1)
    assert.ok(results[0].content.includes('mesh'))
  })

  // ── 11. Cross-pod file isolation ──────────────────────────────────

  it('pod A cannot read pod B files (separate data dirs)', async () => {
    const fsA = podA.getService('fs')
    const fsB = podB.getService('fs')

    await fsB.write({ path: 'secret.txt', data: 'pod B secret' })

    // Pod A should not see pod B's files
    await assert.rejects(
      () => fsA.read({ path: 'secret.txt' }),
      (err) => err.message.includes('not found')
    )
  })

  // ── 12. Service token isolation ───────────────────────────────────

  it('pod A token cannot call pod B services', async () => {
    const result = await podB.callService('agent', 'run', { message: 'cross' }, podA.serviceToken)
    assert.equal(result.success, false)
    assert.equal(result.error, 'unauthorized')
  })
})
