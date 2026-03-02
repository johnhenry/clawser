// clawser-tab-views.js — Multiple tab views ("pop out" functionality)
//
// Allows popping out individual workspace panels into separate browser tabs.
// Uses window.open() with #workspace/{wsId}/{panel} URL.
// Router detects single-panel mode -> hides sidebar, shows panel full-width.
// Cross-tab sync via BroadcastChannel.

// ── Constants ───────────────────────────────────────────────────

export const TAB_VIEW_CHANNEL = 'clawser-tab-views';

// ── URL helpers ─────────────────────────────────────────────────

/**
 * Parse a tab-view hash to detect single-panel mode.
 * Expects format: #workspace/{wsId}/{panel}
 * @param {string} hash
 * @returns {{ wsId: string, panel: string, singlePanel: boolean }|null}
 */
export function parseTabViewHash(hash) {
  if (!hash) return null;
  const cleaned = hash.replace(/^#\/?/, '');
  if (!cleaned.startsWith('workspace/')) return null;

  const parts = cleaned.slice('workspace/'.length).split('/');
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;

  return {
    wsId: parts[0],
    panel: parts[1],
    singlePanel: true,
  };
}

/**
 * Build a tab-view URL for popping out a panel.
 * @param {string} wsId - Workspace ID
 * @param {string} panel - Panel name
 * @returns {string} Full URL with hash
 */
export function buildTabViewUrl(wsId, panel) {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const pathname = typeof location !== 'undefined' ? location.pathname : '/';
  return `${origin}${pathname}#workspace/${wsId}/${panel}`;
}

// ── TabViewManager ──────────────────────────────────────────────

/**
 * Manages popped-out tab views for workspace panels.
 * Tracks open windows and handles cross-tab sync.
 */
export class TabViewManager {
  /** @type {Array<{ wsId: string, panel: string, win: object|null }>} */
  #views = [];

  /** @type {Function} Overridable window.open for testing */
  _windowOpen = typeof window !== 'undefined' ? (url) => window.open(url) : () => null;

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Get list of currently open views.
   * @returns {Array<{ wsId: string, panel: string }>}
   */
  get openViews() {
    return this.#views.map(v => ({ wsId: v.wsId, panel: v.panel }));
  }

  /**
   * Pop out a panel into a new browser tab/window.
   * @param {string} wsId - Workspace ID
   * @param {string} panel - Panel name (e.g. 'files', 'terminal', 'chat')
   * @returns {object|null} Window reference or null
   */
  popOut(wsId, panel) {
    // Check if already open
    const existing = this.#views.find(v => v.wsId === wsId && v.panel === panel);
    if (existing && existing.win && !existing.win.closed) {
      // Focus existing window
      if (typeof existing.win.focus === 'function') existing.win.focus();
      return existing.win;
    }

    const url = buildTabViewUrl(wsId, panel);
    const win = this._windowOpen(url);

    if (existing) {
      // Close orphaned window before replacing reference
      if (existing.win && !existing.win.closed) {
        try { existing.win.close(); } catch { /* cross-origin */ }
      }
      existing.win = win;
    } else {
      this.#views.push({ wsId, panel, win });
    }

    // Notify other tabs
    this.broadcastSync({ action: 'view-opened', wsId, panel });

    return win;
  }

  /**
   * Close a popped-out view.
   * @param {string} wsId
   * @param {string} panel
   */
  closeView(wsId, panel) {
    const idx = this.#views.findIndex(v => v.wsId === wsId && v.panel === panel);
    if (idx === -1) return;

    const view = this.#views[idx];
    if (view.win && !view.win.closed && typeof view.win.close === 'function') {
      view.win.close();
    }
    this.#views.splice(idx, 1);

    this.broadcastSync({ action: 'view-closed', wsId, panel });
  }

  /**
   * Clean up views whose windows have been closed by the user.
   */
  cleanupClosed() {
    this.#views = this.#views.filter(v => v.win && !v.win.closed);
  }

  /**
   * Check if the current tab is in single-panel mode.
   * @returns {{ wsId: string, panel: string, singlePanel: boolean }|null}
   */
  isSinglePanelMode() {
    if (typeof location === 'undefined') return null;
    return parseTabViewHash(location.hash);
  }

  // ── Cross-tab sync ─────────────────────────────────────────────

  /**
   * Broadcast a sync message to all tabs.
   * @param {object} data - Message data
   */
  broadcastSync(data) {
    try {
      const channel = new BroadcastChannel(TAB_VIEW_CHANNEL);
      channel.postMessage(data);
      channel.close();
    } catch {
      // BroadcastChannel not available
    }
  }

  /**
   * Listen for cross-tab sync messages.
   * @param {Function} handler - (data: object) => void
   * @returns {Function} Cleanup function to stop listening
   */
  onSync(handler) {
    try {
      const channel = new BroadcastChannel(TAB_VIEW_CHANNEL);
      channel.onmessage = (event) => handler(event.data);
      return () => channel.close();
    } catch {
      return () => {};
    }
  }
}
