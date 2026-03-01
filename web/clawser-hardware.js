// clawser-hardware.js — Web Hardware Peripherals
//
// PeripheralHandle: abstract interface for connected devices
// SerialPeripheral: Web Serial API wrapper (Arduino-compatible)
// BluetoothPeripheral: Web Bluetooth API wrapper (BLE sensors)
// USBPeripheral: Web USB API wrapper
// PeripheralManager: discovery, lifecycle, reconnection
// Agent tools: hw_list, hw_connect, hw_send, hw_read, hw_disconnect, hw_info

import { BrowserTool } from './clawser-tools.js';
import { lsKey } from './clawser-state.js';

// ── Constants ───────────────────────────────────────────────────

export const PERIPHERAL_TYPES = Object.freeze({
  SERIAL: 'serial',
  BLUETOOTH: 'bluetooth',
  USB: 'usb',
});

let handleCounter = 0;

/** Reset handle counter (for testing). */
export function resetHandleCounter() {
  handleCounter = 0;
}

// ── PeripheralHandle (Abstract) ─────────────────────────────────

/**
 * Abstract interface for a connected peripheral device.
 */
export class PeripheralHandle {
  /** @returns {string} Unique device identifier */
  get id() { return ''; }

  /** @returns {string} Human-readable name */
  get name() { return 'Unknown Device'; }

  /** @returns {string} "serial" | "bluetooth" | "usb" */
  get type() { return 'unknown'; }

  /** @returns {boolean} Whether device is currently connected */
  get connected() { return false; }

  /**
   * Connect to the device.
   * @param {object} [options]
   * @returns {Promise<void>}
   */
  async connect(options) {}

  /**
   * Disconnect from the device.
   * @returns {Promise<void>}
   */
  async disconnect() {}

  /**
   * Send data to the device.
   * @param {Uint8Array|string} data
   * @returns {Promise<void>}
   */
  async send(data) {}

  /**
   * Read data from the device (one-shot with timeout).
   * @param {number} [timeout=5000] - Timeout in ms
   * @returns {Promise<Uint8Array>}
   */
  async receive(timeout) { return new Uint8Array(0); }

  /**
   * Register a callback for incoming data events.
   * @param {Function} callback - (Uint8Array) => void
   */
  onData(callback) {}

  /**
   * Register a callback for disconnect events.
   * @param {Function} callback - () => void
   */
  onDisconnect(callback) {}

  /**
   * Unregister a data callback.
   * @param {Function} callback
   */
  offData(callback) {}

  /**
   * Unregister a disconnect callback.
   * @param {Function} callback
   */
  offDisconnect(callback) {}

  /**
   * Get device info.
   * @returns {object}
   */
  toJSON() {
    return { id: this.id, name: this.name, type: this.type, connected: this.connected };
  }
}

// ── SerialPeripheral ────────────────────────────────────────────

/**
 * Wraps a Web Serial port with JSON-over-serial protocol (NullClaw compatible).
 * Line-delimited (\n) JSON commands.
 */
export class SerialPeripheral extends PeripheralHandle {
  #port;
  #id;
  #name;
  #connected = false;
  #reader = null;
  #writer = null;
  #dataCallbacks = [];
  #disconnectCallbacks = [];
  #readLoop = null;
  #buffer = '';

  /**
   * @param {object} port - Web Serial port (or mock)
   * @param {object} [opts]
   * @param {string} [opts.name]
   */
  constructor(port, opts = {}) {
    super();
    this.#port = port;
    this.#id = `serial_${++handleCounter}`;
    this.#name = opts.name || port?.getInfo?.()?.usbProductId
      ? `Serial Device (${port.getInfo().usbProductId})`
      : 'Serial Device';
  }

