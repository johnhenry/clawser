import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserToolRegistry, BrowserTool } from '../clawser-tools.js';
import { SafetyPipeline } from '../clawser-safety.js';

// ── Mock tools ──────────────────────────────────────────────────

/** A simple tool that echoes its input. */
class EchoTool extends BrowserTool {
  get name() { return 'echo'; }
  get description() { return 'Echoes input'; }
  get parameters() { return { type: 'object', properties: { text: { type: 'string' } } }; }
  get permission() { return 'internal'; }

  async execute({ text = '' }) {
    return { success: true, output: text };
  }
}

/** A fake fs_read tool to trigger path-traversal validation. */
class FakeFsReadTool extends BrowserTool {
  get name() { return 'browser_fs_read'; }
  get description() { return 'Read file'; }
  get parameters() { return { type: 'object', properties: { path: { type: 'string' } } }; }
  get permission() { return 'read'; }

  async execute({ path }) {
    return { success: true, output: `Contents of ${path}` };
  }
}

/** A fake fetch tool to trigger URL validation. */
class FakeFetchTool extends BrowserTool {
  get name() { return 'browser_fetch'; }
  get description() { return 'Fetch URL'; }
  get parameters() { return { type: 'object', properties: { url: { type: 'string' } } }; }
  get permission() { return 'internal'; }

  async execute({ url }) {
    return { success: true, output: `Fetched: ${url}` };
  }
}

/** A tool whose execute throws. */
class ThrowingTool extends BrowserTool {
  get name() { return 'thrower'; }
  get description() { return 'Always throws'; }
  get permission() { return 'internal'; }

  async execute() {
    throw new Error('boom');
  }
}

// ── Tests ───────────────────────────────────────────────────────

describe('BrowserToolRegistry + SafetyPipeline', () => {
  let registry;
  let pipeline;

  beforeEach(() => {
    registry = new BrowserToolRegistry();
    pipeline = new SafetyPipeline();
    registry.setSafety(pipeline);

    registry.register(new EchoTool());
    registry.register(new FakeFsReadTool());
    registry.register(new FakeFetchTool());
    registry.register(new ThrowingTool());
  });

  // ── Pre-execution validation ────────────────────────────────

  describe('pre-execution validation', () => {
    it('allows clean tool calls through', async () => {
      const result = await registry.execute('echo', { text: 'hello' });
      assert.ok(result.success);
      assert.equal(result.output, 'hello');
    });

    it('blocks path traversal in fs tools', async () => {
      const result = await registry.execute('browser_fs_read', { path: '../../etc/passwd' });
      assert.ok(!result.success);
      assert.ok(result.error.includes('Safety'));
      assert.ok(result.error.includes('Path traversal'));
    });

    it('blocks file:// URLs in fetch tools', async () => {
      const result = await registry.execute('browser_fetch', { url: 'file:///etc/passwd' });
      assert.ok(!result.success);
      assert.ok(result.error.includes('Safety'));
    });

    it('allows clean fs paths', async () => {
      const result = await registry.execute('browser_fs_read', { path: '/docs/readme.md' });
      assert.ok(result.success);
      assert.equal(result.output, 'Contents of /docs/readme.md');
    });
  });

  // ── Post-execution output scanning ──────────────────────────

  describe('post-execution output scanning', () => {
    it('redacts API keys in tool output', async () => {
      const apiKey = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';
      const result = await registry.execute('echo', { text: `Your key is ${apiKey}` });
      assert.ok(result.success);
      assert.ok(result.output.includes('[REDACTED:openai_key]'));
      assert.ok(!result.output.includes('sk-abcdef'));
    });

    it('redacts Anthropic keys in tool output', async () => {
      const result = await registry.execute('echo', {
        text: 'Key: sk-ant-abcdefghijklmnopqrstuvwxyz1234567890',
      });
      assert.ok(result.success);
      assert.ok(result.output.includes('[REDACTED:'));
    });

    it('blocks output containing private keys', async () => {
      const result = await registry.execute('echo', {
        text: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
      });
      assert.ok(!result.success);
      assert.ok(result.error.includes('blocked by safety pipeline'));
    });

    it('passes clean output through unchanged', async () => {
      const result = await registry.execute('echo', { text: 'Normal text' });
      assert.ok(result.success);
      assert.equal(result.output, 'Normal text');
    });

    it('passes empty output through', async () => {
      const result = await registry.execute('echo', { text: '' });
      assert.ok(result.success);
      assert.equal(result.output, '');
    });
  });

  // ── No safety pipeline ─────────────────────────────────────

  describe('without safety pipeline', () => {
    it('executes normally when no safety is set', async () => {
      const plainRegistry = new BrowserToolRegistry();
      plainRegistry.register(new EchoTool());
      plainRegistry.register(new FakeFsReadTool());

      // No setSafety() call — should work fine
      const result = await plainRegistry.execute('echo', { text: 'sk-abcdefghijklmnopqrstuvwxyz1234567890' });
      assert.ok(result.success);
      // Secret passes through unredacted (no safety)
      assert.ok(result.output.includes('sk-abcdef'));
    });

    it('allows dangerous paths when no safety is set', async () => {
      const plainRegistry = new BrowserToolRegistry();
      plainRegistry.register(new FakeFsReadTool());
      const result = await plainRegistry.execute('browser_fs_read', { path: '../../etc/passwd' });
      assert.ok(result.success); // no validation
    });
  });

  // ── Disabled safety pipeline ────────────────────────────────

  describe('with disabled safety pipeline', () => {
    it('skips validation when pipeline is disabled', async () => {
      pipeline.confirmDisable();
      pipeline.enabled = false;

      const result = await registry.execute('browser_fs_read', { path: '../../etc/passwd' });
      assert.ok(result.success); // validation skipped
    });

    it('skips output scanning when pipeline is disabled', async () => {
      pipeline.confirmDisable();
      pipeline.enabled = false;

      const result = await registry.execute('echo', { text: 'sk-abcdefghijklmnopqrstuvwxyz1234567890' });
      assert.ok(result.success);
      assert.ok(result.output.includes('sk-abcdef')); // not redacted
    });
  });

  // ── Error handling ──────────────────────────────────────────

  describe('error handling', () => {
    it('catches tool execution errors', async () => {
      const result = await registry.execute('thrower', {});
      assert.ok(!result.success);
      assert.equal(result.error, 'boom');
    });

    it('returns error for unknown tools', async () => {
      const result = await registry.execute('nonexistent', {});
      assert.ok(!result.success);
      assert.ok(result.error.includes('not found'));
    });
  });

  // ── Permission + safety interaction ─────────────────────────

  describe('permission + safety interaction', () => {
    it('permission check runs before safety validation', async () => {
      // Deny the echo tool
      registry.setPermission('echo', 'denied');

      // Even with a dangerous input, the permission check rejects first
      const result = await registry.execute('echo', {
        text: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
      });
      assert.ok(!result.success);
      assert.ok(result.error.includes('blocked by permission'));
    });
  });
});
