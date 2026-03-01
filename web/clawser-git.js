// clawser-git.js — Git as Agent Behavior
//
// CommitType: structured commit types for machine-readable history
// formatCommitMessage / parseCommitMessage: convention parser/formatter
// GitBehavior: auto-commit at goal boundaries, experiment branching, reflection
// GitEpisodicMemory: queryable commit history (recall by topic, goal, experiments)
// Agent tools: git_status, git_diff, git_log, git_commit, git_branch, git_recall

import { BrowserTool } from './clawser-tools.js';

// ── Constants ───────────────────────────────────────────────────

export const COMMIT_TYPES = Object.freeze({
  GOAL: 'goal',
  EXPERIMENT: 'experiment',
  REVERT: 'revert',
  FIX: 'fix',
  REFACTOR: 'refactor',
  CHECKPOINT: 'checkpoint',
});

export const COMMIT_PREFIX_RE = /^\[(\w+):([^\]]+)\]\s+(.+)/;
export const TRAILER_RE = /^Clawser-(\w+):\s*(.+)$/;

// ── Commit Message Convention ───────────────────────────────────

/**
 * Format a structured commit message.
 * @param {object} opts
 * @param {string} opts.type - COMMIT_TYPES value
 * @param {string} opts.id - Goal/experiment ID
 * @param {string} opts.summary - Human-readable summary
 * @param {string} [opts.body] - Optional body with rationale
 * @param {object} [opts.trailers] - { goalId, action, cost }
 * @returns {string}
 */
export function formatCommitMessage(opts) {
  const lines = [`[${opts.type}:${opts.id}] ${opts.summary}`];
  if (opts.body) {
    lines.push('', opts.body);
  }
  if (opts.trailers) {
    lines.push('');
    if (opts.trailers.goalId) lines.push(`Clawser-Goal: ${opts.trailers.goalId}`);
    if (opts.trailers.action != null) lines.push(`Clawser-Action: ${opts.trailers.action}`);
    if (opts.trailers.cost != null) lines.push(`Clawser-Cost: ${opts.trailers.cost}`);
  }
  return lines.join('\n');
}

/**
 * Parse a structured commit message.
 * @param {string} message
 * @returns {{ type: string, id: string, summary: string, body: string, trailers: object }|null}
 */
export function parseCommitMessage(message) {
  const lines = message.split('\n');
  const firstLine = lines[0] || '';
  const match = COMMIT_PREFIX_RE.exec(firstLine);
  if (!match) return null;

  const [, type, id, summary] = match;
  const trailers = {};
  const bodyLines = [];
  let inTrailers = false;

  for (let i = 1; i < lines.length; i++) {
    const tMatch = TRAILER_RE.exec(lines[i]);
    if (tMatch) {
      inTrailers = true;
      trailers[tMatch[1].toLowerCase()] = tMatch[2];
    } else if (!inTrailers && lines[i].trim()) {
      bodyLines.push(lines[i]);
    }
  }

  return {
    type,
    id,
    summary,
    body: bodyLines.join('\n').trim(),
    trailers,
  };
}

// ── GitBehavior ─────────────────────────────────────────────────

/**
 * Agent behavior module for version-controlled cognition.
 * All git operations are injectable for testing.
 */
export class GitBehavior {
  /** @type {object} Injectable git operations */
  #ops;

  /** @type {{ name: string, email: string }} */
  #author;

  /** @type {boolean} */
  #microCommits;

  /** @type {string|null} Current branch */
  #currentBranch = 'main';

  /** @type {Function|null} */
  #onCommit;

  /**
   * @param {object} opts
   * @param {object} opts.ops - Git operations { status, add, commit, log, diff, branch, checkout, merge, deleteBranch, resolveRef }
   * @param {{ name: string, email: string }} [opts.author]
   * @param {boolean} [opts.microCommits=true]
   * @param {Function} [opts.onCommit] - (sha, message) => void
   */
  constructor(opts = {}) {
    this.#ops = opts.ops || {};
    this.#author = opts.author || { name: 'Clawser Agent', email: 'agent@clawser.local' };
    this.#microCommits = opts.microCommits !== false;
    this.#onCommit = opts.onCommit || null;
  }

