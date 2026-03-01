// clawser-extension-tools.js — Chrome Extension tools for real browser control
//
// 32 BrowserTool subclasses + ExtensionRpcClient for communicating with
// the Clawser Chrome Extension via postMessage ↔ content.js ↔ background.js.
//
// Tool prefix: ext_  (avoids collision with mock browser_* tools)

import { BrowserTool } from './clawser-tools.js';

// ── RPC Client ────────────────────────────────────────────────────

const MARKER = '__clawser_ext__';
const RPC_TIMEOUT_MS = 30_000;

/**
 * Promise-based RPC client that communicates with the Clawser Chrome Extension.
 * Uses window.postMessage for communication via the content.js relay.
 */
/** content.js announces every 5s; if we don't hear for 10s, consider disconnected. */
const PRESENCE_TIMEOUT_MS = 10_000;

export class ExtensionRpcClient {
  #connected = false;
  #version = null;
  #capabilities = [];
  #pending = new Map(); // id → { resolve, reject, timer }
  #idCounter = 0;
  #listener = null;
  #onStatusChange = null;
  #presenceTimer = null;

  constructor() {
    this.#listener = this.#onMessage.bind(this);
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.#listener);
    }
  }

  /** Set a callback invoked when connection status changes. @param {Function} fn - (connected: boolean) => void */
  set onStatusChange(fn) { this.#onStatusChange = fn; }

  /** Reset the presence watchdog. If no presence arrives within the timeout, mark disconnected. */
  #resetPresenceTimer() {
    clearTimeout(this.#presenceTimer);
    this.#presenceTimer = setTimeout(() => {
      if (this.#connected) {
        this.#connected = false;
        this.#capabilities = [];
        if (this.#onStatusChange) this.#onStatusChange(false);
      }
    }, PRESENCE_TIMEOUT_MS);
  }

  get connected() { return this.#connected; }
  get version() { return this.#version; }
  get capabilities() { return [...this.#capabilities]; }

  /**
   * Send an RPC request to the extension.
   * @param {string} action
   * @param {object} [params]
   * @returns {Promise<any>}
   */
  async call(action, params = {}) {
    if (typeof window === 'undefined') {
      throw new Error('Extension RPC requires a browser environment');
    }

    const id = `rpc_${++this.#idCounter}_${Date.now()}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Extension RPC timeout (${action})`));
      }, RPC_TIMEOUT_MS);

      this.#pending.set(id, { resolve, reject, timer });

      window.postMessage({
        type: MARKER,
        direction: 'request',
        id,
        action,
        params,
      }, '*');
    });
  }

  /**
   * Handle incoming messages from the extension.
   */
  #onMessage(ev) {
    if (ev.source !== window) return;
    const msg = ev.data;
    if (!msg || msg.type !== MARKER) return;

    // Presence announcement
    if (msg.direction === 'presence' && msg.action === 'present') {
      const wasConnected = this.#connected;
      this.#connected = true;
      this.#version = msg.version || null;
      this.#capabilities = msg.capabilities || [];
      this.#resetPresenceTimer();
      if (!wasConnected && this.#onStatusChange) this.#onStatusChange(true);
      return;
    }

    // RPC response
    if (msg.direction === 'response' && msg.id) {
      const entry = this.#pending.get(msg.id);
      if (!entry) return;
      this.#pending.delete(msg.id);
      clearTimeout(entry.timer);

      if (msg.error) {
        entry.reject(new Error(msg.error));
      } else {
        entry.resolve(msg.result);
      }
    }
  }

  /**
   * Destroy the client, removing event listeners.
   */
  destroy() {
    clearTimeout(this.#presenceTimer);
    if (typeof window !== 'undefined' && this.#listener) {
      window.removeEventListener('message', this.#listener);
    }
    for (const { timer, reject } of this.#pending.values()) {
      clearTimeout(timer);
      reject(new Error('RPC client destroyed'));
    }
    this.#pending.clear();
    const wasConnected = this.#connected;
    this.#connected = false;
    if (wasConnected && this.#onStatusChange) this.#onStatusChange(false);
  }
}

// ── Shared singleton ──────────────────────────────────────────────

/** @type {ExtensionRpcClient|null} */
let _client = null;

/** Get or create the shared RPC client. */
export function getExtensionClient() {
  if (!_client) _client = new ExtensionRpcClient();
  return _client;
}

/** Destroy the shared RPC client. */
export function destroyExtensionClient() {
  if (_client) { _client.destroy(); _client = null; }
}

/**
 * Update the extension badge in the header.
 * @param {boolean} connected
 */
export function updateExtensionBadge(connected) {
  const badge = typeof document !== 'undefined' && document.getElementById('extensionBadge');
  if (!badge) return;
  if (connected) {
    badge.textContent = '\u{1F50C} Extension';
    badge.className = 'extension-badge visible connected';
  } else {
    badge.textContent = '';
    badge.className = 'extension-badge';
  }
}

/**
 * Initialize the extension badge — wire the RPC client's status callback.
 * Call once at workspace init.
 */
export function initExtensionBadge() {
  const client = getExtensionClient();
  client.onStatusChange = (connected) => {
    console.log('[clawser-ext] status change:', connected ? 'connected' : 'disconnected');
    updateExtensionBadge(connected);
  };
  // Set initial state
  console.log('[clawser-ext] badge init, connected:', client.connected);
  updateExtensionBadge(client.connected);

  // Expose diagnostic on window for debugging
  if (typeof window !== 'undefined') {
    window.__clawser_ext_diag = () => ({
      connected: client.connected,
      version: client.version,
      capabilities: client.capabilities,
      badge: document.getElementById('extensionBadge')?.className || 'not found',
    });
  }
}

// ── Capability requirements ───────────────────────────────────────

/**
 * Coarse capability names mapped to Chrome APIs:
 *   tabs      → chrome.tabs (tab management, navigation, screenshots)
 *   scripting → chrome.scripting (DOM reading, input, evaluate, console, webmcp)
 *   cookies   → chrome.cookies
 *   network   → chrome.webRequest
 */
const CAPABILITY_HINTS = {
  tabs: 'Ensure the Clawser extension has the "tabs" permission.',
  scripting: 'Ensure the Clawser extension has the "scripting" permission. For full page access, enable "Allow User Scripts" in extension settings.',
  cookies: 'Ensure the Clawser extension has the "cookies" permission.',
  network: 'Ensure the Clawser extension has the "webRequest" permission.',
};

// ── Base helper ───────────────────────────────────────────────────

/**
 * Base class for extension tools — provides the RPC client reference
 * and runtime capability checking.
 */
class ExtTool extends BrowserTool {
  #rpc;
  constructor(rpc) { super(); this.#rpc = rpc; }
  get rpc() { return this.#rpc; }

  /**
   * Capability this tool requires. Override in subclasses.
   * null = only needs connection; 'tabs'|'scripting'|'cookies'|'network' = specific API.
   * @returns {string|null}
   */
  get requires() { return null; }

  /** Call extension action, returning ToolResult. Checks connection and capability first. */
  async _call(action, params = {}) {
    if (!this.#rpc.connected) {
      return { success: false, output: '', error: 'Extension not connected. Install and enable the Clawser Chrome Extension.' };
    }
    const req = this.requires;
    if (req) {
      const caps = this.#rpc.capabilities;
      if (caps.length > 0 && !caps.includes(req)) {
        const hint = CAPABILITY_HINTS[req] || `Enable the "${req}" capability.`;
        return { success: false, output: '', error: `Capability "${req}" not available. ${hint}` };
      }
    }
    try {
      const result = await this.#rpc.call(action, params);
      if (result?.error) return { success: false, output: '', error: result.error };
      return { success: true, output: typeof result === 'string' ? result : JSON.stringify(result, null, 2) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

// ── Status & Info (2) ─────────────────────────────────────────────

export class ExtStatusTool extends ExtTool {
  get name() { return 'ext_status'; }
  get description() { return 'Check Chrome Extension connection status, version, and capabilities.'; }
  get permission() { return 'read'; }
  async execute() {
    if (!this.rpc.connected) {
      return { success: true, output: JSON.stringify({ connected: false, message: 'Extension not detected. Install the Clawser Chrome Extension and reload.' }) };
    }
    return this._call('status');
  }
}

export class ExtCapabilitiesTool extends ExtTool {
  get name() { return 'ext_capabilities'; }
  get description() { return 'List detailed extension capabilities based on granted permissions and toggles.'; }
  get permission() { return 'read'; }
  async execute() { return this._call('capabilities'); }
}

// ── Tab Management (5) ────────────────────────────────────────────

export class ExtTabsListTool extends ExtTool {
  get name() { return 'ext_tabs_list'; }
  get description() { return 'List all open Chrome tabs with id, url, title, active status.'; }
  get permission() { return 'read'; }
  get requires() { return 'tabs'; }
  async execute() { return this._call('tabs_list'); }
}

export class ExtTabOpenTool extends ExtTool {
  get name() { return 'ext_tab_open'; }
  get description() { return 'Open a new Chrome tab with the given URL.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open (default: about:blank)' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'tabs'; }
  async execute({ url } = {}) { return this._call('tab_open', { url }); }
}

export class ExtTabCloseTool extends ExtTool {
  get name() { return 'ext_tab_close'; }
  get description() { return 'Close a Chrome tab by its tab ID.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID to close' },
      },
      required: ['tabId'],
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'tabs'; }
  async execute({ tabId }) { return this._call('tab_close', { tabId }); }
}

export class ExtTabActivateTool extends ExtTool {
  get name() { return 'ext_tab_activate'; }
  get description() { return 'Activate (focus) a Chrome tab and its window.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID to activate' },
      },
      required: ['tabId'],
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'tabs'; }
  async execute({ tabId }) { return this._call('tab_activate', { tabId }); }
}

export class ExtTabReloadTool extends ExtTool {
  get name() { return 'ext_tab_reload'; }
  get description() { return 'Reload a Chrome tab.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID to reload' },
      },
      required: ['tabId'],
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'tabs'; }
  async execute({ tabId }) { return this._call('tab_reload', { tabId }); }
}

// ── Navigation (3) ────────────────────────────────────────────────

export class ExtNavigateTool extends ExtTool {
  get name() { return 'ext_navigate'; }
  get description() { return 'Navigate a Chrome tab to a URL.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        url: { type: 'string', description: 'URL to navigate to' },
      },
      required: ['url'],
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'tabs'; }
  async execute({ tabId, url }) { return this._call('navigate', { tabId, url }); }
}

export class ExtGoBackTool extends ExtTool {
  get name() { return 'ext_go_back'; }
  get description() { return 'Go back in browser history for a tab.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'tabs'; }
  async execute({ tabId } = {}) { return this._call('go_back', { tabId }); }
}

export class ExtGoForwardTool extends ExtTool {
  get name() { return 'ext_go_forward'; }
  get description() { return 'Go forward in browser history for a tab.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'tabs'; }
  async execute({ tabId } = {}) { return this._call('go_forward', { tabId }); }
}

// ── Screenshots & Window (3) ─────────────────────────────────────

export class ExtScreenshotTool extends ExtTool {
  get name() { return 'ext_screenshot'; }
  get description() { return 'Capture a screenshot of the visible tab area. Returns a data URL.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        format: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format (default: png)' },
        quality: { type: 'number', description: 'JPEG quality 0-100 (default: 80)' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'tabs'; }
  async execute({ tabId, format, quality } = {}) {
    return this._call('screenshot', { tabId, format, quality });
  }
}

export class ExtResizeTool extends ExtTool {
  get name() { return 'ext_resize'; }
  get description() { return 'Resize the browser window for a tab.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        width: { type: 'number', description: 'Window width in pixels' },
        height: { type: 'number', description: 'Window height in pixels' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'tabs'; }
  async execute({ tabId, width, height } = {}) {
    return this._call('resize', { tabId, width, height });
  }
}

export class ExtZoomTool extends ExtTool {
  get name() { return 'ext_zoom'; }
  get description() { return 'Capture a screenshot and crop a specific region for closer inspection.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        x: { type: 'number', description: 'Left edge of crop region' },
        y: { type: 'number', description: 'Top edge of crop region' },
        width: { type: 'number', description: 'Width of crop region' },
        height: { type: 'number', description: 'Height of crop region' },
      },
      required: ['x', 'y', 'width', 'height'],
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'tabs'; }
  async execute({ tabId, x, y, width, height }) {
    // Take full screenshot then crop client-side via canvas
    const result = await this.rpc.call('screenshot', { tabId, format: 'png' });
    if (result?.error) return { success: false, output: '', error: result.error };

    // The cropping happens on the web page side (canvas)
    return {
      success: true,
      output: JSON.stringify({
        dataUrl: result.dataUrl,
        crop: { x, y, width, height },
        note: 'Use canvas to crop this region from the full screenshot.',
      }),
    };
  }
}

// ── DOM & Page Reading (4) ────────────────────────────────────────

export class ExtReadPageTool extends ExtTool {
  get name() { return 'ext_read_page'; }
  get description() { return 'Get the accessibility tree of a page — roles, names, refs for interactive elements.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        maxDepth: { type: 'number', description: 'Max DOM depth to traverse (default: 12)' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, maxDepth } = {}) {
    return this._call('read_page', { tabId, maxDepth });
  }
}

export class ExtFindTool extends ExtTool {
  get name() { return 'ext_find'; }
  get description() { return 'Find elements by text content or CSS selector. Returns up to 20 matches with refs.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        query: { type: 'string', description: 'Text to search for (natural language)' },
        selector: { type: 'string', description: 'CSS selector to match' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, query, selector } = {}) {
    return this._call('find', { tabId, query, selector });
  }
}

export class ExtGetTextTool extends ExtTool {
  get name() { return 'ext_get_text'; }
  get description() { return 'Extract the main text content from a page (article/main element or body).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId } = {}) { return this._call('get_text', { tabId }); }
}

export class ExtGetHtmlTool extends ExtTool {
  get name() { return 'ext_get_html'; }
  get description() { return 'Get the outerHTML of an element by CSS selector.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        selector: { type: 'string', description: 'CSS selector for the element (default: html)' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, selector } = {}) {
    return this._call('get_html', { tabId, selector });
  }
}

// ── Input Simulation (9) ─────────────────────────────────────────

export class ExtClickTool extends ExtTool {
  get name() { return 'ext_click'; }
  get description() { return 'Click an element by CSS selector, text content, or coordinates.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        selector: { type: 'string', description: 'CSS selector' },
        text: { type: 'string', description: 'Text content to match' },
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, selector, text, x, y } = {}) {
    return this._call('click', { tabId, selector, text, x, y });
  }
}

export class ExtDoubleClickTool extends ExtTool {
  get name() { return 'ext_double_click'; }
  get description() { return 'Double-click an element.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        selector: { type: 'string', description: 'CSS selector' },
        text: { type: 'string', description: 'Text content to match' },
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, selector, text, x, y } = {}) {
    return this._call('double_click', { tabId, selector, text, x, y });
  }
}

export class ExtTripleClickTool extends ExtTool {
  get name() { return 'ext_triple_click'; }
  get description() { return 'Triple-click an element (selects line/paragraph).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        selector: { type: 'string', description: 'CSS selector' },
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, selector, x, y } = {}) {
    return this._call('triple_click', { tabId, selector, x, y });
  }
}

export class ExtRightClickTool extends ExtTool {
  get name() { return 'ext_right_click'; }
  get description() { return 'Right-click an element to open context menu.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        selector: { type: 'string', description: 'CSS selector' },
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, selector, x, y } = {}) {
    return this._call('right_click', { tabId, selector, x, y });
  }
}

