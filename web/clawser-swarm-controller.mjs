/**
 * clawser-swarm-controller.mjs — production controller + view-model
 * for the swarms panel.
 *
 * `SwarmCoordinator` (in `clawser-mesh-swarm.js`) tracks real, independent
 * swarms keyed by swarmId ('local' is the always-present default). The
 * view-model lists one card per real swarm — no synthesis needed.
 *
 * The panel buttons map to:
 *   - Join     → coordinator.join(podId, [], swarmId) — needs a podId; we ask via prompt
 *   - Leave    → coordinator.leave(localPodId, swarmId) — current pod leaves that swarm
 *   - Disband  → coordinator.disbandSwarm(swarmId) — 'local' can't be disbanded
 *   - Remove   → cancelTask(taskId) when card represents a completed task
 *   - Create   → coordinator.createSwarm(newId) + join each member + submitTask(goal, ..., newId)
 */

/**
 * Build the view-model for the swarms panel from a `SwarmCoordinator`.
 * Duck-typed against `listSwarms`/`listMembers`/`listTasks` so a partial
 * mock (without multi-swarm support) still renders a single 'local' card.
 *
 * @param {object} sc                — SwarmCoordinator instance (or null)
 * @param {string} localPodId
 * @returns {{swarms: object[]}}
 */
export function buildSwarmViewModel(sc, localPodId) {
  if (!sc) return { swarms: [] };

  const summaries = typeof sc.listSwarms === 'function'
    ? sc.listSwarms()
    : [{ swarmId: 'local', size: sc.swarmSize ?? 0, isLeader: !!sc.isLeader, leader: sc.leader ?? null, taskCount: 0 }];

  return {
    swarms: summaries.map(summary => {
      const members = typeof sc.listMembers === 'function'
        ? sc.listMembers(summary.swarmId)
        : (summary.swarmId === 'local' ? [localPodId] : []);
      const tasks = typeof sc.listTasks === 'function' ? sc.listTasks({ swarmId: summary.swarmId }) : [];
      const leader = summary.isLeader ? localPodId : (summary.leader || localPodId);
      const status = members.length === 0 ? 'forming' : 'active';

      return {
        id: summary.swarmId,
        goal: summary.swarmId === 'local' ? 'Local swarm' : summary.swarmId,
        status,
        strategy: 'leader-follower',
        leader,
        members,
        subtasks: tasks.map(t => ({
          id: t.taskId,
          description: t.description,
          status: t.status,
          assignee: t.assignedTo,
          result: t.output,
        })),
      };
    }),
  };
}

/**
 * @typedef {object} SwarmControllerCtx
 * @property {object} coordinator   — SwarmCoordinator instance
 * @property {string} localPodId
 * @property {Function} [onLog]     — (msg:string) => void
 * @property {Function} [promptForPodId]  — async () => string|null (for Join)
 * @property {Function} [generateSwarmId] — () => string (for Create); defaults to a random id
 */

function defaultSwarmId() {
  const rand = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `swarm_${rand}`;
}

/**
 * Build the swarms panel controller.
 *
 * @param {SwarmControllerCtx} ctx
 * @returns {{onCreate:Function, onJoin:Function, onLeave:Function, onDisband:Function, onRemove:Function}}
 */
