// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-git.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.BrowserTool = class { constructor() {} };

import {
  COMMIT_TYPES,
  COMMIT_PREFIX_RE,
  TRAILER_RE,
  formatCommitMessage,
  parseCommitMessage,
  GitBehavior,
  GitEpisodicMemory,
  GitOpsProvider,
  MockGitBackend,
  AutoInitManager,
  CommitSearchIndex,
  ConflictResolver,
} from '../clawser-git.js';

// ── Constants ───────────────────────────────────────────────────

describe('COMMIT_TYPES', () => {
  it('has expected values', () => {
    assert.equal(COMMIT_TYPES.GOAL, 'goal');
    assert.equal(COMMIT_TYPES.EXPERIMENT, 'experiment');
    assert.equal(COMMIT_TYPES.REVERT, 'revert');
    assert.equal(COMMIT_TYPES.FIX, 'fix');
    assert.equal(COMMIT_TYPES.REFACTOR, 'refactor');
    assert.equal(COMMIT_TYPES.CHECKPOINT, 'checkpoint');
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(COMMIT_TYPES));
  });
});

describe('COMMIT_PREFIX_RE', () => {
  it('matches formatted messages', () => {
    const msg = '[goal:g1] Finished task';
    const match = COMMIT_PREFIX_RE.exec(msg);
    assert.ok(match);
    assert.equal(match[1], 'goal');
    assert.equal(match[2], 'g1');
    assert.equal(match[3], 'Finished task');
  });
});

describe('TRAILER_RE', () => {
  it('matches trailer lines', () => {
    const line = 'Clawser-Goal: g42';
    const match = TRAILER_RE.exec(line);
    assert.ok(match);
    assert.equal(match[1], 'Goal');
    assert.equal(match[2], 'g42');
  });
});

// ── formatCommitMessage ─────────────────────────────────────────

describe('formatCommitMessage', () => {
  it('formats basic message with [type:id] prefix', () => {
    const msg = formatCommitMessage({ type: 'goal', id: 'g1', summary: 'Did stuff' });
    assert.ok(msg.startsWith('[goal:g1] Did stuff'));
  });

  it('includes body when provided', () => {
    const msg = formatCommitMessage({ type: 'fix', id: 'f1', summary: 'Fixed bug', body: 'Detailed explanation' });
    assert.ok(msg.includes('Detailed explanation'));
    // Body is separated from first line by a blank line
    const lines = msg.split('\n');
    assert.equal(lines[1], '');
    assert.equal(lines[2], 'Detailed explanation');
  });

  it('includes trailers when provided', () => {
    const msg = formatCommitMessage({
      type: 'goal',
      id: 'g1',
      summary: 'Done',
      trailers: { goalId: 'g1', action: 'complete', cost: 0.05 },
    });
    assert.ok(msg.includes('Clawser-Goal: g1'));
    assert.ok(msg.includes('Clawser-Action: complete'));
    assert.ok(msg.includes('Clawser-Cost: 0.05'));
  });

  it('includes goalId, action, cost trailers', () => {
    const msg = formatCommitMessage({
      type: 'checkpoint',
      id: 'auto',
      summary: 'auto save',
      trailers: { goalId: 'abc', action: 'save', cost: 1.23 },
    });
    const lines = msg.split('\n');
    const trailerLines = lines.filter(l => l.startsWith('Clawser-'));
    assert.equal(trailerLines.length, 3);
  });
});

// ── parseCommitMessage ──────────────────────────────────────────

describe('parseCommitMessage', () => {
  it('parses formatted message', () => {
    const parsed = parseCommitMessage('[goal:g1] Finished task');
    assert.ok(parsed);
    assert.equal(parsed.type, 'goal');
    assert.equal(parsed.id, 'g1');
    assert.equal(parsed.summary, 'Finished task');
  });

  it('returns null for non-formatted message', () => {
    const parsed = parseCommitMessage('Just a regular commit message');
    assert.equal(parsed, null);
  });

  it('parses body text', () => {
    const msg = '[fix:f1] Fixed issue\n\nThis is the body\nWith multiple lines';
    const parsed = parseCommitMessage(msg);
    assert.ok(parsed);
    assert.ok(parsed.body.includes('This is the body'));
    assert.ok(parsed.body.includes('With multiple lines'));
  });

  it('parses trailers', () => {
    const msg = '[goal:g1] Done\n\nClawser-Goal: g1\nClawser-Action: complete';
    const parsed = parseCommitMessage(msg);
    assert.ok(parsed);
    assert.equal(parsed.trailers.goal, 'g1');
    assert.equal(parsed.trailers.action, 'complete');
  });

  it('handles message with no body or trailers', () => {
    const parsed = parseCommitMessage('[checkpoint:auto] Quick save');
    assert.ok(parsed);
    assert.equal(parsed.body, '');
    assert.deepEqual(parsed.trailers, {});
  });
});

// ── MockGitBackend ──────────────────────────────────────────────

