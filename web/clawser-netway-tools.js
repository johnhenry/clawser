/**
 * Clawser netway Browser Tools
 *
 * BrowserTool subclasses for virtual networking: TCP/UDP sockets,
 * listeners, DNS resolution via the netway library.
 */

import { BrowserTool } from './clawser-tools.js';
import { VirtualNetwork, GatewayBackend } from './packages-netway.js';

// ── Shared state ──────────────────────────────────────────────────────

/** @type {VirtualNetwork|null} */
let virtualNetwork = null;

/** @type {Map<string, object>} handle → socket | listener | datagram socket */
const handles = new Map();

/** @type {GatewayBackend|null} */
let remoteRuntimeGatewayBackend = null;

/** @type {BrokerGatewayClient|null} */
let remoteRuntimeGatewayClient = null;

let handleCounter = 0;

/**
 * Generate a unique handle string for a socket, listener, or datagram socket.
 * Handles are used by the agent to reference open network objects across
 * tool calls (e.g. "sock_1", "lstn_3").
 *
 * @param {string} prefix - Short tag for the handle kind ("sock", "lstn", etc.)
 * @returns {string} A unique handle such as "sock_1"
 */
function nextHandle(prefix) {
  return `${prefix}_${++handleCounter}`;
}

/**
 * Return the shared VirtualNetwork singleton, creating it on first access.
 * All netway tools operate against this single instance so that listeners,
 * sockets, and backends are shared within the same page context.
 *
 * @returns {VirtualNetwork}
 */
function getNetwork() {
  if (!virtualNetwork) {
    virtualNetwork = new VirtualNetwork();
  }
  return virtualNetwork;
}

function gatewayCandidateScore(peer, broker) {
  let score = 0;
  if (peer.peerType === 'host') score += 40;
  if (peer.peerType === 'browser-shell') score += 20;
  if (peer.shellBackend === 'pty') score += 20;
  if (peer.shellBackend === 'vm-console') score += 10;
  try {
    const explanation = broker?.explainRoute?.(peer.identity?.canonicalId || peer.identity?.fingerprint, { intent: 'gateway' });
    if (Number.isFinite(explanation?.route?.policy?.scoreAdjustment)) {
      score += explanation.route.policy.scoreAdjustment;
    }
    if (explanation?.route?.kind === 'direct-host') score += 30;
    if (explanation?.route?.kind === 'reverse-relay') score += 20;
    if (explanation?.route?.health === 'online') score += 10;
    if (explanation?.route?.health === 'degraded') score -= 10;
    score -= Number.isFinite(explanation?.health?.failures) ? explanation.health.failures * 5 : 0;
  } catch {
    score -= 50;
  }
  return score;
}

function selectGatewayPeer(broker, selector = null) {
  if (selector) return selector;
  const peers = broker?.listTargets?.({ capability: 'gateway' }) || [];
  if (!peers.length) return null;
  const ranked = [...peers].sort((left, right) => {
    return gatewayCandidateScore(right, broker) - gatewayCandidateScore(left, broker);
  });
  const selected = ranked[0];
  return selected?.identity?.canonicalId || selected?.identity?.fingerprint || null;
}

class BrokerGatewayClient {
  #broker;
  #selector;
  #onLog;
  #auditRecorder;
  #quotaEnforcer;
  #connection = null;
  #connecting = null;

  constructor({ remoteSessionBroker, selector = null, onLog = null, auditRecorder = null, quotaEnforcer = null } = {}) {
    this.#broker = remoteSessionBroker ?? null;
    this.#selector = selector;
    this.#onLog = onLog;
    this.#auditRecorder = auditRecorder ?? null;
    this.#quotaEnforcer = quotaEnforcer ?? null;
    this.onGatewayMessage = null;
  }

  configure({ remoteSessionBroker, selector = null, onLog = null, auditRecorder = null, quotaEnforcer = null } = {}) {
    this.#broker = remoteSessionBroker ?? this.#broker;
    this.#selector = selector ?? this.#selector;
    if (onLog !== null) this.#onLog = onLog;
    if (auditRecorder !== null) this.#auditRecorder = auditRecorder;
    if (quotaEnforcer !== null) this.#quotaEnforcer = quotaEnforcer;
  }

  get state() {
    if (this.#connection?.client?.state) {
      return this.#connection.client.state;
    }
    return this.#broker ? 'authenticated' : 'disconnected';
  }