export function buildSwarmController(ctx) {
  const sc = ctx?.coordinator;
  const localPodId = ctx?.localPodId || 'local';
  const log = ctx?.onLog || (() => {});
  const promptForPodId = ctx?.promptForPodId || (async () => null);
  const generateSwarmId = ctx?.generateSwarmId || defaultSwarmId;

  return {
    /**
     * Create a new swarm and submit its first task. Members are added
     * to the NEW swarm (not 'local') by calling `sc.join(podId, [], swarmId)`
     * for each entry in `opts.members`. Falls back to the 'local' swarm
     * when the coordinator doesn't support `createSwarm` (a partial mock).
     *
     * @param {{goal:string, strategy?:string, members?:string[], maxAgents?:number}} opts
     */
    async onCreate(opts) {
      if (!sc) { log('SwarmCoordinator not initialized'); return { ok: false, error: 'no coordinator' }; }
      if (!opts?.goal) return { ok: false, error: 'goal required' };

      const supportsMultiSwarm = typeof sc.createSwarm === 'function';
      const swarmId = supportsMultiSwarm ? generateSwarmId() : 'local';
      if (supportsMultiSwarm) sc.createSwarm(swarmId);

      const added = [];
      for (const podId of (opts.members || [])) {
        try {
          if (typeof sc.join === 'function' && podId) {
            sc.join(podId, [], swarmId);
            added.push(podId);
          }
        } catch (err) { log(`Failed to add member ${podId}: ${err?.message || err}`); }
      }
      // maxAgents is informational — the SwarmCoordinator doesn't
      // enforce a cap today. We surface it in the log so the user
      // sees their input was registered.
      const cap = typeof opts.maxAgents === 'number' ? ` (max=${opts.maxAgents})` : '';
      const task = sc.submitTask(opts.goal, opts.strategy || 'leader-follower', { maxAgents: opts.maxAgents }, swarmId);
      log(`Swarm task submitted: "${opts.goal}"${cap}; ${added.length} member${added.length === 1 ? '' : 's'} added`);
      return { ok: true, taskId: task?.taskId, swarmId };
    },

    /**
     * Add a peer to the given swarm (defaults to 'local' when no swarmId
     * is passed — e.g. a legacy caller). The joining podId itself comes
     * from the injected `promptForPodId` (a window.prompt-style modal in
     * production).
     *
     * @param {string} [swarmId]
     */
    async onJoin(swarmId) {
      if (!sc) return { ok: false, error: 'no coordinator' };
      const podId = await promptForPodId();
      if (!podId) return { ok: false, error: 'cancelled' };
      sc.join(podId, [], swarmId || 'local');
      log(`Pod ${podId} joined swarm ${swarmId || 'local'}`);
      return { ok: true, podId };
    },

    /**
     * Local pod leaves the given swarm (defaults to 'local').
     * @param {string} [swarmId]
     */
    onLeave(swarmId) {
      if (!sc) return { ok: false, error: 'no coordinator' };
      sc.leave(localPodId, swarmId || 'local');
      log(`${localPodId} left swarm ${swarmId || 'local'}`);
      return { ok: true };
    },

    /**
     * Disband a swarm. The 'local' swarm can never be disbanded — it's
     * the coordinator's always-available default (matches
     * `SwarmCoordinator.disbandSwarm`'s own guard).
     *
     * @param {string} swarmId
     */
    onDisband(swarmId) {
      if (!sc) return { ok: false, error: 'no coordinator' };
      if (!swarmId || swarmId === 'local') {
        log("Disband: the 'local' swarm can't be disbanded — use Leave or cancel individual tasks.");
        return { ok: false, error: 'unsupported' };
      }
      if (typeof sc.disbandSwarm !== 'function') {
        log('Disband: coordinator does not support disbanding swarms.');
        return { ok: false, error: 'unsupported' };
      }
      try {
        const removed = sc.disbandSwarm(swarmId);
        log(removed ? `Swarm ${swarmId} disbanded` : `Swarm ${swarmId} not found`);
        return { ok: removed };
      } catch (err) {
        log(`Disband failed: ${err?.message || err}`);
        return { ok: false, error: err?.message || String(err) };
      }
    },

    /**
     * Remove a swarm card. Cards represent tasks, so Remove maps to
     * `cancelTask`. We accept either a taskId or a swarm's synthetic
     * top-level id ('local' or any real swarmId); the latter is a no-op
     * since removing a whole swarm is what Disband is for.
     */
    onRemove(idOrTaskId) {
      if (!sc) return { ok: false, error: 'no coordinator' };
      if (!idOrTaskId || (typeof sc.hasSwarm === 'function' ? sc.hasSwarm(idOrTaskId) : idOrTaskId === 'local')) {
        log('Remove: cannot remove a swarm itself — use Disband.');
        return { ok: false, error: 'unsupported' };
      }
      if (typeof sc.cancelTask === 'function') {
        const ok = sc.cancelTask(idOrTaskId);
        log(ok ? `Task ${idOrTaskId} cancelled` : `Task ${idOrTaskId} not found`);
        return { ok };
      }
      return { ok: false, error: 'unsupported' };
    },
  };
}
