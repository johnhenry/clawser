// Sprint 19 — Screenshot + Skill Signing + Cost Threshold + Profile Export + Busy Indicator + Workflow Chaining
// RED phase: 30 tests, all expected to fail initially.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ── Global polyfills for Node.js environment ────────────────────
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
if (typeof globalThis.location === 'undefined') {
  globalThis.location = { href: 'http://localhost/', origin: 'http://localhost', pathname: '/' };
}
if (typeof globalThis.BroadcastChannel === 'undefined') {
  globalThis.BroadcastChannel = class {
    onmessage = null;
    postMessage() {}
    close() {}
  };
}
if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = globalThis.crypto || {};
  globalThis.crypto.randomUUID = () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── 1. Browser screenshot tool (5 tests) ────────────────────────
// NOTE: Dead BrowserScreenshotTool was removed from clawser-browser-auto.js.
// The active version (ScreenshotTool) lives in clawser-tools.js.
// These tests now verify the removal and the active tool.

describe('Browser screenshot tool', () => {
  it('BrowserScreenshotTool removed from browser-auto module', async () => {
    const mod = await import('../clawser-browser-auto.js');
    assert.equal(mod.BrowserScreenshotTool, undefined, 'dead copy should be removed');
  });

  it('ScreenshotTool exists in clawser-tools.js', async () => {
    const { ScreenshotTool } = await import('../clawser-tools.js');
    assert.ok(ScreenshotTool, 'active ScreenshotTool should exist');
  });

  it('ScreenshotTool has correct name', async () => {
    const { ScreenshotTool } = await import('../clawser-tools.js');
    const tool = new ScreenshotTool();
    assert.equal(tool.name, 'browser_screenshot');
  });

  it('ScreenshotTool has selector parameter', async () => {
    const { ScreenshotTool } = await import('../clawser-tools.js');
    const tool = new ScreenshotTool();
    assert.ok(tool.parameters.properties.selector);
  });

  it('ScreenshotTool has browser permission', async () => {
    const { ScreenshotTool } = await import('../clawser-tools.js');
    const tool = new ScreenshotTool();
    assert.equal(tool.permission, 'browser');
  });
});

// ── 2. Skill verification/signing (5 tests) ────────────────────

describe('Skill verification', () => {
  let computeSkillHash, verifySkillIntegrity;

  before(async () => {
    const mod = await import('../clawser-skills.js');
    computeSkillHash = mod.computeSkillHash;
    verifySkillIntegrity = mod.verifySkillIntegrity;
  });

  it('computeSkillHash function exists', () => {
    assert.equal(typeof computeSkillHash, 'function');
  });

  it('returns a hex string', () => {
    const hash = computeSkillHash('# My Skill\nDo things');
    assert.equal(typeof hash, 'string');
    assert.ok(/^[0-9a-f]+$/.test(hash));
  });

  it('same content produces same hash', () => {
    const h1 = computeSkillHash('test content');
    const h2 = computeSkillHash('test content');
    assert.equal(h1, h2);
  });

  it('different content produces different hash', () => {
    const h1 = computeSkillHash('content A');
    const h2 = computeSkillHash('content B');
    assert.notEqual(h1, h2);
  });

  it('verifySkillIntegrity checks hash', () => {
    const content = '# Skill\nBody text';
    const hash = computeSkillHash(content);
    assert.equal(verifySkillIntegrity(content, hash), true);
    assert.equal(verifySkillIntegrity(content, 'badhash'), false);
  });
});

// ── 3. Configurable cost threshold (5 tests) ───────────────────

describe('Configurable cost threshold', () => {
  let CostLedger;

  before(async () => {
    const mod = await import('../clawser-providers.js');
    CostLedger = mod.CostLedger;
  });

  it('CostLedger accepts threshold option', () => {
    const ledger = new CostLedger({ thresholdUsd: 5.0 });
    assert.equal(ledger.thresholdUsd, 5.0);
  });

  it('isOverThreshold returns false when under', () => {
    const ledger = new CostLedger({ thresholdUsd: 1.0 });
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    assert.equal(ledger.isOverThreshold(), false);
  });

  it('isOverThreshold returns true when over', () => {
    const ledger = new CostLedger({ thresholdUsd: 0.05 });
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.03 });
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.03 });
    assert.equal(ledger.isOverThreshold(), true);
  });

  it('default threshold is Infinity (no limit)', () => {
    const ledger = new CostLedger();
    assert.equal(ledger.thresholdUsd, Infinity);
    ledger.record({ model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 999 });
    assert.equal(ledger.isOverThreshold(), false);
  });

  it('setThreshold updates the threshold', () => {
    const ledger = new CostLedger();
    ledger.setThreshold(2.5);
    assert.equal(ledger.thresholdUsd, 2.5);
  });
});

// ── 4. Profile import/export (5 tests) ──────────────────────────

