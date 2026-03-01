// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-tool-builder.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ToolBuilder, DynamicTool, validateToolCode } from '../clawser-tool-builder.js';
import { createDefaultRegistry } from '../clawser-tools.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeRegistry() {
  return createDefaultRegistry();
}

function makeSandbox() {
  // Simple eval-like sandbox for testing
  return async (code, params) => {
    const fn = new Function('params', `${code}\nreturn typeof execute === 'function' ? execute(params) : undefined;`);
    return fn(params);
  };
}

// ── OPFS Persistence ────────────────────────────────────────────

describe('ToolBuilder OPFS persistence', () => {
  it('exposes persist() method', () => {
    const builder = new ToolBuilder(makeRegistry(), makeSandbox());
    assert.equal(typeof builder.persist, 'function');
  });

  it('exposes restore() method', () => {
    const builder = new ToolBuilder(makeRegistry(), makeSandbox());
    assert.equal(typeof builder.restore, 'function');
  });

  it('persist() saves tools via provided storage adapter', async () => {
    const registry = makeRegistry();
    const builder = new ToolBuilder(registry, makeSandbox());

    // Build a tool
    await builder.buildTool({
      name: 'my_calc',
      description: 'A calculator',
      code: 'function execute(p) { return p.a + p.b; }',
    });

    // Persist using a storage adapter (abstracted from OPFS)
    let savedData = null;
    const storage = {
      write: async (key, data) => { savedData = data; },
      read: async (key) => savedData,
    };

    await builder.persist(storage);
    assert.ok(savedData, 'should have saved data');

    const parsed = JSON.parse(savedData);
    assert.ok(Array.isArray(parsed), 'saved data should be an array');
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].name, 'my_calc');
  });

  it('restore() loads tools from storage adapter', async () => {
    const registry = makeRegistry();
    const builder = new ToolBuilder(registry, makeSandbox());

    const storedTools = JSON.stringify([
      {
        name: 'restored_tool',
        description: 'A restored tool',
        code: 'function execute(p) { return "restored"; }',
        version: 2,
        author: 'user',
        trusted: false,
      },
    ]);

    const storage = {
      read: async () => storedTools,
      write: async () => {},
    };

    const count = await builder.restore(storage);
    assert.equal(count, 1, 'should restore 1 tool');

    // Verify it's in the registry
    const tool = registry.get('restored_tool');
    assert.ok(tool, 'tool should be in registry');
    assert.ok(tool instanceof DynamicTool, 'should be a DynamicTool instance');
    assert.equal(tool.version, 2);
  });

  it('restore() handles missing/empty storage gracefully', async () => {
    const builder = new ToolBuilder(makeRegistry(), makeSandbox());
    const storage = {
      read: async () => null,
      write: async () => {},
    };

    const count = await builder.restore(storage);
    assert.equal(count, 0, 'should return 0 for empty storage');
  });
});

// ── tool_promote ────────────────────────────────────────────────

