/**
 * clawser-mesh-controller.mjs — production controller for the Mesh
 * Dashboard panel.
 *
 * The render+bind layer in `clawser-ui-mesh.js` accepts
 * `{onExecRemote, onDeploySkill, onDrainPod, onRefresh}`. Each
 * action chains to the relevant backend:
 *
 *   - onRefresh   → caller-supplied `refresh()` (typically
 *                   `refreshMeshWorkspacePanel`)
 *   - onDrainPod  → `peerNode.disconnectPeer(pubKey)` after the user
 *                   selects a target via `promptForPubKey()`
 *   - onExecRemote → `peerNode.sendTo(pubKey, JSON.stringify({type:
 *                   'remote-exec', cmd}))` after the user supplies
 *                   target + command via `promptForExec()`
 *   - onDeploySkill → opens the multi-device deploy flow against
 *                   a paired device target via the controller
 *                   factory injected as `deploySkillFlow`
 *
 * Prompt + flow helpers are injected so the controller stays
 * testable without DOM. Production passes window.prompt / modal.
 */

/**
 * @typedef {object} MeshControllerCtx
 * @property {object} peerNode       — `{disconnectPeer, sendTo}`
 * @property {Function} [refresh]    — () => void
 * @property {Function} [promptForPubKey]  — async () => string|null
 * @property {Function} [promptForExec]    — async () => {target, cmd}|null
 * @property {Function} [deploySkillFlow]  — async () => {ok:boolean, error?:string}
 * @property {Function} [onLog]      — (msg:string) => void
 * @property {Function} [onError]    — (err:any) => void
 */

/**
 * Build the Mesh Dashboard controller.
 *
 * @param {MeshControllerCtx} ctx
 * @returns {{onExecRemote:Function, onDeploySkill:Function, onDrainPod:Function, onRefresh:Function}}
 */
export function buildMeshController(ctx) {
  const peerNode = ctx?.peerNode;
  const refresh = ctx?.refresh || (() => {});
  const promptPubKey = ctx?.promptForPubKey || (async () => null);
  const promptExec = ctx?.promptForExec || (async () => null);
  const deploySkillFlow = ctx?.deploySkillFlow || (async () => ({ ok: false, error: 'deploy flow not configured' }));
  const log = ctx?.onLog || (() => {});
  const onError = ctx?.onError || (() => {});

  return {
    /**
     * Execute a command on a remote pod. Sends a `{type:'remote-exec',
     * cmd}` envelope via the peer transport. The recipient is
     * responsible for actually running the command.
     *
     * @returns {Promise<{ok:boolean, target?:string, error?:string}>}
     */
    async onExecRemote() {
      if (!peerNode || typeof peerNode.sendTo !== 'function') {
        return { ok: false, error: 'peerNode not initialized' };
      }
      const got = await promptExec();
      if (!got) return { ok: false, error: 'cancelled' };
      const { target, cmd } = got;
      if (!target || !cmd) return { ok: false, error: 'target and cmd required' };
      try {
        await peerNode.sendTo(target, JSON.stringify({ type: 'remote-exec', cmd }));
        log(`Remote exec sent to ${target}: ${cmd}`);
        return { ok: true, target };
      } catch (err) {
        onError(err);
        return { ok: false, error: err?.message || String(err) };
      }
    },

    /**
     * Open the deploy-skill flow. Delegates to the injected
     * `deploySkillFlow` so this module doesn't import the deploy
     * package directly (avoids a circular import surface).
     *
     * @returns {Promise<{ok:boolean, error?:string}>}
     */
    async onDeploySkill() {
      try {
        const r = await deploySkillFlow();
        if (r?.ok) log('Deploy skill: package sent');
        else if (r?.error) log(`Deploy skill failed: ${r.error}`);
        return r || { ok: false, error: 'no result' };
      } catch (err) {
        onError(err);
        return { ok: false, error: err?.message || String(err) };
      }
    },

    /**
     * Drain (gracefully disconnect) a pod. Asks for the target via
     * `promptForPubKey`, then calls `peerNode.disconnectPeer`.
     *
     * @returns {Promise<{ok:boolean, target?:string, error?:string}>}
     */
    async onDrainPod() {
      if (!peerNode || typeof peerNode.disconnectPeer !== 'function') {
        return { ok: false, error: 'peerNode not initialized' };
      }
      const target = await promptPubKey();
      if (!target) return { ok: false, error: 'cancelled' };
      try {
        peerNode.disconnectPeer(target);
        log(`Drained pod: ${target}`);
        return { ok: true, target };
      } catch (err) {
        onError(err);
        return { ok: false, error: err?.message || String(err) };
      }
    },

    /**
     * Refresh the mesh dashboard.
     */
    onRefresh() {
      try { refresh(); log('Mesh dashboard refreshed'); }
      catch (err) { onError(err); }
    },
  };
}
