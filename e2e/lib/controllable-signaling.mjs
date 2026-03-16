/**
 * controllable-signaling.mjs — Wraps the signaling server's forwarding
 * with delay/drop/partition hooks for E2E consensus tests.
 *
 * Instead of modifying the signaling server itself, this module creates
 * a proxy WebSocket server that sits between test browsers and the real
 * signaling server, intercepting and manipulating forwarded messages.
 */

import { WebSocketServer, WebSocket } from 'ws'

/**
 * @typedef {object} FaultConfig
 * @property {number} [delayMs=0] - Delay all forwarded messages by this many ms
 * @property {number} [dropRate=0] - Probability of dropping a message (0-1)
 * @property {Set<string>} [partitionedPods] - Pod IDs that are isolated
 */

export class ControllableSignaling {
  #upstream
  #wss
  #faults = {
    delayMs: 0,
    dropRate: 0,
    partitionedPods: new Set(),
  }
  #connections = new Map() // podId → { client, upstream }

  /**
   * @param {object} opts
   * @param {number} opts.proxyPort - Port for the proxy to listen on
   * @param {string} opts.upstreamUrl - URL of the real signaling server
   */
  constructor(opts) {
    this.#upstream = opts.upstreamUrl
    this.#wss = new WebSocketServer({ port: opts.proxyPort })

    this.#wss.on('connection', (clientWs) => {
      const upstreamWs = new WebSocket(this.#upstream)
      let podId = null

      upstreamWs.on('open', () => {
        // Forward all client messages to upstream, with fault injection
        clientWs.on('message', (data) => {
          const msg = JSON.parse(data.toString())

          // Track pod registration
          if (msg.type === 'register') {
            podId = msg.podId
            this.#connections.set(podId, { client: clientWs, upstream: upstreamWs })
          }

          // Check partition
          if (podId && this.#faults.partitionedPods.has(podId)) {
            return // Drop silently
          }

          // Check drop
          if (Math.random() < this.#faults.dropRate) {
            return // Drop
          }

          // Apply delay
          const delay = this.#faults.delayMs
          if (delay > 0) {
            setTimeout(() => {
              if (upstreamWs.readyState === WebSocket.OPEN) {
                upstreamWs.send(data.toString())
              }
            }, delay)
          } else {
            upstreamWs.send(data.toString())
          }
        })
      })

      // Forward upstream responses to client (also with fault injection)
      upstreamWs.on('message', (data) => {
        if (podId && this.#faults.partitionedPods.has(podId)) {
          return
        }

        const delay = this.#faults.delayMs
        if (delay > 0) {
          setTimeout(() => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(data.toString())
            }
          }, delay)
        } else {
          clientWs.send(data.toString())
        }
      })

      clientWs.on('close', () => {
        if (podId) this.#connections.delete(podId)
        upstreamWs.close()
      })

      upstreamWs.on('close', () => {
        clientWs.close()
      })
    })
  }

  /** Set the forwarding delay in ms. */
  setDelay(ms) {
    this.#faults.delayMs = ms
  }

  /** Set the message drop rate (0-1). */
  setDropRate(rate) {
    this.#faults.dropRate = rate
  }

  /** Partition a pod — all its messages are dropped. */
  partitionPod(podId) {
    this.#faults.partitionedPods.add(podId)
  }

  /** Heal a partition for a pod. */
  healPod(podId) {
    this.#faults.partitionedPods.delete(podId)
  }

  /** Heal all partitions. */
  healAll() {
    this.#faults.partitionedPods.clear()
    this.#faults.delayMs = 0
    this.#faults.dropRate = 0
  }

  /** Shut down the proxy. */
  async close() {
    for (const { client, upstream } of this.#connections.values()) {
      client.close()
      upstream.close()
    }
    this.#connections.clear()
    return new Promise((resolve) => this.#wss.close(resolve))
  }
}
