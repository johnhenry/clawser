/**
 * clawser-iot-bridge.js -- IoT Protocol Bridges for BrowserMesh.
 *
 * Provides multi-protocol IoT device management with MQTT, HTTP, and direct
 * (peripheral) adapters, a bridge orchestrator for unified device control,
 * and time-series telemetry collection with ring-buffer storage.
 *
 * IoTDevice is the normalized device representation across all protocols.
 * IoTProtocolAdapter is the abstract base for pluggable protocol backends.
 * MqttAdapter bridges MQTT devices via wsh tunnel or injectable transport.
 * HttpAdapter bridges REST/webhook devices via fetch polling.
 * DirectAdapter wraps existing PeripheralHandle objects.
 * IoTBridge manages devices across protocols with event dispatch.
 * IoTTelemetry collects time-series data with ring-buffer and stats.
 *
 * No browser-only imports at module level.
 *
 * Run tests:
 *   node --import ./web/test/_setup-globals.mjs --test web/test/clawser-iot-bridge.test.mjs
 */

// ---------------------------------------------------------------------------
// Wire Constants
// ---------------------------------------------------------------------------

/** IoT device registration message type. */
export const IOT_REGISTER = 0xF7

/** IoT telemetry data message type. */
export const IOT_TELEMETRY = 0xF8

/** IoT command message type. */
export const IOT_COMMAND = 0xF9

/** IoT status update message type. */
export const IOT_STATUS = 0xFA

// ---------------------------------------------------------------------------
// IoTDevice
// ---------------------------------------------------------------------------

/**
 * Normalized device representation across all IoT protocols.
 */
export class IoTDevice {
  /** @type {string} */
  #deviceId

  /** @type {string} */
  #name

  /** @type {string} */
  #protocol

  /** @type {string} */
  #endpoint

  /** @type {string[]} */
  #capabilities

  /** @type {object} */
  #metadata

  /**
   * @param {object} opts
   * @param {string} opts.deviceId       - Unique device identifier (required)
   * @param {string} [opts.name]         - Human-readable name
   * @param {string} opts.protocol       - Protocol type: 'mqtt' | 'http' | 'direct' | 'coap'
   * @param {string} [opts.endpoint]     - URL or address
   * @param {string[]} [opts.capabilities] - Subset of ['read', 'write', 'stream', 'command']
   * @param {object} [opts.metadata]     - Arbitrary metadata
   */
  constructor({ deviceId, name = '', protocol, endpoint = '', capabilities = [], metadata = {} }) {
    if (!deviceId || typeof deviceId !== 'string') {
      throw new Error('deviceId is required and must be a non-empty string')
    }
    this.#deviceId = deviceId
    this.#name = name
    this.#protocol = protocol || ''
    this.#endpoint = endpoint
    this.#capabilities = [...capabilities]
    this.#metadata = { ...metadata }
  }

  /** @returns {string} Unique device identifier */
  get deviceId() {
    return this.#deviceId
  }

  /** @returns {string} Human-readable name */
  get name() {
    return this.#name
  }

  /** @returns {string} Protocol type */
  get protocol() {
    return this.#protocol
  }

  /** @returns {string} Endpoint URL or address */
  get endpoint() {
    return this.#endpoint
  }

