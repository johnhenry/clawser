// clawser-goals.js — Goal Artifacts & Sub-goals
//
// Goal: first-class entity with sub-goal tree, artifacts, progress log
// GoalManager: tree operations, cascading completion, system prompt injection
// Agent tools: goal_add, goal_update, goal_add_subgoal, goal_add_artifact, goal_list

import { BrowserTool } from './clawser-tools.js';

// ── Goal ────────────────────────────────────────────────────────

let goalIdCounter = 0;

/**
 * Generate a unique goal ID.
 * @returns {string}
 */
function nextGoalId() {
  return `goal-${String(++goalIdCounter).padStart(3, '0')}`;
}

/**
 * Reset the ID counter (for testing).
 */
export function resetGoalIdCounter() {
  goalIdCounter = 0;
}

/**
 * A goal with optional sub-goals, artifacts, and progress log.
 */
export class Goal {
  /** @type {string} */
  id;

  /** @type {string} */
  description;

  /** @type {'active'|'paused'|'completed'|'failed'} */
  status;

  /** @type {'low'|'medium'|'high'|'critical'} */
  priority;

  /** @type {string|null} Parent goal ID */
  parentId;

  /** @type {string[]} Child goal IDs */
  subGoalIds;

  /** @type {string[]} Workspace file paths produced by this goal */
  artifacts;

  /** @type {number} */
  createdAt;

  /** @type {number} */
  updatedAt;

  /** @type {number|null} */
  completedAt;

  /** @type {Array<{timestamp: number, note: string}>} */
  progressLog;

  /** @type {number|null} Deadline timestamp */
  deadline;

  /** @type {string[]} IDs of goals that must complete before this one */
  blockedBy;

  /**
   * @param {object} opts
   */
  constructor(opts = {}) {
    this.id = opts.id || nextGoalId();
    this.description = opts.description || '';
    this.status = opts.status || 'active';
    this.priority = opts.priority || 'medium';
    this.parentId = opts.parentId || null;
    this.subGoalIds = opts.subGoalIds || [];
    this.artifacts = opts.artifacts || [];
    this.createdAt = opts.createdAt || Date.now();
    this.updatedAt = opts.updatedAt || Date.now();
    this.completedAt = opts.completedAt || null;
    this.progressLog = opts.progressLog || [];
    this.deadline = opts.deadline || null;
    this.blockedBy = opts.blockedBy || [];
  }

  /** Whether this goal has no children */
  get isLeaf() { return this.subGoalIds.length === 0; }

  /** Whether this goal is a root (no parent) */
  get isRoot() { return this.parentId === null; }

  /**
   * Serialize to plain object.
   * @returns {object}
   */
  toJSON() {
    return {
      id: this.id,
      description: this.description,
      status: this.status,
      priority: this.priority,
      parentId: this.parentId,
      subGoalIds: [...this.subGoalIds],
      artifacts: [...this.artifacts],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      completedAt: this.completedAt,
      progressLog: this.progressLog.map(e => ({ ...e })),
      deadline: this.deadline,
      blockedBy: [...this.blockedBy],
    };
  }

  /**
   * Deserialize from plain object.
   * @param {object} data
   * @returns {Goal}
   */
  static fromJSON(data) {
    return new Goal(data);
  }
}

// ── GoalManager ─────────────────────────────────────────────────

/**
 * Manages a tree of goals with cascading operations.
 */
export class GoalManager {
  /** @type {Map<string, Goal>} */
  #goals = new Map();

  /** @type {Set<Function>} */
  #completionListeners = new Set();

  /**
   * Add a new goal.
   * @param {string} description
   * @param {object} [opts]
   * @param {string} [opts.parentId]
   * @param {string} [opts.priority]
   * @returns {Goal}
   */
  /**
   * Register a callback that fires when any goal completes.
   * @param {Function} fn - Called with the completed goal object
   * @returns {Function} Unsubscribe function
   */
  onCompletion(fn) {
    this.#completionListeners.add(fn);
    return () => this.#completionListeners.delete(fn);
  }

