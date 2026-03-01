// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-server-tools.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub BrowserTool before import
globalThis.BrowserTool = class { constructor() {} };

// Stub getServerManager — we mock it per-test via the module's import
// The server-tools module imports getServerManager from clawser-server.js,
// so we need a different approach: test the class structure (name, description, parameters, permission)
// and test execute() by providing a mock ServerManager via the module-level getServerManager.

// Since getServerManager is imported at module level, we need to mock clawser-server.js.
// We'll create a minimal mock that the module can import.

let mockServerManager;
const mockRoutes = [];
const mockLogs = [];

// Mock the server module
const originalImport = globalThis._serverMgrMock;
globalThis._mockServerMgr = {
  listRoutes: async (scope) => scope ? mockRoutes.filter(r => r.scope === scope) : [...mockRoutes],
  addRoute: async (route) => { const id = 'srv_' + Date.now(); mockRoutes.push({ id, ...route }); return id; },
  removeRoute: async (id) => { const idx = mockRoutes.findIndex(r => r.id === id); if (idx >= 0) mockRoutes.splice(idx, 1); },
  updateRoute: async (id, updates) => { const r = mockRoutes.find(r => r.id === id); if (r) Object.assign(r, updates); },
  getRouteById: async (id) => mockRoutes.find(r => r.id === id) || null,
  startServer: async (id) => { const r = mockRoutes.find(r => r.id === id); if (r) r.enabled = true; },
  stopServer: async (id) => { const r = mockRoutes.find(r => r.id === id); if (r) r.enabled = false; },
  getLogs: (id, limit) => mockLogs.slice(0, limit || 20),
  testRequest: async (hostname, port, path, opts) => ({
    status: 200, statusText: 'OK',
    headers: { 'content-type': 'text/plain' },
    body: `Hello from ${hostname}:${port}${path}`,
  }),
};

// We can't easily mock the import, so test class structure directly
import {
  ServerListTool, ServerAddTool, ServerRemoveTool, ServerUpdateTool,
  ServerStartTool, ServerStopTool, ServerLogsTool, ServerTestTool,
  registerServerTools,
} from '../clawser-server-tools.js';

describe('ServerListTool', () => {
  it('has correct name', () => {
    const tool = new ServerListTool();
    assert.equal(tool.name, 'server_list');
  });

  it('has read permission', () => {
    const tool = new ServerListTool();
    assert.equal(tool.permission, 'read');
  });

  it('has description', () => {
    const tool = new ServerListTool();
    assert.ok(tool.description.length > 0);
  });

  it('parameters include optional scope', () => {
    const tool = new ServerListTool();
    const params = tool.parameters;
    assert.equal(params.type, 'object');
    assert.ok('scope' in params.properties);
  });
});

describe('ServerAddTool', () => {
  it('has correct name', () => {
    const tool = new ServerAddTool(() => 'ws_test');
    assert.equal(tool.name, 'server_add');
  });

  it('has approve permission', () => {
    const tool = new ServerAddTool(() => 'ws_test');
    assert.equal(tool.permission, 'approve');
  });

  it('requires hostname and type', () => {
    const tool = new ServerAddTool(() => 'ws_test');
    const params = tool.parameters;
    assert.ok(params.required.includes('hostname'));
    assert.ok(params.required.includes('type'));
  });

  it('parameters include handler-specific fields', () => {
    const tool = new ServerAddTool(() => 'ws_test');
    const props = tool.parameters.properties;
    assert.ok('code' in props);
    assert.ok('staticRoot' in props);
    assert.ok('proxyTarget' in props);
    assert.ok('env' in props);
  });
});

describe('ServerRemoveTool', () => {
  it('has correct name', () => {
    const tool = new ServerRemoveTool();
    assert.equal(tool.name, 'server_remove');
  });

  it('has approve permission', () => {
    const tool = new ServerRemoveTool();
    assert.equal(tool.permission, 'approve');
  });

  it('requires id parameter', () => {
    const tool = new ServerRemoveTool();
    assert.deepEqual(tool.parameters.required, ['id']);
  });
});

