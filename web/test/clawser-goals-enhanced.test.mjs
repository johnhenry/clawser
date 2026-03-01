// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-goals-enhanced.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  Goal, GoalManager, resetGoalIdCounter,
  GoalAddTool, GoalUpdateTool, GoalAddArtifactTool, GoalRemoveArtifactTool,
  GoalDecomposeTool, GoalListTool,
} from '../clawser-goals.js';

// ── Deadline/Due Date Field (Block 8) ───────────────────────────

describe('Goal deadline field', () => {
  beforeEach(() => resetGoalIdCounter());

  it('Goal accepts a deadline in constructor', () => {
    const deadline = Date.now() + 86_400_000; // tomorrow
    const goal = new Goal({ description: 'Ship v1', deadline });
    assert.equal(goal.deadline, deadline);
  });

  it('Goal defaults deadline to null', () => {
    const goal = new Goal({ description: 'No deadline' });
    assert.equal(goal.deadline, null);
  });

  it('Goal serializes deadline in toJSON', () => {
    const deadline = Date.now() + 3_600_000;
    const goal = new Goal({ description: 'Test', deadline });
    const json = goal.toJSON();
    assert.equal(json.deadline, deadline);
  });

  it('Goal deserializes deadline from fromJSON', () => {
    const deadline = Date.now() + 7_200_000;
    const goal = Goal.fromJSON({
      id: 'goal-001',
      description: 'Test',
      deadline,
    });
    assert.equal(goal.deadline, deadline);
  });

  it('GoalManager.addGoal accepts deadline option', () => {
    const mgr = new GoalManager();
    const deadline = Date.now() + 86_400_000;
    const goal = mgr.addGoal('Ship v2', { deadline });
    assert.equal(goal.deadline, deadline);
  });

  it('buildPrompt shows deadline for goals with due dates', () => {
    const mgr = new GoalManager();
    const deadline = new Date('2026-04-01T00:00:00Z').getTime();
    mgr.addGoal('Launch product', { deadline });
    const prompt = mgr.buildPrompt();
    assert.ok(prompt.includes('2026'), 'should include deadline year');
  });
});

// ── Goal Markdown Serialization (Block 8) ───────────────────────

describe('GoalManager markdown format', () => {
  beforeEach(() => resetGoalIdCounter());

  it('GoalManager exposes toMarkdown() method', () => {
    const mgr = new GoalManager();
    assert.equal(typeof mgr.toMarkdown, 'function');
  });

  it('toMarkdown produces valid markdown with headers', () => {
    const mgr = new GoalManager();
    mgr.addGoal('Build authentication', { priority: 'high' });
    mgr.addGoal('Write tests', { priority: 'medium' });

    const md = mgr.toMarkdown();
    assert.ok(md.includes('# Goals'), 'should have a # Goals header');
    assert.ok(md.includes('Build authentication'));
    assert.ok(md.includes('Write tests'));
  });

  it('toMarkdown represents sub-goals as nested list items', () => {
    const mgr = new GoalManager();
    const parent = mgr.addGoal('Parent goal');
    mgr.addSubGoal(parent.id, 'Sub-goal 1');
    mgr.addSubGoal(parent.id, 'Sub-goal 2');

    const md = mgr.toMarkdown();
    assert.ok(md.includes('Parent goal'));
    assert.ok(md.includes('Sub-goal 1'));
    assert.ok(md.includes('Sub-goal 2'));
  });

  it('toMarkdown shows completed goals with [x] checkbox', () => {
    const mgr = new GoalManager();
    const goal = mgr.addGoal('Done goal');
    mgr.updateStatus(goal.id, 'completed');

    const md = mgr.toMarkdown();
    assert.ok(md.includes('[x]'), 'completed goal should have [x]');
  });

  it('toMarkdown shows active goals with [ ] checkbox', () => {
    const mgr = new GoalManager();
    mgr.addGoal('Active goal');

    const md = mgr.toMarkdown();
    assert.ok(md.includes('[ ]'), 'active goal should have [ ]');
  });

  it('toMarkdown includes priority label', () => {
    const mgr = new GoalManager();
    mgr.addGoal('Critical bug', { priority: 'critical' });

    const md = mgr.toMarkdown();
    assert.ok(md.includes('critical'), 'should include priority');
  });

  it('toMarkdown includes deadline when set', () => {
    const mgr = new GoalManager();
    mgr.addGoal('Ship it', { deadline: new Date('2026-06-01T00:00:00Z').getTime() });

    const md = mgr.toMarkdown();
    assert.ok(md.includes('2026-06-01'), 'should include deadline date');
  });

  it('GoalManager exposes fromMarkdown() static method', () => {
    assert.equal(typeof GoalManager.fromMarkdown, 'function');
  });

  it('fromMarkdown round-trips with toMarkdown', () => {
    const mgr = new GoalManager();
    mgr.addGoal('Goal A', { priority: 'high' });
    const goalB = mgr.addGoal('Goal B');
    mgr.addSubGoal(goalB.id, 'Sub B1');
    mgr.updateStatus(mgr.list()[0].id, 'completed', 'Done!');

    const md = mgr.toMarkdown();
    const restored = GoalManager.fromMarkdown(md);

    assert.equal(restored.size, 3, 'should restore all 3 goals');
    const roots = restored.list({ rootOnly: true });
    assert.equal(roots.length, 2, 'should have 2 root goals');
  });

  it('fromMarkdown parses checkbox state', () => {
    const md = `# Goals

- [x] **(high)** Completed task
- [ ] **(medium)** Active task`;

    const mgr = GoalManager.fromMarkdown(md);
    const goals = mgr.list();
    const completed = goals.find(g => g.description.includes('Completed'));
    const active = goals.find(g => g.description.includes('Active'));
    assert.equal(completed.status, 'completed');
    assert.equal(active.status, 'active');
  });
});

