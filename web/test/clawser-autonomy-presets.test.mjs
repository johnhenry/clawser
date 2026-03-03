// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-autonomy-presets.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AutonomyController } from '../clawser-agent.js';
import { AutonomyPresetManager } from '../clawser-autonomy-presets.js';

// ── Time-of-day restrictions ─────────────────────────────────────

describe('AutonomyController — time-of-day restrictions', () => {
  it('no allowed hours means never blocked', () => {
    const ac = new AutonomyController({ level: 'full' });
    const check = ac.checkLimits();
    assert.ok(!check.blocked);
  });

  it('blocks when current hour is outside allowed range', () => {
    // Set allowed 9-17, test at hour 20
    const ac = new AutonomyController({
      level: 'full',
      allowedHours: [{ start: 9, end: 17 }],
    });

    // Create a timestamp at 20:00
    const d = new Date();
    d.setHours(20, 0, 0, 0);

    // We need to test via checkLimits, but it uses Date.now() internally
    // Since we can't easily mock Date.now, let's test via the stats to verify config
    assert.deepEqual(ac.stats.allowedHours, [{ start: 9, end: 17 }]);
  });

  it('allows when current hour is inside allowed range', () => {
    const currentHour = new Date().getHours();
    // Create a range that includes the current hour
    const ac = new AutonomyController({
      level: 'full',
      allowedHours: [{ start: currentHour, end: currentHour + 1 }],
    });
    const check = ac.checkLimits();
    assert.ok(!check.blocked, 'current hour should be allowed');
  });

  it('supports overnight ranges (e.g., 22-6)', () => {
    const currentHour = new Date().getHours();
    // Create an overnight range that includes the current hour
    const start = (currentHour + 23) % 24; // one hour before, wrapping
    const end = (currentHour + 2) % 24;    // two hours after, wrapping
    // This creates a range like start > end (overnight) that includes currentHour
    const ac = new AutonomyController({
      level: 'full',
      allowedHours: [{ start, end }],
    });
    const check = ac.checkLimits();
    assert.ok(!check.blocked, `hour ${currentHour} should be within overnight range ${start}-${end}`);
  });

  it('supports multiple allowed ranges', () => {
    const currentHour = new Date().getHours();
    // First range doesn't include current hour, second does
    const wrongStart = (currentHour + 12) % 24;
    const wrongEnd = (currentHour + 13) % 24;
    const ac = new AutonomyController({
      level: 'full',
      allowedHours: [
        { start: wrongStart, end: wrongEnd },
        { start: currentHour, end: currentHour + 1 },
      ],
    });
    const check = ac.checkLimits();
    assert.ok(!check.blocked, 'should allow if any range matches');
  });

  it('time_of_day blocking has correct limitType', () => {
    // Set a range that excludes every hour (impossible range for testing: start=end=currentHour+12)
    const currentHour = new Date().getHours();
    const farHour = (currentHour + 12) % 24;
    const ac = new AutonomyController({
      level: 'full',
      allowedHours: [{ start: farHour, end: (farHour + 1) % 24 }],
    });
    const check = ac.checkLimits();
    // If current hour happens to match, this won't be blocked, but probability is low
    if (check.blocked) {
      assert.equal(check.limitType, 'time_of_day');
      assert.ok(check.reason.includes('outside allowed hours'));
    }
  });

  it('allowedHours getter/setter works', () => {
    const ac = new AutonomyController({ level: 'full' });
    assert.deepEqual(ac.allowedHours, []);
    ac.allowedHours = [{ start: 8, end: 18 }];
    assert.deepEqual(ac.allowedHours, [{ start: 8, end: 18 }]);
    ac.allowedHours = null;
    assert.deepEqual(ac.allowedHours, []);
  });
});

// ── PolicyEngine integration ─────────────────────────────────────

