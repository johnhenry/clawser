/**
 * clawser-ui-memory.js — Memory panel
 *
 * Renders memory search results with edit/delete controls, category filtering,
 * and semantic/keyword memory search.
 */
import { $, esc, state } from './clawser-state.js';
import { modal } from './clawser-modal.js';
import { addErrorMsg, updateState } from './clawser-ui-chat.js';

// ── Memory management ──────────────────────────────────────────
/** Render memory search results with edit/delete controls, applying category filter.
 * @param {Array<Object>} results - Memory entries
 * @param {HTMLElement} el - Container element
 */
export function renderMemoryResults(results, el) {
  const catFilter = $('memCatFilter').value;
  if (catFilter) results = results.filter(r => r.category === catFilter);

  el.innerHTML = '';
  if (results.length === 0) { el.textContent = 'No memories found.'; return; }
  for (const r of results) {
    const d = document.createElement('div');
    d.className = 'mem-item';
    const cat = r.category || '';
    const catBadge = cat ? `<span class="mem-cat">${esc(cat)}</span>` : '';
    const score = r.score != null ? `<span class="mem-score">${r.score.toFixed(1)}</span>` : '';
    const ts = r.timestamp ? new Date(r.timestamp).toLocaleDateString() : '';
    d.innerHTML = `
      <div class="mem-header">
        <span class="mem-key">${esc(r.key)}</span>
        ${catBadge}${score}
        <span class="mem-actions">
          <button class="mem-edit" title="Edit">&#x270E;</button>
          <button class="mem-del" title="Delete">&#x2715;</button>
        </span>
      </div>
      <div class="mem-content">${esc(r.content || '')}</div>
      ${ts ? `<div class="mem-date">${ts}</div>` : ''}
    `;

    d.querySelector('.mem-edit').addEventListener('click', () => {
      d.querySelectorAll('.mem-edit-form').forEach(f => f.remove());
      const form = document.createElement('div');
      form.className = 'mem-form mem-edit-form';
      form.innerHTML = `
        <input type="text" class="edit-key" value="${esc(r.key)}" />
        <textarea class="edit-content">${esc(r.content || '')}</textarea>
        <div class="mem-form-row">
          <select class="edit-cat">
            <option value="core"${cat === 'core' ? ' selected' : ''}>core</option>
            <option value="learned"${cat === 'learned' ? ' selected' : ''}>learned</option>
            <option value="user"${cat === 'user' ? ' selected' : ''}>user</option>
            <option value="context"${cat === 'context' ? ' selected' : ''}>context</option>
          </select>
          <button class="btn-sm edit-save">Save</button>
          <button class="btn-sm btn-sm-secondary edit-cancel">Cancel</button>
        </div>
      `;
      form.querySelector('.edit-cancel').addEventListener('click', () => form.remove());
      form.querySelector('.edit-save').addEventListener('click', () => {
        const newKey = form.querySelector('.edit-key').value.trim();
        const newContent = form.querySelector('.edit-content').value.trim();
        const newCat = form.querySelector('.edit-cat').value;
        if (!newKey || !newContent) return;
        state.agent.memoryForget(r.id);
        state.agent.memoryStore({ key: newKey, content: newContent, category: newCat });
        state.agent.persistMemories();
        updateState();
        doMemorySearch();
      });
      d.appendChild(form);
    });

    d.querySelector('.mem-del').addEventListener('click', async () => {
      if (!await modal.confirm(`Delete memory "${r.key}"?`, { danger: true })) return;
      const rc = state.agent.memoryForget(r.id);
      if (rc === 1) {
        state.agent.persistMemories();
        updateState();
        doMemorySearch();
      } else {
        addErrorMsg('Failed to delete memory.');
      }
    });

    el.appendChild(d);
  }
}

/** Execute a memory search using the query input and render results.
 *  When semantic toggle is checked, uses async hybrid search. */
export async function doMemorySearch() {
  if (!state.agent) return;
  const query = $('memQuery').value.trim();
  const semantic = $('memSemanticToggle')?.checked;
  const category = $('memCatFilter').value || undefined;

  if (semantic && query) {
    const el = $('memResults');
    el.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px;">Searching...</div>';
    try {
      const results = await state.agent.memoryRecallAsync(query, { category });
      renderMemoryResults(results, el);
    } catch (e) {
      el.textContent = `Search error: ${e.message}`;
    }
  } else {
    renderMemoryResults(state.agent.memoryRecall(query), $('memResults'));
  }
}
