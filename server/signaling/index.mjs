/**
 * Clawser P2P Mesh — WebSocket Signaling Server
 *
 * Adapted from the webrtc-chat server pattern but uses podId-based
 * registration instead of URL params.
 *
 * Protocol:
 *   1. Client connects via WebSocket
 *   2. Client sends: { type: 'register', podId: '<unique-id>' }
 *   3. Server confirms: { type: 'registered', podId }
 *   4. Server broadcasts: { type: 'peers', peers: [...] }
 *   5. Client sends signaling messages:
 *        { type: 'offer'|'answer'|'ice-candidate'|'signal', target: '<podId>', ...payload }
 *   6. Server forwards to target with `source` field injected
 *   7. On disconnect, server broadcasts: { type: 'disconnected', podId }
 *
 * HTTP endpoints:
 *   GET /health      → { status: 'ok', peers: N }
 *   GET /ice-servers  → ICE server configuration array
 *
 * Env vars:
 *   PORT        — listen port (default 8787)
 *   ORIGINS     — comma-separated allowed origins (empty = allow all)
 *   AUTH_MODE   — 'open' (default) | 'authenticated' (stub)
 *   ICE_SERVERS — JSON array override for ICE config
 */

import http from 'node:http'
import { WebSocketServer } from 'ws'
import { getIceServers } from './stun-turn.mjs'

// ─── Helpers ──────────────────────────────────────────────────────────

function send(ws, data) {
  if (ws.readyState === 1 /* OPEN */) {
    ws.send(JSON.stringify(data))
  }
}

function parseOrigins(raw) {
  if (!raw) return null
  return raw.split(',').map(o => o.trim()).filter(Boolean)
}

function originAllowed(origin, allowedOrigins) {
  if (!allowedOrigins) return true
  if (!origin) return false
  return allowedOrigins.includes(origin)
}

// ─── Signaling message types that get forwarded ──────────────────────

const FORWARDABLE = new Set(['offer', 'answer', 'ice-candidate', 'signal'])

// ─── Server factory ──────────────────────────────────────────────────

/**
 * Create and return the HTTP + WebSocket signaling server.
 *
 * @param {object} [opts]
 * @param {number} [opts.port]       — listen port (default from env or 8787)
 * @param {string} [opts.origins]    — comma-separated allowed origins
 * @param {string} [opts.authMode]   — 'open' | 'authenticated'
 * @param {object} [opts.env]        — environment overrides
 * @returns {{ server: http.Server, wss: WebSocketServer, peers: Map, listen: (port?: number) => Promise<number> }}
 */
