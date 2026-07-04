/**
 * clawser-swarm-controller.mjs — production controller + view-model
 * for the swarms panel.
 *
 * STRUCTURAL NOTE — the panel UI in `clawser-ui-swarms.js` was
 * designed for a multi-swarm world (each card is one swarm with its
 * own members + tasks). The current `SwarmCoordinator` (in
 * `clawser-mesh-swarm.js`) is a SINGLE swarm with members + tasks.
 *
 * To bridge the mismatch without a full UI redesign, the view-model
 * synthesizes ONE swarm card that represents the local swarm:
 *   - members → coordinator's distributor members
 *   - subtasks → coordinator's tasks
 *   - leader → election leader
 *   - status → 'active' if there are members, else 'forming'
 *
 * The panel buttons map to:
 *   - Join     → coordinator.join(podId) — needs a podId; we ask via prompt
 *   - Leave    → coordinator.leave(localPodId) — current pod leaves
 *   - Disband  → not supported by single-swarm backend; logs warning
 *   - Remove   → cancelTask(taskId) when card represents a completed task
 *   - Create   → submitTask(goal, strategy, {members, maxAgents})
 *                + sc.join(member) for each member listed
 */

/**
 * Build the view-model for the swarms panel from a `SwarmCoordinator`.
 *
 * @param {object} sc                — SwarmCoordinator instance (or null)
 * @param {string} localPodId
 * @returns {{swarms: object[]}}
 */
export function buildSwarmViewModel(sc, localPodId) {
  if (!sc) return { swarms: [] };

  const members = (() => {
    // Distributor exposes its members internally; we read via listTasks
    // metadata or a public getter if available.
    if (typeof sc.listMembers === 'function') return sc.listMembers();
    if (sc.swarmSize === 0) return [];
    // Fallback — synthesize from the local pod alone if nothing else
    return [localPodId];
  })();

  const tasks = (typeof sc.listTasks === 'function') ? sc.listTasks() : [];
  const leader = sc.isLeader ? localPodId : (sc.leader || localPodId);

  const status = members.length === 0 ? 'forming' : 'active';

  // One synthetic swarm representing the local instance.
  return {
    swarms: [{
      id: 'local',
      goal: 'Local swarm',
      status,
      strategy: 'leader-follower',
      leader,
      members,
      subtasks: tasks.map(t => ({
        id: t.taskId,
        description: t.description,
        status: t.status,
        assignee: t.assignee,
        result: t.output,
      })),
    }],
  };
}

/**
 * @typedef {object} SwarmControllerCtx
 * @property {object} coordinator   — SwarmCoordinator instance
 * @property {string} localPodId
 * @property {Function} [onLog]     — (msg:string) => void
 * @property {Function} [promptForPodId]  — async () => string|null (for Join)
 */

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

  return {
    /**
     * Create a new task. Optionally pre-populates members by calling
     * `sc.join(memberPodId)` for each entry in `opts.members`.
     *
     * @param {{goal:string, strategy?:string, members?:string[], maxAgents?:number}} opts
     */
    async onCreate(opts) {
      if (!sc) { log('SwarmCoordinator not initialized'); return { ok: false, error: 'no coordinator' }; }
      if (!opts?.goal) return { ok: false, error: 'goal required' };
      // Honor `members` — add each as a joining pod
      const added = [];
      for (const podId of (opts.members || [])) {
        try {
          if (typeof sc.join === 'function' && podId) {
            sc.join(podId);
            added.push(podId);
          }
        } catch (err) { log(`Failed to add member ${podId}: ${err?.message || err}`); }
      }
      // maxAgents is informational — the SwarmCoordinator doesn't
      // enforce a cap today. We surface it in the log so the user
      // sees their input was registered.
      const cap = typeof opts.maxAgents === 'number' ? ` (max=${opts.maxAgents})` : '';
      const task = sc.submitTask(opts.goal, opts.strategy || 'leader-follower', { maxAgents: opts.maxAgents });
      log(`Swarm task submitted: "${opts.goal}"${cap}; ${added.length} member${added.length === 1 ? '' : 's'} added`);
      return { ok: true, taskId: task?.taskId };
    },

    /**
     * Add a peer to the swarm. UI passes `swarmId` from the card
     * data attribute; for the synthetic single-swarm model the
     * relevant target is the podId of the joining peer, which we
     * obtain via the injected `promptForPodId` (defaulting to a
     * window.prompt-style modal in production).
     *
     * @param {string} _swarmId   — ignored (single-swarm backend)
     */
    async onJoin(_swarmId) {
      if (!sc) return { ok: false, error: 'no coordinator' };
      const podId = await promptForPodId();
      if (!podId) return { ok: false, error: 'cancelled' };
      sc.join(podId);
      log(`Pod ${podId} joined the swarm`);
      return { ok: true, podId };
    },

    /**
     * Local pod leaves the swarm.
     */
    onLeave(_swarmId) {
      if (!sc) return { ok: false, error: 'no coordinator' };
      sc.leave(localPodId);
      log(`${localPodId} left the swarm`);
      return { ok: true };
    },

    /**
     * Disband is not supported by the single-swarm backend. Surface
     * a clear log message rather than silently no-op.
     */
    onDisband(_swarmId) {
      log('Disband: single-swarm backend does not support disband. Use Leave or cancel individual tasks.');
      return { ok: false, error: 'unsupported' };
    },

    /**
     * Remove a swarm card. In single-swarm mode the cards represent
     * tasks (via the synthesized swarm), so Remove maps to
     * `cancelTask`. We accept either a taskId or the synthetic
     * swarm id ('local'); the latter is a no-op.
     */
    onRemove(idOrTaskId) {
      if (!sc) return { ok: false, error: 'no coordinator' };
      if (idOrTaskId === 'local' || !idOrTaskId) {
        log('Remove: cannot remove the local swarm itself.');
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