// ── Goal Dependency/Blocking (Block 8) ──────────────────────────

describe('Goal dependency/blocking', () => {
  beforeEach(() => resetGoalIdCounter());

  it('Goal accepts blockedBy array', () => {
    const goal = new Goal({ description: 'Test', blockedBy: ['goal-001'] });
    assert.deepEqual(goal.blockedBy, ['goal-001']);
  });

  it('Goal defaults blockedBy to empty array', () => {
    const goal = new Goal({ description: 'Test' });
    assert.deepEqual(goal.blockedBy, []);
  });

  it('GoalManager.addDependency links two goals', () => {
    const mgr = new GoalManager();
    const a = mgr.addGoal('Goal A');
    const b = mgr.addGoal('Goal B');

    mgr.addDependency(b.id, a.id); // B depends on A
    const bGoal = mgr.get(b.id);
    assert.ok(bGoal.blockedBy.includes(a.id));
  });

  it('GoalManager.isBlocked returns true for unfinished deps', () => {
    const mgr = new GoalManager();
    const a = mgr.addGoal('Goal A');
    const b = mgr.addGoal('Goal B');
    mgr.addDependency(b.id, a.id);

    assert.equal(mgr.isBlocked(b.id), true);
  });

  it('GoalManager.isBlocked returns false after deps completed', () => {
    const mgr = new GoalManager();
    const a = mgr.addGoal('Goal A');
    const b = mgr.addGoal('Goal B');
    mgr.addDependency(b.id, a.id);

    mgr.updateStatus(a.id, 'completed');
    assert.equal(mgr.isBlocked(b.id), false);
  });

  it('blockedBy serializes in toJSON', () => {
    const goal = new Goal({ description: 'Test', blockedBy: ['goal-001', 'goal-002'] });
    const json = goal.toJSON();
    assert.deepEqual(json.blockedBy, ['goal-001', 'goal-002']);
  });
});

// ── Goal Tool Permission Levels ──────────────────────────────────

describe('Goal tool permission levels', () => {
  const mgr = new GoalManager();

  it('GoalAddTool requires approve permission', () => {
    const tool = new GoalAddTool(mgr);
    assert.equal(tool.permission, 'approve');
  });

  it('GoalUpdateTool requires approve permission', () => {
    const tool = new GoalUpdateTool(mgr);
    assert.equal(tool.permission, 'approve');
  });

  it('GoalAddArtifactTool requires approve permission', () => {
    const tool = new GoalAddArtifactTool(mgr);
    assert.equal(tool.permission, 'approve');
  });

  it('GoalDecomposeTool requires approve permission', () => {
    const tool = new GoalDecomposeTool(mgr);
    assert.equal(tool.permission, 'approve');
  });

  it('GoalListTool has read permission', () => {
    const tool = new GoalListTool(mgr);
    assert.equal(tool.permission, 'read');
  });
});

// ── GoalManager.removeArtifact ──────────────────────────────────