export class ExtHoverTool extends ExtTool {
  get name() { return 'ext_hover'; }
  get description() { return 'Hover over an element to trigger mouseover/mouseenter events.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        selector: { type: 'string', description: 'CSS selector' },
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, selector, x, y } = {}) {
    return this._call('hover', { tabId, selector, x, y });
  }
}

export class ExtDragTool extends ExtTool {
  get name() { return 'ext_drag'; }
  get description() { return 'Drag from one position to another.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        startSelector: { type: 'string', description: 'CSS selector of drag source' },
        startX: { type: 'number', description: 'Start X coordinate' },
        startY: { type: 'number', description: 'Start Y coordinate' },
        endX: { type: 'number', description: 'End X coordinate' },
        endY: { type: 'number', description: 'End Y coordinate' },
      },
      required: ['endX', 'endY'],
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, startSelector, startX, startY, endX, endY }) {
    return this._call('drag', { tabId, startSelector, startX, startY, endX, endY });
  }
}

export class ExtScrollTool extends ExtTool {
  get name() { return 'ext_scroll'; }
  get description() { return 'Scroll the page or an element in a direction.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        selector: { type: 'string', description: 'CSS selector of scroll container (default: window)' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Scroll ticks (1 tick = 100px, default: 3)' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, selector, direction, amount } = {}) {
    return this._call('scroll', { tabId, selector, direction, amount });
  }
}

