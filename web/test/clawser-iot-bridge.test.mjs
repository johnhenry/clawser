// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-iot-bridge.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  IOT_REGISTER,
  IOT_TELEMETRY,
  IOT_COMMAND,
  IOT_STATUS,
  IoTDevice,
  IoTProtocolAdapter,
  MqttAdapter,
  HttpAdapter,
  DirectAdapter,
  IoTBridge,
  IoTTelemetry,
} from '../clawser-iot-bridge.js'

// ---------------------------------------------------------------------------
// Wire Constants
// ---------------------------------------------------------------------------

describe('Wire constants', () => {
  it('IOT_REGISTER equals 0xF7', () => {
    assert.equal(IOT_REGISTER, 0xF7)
  })

  it('IOT_TELEMETRY equals 0xF8', () => {
    assert.equal(IOT_TELEMETRY, 0xF8)
  })

  it('IOT_COMMAND equals 0xF9', () => {
    assert.equal(IOT_COMMAND, 0xF9)
  })

  it('IOT_STATUS equals 0xFA', () => {
    assert.equal(IOT_STATUS, 0xFA)
  })
})

// ---------------------------------------------------------------------------
// IoTDevice
// ---------------------------------------------------------------------------

describe('IoTDevice', () => {
  it('constructor sets all fields', () => {
    const d = new IoTDevice({
      deviceId: 'dev-1',
      name: 'Sensor A',
      protocol: 'mqtt',
      endpoint: 'mqtt://broker.local',
      capabilities: ['read', 'stream'],
      metadata: { firmware: '1.2.3' },
    })
    assert.equal(d.deviceId, 'dev-1')
    assert.equal(d.name, 'Sensor A')
    assert.equal(d.protocol, 'mqtt')
    assert.equal(d.endpoint, 'mqtt://broker.local')
    assert.deepEqual(d.capabilities, ['read', 'stream'])
    assert.deepEqual(d.metadata, { firmware: '1.2.3' })
  })

  it('applies defaults for optional fields', () => {
    const d = new IoTDevice({ deviceId: 'dev-2', protocol: 'http' })
    assert.equal(d.name, '')
    assert.equal(d.endpoint, '')
    assert.deepEqual(d.capabilities, [])
    assert.deepEqual(d.metadata, {})
  })

  it('toJSON/fromJSON roundtrip preserves data', () => {
    const original = new IoTDevice({
      deviceId: 'dev-3',
      name: 'Actuator B',
      protocol: 'direct',
      endpoint: '/dev/tty0',
      capabilities: ['write', 'command'],
      metadata: { voltage: 3.3 },
    })
    const json = original.toJSON()
    const restored = IoTDevice.fromJSON(json)
    assert.equal(restored.deviceId, original.deviceId)
    assert.equal(restored.name, original.name)
    assert.equal(restored.protocol, original.protocol)
    assert.equal(restored.endpoint, original.endpoint)
    assert.deepEqual(restored.capabilities, original.capabilities)
    assert.deepEqual(restored.metadata, original.metadata)
  })

  it('requires deviceId', () => {
    assert.throws(() => new IoTDevice({ protocol: 'mqtt' }), /deviceId/)
  })
})

// ---------------------------------------------------------------------------
// IoTProtocolAdapter
// ---------------------------------------------------------------------------

describe('IoTProtocolAdapter', () => {
  it('constructor requires protocol string', () => {
    assert.throws(() => new IoTProtocolAdapter({}), /protocol/)
    assert.throws(() => new IoTProtocolAdapter({ protocol: '' }), /protocol/)
  })

  it('abstract methods throw', async () => {
    const adapter = new IoTProtocolAdapter({ protocol: 'test' })
    const device = new IoTDevice({ deviceId: 'd1', protocol: 'test' })
    await assert.rejects(() => adapter.connect(device), /must be implemented/)
    await assert.rejects(() => adapter.disconnect(device), /must be implemented/)
    await assert.rejects(() => adapter.send(device, {}), /must be implemented/)
    await assert.rejects(() => adapter.subscribe(device, 'topic', () => {}), /must be implemented/)
    await assert.rejects(() => adapter.unsubscribe(device, 'topic'), /must be implemented/)
  })

  it('exposes protocol and active getters', () => {
    const adapter = new IoTProtocolAdapter({ protocol: 'test' })
    assert.equal(adapter.protocol, 'test')
    assert.equal(adapter.active, false)
  })
})

