/**
 * clawser-ui-guest-fs.mjs — Guest Linux filesystem browser panel
 *
 * Provides a file-tree browser for the v86 Linux guest. Uses the serial
 * console to run ls/cat/stat commands and parses the output to render
 * a navigable directory tree with file preview, upload (OPFS → guest),
 * and download (guest → OPFS) capabilities.
 *
 * @example
 * ```js
 * import { renderGuestFsPanel, initGuestFsListeners } from './clawser-ui-guest-fs.mjs';
 * renderGuestFsPanel(guestInstance, containerEl);
 * ```
 */

import { esc } from './clawser-state.js';

// ── Constants ──────────────────────────────────────────────────────

const THEME = {
  bg: '#1a1a1c',
  card: '#27272a',
  code: '#232334',
  text: '#e9e9ea',
  textDim: '#a1a1a8',
  accent: '#8c7ae6',
  accentHover: '#a192ea',
  action: '#e67e22',
  actionHover: '#f39c12',
  danger: '#e25f73',
  border: '#393941',
};

// ── Output Parsers ─────────────────────────────────────────────────

/**
 * Parse output from `ls -la` into structured entries.
 * Handles typical Linux ls -la output including symlinks and special files.
 *
 * @param {string} raw - Raw ls -la output from serial console
 * @returns {Array<{ permissions: string, links: number, owner: string, group: string, size: number, date: string, name: string, type: 'file'|'directory'|'symlink'|'other', target?: string }>}
 *
 * @example
 * ```js
 * const entries = parseLsOutput('drwxr-xr-x    2 root root  4096 Jan  1 00:00 bin\n-rw-r--r--    1 root root   123 Jan  1 00:00 file.txt');
 * // => [{ name: 'bin', type: 'directory', ... }, { name: 'file.txt', type: 'file', ... }]
 * ```
 */
export const parseLsOutput = (raw) => {
  const lines = raw.split('\n').filter(l => l.trim());
  const entries = [];

  for (const line of lines) {
    // Skip the "total NNN" line
    if (/^total\s+\d+/i.test(line.trim())) continue;

    // Match ls -la format:
    // drwxr-xr-x    2 root root  4096 Jan  1 00:00 dirname
    // lrwxrwxrwx    1 root root     7 Jan  1 00:00 link -> target
    const match = line.match(
      /^([dlcbsp-][rwxstSTl-]{9})\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\w+\s+\d+\s+[\d:]+)\s+(.+)$/
    );
    if (!match) continue;

    const [, permissions, links, owner, group, size, date, nameRaw] = match;

    // Determine type from first character of permissions
    const typeChar = permissions[0];
    let type = 'file';
    let name = nameRaw;
    let target;

    if (typeChar === 'd') {
      type = 'directory';
    } else if (typeChar === 'l') {
      type = 'symlink';
      const arrowIdx = nameRaw.indexOf(' -> ');
      if (arrowIdx !== -1) {
        name = nameRaw.slice(0, arrowIdx);
        target = nameRaw.slice(arrowIdx + 4);
      }
    } else if (typeChar !== '-') {
      type = 'other';
    }

    // Skip . and .. entries
    if (name === '.' || name === '..') continue;

    entries.push({
      permissions,
      links: parseInt(links, 10),
      owner,
      group,
      size: parseInt(size, 10),
      date: date.trim(),
      name,
      type,
      ...(target !== undefined && { target }),
    });
  }

  return entries;
};

/**
 * Parse `stat` output into structured metadata.
 *
 * @param {string} raw - Raw stat output
 * @returns {{ name: string, size: number, blocks: number, ioBlock: number, type: string, permissions: string, uid: string, gid: string, access: string, modify: string, change: string } | null}
 *
 * @example
 * ```js
 * const info = parseStatOutput(statText);
 * if (info) console.log(info.size, info.type);
 * ```
 */
