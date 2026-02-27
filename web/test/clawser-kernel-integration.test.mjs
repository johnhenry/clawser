import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KernelIntegration } from '../clawser-kernel-integration.js';
import { Kernel, KERNEL_CAP, Clock, RNG } from '../packages/kernel/src/index.mjs';

describe('KernelIntegration', () => {
  // ── Step 23: Workspace tenants ──────────────────────────────────

  it('createWorkspaceTenant creates kernel tenant', () => {
    const kernel = new Kernel();
    const ki = new KernelIntegration(kernel);

    const tenant = ki.createWorkspaceTenant('ws_1');
    assert.ok(tenant);
    assert.match(tenant.id, /^tenant_/);
    assert.equal(tenant.env.get('WORKSPACE_ID'), 'ws_1');

    ki.close();
    kernel.close();
  });

  it('destroyWorkspaceTenant removes kernel tenant', () => {
    const kernel = new Kernel();
    const ki = new KernelIntegration(kernel);

    ki.createWorkspaceTenant('ws_1');
    assert.equal(kernel.listTenants().length, 1);

    ki.destroyWorkspaceTenant('ws_1');
    assert.equal(kernel.listTenants().length, 0);

    ki.close();
    kernel.close();
  });

  it('getWorkspaceTenantId returns mapping', () => {
    const kernel = new Kernel();
    const ki = new KernelIntegration(kernel);

    const tenant = ki.createWorkspaceTenant('ws_1');
    assert.equal(ki.getWorkspaceTenantId('ws_1'), tenant.id);
    assert.equal(ki.getWorkspaceTenantId('ws_99'), undefined);

    ki.close();
    kernel.close();
  });

  it('createSkillTenant creates restricted sub-tenant', () => {
    const kernel = new Kernel();
    const ki = new KernelIntegration(kernel);

    ki.createWorkspaceTenant('ws_1');
    const skillTenant = ki.createSkillTenant('ws_1', 'fetch-tool', [KERNEL_CAP.NET]);
    assert.ok(skillTenant);
    assert.equal(skillTenant.env.get('SKILL'), 'fetch-tool');
    assert.equal(skillTenant.env.get('ROLE'), 'skill');

    ki.close();
    kernel.close();
  });

  // ── Step 25: MCP services ──────────────────────────────────────

  it('registerMcpService adds to kernel service registry', async () => {
    const kernel = new Kernel();
    const ki = new KernelIntegration(kernel);

    const mockClient = { callTool: () => {} };
    ki.registerMcpService('github', mockClient);

    assert.ok(kernel.services.has('mcp-github'));
    const entry = await kernel.services.lookup('mcp-github');
    assert.equal(entry.listener, mockClient);
    assert.equal(entry.metadata.type, 'mcp');

    ki.close();
    kernel.close();
  });

  it('unregisterMcpService removes from registry', () => {
    const kernel = new Kernel();
    const ki = new KernelIntegration(kernel);

    ki.registerMcpService('github', {});
    assert.ok(kernel.services.has('mcp-github'));

    ki.unregisterMcpService('github');
    assert.ok(!kernel.services.has('mcp-github'));

    ki.close();
    kernel.close();
  });

  // ── Step 26: Provider cost tracking ────────────────────────────

  it('traceLlmCall emits tracer event', () => {
    const kernel = new Kernel();
    const ki = new KernelIntegration(kernel);

    ki.traceLlmCall({
      model: 'gpt-4o',
      provider: 'openai',
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.0075,
    });

    const events = kernel.tracer.snapshot();
    const llmEvents = events.filter(e => e.type === 'llm_call');
    assert.equal(llmEvents.length, 1);
    assert.equal(llmEvents[0].model, 'gpt-4o');
    assert.equal(llmEvents[0].cost_usd, 0.0075);

    ki.close();
    kernel.close();
  });

  // ── Step 27: Sandbox tenant ────────────────────────────────────

  it('createSandboxTenant returns tenant with serialized caps', () => {
    const kernel = new Kernel();
    const ki = new KernelIntegration(kernel);

    const result = ki.createSandboxTenant('ws_1');
    assert.ok(result);
    assert.match(result.tenantId, /^tenant_/);
    assert.ok(Array.isArray(result.serializedCaps));

    ki.close();
    kernel.close();
  });

  // ── Step 29: EventLog + Tracer ─────────────────────────────────

  it('hookEventLog pipes events to tracer', () => {
    const kernel = new Kernel();
    const ki = new KernelIntegration(kernel);

    // Create a mock EventLog
    const events = [];
    const eventLog = {
      append(type, data, source) {
        const event = { id: `evt_${events.length}`, type, data, source, timestamp: Date.now() };
        events.push(event);
        return event;
      },
    };

    ki.hookEventLog(eventLog);

    // Now appends should also emit tracer events
    eventLog.append('user_message', { content: 'hello' }, 'user');
    eventLog.append('tool_call', { name: 'fetch', args: {} }, 'system');

    const traceEvents = kernel.tracer.snapshot();
    const agentEvents = traceEvents.filter(e => e.type.startsWith('agent.'));
    assert.ok(agentEvents.length >= 2);
    assert.ok(agentEvents.some(e => e.type === 'agent.user_message'));
    assert.ok(agentEvents.some(e => e.type === 'agent.tool_call'));

    ki.close();
    kernel.close();
  });

  it('hookEventLog is idempotent', () => {
    const kernel = new Kernel();
    const ki = new KernelIntegration(kernel);

    const eventLog = {
      append(type, data, source) {
        return { id: 'evt_0', type, data, source };
      },
    };

    ki.hookEventLog(eventLog);
    const result = ki.hookEventLog(eventLog); // second call
    assert.equal(result, null); // Already hooked

    ki.close();
    kernel.close();
  });

  // ── Step 30: Scheduler clock ───────────────────────────────────

  it('getSchedulerClock returns kernel clock wrapper', () => {
    const kernel = new Kernel({ clock: Clock.fixed(1000, 2000) });
    const ki = new KernelIntegration(kernel);

    const clock = ki.getSchedulerClock();
    assert.ok(clock);
    assert.equal(clock.nowWall(), 2000);

    ki.close();
    kernel.close();
  });

  // ── No kernel (null safety) ────────────────────────────────────

  it('all methods are no-ops when kernel is null', () => {
    const ki = new KernelIntegration(null);
    assert.equal(ki.active, false);
    assert.equal(ki.createWorkspaceTenant('ws_1'), null);
    ki.destroyWorkspaceTenant('ws_1'); // no throw
    ki.registerMcpService('x', {}); // no throw
    ki.unregisterMcpService('x'); // no throw
    ki.traceLlmCall({ model: 'x', provider: 'y', input_tokens: 0, output_tokens: 0, cost_usd: 0 }); // no throw
    assert.equal(ki.createSandboxTenant('ws_1'), null);
    assert.equal(ki.hookEventLog({}), null);
    assert.equal(ki.getSchedulerClock(), null);
    ki.close(); // no throw
  });

  // ── Lifecycle ──────────────────────────────────────────────────

  it('close cleans up all tenants and services', () => {
    const kernel = new Kernel();
    const ki = new KernelIntegration(kernel);

    ki.createWorkspaceTenant('ws_1');
    ki.createWorkspaceTenant('ws_2');
    ki.registerMcpService('a', {});
    ki.registerMcpService('b', {});

    assert.equal(kernel.listTenants().length, 2);
    assert.equal(kernel.services.list().length, 2);

    ki.close();

    assert.equal(kernel.listTenants().length, 0);
    assert.equal(kernel.services.list().length, 0);

    kernel.close();
  });
});
