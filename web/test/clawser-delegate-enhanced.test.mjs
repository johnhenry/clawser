// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-delegate-enhanced.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── ConsultAgentTool (Block 9) ───────────────────────────────────
// NOTE: The dead ConsultAgentTool copy was removed from clawser-delegate.js.
// The active version lives in clawser-tools.js with a different API (agent-ref based).
// These tests now verify the delegate module no longer exports the dead copy.

describe('ConsultAgentTool removal from delegate', () => {
  it('no longer exports ConsultAgentTool from clawser-delegate.js', async () => {
    const mod = await import('../clawser-delegate.js');
    assert.equal(mod.ConsultAgentTool, undefined, 'dead copy should be removed');
  });

  it('active ConsultAgentTool still exists in clawser-tools.js', async () => {
    const { ConsultAgentTool } = await import('../clawser-tools.js');
    assert.ok(ConsultAgentTool, 'active version should exist in tools');
    assert.equal(new ConsultAgentTool({}, {}).name, 'agent_consult');
  });
});

// ── Sub-agent Cost Attribution (Block 9) ─────────────────────────

describe('Sub-agent cost attribution', () => {
  it('SubAgent tracks token usage', async () => {
    const { SubAgent } = await import('../clawser-delegate.js');
    const agent = new SubAgent({
      goal: 'test',
      chatFn: async () => ({
        content: 'Done.',
        tool_calls: [],
        usage: { input_tokens: 100, output_tokens: 50 },
        model: 'test-model',
      }),
      executeFn: async () => ({ success: true, output: '' }),
      toolSpecs: [],
    });

    await agent.run();
    assert.ok(agent.usage, 'should track usage');
    assert.ok(agent.usage.input_tokens > 0, 'should have input tokens');
    assert.ok(agent.usage.output_tokens > 0, 'should have output tokens');
  });

  it('SubAgent accumulates tokens across iterations', async () => {
    const { SubAgent } = await import('../clawser-delegate.js');
    let callCount = 0;
    const agent = new SubAgent({
      goal: 'test',
      chatFn: async () => {
        callCount++;
        if (callCount < 3) {
          return {
            content: '',
            tool_calls: [{ id: `t${callCount}`, name: 'memory_recall', arguments: '{}' }],
            usage: { input_tokens: 50, output_tokens: 25 },
            model: 'test',
          };
        }
        return {
          content: 'Complete.',
          tool_calls: [],
          usage: { input_tokens: 50, output_tokens: 25 },
          model: 'test',
        };
      },
      executeFn: async () => ({ success: true, output: 'ok' }),
      toolSpecs: [{ name: 'memory_recall', required_permission: 'read' }],
    });

    await agent.run();
    assert.equal(agent.usage.input_tokens, 150); // 3 calls × 50
    assert.equal(agent.usage.output_tokens, 75);  // 3 calls × 25
  });

  it('SubAgent result includes cost field', async () => {
    const { SubAgent } = await import('../clawser-delegate.js');
    const agent = new SubAgent({
      goal: 'cost test',
      chatFn: async () => ({
        content: 'Done.',
        tool_calls: [],
        usage: { input_tokens: 100, output_tokens: 50 },
        model: 'gpt-4o-mini',
      }),
      executeFn: async () => ({ success: true, output: '' }),
      toolSpecs: [],
    });

    const result = await agent.run();
    assert.ok('cost' in result, 'result should have cost field');
    assert.equal(typeof result.cost, 'number');
  });

  it('DelegateTool output includes cost attribution', async () => {
    const { DelegateTool, DelegateManager } = await import('../clawser-delegate.js');
    const mgr = new DelegateManager();
    const tool = new DelegateTool({
      manager: mgr,
      chatFn: async () => ({
        content: 'Done.',
        tool_calls: [],
        usage: { input_tokens: 100, output_tokens: 50 },
        model: 'test',
      }),
      executeFn: async () => ({ success: true, output: '' }),
      toolSpecs: [],
    });

    const result = await tool.execute({ task: 'test task' });
    assert.ok(result.output.includes('Cost:') || result.output.includes('cost'), 'output should mention cost');
  });
});

// ── NotificationManager (Block 16) ──────────────────────────────

