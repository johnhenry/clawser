/**
 * clawser-mesh-swarm.js -- Swarm Coordination for BrowserMesh.
 *
 * Leader election, task distribution, and swarm lifecycle management.
 * Peers form a swarm where one node acts as leader, distributing tasks
 * across followers using pluggable strategies.
 *
 * Run tests:
 *   node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-swarm.test.mjs
 */

// ---------------------------------------------------------------------------
// Wire Constants
// ---------------------------------------------------------------------------

export const SWARM_JOIN = 0xAC;
export const SWARM_LEAVE = 0xAD;
export const SWARM_HEARTBEAT = 0xAE;
export const SWARM_TASK_ASSIGN = 0xAF;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** @type {readonly string[]} */
export const SwarmRole = Object.freeze(['leader', 'follower', 'candidate']);

/** @type {readonly string[]} */
export const TaskStrategy = Object.freeze([
  'leader-follower',
  'round-robin',
  'load-balanced',
  'redundant',
  'pipeline',
]);

/** @type {readonly string[]} */
const TASK_STATUSES = Object.freeze([
  'pending',
  'assigned',
  'running',
  'completed',
  'failed',
]);

// ---------------------------------------------------------------------------
// SwarmMember
// ---------------------------------------------------------------------------

/**
 * Represents a single member of the swarm.
 */
export class SwarmMember {
  /**
   * @param {object} opts
   * @param {string} opts.podId          - Unique identifier for this member
   * @param {string} [opts.role]         - One of SwarmRole
   * @param {number} [opts.load]         - Current load factor 0-1
   * @param {string[]} [opts.capabilities] - Advertised capabilities
   * @param {number} [opts.joinedAt]     - Unix timestamp (ms) when joined
   * @param {number} [opts.lastHeartbeat] - Unix timestamp (ms) of last heartbeat
   */
  constructor({
    podId,
    role = 'candidate',
    load = 0,
    capabilities = [],
    joinedAt = Date.now(),
    lastHeartbeat = Date.now(),
  }) {
    if (!podId || typeof podId !== 'string') {
      throw new Error('podId is required and must be a non-empty string');
    }
    this.podId = podId;
    this.role = role;
    this.load = load;
    this.capabilities = [...capabilities];
    this.joinedAt = joinedAt;
    this.lastHeartbeat = lastHeartbeat;
  }

  /**
   * Whether this member's heartbeat is stale (no heartbeat within timeoutMs).
   *
   * @param {number} [timeoutMs=30000] - Staleness threshold in ms
   * @returns {boolean}
   */
  isStale(timeoutMs = 30000) {
    return (Date.now() - this.lastHeartbeat) > timeoutMs;
  }

  /**
   * Serialize to a plain JSON-safe object.
   * @returns {object}
   */
  toJSON() {
    return {
      podId: this.podId,
      role: this.role,
      load: this.load,
      capabilities: [...this.capabilities],
      joinedAt: this.joinedAt,
      lastHeartbeat: this.lastHeartbeat,
    };
  }

  /**
   * Re-hydrate from a plain object.
   * @param {object} data
   * @returns {SwarmMember}
   */
  static fromJSON(data) {
    return new SwarmMember(data);
  }
}

// ---------------------------------------------------------------------------
// SwarmTask
// ---------------------------------------------------------------------------

let _taskCounter = 0;

/**
 * Represents a task to be distributed across swarm members.
 */
export class SwarmTask {
  /**
   * @param {object} opts
   * @param {string} [opts.taskId]        - Unique task identifier
   * @param {string} opts.description     - Human-readable description
   * @param {string} [opts.strategy]      - One of TaskStrategy
   * @param {string[]} [opts.assignedTo]  - podIds assigned to this task
   * @param {string} [opts.status]        - One of TASK_STATUSES
   * @param {*} [opts.input]              - Task input data
   * @param {*} [opts.output]             - Task output data
   * @param {number} [opts.createdAt]     - Unix timestamp (ms)
   * @param {number|null} [opts.startedAt]    - Unix timestamp (ms) when started
   * @param {number|null} [opts.completedAt]  - Unix timestamp (ms) when completed/failed
   */
  constructor({
    taskId = null,
    description,
    strategy = 'leader-follower',
    assignedTo = [],
    status = 'pending',
    input = null,
    output = null,
    createdAt = Date.now(),
    startedAt = null,
    completedAt = null,
  }) {
    if (!description || typeof description !== 'string') {
      throw new Error('description is required and must be a non-empty string');
    }
    this.taskId = taskId || `task_${++_taskCounter}`;
    this.description = description;
    this.strategy = strategy;
    this.assignedTo = [...assignedTo];
    this.status = status;
    this.input = input;
    this.output = output;
    this.createdAt = createdAt;
    this.startedAt = startedAt;
    this.completedAt = completedAt;
  }

