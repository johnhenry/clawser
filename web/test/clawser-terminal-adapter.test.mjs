/**
 * clawser-terminal-adapter.test.mjs — Tests for TerminalAdapter interface,
 * factory, auto-detection, CustomDOMAdapter, and WTermAdapter fallback.
 *
 * @example
 * ```sh
 * node --import ./web/test/_setup-globals.mjs --test web/test/clawser-terminal-adapter.test.mjs
 * ```
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Stub browser globals ────────────────────────────────────────

const store = {};
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
};

const _domElements = {};

const makeMockEl = (tag) => {
  const children = [];
  const listeners = {};
  let _innerHTML = '';
  let _textContent = '';
  const el = {
    tagName: tag || 'DIV',
    style: {},
    className: '',
    get textContent() { return _textContent; },
    set textContent(v) { _textContent = v; _innerHTML = v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
    get innerHTML() { return _innerHTML; },
    set innerHTML(v) { _innerHTML = v; },
    dataset: {},
    value: '',
    id: '',
    children,
    childNodes: children,
    classList: {
      _classes: new Set(),
      add(...cls) { cls.forEach(c => this._classes.add(c)); },
      remove(...cls) { cls.forEach(c => this._classes.delete(c)); },
      contains(c) { return this._classes.has(c); },
      toggle(c) { if (this._classes.has(c)) { this._classes.delete(c); return false; } else { this._classes.add(c); return true; } },
    },
    addEventListener(evt, fn) { (listeners[evt] ||= []).push(fn); },
    removeEventListener(evt, fn) { if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== fn); },
    _listeners: listeners,
    appendChild(c) { children.push(c); return c; },
    removeChild(c) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); },
    remove() {},
    prepend(c) { children.unshift(c); },
    closest(sel) { return null; },
    querySelector(sel) {
      if (sel === '.terminal-output') return null;
      if (sel === '#terminalOutput') return null;
      if (sel === '.terminal-input-row') return null;
      if (sel === '.wterm-container') return null;
      return null;
    },
    querySelectorAll(sel) { return []; },
    setAttribute(k, v) { el[k] = v; },
    getAttribute(k) { return el[k]; },
    dispatchEvent() {},
    insertAdjacentHTML(pos, html) { el.innerHTML += html; },
    focus() {},
    click() {},
    get scrollHeight() { return 500; },
    scrollTop: 0,
  };
  return el;
};

globalThis.document = {
  getElementById: (id) => _domElements[id] || null,
  createElement: (tag) => makeMockEl(tag),
  addEventListener: () => {},
  documentElement: { classList: { contains: () => false } },
  querySelector: () => null,
};

globalThis.location = { search: '', hash: '', href: '' };
globalThis.history = { replaceState() {} };
try {
  globalThis.navigator = { storage: { getDirectory: async () => ({}) }, locks: { request: async (_name, optsOrCb, maybeCb) => { const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb; if (cb) return cb({ name: _name }); } } };
} catch {
  if (globalThis.navigator) {
    if (!globalThis.navigator.storage) {
      Object.defineProperty(globalThis.navigator, 'storage', { value: { getDirectory: async () => ({}) }, configurable: true });
    }
  }
}
globalThis.BroadcastChannel = class { postMessage() {} close() {} onmessage() {} };

// ── Import modules under test ───────────────────────────────────

const { detectAdapterType, createAdapter } = await import('../clawser-terminal-adapter.mjs');
const { CustomDOMAdapter } = await import('../clawser-terminal-adapter-dom.mjs');

// ── Tests ────────────────────────────────────────────────────────

describe('detectAdapterType', () => {
  it('returns wterm for remote sessions', () => {
    assert.equal(detectAdapterType({ kind: 'pty', isRemote: true }), 'wterm');
  });

  it('returns wterm for PTY sessions', () => {
    assert.equal(detectAdapterType({ kind: 'pty' }), 'wterm');
  });

  it('returns wterm for exec sessions', () => {
    assert.equal(detectAdapterType({ kind: 'exec' }), 'wterm');
  });

  it('returns wterm for vm-console backend', () => {
    assert.equal(detectAdapterType({ kind: 'local', shellBackend: 'vm-console' }), 'wterm');
  });

  it('returns custom-dom for local sessions', () => {
    assert.equal(detectAdapterType({ kind: 'local' }), 'custom-dom');
  });

  it('returns custom-dom for local with virtual-shell backend', () => {
    assert.equal(detectAdapterType({ kind: 'local', shellBackend: 'virtual-shell' }), 'custom-dom');
  });

  it('respects manual override to wterm', () => {
    assert.equal(detectAdapterType({ kind: 'local' }, 'wterm'), 'wterm');
  });

  it('respects manual override to custom-dom', () => {
    assert.equal(detectAdapterType({ kind: 'pty', isRemote: true }, 'custom-dom'), 'custom-dom');
  });

  it('ignores invalid override values', () => {
    assert.equal(detectAdapterType({ kind: 'local' }, 'invalid'), 'custom-dom');
    assert.equal(detectAdapterType({ kind: 'pty' }, 'bogus'), 'wterm');
  });

  it('handles empty session object', () => {
    assert.equal(detectAdapterType({}), 'custom-dom');
  });
});

describe('createAdapter', () => {
  it('creates custom-dom adapter by default', () => {
    const adapter = createAdapter('custom-dom');
    assert.equal(adapter.type(), 'custom-dom');
    assert.ok(adapter instanceof CustomDOMAdapter);
  });

  it('creates wterm adapter', () => {
    const adapter = createAdapter('wterm');
    assert.equal(adapter.type(), 'wterm');
  });

  it('falls back to custom-dom for unknown type', () => {
    const adapter = createAdapter('nonexistent');
    assert.equal(adapter.type(), 'custom-dom');
  });

  it('passes options through to adapter', () => {
    const adapter = createAdapter('custom-dom', { cols: 120, rows: 40 });
    const dims = adapter.dimensions();
    assert.equal(dims.cols, 120);
    assert.equal(dims.rows, 40);
  });
});

describe('CustomDOMAdapter', () => {
  let container;
  let adapter;

  beforeEach(() => {
    container = makeMockEl('div');
    adapter = new CustomDOMAdapter({ fontSize: 11 });
  });

  it('type returns custom-dom', () => {
    assert.equal(adapter.type(), 'custom-dom');
  });

  it('dimensions returns default cols/rows', () => {
    const d = adapter.dimensions();
    assert.equal(d.cols, 80);
    assert.equal(d.rows, 24);
  });

  it('dimensions returns custom cols/rows from constructor', () => {
    const a = new CustomDOMAdapter({ cols: 132, rows: 50 });
    const d = a.dimensions();
    assert.equal(d.cols, 132);
    assert.equal(d.rows, 50);
  });

  it('init creates output element if container has no .terminal-output child', async () => {
    await adapter.init(container);
    // Should have appended a child element
    assert.ok(container.children.length > 0);
  });

  it('init uses container itself if it has terminal-output class', async () => {
    container.classList.add('terminal-output');
    await adapter.init(container);
    // write should work directly on container
    adapter.write('test');
    assert.ok(container.innerHTML.includes('test'));
  });

  it('write appends text wrapped in terminal-stdout div', async () => {
    container.classList.add('terminal-output');
    await adapter.init(container);
    adapter.write('hello world');
    assert.ok(container.innerHTML.includes('hello world'));
    assert.ok(container.innerHTML.includes('terminal-stdout'));
  });

  it('write is a no-op for empty data', async () => {
    container.classList.add('terminal-output');
    await adapter.init(container);
    adapter.write('');
    adapter.write(null);
    assert.equal(container.innerHTML, '');
  });

  it('appendHTML inserts raw HTML', async () => {
    container.classList.add('terminal-output');
    await adapter.init(container);
    adapter.appendHTML('<div class="terminal-cmd">$ ls</div>');
    assert.ok(container.innerHTML.includes('terminal-cmd'));
    assert.ok(container.innerHTML.includes('$ ls'));
  });

  it('clear removes all output', async () => {
    container.classList.add('terminal-output');
    await adapter.init(container);
    adapter.write('something');
    adapter.clear();
    assert.equal(container.innerHTML, '');
  });

  it('resize updates stored dimensions', () => {
    adapter.resize(120, 40);
    const d = adapter.dimensions();
    assert.equal(d.cols, 120);
    assert.equal(d.rows, 40);
  });

  it('onData registers callback fired on Enter keydown', async () => {
    // Create a container that has an input field child for the adapter to find
    const inputEl = makeMockEl('input');
    inputEl.className = 'terminal-input';
    const inputRow = makeMockEl('div');
    inputRow.className = 'terminal-input-row';
    inputRow.querySelector = (sel) => {
      if (sel === '.terminal-input') return inputEl;
      if (sel === '.terminal-cwd') return null;
      return null;
    };

    const panel = makeMockEl('div');
    panel.className = 'panel';
    panel.querySelector = (sel) => {
      if (sel === '.terminal-input-row') return inputRow;
      return null;
    };

    container.classList.add('terminal-output');
    container.closest = (sel) => {
      if (sel === '.panel') return panel;
      return null;
    };

    await adapter.init(container);

    let receivedData = null;
    adapter.onData((data) => { receivedData = data; });

    // Simulate Enter keypress
    inputEl.value = 'ls -la';
    const handlers = inputEl._listeners['keydown'];
    assert.ok(handlers && handlers.length > 0, 'keydown listener should be registered');
    handlers[0]({ key: 'Enter' });

    assert.equal(receivedData, 'ls -la');
    assert.equal(inputEl.value, '', 'input should be cleared after Enter');
  });

  it('onResize registers callback', () => {
    let resized = false;
    adapter.onResize((c, r) => { resized = true; });
    // Can't easily trigger ResizeObserver in node, but registration shouldn't throw
    assert.ok(!resized);
  });

  it('destroy is safe to call multiple times', async () => {
    container.classList.add('terminal-output');
    await adapter.init(container);
    adapter.destroy();
    adapter.destroy(); // should not throw

    // write after destroy is a no-op
    adapter.write('should be no-op');
  });
});

describe('WTermAdapter (without CDN)', () => {
  it('type returns wterm', async () => {
    const { WTermAdapter } = await import('../clawser-terminal-adapter-wterm.mjs');
    const adapter = new WTermAdapter();
    assert.equal(adapter.type(), 'wterm');
  });

  it('dimensions returns default cols/rows', async () => {
    const { WTermAdapter } = await import('../clawser-terminal-adapter-wterm.mjs');
    const adapter = new WTermAdapter({ cols: 100, rows: 30 });
    const d = adapter.dimensions();
    assert.equal(d.cols, 100);
    assert.equal(d.rows, 30);
  });

  it('init fails in node environment (no CDN/WASM)', async () => {
    const { WTermAdapter } = await import('../clawser-terminal-adapter-wterm.mjs');
    const adapter = new WTermAdapter();
    const container = makeMockEl('div');

    await assert.rejects(
      () => adapter.init(container),
      (err) => {
        assert.ok(err.message.includes('CDN') || err.message.includes('failed'));
        return true;
      }
    );
  });

  it('fallback pattern works: wterm fails → custom-dom takes over', async () => {
    const { WTermAdapter } = await import('../clawser-terminal-adapter-wterm.mjs');
    const container = makeMockEl('div');
    container.classList.add('terminal-output');

    const wtermAdapter = new WTermAdapter();
    let fellBack = false;

    try {
      await wtermAdapter.init(container);
    } catch {
      const fallback = new CustomDOMAdapter();
      await fallback.init(container);
      fellBack = true;
      assert.equal(fallback.type(), 'custom-dom');
      fallback.write('fallback works');
      assert.ok(container.innerHTML.includes('fallback works'));
      fallback.destroy();
    }

    assert.ok(fellBack, 'wterm should fail in node test environment');
  });
});

describe('Adapter integration', () => {
  it('custom-dom adapter renders structured output from shell result', async () => {
    const container = makeMockEl('div');
    container.classList.add('terminal-output');
    const adapter = createAdapter('custom-dom');
    await adapter.init(container);

    // Simulate shell result
    adapter.appendHTML('<div class="terminal-cmd">$ ls</div>');
    adapter.appendHTML('<div class="terminal-stdout">file1.txt\nfile2.txt</div>');

    assert.ok(container.innerHTML.includes('file1.txt'));
    assert.ok(container.innerHTML.includes('terminal-cmd'));
    adapter.destroy();
  });

  it('adapter selection auto-detects correctly for all session types', () => {
    assert.equal(detectAdapterType({ kind: 'local' }), 'custom-dom');
    assert.equal(detectAdapterType({ kind: 'pty' }), 'wterm');
    assert.equal(detectAdapterType({ kind: 'pty', isRemote: true }), 'wterm');
    assert.equal(detectAdapterType({ kind: 'exec' }), 'wterm');
    assert.equal(detectAdapterType({ kind: 'local', shellBackend: 'vm-console' }), 'wterm');
    assert.equal(detectAdapterType({ kind: 'local', shellBackend: 'virtual-shell' }), 'custom-dom');
  });

  it('createAdapter + init + write + destroy lifecycle', async () => {
    const container = makeMockEl('div');
    container.classList.add('terminal-output');

    const adapter = createAdapter('custom-dom', { fontSize: 13 });
    await adapter.init(container);

    assert.equal(adapter.type(), 'custom-dom');
    adapter.write('hello');
    assert.ok(container.innerHTML.includes('hello'));

    adapter.clear();
    assert.equal(container.innerHTML, '');

    adapter.resize(100, 30);
    assert.deepEqual(adapter.dimensions(), { cols: 100, rows: 30 });

    adapter.destroy();
    // After destroy, write is a no-op
    adapter.write('gone');
  });
});