  async sendControl(msg) {
    const connection = await this.#ensureConnection();
    return connection.client.sendControl(msg);
  }

  async close() {
    const current = this.#connection;
    this.#connection = null;
    this.#connecting = null;
    if (current) {
      await this.#auditRecorder?.record?.('remote_gateway_closed', {
        selector: current.selector,
        routeProvenance: current.routeProvenance || null,
      });
    }
    if (current?.close) {
      await current.close().catch(() => {});
    }
  }

  async #ensureConnection() {
    if (this.#connection?.client?.state === 'authenticated') {
      return this.#connection;
    }
    if (this.#connecting) {
      return this.#connecting;
    }
    this.#connecting = this.#openConnection();
    try {
      const connection = await this.#connecting;
      this.#connection = connection;
      return connection;
    } finally {
      this.#connecting = null;
    }
  }

  async #openConnection() {
    if (!this.#broker) {
      throw new Error('remoteSessionBroker is required for gateway operations');
    }
    const selector = selectGatewayPeer(this.#broker, this.#selector);
    if (!selector) {
      throw new Error('No gateway-capable runtime is available');
    }
    this.#onLog?.(2, `Binding netway gateway to remote runtime ${selector}`);
    try {
      const result = await this.#broker.openSession(selector, {
        intent: 'gateway',
        requiredCapabilities: ['gateway'],
      });
      const client = result?.client;
      if (!client || typeof client.sendControl !== 'function') {
        throw new Error(`Remote gateway target "${selector}" did not provide a WSH client`);
      }
      client.onGatewayMessage = (message) => {
        this.onGatewayMessage?.(message);
      };
      const podId = result?.descriptor?.identity?.podId
        || result?.descriptor?.identity?.fingerprint
        || result?.descriptor?.identity?.canonicalId
        || selector;
      this.#quotaEnforcer?.recordUsage?.(podId, 'jobsPerHour', 1);
      await this.#auditRecorder?.record?.('remote_gateway_bound', {
        selector,
        route: result?.route || null,
        routeProvenance: result?.routeProvenance || deriveGatewayProvenance(result) || null,
      });
      return {
        selector,
        client,
        routeProvenance: result?.routeProvenance || deriveGatewayProvenance(result) || null,
        close: async () => {
          await result?.close?.().catch(() => {});
        },
      };
    } catch (error) {
      await this.#auditRecorder?.record?.('remote_gateway_failed', {
        selector,
        error: error?.message || String(error),
        routeProvenance: error?.details?.routeProvenance || null,
      });
      throw error;
    }
  }
}

// ── netway_connect ────────────────────────────────────────────────────

/**
 * Opens a stream socket to a network address and returns a handle.
 * Supports mem://, loop://, tcp://, and udp:// URI schemes.
 * Requires user approval because it initiates an outbound connection.
 */
export class NetwayConnectTool extends BrowserTool {
  get name() { return 'netway_connect'; }
  get description() {
    return 'Connect to a network address. Returns a socket handle for send/read. Supports mem://, loop://, tcp://, udp:// schemes.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Address to connect to (e.g., "mem://localhost:8080", "tcp://example.com:443")' },
      },
      required: ['address'],
    };
  }
  get permission() { return 'approve'; }

  /**
   * Connect to the given address and store the resulting socket in the
   * shared handle map.
   *
   * @param {object} params
   * @param {string} params.address - URI to connect to (e.g. "mem://localhost:8080")
   * @returns {Promise<{success: boolean, output: string, error?: string}>}
   */
  async execute({ address }) {
    try {
      const net = getNetwork();
      const socket = await net.connect(address);
      const handle = nextHandle('sock');
      handles.set(handle, { type: 'stream', socket, address });
      return { success: true, output: `Connected to ${address} → handle: ${handle}` };
    } catch (err) {
      return { success: false, output: '', error: `Connect failed: ${err.message}` };
    }
  }
}

// ── netway_listen ─────────────────────────────────────────────────────

/**
 * Binds a listener on a network address to accept incoming connections.
 * Returns a listener handle; use netway_read on the handle to accept
 * individual connections.  Requires user approval.
 */