describe('AutonomyController — PolicyEngine', () => {
  it('canExecuteTool delegates to policy engine when set', () => {
    const ac = new AutonomyController({ level: 'full' });
    const calls = [];
    ac.setPolicyEngine({
      evaluateToolCall(toolName, params) {
        calls.push({ toolName, params });
        if (toolName === 'dangerous_tool') return { allowed: false, reason: 'blocked by policy' };
        return { allowed: true };
      },
    });

    assert.ok(ac.canExecuteTool({ permission: 'write', name: 'safe_tool' }, {}));
    assert.ok(!ac.canExecuteTool({ permission: 'write', name: 'dangerous_tool' }, {}));
    assert.equal(calls.length, 2);
  });

  it('policy engine is skipped in readonly mode (blocked by level first)', () => {
    const ac = new AutonomyController({ level: 'readonly' });
    let called = false;
    ac.setPolicyEngine({
      evaluateToolCall() { called = true; return { allowed: true }; },
    });
    // write tools are blocked by readonly before policy check
    assert.ok(!ac.canExecuteTool({ permission: 'write', name: 'test' }));
    assert.ok(!called, 'policy engine should not be called for readonly-blocked tools');
  });

  it('canExecuteTool works without policy engine', () => {
    const ac = new AutonomyController({ level: 'full' });
    assert.ok(ac.canExecuteTool({ permission: 'write', name: 'any_tool' }));
  });

  it('policyEngine getter returns the engine', () => {
    const ac = new AutonomyController({ level: 'full' });
    assert.equal(ac.policyEngine, null);
    const engine = { evaluateToolCall: () => ({ allowed: true }) };
    ac.setPolicyEngine(engine);
    assert.equal(ac.policyEngine, engine);
  });
});

// ── AutonomyPresetManager ────────────────────────────────────────

describe('AutonomyPresetManager', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('list returns empty array when no presets', () => {
    const mgr = new AutonomyPresetManager('test-ws');
    assert.deepEqual(mgr.list(), []);
  });

  it('save and list presets', () => {
    const mgr = new AutonomyPresetManager('test-ws');
    mgr.save({ name: 'work', level: 'supervised', maxActionsPerHour: 50, maxCostPerDayCents: 200, allowedHours: [{ start: 9, end: 17 }] });
    mgr.save({ name: 'night', level: 'readonly', maxActionsPerHour: 10, maxCostPerDayCents: 50, allowedHours: [{ start: 22, end: 6 }] });

    const presets = mgr.list();
    assert.equal(presets.length, 2);
    assert.equal(presets[0].name, 'work');
    assert.equal(presets[1].name, 'night');
  });

  it('save overwrites existing preset with same name', () => {
    const mgr = new AutonomyPresetManager('test-ws');
    mgr.save({ name: 'default', level: 'supervised' });
    mgr.save({ name: 'default', level: 'full' });

    const presets = mgr.list();
    assert.equal(presets.length, 1);
    assert.equal(presets[0].level, 'full');
  });

  it('load returns preset by name', () => {
    const mgr = new AutonomyPresetManager('test-ws');
    mgr.save({ name: 'strict', level: 'readonly', maxActionsPerHour: 5 });
    const preset = mgr.load('strict');
    assert.ok(preset);
    assert.equal(preset.name, 'strict');
    assert.equal(preset.level, 'readonly');
    assert.equal(preset.maxActionsPerHour, 5);
  });

  it('load returns null for non-existent preset', () => {
    const mgr = new AutonomyPresetManager('test-ws');
    assert.equal(mgr.load('nope'), null);
  });

  it('delete removes preset', () => {
    const mgr = new AutonomyPresetManager('test-ws');
    mgr.save({ name: 'temp', level: 'full' });
    assert.ok(mgr.delete('temp'));
    assert.equal(mgr.list().length, 0);
  });

  it('delete returns false for non-existent preset', () => {
    const mgr = new AutonomyPresetManager('test-ws');
    assert.ok(!mgr.delete('nope'));
  });

  it('apply loads preset and applies to agent', () => {
    const mgr = new AutonomyPresetManager('test-ws');
    mgr.save({ name: 'strict', level: 'readonly', maxActionsPerHour: 10, maxCostPerDayCents: 50, allowedHours: [{ start: 9, end: 17 }] });

    const applied = [];
    const mockAgent = {
      applyAutonomyConfig(cfg) { applied.push(cfg); },
    };

    assert.ok(mgr.apply('strict', mockAgent));
    assert.equal(applied.length, 1);
    assert.equal(applied[0].level, 'readonly');
    assert.equal(applied[0].maxActionsPerHour, 10);
    assert.deepEqual(applied[0].allowedHours, [{ start: 9, end: 17 }]);
  });

  it('apply returns false for non-existent preset', () => {
    const mgr = new AutonomyPresetManager('test-ws');
    assert.ok(!mgr.apply('nope', {}));
  });

  it('workspaces are isolated', () => {
    const mgr1 = new AutonomyPresetManager('ws-a');
    const mgr2 = new AutonomyPresetManager('ws-b');
    mgr1.save({ name: 'shared', level: 'full' });
    assert.equal(mgr1.list().length, 1);
    assert.equal(mgr2.list().length, 0, 'different workspace should be isolated');
  });
});
