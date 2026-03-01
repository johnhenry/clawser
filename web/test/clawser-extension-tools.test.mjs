// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-extension-tools.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Polyfills ────────────────────────────────────────────────────
// BrowserTool stub — must exist before importing extension-tools
globalThis.BrowserTool = class { constructor() {} };

// window stub — ExtensionRpcClient attaches a message listener
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    postMessage: () => {},
  };
}

// ── Dynamic import (after polyfills) ─────────────────────────────
const mod = await import('../clawser-extension-tools.js');
const {
  ExtensionRpcClient,
  getExtensionClient,
  destroyExtensionClient,
  updateExtensionBadge,
  initExtensionBadge,
  ExtStatusTool,
  ExtCapabilitiesTool,
  ExtTabsListTool,
  ExtNavigateTool,
  ExtClickTool,
  ExtTypeTool,
  ExtScreenshotTool,
  ExtConsoleTool,
  ExtEvaluateTool,
  ExtWaitTool,
  registerExtensionTools,
  createExtensionBridge,
} = mod;

// ── Mock RPC client ──────────────────────────────────────────────
function makeMockRpc(overrides = {}) {
  return {
    connected: false,
    capabilities: [],
    call: async () => ({}),
    ...overrides,
  };
}

// ── 1. ExtensionRpcClient ────────────────────────────────────────

describe('ExtensionRpcClient', () => {
  let client;

  beforeEach(() => {
    client = new ExtensionRpcClient();
  });

  it('constructor sets connected to false', () => {
    assert.equal(client.connected, false);
  });

  it('version defaults to null', () => {
    assert.equal(client.version, null);
  });

  it('capabilities defaults to empty array', () => {
    assert.deepStrictEqual(client.capabilities, []);
  });

  it('destroy sets connected to false', () => {
    // Even on a fresh client, destroy should not throw and leave connected as false
    client.destroy();
    assert.equal(client.connected, false);
  });
});

// ── 2. Tool class instantiation ──────────────────────────────────

describe('Extension tool classes', () => {
  const mockRpc = makeMockRpc();

  it('ExtStatusTool has name ext_status', () => {
    const tool = new ExtStatusTool(mockRpc);
    assert.equal(tool.name, 'ext_status');
  });

  it('ExtCapabilitiesTool has name ext_capabilities', () => {
    const tool = new ExtCapabilitiesTool(mockRpc);
    assert.equal(tool.name, 'ext_capabilities');
  });

  it('ExtTabsListTool has name ext_tabs_list', () => {
    const tool = new ExtTabsListTool(mockRpc);
    assert.equal(tool.name, 'ext_tabs_list');
  });

  it('ExtNavigateTool has name ext_navigate', () => {
    const tool = new ExtNavigateTool(mockRpc);
    assert.equal(tool.name, 'ext_navigate');
  });

  it('ExtClickTool has name ext_click', () => {
    const tool = new ExtClickTool(mockRpc);
    assert.equal(tool.name, 'ext_click');
  });

  it('ExtTypeTool has name ext_type', () => {
    const tool = new ExtTypeTool(mockRpc);
    assert.equal(tool.name, 'ext_type');
  });

  it('ExtScreenshotTool has name ext_screenshot', () => {
    const tool = new ExtScreenshotTool(mockRpc);
    assert.equal(tool.name, 'ext_screenshot');
  });

  it('ExtConsoleTool has name ext_console', () => {
    const tool = new ExtConsoleTool(mockRpc);
    assert.equal(tool.name, 'ext_console');
  });

  it('ExtEvaluateTool has name ext_evaluate', () => {
    const tool = new ExtEvaluateTool(mockRpc);
    assert.equal(tool.name, 'ext_evaluate');
  });

  it('ExtWaitTool has name ext_wait', () => {
    const tool = new ExtWaitTool(mockRpc);
    assert.equal(tool.name, 'ext_wait');
  });

  it('ExtStatusTool has permission read', () => {
    const tool = new ExtStatusTool(mockRpc);
    assert.equal(tool.permission, 'read');
  });

  it('ExtNavigateTool has permission approve', () => {
    const tool = new ExtNavigateTool(mockRpc);
    assert.equal(tool.permission, 'approve');
  });

  it('ExtStatusTool has a description string', () => {
    const tool = new ExtStatusTool(mockRpc);
    assert.equal(typeof tool.description, 'string');
    assert.ok(tool.description.length > 0);
  });
});

// ── 3. registerExtensionTools ────────────────────────────────────

describe('registerExtensionTools', () => {
  it('registers tools into a Map-like registry', () => {
    const registry = { tools: new Map(), register(tool) { this.tools.set(tool.name, tool); } };
    const mockRpc = makeMockRpc();
    registerExtensionTools(registry, mockRpc);
    assert.ok(registry.tools.size > 0);
  });

  it('registers at least 30 tools', () => {
    const registry = { tools: new Map(), register(tool) { this.tools.set(tool.name, tool); } };
    const mockRpc = makeMockRpc();
    registerExtensionTools(registry, mockRpc);
    // Header says 32 but actual count may vary as tools are added; sanity-check >=30
    assert.ok(registry.tools.size >= 30, `expected >=30 tools, got ${registry.tools.size}`);
  });
});

// ── 4. createExtensionBridge ─────────────────────────────────────

describe('createExtensionBridge', () => {
  it('returns a function', () => {
    const bridge = createExtensionBridge(makeMockRpc());
    assert.equal(typeof bridge, 'function');
  });

  it('bridge returns error when rpc is not connected', async () => {
    const bridge = createExtensionBridge(makeMockRpc({ connected: false }));
    const result = await bridge('click', {});
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not connected'));
  });
});