  get id() { return this.#id; }
  get name() { return this.#name; }
  get type() { return PERIPHERAL_TYPES.SERIAL; }
  get connected() { return this.#connected; }

  async connect(options = {}) {
    if (this.#connected) return;
    const baudRate = options.baudRate || 9600;
    await this.#port.open({ baudRate });
    this.#connected = true;

    if (this.#port.readable) {
      this.#reader = this.#port.readable.getReader();
      this.#startReadLoop();
    }
    if (this.#port.writable) {
      this.#writer = this.#port.writable.getWriter();
    }
  }

  async disconnect() {
    if (!this.#connected) return;
    this.#connected = false;

    if (this.#reader) {
      try { await this.#reader.cancel(); } catch {}
      this.#reader = null;
    }
    if (this.#writer) {
      try { await this.#writer.close(); } catch {}
      this.#writer = null;
    }
    try { await this.#port.close(); } catch {}

    for (const cb of this.#disconnectCallbacks) {
      try { cb(); } catch {}
    }
  }

  async send(data) {
    if (!this.#connected || !this.#writer) {
      throw new Error('Serial port not connected');
    }
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    const line = text.endsWith('\n') ? text : text + '\n';
    const encoded = new TextEncoder().encode(line);
    await this.#writer.write(encoded);
  }

  async receive(timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Serial receive timeout'));
      }, timeout);

      const handler = (data) => {
        cleanup();
        resolve(data);
      };

      const cleanup = () => {
        clearTimeout(timer);
        const idx = this.#dataCallbacks.indexOf(handler);
        if (idx >= 0) this.#dataCallbacks.splice(idx, 1);
      };

      this.#dataCallbacks.push(handler);
    });
  }

  onData(callback) {
    this.#dataCallbacks.push(callback);
  }

  offData(callback) {
    const idx = this.#dataCallbacks.indexOf(callback);
    if (idx >= 0) this.#dataCallbacks.splice(idx, 1);
  }

  onDisconnect(callback) {
    this.#disconnectCallbacks.push(callback);
  }

  offDisconnect(callback) {
    const idx = this.#disconnectCallbacks.indexOf(callback);
    if (idx >= 0) this.#disconnectCallbacks.splice(idx, 1);
  }

  #startReadLoop() {
    this.#readLoop = (async () => {
      try {
        while (this.#connected && this.#reader) {
          const { value, done } = await this.#reader.read();
          if (done) break;
          if (value) {
            // Buffer text and emit per-line (JSON-over-serial protocol)
            this.#buffer += new TextDecoder().decode(value);
            const lines = this.#buffer.split('\n');
            this.#buffer = lines.pop() || '';
            for (const line of lines) {
              if (line.trim()) {
                const encoded = new TextEncoder().encode(line);
                for (const cb of this.#dataCallbacks) {
                  try { cb(encoded); } catch {}
                }
              }
            }
          }
        }
      } catch {
        // read error — disconnect
      }
    })();
  }

  toJSON() {
    return {
      ...super.toJSON(),
      baudRate: this.#port?.getInfo?.()?.baudRate,
    };
  }
}

// ── BluetoothPeripheral ─────────────────────────────────────────

/**
 * Wraps a Web Bluetooth device (BLE).
 */
export class BluetoothPeripheral extends PeripheralHandle {
  #device;
  #id;
  #connected = false;
  #server = null;
  #dataCallbacks = [];
  #disconnectCallbacks = [];
  #subscribedChars = [];
  #gattDisconnectHandler = null;

  /**
   * @param {object} device - Web Bluetooth device (or mock)
   */
  constructor(device) {
    super();
    this.#device = device;
    this.#id = `bt_${++handleCounter}`;
  }