export class ExtTypeTool extends ExtTool {
  get name() { return 'ext_type'; }
  get description() { return 'Type text into an element. Optionally submit the form.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        selector: { type: 'string', description: 'CSS selector of input element' },
        text: { type: 'string', description: 'Text to type' },
        submit: { type: 'boolean', description: 'Submit form after typing (default: false)' },
      },
      required: ['text'],
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, selector, text, submit }) {
    return this._call('type', { tabId, selector, text, submit });
  }
}

export class ExtKeyTool extends ExtTool {
  get name() { return 'ext_key'; }
  get description() { return 'Press a keyboard key or shortcut (e.g. "Enter", "ctrl+a", "Escape").'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        key: { type: 'string', description: 'Key name or combo (e.g. "Enter", "ctrl+c", "Shift+Tab")' },
      },
      required: ['key'],
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, key }) {
    return this._call('key', { tabId, key });
  }
}

// ── Form (2) ──────────────────────────────────────────────────────

export class ExtFormInputTool extends ExtTool {
  get name() { return 'ext_form_input'; }
  get description() { return 'Set the value of a form input, checkbox, radio, or textarea.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        selector: { type: 'string', description: 'CSS selector of the form element' },
        value: { type: ['string', 'boolean', 'number'], description: 'Value to set' },
      },
      required: ['selector', 'value'],
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, selector, value }) {
    return this._call('form_input', { tabId, selector, value });
  }
}

