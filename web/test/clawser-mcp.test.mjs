// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mcp.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { McpClient, McpManager, WebMCPDiscovery } from '../clawser-mcp.js';

// ── McpClient (8 tests) ─────────────────────────────────────────

describe('McpClient', () => {
  let client;

  beforeEach(() => {
    client = new McpClient('http://localhost:3000/mcp');
  });

  it('constructor stores endpoint', () => {
    assert.equal(client.endpoint, 'http://localhost:3000/mcp');
  });

  it('connected defaults to false', () => {
    assert.equal(client.connected, false);
  });

  it('tools defaults to empty array', () => {
    assert.deepEqual(client.tools, []);
  });

  it('sessionId defaults to null', () => {
    assert.equal(client.sessionId, null);
  });

  it('toolSpecs returns empty array when no tools loaded', () => {
    assert.deepEqual(client.toolSpecs, []);
  });

  it('handlesTool returns false when no tools loaded', () => {
    assert.equal(client.handlesTool('mcp_search'), false);
  });

  it('mcpName strips mcp_ prefix', () => {
    assert.equal(client.mcpName('mcp_search'), 'search');
  });

  it('mcpName returns name unchanged if no prefix', () => {
    assert.equal(client.mcpName('raw_name'), 'raw_name');
  });
});

// ── McpClient constructor options (2 tests) ─────────────────────

describe('McpClient constructor options', () => {
  it('accepts custom timeoutMs', () => {
    // timeoutMs is private but we verify no error is thrown
    const client = new McpClient('http://x.test/mcp', { timeoutMs: 5000 });
    assert.equal(client.endpoint, 'http://x.test/mcp');
  });

  it('accepts onLog callback without error', () => {
    const logs = [];
    const client = new McpClient('http://x.test/mcp', { onLog: (lvl, msg) => logs.push({ lvl, msg }) });
    assert.equal(client.endpoint, 'http://x.test/mcp');
  });
});

// ── McpManager (6 tests) ────────────────────────────────────────

describe('McpManager', () => {
  let mgr;

  beforeEach(() => {
    mgr = new McpManager();
  });

  it('serverCount defaults to 0', () => {
    assert.equal(mgr.serverCount, 0);
  });

  it('serverNames returns empty array initially', () => {
    assert.deepEqual(mgr.serverNames, []);
  });

  it('getClient returns undefined for unknown name', () => {
    assert.equal(mgr.getClient('nonexistent'), undefined);
  });

  it('allToolSpecs returns empty array with no servers', () => {
    assert.deepEqual(mgr.allToolSpecs(), []);
  });

  it('findClient returns null with no servers', () => {
    assert.equal(mgr.findClient('mcp_anything'), null);
  });

  it('_kernelIntegration defaults to null', () => {
    assert.equal(mgr._kernelIntegration, null);
  });
});

// ── WebMCPDiscovery (11 tests) ──────────────────────────────────

describe('WebMCPDiscovery', () => {
  let discovery;

  beforeEach(() => {
    discovery = new WebMCPDiscovery();
  });

  it('size defaults to 0', () => {
    assert.equal(discovery.size, 0);
  });

  it('listDiscovered returns empty array initially', () => {
    assert.deepEqual(discovery.listDiscovered(), []);
  });

  it('parseToolDescriptors returns valid tools', () => {
    const tools = discovery.parseToolDescriptors({
      tools: [
        { name: 'search', description: 'Search the web' },
        { name: 'fetch', description: 'Fetch a URL' },
      ],
    });
    assert.equal(tools.length, 2);
    assert.equal(tools[0].name, 'search');
  });

  it('parseToolDescriptors returns empty for null metadata', () => {
    assert.deepEqual(discovery.parseToolDescriptors(null), []);
  });

  it('parseToolDescriptors returns empty for missing tools key', () => {
    assert.deepEqual(discovery.parseToolDescriptors({}), []);
  });

  it('parseToolDescriptors filters out invalid tools', () => {
    const tools = discovery.parseToolDescriptors({
      tools: [
        { name: 'valid', description: 'ok' },
        { name: '', description: 'empty name' },
        42,
      ],
    });
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'valid');
  });

  it('isValidTool returns true for valid tool object', () => {
    assert.equal(discovery.isValidTool({ name: 'test', description: 'desc' }), true);
  });

  it('isValidTool returns false for missing name', () => {
    assert.equal(discovery.isValidTool({ description: 'desc' }), false);
  });

  it('isValidTool returns false for non-object', () => {
    assert.equal(discovery.isValidTool('not-an-object'), false);
    assert.equal(discovery.isValidTool(null), false);
    assert.equal(discovery.isValidTool(42), false);
  });

  it('addDiscovered adds tools and tracks count', () => {
    discovery.addDiscovered([
      { name: 'tool_a', description: 'A', source: 'test' },
      { name: 'tool_b', description: 'B', source: 'test' },
    ]);
    assert.equal(discovery.size, 2);
    const listed = discovery.listDiscovered();
    assert.equal(listed.length, 2);
    assert.equal(listed[0].name, 'tool_a');
  });

  it('addDiscovered deduplicates by name', () => {
    discovery.addDiscovered([{ name: 'dup', description: 'first', source: 'a' }]);
    discovery.addDiscovered([{ name: 'dup', description: 'second', source: 'b' }]);
    assert.equal(discovery.size, 1);
    // Keeps the first version
    assert.equal(discovery.listDiscovered()[0].description, 'first');
  });

  it('clearDiscovered empties registry', () => {
    discovery.addDiscovered([{ name: 'x', description: 'y', source: 'z' }]);
    assert.equal(discovery.size, 1);
    discovery.clearDiscovered();
    assert.equal(discovery.size, 0);
    assert.deepEqual(discovery.listDiscovered(), []);
  });
});
