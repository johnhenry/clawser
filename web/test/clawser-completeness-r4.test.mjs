/**
 * Completeness Audit Round 4 — TDD tests for 9 confirmed findings.
 *
 * F1:  ClawserAgent.pauseAgent() / resumeAgent() / isPaused
 * F2:  ClawserAgent.pauseSchedulerJob(id) / resumeSchedulerJob(id)
 * F3:  ClawserAgent.removeGoal(id)
 * F6:  SkillRegistry.isEnabled(name)
 * F8:  SkillStorage.readSkill(scope, wsId, name)
 * F11: ProfileCostLedger.getProfileThreshold(profileId)
 * F14: InputLockManager.releaseAll()
 * F18: PeripheralManager.reconnectBluetooth()
 * F20: SafetyPipeline.isDisableConfirmed getter
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── F1: ClawserAgent pause/resume ───────────────────────────────

describe('F1: ClawserAgent pause/resume public API', async () => {
  const { ClawserAgent } = await import('../clawser-agent.js');

  it('isPaused returns false by default', () => {
    const agent = new ClawserAgent({ chatFn: async () => ({ content: '' }) });
    assert.strictEqual(agent.isPaused, false);
  });

  it('pauseAgent() sets isPaused to true', () => {
    const agent = new ClawserAgent({ chatFn: async () => ({ content: '' }) });
    agent.pauseAgent();
    assert.strictEqual(agent.isPaused, true);
  });

  it('resumeAgent() resets isPaused to false', () => {
    const agent = new ClawserAgent({ chatFn: async () => ({ content: '' }) });
    agent.pauseAgent();
    assert.strictEqual(agent.isPaused, true);
    agent.resumeAgent();
    assert.strictEqual(agent.isPaused, false);
  });
});

// ── F2: Scheduler job pause/resume ──────────────────────────────

describe('F2: ClawserAgent scheduler job pause/resume', async () => {
  const { ClawserAgent } = await import('../clawser-agent.js');

  it('pauseSchedulerJob(id) pauses a job', () => {
    const agent = new ClawserAgent({ chatFn: async () => ({ content: '' }) });
    const id = agent.addSchedulerJob({ schedule_type: 'interval', prompt: 'test', interval_ms: 60000 });
    const before = agent.listSchedulerJobs().find(j => j.id === id);
    assert.strictEqual(before.paused, false);

    const result = agent.pauseSchedulerJob(id);
    assert.strictEqual(result, true);

    const after = agent.listSchedulerJobs().find(j => j.id === id);
    assert.strictEqual(after.paused, true);
  });

  it('resumeSchedulerJob(id) resumes a paused job', () => {
    const agent = new ClawserAgent({ chatFn: async () => ({ content: '' }) });
    const id = agent.addSchedulerJob({ schedule_type: 'interval', prompt: 'test', interval_ms: 60000 });
    agent.pauseSchedulerJob(id);
    assert.strictEqual(agent.listSchedulerJobs().find(j => j.id === id).paused, true);

    const result = agent.resumeSchedulerJob(id);
    assert.strictEqual(result, true);
    assert.strictEqual(agent.listSchedulerJobs().find(j => j.id === id).paused, false);
  });

  it('returns false for non-existent job', () => {
    const agent = new ClawserAgent({ chatFn: async () => ({ content: '' }) });
    assert.strictEqual(agent.pauseSchedulerJob('no_such_job'), false);
    assert.strictEqual(agent.resumeSchedulerJob('no_such_job'), false);
  });
});

// ── F3: ClawserAgent.removeGoal(id) ─────────────────────────────

describe('F3: ClawserAgent.removeGoal(id)', async () => {
  const { ClawserAgent } = await import('../clawser-agent.js');

  it('removes an existing goal and returns true', () => {
    const agent = new ClawserAgent({ chatFn: async () => ({ content: '' }) });
    const id = agent.addGoal('Test goal');
    const result = agent.removeGoal(id);
    assert.strictEqual(result, true);
    // Goal should no longer appear in state
    const state = agent.getState();
    const found = state.goals.find(g => g.id === id);
    assert.strictEqual(found, undefined);
  });

  it('returns false for non-existent goal', () => {
    const agent = new ClawserAgent({ chatFn: async () => ({ content: '' }) });
    assert.strictEqual(agent.removeGoal('no_such_goal'), false);
  });
});

// ── F6: SkillRegistry.isEnabled(name) ───────────────────────────

describe('F6: SkillRegistry.isEnabled(name)', async () => {
  const { SkillRegistry } = await import('../clawser-skills.js');

  it('returns true for a skill that is enabled', () => {
    const reg = new SkillRegistry();
    // Populate internal skills map via the public getter (returns the Map reference)
    reg.skills.set('test-skill', { name: 'test-skill', enabled: true, description: '', metadata: {}, scope: 'global', dirName: 'test-skill', bodyLength: 0 });
    reg.setEnabled('test-skill', true);
    assert.strictEqual(reg.isEnabled('test-skill'), true);
  });

  it('returns false for a skill that is disabled', () => {
    const reg = new SkillRegistry();
    reg.skills.set('test-skill', { name: 'test-skill', enabled: true, description: '', metadata: {}, scope: 'global', dirName: 'test-skill', bodyLength: 0 });
    reg.setEnabled('test-skill', false);
    assert.strictEqual(reg.isEnabled('test-skill'), false);
  });

  it('returns undefined for unknown skill', () => {
    const reg = new SkillRegistry();
    assert.strictEqual(reg.isEnabled('nonexistent'), undefined);
  });
});

// ── F8: SkillStorage.readSkill() ────────────────────────────────

describe('F8: SkillStorage.readSkill()', async () => {
  const { SkillStorage } = await import('../clawser-skills.js');

  it('readSkill is a static async method', () => {
    assert.strictEqual(typeof SkillStorage.readSkill, 'function');
  });
});

// ── F11: ProfileCostLedger.getProfileThreshold(profileId) ───────

describe('F11: ProfileCostLedger.getProfileThreshold()', async () => {
  const { ProfileCostLedger } = await import('../clawser-providers.js');

  it('returns the threshold after it has been set', () => {
    const ledger = new ProfileCostLedger();
    ledger.setProfileThreshold('profile-1', 10.5);
    assert.strictEqual(ledger.getProfileThreshold('profile-1'), 10.5);
  });

  it('returns undefined for unset profile', () => {
    const ledger = new ProfileCostLedger();
    assert.strictEqual(ledger.getProfileThreshold('unknown'), undefined);
  });

  it('reflects updated thresholds', () => {
    const ledger = new ProfileCostLedger();
    ledger.setProfileThreshold('p', 5);
    ledger.setProfileThreshold('p', 20);
    assert.strictEqual(ledger.getProfileThreshold('p'), 20);
  });
});

// ── F14: InputLockManager.releaseAll() ──────────────────────────

describe('F14: InputLockManager.releaseAll()', async () => {
  const { InputLockManager } = await import('../clawser-daemon.js');

  it('releases all held locks', async () => {
    const mgr = new InputLockManager();
    await mgr.tryAcquire('lock-a');
    await mgr.tryAcquire('lock-b');
    assert.strictEqual(mgr.heldLocks().length, 2);

    mgr.releaseAll();
    assert.strictEqual(mgr.heldLocks().length, 0);
    assert.strictEqual(mgr.isHeld('lock-a'), false);
    assert.strictEqual(mgr.isHeld('lock-b'), false);
  });

  it('is a no-op when no locks are held', () => {
    const mgr = new InputLockManager();
    mgr.releaseAll(); // should not throw
    assert.strictEqual(mgr.heldLocks().length, 0);
  });
});

// ── F18: PeripheralManager.reconnectBluetooth() ─────────────────

describe('F18: PeripheralManager.reconnectBluetooth()', async () => {
  const { PeripheralManager } = await import('../clawser-hardware.js');

  it('reconnectBluetooth is an async method', () => {
    const mgr = new PeripheralManager();
    assert.strictEqual(typeof mgr.reconnectBluetooth, 'function');
  });

  it('returns empty array when bluetooth API is unavailable', async () => {
    const mgr = new PeripheralManager();
    const result = await mgr.reconnectBluetooth();
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 0);
  });
});

// ── F20: SafetyPipeline.isDisableConfirmed getter ───────────────

describe('F20: SafetyPipeline.isDisableConfirmed getter', async () => {
  const { SafetyPipeline } = await import('../clawser-safety.js');

  it('returns false by default', () => {
    const pipeline = new SafetyPipeline();
    assert.strictEqual(pipeline.isDisableConfirmed, false);
  });

  it('returns true after confirmDisable()', () => {
    const pipeline = new SafetyPipeline();
    pipeline.confirmDisable();
    assert.strictEqual(pipeline.isDisableConfirmed, true);
  });

  it('resets to false after confirmEnable()', () => {
    const pipeline = new SafetyPipeline();
    pipeline.confirmDisable();
    assert.strictEqual(pipeline.isDisableConfirmed, true);
    pipeline.confirmEnable();
    assert.strictEqual(pipeline.isDisableConfirmed, false);
  });
});