describe('tool_promote tool', () => {
  it('exports ToolPromoteTool class', async () => {
    const mod = await import('../clawser-tool-builder.js');
    assert.ok(mod.ToolPromoteTool, 'should export ToolPromoteTool');
  });

  it('promotes an untrusted tool to trusted', async () => {
    const { ToolPromoteTool } = await import('../clawser-tool-builder.js');
    const registry = makeRegistry();
    const builder = new ToolBuilder(registry, makeSandbox());

    await builder.buildTool({
      name: 'promo_tool',
      description: 'tool to promote',
      code: 'function execute(p) { return "hi"; }',
    });

    // Verify initially untrusted
    const before = registry.get('promo_tool');
    assert.equal(before.trusted, false);

    const tool = new ToolPromoteTool(builder);
    const result = await tool.execute({ name: 'promo_tool' });

    assert.ok(result.success);
    const after = registry.get('promo_tool');
    assert.equal(after.trusted, true, 'tool should now be trusted');
  });

  it('returns error for non-existent tool', async () => {
    const { ToolPromoteTool } = await import('../clawser-tool-builder.js');
    const builder = new ToolBuilder(makeRegistry(), makeSandbox());
    const tool = new ToolPromoteTool(builder);

    const result = await tool.execute({ name: 'ghost_tool' });
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.ok('output' in result, 'error result must include output field');
  });

  it('returns error for non-dynamic tool', async () => {
    const { ToolPromoteTool } = await import('../clawser-tool-builder.js');
    const registry = makeRegistry();
    const builder = new ToolBuilder(registry, makeSandbox());
    const tool = new ToolPromoteTool(builder);

    // 'browser_echo' is a built-in tool, not a DynamicTool
    const result = await tool.execute({ name: 'browser_echo' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found') || result.error.includes('Dynamic'));
    assert.ok('output' in result, 'error result must include output field');
  });

  it('has correct tool metadata', async () => {
    const { ToolPromoteTool } = await import('../clawser-tool-builder.js');
    const builder = new ToolBuilder(makeRegistry(), makeSandbox());
    const tool = new ToolPromoteTool(builder);

    assert.equal(tool.name, 'tool_promote');
    assert.ok(tool.description.toLowerCase().includes('trust'));
    assert.equal(tool.parameters.required[0], 'name');
    assert.equal(tool.permission, 'approve');
  });
});

// ── ToolBuilder error returns include output field ──────────────

describe('ToolBuilder error returns include output field', () => {
  let builder;
  let registry;

  beforeEach(() => {
    registry = makeRegistry();
    builder = new ToolBuilder(registry, makeSandbox());
  });

  it('buildTool — missing name', async () => {
    const r = await builder.buildTool({ code: 'function execute(){}' });
    assert.equal(r.success, false);
    assert.ok('output' in r, 'buildTool missing-name error must include output');
  });

  it('buildTool — missing code', async () => {
    const r = await builder.buildTool({ name: 'test_tool' });
    assert.equal(r.success, false);
    assert.ok('output' in r, 'buildTool missing-code error must include output');
  });

  it('buildTool — unsafe code', async () => {
    const r = await builder.buildTool({ name: 'bad', code: 'fetch("http://evil.com")' });
    assert.equal(r.success, false);
    assert.ok('output' in r, 'buildTool unsafe-code error must include output');
  });

  it('buildTool — sandbox test failure', async () => {
    const failSandbox = async () => { throw new Error('boom'); };
    const b = new ToolBuilder(registry, failSandbox);
    const r = await b.buildTool({ name: 'fail_tool', code: 'function execute(){}' });
    assert.equal(r.success, false);
    assert.ok('output' in r, 'buildTool sandbox-failure error must include output');
  });

  it('testTool — no code', async () => {
    const r = await builder.testTool({});
    assert.equal(r.success, false);
    assert.ok('output' in r, 'testTool no-code error must include output');
  });

  it('testTool — unsafe code', async () => {
    const r = await builder.testTool({ code: 'eval("1+1")' });
    assert.equal(r.success, false);
    assert.ok('output' in r, 'testTool unsafe-code error must include output');
  });

  it('testTool — no sandbox', async () => {
    const b = new ToolBuilder(registry, null);
    const r = await b.testTool({ code: 'function execute(){}' });
    assert.equal(r.success, false);
    assert.ok('output' in r, 'testTool no-sandbox error must include output');
  });

  it('testTool — sandbox throws', async () => {
    const failSandbox = async () => { throw new Error('oops'); };
    const b = new ToolBuilder(registry, failSandbox);
    const r = await b.testTool({ code: 'function execute(){}' });
    assert.equal(r.success, false);
    assert.ok('output' in r, 'testTool sandbox-throws error must include output');
  });

  it('editTool — non-existent tool', async () => {
    const r = await builder.editTool('ghost', { code: 'function execute(){}' });
    assert.equal(r.success, false);
    assert.ok('output' in r, 'editTool not-found error must include output');
  });

  it('removeTool — non-existent tool', () => {
    const r = builder.removeTool('ghost');
    assert.equal(r.success, false);
    assert.ok('output' in r, 'removeTool not-found error must include output');
  });

  it('rollback — version not found', () => {
    const r = builder.rollback('ghost', 1);
    assert.equal(r.success, false);
    assert.ok('output' in r, 'rollback not-found error must include output');
  });

  it('promoteTool — no registry', () => {
    const b = new ToolBuilder(null, makeSandbox());
    const r = b.promoteTool('anything');
    assert.equal(r.success, false);
    assert.ok('output' in r, 'promoteTool no-registry error must include output');
  });

  it('promoteTool — non-dynamic tool', () => {
    const r = builder.promoteTool('browser_echo');
    assert.equal(r.success, false);
    assert.ok('output' in r, 'promoteTool non-dynamic error must include output');
  });
});