// ---------------------------------------------------------------------------
// MqttAdapter
// ---------------------------------------------------------------------------

describe('MqttAdapter', () => {
  let sent
  let mockTransport
  let createTransportFn
  let adapter

  beforeEach(() => {
    sent = []
    mockTransport = {
      send: (data) => sent.push(data),
      close: () => {},
      connected: true,
    }
    createTransportFn = (_device) => mockTransport
    adapter = new MqttAdapter({ createTransportFn })
  })

  it('constructor sets protocol to mqtt', () => {
    assert.equal(adapter.protocol, 'mqtt')
  })

  it('connect creates transport via createTransportFn', async () => {
    const device = new IoTDevice({ deviceId: 'mq1', protocol: 'mqtt', endpoint: 'mqtt://broker' })
    await adapter.connect(device)
    assert.equal(adapter.active, true)
  })

  it('disconnect removes connection', async () => {
    const device = new IoTDevice({ deviceId: 'mq1', protocol: 'mqtt' })
    await adapter.connect(device)
    let closed = false
    mockTransport.close = () => { closed = true }
    await adapter.disconnect(device)
    assert.equal(closed, true)
  })

  it('send encodes and sends via transport', async () => {
    const device = new IoTDevice({ deviceId: 'mq1', protocol: 'mqtt' })
    await adapter.connect(device)
    await adapter.send(device, { topic: 'sensors/temp', data: 42 })
    assert.equal(sent.length, 1)
    assert.ok(sent[0].topic === 'sensors/temp')
  })

  it('subscribe stores callback', async () => {
    const device = new IoTDevice({ deviceId: 'mq1', protocol: 'mqtt' })
    await adapter.connect(device)
    let received = null
    await adapter.subscribe(device, 'sensors/temp', (msg) => { received = msg })
    // Simulate incoming message via the adapter's internal delivery
    adapter._deliverMessage(device.deviceId, 'sensors/temp', { value: 22 })
    assert.deepEqual(received, { value: 22 })
  })

  it('unsubscribe removes callback', async () => {
    const device = new IoTDevice({ deviceId: 'mq1', protocol: 'mqtt' })
    await adapter.connect(device)
    let count = 0
    await adapter.subscribe(device, 'sensors/temp', () => { count++ })
    await adapter.unsubscribe(device, 'sensors/temp')
    adapter._deliverMessage(device.deviceId, 'sensors/temp', {})
    assert.equal(count, 0)
  })
})

// ---------------------------------------------------------------------------
// HttpAdapter
// ---------------------------------------------------------------------------

describe('HttpAdapter', () => {
  let calls
  let mockFetch
  let adapter
  let intervals

  beforeEach(() => {
    calls = []
    mockFetch = async (url, opts) => {
      calls.push({ url, opts })
      return { ok: true, json: async () => ({ value: 1 }) }
    }
    adapter = new HttpAdapter({ fetchFn: mockFetch })
    intervals = []
  })

  afterEach(() => {
    // Clear any polling intervals the adapter may have started
    adapter._clearAllIntervals()
  })

  it('constructor sets protocol to http', () => {
    assert.equal(adapter.protocol, 'http')
  })

  it('connect verifies endpoint with HEAD', async () => {
    const device = new IoTDevice({ deviceId: 'h1', protocol: 'http', endpoint: 'https://api.device.local' })
    await adapter.connect(device)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://api.device.local')
    assert.equal(calls[0].opts.method, 'HEAD')
  })

  it('disconnect clears state', async () => {
    const device = new IoTDevice({ deviceId: 'h1', protocol: 'http', endpoint: 'https://api.device.local' })
    await adapter.connect(device)
    await adapter.disconnect(device)
    // Should not throw on double disconnect
    await adapter.disconnect(device)
  })

  it('send POSTs to endpoint', async () => {
    const device = new IoTDevice({ deviceId: 'h1', protocol: 'http', endpoint: 'https://api.device.local/cmd' })
    await adapter.connect(device)
    calls.length = 0
    await adapter.send(device, { action: 'toggle' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].opts.method, 'POST')
    assert.equal(calls[0].url, 'https://api.device.local/cmd')
    assert.deepEqual(JSON.parse(calls[0].opts.body), { action: 'toggle' })
  })

  it('subscribe starts polling', async () => {
    const device = new IoTDevice({ deviceId: 'h1', protocol: 'http', endpoint: 'https://api.device.local' })
    await adapter.connect(device)
    let received = null
    await adapter.subscribe(device, 'status', (msg) => { received = msg })
    // Verify subscribe didn't throw and adapter is still active
    assert.equal(adapter.active, true)
  })

  it('unsubscribe clears interval', async () => {
    const device = new IoTDevice({ deviceId: 'h1', protocol: 'http', endpoint: 'https://api.device.local' })
    await adapter.connect(device)
    await adapter.subscribe(device, 'status', () => {})
    await adapter.unsubscribe(device, 'status')
    // Should not throw on double unsubscribe
    await adapter.unsubscribe(device, 'status')
  })
})