export class NetwayListenTool extends BrowserTool {
  get name() { return 'netway_listen'; }
  get description() {
    return 'Listen for incoming connections on an address. Returns a listener handle. Use netway_read to accept connections.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Address to listen on (e.g., "mem://localhost:8080")' },
      },
      required: ['address'],
    };
  }
  get permission() { return 'approve'; }

  /**
   * Start listening on the given address and store the listener in the
   * shared handle map.
   *
   * @param {object} params
   * @param {string} params.address - URI to listen on (e.g. "mem://localhost:8080")
   * @returns {Promise<{success: boolean, output: string, error?: string}>}
   */
  async execute({ address }) {
    try {
      const net = getNetwork();
      const listener = await net.listen(address);
      const handle = nextHandle('lstn');
      handles.set(handle, { type: 'listener', listener, address });
      return { success: true, output: `Listening on ${address} (port ${listener.localPort}) → handle: ${handle}` };
    } catch (err) {
      return { success: false, output: '', error: `Listen failed: ${err.message}` };
    }
  }
}

// ── netway_send ───────────────────────────────────────────────────────

/**
 * Writes data to an open stream socket identified by handle.
 * Accepts UTF-8 text (default) or base64-encoded binary.
 * Auto-approved because it operates on an already-opened socket.
 */
export class NetwaySendTool extends BrowserTool {
  get name() { return 'netway_send'; }
  get description() {
    return 'Write data to a socket handle. Data is sent as UTF-8 text or base64-encoded binary.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Socket handle from netway_connect' },
        data: { type: 'string', description: 'Data to send (UTF-8 text)' },
        encoding: { type: 'string', description: 'Encoding: "utf8" (default) or "base64"' },
      },
      required: ['handle', 'data'],
    };
  }
  get permission() { return 'auto'; }

  /**
   * Encode the data and write it to the socket referenced by handle.
   *
   * @param {object} params
   * @param {string} params.handle  - Socket handle from netway_connect
   * @param {string} params.data    - Payload string
   * @param {string} [params.encoding='utf8'] - "utf8" or "base64"
   * @returns {Promise<{success: boolean, output: string, error?: string}>}
   */
  async execute({ handle, data, encoding = 'utf8' }) {
    try {
      const entry = handles.get(handle);
      if (!entry || entry.type !== 'stream') {
        return { success: false, output: '', error: `Invalid stream handle: ${handle}` };
      }
      let bytes;
      if (encoding === 'base64') {
        const raw = atob(data);
        bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      } else {
        bytes = new TextEncoder().encode(data);
      }
      await entry.socket.write(bytes);
      return { success: true, output: `Sent ${bytes.length} bytes to ${handle}` };
    } catch (err) {
      return { success: false, output: '', error: `Send failed: ${err.message}` };
    }
  }
}

// ── netway_read ───────────────────────────────────────────────────────

/**
 * Reads data from a stream socket, or accepts the next inbound connection
 * from a listener.  Behavior depends on the handle type: stream handles
 * return received bytes; listener handles return a new socket handle.
 */
export class NetwayReadTool extends BrowserTool {
  get name() { return 'netway_read'; }
  get description() {
    return 'Read data from a socket or accept a connection from a listener. For stream sockets, returns received data. For listeners, returns a new socket handle.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Socket or listener handle' },
        encoding: { type: 'string', description: 'Output encoding: "utf8" (default) or "base64"' },
      },
      required: ['handle'],
    };
  }
  get permission() { return 'auto'; }

  /**
   * Read from a stream socket or accept a connection on a listener.
   *
   * @param {object} params
   * @param {string} params.handle           - Socket or listener handle
   * @param {string} [params.encoding='utf8'] - Output encoding: "utf8" or "base64"
   * @returns {Promise<{success: boolean, output: string, error?: string}>}
   */
  async execute({ handle, encoding = 'utf8' }) {
    try {
      const entry = handles.get(handle);
      if (!entry) return { success: false, output: '', error: `Unknown handle: ${handle}` };

      if (entry.type === 'listener') {
        const socket = await entry.listener.accept();
        if (!socket) return { success: true, output: 'Listener closed, no connection accepted.' };
        const sockHandle = nextHandle('sock');
        handles.set(sockHandle, { type: 'stream', socket, address: entry.address });
        return { success: true, output: `Accepted connection → handle: ${sockHandle}` };
      }

      if (entry.type === 'stream') {
        const data = await entry.socket.read();
        if (data === null) return { success: true, output: 'EOF — connection closed.' };
        if (encoding === 'base64') {
          let binary = '';
          for (const b of data) binary += String.fromCharCode(b);
          return { success: true, output: btoa(binary) };
        }
        return { success: true, output: new TextDecoder().decode(data) };
      }

      return { success: false, output: '', error: `Handle ${handle} is not readable (type: ${entry.type})` };
    } catch (err) {
      return { success: false, output: '', error: `Read failed: ${err.message}` };
    }
  }
}

