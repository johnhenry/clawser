/**
 * event-reporter.mjs — JS snippet factory for injecting into browsers
 * to stream consensus events back to the test harness.
 *
 * The snippet sets up event listeners on the ClawserPod instance and
 * logs consensus events to a global array that can be polled via eval.
 */

/**
 * Returns a JS snippet that, when eval'd in a browser, sets up a
 * consensus event reporter on `window.__consensusEvents`.
 *
 * @param {object} [opts]
 * @param {string} [opts.varName='__consensusEvents'] - Global variable name
 * @returns {string} JavaScript code to eval in browser
 */
export function createEventReporterSnippet(opts = {}) {
  const varName = opts.varName || '__consensusEvents'
  return `
    (function() {
      window.${varName} = window.${varName} || [];
      const events = window.${varName};

      // Hook into the pod's mesh message router if available
      const pod = window.__clawserPod || window.clawserApp?.pod;
      if (!pod) {
        events.push({ type: 'error', message: 'No pod instance found', ts: Date.now() });
        return JSON.stringify({ ok: false, error: 'no pod' });
      }

      // Listen for PBFT wire codes (0xED-0xEF, 0xF4-0xF5)
      const PBFT_CODES = new Set([0xED, 0xEE, 0xEF, 0xF4, 0xF5]);
      const CODE_NAMES = {
        0xED: 'pre-prepare', 0xEE: 'prepare', 0xEF: 'commit',
        0xF4: 'view-change', 0xF5: 'new-view'
      };

      // Override the pod's message handler to also log consensus events
      const origHandler = pod._onMeshMessage?.bind(pod);
      pod._onMeshMessage = function(msg) {
        if (PBFT_CODES.has(msg.type)) {
          events.push({
            type: 'pbft',
            pbftType: CODE_NAMES[msg.type] || 'unknown',
            wireCode: msg.type,
            from: msg.from,
            ts: Date.now()
          });
        }
        if (origHandler) origHandler(msg);
      };

      events.push({ type: 'reporter-ready', ts: Date.now() });
      return JSON.stringify({ ok: true, listening: true });
    })()
  `
}

/**
 * Returns a JS snippet that reads and clears collected consensus events.
 *
 * @param {object} [opts]
 * @param {string} [opts.varName='__consensusEvents'] - Global variable name
 * @returns {string} JavaScript code to eval in browser
 */
export function createEventDrainSnippet(opts = {}) {
  const varName = opts.varName || '__consensusEvents'
  return `
    (function() {
      const events = window.${varName} || [];
      const result = JSON.stringify(events);
      window.${varName} = [];
      return result;
    })()
  `
}