export const parseStatOutput = (raw) => {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const result = {};

  for (const line of lines) {
    const fileMatch = line.match(/^File:\s*['"]?(.+?)['"]?\s*$/);
    if (fileMatch) { result.name = fileMatch[1]; continue; }

    const sizeMatch = line.match(/Size:\s*(\d+)\s+Blocks:\s*(\d+)\s+IO Block:\s*(\d+)\s+(.+)$/);
    if (sizeMatch) {
      result.size = parseInt(sizeMatch[1], 10);
      result.blocks = parseInt(sizeMatch[2], 10);
      result.ioBlock = parseInt(sizeMatch[3], 10);
      result.type = sizeMatch[4].trim();
      continue;
    }

    const accessMatch = line.match(/^Access:\s*\((\d+\/[^)]+)\)\s+Uid:\s*\(([^)]+)\)\s+Gid:\s*\(([^)]+)\)/);
    if (accessMatch) {
      result.permissions = accessMatch[1];
      result.uid = accessMatch[2].trim();
      result.gid = accessMatch[3].trim();
      continue;
    }

    const timeMatch = line.match(/^(Access|Modify|Change):\s*(.+)$/);
    if (timeMatch) {
      const key = timeMatch[1].toLowerCase();
      result[key] = timeMatch[2].trim();
    }
  }

  return result.name ? result : null;
};

/**
 * Strip ANSI escape sequences and v86 serial artifacts from output.
 *
 * @param {string} raw - Raw serial output
 * @returns {string}
 *
 * @example
 * ```js
 * const clean = stripAnsi('\x1b[32mhello\x1b[0m');
 * // => 'hello'
 * ```
 */
export const stripAnsi = (raw) =>
  raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
     .replace(/\r/g, '');

/**
 * Extract the command output from raw serial data.
 * Strips the echoed command line and the trailing prompt.
 *
 * @param {string} raw - Full serial capture including echo + prompt
 * @param {string} cmd - The command that was sent
 * @returns {string}
 *
 * @example
 * ```js
 * const output = extractCommandOutput('ls -la\r\ntotal 4\r\n# ', 'ls -la');
 * // => 'total 4'
 * ```
 */
