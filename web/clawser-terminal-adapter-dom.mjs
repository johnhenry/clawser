/**
 * clawser-terminal-adapter-dom.mjs — CustomDOMAdapter
 *
 * Wraps clawser's existing HTML-div-based terminal renderer behind the
 * TerminalAdapter interface. This adapter renders output as styled DOM
 * elements (.terminal-cmd, .terminal-stdout, .terminal-stderr). It does
 * NOT interpret ANSI escape sequences — output is rendered as plain text
 * with HTML escaping.
 *
 * Best for: local shell sessions where ClawserShell.exec() returns
 * structured { stdout, stderr, exitCode } results.
 *
 * @example
 * ```js
 * import { CustomDOMAdapter } from './clawser-terminal-adapter-dom.mjs';
 *
 * const adapter = new CustomDOMAdapter({ fontSize: 12 });
 * await adapter.init(document.getElementById('terminalOutput'));
 * adapter.write('Hello world\n');
 * adapter.appendHTML('<div class="terminal-cmd">$ ls</div>');
 * ```
 */

/**
 * Escape HTML special characters.
 *
 * @param {string} s — raw text
 * @returns {string} HTML-safe string
 *
 * @example
 * ```js
 * esc('<script>') // => '&lt;script&gt;'
 * ```
 */
const esc = (s) => {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
};

export class CustomDOMAdapter {
  #container = null;
  #inputRow = null;
  #inputEl = null;
  #cwdEl = null;
  #outputEl = null;
  #dataCallback = null;
  #resizeCallback = null;
  #resizeObserver = null;
  #options = {};
  #cols = 80;
  #rows = 24;

  /**
   * @param {import('./clawser-terminal-adapter.mjs').TerminalAdapterOptions} options
   *
   * @example
   * ```js
   * const adapter = new CustomDOMAdapter({ fontSize: 13, cols: 120 });
   * ```
   */
  constructor(options = {}) {
    this.#options = options;
    this.#cols = options.cols ?? 80;
    this.#rows = options.rows ?? 24;
  }