// ---------------------------------------------------------------------------
// DirectAdapter
// ---------------------------------------------------------------------------

describe('DirectAdapter', () => {
  let sentData
  let dataCb
  let mockPeripheral
  let mockPeripheralManager

  beforeEach(() => {
    sentData = []
    dataCb = null
    mockPeripheral = {
      id: 'p1',
      name: 'Test Serial',
      type: 'serial',
      connected: true,
      connect: async () => {},
      disconnect: async () => {},
      send: async (d) => sentData.push(d),
      onData: (cb) => { dataCb = cb },
      offData: () => { dataCb = null },
      toJSON: () => ({ id: 'p1', name: 'Test Serial', type: 'serial', connected: true }),
    }
    mockPeripheralManager = {
      getDevice: (_id) => mockPeripheral,
      listDevices: () => [mockPeripheral],
    }
  })

  it('constructor sets protocol to direct', () => {
    const adapter = new DirectAdapter({ peripheralManager: mockPeripheralManager })
    assert.equal(adapter.protocol, 'direct')
  })

  it('connect gets peripheral from manager', async () => {
    const adapter = new DirectAdapter({ peripheralManager: mockPeripheralManager })
    const device = new IoTDevice({ deviceId: 'p1', protocol: 'direct' })
    await adapter.connect(device)
    assert.equal(adapter.active, true)
  })

  it('send delegates to peripheral.send', async () => {
    const adapter = new DirectAdapter({ peripheralManager: mockPeripheralManager })
    const device = new IoTDevice({ deviceId: 'p1', protocol: 'direct' })
    await adapter.connect(device)
    await adapter.send(device, { value: 99 })
    assert.equal(sentData.length, 1)
    assert.deepEqual(sentData[0], { value: 99 })
  })

  it('subscribe wires peripheral.onData', async () => {
    const adapter = new DirectAdapter({ peripheralManager: mockPeripheralManager })
    const device = new IoTDevice({ deviceId: 'p1', protocol: 'direct' })
    await adapter.connect(device)
    let received = null
    await adapter.subscribe(device, 'data', (msg) => { received = msg })
    // Simulate data callback
    dataCb({ value: 42 })
    assert.deepEqual(received, { value: 42 })
  })

  it('toIoTDevice converts peripheral to IoTDevice', () => {
    const iotDevice = DirectAdapter.toIoTDevice(mockPeripheral)
    assert.equal(iotDevice.deviceId, 'p1')
    assert.equal(iotDevice.name, 'Test Serial')
    assert.equal(iotDevice.protocol, 'direct')
  })
})

// ---------------------------------------------------------------------------
// IoTBridge
// ---------------------------------------------------------------------------