export const extractCommandOutput = (raw, cmd) => {
  let cleaned = stripAnsi(raw);
  // Remove echoed command (first line that matches)
  const cmdLine = cmd.trim();
  const lines = cleaned.split('\n');
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().endsWith(cmdLine) || lines[i].trim() === cmdLine) {
      startIdx = i + 1;
      break;
    }
  }
  // Remove trailing prompt lines
  let endIdx = lines.length;
  for (let i = lines.length - 1; i >= startIdx; i--) {
    const trimmed = lines[i].trim();
    if (/^[~\/]?.*[#$]\s*$/.test(trimmed) || trimmed === '') {
      endIdx = i;
    } else {
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n');
};

// ── Panel State ────────────────────────────────────────────────────

/**
 * State manager for the guest filesystem panel.
 *
 * @example
 * ```js
 * const panelState = createGuestFsState();
 * panelState.setCwd('/etc');
 * panelState.setEntries(parsedEntries);
 * ```
 */
export const createGuestFsState = () => {
  let _cwd = '/';
  let _entries = [];
  let _loading = false;
  let _error = null;
  let _preview = null;
  let _history = ['/'];
  const _listeners = new Set();

  const notify = () => {
    for (const fn of _listeners) {
      try { fn(getState()); } catch { /* swallow */ }
    }
  };

  const getState = () => ({
    cwd: _cwd,
    entries: _entries,
    loading: _loading,
    error: _error,
    preview: _preview,
    canGoBack: _history.length > 1,
  });

  return {
    getState,

    subscribe(fn) {
      _listeners.add(fn);
      return () => _listeners.delete(fn);
    },

    setCwd(path) {
      _cwd = path.endsWith('/') ? path : path + '/';
      _history.push(_cwd);
      _preview = null;
      notify();
    },

    setEntries(entries) {
      _entries = entries;
      _loading = false;
      _error = null;
      notify();
    },

    setLoading(loading) {
      _loading = loading;
      if (loading) _error = null;
      notify();
    },

    setError(msg) {
      _error = msg;
      _loading = false;
      notify();
    },

    setPreview(content) {
      _preview = content;
      notify();
    },

    clearPreview() {
      _preview = null;
      notify();
    },

    goBack() {
      if (_history.length > 1) {
        _history.pop();
        _cwd = _history[_history.length - 1];
        _preview = null;
        notify();
        return _cwd;
      }
      return null;
    },

    reset() {
      _cwd = '/';
      _entries = [];
      _loading = false;
      _error = null;
      _preview = null;
      _history = ['/'];
      notify();
    },
  };
};

// ── Guest FS Controller ────────────────────────────────────────────

/**
 * Controller that bridges the panel state with a LinuxGuest instance.
 *
 * @param {import('./clawser-v86-guest.mjs').LinuxGuest} guest
 * @param {ReturnType<typeof createGuestFsState>} panelState
 * @returns {{ navigate: (path: string) => Promise<void>, refresh: () => Promise<void>, viewFile: (name: string) => Promise<void>, statFile: (name: string) => Promise<Object|null>, downloadFile: (name: string) => Promise<string>, uploadFile: (name: string, content: string) => Promise<void> }}
 *
 * @example
 * ```js
 * const ctrl = createGuestFsController(guest, state);
 * await ctrl.navigate('/etc');
 * await ctrl.viewFile('hostname');
 * ```
 */
export const createGuestFsController = (guest, panelState) => {
  const execCmd = async (cmd) => {
    const raw = await guest.sendCommand(cmd);
    return extractCommandOutput(raw, cmd);
  };

  /** Escape a path/filename for safe use in shell commands. */
  const shellEscape = (s) => "'" + s.replace(/'/g, "'\\''") + "'";

  const navigate = async (path) => {
    panelState.setCwd(path);
    panelState.setLoading(true);
    try {
      const output = await execCmd(`ls -la ${shellEscape(path)}`);
      const entries = parseLsOutput(output);
      panelState.setEntries(entries);
    } catch (err) {
      panelState.setError(`Failed to list ${path}: ${err.message}`);
    }
  };

  const refresh = async () => {
    const { cwd } = panelState.getState();
    panelState.setLoading(true);
    try {
      const output = await execCmd(`ls -la ${shellEscape(cwd)}`);
      const entries = parseLsOutput(output);
      panelState.setEntries(entries);
    } catch (err) {
      panelState.setError(`Refresh failed: ${err.message}`);
    }
  };

  const viewFile = async (name) => {
    const { cwd } = panelState.getState();
    const fullPath = `${cwd}${name}`;
    panelState.setLoading(true);
    try {
      const output = await execCmd(`cat ${shellEscape(fullPath)}`);
      panelState.setPreview({ name, path: fullPath, content: output });
      panelState.setLoading(false);
    } catch (err) {
      panelState.setError(`Cannot read ${fullPath}: ${err.message}`);
    }
  };

  const statFile = async (name) => {
    const { cwd } = panelState.getState();
    const fullPath = `${cwd}${name}`;
    try {
      const output = await execCmd(`stat ${shellEscape(fullPath)}`);
      return parseStatOutput(output);
    } catch {
      return null;
    }
  };

  const downloadFile = async (name) => {
    const { cwd } = panelState.getState();
    const fullPath = `${cwd}${name}`;
    const output = await execCmd(`base64 ${shellEscape(fullPath)}`);
    return output.trim();
  };

  const uploadFile = async (name, content) => {
    const { cwd } = panelState.getState();
    const fullPath = `${cwd}${name}`;
    // Encode to base64 and pipe through base64 -d on guest
    const b64 = btoa(content);
    // Split into chunks to avoid serial line-length issues
    const chunkSize = 76;
    const chunks = [];
    for (let i = 0; i < b64.length; i += chunkSize) {
      chunks.push(b64.slice(i, i + chunkSize));
    }
    const heredoc = chunks.join('\n');
    await execCmd(`echo ${shellEscape(heredoc)} | base64 -d > ${shellEscape(fullPath)}`);
  };

  return { navigate, refresh, viewFile, statFile, downloadFile, uploadFile };
};

// ── Render ──────────────────────────────────────────────────────────

/**
 * Format file size for display.
 * @param {number} bytes
 * @returns {string}
 */
const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Get icon for file entry type.
 * @param {string} type
 * @returns {string}
 */
const entryIcon = (type) => {
  switch (type) {
    case 'directory': return '\u{1F4C1}';
    case 'symlink':   return '\u{1F517}';
    case 'other':     return '⚠';
    default:          return '\u{1F4C4}';
  }
};

/**
 * Render the guest filesystem panel into a container element.
 * Call this to build or rebuild the full panel DOM.
 *
 * @param {import('./clawser-v86-guest.mjs').LinuxGuest|null} guest - The guest instance, or null if not running
 * @param {HTMLElement} container - Target container element
 * @param {Object} [options]
 * @param {() => Promise<{name: string, content: string}|null>} [options.pickOpfsFile] - Callback to pick a file from OPFS for upload
 * @param {(name: string, content: string) => Promise<void>} [options.saveToOpfs] - Callback to save content to OPFS
 * @returns {{ destroy: () => void }}
 *
 * @example
 * ```js
 * const panel = renderGuestFsPanel(guest, document.getElementById('guestFsContainer'));
 * // later: panel.destroy();
 * ```
 */
export const renderGuestFsPanel = (guest, container, options = {}) => {
  container.innerHTML = '';

  // No guest running state
  if (!guest || guest.state !== 'running') {
    container.innerHTML = `
      <div style="
        padding: 32px 20px;
        text-align: center;
        color: ${THEME.textDim};
        font-size: 13px;
        background: ${THEME.bg};
        border-radius: 8px;
      ">
        <div style="font-size: 24px; margin-bottom: 12px;">&#x1F5A5;</div>
        <div style="font-weight: 600; color: ${THEME.text}; margin-bottom: 6px;">No guest running</div>
        <div>Boot a v86 Linux guest to browse its filesystem.</div>
      </div>
    `;
    return { destroy: () => {} };
  }

  const panelState = createGuestFsState();
  const ctrl = createGuestFsController(guest, panelState);

  // Build panel DOM
  const panel = document.createElement('div');
  panel.className = 'guest-fs-panel';
  panel.style.cssText = `
    background: ${THEME.bg};
    color: ${THEME.text};
    border-radius: 8px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    overflow: hidden;
  `;

  // ── Toolbar ──
  const toolbar = document.createElement('div');
  toolbar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    background: ${THEME.card};
    border-bottom: 1px solid ${THEME.border};
  `;

  const backBtn = document.createElement('button');
  backBtn.textContent = '←';
  backBtn.title = 'Go back';
  backBtn.style.cssText = btnStyle();
  backBtn.disabled = true;

  const pathDisplay = document.createElement('span');
  pathDisplay.style.cssText = `
    flex: 1;
    font-size: 12px;
    color: ${THEME.textDim};
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `;
  pathDisplay.textContent = '/';

  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = '↻';
  refreshBtn.title = 'Refresh';
  refreshBtn.style.cssText = btnStyle();

  const uploadBtn = document.createElement('button');
  uploadBtn.textContent = '↑ Upload';
  uploadBtn.title = 'Upload file from OPFS to guest';
  uploadBtn.style.cssText = btnStyle(THEME.action);

  const downloadBtn = document.createElement('button');
  downloadBtn.textContent = '↓ Download';
  downloadBtn.title = 'Download selected file to OPFS';
  downloadBtn.style.cssText = btnStyle(THEME.accent);
  downloadBtn.disabled = true;

  toolbar.append(backBtn, pathDisplay, refreshBtn, uploadBtn, downloadBtn);
  panel.appendChild(toolbar);

  // ── File list ──
  const fileListContainer = document.createElement('div');
  fileListContainer.style.cssText = `
    max-height: 360px;
    overflow-y: auto;
    padding: 4px 0;
  `;
  panel.appendChild(fileListContainer);

  // ── Preview area ──
  const previewArea = document.createElement('div');
  previewArea.style.cssText = `display: none;`;
  panel.appendChild(previewArea);

  // ── Status bar ──
  const statusBar = document.createElement('div');
  statusBar.style.cssText = `
    padding: 6px 12px;
    font-size: 11px;
    color: ${THEME.textDim};
    border-top: 1px solid ${THEME.border};
    background: ${THEME.card};
  `;
  statusBar.textContent = 'Ready';
  panel.appendChild(statusBar);

  container.appendChild(panel);

  // ── State → DOM sync ──
  let selectedFile = null;

  const render = (state) => {
    // Path
    pathDisplay.textContent = state.cwd;
    backBtn.disabled = !state.canGoBack;

    // Loading
    if (state.loading) {
      statusBar.textContent = 'Loading...';
      statusBar.style.color = THEME.accent;
    }

    // Error
    if (state.error) {
      statusBar.textContent = state.error;
      statusBar.style.color = THEME.danger;
      return;
    }

    if (state.loading) return;

    statusBar.textContent = `${state.entries.length} items`;
    statusBar.style.color = THEME.textDim;

    // File list
    fileListContainer.innerHTML = '';

    if (state.cwd !== '/') {
      const backEntry = document.createElement('div');
      backEntry.style.cssText = entryRowStyle(false);
      backEntry.textContent = '.. (parent directory)';
      backEntry.addEventListener('click', async () => {
        const parent = state.cwd.replace(/[^/]+\/$/, '') || '/';
        await ctrl.navigate(parent);
      });
      backEntry.addEventListener('mouseenter', () => {
        backEntry.style.background = THEME.card;
      });
      backEntry.addEventListener('mouseleave', () => {
        backEntry.style.background = 'transparent';
      });
      fileListContainer.appendChild(backEntry);
    }

    // Sort: directories first, then alphabetical
    const sorted = [...state.entries].sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      const row = document.createElement('div');
      const isSelected = selectedFile === entry.name;
      row.style.cssText = entryRowStyle(isSelected);

      const icon = document.createElement('span');
      icon.textContent = entryIcon(entry.type);
      icon.style.marginRight = '8px';

      const name = document.createElement('span');
      name.style.cssText = `flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
      name.textContent = entry.name;
      if (entry.type === 'directory') {
        name.style.color = THEME.accent;
        name.style.fontWeight = '600';
      }
      if (entry.type === 'symlink') {
        name.style.fontStyle = 'italic';
        name.textContent += entry.target ? ` → ${entry.target}` : '';
      }

      const size = document.createElement('span');
      size.style.cssText = `font-size: 11px; color: ${THEME.textDim}; margin-left: 8px; white-space: nowrap;`;
      size.textContent = entry.type === 'directory' ? '' : formatSize(entry.size);

      const perms = document.createElement('span');
      perms.style.cssText = `font-size: 10px; color: ${THEME.textDim}; margin-left: 8px; font-family: monospace; white-space: nowrap;`;
      perms.textContent = entry.permissions;

      row.append(icon, name, size, perms);

      row.addEventListener('click', async () => {
        if (entry.type === 'directory') {
          await ctrl.navigate(`${state.cwd}${entry.name}`);
        } else {
          selectedFile = entry.name;
          downloadBtn.disabled = false;
          // Re-render to show selection
          render(panelState.getState());
          // Show file preview
          await ctrl.viewFile(entry.name);
        }
      });

      row.addEventListener('mouseenter', () => {
        if (selectedFile !== entry.name) row.style.background = THEME.card;
      });
      row.addEventListener('mouseleave', () => {
        if (selectedFile !== entry.name) row.style.background = 'transparent';
      });

      fileListContainer.appendChild(row);
    }

    // Preview
    if (state.preview) {
      previewArea.style.display = 'block';
      previewArea.innerHTML = `
        <div style="
          margin: 8px 12px;
          background: ${THEME.code};
          border: 1px solid ${THEME.border};
          border-radius: 8px;
          overflow: hidden;
        ">
          <div style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            border-bottom: 1px solid ${THEME.border};
            font-size: 12px;
            font-weight: 600;
            color: ${THEME.accent};
          ">
            <span>${esc(state.preview.name)}</span>
            <button id="guestFsClosePreview" style="${btnStyle()}">✕</button>
          </div>
          <pre style="
            margin: 0;
            padding: 12px;
            font-size: 12px;
            font-family: monospace;
            color: ${THEME.text};
            overflow-x: auto;
            max-height: 240px;
            overflow-y: auto;
            white-space: pre-wrap;
            word-break: break-all;
          ">${esc(state.preview.content.slice(0, 8000))}</pre>
        </div>
      `;
      previewArea.querySelector('#guestFsClosePreview')?.addEventListener('click', () => {
        panelState.clearPreview();
      });
    } else {
      previewArea.style.display = 'none';
      previewArea.innerHTML = '';
    }
  };

  const unsub = panelState.subscribe(render);

  // ── Event handlers ──
  backBtn.addEventListener('click', async () => {
    const newPath = panelState.goBack();
    if (newPath) {
      selectedFile = null;
      downloadBtn.disabled = true;
      await ctrl.navigate(newPath);
    }
  });

  refreshBtn.addEventListener('click', async () => {
    selectedFile = null;
    downloadBtn.disabled = true;
    await ctrl.refresh();
  });

  uploadBtn.addEventListener('click', async () => {
    if (options.pickOpfsFile) {
      try {
        const file = await options.pickOpfsFile();
        if (file) {
          statusBar.textContent = `Uploading ${file.name}...`;
          statusBar.style.color = THEME.action;
          await ctrl.uploadFile(file.name, file.content);
          statusBar.textContent = `Uploaded ${file.name}`;
          statusBar.style.color = THEME.accent;
          await ctrl.refresh();
        }
      } catch (err) {
        statusBar.textContent = `Upload failed: ${err.message}`;
        statusBar.style.color = THEME.danger;
      }
    } else {
      statusBar.textContent = 'No OPFS file picker configured';
      statusBar.style.color = THEME.danger;
    }
  });

  downloadBtn.addEventListener('click', async () => {
    if (!selectedFile || !options.saveToOpfs) {
      statusBar.textContent = selectedFile ? 'No OPFS save handler configured' : 'No file selected';
      statusBar.style.color = THEME.danger;
      return;
    }
    try {
      statusBar.textContent = `Downloading ${selectedFile}...`;
      statusBar.style.color = THEME.action;
      const b64 = await ctrl.downloadFile(selectedFile);
      const content = atob(b64);
      await options.saveToOpfs(selectedFile, content);
      statusBar.textContent = `Saved ${selectedFile} to OPFS`;
      statusBar.style.color = THEME.accent;
    } catch (err) {
      statusBar.textContent = `Download failed: ${err.message}`;
      statusBar.style.color = THEME.danger;
    }
  });

  // Initial load
  ctrl.navigate('/');

  return {
    destroy: () => {
      unsub();
      container.innerHTML = '';
    },
    state: panelState,
    controller: ctrl,
  };
};

// ── Style helpers ──────────────────────────────────────────────────

/**
 * @param {string} [accentColor]
 * @returns {string}
 */
const btnStyle = (accentColor) => `
  background: ${accentColor ? accentColor : 'transparent'};
  color: ${accentColor ? '#fff' : THEME.text};
  border: 1px solid ${accentColor || THEME.border};
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
`;

/**
 * @param {boolean} selected
 * @returns {string}
 */
const entryRowStyle = (selected) => `
  display: flex;
  align-items: center;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  background: ${selected ? THEME.card : 'transparent'};
  border-left: 3px solid ${selected ? THEME.accent : 'transparent'};
  transition: background 0.1s;
`;