describe('MockGitBackend', () => {
  let backend;

  beforeEach(() => {
    backend = new MockGitBackend();
  });

  it('init sets initialized', async () => {
    assert.equal(backend.initialized, false);
    await backend.init();
    assert.equal(backend.initialized, true);
  });

  it('commit returns oid and clears staged', async () => {
    await backend.add('file.txt');
    const status1 = await backend.status();
    assert.equal(status1.length, 1);

    const oid = await backend.commit('test commit', { name: 'test', email: 't@t.com' });
    assert.ok(typeof oid === 'string');
    assert.ok(oid.length > 0);

    const status2 = await backend.status();
    assert.equal(status2.length, 0);
  });

  it('log returns commits in order', async () => {
    await backend.commit('first');
    await backend.commit('second');
    const log = await backend.log();
    assert.equal(log.length, 2);
    // Most recent first (unshift)
    assert.equal(log[0].message, 'second');
    assert.equal(log[1].message, 'first');
  });

  it('add stages files', async () => {
    await backend.add('a.txt');
    await backend.add('b.txt');
    const status = await backend.status();
    assert.equal(status.length, 2);
  });

  it('status returns staged files', async () => {
    await backend.add('file.js');
    const status = await backend.status();
    assert.equal(status.length, 1);
    assert.equal(status[0].path, 'file.js');
    assert.equal(status[0].status, 'modified');
  });
});

// ── GitBehavior ─────────────────────────────────────────────────

describe('GitBehavior', () => {
  let backend;
  let behavior;

  beforeEach(() => {
    backend = new MockGitBackend();
    behavior = new GitBehavior({ ops: backend });
  });

  it('constructor defaults', () => {
    const b = new GitBehavior();
    assert.ok(b.author.name);
    assert.ok(b.author.email);
    assert.equal(b.microCommits, true);
    assert.equal(b.currentBranch, 'main');
  });

  it('author returns copy', () => {
    const a1 = behavior.author;
    const a2 = behavior.author;
    assert.deepEqual(a1, a2);
    a1.name = 'mutated';
    assert.notEqual(behavior.author.name, 'mutated');
  });

  it('commitGoalCheckpoint creates formatted commit', async () => {
    const sha = await behavior.commitGoalCheckpoint('g1', 'Completed goal', { action: 'done', cost: 0.1 });
    assert.ok(typeof sha === 'string');

    const log = await backend.log();
    assert.equal(log.length, 1);
    assert.ok(log[0].message.includes('[goal:g1]'));
    assert.ok(log[0].message.includes('Clawser-Goal: g1'));
  });

  it('microCommit creates checkpoint commit', async () => {
    const sha = await behavior.microCommit('fs_write', 'wrote file.txt');
    assert.ok(sha);
    const log = await backend.log();
    assert.ok(log[0].message.includes('[checkpoint:auto]'));
    assert.ok(log[0].message.includes('fs_write'));
  });

  it('microCommit returns null when disabled', async () => {
    behavior.microCommits = false;
    const result = await behavior.microCommit('tool', 'desc');
    assert.equal(result, null);
  });

  it('branchExperiment creates and switches to experiment/ branch', async () => {
    const branch = await behavior.branchExperiment('test-idea');
    assert.equal(branch, 'experiment/test-idea');
    assert.equal(behavior.currentBranch, 'experiment/test-idea');
  });

  it('mergeExperiment switches back to main', async () => {
    await behavior.branchExperiment('test-idea');
    await behavior.mergeExperiment('experiment/test-idea');
    assert.equal(behavior.currentBranch, 'main');
  });

  it('status delegates to ops', async () => {
    await backend.add('x.txt');
    const status = await behavior.status();
    assert.ok(Array.isArray(status));
    assert.equal(status.length, 1);
  });

  it('log delegates to ops', async () => {
    await backend.commit('msg1');
    await backend.commit('msg2');
    const log = await behavior.log();
    assert.equal(log.length, 2);
  });

  it('reflect returns summary object', async () => {
    await behavior.commitGoalCheckpoint('g1', 'checkpoint 1');
    await behavior.commitGoalCheckpoint('g1', 'checkpoint 2');
    const summary = await behavior.reflect('g1');
    assert.ok(typeof summary.totalCommits === 'number');
    assert.ok(typeof summary.goalCommits === 'number');
    assert.ok(typeof summary.experiments === 'number');
    assert.ok(typeof summary.reverts === 'number');
    assert.ok(Array.isArray(summary.recentMessages));
  });
});

// ── GitEpisodicMemory ───────────────────────────────────────────