// ── netway_close ──────────────────────────────────────────────────────

/**
 * Closes an open socket, listener, or datagram socket and removes it
 * from the shared handle map.  Idempotent for already-closed handles.
 */
export class NetwayCloseTool extends BrowserTool {
  get name() { return 'netway_close'; }
  get description() {
    return 'Close a socket, listener, or datagram socket by handle.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Handle to close' },
      },
      required: ['handle'],
    };
  }
  get permission() { return 'auto'; }

  /**
   * Close the network object referenced by handle and remove it from tracking.
   *
   * @param {object} params
   * @param {string} params.handle - Handle to close
   * @returns {Promise<{success: boolean, output: string, error?: string}>}
   */
  async execute({ handle }) {
    try {
      const entry = handles.get(handle);
      if (!entry) return { success: false, output: '', error: `Unknown handle: ${handle}` };

      if (entry.type === 'stream') await entry.socket.close();
      else if (entry.type === 'listener') entry.listener.close();
      else if (entry.type === 'datagram') entry.socket.close();

      handles.delete(handle);
      return { success: true, output: `Closed ${handle}` };
    } catch (err) {
      return { success: false, output: '', error: `Close failed: ${err.message}` };
    }
  }
}

// ── netway_resolve ────────────────────────────────────────────────────

/**
 * Resolves a hostname to IP addresses via DNS using the virtual network's
 * configured resolver.  Requires user approval because it performs a
 * network lookup.
 */
export class NetwayResolveTool extends BrowserTool {
  get name() { return 'netway_resolve'; }
  get description() {
    return 'Resolve a hostname to IP addresses via DNS.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Hostname to resolve' },
        type: { type: 'string', description: 'Record type: "A" (default), "AAAA"' },
      },
      required: ['name'],
    };
  }
  get permission() { return 'approve'; }

  /**
   * Perform a DNS lookup for the given hostname and record type.
   *
   * @param {object} params
   * @param {string} params.name       - Hostname to resolve
   * @param {string} [params.type='A'] - DNS record type ("A" or "AAAA")
   * @returns {Promise<{success: boolean, output: string, error?: string}>}
   */
  async execute({ name, type = 'A' }) {
    try {
      const net = getNetwork();
      const addresses = await net.resolve(name, type);
      return { success: true, output: addresses.join(', ') || 'No addresses found' };
    } catch (err) {
      return { success: false, output: '', error: `Resolve failed: ${err.message}` };
    }
  }
}

// ── netway_status ─────────────────────────────────────────────────────

/**
 * Reports the current state of the virtual network: registered backends,
 * active handle count, and per-handle details (type, address, closed state).
 */
export class NetwayStatusTool extends BrowserTool {
  get name() { return 'netway_status'; }
  get description() {
    return 'List active sockets, listeners, and backends in the virtual network.';
  }
  get parameters() {
    return { type: 'object', properties: {} };
  }
  get permission() { return 'auto'; }

  /**
   * Collect and return a summary of all active handles and backends.
   *
   * @returns {Promise<{success: boolean, output: string}>}
   */
  async execute() {
    const net = getNetwork();
    const entries = [];
    for (const [handle, entry] of handles) {
      const closed = entry.type === 'stream' ? entry.socket.closed
        : entry.type === 'listener' ? entry.listener.closed
        : entry.type === 'datagram' ? entry.socket.closed
        : false;
      entries.push(`${handle}: ${entry.type} → ${entry.address || 'unknown'}${closed ? ' (closed)' : ''}`);
    }
    const schemes = net.schemes.join(', ');
    const lines = [
      `Backends: ${schemes}`,
      `Active handles: ${handles.size}`,
      ...entries,
    ];
    return { success: true, output: lines.join('\n') };
  }
}

// ── netway_udp_send ───────────────────────────────────────────────────

/**
 * Sends a single UDP datagram to an address without opening a persistent
 * socket.  Useful for fire-and-forget messages (e.g. DNS queries).
 * Requires user approval because it initiates outbound network activity.
 */