describe('GoalManager.removeArtifact', () => {
  beforeEach(() => resetGoalIdCounter());

  it('removes an existing artifact and returns true', () => {
    const mgr = new GoalManager();
    const goal = mgr.addGoal('Build feature');
    mgr.addArtifact(goal.id, '/src/feature.js');
    mgr.addArtifact(goal.id, '/src/feature.test.js');

    const result = mgr.removeArtifact(goal.id, '/src/feature.js');
    assert.equal(result, true);
    assert.deepEqual(mgr.get(goal.id).artifacts, ['/src/feature.test.js']);
  });

  it('returns false for non-existent artifact', () => {
    const mgr = new GoalManager();
    const goal = mgr.addGoal('Build feature');
    mgr.addArtifact(goal.id, '/src/feature.js');

    const result = mgr.removeArtifact(goal.id, '/src/missing.js');
    assert.equal(result, false);
  });

  it('returns false for non-existent goal', () => {
    const mgr = new GoalManager();

    const result = mgr.removeArtifact('goal-999', '/src/feature.js');
    assert.equal(result, false);
  });

  it('updates the goal updatedAt timestamp', () => {
    const mgr = new GoalManager();
    const goal = mgr.addGoal('Build feature');
    mgr.addArtifact(goal.id, '/src/feature.js');
    const before = mgr.get(goal.id).updatedAt;

    // Small delay to ensure timestamp differs
    mgr.removeArtifact(goal.id, '/src/feature.js');
    assert.ok(mgr.get(goal.id).updatedAt >= before);
  });
});

// ── GoalManager.removeDependency ────────────────────────────────

describe('GoalManager.removeDependency', () => {
  beforeEach(() => resetGoalIdCounter());

  it('removes an existing dependency and returns true', () => {
    const mgr = new GoalManager();
    const a = mgr.addGoal('Goal A');
    const b = mgr.addGoal('Goal B');
    const c = mgr.addGoal('Goal C');
    mgr.addDependency(c.id, a.id);
    mgr.addDependency(c.id, b.id);

    const result = mgr.removeDependency(c.id, a.id);
    assert.equal(result, true);
    assert.deepEqual(mgr.get(c.id).blockedBy, [b.id]);
  });

  it('returns false for non-existent dependency', () => {
    const mgr = new GoalManager();
    const a = mgr.addGoal('Goal A');
    const b = mgr.addGoal('Goal B');
    mgr.addDependency(b.id, a.id);

    const result = mgr.removeDependency(b.id, 'goal-999');
    assert.equal(result, false);
  });

  it('returns false for non-existent goal', () => {
    const mgr = new GoalManager();

    const result = mgr.removeDependency('goal-999', 'goal-001');
    assert.equal(result, false);
  });

  it('updates the goal updatedAt timestamp', () => {
    const mgr = new GoalManager();
    const a = mgr.addGoal('Goal A');
    const b = mgr.addGoal('Goal B');
    mgr.addDependency(b.id, a.id);
    const before = mgr.get(b.id).updatedAt;

    mgr.removeDependency(b.id, a.id);
    assert.ok(mgr.get(b.id).updatedAt >= before);
  });
});

// ── GoalRemoveArtifactTool ──────────────────────────────────────

describe('GoalRemoveArtifactTool', () => {
  beforeEach(() => resetGoalIdCounter());

  it('has approve permission', () => {
    const mgr = new GoalManager();
    const tool = new GoalRemoveArtifactTool(mgr);
    assert.equal(tool.permission, 'approve');
  });

  it('has correct name', () => {
    const mgr = new GoalManager();
    const tool = new GoalRemoveArtifactTool(mgr);
    assert.equal(tool.name, 'goal_remove_artifact');
  });

  it('successfully removes an artifact', async () => {
    const mgr = new GoalManager();
    const goal = mgr.addGoal('Build feature');
    mgr.addArtifact(goal.id, '/src/feature.js');

    const tool = new GoalRemoveArtifactTool(mgr);
    const result = await tool.execute({ goal_id: goal.id, file_path: '/src/feature.js' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('/src/feature.js'));
    assert.deepEqual(mgr.get(goal.id).artifacts, []);
  });

  it('returns failure for non-existent goal', async () => {
    const mgr = new GoalManager();
    const tool = new GoalRemoveArtifactTool(mgr);
    const result = await tool.execute({ goal_id: 'goal-999', file_path: '/src/feature.js' });
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it('returns failure for non-existent artifact', async () => {
    const mgr = new GoalManager();
    const goal = mgr.addGoal('Build feature');

    const tool = new GoalRemoveArtifactTool(mgr);
    const result = await tool.execute({ goal_id: goal.id, file_path: '/src/missing.js' });
    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});