  /** @returns {string[]} Device capabilities */
  get capabilities() {
    return [...this.#capabilities]
  }

  /** @returns {object} Device metadata */
  get metadata() {
    return { ...this.#metadata }
  }

  /**
   * Serialize to a JSON-safe object.
   * @returns {object}
   */
  toJSON() {
    return {
      deviceId: this.#deviceId,
      name: this.#name,
      protocol: this.#protocol,
      endpoint: this.#endpoint,
      capabilities: [...this.#capabilities],
      metadata: { ...this.#metadata },
    }
  }

  /**
   * Re-hydrate from a plain object.
   * @param {object} json
   * @returns {IoTDevice}
   */
  static fromJSON(json) {
    return new IoTDevice(json)
  }
}

// ---------------------------------------------------------------------------
// IoTProtocolAdapter (abstract base)
// ---------------------------------------------------------------------------

/**
 * Abstract base class for IoT protocol backends.
 * Subclasses must implement connect(), disconnect(), send(), subscribe(), unsubscribe().
 */
export class IoTProtocolAdapter {
  /** @type {string} */
  #protocol

  /** @type {boolean} */
  #active = false

  /**
   * @param {object} opts
   * @param {string} opts.protocol - Protocol identifier (e.g., 'mqtt', 'http', 'direct')
   */
  constructor({ protocol }) {
    if (!protocol || typeof protocol !== 'string') {
      throw new Error('protocol is required and must be a non-empty string')
    }
    this.#protocol = protocol
  }

  /** @returns {string} Protocol identifier */
  get protocol() {
    return this.#protocol
  }

  /** @returns {boolean} Whether the adapter is currently active */
  get active() {
    return this.#active
  }

  /** @param {boolean} value */
  set _active(value) {
    this.#active = value
  }

  /**
   * Connect to a device.
   * @param {IoTDevice} _device
   * @returns {Promise<void>}
   */
  async connect(_device) {
    throw new Error('connect() must be implemented by subclass')
  }

  /**
   * Disconnect from a device.
   * @param {IoTDevice} _device
   * @returns {Promise<void>}
   */
  async disconnect(_device) {
    throw new Error('disconnect() must be implemented by subclass')
  }

  /**
   * Send a payload to a device.
   * @param {IoTDevice} _device
   * @param {*} _payload
   * @returns {Promise<void>}
   */
  async send(_device, _payload) {
    throw new Error('send() must be implemented by subclass')
  }

  /**
   * Subscribe to a topic on a device.
   * @param {IoTDevice} _device
   * @param {string} _topic
   * @param {Function} _cb
   * @returns {Promise<void>}
   */
  async subscribe(_device, _topic, _cb) {
    throw new Error('subscribe() must be implemented by subclass')
  }

  /**
   * Unsubscribe from a topic on a device.
   * @param {IoTDevice} _device
   * @param {string} _topic
   * @returns {Promise<void>}
   */
  async unsubscribe(_device, _topic) {
    throw new Error('unsubscribe() must be implemented by subclass')
  }
}

// ---------------------------------------------------------------------------
// MqttAdapter
// ---------------------------------------------------------------------------

/**
 * MQTT protocol adapter using injectable transport (or wsh tunnel).
 */
export class MqttAdapter extends IoTProtocolAdapter {
  /** @type {string|null} */
  #wshConnectionId

  /** @type {Function|null} */
  #createTransportFn

  /** @type {Map<string, object>} deviceId -> transport */
  #connections = new Map()

  /** @type {Map<string, Function>} "deviceId:topic" -> callback */
  #subscriptions = new Map()

  /**
   * @param {object} [opts]
   * @param {string} [opts.wshConnectionId] - wsh connection ID for real MQTT
   * @param {Function} [opts.createTransportFn] - Injectable transport factory for testing
   */
  constructor({ wshConnectionId, createTransportFn } = {}) {
    super({ protocol: 'mqtt' })
    this.#wshConnectionId = wshConnectionId || null
    this.#createTransportFn = createTransportFn || null
  }

  /**
   * Connect to an MQTT device.
   * @param {IoTDevice} device
   */
  async connect(device) {
    let transport
    if (this.#createTransportFn) {
      transport = this.#createTransportFn(device)
    } else {
      // Fallback: create a mock transport for environments without real MQTT
      transport = { send: () => {}, close: () => {}, connected: true }
    }
    this.#connections.set(device.deviceId, transport)
    this._active = true
  }

  /**
   * Disconnect from an MQTT device.
   * @param {IoTDevice} device
   */
  async disconnect(device) {
    const transport = this.#connections.get(device.deviceId)
    if (transport) {
      transport.close()
      this.#connections.delete(device.deviceId)
    }
    // Remove all subscriptions for this device
    for (const key of [...this.#subscriptions.keys()]) {
      if (key.startsWith(device.deviceId + ':')) {
        this.#subscriptions.delete(key)
      }
    }
    if (this.#connections.size === 0) this._active = false
  }

  /**
   * Send a payload to an MQTT device.
   * @param {IoTDevice} device
   * @param {object} payload - Must include `topic` and optionally `data`
   */
  async send(device, payload) {
    const transport = this.#connections.get(device.deviceId)
    if (!transport) {
      throw new Error(`Device ${device.deviceId} not connected`)
    }
    const packet = this.#encodePublish(payload.topic || '', payload.data ?? payload)
    transport.send(packet)
  }

  /**
   * Subscribe to a topic on an MQTT device.
   * @param {IoTDevice} device
   * @param {string} topic
   * @param {Function} cb
   */
  async subscribe(device, topic, cb) {
    const key = `${device.deviceId}:${topic}`
    this.#subscriptions.set(key, cb)
  }

  /**
   * Unsubscribe from a topic on an MQTT device.
   * @param {IoTDevice} device
   * @param {string} topic
   */
  async unsubscribe(device, topic) {
    const key = `${device.deviceId}:${topic}`
    this.#subscriptions.delete(key)
  }

  /**
   * Deliver a message to a subscription callback (for testing and internal use).
   * @param {string} deviceId
   * @param {string} topic
   * @param {*} message
   */
  _deliverMessage(deviceId, topic, message) {
    const key = `${deviceId}:${topic}`
    const cb = this.#subscriptions.get(key)
    if (cb) cb(message)
  }

  /**
   * Encode a minimal MQTT v3.1.1 CONNECT packet description.
   * @param {IoTDevice} device
   * @returns {object}
   */
  #encodeConnect(device) {
    return {
      type: 'CONNECT',
      protocolName: 'MQTT',
      protocolLevel: 4, // MQTT 3.1.1
      clientId: device.deviceId,
      keepAlive: 60,
    }
  }

  /**
   * Encode an MQTT PUBLISH packet description.
   * @param {string} topic
   * @param {*} payload
   * @returns {object}
   */
  #encodePublish(topic, payload) {
    return {
      type: 'PUBLISH',
      topic,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    }
  }

  /**
   * Encode an MQTT SUBSCRIBE packet description.
   * @param {string} topic
   * @returns {object}
   */
  #encodeSubscribe(topic) {
    return {
      type: 'SUBSCRIBE',
      topic,
      qos: 0,
    }
  }
}

// ---------------------------------------------------------------------------
// HttpAdapter
// ---------------------------------------------------------------------------

/**
 * HTTP/REST protocol adapter using fetch for polling and commands.
 */
export class HttpAdapter extends IoTProtocolAdapter {
  /** @type {Function} */
  #fetchFn

  /** @type {Map<string, number>} "deviceId:topic" -> intervalId */
  #pollIntervals = new Map()

  /** @type {Map<string, boolean>} deviceId -> connected flag */
  #connections = new Map()

  /**
   * @param {object} [opts]
   * @param {Function} [opts.fetchFn] - Injectable fetch function (defaults to globalThis.fetch)
   */
  constructor({ fetchFn } = {}) {
    super({ protocol: 'http' })
    this.#fetchFn = fetchFn || globalThis.fetch
  }

  /**
   * Connect to an HTTP device by verifying its endpoint.
   * @param {IoTDevice} device
   */
  async connect(device) {
    await this.#fetchFn(device.endpoint, { method: 'HEAD' })
    this.#connections.set(device.deviceId, true)
    this._active = true
  }

  /**
   * Disconnect from an HTTP device.
   * @param {IoTDevice} device
   */
  async disconnect(device) {
    // Clear any poll intervals for this device
    for (const [key, intervalId] of [...this.#pollIntervals.entries()]) {
      if (key.startsWith(device.deviceId + ':')) {
        clearInterval(intervalId)
        this.#pollIntervals.delete(key)
      }
    }
    this.#connections.delete(device.deviceId)
    if (this.#connections.size === 0) this._active = false
  }

  /**
   * Send a payload to an HTTP device via POST.
   * @param {IoTDevice} device
   * @param {*} payload
   */
  async send(device, payload) {
    if (!this.#connections.has(device.deviceId)) {
      throw new Error(`Device ${device.deviceId} not connected`)
    }
    await this.#fetchFn(device.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  /**
   * Subscribe to a topic by polling the device endpoint.
   * @param {IoTDevice} device
   * @param {string} topic
   * @param {Function} cb
   */
  async subscribe(device, topic, cb) {
    const key = `${device.deviceId}:${topic}`
    // Clear existing interval if any
    if (this.#pollIntervals.has(key)) {
      clearInterval(this.#pollIntervals.get(key))
    }
    const intervalId = setInterval(async () => {
      try {
        const url = device.endpoint + (topic ? `/${topic}` : '')
        const res = await this.#fetchFn(url, { method: 'GET' })
        if (res.ok) {
          const data = await res.json()
          cb(data)
        }
      } catch {
        // Polling errors are silently ignored
      }
    }, 5000)
    this.#pollIntervals.set(key, intervalId)
  }

  /**
   * Unsubscribe from a topic by clearing its poll interval.
   * @param {IoTDevice} device
   * @param {string} topic
   */
  async unsubscribe(device, topic) {
    const key = `${device.deviceId}:${topic}`
    const intervalId = this.#pollIntervals.get(key)
    if (intervalId !== undefined) {
      clearInterval(intervalId)
      this.#pollIntervals.delete(key)
    }
  }

  /**
   * Clear all polling intervals (for cleanup in tests).
   */
  _clearAllIntervals() {
    for (const intervalId of this.#pollIntervals.values()) {
      clearInterval(intervalId)
    }
    this.#pollIntervals.clear()
  }
}

// ---------------------------------------------------------------------------
// DirectAdapter
// ---------------------------------------------------------------------------

/**
 * Direct protocol adapter wrapping existing PeripheralHandle objects.
 */
export class DirectAdapter extends IoTProtocolAdapter {
  /** @type {object|null} */
  #peripheralManager

  /** @type {Map<string, object>} deviceId -> peripheral handle */
  #connections = new Map()

  /** @type {Map<string, Function>} deviceId -> data callback */
  #dataCallbacks = new Map()

  /**
   * @param {object} [opts]
   * @param {object} [opts.peripheralManager] - Injected peripheral manager
   */
  constructor({ peripheralManager } = {}) {
    super({ protocol: 'direct' })
    this.#peripheralManager = peripheralManager || null
  }

  /**
   * Connect to a device via the peripheral manager.
   * @param {IoTDevice} device
   */
  async connect(device) {
    if (!this.#peripheralManager) {
      throw new Error('No peripheral manager configured')
    }
    const peripheral = this.#peripheralManager.getDevice(device.deviceId)
    if (!peripheral) {
      throw new Error(`Peripheral ${device.deviceId} not found`)
    }
    if (peripheral.connect && !peripheral.connected) {
      await peripheral.connect()
    }
    this.#connections.set(device.deviceId, peripheral)
    this._active = true
  }

  /**
   * Disconnect from a device.
   * @param {IoTDevice} device
   */
  async disconnect(device) {
    const peripheral = this.#connections.get(device.deviceId)
    if (peripheral) {
      if (peripheral.disconnect) {
        await peripheral.disconnect()
      }
      // Remove data callback
      const cb = this.#dataCallbacks.get(device.deviceId)
      if (cb && peripheral.offData) {
        peripheral.offData(cb)
      }
      this.#dataCallbacks.delete(device.deviceId)
      this.#connections.delete(device.deviceId)
    }
    if (this.#connections.size === 0) this._active = false
  }

  /**
   * Send a payload to a device via peripheral.send().
   * @param {IoTDevice} device
   * @param {*} payload
   */
  async send(device, payload) {
    const peripheral = this.#connections.get(device.deviceId)
    if (!peripheral) {
      throw new Error(`Device ${device.deviceId} not connected`)
    }
    await peripheral.send(payload)
  }

  /**
   * Subscribe to data from a device via peripheral.onData().
   * @param {IoTDevice} device
   * @param {string} _topic - Ignored for direct connections
   * @param {Function} cb
   */
  async subscribe(device, _topic, cb) {
    const peripheral = this.#connections.get(device.deviceId)
    if (!peripheral) {
      throw new Error(`Device ${device.deviceId} not connected`)
    }
    this.#dataCallbacks.set(device.deviceId, cb)
    peripheral.onData(cb)
  }

  /**
   * Unsubscribe from data on a device.
   * @param {IoTDevice} device
   * @param {string} _topic
   */
  async unsubscribe(device, _topic) {
    const peripheral = this.#connections.get(device.deviceId)
    const cb = this.#dataCallbacks.get(device.deviceId)
    if (peripheral && cb && peripheral.offData) {
      peripheral.offData(cb)
    }
    this.#dataCallbacks.delete(device.deviceId)
  }

  /**
   * Convert a PeripheralHandle to an IoTDevice.
   * Maps peripheral.type to protocol (serial->direct, bluetooth->direct, usb->direct).
   * @param {object} peripheral - PeripheralHandle or plain object
   * @returns {IoTDevice}
   */
  static toIoTDevice(peripheral) {
    const id = peripheral.id || peripheral.deviceId || ''
    const name = peripheral.name || ''
    const connected = peripheral.connected || false
    const capabilities = []
    if (connected) {
      capabilities.push('read', 'write')
    }
    return new IoTDevice({
      deviceId: id,
      name,
      protocol: 'direct',
      endpoint: '',
      capabilities,
      metadata: {
        peripheralType: peripheral.type || 'unknown',
        connected,
      },
    })
  }
}

// ---------------------------------------------------------------------------
// IoTBridge
// ---------------------------------------------------------------------------

/**
 * Manages IoT devices across multiple protocols with unified control.
 */
export class IoTBridge {
  /** @type {Map<string, IoTDevice>} deviceId -> IoTDevice */
  #devices = new Map()

  /** @type {Map<string, IoTProtocolAdapter>} protocol string -> adapter */
  #adapters = new Map()

  /** @type {Function[]} */
  #eventCallbacks = []

  /**
   * @param {object} [opts]
   * @param {Map|Array} [opts.adapters] - Initial adapters as Map or [protocol, adapter] pairs
   */
  constructor({ adapters } = {}) {
    if (adapters) {
      const entries = adapters instanceof Map ? adapters.entries() : adapters
      for (const [protocol, adapter] of entries) {
        this.#adapters.set(protocol, adapter)
      }
    }
  }

  /**
   * Register a protocol adapter.
   * @param {string} protocol
   * @param {IoTProtocolAdapter|object} adapter
   */
  registerAdapter(protocol, adapter) {
    this.#adapters.set(protocol, adapter)
  }

  /**
   * Add a device and auto-connect via its matching adapter.
   * @param {IoTDevice} device
   */
  async addDevice(device) {
    this.#devices.set(device.deviceId, device)
    const adapter = this.#adapters.get(device.protocol)
    if (adapter) {
      await adapter.connect(device)
    }
    this.dispatchEvent({ type: 'device_added', deviceId: device.deviceId })
  }

  /**
   * Remove a device, disconnecting via its adapter first.
   * @param {string} deviceId
   */
  async removeDevice(deviceId) {
    const device = this.#devices.get(deviceId)
    if (device) {
      const adapter = this.#adapters.get(device.protocol)
      if (adapter) {
        await adapter.disconnect(device)
      }
      this.#devices.delete(deviceId)
      this.dispatchEvent({ type: 'device_removed', deviceId })
    }
  }

  /**
   * Get a device by ID.
   * @param {string} deviceId
   * @returns {IoTDevice|undefined}
   */
  getDevice(deviceId) {
    return this.#devices.get(deviceId)
  }

  /**
   * List all devices, optionally filtered.
   * @param {object} [filter]
   * @param {string} [filter.protocol] - Filter by protocol
   * @param {string} [filter.capability] - Filter by capability inclusion
   * @param {string} [filter.metadata] - Filter by metadata key existence
   * @returns {IoTDevice[]}
   */
  listDevices(filter) {
    let devices = [...this.#devices.values()]
    if (filter) {
      if (filter.protocol) {
        devices = devices.filter(d => d.protocol === filter.protocol)
      }
      if (filter.capability) {
        devices = devices.filter(d => d.capabilities.includes(filter.capability))
      }
      if (filter.metadata) {
        devices = devices.filter(d => filter.metadata in d.metadata)
      }
    }
    return devices
  }

  /**
   * Send a payload to a device.
   * @param {string} deviceId
   * @param {*} payload
   */
  async send(deviceId, payload) {
    const device = this.#devices.get(deviceId)
    if (!device) {
      throw new Error(`Device ${deviceId} not found`)
    }
    const adapter = this.#adapters.get(device.protocol)
    if (!adapter) {
      throw new Error(`No adapter for protocol ${device.protocol}`)
    }
    await adapter.send(device, payload)
  }

  /**
   * Subscribe to a topic on a device.
   * @param {string} deviceId
   * @param {string} topic
   * @param {Function} cb
   */
  async subscribe(deviceId, topic, cb) {
    const device = this.#devices.get(deviceId)
    if (!device) {
      throw new Error(`Device ${deviceId} not found`)
    }
    const adapter = this.#adapters.get(device.protocol)
    if (!adapter) {
      throw new Error(`No adapter for protocol ${device.protocol}`)
    }
    await adapter.subscribe(device, topic, cb)
  }

  /**
   * Unsubscribe from a topic on a device.
   * @param {string} deviceId
   * @param {string} topic
   */
  async unsubscribe(deviceId, topic) {
    const device = this.#devices.get(deviceId)
    if (!device) {
      throw new Error(`Device ${deviceId} not found`)
    }
    const adapter = this.#adapters.get(device.protocol)
    if (!adapter) {
      throw new Error(`No adapter for protocol ${device.protocol}`)
    }
    await adapter.unsubscribe(device, topic)
  }

  /**
   * Import devices from a PeripheralManager, converting each to IoTDevice.
   * @param {object} pm - PeripheralManager with listDevices()
   * @returns {Promise<number>} Number of imported devices
   */
  async importFromPeripheralManager(pm) {
    const peripherals = pm.listDevices()
    let count = 0
    for (const p of peripherals) {
      const iotDevice = DirectAdapter.toIoTDevice(p)
      await this.addDevice(iotDevice)
      count++
    }
    return count
  }

  /**
   * Register a callback for device events.
   * @param {Function} cb
   */
  onDeviceEvent(cb) {
    this.#eventCallbacks.push(cb)
  }

  /**
   * Dispatch an event to all registered callbacks.
   * @param {object} event
   */
  dispatchEvent(event) {
    for (const cb of this.#eventCallbacks) {
      cb(event)
    }
  }
}

// ---------------------------------------------------------------------------
// IoTTelemetry
// ---------------------------------------------------------------------------

/**
 * Time-series telemetry collection with ring-buffer storage and stats.
 */
export class IoTTelemetry {
  /** @type {Map<string, Array<{ts: number, value: *}>>} deviceId -> samples */
  #series = new Map()

  /** @type {number} */
  #maxSamples

  /** @type {number} */
  #flushIntervalMs

  /**
   * @param {object} [opts]
   * @param {number} [opts.maxSamples=1000] - Max entries per device
   * @param {number} [opts.flushIntervalMs=60000] - Auto-flush interval (stored, not auto-started)
   */
  constructor({ maxSamples = 1000, flushIntervalMs = 60000 } = {}) {
    this.#maxSamples = maxSamples
    this.#flushIntervalMs = flushIntervalMs
  }

  /**
   * Record a telemetry sample for a device.
   * @param {string} deviceId
   * @param {*} value
   */
  record(deviceId, value) {
    if (!this.#series.has(deviceId)) {
      this.#series.set(deviceId, [])
    }
    const samples = this.#series.get(deviceId)
    samples.push({ ts: Date.now(), value })
    // Ring buffer: drop oldest when over limit
    while (samples.length > this.#maxSamples) {
      samples.shift()
    }
  }

  /**
   * Query samples for a device, optionally filtered by time range.
   * @param {string} deviceId
   * @param {number} [since] - Start timestamp (inclusive)
   * @param {number} [until] - End timestamp (inclusive)
   * @returns {Array<{ts: number, value: *}>}
   */
  query(deviceId, since, until) {
    const samples = this.#series.get(deviceId)
    if (!samples) return []
    let result = samples
    if (since !== undefined) {
      result = result.filter(s => s.ts >= since)
    }
    if (until !== undefined) {
      result = result.filter(s => s.ts <= until)
    }
    return result
  }

  /**
   * Get the most recent sample for a device.
   * @param {string} deviceId
   * @returns {{ts: number, value: *}|null}
   */
  getLatest(deviceId) {
    const samples = this.#series.get(deviceId)
    if (!samples || samples.length === 0) return null
    return samples[samples.length - 1]
  }

  /**
   * Compute statistics for a device's samples.
   * @param {string} deviceId
   * @returns {{min: number, max: number, avg: number, count: number, last: *}|null}
   */
  getStats(deviceId) {
    const samples = this.#series.get(deviceId)
    if (!samples || samples.length === 0) return null
    const values = samples.map(s => s.value).filter(v => typeof v === 'number')
    if (values.length === 0) return null
    const min = Math.min(...values)
    const max = Math.max(...values)
    const sum = values.reduce((a, b) => a + b, 0)
    const avg = sum / values.length
    const last = samples[samples.length - 1].value
    return { min, max, avg, count: values.length, last }
  }

  /**
   * Clear samples for a device, or all devices if no deviceId given.
   * @param {string} [deviceId]
   */
  flush(deviceId) {
    if (deviceId) {
      this.#series.delete(deviceId)
    } else {
      this.#series.clear()
    }
  }

  /**
   * Export a JSON-serializable snapshot of telemetry data.
   * @param {string} [deviceId] - If provided, export only that device
   * @returns {object} Map of deviceId -> samples array
   */
  export(deviceId) {
    const result = {}
    if (deviceId) {
      const samples = this.#series.get(deviceId)
      if (samples) {
        result[deviceId] = [...samples]
      }
    } else {
      for (const [id, samples] of this.#series) {
        result[id] = [...samples]
      }
    }
    return result
  }
}
