/**
 * Clawser Cost Event Recording
 *
 * Extracted from clawser-ui-config.js to break the circular dependency
 * between clawser-ui-chat.js and clawser-ui-config.js.
 *
 * clawser-ui-chat.js needs recordCostEvent (to log costs after LLM calls).
 * clawser-ui-config.js needs addMsg/addErrorMsg (for user feedback).
 * This module holds the cost recording logic with no dependency on either.
 */

import { state } from './clawser-state.js';
import { CostTracker } from './clawser-cost-tracker.js';

/** Get or create the CostTracker for the current workspace. */
export function getCostTracker() {
  const wsId = state.agent?.getWorkspace() || 'default';
  if (!state._costTracker || state._costTracker._wsId !== wsId) {
    state._costTracker = new CostTracker(wsId);
    state._costTracker._wsId = wsId;
  }
  return state._costTracker;
}

/** Record a cost event from the chat flow.
 * @param {string} model - Model name
 * @param {object} usage - Usage object with input_tokens/output_tokens
 * @param {number} costCents - Cost in cents
 */
export function recordCostEvent(model, usage, costCents) {
  getCostTracker().recordCost(model, usage, costCents);
}