describe('IoTBridge', () => {
  let bridge
  let sent
  let mockTransport
  let mockAdapter

  beforeEach(() => {
    sent = []
    mockTransport = {
      send: (data) => sent.push(data),
      close: () => {},
      connected: true,
    }
    mockAdapter = {
      protocol: 'mqtt',
      active: false,
      connect: async (_device) => {},
      disconnect: async (_device) => {},
      send: async (_device, payload) => { sent.push(payload) },
      subscribe: async (_device, _topic, _cb) => {},
      unsubscribe: async (_device, _topic) => {},
    }
    bridge = new IoTBridge()
  })

  it('constructor creates instance', () => {
    assert.ok(bridge)
  })

  it('registerAdapter adds adapter and send delegates correctly', async () => {
    bridge.registerAdapter('mqtt', mockAdapter)
    const device = new IoTDevice({ deviceId: 'ra1', protocol: 'mqtt' })
    await bridge.addDevice(device)
    await bridge.send('ra1', { test: 1 })
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0], { test: 1 })
  })

  it('addDevice stores and auto-connects', async () => {
    bridge.registerAdapter('mqtt', mockAdapter)
    const device = new IoTDevice({ deviceId: 'b1', protocol: 'mqtt' })
    let connected = false
    mockAdapter.connect = async () => { connected = true }
    await bridge.addDevice(device)
    assert.equal(bridge.getDevice('b1').deviceId, 'b1')
    assert.equal(connected, true)
  })

  it('removeDevice disconnects and removes', async () => {
    bridge.registerAdapter('mqtt', mockAdapter)
    const device = new IoTDevice({ deviceId: 'b1', protocol: 'mqtt' })
    await bridge.addDevice(device)
    let disconnected = false
    mockAdapter.disconnect = async () => { disconnected = true }
    await bridge.removeDevice('b1')
    assert.equal(bridge.getDevice('b1'), undefined)
    assert.equal(disconnected, true)
  })

  it('getDevice returns device', async () => {
    const device = new IoTDevice({ deviceId: 'b2', protocol: 'http' })
    await bridge.addDevice(device)
    assert.equal(bridge.getDevice('b2').deviceId, 'b2')
  })

  it('listDevices returns all', async () => {
    await bridge.addDevice(new IoTDevice({ deviceId: 'a', protocol: 'mqtt' }))
    await bridge.addDevice(new IoTDevice({ deviceId: 'b', protocol: 'http' }))
    assert.equal(bridge.listDevices().length, 2)
  })

  it('listDevices filters by protocol', async () => {
    await bridge.addDevice(new IoTDevice({ deviceId: 'a', protocol: 'mqtt' }))
    await bridge.addDevice(new IoTDevice({ deviceId: 'b', protocol: 'http' }))
    const result = bridge.listDevices({ protocol: 'mqtt' })
    assert.equal(result.length, 1)
    assert.equal(result[0].deviceId, 'a')
  })

  it('listDevices filters by capability', async () => {
    await bridge.addDevice(new IoTDevice({ deviceId: 'a', protocol: 'mqtt', capabilities: ['read', 'stream'] }))
    await bridge.addDevice(new IoTDevice({ deviceId: 'b', protocol: 'http', capabilities: ['write'] }))
    const result = bridge.listDevices({ capability: 'stream' })
    assert.equal(result.length, 1)
    assert.equal(result[0].deviceId, 'a')
  })

  it('send delegates to correct adapter', async () => {
    bridge.registerAdapter('mqtt', mockAdapter)
    const device = new IoTDevice({ deviceId: 'b1', protocol: 'mqtt' })
    await bridge.addDevice(device)
    await bridge.send('b1', { temp: 23 })
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0], { temp: 23 })
  })

  it('subscribe delegates to adapter', async () => {
    let subArgs = null
    mockAdapter.subscribe = async (device, topic, cb) => { subArgs = { deviceId: device.deviceId, topic } }
    bridge.registerAdapter('mqtt', mockAdapter)
    const device = new IoTDevice({ deviceId: 'b1', protocol: 'mqtt' })
    await bridge.addDevice(device)
    await bridge.subscribe('b1', 'sensors/temp', () => {})
    assert.equal(subArgs.deviceId, 'b1')
    assert.equal(subArgs.topic, 'sensors/temp')
  })

  it('onDeviceEvent/dispatchEvent fires callbacks', () => {
    const events = []
    bridge.onDeviceEvent((ev) => events.push(ev))
    bridge.dispatchEvent({ type: 'device_added', deviceId: 'x' })
    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'device_added')
  })

  it('importFromPeripheralManager converts and adds devices', async () => {
    const mockPm = {
      listDevices: () => [
        { id: 'p1', name: 'Sensor', type: 'serial', connected: true },
        { id: 'p2', name: 'BLE', type: 'bluetooth', connected: false },
      ],
    }
    const count = await bridge.importFromPeripheralManager(mockPm)
    assert.equal(count, 2)
    assert.equal(bridge.listDevices().length, 2)
    assert.equal(bridge.getDevice('p1').protocol, 'direct')
  })
})

// ---------------------------------------------------------------------------
// IoTTelemetry
// ---------------------------------------------------------------------------

