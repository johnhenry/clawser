// clawser-extension-routine-bridge.js — lets the Clawser Browser Control
// extension delegate scheduled-routine execution into a live, booted
// Clawser tab.
//
// The extension's chrome.alarms-based scheduler (background.js) runs in
// an isolated service worker with no access to this page's live
// orchestrator/gateway/agent objects, so it can't execute a routine's
// action itself — it can only detect that one is due. This bridge is the
// other half: it tells the extension when this tab is a live, ready
// workspace, and executes routines the extension asks it to run via
// RoutineEngine.triggerManual(), which already routes through
// executeRoutineAction() with the real state.
//
// Wire format (all via window.postMessage, relayed by content.js):
//   page  -> ext: { type: MARKER, direction: 'notify', action: 'workspace_ready', wsId }
//   ext   -> page: { type: MARKER, direction: 'push', action: 'execute_routine', routineId }
//   page  -> ext: { type: MARKER, direction: 'notify', action: 'routine_executed', routineId, success, error }
//
// content.js only relays 'request'/'response' messages today — it needs
// a small addition (see clawser-browser-control's content.js) to also
// relay 'notify' (page-initiated, fire-and-forget) and 'push'
// (extension-initiated) messages in both directions.

import { MARKER } from './clawser-extension-tools.js';

/**
 * Start listening for extension-initiated "please run this routine now"
 * pushes, and dispatch them to the given RoutineEngine.
 *
 * @param {object} opts
 * @param {import('./clawser-routines.js').RoutineEngine} opts.routineEngine
 * @param {(msg: string) => void} [opts.onLog]
 * @returns {() => void} teardown function
 */
export function initExtensionRoutineBridge({ routineEngine, onLog = () => {} }) {
  if (typeof window === 'undefined' || !routineEngine) return () => {};

  async function handleMessage(ev) {
    if (ev.source !== window) return;
    const msg = ev.data;
    if (!msg || msg.type !== MARKER || msg.direction !== 'push' || msg.action !== 'execute_routine') return;

    const { routineId } = msg;
    let success = false;
    let error = null;
    try {
      await routineEngine.triggerManual(routineId);
      success = true;
    } catch (e) {
      error = e.message || String(e);
      onLog(`[extension-routine-bridge] Routine ${routineId} failed: ${error}`);
    }

    window.postMessage({
      type: MARKER,
      direction: 'notify',
      action: 'routine_executed',
      routineId,
      success,
      error,
    }, '*');
  }

  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}

/**
 * Tell the extension this tab is a live, fully-booted Clawser workspace,
 * so its scheduler can delegate due routines here instead of only
 * updating bookkeeping (or opening a new tab when none is available).
 * Safe to call even if the extension isn't installed — content.js simply
 * won't be present to relay it, and postMessage with no listener is a
 * no-op.
 *
 * @param {string} wsId
 */
export function notifyWorkspaceReady(wsId) {
  if (typeof window === 'undefined') return;
  window.postMessage({ type: MARKER, direction: 'notify', action: 'workspace_ready', wsId }, '*');
}