describe('NotificationManager', () => {
  it('exports NotificationManager class', async () => {
    const mod = await import('../clawser-notifications.js');
    assert.ok(mod.NotificationManager, 'should export NotificationManager');
  });

  it('creates with default options', async () => {
    const { NotificationManager } = await import('../clawser-notifications.js');
    const mgr = new NotificationManager();
    assert.ok(mgr);
    assert.equal(mgr.pending, 0);
  });

  it('enqueues a notification', async () => {
    const { NotificationManager } = await import('../clawser-notifications.js');
    const mgr = new NotificationManager({ batchWindow: 5000 }); // batching enabled
    mgr.notify({ type: 'info', title: 'Test', body: 'Hello' });
    assert.equal(mgr.pending, 1);
    mgr.clear(); // cleanup
  });

  it('fires onNotify callback for immediate notifications', async () => {
    const { NotificationManager } = await import('../clawser-notifications.js');
    let received = null;
    const mgr = new NotificationManager({
      onNotify: (notif) => { received = notif; },
      batchWindow: 0, // no batching
    });
    mgr.notify({ type: 'info', title: 'Test', body: 'Hello' });
    assert.ok(received, 'should fire callback');
    assert.equal(received.title, 'Test');
  });

  it('assigns unique IDs to notifications', async () => {
    const { NotificationManager } = await import('../clawser-notifications.js');
    const mgr = new NotificationManager({ batchWindow: 0 });
    const ids = new Set();
    const cb = (n) => ids.add(n.id);
    mgr.onNotify = cb;
    mgr.notify({ type: 'info', title: 'A', body: '1' });
    mgr.notify({ type: 'info', title: 'B', body: '2' });
    assert.equal(ids.size, 2);
  });

  it('list() returns notification history', async () => {
    const { NotificationManager } = await import('../clawser-notifications.js');
    const mgr = new NotificationManager({ batchWindow: 0 });
    mgr.notify({ type: 'info', title: 'A', body: '1' });
    mgr.notify({ type: 'warning', title: 'B', body: '2' });
    const list = mgr.list();
    assert.equal(list.length, 2);
  });

  it('dismiss() removes a notification', async () => {
    const { NotificationManager } = await import('../clawser-notifications.js');
    const mgr = new NotificationManager({ batchWindow: 0 });
    let lastId = null;
    mgr.onNotify = (n) => { lastId = n.id; };
    mgr.notify({ type: 'info', title: 'Test', body: 'Hello' });
    mgr.dismiss(lastId);
    assert.equal(mgr.list().length, 0);
  });

  it('supports notification types: info, warning, error, success', async () => {
    const { NotificationManager } = await import('../clawser-notifications.js');
    const mgr = new NotificationManager({ batchWindow: 0 });
    for (const type of ['info', 'warning', 'error', 'success']) {
      mgr.notify({ type, title: type, body: `${type} test` });
    }
    const types = mgr.list().map(n => n.type);
    assert.deepEqual(types.sort(), ['error', 'info', 'success', 'warning']);
  });

  it('requestPermission checks browser Notification API', async () => {
    const { NotificationManager } = await import('../clawser-notifications.js');
    const mgr = new NotificationManager();
    assert.equal(typeof mgr.requestPermission, 'function');
    // In Node.js env, should return 'denied' or 'unavailable'
    const perm = await mgr.requestPermission();
    assert.ok(perm === 'denied' || perm === 'unavailable');
  });

  it('clear() removes all notifications', async () => {
    const { NotificationManager } = await import('../clawser-notifications.js');
    const mgr = new NotificationManager({ batchWindow: 0 });
    mgr.notify({ type: 'info', title: 'A', body: '1' });
    mgr.notify({ type: 'info', title: 'B', body: '2' });
    mgr.clear();
    assert.equal(mgr.list().length, 0);
  });
});

// ── Notification Batching (Block 16) ────────────────────────────

describe('Notification batching', () => {
  it('batches notifications within time window', async () => {
    const { NotificationManager } = await import('../clawser-notifications.js');
    let batched = null;
    const mgr = new NotificationManager({
      batchWindow: 50, // 50ms for testing
      onNotify: (n) => { batched = n; },
    });
    mgr.notify({ type: 'info', title: 'A', body: '1' });
    mgr.notify({ type: 'info', title: 'B', body: '2' });
    mgr.notify({ type: 'info', title: 'C', body: '3' });

    // Should not fire immediately
    assert.equal(batched, null, 'should not fire before batch window');

    // Wait for batch window to expire
    await new Promise(r => setTimeout(r, 100));
    assert.ok(batched, 'should fire after batch window');
    assert.ok(batched.title.includes('3') || batched.body.includes('3'), 'should summarize count');
  });

  it('flush() forces batch delivery', async () => {
    const { NotificationManager } = await import('../clawser-notifications.js');
    let received = [];
    const mgr = new NotificationManager({
      batchWindow: 5000, // long window
      onNotify: (n) => { received.push(n); },
    });
    mgr.notify({ type: 'info', title: 'A', body: '1' });
    mgr.notify({ type: 'info', title: 'B', body: '2' });

    mgr.flush();
    assert.ok(received.length > 0, 'flush should deliver immediately');
  });
});

// ── Skills → CLI Registration (Block 1) ──────────────────────────