describe('ServerUpdateTool', () => {
  it('has correct name', () => {
    const tool = new ServerUpdateTool();
    assert.equal(tool.name, 'server_update');
  });

  it('has approve permission', () => {
    const tool = new ServerUpdateTool();
    assert.equal(tool.permission, 'approve');
  });

  it('requires id parameter', () => {
    const tool = new ServerUpdateTool();
    assert.deepEqual(tool.parameters.required, ['id']);
  });

  it('parameters include updatable fields', () => {
    const tool = new ServerUpdateTool();
    const props = tool.parameters.properties;
    assert.ok('code' in props);
    assert.ok('env' in props);
    assert.ok('enabled' in props);
    assert.ok('proxyTarget' in props);
    assert.ok('staticRoot' in props);
  });
});

describe('ServerStartTool', () => {
  it('has correct name', () => {
    const tool = new ServerStartTool();
    assert.equal(tool.name, 'server_start');
  });

  it('has approve permission', () => {
    const tool = new ServerStartTool();
    assert.equal(tool.permission, 'approve');
  });

  it('requires id parameter', () => {
    const tool = new ServerStartTool();
    assert.deepEqual(tool.parameters.required, ['id']);
  });
});

describe('ServerStopTool', () => {
  it('has correct name', () => {
    const tool = new ServerStopTool();
    assert.equal(tool.name, 'server_stop');
  });

  it('has approve permission', () => {
    const tool = new ServerStopTool();
    assert.equal(tool.permission, 'approve');
  });

  it('requires id parameter', () => {
    const tool = new ServerStopTool();
    assert.deepEqual(tool.parameters.required, ['id']);
  });
});

describe('ServerLogsTool', () => {
  it('has correct name', () => {
    const tool = new ServerLogsTool();
    assert.equal(tool.name, 'server_logs');
  });

  it('has read permission', () => {
    const tool = new ServerLogsTool();
    assert.equal(tool.permission, 'read');
  });

  it('requires id parameter', () => {
    const tool = new ServerLogsTool();
    assert.deepEqual(tool.parameters.required, ['id']);
  });

  it('parameters include limit', () => {
    const tool = new ServerLogsTool();
    assert.ok('limit' in tool.parameters.properties);
  });
});

describe('ServerTestTool', () => {
  it('has correct name', () => {
    const tool = new ServerTestTool();
    assert.equal(tool.name, 'server_test');
  });

  it('has approve permission', () => {
    const tool = new ServerTestTool();
    assert.equal(tool.permission, 'approve');
  });

  it('requires hostname parameter', () => {
    const tool = new ServerTestTool();
    assert.deepEqual(tool.parameters.required, ['hostname']);
  });

  it('parameters include HTTP fields', () => {
    const tool = new ServerTestTool();
    const props = tool.parameters.properties;
    assert.ok('method' in props);
    assert.ok('headers' in props);
    assert.ok('body' in props);
    assert.ok('path' in props);
    assert.ok('port' in props);
  });
});

describe('registerServerTools', () => {
  it('is a function', () => {
    assert.equal(typeof registerServerTools, 'function');
  });

  it('registers 8 tools into a mock registry', () => {
    const registered = new Map();
    const mockRegistry = {
      register(tool) { registered.set(tool.name, tool); },
    };
    registerServerTools(mockRegistry, () => 'ws_test');
    assert.equal(registered.size, 8);
    assert.ok(registered.has('server_list'));
    assert.ok(registered.has('server_add'));
    assert.ok(registered.has('server_remove'));
    assert.ok(registered.has('server_update'));
    assert.ok(registered.has('server_start'));
    assert.ok(registered.has('server_stop'));
    assert.ok(registered.has('server_logs'));
    assert.ok(registered.has('server_test'));
  });

  it('all registered tools have name, description, permission, parameters', () => {
    const registered = [];
    const mockRegistry = {
      register(tool) { registered.push(tool); },
    };
    registerServerTools(mockRegistry, () => 'ws_test');
    for (const tool of registered) {
      assert.ok(typeof tool.name === 'string' && tool.name.length > 0, `${tool.name} has name`);
      assert.ok(typeof tool.description === 'string' && tool.description.length > 0, `${tool.name} has description`);
      assert.ok(['read', 'approve', 'denied', 'auto'].includes(tool.permission), `${tool.name} has valid permission`);
      assert.ok(tool.parameters && tool.parameters.type === 'object', `${tool.name} has object parameters`);
    }
  });
});
