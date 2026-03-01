// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-hardware-enhanced.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── localStorage polyfill for Node.js ────────────────────────────
if (typeof globalThis.localStorage === 'undefined') {
  const store = {};
  globalThis.localStorage = {
    getItem(k) { return store[k] ?? null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
  };
}

import { lsKey } from '../clawser-state.js';

// ── hw_monitor Tool (Block 13) ──────────────────────────────────

describe('HwMonitorTool', () => {
  it('exports HwMonitorTool class', async () => {
    const mod = await import('../clawser-hardware.js');
    assert.ok(mod.HwMonitorTool, 'should export HwMonitorTool');
  });

  it('has correct tool metadata', async () => {
    const { HwMonitorTool, PeripheralManager } = await import('../clawser-hardware.js');
    const mgr = new PeripheralManager();
    const tool = new HwMonitorTool(mgr);

    assert.equal(tool.name, 'hw_monitor');
    assert.ok(tool.description.toLowerCase().includes('monitor'));
    assert.equal(tool.permission, 'approve');
    assert.ok(tool.parameters.properties.device);
  });

  it('returns error when device not found', async () => {
    const { HwMonitorTool, PeripheralManager } = await import('../clawser-hardware.js');
    const mgr = new PeripheralManager();
    const tool = new HwMonitorTool(mgr);

    const result = await tool.execute({ device: 'nonexistent' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found'));
  });
});

// ── Peripheral State Persistence (Block 13) ─────────────────────

describe('PeripheralManager persistence', () => {
  it('exposes saveState() method', async () => {
    const { PeripheralManager } = await import('../clawser-hardware.js');
    const mgr = new PeripheralManager();
    assert.equal(typeof mgr.saveState, 'function');
  });

  it('exposes restoreState() method', async () => {
    const { PeripheralManager } = await import('../clawser-hardware.js');
    const mgr = new PeripheralManager();
    assert.equal(typeof mgr.restoreState, 'function');
  });

  it('saveState persists device metadata to localStorage', async () => {
    const { PeripheralManager } = await import('../clawser-hardware.js');
    const mgr = new PeripheralManager();

    // Can't add real devices in test, but saveState should work with empty state
    mgr.saveState();
    const stored = localStorage.getItem(lsKey.peripherals('default'));
    assert.ok(stored, 'should save to localStorage');
    const data = JSON.parse(stored);
    assert.ok(Array.isArray(data.devices), 'should have devices array');
  });

  it('restoreState loads metadata from localStorage', async () => {
    const { PeripheralManager } = await import('../clawser-hardware.js');
    localStorage.setItem(lsKey.peripherals('default'), JSON.stringify({
      devices: [
        { id: 'dev_1', name: 'Arduino', type: 'serial', config: { baudRate: 9600 } },
      ],
    }));

    const mgr = new PeripheralManager();
    const state = mgr.restoreState();
    assert.ok(state, 'should return restored state');
    assert.equal(state.devices.length, 1);
    assert.equal(state.devices[0].name, 'Arduino');

    localStorage.removeItem(lsKey.peripherals('default'));
  });

  it('restoreState returns null for missing localStorage', async () => {
    const { PeripheralManager } = await import('../clawser-hardware.js');
    localStorage.removeItem(lsKey.peripherals('default'));

    const mgr = new PeripheralManager();
    const state = mgr.restoreState();
    assert.equal(state, null);
  });
});

// ── Hardware Event Forwarding (Block 13) ─────────────────────────

describe('Hardware event forwarding', () => {
  it('PeripheralManager exposes onDeviceData callback', async () => {
    const { PeripheralManager } = await import('../clawser-hardware.js');
    const mgr = new PeripheralManager();
    assert.equal(typeof mgr.onDeviceData, 'function');
  });

  it('onDeviceData registers a callback', async () => {
    const { PeripheralManager } = await import('../clawser-hardware.js');
    const mgr = new PeripheralManager();

    let received = null;
    mgr.onDeviceData((deviceId, data) => {
      received = { deviceId, data };
    });

    // Simulate internal data event dispatch
    mgr.dispatchDeviceData('dev_1', new Uint8Array([1, 2, 3]));
    assert.ok(received, 'callback should have been called');
    assert.equal(received.deviceId, 'dev_1');
  });

  it('offDeviceData removes a callback', async () => {
    const { PeripheralManager } = await import('../clawser-hardware.js');
    const mgr = new PeripheralManager();

    let count = 0;
    const handler = () => { count++; };
    mgr.onDeviceData(handler);
    mgr.dispatchDeviceData('dev_1', new Uint8Array([1]));
    assert.equal(count, 1);

    mgr.offDeviceData(handler);
    mgr.dispatchDeviceData('dev_1', new Uint8Array([2]));
    assert.equal(count, 1, 'should not fire after removal');
  });
});
