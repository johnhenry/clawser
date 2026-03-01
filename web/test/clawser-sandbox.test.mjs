// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-sandbox.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub BrowserTool before import
globalThis.BrowserTool = class { constructor() {} };

import {
  SANDBOX_TIERS,
  CAPABILITIES,
  SANDBOX_LIMITS,
  CapabilityGate,
} from '../clawser-sandbox.js';

// ── Constants ───────────────────────────────────────────────────

describe('SANDBOX_TIERS', () => {
  it('has expected tier values', () => {
    assert.equal(SANDBOX_TIERS.TRUSTED, 0);
    assert.equal(SANDBOX_TIERS.WORKER, 1);
    assert.equal(SANDBOX_TIERS.WASM, 2);
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(SANDBOX_TIERS));
  });
});

describe('CAPABILITIES', () => {
  it('has expected capability entries', () => {
    assert.ok(CAPABILITIES['net:fetch']);
    assert.ok(CAPABILITIES['fs:read']);
    assert.ok(CAPABILITIES['dom:read']);
    assert.ok(CAPABILITIES['console:log']);
  });

  it('each capability has tier and description', () => {
    for (const [, cap] of Object.entries(CAPABILITIES)) {
      assert.equal(typeof cap.tier, 'number');
      assert.equal(typeof cap.description, 'string');
    }
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(CAPABILITIES));
  });
});

describe('SANDBOX_LIMITS', () => {
  it('has limits for WORKER tier', () => {
    const limits = SANDBOX_LIMITS[SANDBOX_TIERS.WORKER];
    assert.ok(limits);
    assert.equal(typeof limits.timeout, 'number');
    assert.equal(typeof limits.maxMemory, 'number');
  });

  it('has limits for WASM tier', () => {
    const limits = SANDBOX_LIMITS[SANDBOX_TIERS.WASM];
    assert.ok(limits);
    assert.equal(typeof limits.fuelLimit, 'number');
    assert.equal(typeof limits.maxMemory, 'number');
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(SANDBOX_LIMITS));
  });
});

// ── CapabilityGate ──────────────────────────────────────────────

describe('CapabilityGate', () => {
  let gate;

  beforeEach(() => {
    gate = new CapabilityGate(['net:fetch', 'fs:read']);
  });

  it('constructor accepts initial capabilities', () => {
    assert.equal(gate.size, 2);
    assert.deepEqual(gate.allowed.sort(), ['fs:read', 'net:fetch']);
  });

  it('constructor defaults to empty', () => {
    const empty = new CapabilityGate();
    assert.equal(empty.size, 0);
  });

  it('has returns true for granted capability', () => {
    assert.equal(gate.has('net:fetch'), true);
    assert.equal(gate.has('dom:write'), false);
  });

  it('check does not throw for allowed capability', () => {
    assert.doesNotThrow(() => gate.check('net:fetch'));
  });

  it('check throws for denied capability', () => {
    assert.throws(() => gate.check('dom:write'), /Capability denied/);
  });

  it('grant adds a capability', () => {
    gate.grant('dom:read');
    assert.equal(gate.has('dom:read'), true);
    assert.equal(gate.size, 3);
  });

  it('revoke removes a capability', () => {
    gate.revoke('net:fetch');
    assert.equal(gate.has('net:fetch'), false);
    assert.equal(gate.size, 1);
  });

  it('validateForTier returns valid when all caps allowed at tier', () => {
    // net:fetch is tier 1, fs:read is tier 1
    const result = gate.validateForTier(1);
    assert.equal(result.valid, true);
    assert.deepEqual(result.denied, []);
  });

  it('validateForTier returns denied caps for higher tier', () => {
    // net:fetch and fs:read are tier 1; at tier 2 (WASM), tier<2 means 0,1 are denied
    const result = gate.validateForTier(2);
    assert.equal(result.valid, false);
    assert.ok(result.denied.length > 0);
  });

  it('createProxy checks capabilities before calling', () => {
    const gate2 = new CapabilityGate(['net:fetch']);
    let called = false;
    const proxy = gate2.createProxy({
      'net:fetch': () => { called = true; return 'ok'; },
      'fs:read': () => { return 'nope'; },
    });

    assert.equal(proxy.net_fetch(), 'ok');
    assert.equal(called, true);
    assert.throws(() => proxy.fs_read(), /Capability denied/);
  });

  it('allowed getter returns copy', () => {
    const list = gate.allowed;
    assert.ok(Array.isArray(list));
    assert.equal(list.length, 2);
  });
});
