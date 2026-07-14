/**
 * clawser-panel-dirty.mjs — Per-input dirty tracking for config panels.
 *
 * Phase 7 read direction: when a config file changes externally (another
 * tab, an agent edit, a `chmod` write), reactive subscribers want to
 * re-render the relevant panel. But if the user is mid-edit, blindly
 * overwriting their inputs is hostile.
 *
 * This module marks an input as "dirty" the first time the user types or
 * changes its value. Render code uses `setIfClean(id, value)` which only
 * updates inputs that have not been touched. On a successful save, the
 * panel's inputs are marked clean again.
 *
 * @module clawser-panel-dirty
 *
 * @example
 *   import { bindDirtyTrackingForIds, setIfClean, markPanelClean } from './clawser-panel-dirty.mjs';
 *
 *   // Once at startup
 *   bindDirtyTrackingForIds([
 *     'cfgAutonomyLevel', 'cfgMaxActions', 'cfgDailyCostLimit',
 *   ]);
 *
 *   // In renderXxxSection(config):
 *   setIfClean('cfgMaxActions', config.maxActions);
 *
 *   // In saveXxxSettings() after a successful save:
 *   markPanelClean(['cfgAutonomyLevel', 'cfgMaxActions', 'cfgDailyCostLimit']);
 */

/** Sentinel data attribute used to flag dirty inputs. */
const DIRTY_ATTR = 'clawserDirty';

/**
 * Mark an input element as dirty (user-touched).
 * @param {HTMLElement} el
 */
export const markDirty = (el) => {
  if (el && el.dataset) el.dataset[DIRTY_ATTR] = 'true';
};

/**
 * Mark an input element as clean (matches saved state).
 * @param {HTMLElement} el
 */
export const markClean = (el) => {
  if (el && el.dataset && el.dataset[DIRTY_ATTR]) {
    delete el.dataset[DIRTY_ATTR];
  }
};

/**
 * @param {HTMLElement} el
 * @returns {boolean}
 */
export const isDirty = (el) => !!(el && el.dataset && el.dataset[DIRTY_ATTR] === 'true');

/**
 * Bind dirty tracking to one element. Listens for `input` and `change`
 * events; the first such event marks the element dirty.
 *
 * Idempotent — safe to call repeatedly with the same element.
 *
 * @param {HTMLElement} el
 */
export const bindDirtyTracking = (el) => {
  if (!el || !el.addEventListener) return;
  if (el._clawserDirtyBound) return;
  el._clawserDirtyBound = true;
  const onChange = () => markDirty(el);
  el.addEventListener('input', onChange);
  el.addEventListener('change', onChange);
};

/**
 * Bind dirty tracking to a set of input element IDs (lazy lookups via
 * document.getElementById; missing elements are silently skipped).
 *
 * @param {string[]} ids
 */
export const bindDirtyTrackingForIds = (ids) => {
  if (typeof document === 'undefined') return;
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) bindDirtyTracking(el);
  }
};

/**
 * Bind dirty tracking to every input/textarea/select inside a container.
 * Useful when the inputs aren't easily addressable by ID.
 *
 * @param {HTMLElement} container
 */
export const bindDirtyTrackingForContainer = (container) => {
  if (!container || !container.querySelectorAll) return;
  const inputs = container.querySelectorAll('input, textarea, select');
  for (const el of inputs) bindDirtyTracking(el);
};

/**
 * Set an input's value only if the user hasn't touched it. This is the
 * safe-write primitive for render code that may run while the user is
 * mid-edit.
 *
 * For radio button groups, pass the group name and the desired value:
 * `setRadioIfClean(name, value)` (separate helper).
 *
 * @param {string} idOrEl - DOM id or element reference
 * @param {string|number|boolean} value
 * @returns {boolean} true if the value was applied; false if input was dirty
 *   or missing.
 */
export const setIfClean = (idOrEl, value) => {
  const el = typeof idOrEl === 'string'
    ? (typeof document !== 'undefined' ? document.getElementById(idOrEl) : null)
    : idOrEl;
  if (!el) return false;
  if (isDirty(el)) return false;
  // Coerce value type to whatever the input expects.
  if (el.type === 'checkbox') {
    el.checked = !!value;
  } else {
    el.value = value == null ? '' : String(value);
  }
  return true;
};

/**
 * Set the checked state of a radio button group only if no member has
 * been touched.
 *
 * @param {string} name - The `name` attribute shared by the radio group.
 * @param {string} value - The `value` to select.
 * @returns {boolean}
 */
export const setRadioIfClean = (name, value) => {
  if (typeof document === 'undefined') return false;
  const radios = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
  if (radios.length === 0) return false;
  // If any radio in the group is dirty, leave the group alone.
  for (const r of radios) {
    if (isDirty(r)) return false;
  }
  for (const r of radios) {
    r.checked = (r.value === value);
  }
  return true;
};

/**
 * Mark a set of input IDs as clean (called after a successful save so
 * subsequent renders can update them again).
 *
 * @param {string[]} ids
 */
export const markPanelClean = (ids) => {
  if (typeof document === 'undefined') return;
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) markClean(el);
  }
};

/**
 * Mark every input/textarea/select inside a container as clean.
 *
 * @param {HTMLElement} container
 */
export const markContainerClean = (container) => {
  if (!container || !container.querySelectorAll) return;
  const inputs = container.querySelectorAll('input, textarea, select');
  for (const el of inputs) markClean(el);
};

/**
 * Reset internal state — for tests only.
 * @internal
 */
export const __resetForTests = () => {
  // No module-level state; this is a no-op helper kept for API parity.
};