export function createServer(opts = {}) {
  const env = opts.env ?? process.env
  const port = opts.port ?? (Number(env.PORT) || 8787)
  const allowedOrigins = parseOrigins(opts.origins ?? env.ORIGINS)
  const authMode = opts.authMode ?? env.AUTH_MODE ?? 'open'
  const iceServers = getIceServers(env)

  /** @type {Map<string, import('ws').WebSocket>} podId → ws */
  const peers = new Map()

  /** @type {Map<import('ws').WebSocket, string>} ws → podId (reverse lookup) */
  const wsBySocket = new Map()

  // ── HTTP server ──────────────────────────────────────────────────

  const server = http.createServer((req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      return res.end()
    }

    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, headers)
      return res.end(JSON.stringify({ status: 'ok', peers: peers.size }))
    }

    if (req.method === 'GET' && req.url === '/ice-servers') {
      res.writeHead(200, headers)
      return res.end(JSON.stringify(iceServers))
    }

    res.writeHead(404, headers)
    res.end(JSON.stringify({ error: 'not found' }))
  })

  // ── WebSocket server ─────────────────────────────────────────────

  const wss = new WebSocketServer({ server })

  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin
    if (!originAllowed(origin, allowedOrigins)) {
      send(ws, { type: 'error', message: 'origin not allowed' })
      ws.close(4403, 'origin not allowed')
      return
    }

    let registered = false
    let podId = null

    // Clients must register within 10 seconds
    const registrationTimeout = setTimeout(() => {
      if (!registered) {
        send(ws, { type: 'error', message: 'registration timeout' })
        ws.close(4408, 'registration timeout')
      }
    }, 10_000)

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        send(ws, { type: 'error', message: 'invalid JSON' })
        return
      }

      // ── Registration ─────────────────────────────────────────────
      if (!registered) {
        if (msg.type !== 'register' || typeof msg.podId !== 'string' || !msg.podId) {
          send(ws, { type: 'error', message: 'first message must be { type: "register", podId: string }' })
          return
        }

        // Auth check (stub for 'authenticated' mode)
        if (authMode === 'authenticated') {
          // Future: verify msg.signature against podId public key
          // For now, fall through and accept like open mode
        }

        // Reject duplicate podId
        if (peers.has(msg.podId)) {
          send(ws, { type: 'error', message: 'podId already registered' })
          ws.close(4409, 'podId already registered')
          clearTimeout(registrationTimeout)
          return
        }

        podId = msg.podId
        registered = true
        clearTimeout(registrationTimeout)

        peers.set(podId, ws)
        wsBySocket.set(ws, podId)

        // Confirm registration
        send(ws, { type: 'registered', podId })

        // Broadcast updated peer list to everyone
        broadcastPeerList()
        return
      }

      // ── Forwarding ───────────────────────────────────────────────
      if (FORWARDABLE.has(msg.type)) {
        const { target, ...payload } = msg
        if (typeof target !== 'string' || !target) {
          send(ws, { type: 'error', message: 'forwarded messages require a "target" field' })
          return
        }

        const targetWs = peers.get(target)
        if (!targetWs) {
          send(ws, { type: 'error', message: `peer "${target}" not found` })
          return
        }

        // Forward with source identification
        send(targetWs, { ...payload, source: podId })
        return
      }

      // ── Ping / keep-alive ────────────────────────────────────────
      if (msg.type === 'ping') {
        send(ws, { type: 'pong', timestamp: Date.now() })
        return
      }

      send(ws, { type: 'error', message: `unknown message type: ${msg.type}` })
    })

    ws.on('close', () => {
      clearTimeout(registrationTimeout)
      if (podId) {
        peers.delete(podId)
        wsBySocket.delete(ws)

        // Notify remaining peers
        broadcast({ type: 'disconnected', podId })
        broadcastPeerList()
      }
    })

    ws.on('error', () => {
      // Let 'close' handle cleanup
    })
  })

  // ── Broadcasting helpers ─────────────────────────────────────────

  function broadcast(data) {
    for (const ws of peers.values()) {
      send(ws, data)
    }
  }

  function broadcastPeerList() {
    const peerList = Array.from(peers.keys())
    broadcast({ type: 'peers', peers: peerList })
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Start listening and return the assigned port.
   * Pass port 0 for an OS-assigned ephemeral port.
   *
   * @param {number} [listenPort]
   * @returns {Promise<number>} — the actual port the server is listening on
   */
  function listen(listenPort) {
    const p = listenPort ?? port
    return new Promise((resolve, reject) => {
      const onError = (err) => reject(err)
      server.once('error', onError)
      server.listen(p, () => {
        server.removeListener('error', onError)
        const addr = server.address()
        resolve(typeof addr === 'object' ? addr.port : p)
      })
    })
  }

  /**
   * Gracefully shut down the server.
   * @returns {Promise<void>}
   */
  function close() {
    return new Promise((resolve) => {
      // Close all WebSocket connections
      for (const ws of peers.values()) {
        ws.close(1001, 'server shutting down')
      }
      peers.clear()
      wsBySocket.clear()

      wss.close(() => {
        server.close(() => resolve())
      })
    })
  }

  return { server, wss, peers, listen, close }
}

// ─── Direct execution ────────────────────────────────────────────────

const isMain = process.argv[1] && (
  process.argv[1].endsWith('/index.mjs') ||
  process.argv[1].endsWith('\\index.mjs')
)

if (isMain) {
  const { listen } = createServer()
  const port = await listen()
  console.log(`[signaling] listening on port ${port}`)
  console.log(`[signaling] auth mode: ${process.env.AUTH_MODE ?? 'open'}`)
  console.log(`[signaling] health check: http://localhost:${port}/health`)
}