  get id() { return this.#id; }
  get name() { return this.#device?.name || 'Bluetooth Device'; }
  get type() { return PERIPHERAL_TYPES.BLUETOOTH; }
  get connected() { return this.#connected; }

  async connect() {
    if (this.#connected) return;
    if (!this.#device?.gatt) {
      throw new Error('Bluetooth GATT not available');
    }
    this.#server = await this.#device.gatt.connect();
    this.#connected = true;

    // Listen for disconnect
    if (this.#device.addEventListener) {
      this.#gattDisconnectHandler = () => {
        this.#connected = false;
        for (const cb of this.#disconnectCallbacks) {
          try { cb(); } catch {}
        }
      };
      this.#device.addEventListener('gattserverdisconnected', this.#gattDisconnectHandler);
    }
  }

  async disconnect() {
    if (!this.#connected) return;
    this.#connected = false;

    // Unsubscribe from characteristics
    for (const char of this.#subscribedChars) {
      try { await char.stopNotifications(); } catch {}
    }
    this.#subscribedChars = [];

    if (this.#gattDisconnectHandler && this.#device?.removeEventListener) {
      this.#device.removeEventListener('gattserverdisconnected', this.#gattDisconnectHandler);
      this.#gattDisconnectHandler = null;
    }

    if (this.#device?.gatt?.connected) {
      try { this.#device.gatt.disconnect(); } catch {}
    }
    this.#server = null;

    for (const cb of this.#disconnectCallbacks) {
      try { cb(); } catch {}
    }
  }

  /**
   * Send data to a BLE characteristic.
   * @param {Uint8Array|string} data
   * @param {object} [opts]
   * @param {string} [opts.service] - Service UUID
   * @param {string} [opts.characteristic] - Characteristic UUID
   */
  async send(data, opts = {}) {
    if (!this.#connected || !this.#server) {
      throw new Error('Bluetooth not connected');
    }
    const service = await this.#server.getPrimaryService(opts.service);
    const char = await service.getCharacteristic(opts.characteristic);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    await char.writeValue(bytes);
  }

  /**
   * Read data from a BLE characteristic.
   * @param {number} [timeout=5000]
   * @param {object} [opts]
   * @param {string} [opts.service]
   * @param {string} [opts.characteristic]
   */
  async receive(timeout = 5000, opts = {}) {
    if (!this.#connected || !this.#server) {
      throw new Error('Bluetooth not connected');
    }
    const service = await this.#server.getPrimaryService(opts.service);
    const char = await service.getCharacteristic(opts.characteristic);
    const value = await char.readValue();
    return new Uint8Array(value.buffer);
  }

  /**
   * Subscribe to notifications from a BLE characteristic.
   * @param {string} serviceUUID
   * @param {string} charUUID
   */
  async subscribe(serviceUUID, charUUID) {
    if (!this.#connected || !this.#server) {
      throw new Error('Bluetooth not connected');
    }
    const service = await this.#server.getPrimaryService(serviceUUID);
    const char = await service.getCharacteristic(charUUID);
    await char.startNotifications();
    this.#subscribedChars.push(char);

    char.addEventListener('characteristicvaluechanged', (event) => {
      const value = new Uint8Array(event.target.value.buffer);
      for (const cb of this.#dataCallbacks) {
        try { cb(value); } catch {}
      }
    });
  }

  /**
   * Unsubscribe from notifications on a BLE characteristic.
   * @param {string} serviceUUID
   * @param {string} charUUID
   */
  async unsubscribe(serviceUUID, charUUID) {
    if (!this.#connected || !this.#server) {
      throw new Error('Bluetooth not connected');
    }
    const service = await this.#server.getPrimaryService(serviceUUID);
    const char = await service.getCharacteristic(charUUID);
    await char.stopNotifications();
    const idx = this.#subscribedChars.indexOf(char);
    if (idx >= 0) this.#subscribedChars.splice(idx, 1);
  }

  onData(callback) {
    this.#dataCallbacks.push(callback);
  }

  offData(callback) {
    const idx = this.#dataCallbacks.indexOf(callback);
    if (idx >= 0) this.#dataCallbacks.splice(idx, 1);
  }

  onDisconnect(callback) {
    this.#disconnectCallbacks.push(callback);
  }

  offDisconnect(callback) {
    const idx = this.#disconnectCallbacks.indexOf(callback);
    if (idx >= 0) this.#disconnectCallbacks.splice(idx, 1);
  }
}

// ── USBPeripheral ───────────────────────────────────────────────

/**
 * Wraps a Web USB device.
 */
export class USBPeripheral extends PeripheralHandle {
  #device;
  #id;
  #connected = false;
  #interfaceNumber;
  #endpointIn;
  #endpointOut;
  #dataCallbacks = [];
  #disconnectCallbacks = [];
  #polling = false;

  /**
   * @param {object} device - Web USB device (or mock)
   */
  constructor(device) {
    super();
    this.#device = device;
    this.#id = `usb_${++handleCounter}`;
  }

  get id() { return this.#id; }
  get name() { return this.#device?.productName || 'USB Device'; }
  get type() { return PERIPHERAL_TYPES.USB; }
  get connected() { return this.#connected; }

  /**
   * @param {object} [options]
   * @param {number} [options.interfaceNumber=0]
   * @param {number} [options.endpointIn=1]
   * @param {number} [options.endpointOut=2]
   */
  async connect(options = {}) {
    if (this.#connected) return;
    await this.#device.open();
    if (this.#device.configuration === null) {
      await this.#device.selectConfiguration(1);
    }
    this.#interfaceNumber = options.interfaceNumber ?? 0;
    this.#endpointIn = options.endpointIn ?? 1;
    this.#endpointOut = options.endpointOut ?? 2;
    await this.#device.claimInterface(this.#interfaceNumber);
    this.#connected = true;
  }

  async disconnect() {
    if (!this.#connected) return;
    this.#connected = false;
    this.#polling = false;
    try { await this.#device.releaseInterface(this.#interfaceNumber); } catch {}
    try { await this.#device.close(); } catch {}

    for (const cb of this.#disconnectCallbacks) {
      try { cb(); } catch {}
    }
  }

  async send(data) {
    if (!this.#connected) {
      throw new Error('USB device not connected');
    }
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    await this.#device.transferOut(this.#endpointOut, bytes);
  }

  async receive(timeout = 5000) {
    if (!this.#connected) {
      throw new Error('USB device not connected');
    }
    const result = await this.#device.transferIn(this.#endpointIn, 64);
    return new Uint8Array(result.data.buffer);
  }

  onData(callback) {
    this.#dataCallbacks.push(callback);
  }

  offData(callback) {
    const idx = this.#dataCallbacks.indexOf(callback);
    if (idx >= 0) this.#dataCallbacks.splice(idx, 1);
  }

  onDisconnect(callback) {
    this.#disconnectCallbacks.push(callback);
  }

  offDisconnect(callback) {
    const idx = this.#disconnectCallbacks.indexOf(callback);
    if (idx >= 0) this.#disconnectCallbacks.splice(idx, 1);
  }

  toJSON() {
    return {
      ...super.toJSON(),
      vendorId: this.#device?.vendorId,
      productId: this.#device?.productId,
    };
  }
}

// ── PeripheralManager ───────────────────────────────────────────

/**
 * Manages peripheral discovery, lifecycle, and reconnection.
 */
export class PeripheralManager {
  /** @type {Map<string, PeripheralHandle>} */
  #devices = new Map();

  /** @type {Function|null} */
  #onLog;

  /** @type {object} Injectable API surfaces for testing */
  #apis;

  /** @type {Function[]} Device data callbacks */
  #dataCallbacks = [];

  /** @type {string} Workspace ID for scoped persistence */
  #wsId;

  /**
   * @param {object} [opts]
   * @param {Function} [opts.onLog] - (message: string) => void
   * @param {object} [opts.serialApi] - navigator.serial replacement
   * @param {object} [opts.bluetoothApi] - navigator.bluetooth replacement
   * @param {object} [opts.usbApi] - navigator.usb replacement
   * @param {string} [opts.wsId='default'] - Workspace ID for scoped persistence
   */
  constructor(opts = {}) {
    this.#onLog = opts.onLog || null;
    this.#wsId = opts.wsId || 'default';
    this.#apis = {
      serial: opts.serialApi || (typeof navigator !== 'undefined' ? navigator.serial : null),
      bluetooth: opts.bluetoothApi || (typeof navigator !== 'undefined' ? navigator.bluetooth : null),
      usb: opts.usbApi || (typeof navigator !== 'undefined' ? navigator.usb : null),
    };
  }

  // ── Discovery ───────────────────────────────────────────

  /**
   * Request a serial port (triggers user permission prompt).
   * @param {Array} [filters]
   * @returns {Promise<SerialPeripheral>}
   */
  async requestSerial(filters = []) {
    if (!this.#apis.serial) {
      throw new Error('Web Serial API not available');
    }
    const port = await this.#apis.serial.requestPort({ filters });
    const handle = new SerialPeripheral(port);
    this.#devices.set(handle.id, handle);
    this.#log(`Serial device added: ${handle.id}`);
    return handle;
  }

  /**
   * Request a Bluetooth device (triggers user permission prompt).
   * @param {Array} [filters]
   * @returns {Promise<BluetoothPeripheral>}
   */
  async requestBluetooth(filters = []) {
    if (!this.#apis.bluetooth) {
      throw new Error('Web Bluetooth API not available');
    }
    const options = {
      filters,
      optionalServices: filters.flatMap(f => f.services || []),
    };
    const device = await this.#apis.bluetooth.requestDevice(options);
    const handle = new BluetoothPeripheral(device);
    this.#devices.set(handle.id, handle);
    this.#log(`Bluetooth device added: ${handle.id}`);
    return handle;
  }

  /**
   * Request a USB device (triggers user permission prompt).
   * @param {Array} [filters]
   * @returns {Promise<USBPeripheral>}
   */
  async requestUSB(filters = []) {
    if (!this.#apis.usb) {
      throw new Error('Web USB API not available');
    }
    const device = await this.#apis.usb.requestDevice({ filters });
    const handle = new USBPeripheral(device);
    this.#devices.set(handle.id, handle);
    this.#log(`USB device added: ${handle.id}`);
    return handle;
  }

  // ── Reconnection ────────────────────────────────────────

  /**
   * Reconnect to previously-granted serial ports.
   * @returns {Promise<SerialPeripheral[]>}
   */
  async reconnectSerial() {
    if (!this.#apis.serial?.getPorts) return [];
    const ports = await this.#apis.serial.getPorts();
    const handles = [];
    for (const port of ports) {
      const handle = new SerialPeripheral(port);
      this.#devices.set(handle.id, handle);
      handles.push(handle);
    }
    if (handles.length > 0) {
      this.#log(`Reconnected ${handles.length} serial port(s)`);
    }
    return handles;
  }

  /**
   * Reconnect to previously-granted USB devices.
   * @returns {Promise<USBPeripheral[]>}
   */
  async reconnectUSB() {
    if (!this.#apis.usb?.getDevices) return [];
    const devices = await this.#apis.usb.getDevices();
    const handles = [];
    for (const device of devices) {
      const handle = new USBPeripheral(device);
      this.#devices.set(handle.id, handle);
      handles.push(handle);
    }
    if (handles.length > 0) {
      this.#log(`Reconnected ${handles.length} USB device(s)`);
    }
    return handles;
  }

  // ── Lifecycle ────────────────────────────────────────────

  /**
   * Get a device by ID.
   * @param {string} id
   * @returns {PeripheralHandle|undefined}
   */
  getDevice(id) {
    return this.#devices.get(id);
  }

  /**
   * List all tracked devices.
   * @returns {PeripheralHandle[]}
   */
  listDevices() {
    return [...this.#devices.values()];
  }

  /**
   * Disconnect a single device by ID.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async disconnectDevice(id) {
    const device = this.#devices.get(id);
    if (!device) return false;
    await device.disconnect();
    this.#devices.delete(id);
    this.#log(`Device disconnected: ${id}`);
    return true;
  }

  /**
   * Disconnect all devices.
   * @returns {Promise<void>}
   */
  async disconnectAll() {
    for (const handle of this.#devices.values()) {
      try { await handle.disconnect(); } catch {}
    }
    this.#devices.clear();
    this.#log('All devices disconnected');
  }

  /** Number of tracked devices. */
  get deviceCount() {
    return this.#devices.size;
  }

  /**
   * Check which hardware APIs are available.
   * @returns {object}
   */
  getApiSupport() {
    return {
      serial: !!this.#apis.serial,
      bluetooth: !!this.#apis.bluetooth,
      usb: !!this.#apis.usb,
    };
  }

  /**
   * Build a prompt section describing connected hardware.
   * @returns {string}
   */
  buildPrompt() {
    const devices = this.listDevices();
    if (devices.length === 0) return '';
    const lines = devices.map(d =>
      `  ${d.id} (${d.type}): ${d.name} [${d.connected ? 'connected' : 'disconnected'}]`
    );
    return `Connected peripherals:\n${lines.join('\n')}`;
  }

  // ── Device Data Forwarding ──────────────────────────────

  /**
   * Register a callback for device data events.
   * @param {Function} callback - (deviceId: string, data: Uint8Array) => void
   */
  onDeviceData(callback) {
    this.#dataCallbacks.push(callback);
  }

  /**
   * Remove a device data callback.
   * @param {Function} callback
   */
  offDeviceData(callback) {
    this.#dataCallbacks = this.#dataCallbacks.filter(cb => cb !== callback);
  }

  /**
   * Dispatch a device data event to all registered callbacks.
   * @param {string} deviceId
   * @param {Uint8Array} data
   */
  dispatchDeviceData(deviceId, data) {
    for (const cb of this.#dataCallbacks) {
      try { cb(deviceId, data); } catch {}
    }
  }

  // ── State Persistence ────────────────────────────────────

  /**
   * Set the workspace ID for scoped persistence.
   * @param {string} wsId
   */
  setWorkspace(wsId) {
    this.#wsId = wsId;
  }

  /**
   * Save device metadata to localStorage for reconnection.
   */
  saveState() {
    if (typeof localStorage === 'undefined') return;
    const devices = this.listDevices().map(d => d.toJSON());
    localStorage.setItem(lsKey.peripherals(this.#wsId), JSON.stringify({ devices }));
  }

  /**
   * Restore device metadata from localStorage.
   * @returns {{ devices: object[] } | null}
   */
  restoreState() {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(lsKey.peripherals(this.#wsId));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  #log(msg) {
    if (this.#onLog) this.#onLog(msg);
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

export class HwListTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'hw_list'; }
  get description() { return 'List connected hardware peripherals.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'approve'; }

  async execute() {
    const devices = this.#manager.listDevices();
    if (devices.length === 0) {
      const support = this.#manager.getApiSupport();
      const available = Object.entries(support)
        .filter(([, v]) => v)
        .map(([k]) => k);
      return {
        success: true,
        output: `No peripherals connected.\nAvailable APIs: ${available.join(', ') || 'none'}`,
      };
    }
    const lines = devices.map(d =>
      `${d.id} | ${d.type} | ${d.name} | ${d.connected ? 'connected' : 'disconnected'}`
    );
    return { success: true, output: `Peripherals (${devices.length}):\n${lines.join('\n')}` };
  }
}

export class HwConnectTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'hw_connect'; }
  get description() { return 'Connect to a hardware peripheral (prompts user for permission).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Peripheral type: serial, bluetooth, or usb' },
        baudRate: { type: 'number', description: 'Baud rate for serial connections (default 9600)' },
        filters: { type: 'array', description: 'Device filters for discovery' },
      },
      required: ['type'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ type, baudRate, filters }) {
    try {
      let handle;
      if (type === 'serial') {
        handle = await this.#manager.requestSerial(filters || []);
        await handle.connect({ baudRate: baudRate || 9600 });
      } else if (type === 'bluetooth') {
        handle = await this.#manager.requestBluetooth(filters || []);
        await handle.connect();
      } else if (type === 'usb') {
        handle = await this.#manager.requestUSB(filters || []);
        await handle.connect();
      } else {
        return { success: false, output: '', error: `Unknown peripheral type: ${type}` };
      }
      return { success: true, output: `Connected: ${handle.id} (${handle.name})` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class HwSendTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'hw_send'; }
  get description() { return 'Send data/command to a connected peripheral.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Device ID' },
        data: { type: 'string', description: 'Data to send (string or JSON command)' },
      },
      required: ['device', 'data'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ device, data }) {
    const handle = this.#manager.getDevice(device);
    if (!handle) {
      return { success: false, output: '', error: `Device not found: ${device}` };
    }
    if (!handle.connected) {
      return { success: false, output: '', error: `Device not connected: ${device}` };
    }
    try {
      await handle.send(data);
      return { success: true, output: `Sent ${data.length} bytes to ${device}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class HwReadTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'hw_read'; }
  get description() { return 'Read data from a connected peripheral (with timeout).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Device ID' },
        timeout: { type: 'number', description: 'Timeout in ms (default 5000)' },
      },
      required: ['device'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ device, timeout }) {
    const handle = this.#manager.getDevice(device);
    if (!handle) {
      return { success: false, output: '', error: `Device not found: ${device}` };
    }
    if (!handle.connected) {
      return { success: false, output: '', error: `Device not connected: ${device}` };
    }
    try {
      const data = await handle.receive(timeout || 5000);
      const text = new TextDecoder().decode(data);
      return { success: true, output: text || `(${data.length} bytes received)` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class HwDisconnectTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'hw_disconnect'; }
  get description() { return 'Disconnect a hardware peripheral.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Device ID (or "all" to disconnect all)' },
      },
      required: ['device'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ device }) {
    if (device === 'all') {
      await this.#manager.disconnectAll();
      return { success: true, output: 'All peripherals disconnected.' };
    }
    const ok = await this.#manager.disconnectDevice(device);
    if (!ok) {
      return { success: false, output: '', error: `Device not found: ${device}` };
    }
    return { success: true, output: `Disconnected: ${device}` };
  }
}

export class HwInfoTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'hw_info'; }
  get description() { return 'Get device info (board type, firmware version).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Device ID' },
      },
      required: ['device'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ device }) {
    const handle = this.#manager.getDevice(device);
    if (!handle) {
      return { success: false, output: '', error: `Device not found: ${device}` };
    }
    try {
      const info = handle.toJSON();
      // For serial devices, try to get firmware info via "info" command
      if (handle.type === 'serial' && handle.connected) {
        try {
          await handle.send(JSON.stringify({ cmd: 'info' }));
          const resp = await handle.receive(2000);
          const text = new TextDecoder().decode(resp);
          try {
            const parsed = JSON.parse(text);
            Object.assign(info, { firmware: parsed });
          } catch {
            info.rawResponse = text;
          }
        } catch {
          // info command not supported — just return basic info
        }
      }
      return { success: true, output: JSON.stringify(info, null, 2) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

/**
 * Agent tool for monitoring real-time device data.
 * Reads latest data from a connected device with optional duration.
 */
export class HwMonitorTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'hw_monitor'; }
  get description() { return 'Monitor real-time data from a connected peripheral device.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Device ID to monitor' },
        duration: { type: 'number', description: 'Duration in ms to collect data (default 1000)' },
      },
      required: ['device'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ device, duration }) {
    const handle = this.#manager.getDevice(device);
    if (!handle) {
      return { success: false, output: '', error: `Device not found: ${device}` };
    }

    const timeout = duration || 1000;
    const readings = [];

    return new Promise(resolve => {
      const handler = (_id, data) => {
        readings.push({
          timestamp: Date.now(),
          bytes: data.length,
          text: new TextDecoder().decode(data),
        });
      };

      this.#manager.onDeviceData(handler);

      setTimeout(() => {
        this.#manager.offDeviceData(handler);
        if (readings.length === 0) {
          resolve({ success: true, output: `No data received from ${device} in ${timeout}ms.` });
        } else {
          resolve({
            success: true,
            output: `${readings.length} readings from ${device}:\n${readings.map(r => r.text).join('\n')}`,
          });
        }
      }, timeout);
    });
  }
}