  /**
   * Serialize to a plain JSON-safe object.
   * @returns {object}
   */
  toJSON() {
    return {
      taskId: this.taskId,
      description: this.description,
      strategy: this.strategy,
      assignedTo: [...this.assignedTo],
      status: this.status,
      input: this.input,
      output: this.output,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
    };
  }

  /**
   * Re-hydrate from a plain object.
   * @param {object} data
   * @returns {SwarmTask}
   */
  static fromJSON(data) {
    return new SwarmTask(data);
  }
}

// ---------------------------------------------------------------------------
// LeaderElection
// ---------------------------------------------------------------------------

/**
 * Deterministic leader election using lowest-lexicographic-podId.
 * Tracks heartbeats to detect stale leaders and trigger re-election.
 */
export class LeaderElection {
  /** @type {string} */
  #localPodId;

  /** @type {Set<string>} */
  #candidates = new Set();

  /** @type {string|null} */
  #leader = null;

  /** @type {Map<string, number>} podId -> last heartbeat timestamp */
  #heartbeats = new Map();

  /** @type {number} */
  #heartbeatMs;

  /** @type {number} */
  #electionTimeoutMs;

  /**
   * @param {string} localPodId
   * @param {object} [opts]
   * @param {number} [opts.heartbeatMs=5000]
   * @param {number} [opts.electionTimeoutMs=15000]
   */
  constructor(localPodId, opts = {}) {
    if (!localPodId || typeof localPodId !== 'string') {
      throw new Error('localPodId is required and must be a non-empty string');
    }
    this.#localPodId = localPodId;
    this.#heartbeatMs = opts.heartbeatMs ?? 5000;
    this.#electionTimeoutMs = opts.electionTimeoutMs ?? 15000;
    this.#candidates.add(localPodId);
    this.#heartbeats.set(localPodId, Date.now());
  }

  /** @returns {string|null} Current leader podId or null */
  get leader() {
    return this.#leader;
  }