describe('IoTTelemetry', () => {
  let telemetry

  beforeEach(() => {
    telemetry = new IoTTelemetry({ maxSamples: 5 })
  })

  it('constructor creates instance with defaults', () => {
    const t = new IoTTelemetry()
    assert.ok(t)
  })

  it('record adds sample', () => {
    telemetry.record('dev-1', 42)
    const latest = telemetry.getLatest('dev-1')
    assert.equal(latest.value, 42)
    assert.ok(typeof latest.ts === 'number')
  })

  it('record respects maxSamples (ring buffer)', () => {
    for (let i = 0; i < 8; i++) {
      telemetry.record('dev-1', i)
    }
    const all = telemetry.query('dev-1')
    assert.equal(all.length, 5)
    // Should have kept the latest 5: 3,4,5,6,7
    assert.equal(all[0].value, 3)
    assert.equal(all[4].value, 7)
  })

  it('query returns all samples', () => {
    telemetry.record('dev-1', 10)
    telemetry.record('dev-1', 20)
    const all = telemetry.query('dev-1')
    assert.equal(all.length, 2)
  })

  it('query filters by since/until', () => {
    const now = Date.now()
    // Manually push samples with controlled timestamps
    telemetry.record('dev-1', 1)
    telemetry.record('dev-1', 2)
    telemetry.record('dev-1', 3)
    const samples = telemetry.query('dev-1')
    // All samples should be returned since they were just recorded
    assert.equal(samples.length, 3)
    // Filter using since = first sample ts, until = last sample ts
    const since = samples[0].ts
    const until = samples[2].ts
    const filtered = telemetry.query('dev-1', since, until)
    assert.ok(filtered.length >= 1)
  })

  it('getLatest returns most recent', () => {
    telemetry.record('dev-1', 100)
    telemetry.record('dev-1', 200)
    assert.equal(telemetry.getLatest('dev-1').value, 200)
  })

  it('getLatest returns null for unknown device', () => {
    assert.equal(telemetry.getLatest('unknown'), null)
  })

  it('getStats computes min/max/avg/count/last', () => {
    telemetry.record('dev-1', 10)
    telemetry.record('dev-1', 20)
    telemetry.record('dev-1', 30)
    const stats = telemetry.getStats('dev-1')
    assert.equal(stats.min, 10)
    assert.equal(stats.max, 30)
    assert.equal(stats.avg, 20)
    assert.equal(stats.count, 3)
    assert.equal(stats.last, 30)
  })

  it('getStats returns null for unknown device', () => {
    assert.equal(telemetry.getStats('unknown'), null)
  })

  it('flush clears device samples', () => {
    telemetry.record('dev-1', 1)
    telemetry.record('dev-2', 2)
    telemetry.flush('dev-1')
    assert.equal(telemetry.getLatest('dev-1'), null)
    assert.equal(telemetry.getLatest('dev-2').value, 2)
  })

  it('flush with no arg clears all', () => {
    telemetry.record('dev-1', 1)
    telemetry.record('dev-2', 2)
    telemetry.flush()
    assert.equal(telemetry.getLatest('dev-1'), null)
    assert.equal(telemetry.getLatest('dev-2'), null)
  })

  it('export returns snapshot', () => {
    telemetry.record('dev-1', 42)
    telemetry.record('dev-2', 99)
    const snapshot = telemetry.export()
    assert.ok(snapshot['dev-1'])
    assert.ok(snapshot['dev-2'])
    assert.equal(snapshot['dev-1'].length, 1)
    assert.equal(snapshot['dev-1'][0].value, 42)
    // Single device export
    const single = telemetry.export('dev-1')
    assert.ok(single['dev-1'])
    assert.equal(single['dev-2'], undefined)
  })
})

// ---------------------------------------------------------------------------
// IoTBridge wire protocol
// ---------------------------------------------------------------------------

