// clawser-item-bar.js — Unified reusable item bar component
import { esc } from './clawser-state.js';
import { modal } from './clawser-modal.js';

/** Relative time string from timestamp. */
export function _relativeTime(ts) {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/** Trigger file download from text content. */
export function _downloadText(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Create a reusable item bar for managing a list of named items.
 * @param {Object} config
 * @param {string} config.containerId - ID of container element
 * @param {string} config.label - e.g. "Conv" or "Session"
 * @param {string} config.newLabel - e.g. "+ New"
 * @param {string} config.emptyMessage - e.g. "No conversations yet."
 * @param {string} config.defaultName - e.g. "New conversation"
 * @param {() => string|null} config.getActiveName
 * @param {() => string|null} config.getActiveId
 * @param {() => Array<Object>} config.listItems
 * @param {() => Promise<void>} config.onNew
 * @param {(id: string) => Promise<void>} config.onSwitch
 * @param {(id: string, newName: string) => Promise<void>} config.onRename
 * @param {(id: string) => Promise<void>} config.onDelete
 * @param {(() => Promise<void>)|null} [config.onFork]
 * @param {Array<{label: string, fn: () => string, filename: string, mime: string}>|null} [config.exportFormats]
 * @param {(item: Object) => string} config.renderMeta
 * @returns {{refresh: () => void, destroy: () => void}}
 */
export function createItemBar(config) {
  const container = document.getElementById(config.containerId);
  if (!container) throw new Error(`ItemBar: container #${config.containerId} not found`);

  // Build DOM
  container.innerHTML = '';
  const bar = document.createElement('div');
  bar.className = 'item-bar';

  const nameEl = document.createElement('span');
  nameEl.className = 'item-bar-name';

  const newBtn = document.createElement('button');
  newBtn.className = 'item-bar-btn item-bar-new';
  newBtn.title = `New ${config.label.toLowerCase()}`;
  newBtn.textContent = config.newLabel;

  const renameBtn = document.createElement('button');
  renameBtn.className = 'item-bar-btn item-bar-rename';
  renameBtn.title = 'Rename';
  renameBtn.textContent = 'Rename';

  const histBtn = document.createElement('button');
  histBtn.className = 'item-bar-btn item-bar-hist';
  histBtn.title = 'History';
  histBtn.textContent = '\u25BC';

  const dropdown = document.createElement('div');
  dropdown.className = 'item-bar-dropdown';

  bar.appendChild(nameEl);
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  bar.appendChild(spacer);
  bar.appendChild(newBtn);
  bar.appendChild(renameBtn);
  bar.appendChild(histBtn);
  bar.appendChild(dropdown);
  container.appendChild(bar);

  // ── Helpers ──
  function updateName() {
    const name = config.getActiveName() || config.defaultName;
    nameEl.textContent = name;
    nameEl.title = name;
  }

  /** Filter text for dropdown search. */
  let searchFilter = '';

  function renderDropdown() {
    const items = config.listItems();
    const activeId = config.getActiveId();
    dropdown.innerHTML = '';

    // Search/filter input
    const searchRow = document.createElement('div');
    searchRow.className = 'item-bar-search-row';
    searchRow.style.cssText = 'padding:4px;border-bottom:1px solid var(--border,#555);';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'item-bar-search';
    searchInput.placeholder = 'Filter...';
    searchInput.style.cssText = 'width:100%;padding:4px 8px;border:1px solid var(--border,#555);border-radius:4px;background:var(--bg,#1e1e1e);color:var(--text,#ccc);font-size:11px;box-sizing:border-box;outline:none;';
    searchInput.value = searchFilter;
    searchInput.addEventListener('input', () => {
      searchFilter = searchInput.value;
      renderDropdownEntries();
    });
    searchInput.addEventListener('focus', () => { searchInput.style.borderColor = 'var(--accent,#007acc)'; });
    searchInput.addEventListener('blur', () => { searchInput.style.borderColor = 'var(--border,#555)'; });
    searchInput.addEventListener('click', (e) => e.stopPropagation());
    searchRow.appendChild(searchInput);
    dropdown.appendChild(searchRow);

    // Container for entries (rebuilt on filter change)
    const entriesContainer = document.createElement('div');
    entriesContainer.className = 'item-bar-entries';
    dropdown.appendChild(entriesContainer);

    function renderDropdownEntries() {
      entriesContainer.innerHTML = '';

      const filtered = items.filter(item => {
        if (!searchFilter) return true;
        const q = searchFilter.toLowerCase();
        return (item.name || '').toLowerCase().includes(q);
      });

      if (filtered.length === 0) {
        entriesContainer.innerHTML = `<div class="item-bar-empty">${esc(searchFilter ? 'No matches.' : config.emptyMessage)}</div>`;
        return;
      }

      const sorted = [...filtered].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
      for (const item of sorted) {
        const entry = document.createElement('div');
        entry.className = 'item-bar-entry' + (item.id === activeId ? ' active' : '');
        entry.innerHTML = `
          <div class="item-bar-entry-info">
            <span class="item-bar-entry-title">${esc(item.name)}</span>
            <span class="item-bar-entry-meta">${esc(config.renderMeta(item))}</span>
          </div>
          <span class="item-bar-entry-del" title="Delete">\u2715</span>
        `;
        entry.querySelector('.item-bar-entry-info').addEventListener('click', async () => {
          await config.onSwitch(item.id);
          dropdown.classList.remove('visible');
          updateName();
        });
        entry.querySelector('.item-bar-entry-del').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (await modal.confirm(`Delete "${item.name}"?`, { danger: true })) {
            await config.onDelete(item.id);
            renderDropdown();
            updateName();
          }
        });
        entriesContainer.appendChild(entry);
      }
    }

    // Initial render of entries
    renderDropdownEntries();

    // Focus search input after rendering
    setTimeout(() => searchInput.focus(), 0);

    // Action footer (fork + export)
    const hasActions = config.onFork || (config.exportFormats && config.exportFormats.length > 0);
    if (hasActions) {
      const actions = document.createElement('div');
      actions.className = 'item-bar-actions';

      if (config.onFork) {
        const forkBtn = document.createElement('button');
        forkBtn.textContent = `Fork current ${config.label.toLowerCase()}`;
        forkBtn.addEventListener('click', async () => {
          await config.onFork();
          dropdown.classList.remove('visible');
          updateName();
        });
        actions.appendChild(forkBtn);
      }

      if (config.exportFormats) {
        for (const fmt of config.exportFormats) {
          const btn = document.createElement('button');
          btn.textContent = fmt.label;
          btn.addEventListener('click', () => {
            const content = fmt.fn();
            _downloadText(content, fmt.filename, fmt.mime);
            dropdown.classList.remove('visible');
          });
          actions.appendChild(btn);
        }
      }

      dropdown.appendChild(actions);
    }
  }

  // ── Event handlers ──
  newBtn.addEventListener('click', async () => {
    await config.onNew();
    updateName();
  });

  renameBtn.addEventListener('click', async () => {
    const activeId = config.getActiveId();
    if (!activeId) return;
    const currentName = config.getActiveName() || '';
    const newName = await modal.prompt(`Rename ${config.label.toLowerCase()}:`, currentName);
    if (newName === null || !newName.trim()) return;
    await config.onRename(activeId, newName.trim());
    updateName();
  });

  histBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('visible');
    if (dropdown.classList.contains('visible')) {
      searchFilter = ''; // Reset search on open
      renderDropdown();
    }
  });

  // Outside click dismiss
  function onOutsideClick(e) {
    if (!bar.contains(e.target)) {
      dropdown.classList.remove('visible');
    }
  }
  document.addEventListener('click', onOutsideClick);

  // Stop propagation inside dropdown
  dropdown.addEventListener('click', (e) => e.stopPropagation());

  // Initial render
  updateName();

  return {
    refresh() {
      updateName();
      if (dropdown.classList.contains('visible')) renderDropdown();
    },
    destroy() {
      document.removeEventListener('click', onOutsideClick);
      container.innerHTML = '';
    },
  };
}