export class ExtSelectOptionTool extends ExtTool {
  get name() { return 'ext_select_option'; }
  get description() { return 'Select an option in a dropdown by value or text.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        selector: { type: 'string', description: 'CSS selector of the <select> element' },
        value: { type: 'string', description: 'Option value to select' },
        text: { type: 'string', description: 'Option text to select' },
      },
      required: ['selector'],
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, selector, value, text }) {
    return this._call('select_option', { tabId, selector, value, text });
  }
}

// ── Monitoring (2) ────────────────────────────────────────────────

export class ExtConsoleTool extends ExtTool {
  get name() { return 'ext_console'; }
  get description() { return 'Read console log/warn/error entries from a tab. Optionally clear the buffer.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        clear: { type: 'boolean', description: 'Clear the buffer after reading (default: false)' },
      },
    };
  }
  get permission() { return 'read'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, clear } = {}) {
    return this._call('console', { tabId, clear });
  }
}

export class ExtNetworkTool extends ExtTool {
  get name() { return 'ext_network'; }
  get description() { return 'Read recent network requests from a tab. Filter by URL pattern. Optionally clear.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        urlPattern: { type: 'string', description: 'Filter requests by URL substring' },
        clear: { type: 'boolean', description: 'Clear the buffer after reading (default: false)' },
      },
    };
  }
  get permission() { return 'read'; }
  get requires() { return 'network'; }
  async execute({ tabId, urlPattern, clear } = {}) {
    return this._call('network', { tabId, urlPattern, clear });
  }
}

