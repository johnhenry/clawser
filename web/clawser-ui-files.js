/**
 * clawser-ui-files.js — OPFS file browser panel
 *
 * Renders the OPFS file browser for the active workspace with click-to-preview,
 * mount/unmount local directories, mount list rendering, and pagination.
 */
import { $, esc, state } from './clawser-state.js';
import { modal } from './clawser-modal.js';
import { addMsg, addErrorMsg } from './clawser-ui-chat.js';

// ── OPFS file browser ──────────────────────────────────────────
const HIDDEN_DIRS = new Set(['.checkpoints', '.skills', '.conversations']);
const PAGE_SIZE = 50;

/** Render the OPFS file browser for the active workspace, with click-to-preview.
 * @param {string} [path='/'] - Directory path relative to workspace root
 * @param {HTMLElement} [el] - Container element (defaults to #fileList)
 */
export async function refreshFiles(path = '/', el = null) {
  if (!el) el = $('fileList');
  try {
    const root = await navigator.storage.getDirectory();

    let wsDir;
    try {
      const base = await root.getDirectoryHandle('clawser_workspaces');
      const wsId = state.agent?.getWorkspace() || 'default';
      wsDir = await base.getDirectoryHandle(wsId);
    } catch {
      el.textContent = '(empty \u2014 files created by the agent will appear here)';
      return;
    }

    let dir = wsDir;
    if (path !== '/') {
      for (const part of path.replace(/^\//, '').split('/').filter(Boolean)) {
        dir = await dir.getDirectoryHandle(part);
      }
    }
    el.innerHTML = '';
    if (path !== '/') {
      const back = document.createElement('div');
      back.className = 'file-back';
      back.textContent = '.. (back)';
      const parentPath = path.replace(/[^/]+\/$/, '') || '/';
      back.addEventListener('click', () => refreshFiles(parentPath, el));
      el.appendChild(back);
    }

    // Collect all entries first for pagination
    const allEntries = [];
    for await (const [name, handle] of dir) {
      if (path === '/' && HIDDEN_DIRS.has(name)) continue;
      allEntries.push({ name, handle });
    }

    // Sort entries: directories first, then alphabetical
    allEntries.sort((a, b) => {
      if (a.handle.kind !== b.handle.kind) {
        return a.handle.kind === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    if (allEntries.length === 0) {
      el.textContent = '(empty \u2014 files created by the agent will appear here)';
      return;
    }

    // Render paginated entries
    let visibleCount = 0;

    function renderPage(startIdx) {
      const end = Math.min(startIdx + PAGE_SIZE, allEntries.length);
      for (let i = startIdx; i < end; i++) {
        const { name, handle } = allEntries[i];
        visibleCount++;
        const d = document.createElement('div');
        d.className = 'file-item';
        const icon = handle.kind === 'directory' ? '\u{1F4C1}' : '\u{1F4C4}';
        d.textContent = `${icon} ${name}`;
        d.addEventListener('click', async () => {
          if (handle.kind === 'directory') {
            await refreshFiles(`${path}${name}/`, el);
          } else {
            try {
              const file = await handle.getFile();
              if (file.name.endsWith('.bin') || file.name.endsWith('.wasm') || file.size > 100000) {
                el.insertAdjacentHTML('afterbegin',
                  `<div class="file-binary-info">${esc(name)}: ${(file.size / 1024).toFixed(1)} KB (binary)</div>`);
              } else {
                const text = await file.text();
                el.insertAdjacentHTML('afterbegin',
                  `<div class="file-preview"><div class="file-preview-name">${esc(name)}</div>${esc(text.slice(0, 2000))}</div>`);
              }
            } catch (e) { console.debug('[clawser] file preview error', e); }
          }
        });
        // Insert before the load-more button if it exists
        const loadMoreBtn = el.querySelector('.file-load-more');
        if (loadMoreBtn) {
          el.insertBefore(d, loadMoreBtn);
        } else {
          el.appendChild(d);
        }
      }

      // Remove existing load-more button
      const existingBtn = el.querySelector('.file-load-more');
      if (existingBtn) existingBtn.remove();

      // Add "Load more" button if there are more entries
      if (end < allEntries.length) {
        const btn = document.createElement('button');
        btn.className = 'btn-sm file-load-more';
        btn.textContent = `Load more (${allEntries.length - end} remaining)`;
        btn.addEventListener('click', () => renderPage(end));
        el.appendChild(btn);
      }

      // Show count summary
      let summary = el.querySelector('.file-count-summary');
      if (!summary) {
        summary = document.createElement('div');
        summary.className = 'file-count-summary';
        // Insert after back button or at the start
        const backEl = el.querySelector('.file-back');
        if (backEl) {
          backEl.after(summary);
        } else {
          el.insertBefore(summary, el.firstChild);
        }
      }
      summary.textContent = `Showing ${visibleCount} of ${allEntries.length} items`;
    }

    renderPage(0);
  } catch (e) {
    el.textContent = `Error: ${e.message}`;
  }
}

// ── Mount local folder (Block 2) ─────────────────────────────────
/** Prompt user to pick a local directory and mount it into the workspace FS. */
export async function mountLocalFolder() {
  if (!window.showDirectoryPicker) {
    addErrorMsg('showDirectoryPicker not supported in this browser.');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const mountPoint = await modal.prompt('Mount point (under /mnt/):', `/mnt/${handle.name}`);
    if (!mountPoint) return;
    state.workspaceFs.mount(mountPoint, handle);
    renderMountList();
    refreshFiles();
    addMsg('system', `Mounted "${handle.name}" at ${mountPoint}`);
  } catch (e) {
    if (e.name !== 'AbortError') addErrorMsg(`Mount failed: ${e.message}`);
  }
}

/** Render the list of active mounts with unmount buttons. */
export function renderMountList() {
  const el = $('mountList');
  if (!el) return;
  el.innerHTML = '';
  if (!state.workspaceFs?.mountTable) return;
  const mounts = state.workspaceFs.mountTable;
  if (mounts.length === 0) return;
  for (const m of mounts) {
    const d = document.createElement('div');
    d.className = 'mount-item';
    d.innerHTML = `<span class="mount-point">${esc(m.path)}</span><span style="color:var(--dim);font-size:10px;">${esc(m.name)}${m.readOnly ? ' (ro)' : ''}</span>`;
    const btn = document.createElement('button');
    btn.className = 'mount-unmount';
    btn.textContent = '\u2715';
    btn.title = 'Unmount';
    btn.addEventListener('click', () => {
      state.workspaceFs.unmount(m.path);
      renderMountList();
      refreshFiles();
      addMsg('system', `Unmounted ${m.path}`);
    });
    d.appendChild(btn);
    el.appendChild(d);
  }
}