describe('IoTBridge wire protocol', () => {
  let bridge
  let sent
  let sendFn
  let mockAdapter

  beforeEach(() => {
    sent = []
    sendFn = (targetId, msg) => sent.push({ targetId, msg })
    mockAdapter = {
      protocol: 'mqtt',
      active: false,
      connect: async () => {},
      disconnect: async () => {},
      send: async (_device, payload) => { sent.push({ adapterSend: payload }) },
      subscribe: async () => {},
      unsubscribe: async () => {},
    }
    bridge = new IoTBridge({ sendFn })
    bridge.registerAdapter('mqtt', mockAdapter)
  })

  it('handleMessage IOT_REGISTER adds device', async () => {
    const device = new IoTDevice({ deviceId: 'r1', protocol: 'mqtt' })
    await bridge.handleMessage('podB', { type: IOT_REGISTER, device: device.toJSON() })
    assert.equal(bridge.getDevice('r1').deviceId, 'r1')
  })

  it('handleMessage IOT_TELEMETRY dispatches telemetry event', async () => {
    const events = []
    bridge.onDeviceEvent((ev) => events.push(ev))
    await bridge.handleMessage('podB', { type: IOT_TELEMETRY, deviceId: 'dev1', data: { temp: 22 } })
    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'telemetry')
    assert.equal(events[0].fromId, 'podB')
    assert.deepEqual(events[0].data, { temp: 22 })
  })

  it('handleMessage IOT_COMMAND sends to local device and responds with IOT_STATUS', async () => {
    const device = new IoTDevice({ deviceId: 'cmd1', protocol: 'mqtt' })
    await bridge.addDevice(device)
    sent.length = 0
    await bridge.handleMessage('podB', { type: IOT_COMMAND, deviceId: 'cmd1', payload: { action: 'on' } })
    // Should have sent to adapter + sent IOT_STATUS response
    const adapterSend = sent.find(s => s.adapterSend)
    assert.ok(adapterSend)
    assert.deepEqual(adapterSend.adapterSend, { action: 'on' })
    const statusMsg = sent.find(s => s.msg && s.msg.type === IOT_STATUS)
    assert.ok(statusMsg)
    assert.equal(statusMsg.msg.status, 'ok')
  })

  it('handleMessage IOT_STATUS dispatches status event', async () => {
    const events = []
    bridge.onDeviceEvent((ev) => events.push(ev))
    await bridge.handleMessage('podB', { type: IOT_STATUS, deviceId: 'dev1', status: 'ok' })
    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'status')
    assert.equal(events[0].status, 'ok')
  })

  it('announceDevice sends IOT_REGISTER to all peers', () => {
    const device = new IoTDevice({ deviceId: 'ann1', protocol: 'mqtt' })
    bridge.announceDevice(['podB', 'podC'], device)
    assert.equal(sent.length, 2)
    assert.equal(sent[0].msg.type, IOT_REGISTER)
    assert.equal(sent[0].msg.device.deviceId, 'ann1')
    assert.equal(sent[1].targetId, 'podC')
  })

  it('sendCommand sends IOT_COMMAND via sendFn', () => {
    bridge.sendCommand('podB', 'dev1', { action: 'toggle' })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].targetId, 'podB')
    assert.equal(sent[0].msg.type, IOT_COMMAND)
    assert.equal(sent[0].msg.deviceId, 'dev1')
    assert.deepEqual(sent[0].msg.payload, { action: 'toggle' })
  })

  it('handleMessage ignores unknown type', async () => {
    await bridge.handleMessage('podB', { type: 0xFF })
    assert.equal(sent.length, 0)
  })

  it('works without sendFn (graceful no-op)', () => {
    const noSendBridge = new IoTBridge()
    const device = new IoTDevice({ deviceId: 'ns1', protocol: 'mqtt' })
    // Should not throw
    noSendBridge.announceDevice(['podB'], device)
    noSendBridge.sendCommand('podB', 'ns1', { action: 'on' })
  })

  it('handleMessage IOT_COMMAND with unknown deviceId responds not_found', async () => {
    await bridge.handleMessage('podB', { type: IOT_COMMAND, deviceId: 'nonexistent', payload: { x: 1 } })
    const statusMsg = sent.find(s => s.msg && s.msg.type === IOT_STATUS)
    assert.ok(statusMsg)
    assert.equal(statusMsg.msg.status, 'not_found')
    assert.equal(statusMsg.msg.deviceId, 'nonexistent')
  })

  it('handleMessage IOT_COMMAND reports error status when adapter.send throws', async () => {
    const failAdapter = {
      ...mockAdapter,
      send: async () => { throw new Error('send failed') },
    }
    bridge.registerAdapter('mqtt', failAdapter)
    const device = new IoTDevice({ deviceId: 'fail1', protocol: 'mqtt' })
    await bridge.addDevice(device)
    sent.length = 0
    await bridge.handleMessage('podB', { type: IOT_COMMAND, deviceId: 'fail1', payload: {} })
    const statusMsg = sent.find(s => s.msg && s.msg.type === IOT_STATUS)
    assert.ok(statusMsg)
    assert.equal(statusMsg.msg.status, 'error')
  })

  it('handleMessage IOT_REGISTER with missing device field is ignored', async () => {
    const deviceCount = bridge.listDevices().length
    await bridge.handleMessage('podB', { type: IOT_REGISTER })
    assert.equal(bridge.listDevices().length, deviceCount)
  })
})
