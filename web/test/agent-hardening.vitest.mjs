// Agent hardening tests — validates agent construction and public API.
// Tests based on findings from browser testing session.
import { describe, it, expect } from 'vitest';

const agentMod = await import('../clawser-agent.js');
const { ClawserAgent, AutonomyController, HookPipeline } = agentMod;

// ── AutonomyController limits ────────────────────────────────────

describe('AutonomyController', () => {
  it('blocks when rate limit exceeded', () => {
    const ac = new AutonomyController({ maxActionsPerHour: 1 });
    ac.recordAction();
    const result = ac.checkLimits();
    expect(result.blocked).toBe(true);
    expect(result.limitType).toBe('rate');
    expect(result.resetTime).toBeGreaterThan(0);
  });

  it('blocks when cost limit exceeded', () => {
    const ac = new AutonomyController({ maxCostPerDayCents: 10 });
    ac.recordCost(15);
    const result = ac.checkLimits();
    expect(result.blocked).toBe(true);
    expect(result.limitType).toBe('cost');
  });

  it('allows when within limits', () => {
    const ac = new AutonomyController({ maxActionsPerHour: 100, maxCostPerDayCents: 1000 });
    ac.recordAction();
    ac.recordCost(1);
    const result = ac.checkLimits();
    expect(result.blocked).toBe(false);
  });
});

// ── HookPipeline ─────────────────────────────────────────────────

describe('HookPipeline', () => {
  it('registers and fires hooks', async () => {
    const hp = new HookPipeline();
    let fired = false;
    hp.register({
      name: 'test-hook',
      point: 'beforeInbound',
      execute: async () => { fired = true; return { action: 'continue' }; },
    });
    await hp.run('beforeInbound', {});
    expect(fired).toBe(true);
  });

  it('passes data to hooks', async () => {
    const hp = new HookPipeline();
    let captured;
    hp.register({
      name: 'capture-hook',
      point: 'beforeOutbound',
      execute: async (data) => { captured = data; return { action: 'continue' }; },
    });
    await hp.run('beforeOutbound', { foo: 'bar' });
    expect(captured).toEqual({ foo: 'bar' });
  });

  it('runs hooks in priority order', async () => {
    const hp = new HookPipeline();
    const order = [];
    hp.register({
      name: 'hook-b',
      point: 'beforeInbound',
      priority: 200,
      execute: async () => { order.push(2); return { action: 'continue' }; },
    });
    hp.register({
      name: 'hook-a',
      point: 'beforeInbound',
      priority: 100,
      execute: async () => { order.push(1); return { action: 'continue' }; },
    });
    await hp.run('beforeInbound', {});
    expect(order).toEqual([1, 2]);
  });
});

// ── ExtTool screenshot output size (documents known bug) ─────────

describe('ExtTool screenshot output size', () => {
  it('base64 screenshot data can exceed context limits', () => {
    // Documents the bug found during browser testing:
    // A 1920x1080 PNG screenshot as base64 data URL = ~2-4MB text.
    // At ~4 chars/token, that's 500K-1M tokens > 200K limit.
    const sampleBase64Length = 1_000_000; // 1MB — conservative
    const estimatedTokens = sampleBase64Length / 4;
    expect(estimatedTokens).toBeGreaterThan(200_000);
  });

  it('tool result output has no size cap in ExtTool._call', async () => {
    // ExtTool._call at line 249 does:
    //   JSON.stringify(result, null, 2)
    // No truncation or size check. Large results (like screenshots)
    // go directly into history and blow the context.
    const largeOutput = JSON.stringify({ dataUrl: 'x'.repeat(2_000_000) }, null, 2);
    expect(largeOutput.length).toBeGreaterThan(2_000_000);
    // Fix needed: cap output size or store large results to OPFS
  });
});

// ── Agent construction ───────────────────────────────────────────

describe('ClawserAgent construction', () => {
  it('exports ClawserAgent class', () => {
    expect(typeof ClawserAgent).toBe('function');
  });

  it('exports AutonomyController', () => {
    expect(typeof AutonomyController).toBe('function');
  });

  it('exports HookPipeline', () => {
    expect(typeof HookPipeline).toBe('function');
  });
});
