// clawser-pod.js — ClawserPod: full agent workspace pod
//
// Extends Pod with mesh networking (PeerNode, SwarmCoordinator, etc.)
// Used by clawser-workspace-lifecycle.js to initialize the mesh subsystem.

import { Pod } from './packages/pod/src/pod.mjs'
import { MeshIdentityManager } from './clawser-mesh-identity.js'
import { IdentityWallet } from './clawser-identity-wallet.js'
import { PeerRegistry } from './clawser-peer-registry.js'
import { PeerNode } from './clawser-peer-node.js'
import { SwarmCoordinator } from './clawser-mesh-swarm.js'

export class ClawserPod extends Pod {
  #peerNode = null
  #swarmCoordinator = null
  #wallet = null
  #registry = null

  get peerNode() { return this.#peerNode }
  get swarmCoordinator() { return this.#swarmCoordinator }
  get wallet() { return this.#wallet }
  get registry() { return this.#registry }

  /**
   * Initialize the full mesh subsystem on top of the Pod's identity.
   * Creates MeshIdentityManager, IdentityWallet (imports Pod's identity),
   * PeerRegistry, PeerNode, and SwarmCoordinator.
   *
   * @param {object} [opts]
   * @returns {Promise<{ peerNode: PeerNode, swarmCoordinator: SwarmCoordinator }>}
   */
  async initMesh(opts = {}) {
    // Tear down existing peer node if running
    if (this.#peerNode && this.#peerNode.state === 'running') {
      await this.#peerNode.shutdown()
    }

    // 1. Identity manager (mesh-level)
    const meshIdMgr = new MeshIdentityManager()

    // 2. Identity wallet — create identity eagerly so we have a podId
    this.#wallet = new IdentityWallet({ identityManager: meshIdMgr })
    await this.#wallet.createIdentity('default')
    const defaultId = this.#wallet.getDefault()
    const podId = defaultId?.podId || this.podId || 'local'

    // 3. Peer registry with real podId
    this.#registry = new PeerRegistry({ localPodId: podId })

    // 4. PeerNode orchestrator
    this.#peerNode = new PeerNode({ wallet: this.#wallet, registry: this.#registry })
    await this.#peerNode.boot({ label: 'default' })

    // 5. SwarmCoordinator
    this.#swarmCoordinator = new SwarmCoordinator(podId)

    return { peerNode: this.#peerNode, swarmCoordinator: this.#swarmCoordinator }
  }

  _onMessage(msg) {
    // Forward pod-level messages as events
    // Listeners can subscribe via pod.on('pod:message', ...)
  }

  async shutdown(opts = {}) {
    if (this.#peerNode && this.#peerNode.state === 'running') {
      try { await this.#peerNode.shutdown() } catch { /* non-fatal */ }
    }
    this.#peerNode = null
    this.#swarmCoordinator = null
    this.#wallet = null
    this.#registry = null
    await super.shutdown(opts)
  }
}
