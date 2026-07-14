/**
 * clawser-terminal-adapter.mjs — TerminalAdapter interface, factory, and auto-detection
 *
 * Defines the shared contract for terminal rendering backends. Both the custom DOM
 * renderer and wterm implement this interface. Consumers interact only with the
 * adapter, never with the underlying renderer directly.
 *
 * @example
 * ```js
 * import { createAdapter, detectAdapterType } from './clawser-terminal-adapter.mjs';
 *
 * const type = detectAdapterType({ kind: 'pty', isRemote: true });
 * // => 'wterm'
 *
 * const adapter = createAdapter(type, {
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

import { CustomDOMAdapter } from './clawser-terminal-adapter-dom.mjs';
import { WTermAdapter } from './clawser-terminal-adapter-wterm.mjs';

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
 *
 * @example
 * ```js
 * const adapter = createAdapter('custom-dom', { fontSize: 13 });
 * await adapter.init(container);
 * adapter.write('ready\n');
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
 * ```
 *
 * @example
 * ```js
 * const type = detectAdapterType({ kind: 'local' });
 * // => 'custom-dom'
 * ```
 *
 * @example
 * ```js
 * const type = detectAdapterType({ kind: 'local' }, 'wterm');
 * // => 'wterm'  (manual override wins)
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
