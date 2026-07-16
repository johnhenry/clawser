# wterm Integration Plan — Optional Terminal Rendering Layer for Clawser

> **Status:** Partially shipped. Verified 2026-05-02, re-checked 2026-07-16.
> Three modules exist in production: `web/clawser-terminal-adapter.mjs`,
> `web/clawser-terminal-adapter-dom.mjs`, `web/clawser-terminal-adapter-wterm.mjs`.
> `clawser-ui-panels.js` imports `createAdapter` and `detectAdapterType` and uses them
> inside `resolveAdapterForSession()`/`initTerminalAdapter()`/`terminalAppend()`.
> **However, `initTerminalAdapter()` is never called from any other module** — grep
> across `web/` turns up zero call sites, only its own JSDoc example and a code
> comment in `clawser-reactive-config.mjs`. `state.terminalAdapter` therefore stays
> `null` at runtime, so `terminalAppend()` always takes its "no adapter" fallback
> branch (identical to pre-migration direct-DOM rendering) and wterm is never
> actually activated in the running app today. Separately, the §7.5/§7.6 `onOutput`
> hook this plan describes for `VirtualTerminalSession`/`VirtualTerminalManager` was
> never added — `onOutput` does not appear anywhere in
> `clawser-wsh-virtual-terminal-session.js` or `clawser-wsh-virtual-terminal-manager.js`,
> and `clawser-wsh-incoming.js`'s `openChannel()` call site passes no such callback —
> so even a wired-up adapter would have no route to remote WSH PTY output. In short:
> the adapter interface and both concrete adapters are built and spec-compliant, but
> the activation wiring in §7.3/§7.5/§7.6 is still only a plan, not shipped code.
> **Author:** Generated from architecture review.
> **Date:** 2026-04-29 (plan).
> **Scope:** Add wterm as an optional renderer alongside the existing custom DOM renderer.
> **Principle:** Additive only — no existing functionality removed or broken.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture](#2-current-architecture)
3. [TerminalAdapter Interface Design](#3-terminaladapter-interface-design)
4. [CustomDOMAdapter Implementation](#4-customdomadapter-implementation)
5. [WTermAdapter Implementation](#5-wtermadapter-implementation)
6. [Configuration System](#6-configuration-system)
7. [Integration Points — File-by-File Changes](#7-integration-points--file-by-file-changes)
8. [Data Flow Diagrams](#8-data-flow-diagrams)
9. [Testing Plan](#9-testing-plan)
10. [Rollout Plan](#10-rollout-plan)
11. [Risk Assessment](#11-risk-assessment)
12. [Estimated Effort](#12-estimated-effort)

---

## 1. Executive Summary

Clawser has a fully custom terminal stack: `ClawserShell` (tokenizer, parser, ~30 builtins, OPFS filesystem), `VirtualTerminalSession` (PTY/exec emulation), `VirtualTerminalManager` (multi-peer context management), and a custom DOM renderer in `clawser-ui-panels.js` that renders output as styled `<div>` elements.

This plan adds **wterm** (`@wterm/dom`) as an alternative rendering backend. The custom DOM renderer works well for the local shell (structured HTML output with click-to-fork, agent mode badges, etc.), but falls short for WSH remote PTY sessions and peer terminals that emit raw ANSI escape sequences. wterm handles ANSI natively — colors, cursor positioning, alternate screen buffer, scrollback — because it's a real terminal emulator backed by WASM.

The two renderers coexist behind a shared `TerminalAdapter` interface. The system auto-selects which one to use based on session type, with manual override available in config.

---

## 2. Current Architecture

### 2.1 File Map

```
web/
├── clawser-shell.js                        # Shell engine: tokenizer, parser, executor, ~30 builtins
├── clawser-terminal-sessions.js            # TerminalSessionManager: CRUD, OPFS persistence, event log
├── clawser-terminal-session-store.js       # TerminalSessionStore: event recording, state serialization
├── clawser-wsh-virtual-terminal-session.js # VirtualTerminalSession: char-by-char PTY emulation
├── clawser-wsh-virtual-terminal-manager.js # VirtualTerminalManager: multi-peer channel management
├── clawser-peer-terminal.js                # TerminalHost/TerminalClient: remote command execution
├── clawser-ui-panels.js                    # UI rendering: terminalAppend(), terminalExec(), etc.
├── clawser-state.js                        # Global state + lsKey helpers
├── clawser-ui-config.js                    # Config panel rendering
├── index.html                              # Terminal panel DOM structure
└── clawser.css                             # Terminal styling (CSS custom properties)
```

### 2.2 Current Terminal Panel DOM

From `index.html` (lines 299–309):

```html
<div class="panel" id="panelTerminal">
  <div class="panel-header">
    Terminal
    <div id="termSessionBarContainer" class="item-bar-container"></div>
  </div>
  <div class="panel-body panel-mono terminal-output" id="terminalOutput"
       aria-live="polite" aria-label="Terminal output"></div>
  <div class="terminal-input-row">
    <span class="terminal-cwd" id="terminalCwd">~</span>
    <input type="text" id="terminalInput" class="terminal-input"
           placeholder="$ command..." aria-label="Terminal command input" />
  </div>
</div>
```

### 2.3 Current Rendering Flow

The custom DOM renderer operates via `terminalAppend(html)` in `clawser-ui-panels.js`:

```js
// Line 510-515
export function terminalAppend(html) {
  const el = $('terminalOutput');
  if (!el) return;
  el.insertAdjacentHTML('beforeend', html);
  el.scrollTop = el.scrollHeight;
}
```

Output is rendered as structured HTML divs with CSS classes:
- `.terminal-cmd` — command echo (accent color)
- `.terminal-stdout` — standard output (text color)
- `.terminal-stderr` — error output (red)

This works for the local shell because `ClawserShell.exec()` returns `{ stdout, stderr, exitCode }` — plain text, no ANSI escapes.

### 2.4 WSH PTY Data Flow (Current)

`VirtualTerminalSession` (line 477-487) sends output via `#sendText()`:

```js
async #sendText(text) {
  const normalized = normalizeTerminalText(text);
  const data = textEncoder.encode(normalized);
  this.#replay = trimReplay(this.#replay + normalized, this.#replayLimit);
  await this.#sendControl(sessionDataMsg({ channelId, data }));
  await this.#emitTermFrame(data);
}
```

This emits raw terminal data (including ANSI escapes from remote shells) over WSH channels. Currently, this data reaches the remote peer but the **local** panel only renders structured HTML. There is no path to render raw ANSI output in the local DOM renderer — that's the gap wterm fills.

### 2.5 CSS Custom Properties (Theme)

From `clawser.css` (lines 2-6):

```css
:root {
  --bg: #0d1117;    --surface: #161b22;   --surface2: #1c2129;
  --border: #30363d; --text: #c9d1d9;     --muted: #8b949e;    --dim: #484f58;
  --accent: #58a6ff; --accent-dim: #1f6feb; --green: #3fb950;
  --red: #f85149;    --orange: #d29922;    --purple: #bc8cff;
  --mono: 'SF Mono','Fira Code','Cascadia Code','JetBrains Mono',monospace;
}
```

Light theme overrides exist at lines 930-941. Both must be mapped to wterm's theme config.

---

## 3. TerminalAdapter Interface Design

### 3.1 Interface Contract

File: `web/clawser-terminal-adapter.mjs`

```js
/**
 * TerminalAdapter — abstract interface for terminal rendering backends.
 *
 * Both the custom DOM renderer and wterm implement this interface.
 * Consumers interact only with the adapter, never with the underlying
 * renderer directly.
 *
 * @example
 * ```js
 * import { createAdapter } from './clawser-terminal-adapter.mjs';
 *
 * const adapter = createAdapter('wterm', {
 *   theme: 'dark',
 *   fontSize: 11,
 *   fontFamily: "'SF Mono', monospace",
 * });
 *
 * await adapter.init(document.getElementById('terminalOutput'));
 * adapter.onData((data) => session.write(data));
 * adapter.write('Hello, terminal!\r\n');
 * adapter.focus();
 * ```
 */

/**
 * @typedef {Object} TerminalAdapterOptions
 * @property {'dark'|'light'} [theme='dark'] — color scheme
 * @property {number} [fontSize=11] — font size in px
 * @property {string} [fontFamily] — CSS font-family string
 * @property {number} [cols=80] — initial column count
 * @property {number} [rows=24] — initial row count
 * @property {number} [scrollback=1000] — scrollback buffer lines (wterm only)
 */

/**
 * @typedef {Object} TerminalAdapter
 * @property {(container: HTMLElement, options?: TerminalAdapterOptions) => Promise<void>} init
 * @property {(data: string) => void} write
 * @property {(cols: number, rows: number) => void} resize
 * @property {() => void} focus
 * @property {() => void} destroy
 * @property {(callback: (data: string) => void) => void} onData
 * @property {(callback: (cols: number, rows: number) => void) => void} onResize
 * @property {() => { cols: number, rows: number }} dimensions
 * @property {() => string} type — 'custom-dom' | 'wterm'
 */

/**
 * Create a TerminalAdapter of the specified type.
 *
 * @param {'custom-dom'|'wterm'} type — renderer backend
 * @param {TerminalAdapterOptions} [options={}] — adapter options
 * @returns {TerminalAdapter}
 *
 * @example
 * ```js
 * const adapter = createAdapter('wterm');
 * await adapter.init(container);
 * ```
 */
export const createAdapter = (type, options = {}) => {
  switch (type) {
    case 'wterm':
      return new WTermAdapter(options);
    case 'custom-dom':
    default:
      return new CustomDOMAdapter(options);
  }
};

/**
 * Determine the best adapter type for a given session.
 *
 * @param {Object} session — session metadata
 * @param {string} session.kind — 'pty' | 'exec' | 'local'
 * @param {string} [session.shellBackend] — 'virtual-shell' | 'vm-console'
 * @param {boolean} [session.isRemote=false] — true for WSH/peer sessions
 * @param {string} [override] — manual override from config
 * @returns {'custom-dom'|'wterm'}
 *
 * @example
 * ```js
 * const type = detectAdapterType({ kind: 'pty', isRemote: true });
 * // => 'wterm'
 *
 * const type2 = detectAdapterType({ kind: 'local' });
 * // => 'custom-dom'
 * ```
 */
export const detectAdapterType = (session, override = null) => {
  // Manual override always wins
  if (override === 'wterm' || override === 'custom-dom') return override;

  // Remote sessions and PTY sessions benefit from wterm
  if (session.isRemote) return 'wterm';
  if (session.kind === 'pty') return 'wterm';
  if (session.kind === 'exec') return 'wterm';
  if (session.shellBackend === 'vm-console') return 'wterm';

  // Local shell sessions use the custom DOM renderer
  return 'custom-dom';
};
```

### 3.2 Design Rationale

The adapter is a plain object contract, not a class hierarchy. Both adapters are concrete classes that satisfy the same shape. `createAdapter()` is the factory. `detectAdapterType()` encodes the auto-selection logic.

Key decisions:

- **`onData` is a single callback setter**, not an EventEmitter — matches wterm's InputHandler pattern and keeps the interface minimal. If multiple listeners are needed later, the adapter can internally fan out.
- **`dimensions()` returns current cols/rows** — needed by `VirtualTerminalSession.resize()` and `TerminalClient.sendResize()`.
- **`type()` returns a string discriminant** — allows UI code to conditionally render features only available in one renderer (e.g., click-to-fork only works in custom-dom).
- **`init()` is async** — wterm needs to load WASM; custom-dom can resolve immediately.
- **No `clear()` method** — `destroy()` + re-`init()` handles it. The custom-dom adapter can also implement an internal `clear()` for the `__clearTerminal` flag.

---

## 4. CustomDOMAdapter Implementation

File: `web/clawser-terminal-adapter-dom.mjs`

This adapter wraps the existing rendering logic from `clawser-ui-panels.js` behind the `TerminalAdapter` interface. No rendering behavior changes — it's a refactor into the adapter shape.

```js
/**
 * CustomDOMAdapter — wraps clawser's existing HTML-div-based terminal renderer.
 *
 * This adapter renders output as styled DOM elements (.terminal-cmd, .terminal-stdout,
 * .terminal-stderr). It does NOT interpret ANSI escape sequences — output is rendered
 * as plain text with HTML escaping.
 *
 * Best for: local shell sessions where ClawserShell.exec() returns structured
 * { stdout, stderr, exitCode } results.
 *
 * @example
 * ```js
 * const adapter = new CustomDOMAdapter({ fontSize: 12 });
 * await adapter.init(document.getElementById('terminalOutput'));
 * adapter.write('Hello world\n');
 * adapter.appendHTML('<div class="terminal-cmd">$ ls</div>');
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
   */
  init = async (container, options = {}) => {
    Object.assign(this.#options, options);
    this.#container = container;

    // Reuse existing output element if present, otherwise create one
    this.#outputEl = container.querySelector('.terminal-output')
      || container.querySelector('#terminalOutput');

    if (!this.#outputEl) {
      this.#outputEl = document.createElement('div');
      this.#outputEl.className = 'panel-body panel-mono terminal-output';
      this.#outputEl.setAttribute('aria-live', 'polite');
      this.#outputEl.setAttribute('aria-label', 'Terminal output');
      container.appendChild(this.#outputEl);
    }

    // Apply font options
    if (this.#options.fontSize) {
      this.#outputEl.style.fontSize = `${this.#options.fontSize}px`;
    }
    if (this.#options.fontFamily) {
      this.#outputEl.style.fontFamily = this.#options.fontFamily;
    }

    // Locate input row if it exists in the container's parent panel
    this.#inputRow = container.closest('.panel')?.querySelector('.terminal-input-row');
    this.#inputEl = this.#inputRow?.querySelector('.terminal-input');
    this.#cwdEl = this.#inputRow?.querySelector('.terminal-cwd');

    // Wire up input events
    if (this.#inputEl) {
      this.#inputEl.addEventListener('keydown', this.#handleKeyDown);
    }

    // Observe container resizes
    this.#resizeObserver = new ResizeObserver(this.#handleResize);
    this.#resizeObserver.observe(this.#outputEl);
  };

  /**
   * Write plain text to the terminal output.
   * For ANSI-containing output, text is rendered as-is (no escape interpretation).
   *
   * @param {string} data — text to append
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
   */
  appendHTML = (html) => {
    if (!this.#outputEl) return;
    this.#outputEl.insertAdjacentHTML('beforeend', html);
    this.#outputEl.scrollTop = this.#outputEl.scrollHeight;
  };

  /**
   * Clear all output from the terminal.
   */
  clear = () => {
    if (this.#outputEl) this.#outputEl.innerHTML = '';
  };

  /**
   * Update the CWD display in the input row.
   * @param {string} cwd
   */
  setCwd = (cwd) => {
    if (this.#cwdEl) this.#cwdEl.textContent = cwd || '~';
  };

  resize = (cols, rows) => {
    this.#cols = cols;
    this.#rows = rows;
    // Custom DOM renderer doesn't use cols/rows for layout —
    // it's a scrolling div. But we store them for dimensions().
  };

  focus = () => {
    this.#inputEl?.focus();
  };

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
   * @returns {{ cols: number, rows: number }}
   */
  dimensions = () => ({ cols: this.#cols, rows: this.#rows });

  /**
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
```

### 4.1 Migration Notes for terminalAppend/terminalExec

The existing `terminalAppend()` global function in `clawser-ui-panels.js` becomes a thin proxy to the active adapter:

```js
// In clawser-ui-panels.js — after migration
export const terminalAppend = (html) => {
  const adapter = state.terminalAdapter;
  if (!adapter) return;

  if (adapter.type() === 'custom-dom') {
    adapter.appendHTML(html);
  } else {
    // wterm adapter — strip HTML, write as plain text
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    adapter.write(tmp.textContent || '');
  }
};
```

This preserves backward compatibility: all existing callers of `terminalAppend()` continue to work regardless of which adapter is active.

---

## 5. WTermAdapter Implementation

File: `web/clawser-terminal-adapter-wterm.mjs`

```js
/**
 * WTermAdapter — wraps @wterm/dom for ANSI-capable terminal rendering.
 *
 * Lazy-loads wterm and its WASM from esm.sh on first init(). If the CDN
 * is unreachable or WASM fails to load, init() rejects — callers should
 * fall back to CustomDOMAdapter.
 *
 * Best for: WSH PTY sessions, peer terminals, vm-console sessions — anything
 * that emits raw ANSI escape sequences.
 *
 * @example
 * ```js
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

const WTERM_CDN_URL = 'https://esm.sh/@wterm/dom@latest';

/**
 * Build a wterm-compatible theme object from clawser's CSS custom properties.
 *
 * @param {'dark'|'light'} scheme
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
   */
  init = async (container, options = {}) => {
    Object.assign(this.#options, options);
    this.#container = container;

    // Step 1: Lazy-load wterm from CDN
    if (!this.#loaded) {
      try {
        const mod = await import(WTERM_CDN_URL);
        this.#WTermClass = mod.WTerm;
        this.#InputHandlerClass = mod.InputHandler;
        this.#loaded = true;
      } catch (err) {
        throw new Error(`Failed to load wterm from CDN: ${err.message}`);
      }
    }

    // Step 2: Create a wrapper div for wterm to render into
    const wtermContainer = document.createElement('div');
    wtermContainer.className = 'wterm-container';
    wtermContainer.style.cssText = `
      width: 100%;
      height: 100%;
      overflow: hidden;
    `;

    // Clear the container and insert wterm's div
    container.innerHTML = '';
    container.appendChild(wtermContainer);

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
    this.#resizeObserver = new ResizeObserver(this.#handleResize);
    this.#resizeObserver.observe(wtermContainer);
  };

  /**
   * Write data (including ANSI escape sequences) to the terminal.
   *
   * @param {string} data — raw terminal output
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

  focus = () => {
    const el = this.#container?.querySelector('.wterm-container');
    el?.focus();
    this.#inputHandler?.focus();
  };

  destroy = () => {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#inputHandler?.destroy();
    this.#inputHandler = null;
    this.#wterm?.destroy();
    this.#wterm = null;
    if (this.#container) {
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
   * @returns {{ cols: number, rows: number }}
   */
  dimensions = () => ({ cols: this.#cols, rows: this.#rows });

  /**
   * @returns {'wterm'}
   */
  type = () => 'wterm';

  // ── Private ────────────────────────────────────────

  #handleResize = (entries) => {
    if (!entries.length || !this.#wterm) return;
    const { width, height } = entries[0].contentRect;

    // Estimate character dimensions from wterm's font metrics
    // wterm may expose these; fall back to estimation
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
```

### 5.1 CDN Import Strategy

wterm loads from `https://esm.sh/@wterm/dom@latest`. The import is lazy — it only fires when a session actually needs the wterm renderer. This means:

- Zero cost for users who only use the local shell
- WASM is fetched and compiled once, cached by the browser
- The import map in `index.html` does NOT need a static entry (dynamic import bypasses import maps)

However, for version pinning and auditability, we **should** add an import map entry:

```json
"@wterm/dom": "https://esm.sh/@wterm/dom@0.x.y"
```

Replace `0.x.y` with the actual stable version once the CDN URL is pinned.

### 5.2 WASM Loading Details

wterm's WASM binary loads automatically when `WTerm.init()` is called. esm.sh serves the WASM alongside the JS module. There's no separate WASM URL to configure — this is handled internally by the `@wterm/dom` package.

If WASM fails to load (network error, CSP violation, browser doesn't support WASM), `init()` will throw. The calling code catches this and falls back to `CustomDOMAdapter`.

---

## 6. Configuration System

### 6.1 localStorage Key

Add a new key to `lsKey` in `clawser-state.js`:

```js
// In clawser-state.js, add to lsKey object (after line 89):
terminalRenderer: wsId => `clawser_${LS_VERSION}_terminal_renderer_${wsId}`,
```

### 6.2 Config Values

```js
/**
 * Terminal renderer configuration shape.
 *
 * @typedef {Object} TerminalRendererConfig
 * @property {'auto'|'custom-dom'|'wterm'} mode
 *   - 'auto': PTY/remote → wterm, local → custom-dom (default)
 *   - 'custom-dom': always use the DOM renderer
 *   - 'wterm': always use wterm
 * @property {number} [fontSize=11]
 * @property {number} [scrollback=1000] — wterm scrollback buffer size
 *
 * @example
 * ```js
 * // Default config
 * { mode: 'auto', fontSize: 11, scrollback: 1000 }
 *
 * // Force wterm for everything
 * { mode: 'wterm', fontSize: 13, scrollback: 5000 }
 * ```
 */
const DEFAULT_RENDERER_CONFIG = {
  mode: 'auto',
  fontSize: 11,
  scrollback: 1000,
};
```

### 6.3 Config Panel UI

Add a "Terminal Renderer" section to `clawser-ui-config.js`:

```js
/**
 * Render the terminal renderer config section.
 *
 * @param {string} wsId — workspace ID
 * @returns {string} HTML string
 *
 * @example
 * ```js
 * const html = renderTerminalRendererConfig('ws_abc123');
 * container.insertAdjacentHTML('beforeend', html);
 * ```
 */
export const renderTerminalRendererConfig = (wsId) => {
  const raw = localStorage.getItem(lsKey.terminalRenderer(wsId));
  const config = raw ? JSON.parse(raw) : { mode: 'auto', fontSize: 11, scrollback: 1000 };

  return `
    <div class="config-section">
      <div class="config-section-title">Terminal Renderer</div>
      <div class="config-group">
        <label>Rendering Mode</label>
        <select id="cfgTermRendererMode">
          <option value="auto" ${config.mode === 'auto' ? 'selected' : ''}>
            Auto (PTY→wterm, Local→DOM)
          </option>
          <option value="custom-dom" ${config.mode === 'custom-dom' ? 'selected' : ''}>
            Custom DOM (always)
          </option>
          <option value="wterm" ${config.mode === 'wterm' ? 'selected' : ''}>
            wterm (always)
          </option>
        </select>
      </div>
      <div class="config-group">
        <label>Font Size</label>
        <input id="cfgTermFontSize" type="number" min="8" max="24"
               value="${config.fontSize ?? 11}" />
      </div>
      <div class="config-group">
        <label>Scrollback Lines (wterm only)</label>
        <input id="cfgTermScrollback" type="number" min="100" max="50000"
               value="${config.scrollback ?? 1000}" />
      </div>
    </div>
  `;
};

/**
 * Read the current terminal renderer config from localStorage.
 *
 * @param {string} wsId
 * @returns {TerminalRendererConfig}
 */
export const getTerminalRendererConfig = (wsId) => {
  const raw = localStorage.getItem(lsKey.terminalRenderer(wsId));
  if (!raw) return { ...DEFAULT_RENDERER_CONFIG };
  try {
    return { ...DEFAULT_RENDERER_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_RENDERER_CONFIG };
  }
};

/**
 * Save terminal renderer config to localStorage.
 *
 * @param {string} wsId
 * @param {TerminalRendererConfig} config
 */
export const saveTerminalRendererConfig = (wsId, config) => {
  localStorage.setItem(lsKey.terminalRenderer(wsId), JSON.stringify(config));
};
```

### 6.4 Per-Session Adapter Selection

When a terminal session is created or switched to, the adapter is selected:

```js
/**
 * Resolve which adapter to use for a given session context.
 *
 * @param {Object} sessionContext
 * @param {string} wsId — workspace ID
 * @returns {'custom-dom'|'wterm'}
 *
 * @example
 * ```js
 * const adapterType = resolveAdapterForSession(
 *   { kind: 'pty', isRemote: true },
 *   'ws_abc123'
 * );
 * // With mode='auto': returns 'wterm'
 * // With mode='custom-dom': returns 'custom-dom'
 * ```
 */
export const resolveAdapterForSession = (sessionContext, wsId) => {
  const config = getTerminalRendererConfig(wsId);

  if (config.mode === 'custom-dom') return 'custom-dom';
  if (config.mode === 'wterm') return 'wterm';

  // Auto mode
  return detectAdapterType(sessionContext);
};
```

---

## 7. Integration Points — File-by-File Changes

### 7.1 New Files

| File | Purpose |
|------|---------|
| `web/clawser-terminal-adapter.mjs` | Adapter interface, `createAdapter()`, `detectAdapterType()` |
| `web/clawser-terminal-adapter-dom.mjs` | `CustomDOMAdapter` class |
| `web/clawser-terminal-adapter-wterm.mjs` | `WTermAdapter` class, `buildWTermTheme()` |

### 7.2 `web/clawser-state.js`

**Change:** Add `terminalRenderer` to `lsKey`, add `terminalAdapter` to state.

```js
// Add to lsKey (after line 89):
terminalRenderer: wsId => `clawser_${LS_VERSION}_terminal_renderer_${wsId}`,

// Add to state object (wherever state properties are declared):
// state.terminalAdapter = null;  // current TerminalAdapter instance
```

### 7.3 `web/clawser-ui-panels.js`

This file has the most changes. The terminal panel rendering logic must route through the adapter.

**Change 1: Import the adapter system**

```js
// Add at top of file:
import { createAdapter, detectAdapterType } from './clawser-terminal-adapter.mjs';
import { getTerminalRendererConfig, resolveAdapterForSession } from './clawser-ui-config.js';
```

**Change 2: Replace `terminalAppend()` to be adapter-aware**

```js
// Replace lines 509-515 with:

/** Append output to the terminal via the active adapter. */
export const terminalAppend = (html) => {
  const adapter = state.terminalAdapter;
  if (!adapter) {
    // Fallback: direct DOM manipulation (pre-migration compatibility)
    const el = $('terminalOutput');
    if (!el) return;
    el.insertAdjacentHTML('beforeend', html);
    el.scrollTop = el.scrollHeight;
    return;
  }

  if (adapter.type() === 'custom-dom') {
    adapter.appendHTML(html);
  } else {
    // wterm: strip HTML tags, write plain text
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const text = tmp.textContent || '';
    if (text) adapter.write(text + '\r\n');
  }
};
```

**Change 3: Add adapter initialization on session create/switch**

```js
/**
 * Initialize or swap the terminal adapter for the current session.
 *
 * @param {Object} sessionContext — { kind, isRemote, shellBackend }
 * @returns {Promise<void>}
 *
 * @example
 * ```js
 * await initTerminalAdapter({ kind: 'local', isRemote: false });
 * ```
 */
export const initTerminalAdapter = async (sessionContext = { kind: 'local' }) => {
  const wsId = state.workspace?.id;
  const adapterType = resolveAdapterForSession(sessionContext, wsId);
  const config = getTerminalRendererConfig(wsId);

  // Destroy existing adapter if type changed
  if (state.terminalAdapter && state.terminalAdapter.type() !== adapterType) {
    state.terminalAdapter.destroy();
    state.terminalAdapter = null;
  }

  // Create new adapter if needed
  if (!state.terminalAdapter) {
    const container = $('terminalOutput');
    if (!container) return;

    const adapter = createAdapter(adapterType, {
      theme: document.documentElement.classList.contains('light') ? 'light' : 'dark',
      fontSize: config.fontSize,
      scrollback: config.scrollback,
      fontFamily: "'SF Mono','Fira Code','Cascadia Code','JetBrains Mono',monospace",
    });

    try {
      await adapter.init(container);
    } catch (err) {
      console.warn(`[clawser] ${adapterType} adapter failed, falling back to custom-dom:`, err);
      // Fallback to custom-dom
      const fallback = createAdapter('custom-dom', { fontSize: config.fontSize });
      await fallback.init(container);
      state.terminalAdapter = fallback;
      return;
    }

    state.terminalAdapter = adapter;
  }
};
```

**Change 4: Wire adapter into terminal input (Batch 4 init, around line 1850)**

```js
// In the existing Batch 4 event listener setup, add adapter data wiring:

// After adapter init, if wterm is active, the input row is hidden
// because wterm handles its own keyboard input.
const updateInputRowVisibility = () => {
  const inputRow = document.querySelector('.terminal-input-row');
  if (!inputRow) return;

  if (state.terminalAdapter?.type() === 'wterm') {
    inputRow.style.display = 'none';
    // wterm handles keyboard input via InputHandler
    state.terminalAdapter.onData((data) => {
      // Forward to the appropriate session
      if (state.activeVirtualTerminalSession) {
        state.activeVirtualTerminalSession.write(data);
      } else if (state.shell) {
        // Local shell fallback: treat as command line
        // This path shouldn't normally be reached in auto mode
      }
    });
  } else {
    inputRow.style.display = '';
  }
};
```

### 7.4 `web/clawser-terminal-sessions.js`

**Change:** Store adapter type preference per session.

```js
// In TerminalSessionManager.create(), add adapterType to meta:
const meta = {
  id,
  name: name || this.#autoName(),
  created: now,
  lastUsed: now,
  commandCount: 0,
  preview: '',
  version: 1,
  workspaceId: this.#wsId,
  adapterType: null,  // null = use auto-detection; 'custom-dom' | 'wterm' for override
};
```

```js
// In TerminalSessionManager.switchTo(), trigger adapter swap:
async switchTo(sessionId) {
  const meta = this.#sessions.find(s => s.id === sessionId);
  if (!meta) throw new Error(`Terminal session not found: ${sessionId}`);

  if (this.#activeSessionId) {
    await this.persist();
  }

  const restored = await this.restore(sessionId);
  this.#activeSessionId = sessionId;

  meta.lastUsed = Date.now();
  const dir = await this.#sessionDir(sessionId);
  await atomicWrite(dir, 'meta.json', JSON.stringify(meta));

  // NEW: Return adapterType so the UI layer can swap adapters
  return { ...meta, adapterType: meta.adapterType || null };
}
```

### 7.5 `web/clawser-wsh-virtual-terminal-session.js`

> **Audit note (2026-07-16): not implemented.** `onOutput` does not exist in
> `web/clawser-wsh-virtual-terminal-session.js` today — the constructor takes no such
> option and `#sendText()` has no forwarding call. §7.6's `openChannel()` change below
> is likewise absent, and the one real call site (`clawser-wsh-incoming.js`'s
> `openChannel()` invocation) passes no `onOutput`. This section is still a plan, not
> shipped code — see the status note at the top of this document.

**Change:** Add a hook for adapter output. The `#sendText()` method already emits data over WSH channels. For **local** rendering (when the virtual terminal is displayed in the current tab), we need to also write to the adapter.

```js
// Add an optional output callback to the constructor options:
constructor({
  participantKey,
  channelId,
  kind = 'pty',
  command = '',
  cols = 80,
  rows = 24,
  shellFactory,
  sendControl,
  replayLimit = DEFAULT_REPLAY_LIMIT,
  onOutput = null,  // NEW: (text: string) => void — local rendering hook
} = {}) {
  // ... existing validation ...
  this.#onOutput = onOutput;
}

// In #sendText(), add the onOutput call:
async #sendText(text) {
  if (!text) return;
  const normalized = normalizeTerminalText(text);
  const data = textEncoder.encode(normalized);
  this.#replay = trimReplay(this.#replay + normalized, this.#replayLimit);
  await this.#sendControl(sessionDataMsg({ channelId: this.#channelId, data }));
  await this.#emitTermFrame(data);

  // NEW: Forward to local adapter if attached
  this.#onOutput?.(normalized);
}
```

This allows `VirtualTerminalManager.openChannel()` to pass an `onOutput` callback that writes to the active `TerminalAdapter`.

### 7.6 `web/clawser-wsh-virtual-terminal-manager.js`

**Change:** Accept an optional `onOutput` factory in `openChannel()`:

```js
async openChannel(participantKey, {
  channelId,
  kind = 'pty',
  command = '',
  cols = 80,
  rows = 24,
  autoStart = true,
  onOutput = null,  // NEW
} = {}) {
  const context = this.#requirePeerContext(participantKey);

  if (context.channels.has(channelId)) {
    await this.closeChannel(participantKey, channelId, { notifyRemote: false });
  }

  const session = new VirtualTerminalSession({
    participantKey,
    channelId,
    kind,
    command,
    cols,
    rows,
    shellFactory: () => this.#createShell({ context, participantKey, channelId, kind }),
    sendControl: (msg) => context.client.sendRelayControl(msg),
    onOutput,  // NEW: pass through
  });

  // ... rest unchanged ...
}
```

### 7.7 `web/clawser-peer-terminal.js`

> **Audit note (2026-07-16): not implemented.** `executeStreaming`/`onChunk` do not
> appear in `web/clawser-peer-terminal.js`. Same status as §7.5/§7.6 — plan only.

**Change:** Add adapter output hook to `TerminalClient`.

The `TerminalClient` currently resolves command results via promises. For real-time streaming output (needed for wterm), add an optional streaming callback:

```js
// In TerminalClient, add a streamOutput callback:

/**
 * Execute a command with real-time output streaming.
 * Unlike execute(), this calls the adapter's write() for each chunk
 * as it arrives, instead of buffering the full response.
 *
 * @param {string} command
 * @param {Object} [opts]
 * @param {(chunk: string) => void} [opts.onChunk] — called for each output chunk
 * @returns {Promise<{ output: string, exitCode: number }>}
 *
 * @example
 * ```js
 * await client.executeStreaming('ls -la', {
 *   onChunk: (chunk) => adapter.write(chunk),
 * });
 * ```
 */
async executeStreaming(command, opts) {
  // For now, delegate to execute() and deliver the full output at once.
  // True streaming requires protocol changes (chunked responses).
  const result = await this.execute(command, opts);
  opts?.onChunk?.(result.output);
  return result;
}
```

### 7.8 `web/index.html`

**Change 1:** Add wterm to the import map for version pinning:

```html
<!-- In the <script type="importmap"> block, add: -->
"@wterm/dom": "https://esm.sh/@wterm/dom@latest"
```

**Change 2:** Add a wterm container class to the terminal panel (optional — the adapter creates its own container, but this reserves space):

```html
<!-- No structural HTML changes needed. The existing #terminalOutput div
     serves as the container for both adapters. The wterm adapter creates
     its own inner div. -->
```

### 7.9 `web/clawser.css`

**Change:** Add wterm container styles:

```css
/* ── wterm adapter styles ──────────────────────────── */
.wterm-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  border-radius: 0;
}

/* When wterm is active, the terminal-output panel needs to be a flex container */
.terminal-output.wterm-active {
  padding: 0;
  overflow: hidden;
}

/* Hide input row when wterm is active (wterm handles its own input) */
.panel.wterm-active .terminal-input-row {
  display: none;
}

/* Ensure wterm's internal elements respect the theme */
.wterm-container canvas,
.wterm-container .wterm-screen {
  font-family: var(--mono);
}
```

### 7.10 `web/clawser-ui-config.js`

**Change:** Add the terminal renderer config section. See Section 6.3 for the full implementation. Wire the save handler into the existing config panel's save flow.

---

## 8. Data Flow Diagrams

### 8.1 Local Shell — Custom DOM Adapter (current behavior, preserved)

```
┌──────────────────────────────────────────────────────────────────┐
│                     LOCAL SHELL SESSION                          │
│                                                                  │
│  User types in <input#terminalInput>                             │
│       │                                                          │
│       ▼                                                          │
│  CustomDOMAdapter.onData(callback)                               │
│       │  callback receives raw command string                    │
│       ▼                                                          │
│  terminalExec(cmd)                                               │
│       │                                                          │
│       ├──► terminalAppend('<div class="terminal-cmd">$ cmd</div>')
│       │         │                                                │
│       │         ▼                                                │
│       │    adapter.appendHTML(html) ──► DOM insert ──► Screen    │
│       │                                                          │
│       ▼                                                          │
│  state.shell.exec(cmd)                                           │
│       │                                                          │
│       ▼                                                          │
│  { stdout, stderr, exitCode }                                    │
│       │                                                          │
│       ├──► terminalAppend('<div class="terminal-stdout">...</div>')
│       │         │                                                │
│       │         ▼                                                │
│       │    adapter.appendHTML(html) ──► DOM insert ──► Screen    │
│       │                                                          │
│       └──► state.terminalSessions.recordResult(...)              │
│                 │                                                │
│                 ▼                                                │
│            OPFS persistence (events.jsonl, state.json)           │
└──────────────────────────────────────────────────────────────────┘
```

### 8.2 WSH PTY Session — wterm Adapter (new)

```
┌──────────────────────────────────────────────────────────────────┐
│                     WSH PTY SESSION                              │
│                                                                  │
│  User types into wterm (keyboard events captured by container)   │
│       │                                                          │
│       ▼                                                          │
│  InputHandler.handleKeyDown(event)                               │
│       │  returns ANSI key sequence (e.g. '\x1b[A' for up arrow)  │
│       ▼                                                          │
│  WTermAdapter.onData(callback)                                   │
│       │  callback receives raw key sequence                      │
│       ▼                                                          │
│  VirtualTerminalSession.write(data)                              │
│       │                                                          │
│       ├──► #handleInputChar() processes each character           │
│       │    ├── Enter → #submitLine() → shell.exec(cmd)           │
│       │    ├── Ctrl+C → #interrupt()                             │
│       │    ├── Escape sequences → cursor movement, history       │
│       │    └── Printable → insert into line buffer               │
│       │                                                          │
│       ▼                                                          │
│  #sendText(output)                                               │
│       │                                                          │
│       ├──► sessionDataMsg → WSH channel → remote peer            │
│       │                                                          │
│       └──► onOutput(normalized)  ◄── NEW HOOK                   │
│                 │                                                │
│                 ▼                                                │
│            WTermAdapter.write(data)                               │
│                 │  ANSI escapes rendered natively                 │
│                 ▼                                                │
│            wterm WASM engine ──► DOM render ──► Screen            │
│            (colors, cursor, scrollback, alternate buffer)         │
└──────────────────────────────────────────────────────────────────┘
```

### 8.3 Peer Terminal — wterm Adapter (new)

```
┌──────────────────────────────────────────────────────────────────┐
│                    PEER TERMINAL SESSION                         │
│                                                                  │
│  LOCAL PEER                           REMOTE PEER                │
│  ──────────                           ───────────                │
│                                                                  │
│  User types into wterm                                           │
│       │                                                          │
│       ▼                                                          │
│  WTermAdapter.onData(callback)                                   │
│       │                                                          │
│       ▼                                                          │
│  TerminalClient.execute(cmd)    ──►  PeerSession.send()          │
│       │                                    │                     │
│       │                                    ▼                     │
│       │                              TerminalHost.#handleCommand()
│       │                                    │                     │
│       │                                    ▼                     │
│       │                              shell.execute(cmd)          │
│       │                                    │                     │
│       │                                    ▼                     │
│       │                              { output, exitCode }        │
│       │                                    │                     │
│       │                              PeerSession.send()          │
│       │                                    │                     │
│       ▼                              ◄─────┘                     │
│  TerminalClient.#handleResponse()                                │
│       │                                                          │
│       ├──► emit('output', result)                                │
│       │                                                          │
│       ▼                                                          │
│  WTermAdapter.write(result.output)                               │
│       │  ANSI escapes rendered natively                          │
│       ▼                                                          │
│  Screen                                                          │
└──────────────────────────────────────────────────────────────────┘
```

### 8.4 Adapter Selection Flow

```
┌─────────────────────────────────────────────────────┐
│              SESSION CREATED / SWITCHED              │
│                                                      │
│  getTerminalRendererConfig(wsId)                     │
│       │                                              │
│       ▼                                              │
│  config.mode = ?                                     │
│       │                                              │
│       ├── 'custom-dom' ──► CustomDOMAdapter           │
│       │                                              │
│       ├── 'wterm' ──► WTermAdapter                    │
│       │                  │                           │
│       │                  └── init() fails?           │
│       │                       │                      │
│       │                       ▼                      │
│       │                  CustomDOMAdapter (fallback)  │
│       │                                              │
│       └── 'auto' ──► detectAdapterType(session)      │
│                  │                                   │
│                  ├── session.isRemote? ──► wterm      │
│                  ├── session.kind === 'pty'? ──► wterm│
│                  ├── session.kind === 'exec'? ──► wterm
│                  ├── shellBackend === 'vm-console'? ──► wterm
│                  └── else ──► custom-dom              │
└─────────────────────────────────────────────────────┘
```

---

## 9. Testing Plan

### 9.1 Unit Tests

File: `web/test/clawser-terminal-adapter.test.mjs`

```js
/**
 * Unit tests for TerminalAdapter interface compliance.
 * Both adapters must satisfy the same contract.
 *
 * @example
 * ```sh
 * node --import ./web/test/_setup-globals.mjs --test web/test/clawser-terminal-adapter.test.mjs
 * ```
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter, detectAdapterType } from '../clawser-terminal-adapter.mjs';

describe('detectAdapterType', () => {
  it('returns wterm for remote sessions', () => {
    assert.equal(detectAdapterType({ kind: 'pty', isRemote: true }), 'wterm');
  });

  it('returns wterm for PTY sessions', () => {
    assert.equal(detectAdapterType({ kind: 'pty' }), 'wterm');
  });

  it('returns custom-dom for local sessions', () => {
    assert.equal(detectAdapterType({ kind: 'local' }), 'custom-dom');
  });

  it('respects manual override', () => {
    assert.equal(detectAdapterType({ kind: 'local' }, 'wterm'), 'wterm');
    assert.equal(detectAdapterType({ kind: 'pty', isRemote: true }, 'custom-dom'), 'custom-dom');
  });

  it('returns wterm for vm-console backend', () => {
    assert.equal(detectAdapterType({ kind: 'local', shellBackend: 'vm-console' }), 'wterm');
  });
});

describe('createAdapter', () => {
  it('creates custom-dom adapter by default', () => {
    const adapter = createAdapter('custom-dom');
    assert.equal(adapter.type(), 'custom-dom');
  });

  it('creates wterm adapter', () => {
    const adapter = createAdapter('wterm');
    assert.equal(adapter.type(), 'wterm');
  });

  it('returns custom-dom for unknown type', () => {
    const adapter = createAdapter('nonexistent');
    assert.equal(adapter.type(), 'custom-dom');
  });
});
```

File: `web/test/clawser-terminal-adapter-dom.test.mjs`

```js
/**
 * Unit tests for CustomDOMAdapter.
 *
 * Uses jsdom or a minimal DOM shim (from _setup-globals.mjs).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CustomDOMAdapter } from '../clawser-terminal-adapter-dom.mjs';

describe('CustomDOMAdapter', () => {
  let container;
  let adapter;

  beforeEach(() => {
    // Minimal DOM container (assumes _setup-globals provides document)
    container = document.createElement('div');
    adapter = new CustomDOMAdapter({ fontSize: 11 });
  });

  it('init creates output element if missing', async () => {
    await adapter.init(container);
    const output = container.querySelector('.terminal-output');
    assert.ok(output || container.children.length > 0);
  });

  it('write appends text as terminal-stdout div', async () => {
    await adapter.init(container);
    adapter.write('hello world');
    assert.ok(container.innerHTML.includes('hello world'));
  });

  it('appendHTML inserts raw HTML', async () => {
    await adapter.init(container);
    adapter.appendHTML('<div class="terminal-cmd">$ ls</div>');
    const cmd = container.querySelector('.terminal-cmd');
    assert.ok(cmd);
    assert.equal(cmd.textContent, '$ ls');
  });

  it('clear removes all output', async () => {
    await adapter.init(container);
    adapter.write('test');
    adapter.clear();
    const output = container.querySelector('.terminal-output') || container;
    assert.equal(output.innerHTML, '');
  });

  it('type returns custom-dom', () => {
    assert.equal(adapter.type(), 'custom-dom');
  });

  it('dimensions returns configured cols/rows', () => {
    const d = adapter.dimensions();
    assert.equal(d.cols, 80);
    assert.equal(d.rows, 24);
  });

  it('destroy cleans up', async () => {
    await adapter.init(container);
    adapter.destroy();
    // Should not throw on subsequent calls
    adapter.write('should be no-op');
  });
});
```

### 9.2 Integration Tests

File: `web/test/clawser-terminal-adapter-integration.test.mjs`

```js
/**
 * Integration tests: create session → write output → verify rendering.
 *
 * These tests verify the full pipeline from session creation through
 * adapter rendering. They require a DOM environment.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter, detectAdapterType } from '../clawser-terminal-adapter.mjs';

describe('Adapter integration', () => {
  it('custom-dom adapter renders structured output from shell result', async () => {
    const container = document.createElement('div');
    const adapter = createAdapter('custom-dom');
    await adapter.init(container);

    // Simulate shell result
    const result = { stdout: 'file1.txt\nfile2.txt', stderr: '', exitCode: 0 };
    adapter.appendHTML(`<div class="terminal-cmd">$ ls</div>`);
    if (result.stdout) {
      adapter.appendHTML(`<div class="terminal-stdout">${result.stdout}</div>`);
    }

    assert.ok(container.innerHTML.includes('file1.txt'));
    assert.ok(container.innerHTML.includes('terminal-cmd'));
    adapter.destroy();
  });

  it('adapter selection auto-detects correctly', () => {
    assert.equal(detectAdapterType({ kind: 'local' }), 'custom-dom');
    assert.equal(detectAdapterType({ kind: 'pty' }), 'wterm');
    assert.equal(detectAdapterType({ kind: 'pty', isRemote: true }), 'wterm');
    assert.equal(detectAdapterType({ kind: 'exec' }), 'wterm');
  });

  it('fallback works when wterm init fails', async () => {
    const container = document.createElement('div');
    const adapter = createAdapter('wterm');

    let fellBack = false;
    try {
      await adapter.init(container);
    } catch {
      // Expected in node/test environment (no WASM)
      const fallback = createAdapter('custom-dom');
      await fallback.init(container);
      fellBack = true;
      assert.equal(fallback.type(), 'custom-dom');
      fallback.destroy();
    }

    // In a test environment without a browser, wterm should fail
    assert.ok(fellBack, 'wterm should fail in node test environment');
  });
});
```

### 9.3 Manual Test Checklist

#### Phase 1: CustomDOMAdapter (refactor validation)

- [ ] Local shell commands render identically to before ($ echo, ls, cat, etc.)
- [ ] Terminal session switching preserves output
- [ ] Session create/delete/rename/fork works
- [ ] Agent mode prompt badge toggles correctly
- [ ] REPL mode works (clawser repl)
- [ ] `__clearTerminal` flag clears output
- [ ] CWD display updates after `cd`
- [ ] Command history (up/down arrows) works in input field
- [ ] Terminal output scrolls to bottom on new output
- [ ] Click-to-fork on command lines works
- [ ] Session bar renders and is functional

#### Phase 2: WTermAdapter

- [ ] wterm loads from CDN without errors
- [ ] WASM initializes (check console for errors)
- [ ] Text output renders with correct font and colors
- [ ] ANSI color codes render correctly: `\x1b[32mgreen\x1b[0m`
- [ ] Bold, italic, underline ANSI attributes render
- [ ] Cursor positioning works (e.g., progress bars)
- [ ] Keyboard input is captured (type characters, see them echoed)
- [ ] Arrow keys send correct escape sequences
- [ ] Ctrl+C sends SIGINT
- [ ] Paste works (Cmd+V / Ctrl+V)
- [ ] Terminal resizes when panel is resized
- [ ] Scrollback buffer works (scroll up to see history)
- [ ] Theme matches clawser's dark theme colors
- [ ] Light theme switch updates wterm colors
- [ ] Input row is hidden when wterm is active
- [ ] Focus moves to wterm container on panel select

#### Phase 3: Auto-detection

- [ ] Local shell session uses custom-dom adapter
- [ ] WSH PTY session auto-selects wterm
- [ ] Session switch from local→PTY swaps adapter
- [ ] Session switch from PTY→local swaps adapter back
- [ ] Adapter swap preserves session data in store

#### Phase 4: Config Panel

- [ ] Config panel shows "Terminal Renderer" section
- [ ] Mode dropdown has auto/custom-dom/wterm options
- [ ] Changing mode and switching session applies new adapter
- [ ] Font size change applies to both adapters
- [ ] Scrollback setting applies to wterm

#### Phase 5: Error Scenarios

- [ ] Offline / CDN down: wterm fails gracefully, falls back to custom-dom
- [ ] WASM load failure: same fallback behavior
- [ ] Console shows clear warning message on fallback
- [ ] After fallback, terminal is fully functional with custom-dom

---

## 10. Rollout Plan

### Phase 1: Adapter Interface + CustomDOMAdapter

**Goal:** Refactor existing rendering behind the adapter interface with zero behavior change.

**Steps:**

1. Create `clawser-terminal-adapter.mjs` with `createAdapter()` and `detectAdapterType()`
2. Create `clawser-terminal-adapter-dom.mjs` with `CustomDOMAdapter`
3. Add `terminalAdapter` to `state` in `clawser-state.js`
4. Modify `terminalAppend()` in `clawser-ui-panels.js` to route through adapter
5. Add `initTerminalAdapter()` and call it during terminal panel initialization
6. Run full manual test checklist for Phase 1
7. Write unit tests for `CustomDOMAdapter` and `detectAdapterType()`
8. Verify all existing terminal tests still pass

**Exit criteria:** All existing terminal functionality works identically. No user-visible changes.

### Phase 2: WTermAdapter with Lazy CDN Loading

**Goal:** Implement the wterm adapter, available but not yet auto-selected.

**Steps:**

1. Create `clawser-terminal-adapter-wterm.mjs` with `WTermAdapter`
2. Add `@wterm/dom` to the import map in `index.html` (version-pinned)
3. Add wterm container styles to `clawser.css`
4. Add `onOutput` hook to `VirtualTerminalSession` constructor
5. Wire `onOutput` through `VirtualTerminalManager.openChannel()`
6. Test wterm adapter manually by setting `mode: 'wterm'` in localStorage
7. Verify ANSI rendering with color test sequences
8. Write unit tests (browser-only tests that can load WASM)

**Exit criteria:** wterm renders correctly when manually enabled. Fallback to custom-dom works when CDN is unreachable.

### Phase 3: Auto-Detection

**Goal:** Sessions automatically select the appropriate adapter.

**Steps:**

1. Wire `detectAdapterType()` into session create/switch flow
2. Add `adapterType` field to terminal session metadata
3. Implement adapter swap on session switch in `renderTerminalSessionBar()`
4. Test switching between local and PTY sessions
5. Verify adapter destroys cleanly on swap (no leaked DOM nodes, observers, or event listeners)

**Exit criteria:** PTY sessions render in wterm, local sessions in custom-dom, switching is seamless.

### Phase 4: Config Panel Toggle

**Goal:** Users can manually override the renderer in the config panel.

**Steps:**

1. Add `terminalRenderer` to `lsKey` in `clawser-state.js`
2. Add `renderTerminalRendererConfig()` to `clawser-ui-config.js`
3. Wire config save handler
4. Read config in `resolveAdapterForSession()`
5. Test all three modes: auto, custom-dom, wterm

**Exit criteria:** Config panel controls work, preferences persist across page reloads.

### Phase 5: Future — wterm as Default (Optional)

**Goal:** If wterm proves stable and superior, make it the default for all sessions.

**Steps:**

1. Change `detectAdapterType()` default to return `'wterm'` for all session types
2. Add ANSI escape support for shell output (wrap stdout/stderr in escape sequences for colored output)
3. Remove HTML-based rendering from `terminalExec()` for wterm sessions
4. Consider deprecating `CustomDOMAdapter` or keeping it as a lightweight fallback

**Exit criteria:** This phase is optional and should only proceed after several weeks of Phase 3+4 stability.

---

## 11. Risk Assessment

### 11.1 CDN Availability (esm.sh)

**Risk:** esm.sh goes down or is blocked by corporate firewalls.

**Impact:** wterm cannot load. Terminal sessions that depend on it would fail.

**Mitigation:**
- Graceful fallback: `WTermAdapter.init()` throws → catch → `CustomDOMAdapter` takes over. The user sees a console warning but the terminal remains functional.
- Version pinning: Use a specific version URL, not `@latest`, to benefit from CDN edge caching.
- Future: Bundle wterm as a local dependency if CDN reliability becomes a problem.
- Alternative CDN: esm.sh mirrors exist (jsdelivr, unpkg). Could add a fallback chain:

```js
const CDN_URLS = [
  'https://esm.sh/@wterm/dom@0.x.y',
  'https://cdn.jsdelivr.net/npm/@wterm/dom@0.x.y/+esm',
];

const loadWTerm = async () => {
  for (const url of CDN_URLS) {
    try {
      return await import(url);
    } catch { continue; }
  }
  throw new Error('All CDN sources failed for @wterm/dom');
};
```

### 11.2 WASM Load Failure

**Risk:** Browser blocks WASM (CSP), memory pressure prevents compilation, or WASM binary is corrupted.

**Impact:** Same as CDN failure — wterm unusable.

**Mitigation:** Same fallback strategy. The `try/catch` around `adapter.init()` handles this transparently.

### 11.3 Performance

**Risk:** wterm adds overhead (WASM compilation, DOM rendering per character) compared to the lightweight div-append approach.

**Impact:** Noticeable lag on low-end devices or with very high output volume.

**Analysis:**
- wterm's WASM terminal emulator is compiled once and cached. Subsequent sessions skip compilation.
- For high-volume output (e.g., `cat` of a large file), wterm's internal buffer management is likely *faster* than appending thousands of `<div>` elements, because wterm renders to a fixed-size DOM structure (no DOM node count explosion).
- For low-volume output (typical local shell), the custom DOM renderer is negligibly faster because it skips WASM entirely.
- Auto-detection routes each session to the optimal renderer.

**Mitigation:** If performance issues emerge, the config panel allows users to force `custom-dom` mode.

### 11.4 Browser Compatibility

**Risk:** wterm's WASM or DOM APIs may not work in older browsers.

**Impact:** Crash or rendering failure in the terminal panel.

**Analysis:**
- wterm requires: WebAssembly, ES2020+, `ResizeObserver`, `import()` dynamic imports.
- These are supported in all browsers clawser already targets (Chrome 80+, Firefox 78+, Safari 14+, Edge 80+).
- OPFS (used by clawser's session persistence) has stricter requirements than wterm, so any browser running clawser can run wterm.

**Mitigation:** The `createAdapter()` factory could check `typeof WebAssembly` before returning a `WTermAdapter` and fall back automatically.

### 11.5 Feature Parity — Click-to-Fork

**Risk:** The custom DOM renderer supports click-to-fork on command lines (`.term-fork` elements). wterm renders all output as a terminal canvas — individual commands aren't clickable DOM elements.

**Impact:** Click-to-fork is unavailable when wterm is the active renderer.

**Mitigation:**
- In `auto` mode, local shell sessions (where fork is useful) use `custom-dom`.
- For wterm sessions, fork could be triggered via a keyboard shortcut or command palette entry instead.
- Document this as a known limitation in Phase 2 release notes.

### 11.6 Theme Synchronization

**Risk:** User switches between dark/light theme while wterm is active. wterm doesn't automatically re-read CSS custom properties.

**Impact:** Theme mismatch — wterm stays dark while the rest of the UI goes light (or vice versa).

**Mitigation:** Listen for theme change events (e.g., `matchMedia('(prefers-color-scheme: dark)')` or clawser's own theme toggle) and call:

```js
// Re-initialize wterm with updated theme
const refreshWTermTheme = () => {
  if (state.terminalAdapter?.type() !== 'wterm') return;
  const container = $('terminalOutput');
  state.terminalAdapter.destroy();
  state.terminalAdapter = null;
  initTerminalAdapter(currentSessionContext);
};
```

Or, if wterm exposes a theme-update API, call it directly without destroying the instance.

---

## 12. Estimated Effort

| Phase | Description | Effort | Files Changed |
|-------|-------------|--------|---------------|
| **1** | Adapter interface + CustomDOMAdapter | 2–3 days | 4 new, 3 modified |
| **2** | WTermAdapter + CDN loading | 2–3 days | 1 new, 3 modified |
| **3** | Auto-detection + session switching | 1–2 days | 3 modified |
| **4** | Config panel toggle | 1 day | 2 modified |
| **5** | Default wterm (future) | 2–3 days | 3–5 modified |
| **Tests** | Unit + integration + manual | 2 days | 3 new test files |
| **Total (Phases 1–4)** | | **8–11 days** | |

### Effort Breakdown by File

| File | Phase | Changes |
|------|-------|---------|
| `clawser-terminal-adapter.mjs` (new) | 1 | Interface, factory, detection (~80 lines) |
| `clawser-terminal-adapter-dom.mjs` (new) | 1 | CustomDOMAdapter (~180 lines) |
| `clawser-terminal-adapter-wterm.mjs` (new) | 2 | WTermAdapter, theme builder (~220 lines) |
| `clawser-state.js` | 1 | +2 lines (lsKey + state property) |
| `clawser-ui-panels.js` | 1, 3 | ~60 lines changed (terminalAppend, init, input routing) |
| `clawser-terminal-sessions.js` | 3 | ~10 lines (adapterType in meta, switchTo return) |
| `clawser-wsh-virtual-terminal-session.js` | 2 | ~8 lines (onOutput hook) |
| `clawser-wsh-virtual-terminal-manager.js` | 2 | ~4 lines (onOutput passthrough) |
| `clawser-peer-terminal.js` | 2 | ~15 lines (executeStreaming) |
| `clawser-ui-config.js` | 4 | ~60 lines (renderer config section) |
| `index.html` | 2 | ~1 line (import map entry) |
| `clawser.css` | 2 | ~15 lines (wterm container styles) |
| Test files (3 new) | 1, 2 | ~200 lines total |

---

## Appendix A: wterm API Reference

Verified working from CDN (`https://esm.sh/@wterm/dom@latest`):

```js
import { WTerm, InputHandler } from 'https://esm.sh/@wterm/dom@latest';

// WTerm
const wterm = new WTerm();
await wterm.init(containerElement, { cols, rows, fontSize, fontFamily, theme, scrollback });
wterm.write(data);        // string — supports ANSI escapes
wterm.resize(cols, rows);
wterm.focus();
wterm.destroy();

// InputHandler
const input = new InputHandler();
input.focus();
input.destroy();
input.handleKeyDown(keyboardEvent);  // returns ANSI sequence string or null
input.handlePaste(clipboardEvent);   // returns pasted text string or null
input.keyToSequence(key, modifiers); // manual key-to-sequence conversion
```

## Appendix B: ANSI Test Sequences

Use these to validate wterm rendering:

```js
// Basic colors
adapter.write('\x1b[31mRed\x1b[0m \x1b[32mGreen\x1b[0m \x1b[34mBlue\x1b[0m\r\n');

// Bold + underline
adapter.write('\x1b[1mBold\x1b[0m \x1b[4mUnderline\x1b[0m \x1b[1;4mBoth\x1b[0m\r\n');

// 256-color
adapter.write('\x1b[38;5;208mOrange (256)\x1b[0m\r\n');

// RGB
adapter.write('\x1b[38;2;255;100;50mRGB color\x1b[0m\r\n');

// Cursor movement
adapter.write('ABC\x1b[2D_\r\n');  // Should render: A_C

// Clear line
adapter.write('Full line\x1b[2K\r\n');  // Should render empty line
```

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| **Adapter** | Object implementing the TerminalAdapter interface; bridges session logic to a rendering backend |
| **Custom DOM renderer** | Clawser's existing renderer that appends `<div>` elements for each output line |
| **wterm** | `@wterm/dom` — WASM-backed terminal emulator that renders ANSI-capable terminal output to the DOM |
| **WSH** | Web Socket Handler — clawser's protocol for remote shell sessions |
| **PTY** | Pseudo-terminal — a virtual terminal session that emulates a full terminal (line editing, escape sequences, etc.) |
| **OPFS** | Origin Private File System — browser API for persistent file storage |
| **Session** | A terminal session managed by `TerminalSessionManager`, with its own event log and shell state |
| **Channel** | A `VirtualTerminalSession` instance within a `VirtualTerminalManager` peer context |