export class NetwayUdpSendTool extends BrowserTool {
  get name() { return 'netway_udp_send'; }
  get description() {
    return 'Send a UDP datagram to an address. For receiving, use netway_connect with a udp:// address.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Destination address (e.g., "mem://localhost:5353")' },
        data: { type: 'string', description: 'Data to send (UTF-8 text)' },
      },
      required: ['address', 'data'],
    };
  }
  get permission() { return 'approve'; }

  /**
   * Encode the data as UTF-8 and send it as a single UDP datagram.
   *
   * @param {object} params
   * @param {string} params.address - Destination URI (e.g. "mem://localhost:5353")
   * @param {string} params.data    - UTF-8 payload to send
   * @returns {Promise<{success: boolean, output: string, error?: string}>}
   */
  async execute({ address, data }) {
    try {
      const net = getNetwork();
      const bytes = new TextEncoder().encode(data);
      await net.sendDatagram(address, bytes);
      return { success: true, output: `Sent ${bytes.length} bytes UDP to ${address}` };
    } catch (err) {
      return { success: false, output: '', error: `UDP send failed: ${err.message}` };
    }
  }
}

// ── Registration helper ───────────────────────────────────────────────

/**
 * Register all netway browser tools with the given tool registry.
 * Should be called once during agent initialization to make the
 * netway_connect, netway_listen, netway_send, netway_read, netway_close,
 * netway_resolve, netway_status, and netway_udp_send tools available.
 *
 * @param {object} registry - Tool registry with a `register(tool)` method
 */
export function registerNetwayTools(registry) {
  registry.register(new NetwayConnectTool());
  registry.register(new NetwayListenTool());
  registry.register(new NetwaySendTool());
  registry.register(new NetwayReadTool());
  registry.register(new NetwayCloseTool());
  registry.register(new NetwayResolveTool());
  registry.register(new NetwayStatusTool());
  registry.register(new NetwayUdpSendTool());
}

/**
 * Public accessor for the shared VirtualNetwork singleton.
 * External code (e.g. the GatewayBackend wiring in clawser-wsh-tools.js)
 * can use this to register additional backends or inspect network state
 * without importing the netway package directly.
 *
 * @returns {VirtualNetwork} The singleton VirtualNetwork instance
 */
export function getVirtualNetwork() {
  return getNetwork();
}

export function configureRemoteRuntimeGateway({
  remoteSessionBroker,
  selector = null,
  onLog = null,
  auditRecorder = null,
  quotaEnforcer = null,
} = {}) {
  if (!remoteRuntimeGatewayClient) {
    remoteRuntimeGatewayClient = new BrokerGatewayClient({
      remoteSessionBroker,
      selector,
      onLog,
      auditRecorder,
      quotaEnforcer,
    });
  } else {
    remoteRuntimeGatewayClient.configure({
      remoteSessionBroker,
      selector,
      onLog,
      auditRecorder,
      quotaEnforcer,
    });
  }

  if (!remoteRuntimeGatewayBackend) {
    remoteRuntimeGatewayBackend = new GatewayBackend({ wshClient: remoteRuntimeGatewayClient });
    const network = getNetwork();
    network.addBackend('tcp', remoteRuntimeGatewayBackend);
    network.addBackend('udp', remoteRuntimeGatewayBackend);
  }

  return remoteRuntimeGatewayBackend;
}

function deriveGatewayProvenance(result) {
  const route = result?.route || null;
  if (!route) return null;
  return {
    connectionKind: route.kind || 'unknown',
    routeKind: route.kind || 'unknown',
    relayHost: route.relayHost || null,
    relayPort: route.relayPort || null,
    endpoint: route.endpoint || null,
  };
}

export async function resetNetwayToolsForTests() {
  for (const entry of handles.values()) {
    try {
      if (entry.type === 'stream') await entry.socket.close();
      else if (entry.type === 'listener') entry.listener.close();
      else if (entry.type === 'datagram') entry.socket.close();
    } catch {}
  }
  handles.clear();
  handleCounter = 0;
  if (remoteRuntimeGatewayBackend) {
    await remoteRuntimeGatewayBackend.close().catch(() => {});
  }
  if (remoteRuntimeGatewayClient) {
    await remoteRuntimeGatewayClient.close().catch(() => {});
  }
  remoteRuntimeGatewayBackend = null;
  remoteRuntimeGatewayClient = null;
  if (virtualNetwork) {
    await virtualNetwork.close().catch(() => {});
  }
  virtualNetwork = null;
}