  /**
   * Initialize the adapter. Attaches to or creates the output element
   * inside the given container.
   *
   * @param {HTMLElement} container — parent element for the terminal
   * @param {import('./clawser-terminal-adapter.mjs').TerminalAdapterOptions} [options]
   * @returns {Promise<void>}
   *
   * @example
   * ```js
   * const adapter = new CustomDOMAdapter();
   * await adapter.init(document.getElementById('terminalOutput'));
   * ```
   */
  init = async (container, options = {}) => {
    Object.assign(this.#options, options);
    this.#container = container;

    // Reuse existing output element if present, otherwise create one
    this.#outputEl = container.querySelector('.terminal-output')
      || container.querySelector('#terminalOutput');

    if (!this.#outputEl) {
      // If the container itself is the output element, use it directly
      if (container.classList?.contains('terminal-output') || container.id === 'terminalOutput') {
        this.#outputEl = container;
      } else {
        this.#outputEl = document.createElement('div');
        this.#outputEl.className = 'panel-body panel-mono terminal-output';
        this.#outputEl.setAttribute('aria-live', 'polite');
        this.#outputEl.setAttribute('aria-label', 'Terminal output');
        container.appendChild(this.#outputEl);
      }
    }

    // Apply font options
    if (this.#options.fontSize) {
      this.#outputEl.style.fontSize = `${this.#options.fontSize}px`;
    }
    if (this.#options.fontFamily) {
      this.#outputEl.style.fontFamily = this.#options.fontFamily;
    }

    // Locate input row if it exists in the container's parent panel
    this.#inputRow = container.closest?.('.panel')?.querySelector('.terminal-input-row');
    this.#inputEl = this.#inputRow?.querySelector('.terminal-input');
    this.#cwdEl = this.#inputRow?.querySelector('.terminal-cwd');

    // Wire up input events
    if (this.#inputEl) {
      this.#inputEl.addEventListener('keydown', this.#handleKeyDown);
    }

    // Observe container resizes (only if ResizeObserver available)
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObserver = new ResizeObserver(this.#handleResize);
      this.#resizeObserver.observe(this.#outputEl);
    }
  };

  /**
   * Write plain text to the terminal output.
   * For ANSI-containing output, text is rendered as-is (no escape interpretation).
   *
   * @param {string} data — text to append
   *
   * @example
   * ```js
   * adapter.write('file1.txt\nfile2.txt\n');
   * ```
   */
  write = (data) => {
    if (!this.#outputEl || !data) return;
    this.appendHTML(`<div class="terminal-stdout">${esc(data)}</div>`);
  };

  /**
   * Append raw HTML to the output element. This is the primary rendering
   * method used by terminalExec() and replayTerminalSession().
   *
   * @param {string} html — HTML string to insert
   *
   * @example
   * ```js
   * adapter.appendHTML('<div class="terminal-cmd">$ ls -la</div>');
   * adapter.appendHTML('<div class="terminal-stdout">total 42</div>');
   * ```
   */
  appendHTML = (html) => {
    if (!this.#outputEl) return;
    this.#outputEl.insertAdjacentHTML('beforeend', html);
    this.#outputEl.scrollTop = this.#outputEl.scrollHeight;
  };

  /**
   * Clear all output from the terminal.
   *
   * @example
   * ```js
   * adapter.clear(); // terminal is now empty
   * ```
   */
  clear = () => {
    if (this.#outputEl) this.#outputEl.innerHTML = '';
  };

  /**
   * Update the CWD display in the input row.
   *
   * @param {string} cwd — current working directory path
   *
   * @example
   * ```js
   * adapter.setCwd('/home/user/projects');
   * ```
   */
  setCwd = (cwd) => {
    if (this.#cwdEl) this.#cwdEl.textContent = cwd || '~';
  };

  /**
   * Resize the terminal to the given dimensions.
   * The custom DOM renderer doesn't use cols/rows for layout (it's a scrolling div),
   * but stores them for dimensions() and resize callbacks.
   *
   * @param {number} cols
   * @param {number} rows
   */
  resize = (cols, rows) => {
    this.#cols = cols;
    this.#rows = rows;
  };

  /**
   * Focus the terminal input element.
   */
  focus = () => {
    this.#inputEl?.focus();
  };

  /**
   * Destroy the adapter, removing event listeners and observers.
   * Safe to call multiple times.
   */
  destroy = () => {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    if (this.#inputEl) {
      this.#inputEl.removeEventListener('keydown', this.#handleKeyDown);
    }
    this.#container = null;
    this.#outputEl = null;
    this.#inputEl = null;
    this.#cwdEl = null;
  };

  /**
   * Register a callback for user input data.
   * Called when the user submits a command via the input field.
   *
   * @param {(data: string) => void} callback
   *
   * @example
   * ```js
   * adapter.onData((cmd) => shell.exec(cmd));
   * ```
   */
  onData = (callback) => {
    this.#dataCallback = callback;
  };

  /**
   * Register a callback for terminal resize events.
   *
   * @param {(cols: number, rows: number) => void} callback
   *
   * @example
   * ```js
   * adapter.onResize((cols, rows) => pty.resize(cols, rows));
   * ```
   */
  onResize = (callback) => {
    this.#resizeCallback = callback;
  };

  /**
   * Get current terminal dimensions.
   *
   * @returns {{ cols: number, rows: number }}
   *
   * @example
   * ```js
   * const { cols, rows } = adapter.dimensions();
   * // => { cols: 80, rows: 24 }
   * ```
   */
  dimensions = () => ({ cols: this.#cols, rows: this.#rows });

  /**
   * Get the adapter type discriminant.
   *
   * @returns {'custom-dom'}
   */
  type = () => 'custom-dom';

  // ── Private ────────────────────────────────────────

  #handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      const cmd = this.#inputEl.value;
      this.#inputEl.value = '';
      if (this.#dataCallback && cmd.trim()) {
        this.#dataCallback(cmd);
      }
    }
  };

  #handleResize = (entries) => {
    if (!entries.length) return;
    const { width, height } = entries[0].contentRect;
    // Estimate cols/rows from pixel dimensions
    const charWidth = 7.2;  // approximate for 11px monospace
    const lineHeight = 15;
    const newCols = Math.floor(width / charWidth) || 80;
    const newRows = Math.floor(height / lineHeight) || 24;
    if (newCols !== this.#cols || newRows !== this.#rows) {
      this.#cols = newCols;
      this.#rows = newRows;
      this.#resizeCallback?.(newCols, newRows);
    }
  };
}
