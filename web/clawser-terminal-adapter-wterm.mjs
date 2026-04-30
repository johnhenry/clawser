/**
 * clawser-terminal-adapter-wterm.mjs — WTermAdapter
 *
 * Wraps @wterm/dom for ANSI-capable terminal rendering. Lazy-loads wterm
 * and its WASM from esm.sh on first init(). If the CDN is unreachable or
 * WASM fails to load, init() rejects — callers should fall back to
 * CustomDOMAdapter.
 *
 * Best for: WSH PTY sessions, peer terminals, vm-console sessions —
 * anything that emits raw ANSI escape sequences.
 *
 * @example
 * ```js
 * import { WTermAdapter } from './clawser-terminal-adapter-wterm.mjs';
 * import { CustomDOMAdapter } from './clawser-terminal-adapter-dom.mjs';
 *
 * const adapter = new WTermAdapter({ theme: 'dark', scrollback: 2000 });
 * try {
 *   await adapter.init(container);
 *   adapter.onData((data) => ptySession.write(data));
 *   adapter.write('\x1b[32mHello\x1b[0m world\r\n');
 * } catch (err) {
 *   console.warn('wterm failed, falling back to DOM renderer:', err);
 *   const fallback = new CustomDOMAdapter();
 *   await fallback.init(container);
 * }
 * ```
 */

/**
 * CDN URLs for @wterm/dom, tried in order. First success wins.
 * @type {string[]}
 */
const CDN_URLS = [
  'https://esm.sh/@wterm/dom@latest',
  'https://cdn.jsdelivr.net/npm/@wterm/dom@latest/+esm',
];

/**
 * Build a wterm-compatible theme object from clawser's CSS custom properties.
 *
 * @param {'dark'|'light'} scheme — color scheme to resolve
 * @returns {Object} wterm theme config
 *
 * @example
 * ```js
 * const theme = buildWTermTheme('dark');
 * // => { background: '#0d1117', foreground: '#c9d1d9', ... }
 * ```
 */
const buildWTermTheme = (scheme = 'dark') => {
  const root = getComputedStyle(document.documentElement);
  const v = (name) => root.getPropertyValue(name).trim();

  return {
    background: v('--bg') || (scheme === 'dark' ? '#0d1117' : '#ffffff'),
    foreground: v('--text') || (scheme === 'dark' ? '#c9d1d9' : '#1f2328'),
    cursor: v('--accent') || '#58a6ff',
    cursorAccent: v('--bg') || '#0d1117',
    selectionBackground: (v('--accent-dim') || '#1f6feb') + '40',
    black: v('--dim') || '#484f58',
    red: v('--red') || '#f85149',
    green: v('--green') || '#3fb950',
    yellow: v('--orange') || '#d29922',
    blue: v('--accent') || '#58a6ff',
    magenta: v('--purple') || '#bc8cff',
    cyan: '#39c5cf',
    white: v('--text') || '#c9d1d9',
    brightBlack: v('--muted') || '#8b949e',
    brightRed: '#ff7b72',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#ffffff',
  };
};

/**
 * Attempt to load @wterm/dom from CDN, trying each URL in order.
 *
 * @returns {Promise<{ WTerm: Function, InputHandler: Function }>}
 * @throws {Error} if all CDN sources fail
 *
 * @example
 * ```js
 * const { WTerm, InputHandler } = await loadWTerm();
 * ```
 */
const loadWTerm = async () => {
  for (const url of CDN_URLS) {
    try {
      return await import(url);
    } catch { continue; }
  }
  throw new Error('All CDN sources failed for @wterm/dom');
};

export class WTermAdapter {
  #container = null;
  #wterm = null;
  #inputHandler = null;
  #dataCallback = null;
  #resizeCallback = null;
  #resizeObserver = null;
  #options = {};
  #cols = 80;
  #rows = 24;
  #loaded = false;
  #WTermClass = null;
  #InputHandlerClass = null;

  /**
   * @param {import('./clawser-terminal-adapter.mjs').TerminalAdapterOptions} options
   *
   * @example
   * ```js
   * const adapter = new WTermAdapter({ scrollback: 5000, fontSize: 13 });
   * ```
   */
  constructor(options = {}) {
    this.#options = options;
    this.#cols = options.cols ?? 80;
    this.#rows = options.rows ?? 24;
  }