  /**
   * Current role of the local pod.
   * @returns {string} One of SwarmRole values
   */
  get role() {
    if (this.#leader === this.#localPodId) return 'leader';
    if (this.#leader !== null) return 'follower';
    return 'candidate';
  }

  /** @returns {string} The local podId */
  get localPodId() {
    return this.#localPodId;
  }

  /**
   * Add a candidate to the election pool.
   * @param {string} podId
   */
  addCandidate(podId) {
    this.#candidates.add(podId);
    if (!this.#heartbeats.has(podId)) {
      this.#heartbeats.set(podId, Date.now());
    }
  }

  /**
   * Remove a candidate from the election pool.
   * If the removed candidate was the leader, leader is cleared.
   *
   * @param {string} podId
   * @returns {boolean} true if the candidate existed
   */
  removeCandidate(podId) {
    const existed = this.#candidates.delete(podId);
    this.#heartbeats.delete(podId);
    if (this.#leader === podId) {
      this.#leader = null;
    }
    return existed;
  }

  /**
   * Run an election. The candidate with the lowest lexicographic podId wins.
   *
   * @returns {string} The elected leader's podId
   */
  elect() {
    const sorted = [...this.#candidates].sort();
    if (sorted.length === 0) {
      throw new Error('No candidates available for election');
    }
    this.#leader = sorted[0];
    return this.#leader;
  }

  /**
   * Record a heartbeat from a peer.
   *
   * @param {string} fromPodId
   * @param {number} [timestamp] - Defaults to Date.now()
   */
  receiveHeartbeat(fromPodId, timestamp) {
    this.#heartbeats.set(fromPodId, timestamp ?? Date.now());
  }

  /**
   * Check if the current leader is still alive (has sent a heartbeat
   * within electionTimeoutMs).
   *
   * @param {number} [now] - Current timestamp for testing
   * @returns {boolean} true if leader is alive, false if stale or no leader
   */
  checkLeaderAlive(now) {
    if (!this.#leader) return false;
    const ts = now ?? Date.now();
    const lastHb = this.#heartbeats.get(this.#leader);
    if (lastHb === undefined) return false;
    return (ts - lastHb) <= this.#electionTimeoutMs;
  }

  /**
   * Yield leadership to the next candidate in lexicographic order.
   * Returns the new leader or null if no other candidates exist.
   *
   * @returns {string|null}
   */
  yieldLeadership() {
    const sorted = [...this.#candidates].sort();
    if (sorted.length <= 1) {
      this.#leader = null;
      return null;
    }
    const currentIdx = sorted.indexOf(this.#leader);
    const nextIdx = (currentIdx + 1) % sorted.length;
    this.#leader = sorted[nextIdx];
    return this.#leader;
  }

  /**
   * Get all current candidates sorted lexicographically.
   * @returns {string[]}
   */
  get candidates() {
    return [...this.#candidates].sort();
  }

  /**
   * Serialize to a plain JSON-safe object.
   * @returns {object}
   */
  toJSON() {
    return {
      localPodId: this.#localPodId,
      leader: this.#leader,
      candidates: [...this.#candidates],
      heartbeats: Object.fromEntries(this.#heartbeats),
      heartbeatMs: this.#heartbeatMs,
      electionTimeoutMs: this.#electionTimeoutMs,
    };
  }

  /**
   * Re-hydrate from a plain object.
   * @param {object} data
   * @returns {LeaderElection}
   */
  static fromJSON(data) {
    const el = new LeaderElection(data.localPodId, {
      heartbeatMs: data.heartbeatMs,
      electionTimeoutMs: data.electionTimeoutMs,
    });
    // Remove default local candidate, restore serialized set
    el.#candidates.clear();
    for (const c of data.candidates) {
      el.#candidates.add(c);
    }
    el.#leader = data.leader;
    el.#heartbeats.clear();
    for (const [k, v] of Object.entries(data.heartbeats)) {
      el.#heartbeats.set(k, v);
    }
    return el;
  }
}

// ---------------------------------------------------------------------------
// TaskDistributor
// ---------------------------------------------------------------------------

/**
 * Distributes tasks to swarm members based on pluggable strategies.
 */
export class TaskDistributor {
  /** @type {Map<string, SwarmMember>} podId -> SwarmMember */
  #members = new Map();

  /** @type {number} Round-robin index tracker */
  #rrIndex = 0;

  /**
   * @param {SwarmMember[]} [members]
   */
  constructor(members = []) {
    for (const m of members) {
      this.#members.set(m.podId, m);
    }
  }

  /**
   * Add a member to the distributor pool.
   * @param {SwarmMember} member
   */
  addMember(member) {
    this.#members.set(member.podId, member);
  }

  /**
   * Remove a member from the pool.
   * @param {string} podId
   * @returns {boolean}
   */
  removeMember(podId) {
    return this.#members.delete(podId);
  }

  /**
   * Get a member by podId.
   * @param {string} podId
   * @returns {SwarmMember|null}
   */
  getMember(podId) {
    return this.#members.get(podId) || null;
  }

  /**
   * All members as an array.
   * @returns {SwarmMember[]}
   */
  get members() {
    return [...this.#members.values()];
  }

  /** @returns {number} */
  get size() {
    return this.#members.size;
  }

  /**
   * Distribute a task to members using the given strategy.
   * Returns an array of assigned podIds.
   *
   * Strategies:
   *  - leader-follower: assigns to the first member (by insertion order)
   *  - round-robin: rotates through members cyclically
   *  - load-balanced: picks the member with the lowest load
   *  - redundant: assigns to ALL members
   *  - pipeline: assigns to all members in order (same as redundant, semantically different)
   *
   * @param {SwarmTask} task
   * @param {string} [strategy] - Override task's strategy
   * @returns {string[]} Assigned podIds
   */
  distribute(task, strategy) {
    const strat = strategy || task.strategy || 'leader-follower';
    const all = [...this.#members.values()];

    if (all.length === 0) return [];

    switch (strat) {
      case 'leader-follower': {
        const assigned = [all[0].podId];
        task.assignedTo = assigned;
        task.status = 'assigned';
        return assigned;
      }

      case 'round-robin': {
        const idx = this.#rrIndex % all.length;
        this.#rrIndex++;
        const assigned = [all[idx].podId];
        task.assignedTo = assigned;
        task.status = 'assigned';
        return assigned;
      }

      case 'load-balanced': {
        const sorted = [...all].sort((a, b) => a.load - b.load);
        const assigned = [sorted[0].podId];
        task.assignedTo = assigned;
        task.status = 'assigned';
        return assigned;
      }

      case 'redundant': {
        const assigned = all.map(m => m.podId);
        task.assignedTo = assigned;
        task.status = 'assigned';
        return assigned;
      }

      case 'pipeline': {
        const assigned = all.map(m => m.podId);
        task.assignedTo = assigned;
        task.status = 'assigned';
        return assigned;
      }

      default:
        throw new Error(`Unknown task strategy: ${strat}`);
    }
  }
}

// ---------------------------------------------------------------------------
// SwarmCoordinator
// ---------------------------------------------------------------------------

/**
 * High-level facade for swarm management: joining/leaving, leader election,
 * task submission and lifecycle.
 */
export class SwarmCoordinator {
  /** @type {LeaderElection} */
  #election;

  /** @type {TaskDistributor} */
  #distributor;

  /** @type {Map<string, SwarmTask>} taskId -> SwarmTask */
  #tasks = new Map();

  /**
   * @param {string} localPodId
   * @param {object} [opts]
   * @param {number} [opts.heartbeatMs]
   * @param {number} [opts.electionTimeoutMs]
   */
  constructor(localPodId, opts = {}) {
    this.#election = new LeaderElection(localPodId, opts);
    this.#distributor = new TaskDistributor();

    // Add self as first member
    const self = new SwarmMember({ podId: localPodId });
    this.#distributor.addMember(self);
  }

  /** @returns {LeaderElection} */
  get election() {
    return this.#election;
  }

  /** @returns {TaskDistributor} */
  get distributor() {
    return this.#distributor;
  }

  /**
   * Add a new member to the swarm.
   *
   * @param {string} podId
   * @param {string[]} [capabilities]
   * @returns {SwarmMember}
   */
  join(podId, capabilities = []) {
    const member = new SwarmMember({ podId, capabilities });
    this.#distributor.addMember(member);
    this.#election.addCandidate(podId);
    return member;
  }

  /**
   * Remove a member from the swarm.
   *
   * @param {string} podId
   * @returns {boolean}
   */
  leave(podId) {
    this.#election.removeCandidate(podId);
    return this.#distributor.removeMember(podId);
  }

  /**
   * Submit a new task to the swarm.
   * The task is created, distributed, and stored.
   *
   * @param {string} description
   * @param {string} [strategy]
   * @param {*} [input]
   * @returns {SwarmTask}
   */
  submitTask(description, strategy, input) {
    const task = new SwarmTask({
      description,
      strategy: strategy || 'leader-follower',
      input: input ?? null,
    });
    this.#distributor.distribute(task);
    this.#tasks.set(task.taskId, task);
    return task;
  }

  /**
   * Get a task by ID.
   *
   * @param {string} taskId
   * @returns {SwarmTask|null}
   */
  getTask(taskId) {
    return this.#tasks.get(taskId) || null;
  }

  /**
   * Mark a task as completed.
   *
   * @param {string} taskId
   * @param {*} [output]
   * @returns {boolean} true if the task was found and completed
   */
  completeTask(taskId, output) {
    const task = this.#tasks.get(taskId);
    if (!task) return false;
    task.status = 'completed';
    task.output = output ?? null;
    task.completedAt = Date.now();
    return true;
  }

  /**
   * Mark a task as failed.
   *
   * @param {string} taskId
   * @param {*} [error]
   * @returns {boolean} true if the task was found and marked failed
   */
  failTask(taskId, error) {
    const task = this.#tasks.get(taskId);
    if (!task) return false;
    task.status = 'failed';
    task.output = error ?? null;
    task.completedAt = Date.now();
    return true;
  }

  /**
   * List tasks, optionally filtering by status.
   *
   * @param {object} [opts]
   * @param {string} [opts.status] - Filter by task status
   * @returns {SwarmTask[]}
   */
  listTasks(opts = {}) {
    let tasks = [...this.#tasks.values()];
    if (opts.status) {
      tasks = tasks.filter(t => t.status === opts.status);
    }
    return tasks;
  }

  /** @returns {number} Number of members in the swarm */
  get swarmSize() {
    return this.#distributor.size;
  }

  /** @returns {boolean} true if the local pod is the elected leader */
  get isLeader() {
    return this.#election.role === 'leader';
  }
}

export { TASK_STATUSES };
