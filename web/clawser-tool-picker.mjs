/**
 * clawser-tool-picker.mjs — Inline tool picker for the agent editor
 *
 * Pure model/render/collect helpers so the picker logic is testable
 * without a DOM. Used by the agent editor when Tool Mode is
 * "allowlist" or "blocklist" to populate `agent.tools.list`.
 *
 * @module clawser-tool-picker
 */

import { esc } from './clawser-state.js';

/**
 * Group tool specs by category with checked state.
 *
 * @param {Array<{name: string, category?: string, description?: string}>} specs
 * @param {string[]} selected - Currently selected tool names
 * @returns {Array<{category: string, tools: Array<{name: string, description: string, checked: boolean}>}>}
 *   Categories sorted alphabetically; tools sorted within each category.
 */
export function buildToolPickerModel(specs, selected) {
  const selectedSet = new Set(selected || []);
  const byCategory = new Map();
  for (const spec of specs || []) {
    const category = spec.category || 'other';
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push({
      name: spec.name,
      description: spec.description || '',
      checked: selectedSet.has(spec.name),
    });
  }
  return [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, tools]) => ({
      category,
      tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

/**
 * Render the picker model as HTML (checkboxes with class `tool-picker-cb`
 * and `data-tool` attributes).
 *
 * @param {ReturnType<typeof buildToolPickerModel>} model
 * @returns {string}
 */
export function renderToolPickerHtml(model) {
  if (!model || model.length === 0) {
    return '<div class="tool-picker-empty">No tools registered.</div>';
  }
  return model.map(group => `
    <div class="tool-picker-group">
      <div class="tool-picker-category">${esc(group.category)}</div>
      ${group.tools.map(t => `
        <label class="tool-picker-row" title="${esc(t.description)}">
          <input type="checkbox" class="tool-picker-cb" data-tool="${esc(t.name)}" ${t.checked ? 'checked' : ''} />
          <span class="tool-picker-name">${esc(t.name)}</span>
        </label>`).join('')}
    </div>`).join('');
}

/**
 * Collect checked tool names from a rendered picker.
 *
 * @param {{querySelectorAll: Function}|null} rootEl - Element containing the picker
 * @returns {string[]}
 */
export function collectToolPickerSelection(rootEl) {
  if (!rootEl) return [];
  return [...rootEl.querySelectorAll('input.tool-picker-cb')]
    .filter(cb => cb.checked)
    .map(cb => cb.dataset.tool);
}