  get author() { return { ...this.#author }; }
  get microCommits() { return this.#microCommits; }
  set microCommits(v) { this.#microCommits = v; }
  get currentBranch() { return this.#currentBranch; }

  // ── Goal-boundary commits ──────────────────────────────

  /**
   * Commit a goal checkpoint.
   * @param {string} goalId
   * @param {string} message
   * @param {object} [meta] - { action, cost }
   * @returns {Promise<string>} Commit SHA
   */
  async commitGoalCheckpoint(goalId, message, meta = {}) {
    const msg = formatCommitMessage({
      type: COMMIT_TYPES.GOAL,
      id: goalId,
      summary: message,
      trailers: {
        goalId,
        action: meta.action,
        cost: meta.cost,
      },
    });
    return this.#doCommit(msg);
  }

  /**
   * Create a micro-commit (tool execution checkpoint).
   * No-op if microCommits is disabled.
   * @param {string} toolName
   * @param {string} description
   * @returns {Promise<string|null>}
   */
  async microCommit(toolName, description) {
    if (!this.#microCommits) return null;
    const msg = formatCommitMessage({
      type: COMMIT_TYPES.CHECKPOINT,
      id: 'auto',
      summary: `${toolName}: ${description}`,
    });
    return this.#doCommit(msg);
  }

  /**
   * Create a checkpoint commit (e.g., before context compaction).
   * @param {string} reason
   * @returns {Promise<string>}
   */
  async checkpoint(reason) {
    const msg = formatCommitMessage({
      type: COMMIT_TYPES.CHECKPOINT,
      id: 'manual',
      summary: reason,
    });
    return this.#doCommit(msg);
  }

  // ── Experiment branching ───────────────────────────────

  /**
   * Create and checkout an experiment branch.
   * @param {string} name
   * @returns {Promise<string>} Branch name
   */
  async branchExperiment(name) {
    const branch = `experiment/${name}`;
    if (this.#ops.branch) {
      await this.#ops.branch(branch);
    }
    if (this.#ops.checkout) {
      await this.#ops.checkout(branch);
    }
    this.#currentBranch = branch;
    return branch;
  }

  /**
   * Merge an experiment branch into main.
   * @param {string} branch
   * @returns {Promise<void>}
   */
  async mergeExperiment(branch) {
    if (this.#ops.checkout) {
      await this.#ops.checkout('main');
    }
    if (this.#ops.merge) {
      await this.#ops.merge(branch);
    }
    this.#currentBranch = 'main';
  }

  /**
   * Abandon an experiment branch.
   * @param {string} branch
   * @param {string} [reason]
   * @returns {Promise<void>}
   */
  async abandonExperiment(branch, reason) {
    if (this.#ops.checkout) {
      await this.#ops.checkout('main');
    }
    if (this.#ops.deleteBranch) {
      await this.#ops.deleteBranch(branch);
    }
    this.#currentBranch = 'main';
    // Record revert commit on main
    if (reason) {
      const msg = formatCommitMessage({
        type: COMMIT_TYPES.REVERT,
        id: branch.replace('experiment/', ''),
        summary: `abandon ${branch}`,
        body: reason,
      });
      await this.#doCommit(msg);
    }
  }

  // ── Diff / Reflection ─────────────────────────────────

  /**
   * Get diff summary since a specific commit.
   * @param {string} [sinceRef='HEAD~5']
   * @returns {Promise<object>}
   */
  async diffSince(sinceRef = 'HEAD~5') {
    if (this.#ops.diff) {
      return this.#ops.diff(sinceRef);
    }
    return { files: [], additions: 0, deletions: 0, patch: '' };
  }

  /**
   * Get working tree status.
   * @returns {Promise<Array<{ path: string, status: string }>>}
   */
  async status() {
    if (this.#ops.status) {
      return this.#ops.status();
    }
    return [];
  }

  /**
   * Get commit log.
   * @param {object} [opts]
   * @param {number} [opts.depth=20]
   * @returns {Promise<Array<{ oid: string, message: string, timestamp: number }>>}
   */
  async log(opts = {}) {
    if (this.#ops.log) {
      return this.#ops.log(opts.depth || 20);
    }
    return [];
  }

  /**
   * Build a reflection summary based on recent changes.
   * @param {string} [goalId]
   * @returns {Promise<object>}
   */
  async reflect(goalId) {
    const logEntries = await this.log({ depth: 50 });
    const goalCommits = goalId
      ? logEntries.filter(e => e.message.includes(`Clawser-Goal: ${goalId}`))
      : [];
    const experiments = logEntries.filter(e => e.message.startsWith('[experiment:'));
    const reverts = logEntries.filter(e => e.message.startsWith('[revert:'));

    return {
      totalCommits: logEntries.length,
      goalCommits: goalCommits.length,
      experiments: experiments.length,
      reverts: reverts.length,
      recentMessages: logEntries.slice(0, 5).map(e => e.message.split('\n')[0]),
    };
  }

  // ── Internal ───────────────────────────────────────────

  async #doCommit(message) {
    if (this.#ops.add) {
      await this.#ops.add('.');
    }
    let sha = 'unknown';
    if (this.#ops.commit) {
      sha = await this.#ops.commit(message, this.#author);
    }
    if (this.#onCommit) {
      this.#onCommit(sha, message);
    }
    return sha;
  }
}

// ── GitEpisodicMemory ───────────────────────────────────────────

/**
 * Queryable commit history for episodic memory recall.
 */
export class GitEpisodicMemory {
  #behavior;

  /**
   * @param {GitBehavior} behavior
   */
  constructor(behavior) {
    this.#behavior = behavior;
  }

  /**
   * Recall commits matching a keyword in message.
   * @param {string} keyword
   * @param {number} [limit=20]
   * @returns {Promise<Array>}
   */
  async recallByTopic(keyword, limit = 20) {
    const log = await this.#behavior.log({ depth: 100 });
    const kw = keyword.toLowerCase();
    return log
      .filter(e => e.message.toLowerCase().includes(kw))
      .slice(0, limit);
  }

  /**
   * Recall commits for a specific goal.
   * @param {string} goalId
   * @returns {Promise<Array>}
   */
  async recallByGoal(goalId) {
    const log = await this.#behavior.log({ depth: 100 });
    return log.filter(e => e.message.includes(`Clawser-Goal: ${goalId}`));
  }

  /**
   * Get all experiments and their outcomes.
   * @returns {Promise<{ experiments: Array, reverts: Array, successRate: number }>}
   */
  async recallExperiments() {
    const log = await this.#behavior.log({ depth: 200 });
    const experiments = log.filter(e => e.message.startsWith('[experiment:'));
    const reverts = log.filter(e => e.message.startsWith('[revert:'));

    const revertedIds = new Set(
      reverts.map(r => {
        const parsed = parseCommitMessage(r.message);
        return parsed?.id;
      }).filter(Boolean)
    );

    const succeeded = experiments.filter(e => {
      const parsed = parseCommitMessage(e.message);
      return parsed && !revertedIds.has(parsed.id);
    });

    const total = experiments.length;
    const successRate = total > 0 ? succeeded.length / total : 0;

    return { experiments, reverts, successRate };
  }

  /**
   * Find files changed most frequently (hotspot analysis).
   * @returns {Promise<Array<[string, number]>>}
   */
  async findHotspots() {
    const reflection = await this.#behavior.reflect();
    // Without actual diff data, return based on reflection info
    return { totalCommits: reflection.totalCommits, recent: reflection.recentMessages };
  }
}

// ── GitOpsProvider ──────────────────────────────────────────────

/**
 * Interface for git operations. Implementations can wrap isomorphic-git,
 * mock backends, or other git libraries.
 */
export class GitOpsProvider {
  async status() { return []; }
  async add(/* path */) {}
  async commit(/* message, author */) { return 'unknown'; }
  async log(/* depth */) { return []; }
  async diff(/* ref */) { return { files: [], additions: 0, deletions: 0, patch: '' }; }
  async branch(/* name */) {}
  async checkout(/* name */) {}
  async merge(/* branch */) {}
  async deleteBranch(/* name */) {}
  async init() {}
}

// ── MockGitBackend ──────────────────────────────────────────────

/**
 * In-memory mock git backend for testing without isomorphic-git.
 */
export class MockGitBackend extends GitOpsProvider {
  #commits = [];
  #staged = [];
  #branch = 'main';
  #initialized = false;

  async init() {
    this.#initialized = true;
  }

  get initialized() { return this.#initialized; }

  async status() {
    return this.#staged.map(f => ({ path: f, status: 'modified' }));
  }

  async add(path) {
    if (path === '.') {
      this.#staged.push('.');
    } else {
      this.#staged.push(path);
    }
  }

  async commit(message, author) {
    const oid = Math.random().toString(16).slice(2, 14);
    this.#commits.unshift({
      oid,
      message,
      author: author || { name: 'test', email: 'test@test.com' },
      timestamp: Date.now(),
    });
    this.#staged = [];
    this.#initialized = true;
    return oid;
  }

  async log(depth = 20) {
    return this.#commits.slice(0, depth);
  }

  async diff(ref) {
    return { files: [], additions: 0, deletions: 0, patch: '' };
  }

  async branch(name) {
    this.#branch = name;
  }

  async checkout(name) {
    this.#branch = name;
  }

  async merge(branch) {
    // no-op in mock
  }

  async deleteBranch(name) {
    // no-op in mock
  }
}

// ── AutoInitManager ─────────────────────────────────────────────

/**
 * Auto-initializes a git repository on first file write.
 */
export class AutoInitManager {
  #backend;
  #initialized = false;
  #autoCommit;

  /**
   * @param {object} opts
   * @param {GitOpsProvider} opts.backend - Git operations backend
   * @param {boolean} [opts.autoCommit=false] - Auto-commit after write
   */
  constructor(opts = {}) {
    this.#backend = opts.backend;
    this.#autoCommit = opts.autoCommit || false;
  }

  get isInitialized() { return this.#initialized; }

  /**
   * Ensure the repository is initialized.
   * @returns {Promise<{ initialized: boolean, alreadyExists?: boolean }>}
   */
  async ensureRepo() {
    if (this.#initialized) {
      return { initialized: false, alreadyExists: true };
    }
    await this.#backend.init();
    this.#initialized = true;
    return { initialized: true };
  }

  /**
   * Called when a file is written. Auto-inits and optionally auto-commits.
   * @param {string} path - File path
   * @param {string} content - File content
   */
  async onWrite(path, content) {
    await this.ensureRepo();
    if (this.#autoCommit) {
      await this.#backend.add(path);
      await this.#backend.commit(`Auto-commit: ${path}`, { name: 'Clawser', email: 'agent@clawser.local' });
    }
  }
}

// ── CommitSearchIndex ───────────────────────────────────────────

/**
 * In-memory full-text search index for commit messages.
 * Uses TF-based scoring for ranked results.
 */
export class CommitSearchIndex {
  #entries = [];

  /**
   * Add a commit to the index.
   * @param {{ oid: string, message: string, timestamp: number }} entry
   */
  add(entry) {
    this.#entries.push({
      oid: entry.oid,
      message: entry.message,
      timestamp: entry.timestamp,
      tokens: entry.message.toLowerCase().split(/\s+/),
    });
  }

  get size() { return this.#entries.length; }

  /** Clear all indexed entries. */
  clear() { this.#entries = []; }

  /**
   * Search for commits matching query terms.
   * @param {string} query - Space-separated search terms
   * @returns {Array<{ oid: string, message: string, timestamp: number, score: number }>}
   */
  search(query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const scored = [];
    for (const entry of this.#entries) {
      let score = 0;
      for (const term of terms) {
        // Count occurrences of each term
        const count = entry.tokens.filter(t => t.includes(term)).length;
        score += count;
      }
      if (score > 0) {
        scored.push({
          oid: entry.oid,
          message: entry.message,
          timestamp: entry.timestamp,
          score,
        });
      }
    }

    // Sort by score descending, then by timestamp descending
    scored.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);
    return scored;
  }
}

// ── ConflictResolver ─────────────────────────────────────────────

/**
 * Resolves merge conflicts using configurable strategies.
 */
export class ConflictResolver {
  #strategy;

  /**
   * @param {object} [opts]
   * @param {'ours'|'theirs'|'union'} [opts.strategy='ours'] - Default resolution strategy
   */
  constructor(opts = {}) {
    this.#strategy = opts.strategy || 'ours';
  }

  get strategy() { return this.#strategy; }

  /**
   * Resolve a single conflict.
   * @param {{ path: string, ours: string, theirs: string, base: string }} conflict
   * @returns {{ path: string, content: string, strategy: string }}
   */
  resolve(conflict) {
    const strategy = this.#strategy;
    let content;

    switch (strategy) {
      case 'theirs':
        content = conflict.theirs;
        break;
      case 'union':
        content = this.#unionMerge(conflict);
        break;
      case 'ours':
      default:
        content = conflict.ours;
        break;
    }

    return { path: conflict.path, content, strategy };
  }

  /**
   * Resolve multiple conflicts.
   * @param {Array<{ path: string, ours: string, theirs: string, base: string }>} conflicts
   * @returns {Array<{ path: string, content: string, strategy: string }>}
   */
  resolveAll(conflicts) {
    return conflicts.map(c => this.resolve(c));
  }

  /**
   * Line-based union merge: include lines from both sides.
   * @param {{ ours: string, theirs: string, base: string }} conflict
   * @returns {string}
   */
  #unionMerge(conflict) {
    const baseLines = (conflict.base || '').split('\n');
    const ourLines = (conflict.ours || '').split('\n');
    const theirLines = (conflict.theirs || '').split('\n');
    const baseSet = new Set(baseLines);

    // Lines added by ours (not in base)
    const oursAdded = ourLines.filter(l => !baseSet.has(l));
    // Lines added by theirs (not in base)
    const theirsAdded = theirLines.filter(l => !baseSet.has(l));
    // Lines in base kept by both
    const kept = baseLines.filter(l => ourLines.includes(l) || theirLines.includes(l));

    // Merge: kept lines + ours additions + theirs additions (deduplicated)
    const seen = new Set();
    const merged = [];
    for (const l of [...kept, ...oursAdded, ...theirsAdded]) {
      if (!seen.has(l)) {
        seen.add(l);
        merged.push(l);
      }
    }
    return merged.join('\n');
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

export class GitStatusTool extends BrowserTool {
  #behavior;

  constructor(behavior) {
    super();
    this.#behavior = behavior;
  }

  get name() { return 'git_status'; }
  get description() { return 'Show working tree status (modified, untracked, staged files).'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'approve'; }

  async execute() {
    try {
      const entries = await this.#behavior.status();
      if (entries.length === 0) {
        return { success: true, output: 'Working tree clean.' };
      }
      const lines = entries.map(e => `${e.status}  ${e.path}`);
      return { success: true, output: lines.join('\n') };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class GitDiffTool extends BrowserTool {
  #behavior;

  constructor(behavior) {
    super();
    this.#behavior = behavior;
  }

  get name() { return 'git_diff'; }
  get description() { return 'Show changes (working tree or between commits).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'Reference to diff from (default HEAD~5)' },
      },
    };
  }
  get permission() { return 'approve'; }

  async execute({ since } = {}) {
    try {
      const diff = await this.#behavior.diffSince(since || 'HEAD~5');
      const lines = [
        `Files changed: ${diff.files?.length || 0}`,
        `Additions: +${diff.additions || 0}`,
        `Deletions: -${diff.deletions || 0}`,
      ];
      if (diff.patch) {
        lines.push('', diff.patch.length > 2000 ? diff.patch.slice(0, 2000) + '...' : diff.patch);
      }
      return { success: true, output: lines.join('\n') };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class GitLogTool extends BrowserTool {
  #behavior;

  constructor(behavior) {
    super();
    this.#behavior = behavior;
  }

  get name() { return 'git_log'; }
  get description() { return 'Show commit history with optional filter.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        depth: { type: 'number', description: 'Number of commits to show (default 20)' },
        filter: { type: 'string', description: 'Filter commits by keyword in message' },
      },
    };
  }
  get permission() { return 'approve'; }

  async execute({ depth, filter } = {}) {
    try {
      let entries = await this.#behavior.log({ depth: depth || 20 });
      if (filter) {
        const kw = filter.toLowerCase();
        entries = entries.filter(e => e.message.toLowerCase().includes(kw));
      }
      if (entries.length === 0) {
        return { success: true, output: 'No commits found.' };
      }
      const lines = entries.map(e => {
        const firstLine = e.message.split('\n')[0];
        return `${(e.oid || '').slice(0, 7)} ${firstLine}`;
      });
      return { success: true, output: lines.join('\n') };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class GitCommitTool extends BrowserTool {
  #behavior;

  constructor(behavior) {
    super();
    this.#behavior = behavior;
  }

  get name() { return 'git_commit'; }
  get description() { return 'Create a commit (auto-stages all changes).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' },
        type: { type: 'string', description: 'Commit type: goal, experiment, fix, refactor, checkpoint' },
        id: { type: 'string', description: 'Goal or experiment ID' },
      },
      required: ['message'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ message, type, id }) {
    try {
      const commitType = type || COMMIT_TYPES.CHECKPOINT;
      const commitId = id || 'manual';
      const msg = formatCommitMessage({
        type: commitType,
        id: commitId,
        summary: message,
      });
      const sha = await this.#behavior.checkpoint(message);
      return { success: true, output: `Committed: ${sha}\n${msg.split('\n')[0]}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class GitBranchTool extends BrowserTool {
  #behavior;

  constructor(behavior) {
    super();
    this.#behavior = behavior;
  }

  get name() { return 'git_branch'; }
  get description() { return 'List, create, or switch branches.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action: list, create, switch, abandon (default list)' },
        name: { type: 'string', description: 'Branch name (for create/switch/abandon)' },
        reason: { type: 'string', description: 'Reason for abandoning (for abandon action)' },
      },
    };
  }
  get permission() { return 'approve'; }

  async execute({ action, name, reason } = {}) {
    try {
      const act = action || 'list';
      if (act === 'list') {
        return { success: true, output: `Current branch: ${this.#behavior.currentBranch}` };
      }
      if (act === 'create') {
        if (!name) return { success: false, output: '', error: 'Branch name required' };
        const branch = await this.#behavior.branchExperiment(name);
        return { success: true, output: `Created and switched to: ${branch}` };
      }
      if (act === 'switch') {
        if (!name) return { success: false, output: '', error: 'Branch name required' };
        const branch = await this.#behavior.branchExperiment(name);
        return { success: true, output: `Switched to: ${branch}` };
      }
      if (act === 'abandon') {
        if (!name) return { success: false, output: '', error: 'Branch name required' };
        await this.#behavior.abandonExperiment(name, reason || '');
        return { success: true, output: `Abandoned: ${name}` };
      }
      return { success: false, output: '', error: `Unknown action: ${act}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class GitRecallTool extends BrowserTool {
  #memory;

  constructor(memory) {
    super();
    this.#memory = memory;
  }

  get name() { return 'git_recall'; }
  get description() { return 'Semantic search over commit messages (episodic memory).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Keyword to search for in commit messages' },
        goal_id: { type: 'string', description: 'Filter by goal ID' },
        experiments: { type: 'boolean', description: 'Show experiments and their outcomes' },
      },
    };
  }
  get permission() { return 'approve'; }

  async execute({ topic, goal_id, experiments } = {}) {
    try {
      if (experiments) {
        const result = await this.#memory.recallExperiments();
        const lines = [
          `Experiments: ${result.experiments.length}`,
          `Reverts: ${result.reverts.length}`,
          `Success rate: ${(result.successRate * 100).toFixed(0)}%`,
        ];
        if (result.experiments.length > 0) {
          lines.push('', 'Experiments:');
          for (const e of result.experiments.slice(0, 10)) {
            lines.push(`  ${(e.oid || '').slice(0, 7)} ${e.message.split('\n')[0]}`);
          }
        }
        return { success: true, output: lines.join('\n') };
      }

      if (goal_id) {
        const entries = await this.#memory.recallByGoal(goal_id);
        if (entries.length === 0) {
          return { success: true, output: `No commits found for goal: ${goal_id}` };
        }
        const lines = entries.map(e => `${(e.oid || '').slice(0, 7)} ${e.message.split('\n')[0]}`);
        return { success: true, output: lines.join('\n') };
      }

      if (topic) {
        const entries = await this.#memory.recallByTopic(topic);
        if (entries.length === 0) {
          return { success: true, output: `No commits matching: ${topic}` };
        }
        const lines = entries.map(e => `${(e.oid || '').slice(0, 7)} ${e.message.split('\n')[0]}`);
        return { success: true, output: lines.join('\n') };
      }

      return { success: true, output: 'Provide topic, goal_id, or experiments=true to search.' };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}