describe('GitEpisodicMemory', () => {
  let backend;
  let behavior;
  let memory;

  beforeEach(async () => {
    backend = new MockGitBackend();
    behavior = new GitBehavior({ ops: backend });
    memory = new GitEpisodicMemory(behavior);

    // Seed some commits
    await behavior.commitGoalCheckpoint('g1', 'Build login page');
    await behavior.commitGoalCheckpoint('g2', 'Add API endpoint');
    await behavior.microCommit('fetch', 'Downloaded data');
  });

  it('recallByTopic finds matching commits', async () => {
    const results = await memory.recallByTopic('login');
    assert.ok(results.length >= 1);
    assert.ok(results[0].message.includes('login'));
  });

  it('recallByGoal finds goal commits', async () => {
    const results = await memory.recallByGoal('g1');
    assert.ok(results.length >= 1);
    assert.ok(results[0].message.includes('Clawser-Goal: g1'));
  });

  it('recallExperiments returns experiment stats', async () => {
    const result = await memory.recallExperiments();
    assert.ok(typeof result.successRate === 'number');
    assert.ok(Array.isArray(result.experiments));
    assert.ok(Array.isArray(result.reverts));
  });
});

// ── CommitSearchIndex ───────────────────────────────────────────

describe('CommitSearchIndex', () => {
  let index;

  beforeEach(() => {
    index = new CommitSearchIndex();
  });

  it('add increases size', () => {
    assert.equal(index.size, 0);
    index.add({ oid: 'a1', message: 'fix login bug', timestamp: 1000 });
    assert.equal(index.size, 1);
  });

  it('search finds matching commits', () => {
    index.add({ oid: 'a1', message: 'fix login bug', timestamp: 1000 });
    index.add({ oid: 'a2', message: 'add dashboard feature', timestamp: 2000 });
    index.add({ oid: 'a3', message: 'fix login timeout', timestamp: 3000 });

    const results = index.search('login');
    assert.ok(results.length >= 2);
    assert.ok(results.every(r => r.message.includes('login')));
  });

  it('search returns empty for no matches', () => {
    index.add({ oid: 'a1', message: 'fix login bug', timestamp: 1000 });
    const results = index.search('banana');
    assert.equal(results.length, 0);
  });

  it('search scores by relevance', () => {
    index.add({ oid: 'a1', message: 'login login login fix', timestamp: 1000 });
    index.add({ oid: 'a2', message: 'login once', timestamp: 2000 });

    const results = index.search('login');
    assert.ok(results.length === 2);
    // Higher score first (more occurrences)
    assert.equal(results[0].oid, 'a1');
    assert.ok(results[0].score > results[1].score);
  });
});

// ── ConflictResolver ────────────────────────────────────────────

describe('ConflictResolver', () => {
  it('default strategy is ours', () => {
    const resolver = new ConflictResolver();
    assert.equal(resolver.strategy, 'ours');
  });

  it('resolve with ours returns ours content', () => {
    const resolver = new ConflictResolver({ strategy: 'ours' });
    const result = resolver.resolve({
      path: 'file.txt',
      ours: 'our version',
      theirs: 'their version',
      base: 'base version',
    });
    assert.equal(result.content, 'our version');
    assert.equal(result.strategy, 'ours');
    assert.equal(result.path, 'file.txt');
  });

  it('resolve with theirs returns theirs content', () => {
    const resolver = new ConflictResolver({ strategy: 'theirs' });
    const result = resolver.resolve({
      path: 'file.txt',
      ours: 'our version',
      theirs: 'their version',
      base: 'base version',
    });
    assert.equal(result.content, 'their version');
    assert.equal(result.strategy, 'theirs');
  });

  it('resolveAll resolves multiple conflicts', () => {
    const resolver = new ConflictResolver({ strategy: 'ours' });
    const results = resolver.resolveAll([
      { path: 'a.txt', ours: 'ours-a', theirs: 'theirs-a', base: 'base-a' },
      { path: 'b.txt', ours: 'ours-b', theirs: 'theirs-b', base: 'base-b' },
    ]);
    assert.equal(results.length, 2);
    assert.equal(results[0].content, 'ours-a');
    assert.equal(results[1].content, 'ours-b');
  });

  it('union merge combines both sides', () => {
    const resolver = new ConflictResolver({ strategy: 'union' });
    const result = resolver.resolve({
      path: 'file.txt',
      base: 'line1\nline2',
      ours: 'line1\nline2\nours-new',
      theirs: 'line1\nline2\ntheirs-new',
    });
    assert.ok(result.content.includes('ours-new'));
    assert.ok(result.content.includes('theirs-new'));
    assert.ok(result.content.includes('line1'));
    assert.equal(result.strategy, 'union');
  });
});

// ── AutoInitManager ─────────────────────────────────────────────

describe('AutoInitManager', () => {
  let backend;
  let manager;

  beforeEach(() => {
    backend = new MockGitBackend();
    manager = new AutoInitManager({ backend });
  });

  it('isInitialized defaults to false', () => {
    assert.equal(manager.isInitialized, false);
  });

  it('ensureRepo calls backend.init', async () => {
    const result = await manager.ensureRepo();
    assert.equal(result.initialized, true);
    assert.equal(manager.isInitialized, true);
    assert.equal(backend.initialized, true);
  });

  it('ensureRepo returns alreadyExists on second call', async () => {
    await manager.ensureRepo();
    const result = await manager.ensureRepo();
    assert.equal(result.initialized, false);
    assert.equal(result.alreadyExists, true);
  });
});