describe('Skills CLI registration', () => {
  it('SkillRegistry exposes registerCLI method', async () => {
    const { SkillRegistry } = await import('../clawser-skills.js');
    const registry = new SkillRegistry();
    assert.equal(typeof registry.registerCLI, 'function');
  });

  it('registerCLI adds skill commands to CommandRegistry', async () => {
    const { SkillRegistry } = await import('../clawser-skills.js');
    // Simulated CommandRegistry-like interface
    const commands = new Map();
    const cmdRegistry = {
      register: (name, handler, meta) => commands.set(name, { handler, meta }),
      has: (name) => commands.has(name),
    };

    const skillRegistry = new SkillRegistry();
    // Manually add a skill entry
    skillRegistry.skills.set('my-skill', {
      name: 'my-skill',
      description: 'Test skill',
      metadata: {
        name: 'my-skill',
        description: 'Test skill',
        commands: ['my-cmd'],
      },
      scope: 'workspace',
      enabled: true,
    });

    skillRegistry.registerCLI(cmdRegistry);
    assert.ok(commands.has('my-cmd') || commands.has('my-skill'), 'should register skill as CLI command');
  });

  it('registerCLI uses skill name as command name when no commands specified', async () => {
    const { SkillRegistry } = await import('../clawser-skills.js');
    const commands = new Map();
    const cmdRegistry = {
      register: (name, handler, meta) => commands.set(name, { handler, meta }),
      has: (name) => commands.has(name),
    };

    const skillRegistry = new SkillRegistry();
    skillRegistry.skills.set('analyzer', {
      name: 'analyzer',
      description: 'Code analyzer',
      metadata: { name: 'analyzer', description: 'Code analyzer' },
      scope: 'workspace',
      enabled: true,
    });

    skillRegistry.registerCLI(cmdRegistry);
    assert.ok(commands.has('analyzer'), 'should register skill name as command');
  });

  it('unregisterCLI removes skill commands', async () => {
    const { SkillRegistry } = await import('../clawser-skills.js');
    const commands = new Map();
    const cmdRegistry = {
      register: (name, handler, meta) => commands.set(name, { handler, meta }),
      has: (name) => commands.has(name),
      unregister: (name) => commands.delete(name),
    };

    const skillRegistry = new SkillRegistry();
    skillRegistry.skills.set('temp-skill', {
      name: 'temp-skill',
      description: 'Temp',
      metadata: { name: 'temp-skill', description: 'Temp' },
      scope: 'workspace',
      enabled: true,
    });

    skillRegistry.registerCLI(cmdRegistry);
    assert.ok(commands.has('temp-skill'));

    assert.equal(typeof skillRegistry.unregisterCLI, 'function');
    skillRegistry.unregisterCLI(cmdRegistry);
    assert.ok(!commands.has('temp-skill'));
  });
});

// ── OpenClaw Markdown Loading (Block 7) ──────────────────────────

describe('OpenClaw markdown loading', () => {
  it('IdentityManager exposes loadFromFiles() method', async () => {
    const { IdentityManager } = await import('../clawser-identity.js');
    const mgr = new IdentityManager();
    assert.equal(typeof mgr.loadFromFiles, 'function');
  });

  it('loadFromFiles accepts file map', async () => {
    const { IdentityManager } = await import('../clawser-identity.js');
    const mgr = new IdentityManager();

    const files = {
      identity: '# My Agent\nI am a helpful assistant.',
      soul: '## Core Values\n- Be kind\n- Be accurate',
      user: '## User Profile\nName: Alice',
    };

    mgr.loadFromFiles(files);
    assert.equal(mgr.format, 'openclaw');
    const prompt = mgr.compile();
    assert.ok(prompt.includes('My Agent'));
    assert.ok(prompt.includes('Be kind'));
    assert.ok(prompt.includes('Alice'));
  });

  it('loadFromFiles works with partial files', async () => {
    const { IdentityManager } = await import('../clawser-identity.js');
    const mgr = new IdentityManager();

    mgr.loadFromFiles({ identity: '# Just Identity\nMinimal setup.' });
    assert.equal(mgr.format, 'openclaw');
    const prompt = mgr.compile();
    assert.ok(prompt.includes('Just Identity'));
  });

  it('loadFromFiles joins files with separator', async () => {
    const { IdentityManager } = await import('../clawser-identity.js');
    const mgr = new IdentityManager();

    mgr.loadFromFiles({
      identity: 'Part 1',
      soul: 'Part 2',
    });

    const prompt = mgr.compile();
    assert.ok(prompt.includes('Part 1'));
    assert.ok(prompt.includes('Part 2'));
    assert.ok(prompt.includes('---'), 'should join with separator');
  });

  it('serializes openclaw identity in toJSON', async () => {
    const { IdentityManager } = await import('../clawser-identity.js');
    const mgr = new IdentityManager();
    mgr.loadFromFiles({ identity: 'Test', soul: 'Soul' });

    const json = mgr.toJSON();
    assert.equal(json.format, 'openclaw');
    assert.ok(json.identity.files);
    assert.equal(json.identity.files.identity, 'Test');
  });
});