  /**
   * Initialize the wterm renderer. Lazy-loads the module from CDN on first call.
   * Creates a dedicated container div inside the provided parent.
   *
   * @param {HTMLElement} container — parent element for the terminal
   * @param {import('./clawser-terminal-adapter.mjs').TerminalAdapterOptions} [options]
   * @returns {Promise<void>}
   * @throws {Error} if CDN import or WASM init fails
   *
   * @example
   * ```js
   * const adapter = new WTermAdapter();
   * await adapter.init(document.getElementById('terminalOutput'));
   * ```
   */
  init = async (container, options = {}) => {
    Object.assign(this.#options, options);
    this.#container = container;

    // Step 1: Lazy-load wterm from CDN
    if (!this.#loaded) {
      const mod = await loadWTerm();
      this.#WTermClass = mod.WTerm;
      this.#InputHandlerClass = mod.InputHandler;
      this.#loaded = true;
    }

    // Step 2: Create a wrapper div for wterm to render into
    const wtermContainer = document.createElement('div');
    wtermContainer.className = 'wterm-container';
    wtermContainer.style.cssText = 'width:100%;height:100%;overflow:hidden;';

    // Clear the container and insert wterm's div
    container.innerHTML = '';
    container.appendChild(wtermContainer);
    container.classList.add('wterm-active');

    // Step 3: Resolve theme
    const scheme = this.#options.theme ?? 'dark';
    const theme = buildWTermTheme(scheme);

    // Step 4: Create WTerm instance
    this.#wterm = new this.#WTermClass();

    await this.#wterm.init(wtermContainer, {
      cols: this.#cols,
      rows: this.#rows,
      fontSize: this.#options.fontSize ?? 11,
      fontFamily: this.#options.fontFamily
        ?? "'SF Mono','Fira Code','Cascadia Code','JetBrains Mono',monospace",
      theme,
      scrollback: this.#options.scrollback ?? 1000,
    });

    // Step 5: Wire up InputHandler for keyboard events
    this.#inputHandler = new this.#InputHandlerClass();
    this.#inputHandler.focus();

    // Forward keyboard input to the data callback
    wtermContainer.addEventListener('keydown', (e) => {
      if (!this.#dataCallback) return;
      const seq = this.#inputHandler.handleKeyDown(e);
      if (seq) {
        e.preventDefault();
        this.#dataCallback(seq);
      }
    });

    // Forward paste events
    wtermContainer.addEventListener('paste', (e) => {
      if (!this.#dataCallback) return;
      const text = this.#inputHandler.handlePaste(e);
      if (text) {
        e.preventDefault();
        this.#dataCallback(text);
      }
    });

    // Make container focusable
    wtermContainer.tabIndex = 0;

    // Step 6: ResizeObserver for auto-fit
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObserver = new ResizeObserver(this.#handleResize);
      this.#resizeObserver.observe(wtermContainer);
    }
  };

  /**
   * Write data (including ANSI escape sequences) to the terminal.
   *
   * @param {string} data — raw terminal output
   *
   * @example
   * ```js
   * adapter.write('\x1b[32mSuccess\x1b[0m\r\n');
   * ```
   */
  write = (data) => {
    if (!this.#wterm || !data) return;
    this.#wterm.write(data);
  };

  /**
   * Resize the terminal to the given dimensions.
   *
   * @param {number} cols
   * @param {number} rows
   */
  resize = (cols, rows) => {
    this.#cols = cols;
    this.#rows = rows;
    this.#wterm?.resize(cols, rows);
  };

  /**
   * Focus the wterm container.
   */
  focus = () => {
    const el = this.#container?.querySelector('.wterm-container');
    el?.focus();
    this.#inputHandler?.focus();
  };

  /**
   * Destroy the adapter, tearing down wterm, observers, and DOM nodes.
   * Safe to call multiple times.
   */
  destroy = () => {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#inputHandler?.destroy();
    this.#inputHandler = null;
    this.#wterm?.destroy();
    this.#wterm = null;
    if (this.#container) {
      this.#container.classList.remove('wterm-active');
      const wtermEl = this.#container.querySelector('.wterm-container');
      wtermEl?.remove();
    }
    this.#container = null;
  };

  /**
   * Register a callback for user input data.
   * Called when the user types or pastes into the terminal.
   *
   * @param {(data: string) => void} callback
   *
   * @example
   * ```js
   * adapter.onData((data) => virtualTermSession.write(data));
   * ```
   */
  onData = (callback) => {
    this.#dataCallback = callback;
  };

  /**
   * Register a callback for terminal resize events.
   *
   * @param {(cols: number, rows: number) => void} callback
   */
  onResize = (callback) => {
    this.#resizeCallback = callback;
  };

  /**
   * Get current terminal dimensions.
   *
   * @returns {{ cols: number, rows: number }}
   */
  dimensions = () => ({ cols: this.#cols, rows: this.#rows });

  /**
   * Get the adapter type discriminant.
   *
   * @returns {'wterm'}
   */
  type = () => 'wterm';

  // ── Private ────────────────────────────────────────

  #handleResize = (entries) => {
    if (!entries.length || !this.#wterm) return;
    const { width, height } = entries[0].contentRect;

    // Estimate character dimensions from font metrics
    const charWidth = (this.#options.fontSize ?? 11) * 0.6;
    const lineHeight = (this.#options.fontSize ?? 11) * 1.35;
    const newCols = Math.max(Math.floor(width / charWidth), 1);
    const newRows = Math.max(Math.floor(height / lineHeight), 1);

    if (newCols !== this.#cols || newRows !== this.#rows) {
      this.#cols = newCols;
      this.#rows = newRows;
      this.#wterm.resize(newCols, newRows);
      this.#resizeCallback?.(newCols, newRows);
    }
  };
}
