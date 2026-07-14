/**
 * Tests for clawser-fs-kernel.mjs — Phase 8: Kernel Filesystem Integration
 */
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-fs-kernel.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ProcFileHandler } from '../clawser-proc.js';
import {
  registerKernelProcGenerators,
  registerKernelSysGenerators,
  registerAllKernelGenerators,
} from '../clawser-fs-kernel.mjs';

// ── Mock Kernel ──────────────────────────────────────────────────

const createMockKernel = () => {
  const _tenants = [];
  const _services = new Map();
  const _traceEvents = [];
  const _signals = {};
  let _nextId = 1;

  return {
    get tenants() {
      return {
        list: () => _tenants.slice(),
        size: _tenants.length,
      };
    },

    clock: {
      _startTime: 1000,
      nowWall: () => Date.now(),
      sleep: async (ms) => new Promise(r => setTimeout(r, ms)),
    },

    _startTime: 1000,

    tracer: {
      events: _traceEvents,
      emit(event) {
        _traceEvents.push({ ...event, timestamp: Date.now() });
      },
    },

    services: {
      _map: _services,
      register(name, handler, opts = {}) {
        if (_services.has(name)) throw new Error(`Already registered: ${name}`);
        _services.set(name, { handler, metadata: opts.metadata || null });
      },
      unregister(name) {
        if (!_services.delete(name)) throw new Error(`Not found: ${name}`);
      },
      list() {
        return [..._services.entries()].map(([name, entry]) => ({
          name,
          metadata: entry.metadata,
        }));
      },
      entries() {
        return _services.entries();
      },
    },

    signals: _signals,

    log: {
      info: () => {},
      error: () => {},
    },

    createTenant(opts = {}) {
      const id = `tenant-${_nextId++}`;
      const tenant = {
        id,
        caps: { _granted: opts.capabilities || [] },
        capabilities: opts.capabilities || [],
        env: opts.env || {},
      };
      _tenants.push(tenant);
      return tenant;
    },

    destroyTenant(tenantId) {
      const idx = _tenants.findIndex(t => t.id === tenantId);
      if (idx >= 0) _tenants.splice(idx, 1);
    },

    // Test helpers
    _tenants,
    _services,
    _traceEvents,
    _signals,
  };
};

// ── Mock KernelIntegration ──────────────────────────────────────

const createMockKi = (kernel) => ({
  kernel,
  active: !!kernel,
});

// ── Tests ─────────────────────────────────────────────────────────