// ── Execution (2) ─────────────────────────────────────────────────

export class ExtEvaluateTool extends ExtTool {
  get name() { return 'ext_evaluate'; }
  get description() { return 'Execute JavaScript in the page context of a tab and return the result.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        script: { type: 'string', description: 'JavaScript code to execute' },
      },
      required: ['script'],
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, script }) {
    return this._call('evaluate', { tabId, script });
  }
}

export class ExtWaitTool extends ExtTool {
  get name() { return 'ext_wait'; }
  get description() { return 'Wait for a CSS selector to appear or a JS condition to become true.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
        selector: { type: 'string', description: 'CSS selector to wait for' },
        condition: { type: 'string', description: 'JS expression that must return true' },
        timeout: { type: 'number', description: 'Timeout in ms (default: 10000)' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId, selector, condition, timeout } = {}) {
    return this._call('wait', { tabId, selector, condition, timeout });
  }
}

// ── Cookies (1) ───────────────────────────────────────────────────

export class ExtCookiesTool extends ExtTool {
  get name() { return 'ext_cookies'; }
  get description() { return 'Read cookies for a given URL.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to get cookies for' },
      },
      required: ['url'],
    };
  }
  get permission() { return 'read'; }
  get requires() { return 'cookies'; }
  async execute({ url }) { return this._call('cookies', { url }); }
}