  /** Fire completion listeners. */
  #fireCompletion(goal) {
    for (const fn of this.#completionListeners) {
      try { fn(goal); } catch { /* listener errors should not break flow */ }
    }
  }

  addGoal(description, opts = {}) {
    const goal = new Goal({
      description,
      parentId: opts.parentId || null,
      priority: opts.priority || 'medium',
      deadline: opts.deadline || null,
    });

    this.#goals.set(goal.id, goal);

    // Link to parent
    if (goal.parentId) {
      const parent = this.#goals.get(goal.parentId);
      if (parent) {
        parent.subGoalIds.push(goal.id);
        parent.updatedAt = Date.now();
      }
    }

    return goal;
  }

  /**
   * Get a goal by ID.
   * @param {string} id
   * @returns {Goal|null}
   */
  get(id) {
    return this.#goals.get(id) || null;
  }

  /**
   * Update goal status.
   * @param {string} id
   * @param {'active'|'paused'|'completed'|'failed'} status
   * @param {string} [progressNote]
   * @returns {Goal|null}
   */
  updateStatus(id, status, progressNote) {
    const goal = this.#goals.get(id);
    if (!goal) return null;

    goal.status = status;
    goal.updatedAt = Date.now();

    if (status === 'completed' || status === 'failed') {
      goal.completedAt = Date.now();
    }

    if (progressNote) {
      goal.progressLog.push({ timestamp: Date.now(), note: progressNote });
    }

    // Fire completion listeners
    if (status === 'completed') {
      this.#fireCompletion(goal);
    }

    // Cascading completion: check if parent's children are all done
    if (status === 'completed' && goal.parentId) {
      this.#checkParentCompletion(goal.parentId);
    }

    return goal;
  }

  /**
   * Add a sub-goal to an existing goal.
   * @param {string} parentId
   * @param {string} description
   * @param {object} [opts]
   * @returns {Goal|null}
   */
  addSubGoal(parentId, description, opts = {}) {
    const parent = this.#goals.get(parentId);
    if (!parent) return null;
    return this.addGoal(description, { ...opts, parentId });
  }

  /**
   * Decompose a goal into multiple sub-goals from a list of subtask descriptions.
   * Inherits priority from parent.
   * @param {string} goalId - Parent goal to decompose
   * @param {string[]} subtasks - Array of sub-task descriptions
   * @returns {Goal[]} Array of created sub-goals (empty array if parent not found)
   */
  decompose(goalId, subtasks) {
    const parent = this.#goals.get(goalId);
    if (!parent) return [];

    const created = [];
    for (const desc of subtasks) {
      const sub = this.addSubGoal(goalId, desc, { priority: parent.priority });
      if (sub) created.push(sub);
    }
    return created;
  }

  /**
   * Add an artifact to a goal.
   * @param {string} goalId
   * @param {string} filePath
   * @returns {boolean}
   */
  addArtifact(goalId, filePath) {
    const goal = this.#goals.get(goalId);
    if (!goal) return false;
    if (!goal.artifacts.includes(filePath)) {
      goal.artifacts.push(filePath);
      goal.updatedAt = Date.now();
    }
    return true;
  }

  /**
   * Log a progress entry.
   * @param {string} goalId
   * @param {string} note
   * @returns {boolean}
   */
  logProgress(goalId, note) {
    const goal = this.#goals.get(goalId);
    if (!goal) return false;
    goal.progressLog.push({ timestamp: Date.now(), note });
    goal.updatedAt = Date.now();
    return true;
  }

  /**
   * Calculate progress of a goal (0.0 to 1.0).
   * Leaf goals: 0 or 1. Parent goals: fraction of completed children.
   * @param {string} goalId
   * @returns {number}
   */
  progress(goalId) {
    const goal = this.#goals.get(goalId);
    if (!goal) return 0;
    if (goal.status === 'completed') return 1.0;
    if (goal.isLeaf) return 0.0;

    const children = goal.subGoalIds
      .map(id => this.#goals.get(id))
      .filter(Boolean);
    if (children.length === 0) return 0.0;

    const completed = children.filter(g => g.status === 'completed').length;
    return completed / children.length;
  }

  /**
   * Get the depth of a goal in the tree.
   * @param {string} goalId
   * @returns {number} 0 for root goals
   */
  depth(goalId) {
    let d = 0;
    let current = this.#goals.get(goalId);
    while (current?.parentId) {
      d++;
      current = this.#goals.get(current.parentId);
    }
    return d;
  }

  /**
   * List goals with optional filters.
   * @param {object} [opts]
   * @param {string} [opts.status] - Filter by status ('all' for no filter)
   * @param {string} [opts.parentId] - Filter to children of this goal
   * @param {boolean} [opts.rootOnly] - Only return root goals
   * @returns {Goal[]}
   */
  list(opts = {}) {
    let goals = [...this.#goals.values()];

    if (opts.status && opts.status !== 'all') {
      goals = goals.filter(g => g.status === opts.status);
    }

    if (opts.parentId) {
      goals = goals.filter(g => g.parentId === opts.parentId);
    }

    if (opts.rootOnly) {
      goals = goals.filter(g => g.isRoot);
    }

    return goals;
  }

  /**
   * Remove a goal and all its descendants.
   * @param {string} id
   * @returns {boolean}
   */
  remove(id) {
    const goal = this.#goals.get(id);
    if (!goal) return false;

    // Remove from parent's subGoalIds
    if (goal.parentId) {
      const parent = this.#goals.get(goal.parentId);
      if (parent) {
        parent.subGoalIds = parent.subGoalIds.filter(sid => sid !== id);
      }
    }

    // Recursively remove children
    for (const childId of goal.subGoalIds) {
      this.remove(childId);
    }

    this.#goals.delete(id);
    return true;
  }

  /** Total number of goals */
  get size() { return this.#goals.size; }

  /**
   * Build system prompt section for active goals.
   * @returns {string}
   */
  buildPrompt() {
    const active = this.list({ status: 'active', rootOnly: true });
    if (active.length === 0) return '';

    let prompt = '<active-goals>\n';
    for (const goal of active) {
      const pct = Math.round(this.progress(goal.id) * 100);
      prompt += `- [${goal.priority}] ${goal.description}`;
      if (pct > 0) prompt += ` (${pct}% complete)`;
      if (goal.deadline) prompt += ` [due: ${new Date(goal.deadline).toISOString().slice(0, 10)}]`;
      prompt += '\n';

      // Show sub-goals
      for (const subId of goal.subGoalIds) {
        const sub = this.#goals.get(subId);
        if (!sub) continue;
        const check = sub.status === 'completed' ? 'x' : ' ';
        prompt += `  - [${check}] ${sub.description}\n`;
      }
    }
    prompt += '</active-goals>';
    return prompt;
  }

  /**
   * Add a dependency between goals.
   * @param {string} goalId - Goal that depends on another
   * @param {string} dependsOnId - Goal that must complete first
   * @returns {boolean}
   */
  addDependency(goalId, dependsOnId) {
    const goal = this.#goals.get(goalId);
    if (!goal) return false;
    if (!goal.blockedBy.includes(dependsOnId)) {
      goal.blockedBy.push(dependsOnId);
      goal.updatedAt = Date.now();
    }
    return true;
  }

  /**
   * Check if a goal is blocked by unfinished dependencies.
   * @param {string} goalId
   * @returns {boolean}
   */
  isBlocked(goalId) {
    const goal = this.#goals.get(goalId);
    if (!goal || goal.blockedBy.length === 0) return false;
    return goal.blockedBy.some(depId => {
      const dep = this.#goals.get(depId);
      return dep && dep.status !== 'completed';
    });
  }

  /**
   * Serialize goals to GOALS.md markdown format.
   * @returns {string}
   */
  toMarkdown() {
    let md = '# Goals\n\n';
    const roots = this.list({ rootOnly: true });

    for (const goal of roots) {
      md += this.#goalToMarkdownLine(goal, 0);
    }

    return md;
  }

  #goalToMarkdownLine(goal, indent) {
    const prefix = '  '.repeat(indent);
    const check = goal.status === 'completed' ? 'x' : ' ';
    let line = `${prefix}- [${check}] **(${goal.priority})** ${goal.description}`;
    if (goal.deadline) {
      line += ` [due: ${new Date(goal.deadline).toISOString().slice(0, 10)}]`;
    }
    line += '\n';

    // Recursively add sub-goals
    for (const subId of goal.subGoalIds) {
      const sub = this.#goals.get(subId);
      if (sub) {
        line += this.#goalToMarkdownLine(sub, indent + 1);
      }
    }

    return line;
  }

  /**
   * Parse goals from GOALS.md markdown format.
   * @param {string} md
   * @returns {GoalManager}
   */
  static fromMarkdown(md) {
    const mgr = new GoalManager();
    const lines = md.split('\n').filter(l => l.trim().startsWith('- ['));

    const stack = []; // stack of {goalId, indent}

    for (const line of lines) {
      const indent = (line.match(/^(\s*)/)[1].length) / 2;
      const checked = line.includes('[x]');
      const priorityMatch = line.match(/\*\*\((\w+)\)\*\*/);
      const priority = priorityMatch ? priorityMatch[1] : 'medium';

      // Extract description: after **(...)**
      let desc = line;
      if (priorityMatch) {
        desc = line.slice(line.indexOf(priorityMatch[0]) + priorityMatch[0].length).trim();
      } else {
        desc = line.replace(/^[\s-]*\[[x ]\]\s*/, '').trim();
      }

      // Strip deadline suffix
      const deadlineMatch = desc.match(/\s*\[due:\s*(\d{4}-\d{2}-\d{2})\]\s*$/);
      let deadline = null;
      if (deadlineMatch) {
        deadline = new Date(deadlineMatch[1]).getTime();
        desc = desc.slice(0, deadlineMatch.index).trim();
      }

      // Determine parent from indent
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const parentId = stack.length > 0 ? stack[stack.length - 1].goalId : null;

      let goal;
      if (parentId) {
        goal = mgr.addSubGoal(parentId, desc, { priority, deadline });
      } else {
        goal = mgr.addGoal(desc, { priority, deadline });
      }

      if (checked && goal) {
        mgr.updateStatus(goal.id, 'completed');
      }

      stack.push({ goalId: goal.id, indent });
    }

    return mgr;
  }

  /**
   * Serialize all goals.
   * @returns {object[]}
   */
  toJSON() {
    return [...this.#goals.values()].map(g => g.toJSON());
  }

  /**
   * Restore goals from serialized data.
   * @param {object[]} data
   */
  fromJSON(data) {
    this.#goals.clear();
    for (const entry of data) {
      const goal = Goal.fromJSON(entry);
      this.#goals.set(goal.id, goal);
    }
  }

  // ── Private helpers ───────────────────────────────────────────

  #checkParentCompletion(parentId) {
    const parent = this.#goals.get(parentId);
    if (!parent) return;

    const allDone = parent.subGoalIds.every(sid => {
      const child = this.#goals.get(sid);
      return child && child.status === 'completed';
    });

    if (allDone && parent.status === 'active') {
      parent.status = 'completed';
      parent.completedAt = Date.now();
      parent.updatedAt = Date.now();
      parent.progressLog.push({
        timestamp: Date.now(),
        note: 'Auto-completed: all sub-goals finished',
      });

      // Fire completion listeners for cascading parent
      this.#fireCompletion(parent);

      // Recurse up
      if (parent.parentId) {
        this.#checkParentCompletion(parent.parentId);
      }
    }
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

export class GoalAddTool extends BrowserTool {
  #manager;
  constructor(manager) { super(); this.#manager = manager; }

  get name() { return 'goal_add'; }
  get description() { return 'Add a new goal with optional parent and priority.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Goal description' },
        parent_id: { type: 'string', description: 'Parent goal ID (for sub-goals)' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      },
      required: ['description'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ description, parent_id, priority }) {
    const goal = parent_id
      ? this.#manager.addSubGoal(parent_id, description, { priority })
      : this.#manager.addGoal(description, { priority });
    if (!goal) return { success: false, output: '', error: `Parent goal "${parent_id}" not found` };
    return { success: true, output: `Goal created: ${goal.id} — ${goal.description}` };
  }
}

export class GoalUpdateTool extends BrowserTool {
  #manager;
  constructor(manager) { super(); this.#manager = manager; }

  get name() { return 'goal_update'; }
  get description() { return 'Update goal status with an optional progress note.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        goal_id: { type: 'string', description: 'Goal ID' },
        status: { type: 'string', enum: ['active', 'paused', 'completed', 'failed'] },
        progress_note: { type: 'string', description: 'Progress log entry' },
      },
      required: ['goal_id', 'status'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ goal_id, status, progress_note }) {
    const goal = this.#manager.updateStatus(goal_id, status, progress_note);
    if (!goal) return { success: false, output: '', error: `Goal "${goal_id}" not found` };
    return { success: true, output: `Goal ${goal_id} updated to ${status}` };
  }
}

export class GoalAddArtifactTool extends BrowserTool {
  #manager;
  constructor(manager) { super(); this.#manager = manager; }

  get name() { return 'goal_add_artifact'; }
  get description() { return 'Link a workspace file as an artifact of a goal.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        goal_id: { type: 'string' },
        file_path: { type: 'string', description: 'Workspace path to the artifact' },
      },
      required: ['goal_id', 'file_path'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ goal_id, file_path }) {
    const ok = this.#manager.addArtifact(goal_id, file_path);
    if (!ok) return { success: false, output: '', error: `Goal "${goal_id}" not found` };
    return { success: true, output: `Artifact "${file_path}" added to goal ${goal_id}` };
  }
}

export class GoalListTool extends BrowserTool {
  #manager;
  constructor(manager) { super(); this.#manager = manager; }

  get name() { return 'goal_list'; }
  get description() { return 'List goals with optional status and parent filters.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'completed', 'failed', 'paused', 'all'] },
        parent_id: { type: 'string', description: 'Filter to sub-goals of this parent' },
      },
    };
  }
  get permission() { return 'read'; }

  async execute({ status, parent_id } = {}) {
    const goals = this.#manager.list({ status, parentId: parent_id });
    if (goals.length === 0) {
      return { success: true, output: 'No goals found matching criteria.' };
    }
    const lines = goals.map(g => {
      const pct = Math.round(this.#manager.progress(g.id) * 100);
      const pctStr = g.isLeaf ? '' : ` (${pct}%)`;
      return `${g.id} [${g.status}] [${g.priority}]${pctStr} ${g.description}`;
    });
    return { success: true, output: lines.join('\n') };
  }
}

export class GoalDecomposeTool extends BrowserTool {
  #manager;
  constructor(manager) { super(); this.#manager = manager || new GoalManager(); }

  get name() { return 'goal_decompose'; }
  get description() { return 'Decompose a goal into sub-tasks. Provide a goal ID and a list of subtask descriptions.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        goal_id: { type: 'string', description: 'ID of the goal to decompose' },
        subtasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of sub-task descriptions',
        },
      },
      required: ['goal_id', 'subtasks'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ goal_id, subtasks }) {
    if (!subtasks || subtasks.length === 0) {
      return { success: false, output: '', error: 'No subtasks provided' };
    }
    const created = this.#manager.decompose(goal_id, subtasks);
    if (created.length === 0) {
      return { success: false, output: '', error: `Goal "${goal_id}" not found` };
    }
    const lines = created.map(g => `  ${g.id}: ${g.description}`);
    return {
      success: true,
      output: `Created ${created.length} sub-goals for ${goal_id}:\n${lines.join('\n')}`,
    };
  }
}