describe('clawser-fs-kernel — Kernel Proc Generators', () => {
  let handler;
  let kernel;
  let ki;

  beforeEach(() => {
    handler = new ProcFileHandler();
    kernel = createMockKernel();
    ki = createMockKi(kernel);
  });

  describe('registerKernelProcGenerators', () => {
    it('registers /proc/kernel/tenants', async () => {
      registerKernelProcGenerators(handler, ki);
      assert.ok(handler.handles('/proc/kernel/tenants'));
    });

    it('/proc/kernel/tenants lists tenants', async () => {
      kernel.createTenant({ capabilities: ['NET', 'FS'], env: { WORKSPACE_ID: 'ws1' } });
      kernel.createTenant({ capabilities: ['CLOCK'], env: { ROLE: 'sandbox' } });
      registerKernelProcGenerators(handler, ki);

      const content = await handler.readFile('/proc/kernel/tenants');
      assert.ok(content.includes('tenant-1'));
      assert.ok(content.includes('tenant-2'));
      assert.ok(content.includes('NET,FS'));
      assert.ok(content.includes('sandbox'));
    });

    it('/proc/kernel/tenants shows no tenants message when empty', async () => {
      registerKernelProcGenerators(handler, ki);
      const content = await handler.readFile('/proc/kernel/tenants');
      assert.ok(content.includes('no tenants'));
    });

    it('registers /proc/kernel/status', async () => {
      registerKernelProcGenerators(handler, ki);
      assert.ok(handler.handles('/proc/kernel/status'));
      const content = await handler.readFile('/proc/kernel/status');
      const parsed = JSON.parse(content);
      assert.equal(parsed.active, true);
    });

    it('/proc/kernel/status shows inactive when no kernel', async () => {
      const noKi = createMockKi(null);
      registerKernelProcGenerators(handler, noKi);
      const content = await handler.readFile('/proc/kernel/status');
      const parsed = JSON.parse(content);
      assert.equal(parsed.active, false);
    });

    it('/proc/kernel/tenants handles null kernel gracefully', async () => {
      const noKi = createMockKi(null);
      registerKernelProcGenerators(handler, noKi);
      const content = await handler.readFile('/proc/kernel/tenants');
      assert.ok(content.includes('kernel not active'));
    });
  });

  describe('registerKernelSysGenerators', () => {
    it('registers /sys/kernel/clock', async () => {
      registerKernelSysGenerators(handler, ki);
      assert.ok(handler.handles('/sys/kernel/clock'));
      const content = await handler.readFile('/sys/kernel/clock');
      const val = parseInt(content.trim());
      assert.ok(val > 0, `Expected positive clock value, got ${val}`);
    });

    it('/sys/kernel/clock returns 0 when no clock', async () => {
      kernel.clock = null;
      registerKernelSysGenerators(handler, ki);
      const content = await handler.readFile('/sys/kernel/clock');
      assert.equal(content.trim(), '0');
    });

    it('registers /sys/kernel/trace', async () => {
      kernel.tracer.emit({ type: 'llm_call', model: 'gpt-4' });
      kernel.tracer.emit({ type: 'agent.tool_call', tool: 'browser_fetch' });
      registerKernelSysGenerators(handler, ki);

      const content = await handler.readFile('/sys/kernel/trace');
      assert.ok(content.includes('llm_call'));
      assert.ok(content.includes('agent.tool_call'));
    });

    it('/sys/kernel/trace handles no events', async () => {
      registerKernelSysGenerators(handler, ki);
      const content = await handler.readFile('/sys/kernel/trace');
      assert.ok(content.includes('no trace events'));
    });

    it('/sys/kernel/trace handles null tracer', async () => {
      kernel.tracer = null;
      registerKernelSysGenerators(handler, ki);
      const content = await handler.readFile('/sys/kernel/trace');
      assert.ok(content.includes('tracer not active'));
    });

    it('/sys/kernel/trace accepts writes to toggle tracing', async () => {
      const calls = [];
      kernel.tracer.enable = () => calls.push('enable');
      kernel.tracer.disable = () => calls.push('disable');
      registerKernelSysGenerators(handler, ki);

      assert.equal(handler.canWrite('/sys/kernel/trace'), true);
      await handler.writeFile('/sys/kernel/trace', '1');
      await handler.writeFile('/sys/kernel/trace', '0\n');
      assert.deepEqual(calls, ['enable', 'disable']);
    });

    it('/sys/kernel/trace rejects invalid write values', async () => {
      registerKernelSysGenerators(handler, ki);
      await assert.rejects(() => handler.writeFile('/sys/kernel/trace', 'banana'), /0 or 1/);
    });

    it('/sys/kernel/trace write is a no-op without a tracer', async () => {
      kernel.tracer = null;
      registerKernelSysGenerators(handler, ki);
      // Must not throw even with no kernel tracer
      await handler.writeFile('/sys/kernel/trace', '1');
    });

    it('registers /sys/kernel/signals', async () => {
      kernel.signals = { TERM: { pending: true }, HUP: { pending: false } };
      registerKernelSysGenerators(handler, ki);

      const content = await handler.readFile('/sys/kernel/signals');
      assert.ok(content.includes('TERM\tpending'));
      assert.ok(content.includes('HUP\tclear'));
    });

    it('/sys/kernel/signals handles empty signals', async () => {
      registerKernelSysGenerators(handler, ki);
      const content = await handler.readFile('/sys/kernel/signals');
      assert.ok(content.includes('no active signals'));
    });

    it('registers /sys/services', async () => {
      kernel.services.register('mcp-slack', {}, { metadata: { type: 'mcp', name: 'slack' } });
      kernel.services.register('http-localhost-8080', {}, { metadata: { type: 'http-server' } });
      registerKernelSysGenerators(handler, ki);

      const content = await handler.readFile('/sys/services');
      assert.ok(content.includes('svc://mcp-slack'));
      assert.ok(content.includes('svc://http-localhost-8080'));
    });

    it('/sys/services handles no services', async () => {
      registerKernelSysGenerators(handler, ki);
      const content = await handler.readFile('/sys/services');
      assert.ok(content.includes('no services registered'));
    });

    it('/sys/services handles null service registry', async () => {
      kernel.services = null;
      registerKernelSysGenerators(handler, ki);
      const content = await handler.readFile('/sys/services');
      assert.ok(content.includes('no service registry'));
    });
  });

  describe('registerAllKernelGenerators', () => {
    it('registers both proc and sys generators', async () => {
      registerAllKernelGenerators(handler, ki);
      assert.ok(handler.handles('/proc/kernel/tenants'));
      assert.ok(handler.handles('/proc/kernel/status'));
      assert.ok(handler.handles('/sys/kernel/clock'));
      assert.ok(handler.handles('/sys/kernel/trace'));
      assert.ok(handler.handles('/sys/kernel/signals'));
      assert.ok(handler.handles('/sys/services'));
    });
  });

  describe('VirtualFs integration', () => {
    it('VirtualFs.readFile routes to kernel proc generators', async () => {
      const { VirtualFs } = await import('../clawser-proc.js');
      registerAllKernelGenerators(handler, ki);
      const mockRealFs = {
        readFile: async () => 'real-file-content',
        listDir: async () => [],
      };
      const vfs = new VirtualFs(mockRealFs, handler);

      const content = await vfs.readFile('/proc/kernel/status');
      const parsed = JSON.parse(content);
      assert.equal(parsed.active, true);
    });

    it('VirtualFs.listDir returns kernel proc entries', async () => {
      const { VirtualFs } = await import('../clawser-proc.js');
      registerAllKernelGenerators(handler, ki);
      const mockRealFs = {
        readFile: async () => '',
        listDir: async () => [],
      };
      const vfs = new VirtualFs(mockRealFs, handler);

      const entries = await vfs.listDir('/proc/kernel');
      const names = entries.map(e => e.name);
      assert.ok(names.includes('tenants'));
      assert.ok(names.includes('status'));
    });

    it('VirtualFs.listDir returns sys entries', async () => {
      const { VirtualFs } = await import('../clawser-proc.js');
      registerAllKernelGenerators(handler, ki);
      const mockRealFs = {
        readFile: async () => '',
        listDir: async () => [],
      };
      const vfs = new VirtualFs(mockRealFs, handler);

      const entries = await vfs.listDir('/sys/kernel');
      const names = entries.map(e => e.name);
      assert.ok(names.includes('clock'));
      assert.ok(names.includes('trace'));
      assert.ok(names.includes('signals'));
    });
  });
});