describe('Profile import/export', () => {
  let AuthProfileManager;

  before(async () => {
    const mod = await import('../clawser-auth-profiles.js');
    AuthProfileManager = mod.AuthProfileManager;
  });

  it('exportProfiles returns serializable data', async () => {
    const mockVault = {
      store: async () => {},
      retrieve: async () => '{}',
      delete: async () => {},
      isLocked: false,
    };
    const mgr = new AuthProfileManager({ vault: mockVault });
    await mgr.addProfile('openai', 'Test Key', { apiKey: 'sk-test' });
    const exported = mgr.exportProfiles();
    assert.ok(Array.isArray(exported));
    assert.equal(exported.length, 1);
    assert.equal(exported[0].provider, 'openai');
  });

  it('exportProfiles excludes credentials', () => {
    const mgr = new AuthProfileManager();
    const exported = mgr.exportProfiles();
    assert.ok(Array.isArray(exported));
    // No credentials in exported data
    for (const p of exported) {
      assert.equal(p.credentials, undefined);
    }
  });

  it('importProfiles validates structure', () => {
    const mgr = new AuthProfileManager();
    const result = mgr.importProfiles([
      { id: 'p1', name: 'Test', provider: 'openai', isDefault: false },
    ]);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
  });

  it('importProfiles rejects invalid input', () => {
    const mgr = new AuthProfileManager();
    assert.deepEqual(mgr.importProfiles(null), []);
    assert.deepEqual(mgr.importProfiles('bad'), []);
  });

  it('importProfiles preserves profile metadata', () => {
    const mgr = new AuthProfileManager();
    const result = mgr.importProfiles([
      { id: 'p1', name: 'Key 1', provider: 'openai', isDefault: true },
    ]);
    assert.equal(result[0].name, 'Key 1');
    assert.equal(result[0].provider, 'openai');
  });
});

// ── 5. "Agent is busy" cross-tab indicator (5 tests) ────────────

describe('Agent busy indicator', () => {
  let AgentBusyIndicator;

  before(async () => {
    const mod = await import('../clawser-daemon.js');
    AgentBusyIndicator = mod.AgentBusyIndicator;
  });

  it('AgentBusyIndicator class exists', () => {
    assert.ok(AgentBusyIndicator);
  });

  it('starts in idle state', () => {
    const indicator = new AgentBusyIndicator({ channel: { postMessage() {}, close() {} } });
    assert.equal(indicator.isBusy, false);
  });

  it('setBusy sets busy state', () => {
    const indicator = new AgentBusyIndicator({ channel: { postMessage() {}, close() {} } });
    indicator.setBusy(true, 'processing');
    assert.equal(indicator.isBusy, true);
    assert.equal(indicator.reason, 'processing');
  });

  it('setBusy(false) clears busy state', () => {
    const indicator = new AgentBusyIndicator({ channel: { postMessage() {}, close() {} } });
    indicator.setBusy(true, 'working');
    indicator.setBusy(false);
    assert.equal(indicator.isBusy, false);
  });

  it('status returns current state', () => {
    const indicator = new AgentBusyIndicator({ channel: { postMessage() {}, close() {} } });
    indicator.setBusy(true, 'thinking');
    const status = indicator.status();
    assert.equal(status.busy, true);
    assert.equal(status.reason, 'thinking');
    assert.equal(typeof status.since, 'number');
  });
});

// ── 6. Multi-step workflow chaining (5 tests) ──────────────────

describe('Workflow chaining', () => {
  let WorkflowRecorder;

  before(async () => {
    const mod = await import('../clawser-browser-auto.js');
    WorkflowRecorder = mod.WorkflowRecorder;
  });

  it('WorkflowRecorder class exists', () => {
    assert.ok(WorkflowRecorder);
  });

  it('starts with empty steps', () => {
    const recorder = new WorkflowRecorder();
    assert.equal(recorder.steps.length, 0);
  });

  it('addStep records an action', () => {
    const recorder = new WorkflowRecorder();
    recorder.addStep({ action: 'click', selector: '#btn' });
    recorder.addStep({ action: 'fill', selector: '#input', value: 'test' });
    assert.equal(recorder.steps.length, 2);
    assert.equal(recorder.steps[0].action, 'click');
  });

  it('export returns serializable workflow', () => {
    const recorder = new WorkflowRecorder();
    recorder.addStep({ action: 'navigate', url: 'https://example.com' });
    recorder.addStep({ action: 'click', selector: '.btn' });
    const exported = recorder.export('My Workflow');
    assert.equal(exported.name, 'My Workflow');
    assert.ok(Array.isArray(exported.steps));
    assert.equal(exported.steps.length, 2);
  });

  it('clear resets the recorder', () => {
    const recorder = new WorkflowRecorder();
    recorder.addStep({ action: 'click', selector: '#a' });
    recorder.addStep({ action: 'click', selector: '#b' });
    recorder.clear();
    assert.equal(recorder.steps.length, 0);
  });
});