// ── WebMCP Discovery (1) ─────────────────────────────────────────

export class ExtWebmcpDiscoverTool extends ExtTool {
  get name() { return 'ext_webmcp_discover'; }
  get description() { return 'Discover WebMCP markers on a page: <meta name="webmcp">, <link rel="mcp">, navigator.modelContext, .well-known/mcp.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID (default: active tab)' },
      },
    };
  }
  get permission() { return 'approve'; }
  get requires() { return 'scripting'; }
  async execute({ tabId } = {}) {
    return this._call('webmcp_discover', { tabId });
  }
}

// ── Registration ──────────────────────────────────────────────────

/**
 * Register all 32 extension tools into a BrowserToolRegistry.
 * @param {import('./clawser-tools.js').BrowserToolRegistry} registry
 * @param {ExtensionRpcClient} [rpc] - RPC client (default: shared singleton)
 */
export function registerExtensionTools(registry, rpc) {
  const client = rpc || getExtensionClient();

  // Status (2)
  registry.register(new ExtStatusTool(client));
  registry.register(new ExtCapabilitiesTool(client));

  // Tabs (5)
  registry.register(new ExtTabsListTool(client));
  registry.register(new ExtTabOpenTool(client));
  registry.register(new ExtTabCloseTool(client));
  registry.register(new ExtTabActivateTool(client));
  registry.register(new ExtTabReloadTool(client));

  // Navigation (3)
  registry.register(new ExtNavigateTool(client));
  registry.register(new ExtGoBackTool(client));
  registry.register(new ExtGoForwardTool(client));

  // Screenshots & Window (3)
  registry.register(new ExtScreenshotTool(client));
  registry.register(new ExtResizeTool(client));
  registry.register(new ExtZoomTool(client));

  // DOM (4)
  registry.register(new ExtReadPageTool(client));
  registry.register(new ExtFindTool(client));
  registry.register(new ExtGetTextTool(client));
  registry.register(new ExtGetHtmlTool(client));

  // Input (9)
  registry.register(new ExtClickTool(client));
  registry.register(new ExtDoubleClickTool(client));
  registry.register(new ExtTripleClickTool(client));
  registry.register(new ExtRightClickTool(client));
  registry.register(new ExtHoverTool(client));
  registry.register(new ExtDragTool(client));
  registry.register(new ExtScrollTool(client));
  registry.register(new ExtTypeTool(client));
  registry.register(new ExtKeyTool(client));

  // Form (2)
  registry.register(new ExtFormInputTool(client));
  registry.register(new ExtSelectOptionTool(client));

  // Monitoring (2)
  registry.register(new ExtConsoleTool(client));
  registry.register(new ExtNetworkTool(client));

  // Execution (2)
  registry.register(new ExtEvaluateTool(client));
  registry.register(new ExtWaitTool(client));

  // Cookies (1)
  registry.register(new ExtCookiesTool(client));

  // WebMCP (1)
  registry.register(new ExtWebmcpDiscoverTool(client));
}

/**
 * Create an extension bridge function compatible with AutomationManager.
 * Maps browser_* action names to ext_* RPC calls.
 * @param {ExtensionRpcClient} [rpc]
 * @returns {Function} (action, params) => Promise<result>
 */
export function createExtensionBridge(rpc) {
  const client = rpc || getExtensionClient();

  return async (action, params = {}) => {
    if (!client.connected) {
      return { success: false, output: '', error: 'Extension not connected' };
    }

    // Map browser_* action names to extension action names
    const actionMap = {
      read_page: 'read_page',
      click: 'click',
      fill: 'form_input',
      select: 'select_option',
      scroll: 'scroll',
      wait: 'wait',
      evaluate: 'evaluate',
      screenshot: 'screenshot',
      navigate: 'navigate',
    };

    const extAction = actionMap[action] || action;

    try {
      const result = await client.call(extAction, params);
      if (result?.error) return { success: false, output: '', error: result.error };
      return { success: true, output: typeof result === 'string' ? result : JSON.stringify(result) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  };
}
