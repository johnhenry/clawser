// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mobile.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Extend DOM stubs for mobile tests ─────────────────────────

/** Create a minimal element stub with the features mobile.js needs. */
const makeElement = (tag = 'div', attrs = {}) => {
  const classList = new Set();
  const children = [];
  const listeners = {};
  const dataset = {};
  const style = {};
  return {
    tagName: tag.toUpperCase(),
    id: attrs.id || '',
    className: '',
    innerHTML: '',
    dataset,
    style,
    children,
    parentElement: null,
    scrollTop: 0,
    scrollHeight: 100,
    classList: {
      add: (...c) => c.forEach(x => classList.add(x)),
      remove: (...c) => c.forEach(x => classList.delete(x)),
      toggle: (c, force) => {
        if (force === undefined) {
          classList.has(c) ? classList.delete(c) : classList.add(c);
        } else {
          force ? classList.add(c) : classList.delete(c);
        }
      },
      contains: (c) => classList.has(c),
    },
    addEventListener: (ev, fn, opts) => {
      (listeners[ev] = listeners[ev] || []).push(fn);
    },
    removeEventListener: (ev, fn) => {
      listeners[ev] = (listeners[ev] || []).filter(f => f !== fn);
    },
    _fire: (ev, data) => {
      for (const fn of listeners[ev] || []) fn(data);
    },
    _listeners: listeners,
    appendChild: (child) => {
      child.parentElement = this;
      children.push(child);
    },
    insertBefore: (newChild, ref) => {
      children.splice(children.indexOf(ref), 0, newChild);
    },
    remove: () => {},
    setAttribute: () => {},
    getAttribute: (a) => attrs[a] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    replaceWith: () => {},
    scrollIntoView: () => {},
  };
};

// Save/restore globals
let savedWindow;
let savedDocument;

beforeEach(() => {
  savedWindow = { innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight };
  savedDocument = globalThis.document;

  const elements = {};
  const bodyClassList = new Set();
  const htmlStyle = {};

  globalThis.window = globalThis;
  globalThis.innerWidth = 1024;
  globalThis.innerHeight = 768;
  globalThis.visualViewport = null;
  globalThis.requestAnimationFrame = (fn) => fn();
  globalThis.addEventListener = globalThis.addEventListener || (() => {});
  globalThis.removeEventListener = globalThis.removeEventListener || (() => {});
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };

  globalThis.document = {
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => makeElement(tag),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: {
      classList: {
        add: (...c) => c.forEach(x => bodyClassList.add(x)),
        remove: (...c) => c.forEach(x => bodyClassList.delete(x)),
        toggle: (c, force) => {
          if (force === undefined) {
            bodyClassList.has(c) ? bodyClassList.delete(c) : bodyClassList.add(c);
          } else {
            force ? bodyClassList.add(c) : bodyClassList.delete(c);
          }
        },
        contains: (c) => bodyClassList.has(c),
      },
    },
    documentElement: {
      style: {
        setProperty: (k, v) => { htmlStyle[k] = v; },
        removeProperty: (k) => { delete htmlStyle[k]; },
        _props: htmlStyle,
      },
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    activeElement: null,
    readyState: 'complete',
  };

  elements.messages = makeElement('div', { id: 'messages' });
  elements.messages.parentElement = makeElement('div');
  elements.userInput = makeElement('input', { id: 'userInput' });
  elements.sendBtn = makeElement('button', { id: 'sendBtn' });
});

afterEach(() => {
  globalThis.innerWidth = savedWindow.innerWidth;
  globalThis.innerHeight = savedWindow.innerHeight;
  globalThis.document = savedDocument;
});

// ── Import after stubs ────────────────────────────────────────

describe('clawser-mobile — device detection', async () => {
  const { isMobile, isTouch, isPortrait, getBreakpoint } = await import('../clawser-mobile.js');

  it('isMobile() returns false for wide viewport', () => {
    globalThis.innerWidth = 1024;
    assert.equal(isMobile(), false);
  });

  it('isMobile() returns true for narrow viewport', () => {
    globalThis.innerWidth = 375;
    assert.equal(isMobile(), true);
  });

  it('isMobile() returns true at exactly 768', () => {
    globalThis.innerWidth = 768;
    assert.equal(isMobile(), true);
  });

  it('isMobile() returns false at 769', () => {
    globalThis.innerWidth = 769;
    assert.equal(isMobile(), false);
  });

  it('isTouch() detects touch support via ontouchstart', () => {
    globalThis.ontouchstart = null;
    assert.equal(isTouch(), true);
    delete globalThis.ontouchstart;
  });

  it('isTouch() detects touch support via maxTouchPoints', () => {
    const orig = globalThis.navigator;
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: { ...orig, maxTouchPoints: 5 },
        configurable: true,
      });
      assert.equal(isTouch(), true);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: orig, configurable: true });
    }
  });

  it('isPortrait() based on dimensions', () => {
    globalThis.innerWidth = 375;
    globalThis.innerHeight = 812;
    assert.equal(isPortrait(), true);

    globalThis.innerWidth = 812;
    globalThis.innerHeight = 375;
    assert.equal(isPortrait(), false);
  });

  it('getBreakpoint() returns correct tier', () => {
    globalThis.innerWidth = 320;
    assert.equal(getBreakpoint(), 'compact');

    globalThis.innerWidth = 480;
    assert.equal(getBreakpoint(), 'compact');

    globalThis.innerWidth = 600;
    assert.equal(getBreakpoint(), 'medium');

    globalThis.innerWidth = 768;
    assert.equal(getBreakpoint(), 'medium');

    globalThis.innerWidth = 1024;
    assert.equal(getBreakpoint(), 'full');
  });
});

describe('clawser-mobile — switchPanel', async () => {
  const { switchPanel } = await import('../clawser-mobile.js');

  it('is a function', () => {
    assert.equal(typeof switchPanel, 'function');
  });

  it('does not throw with missing DOM', () => {
    // Should gracefully handle missing sidebar
    assert.doesNotThrow(() => switchPanel('tools'));
  });
});

describe('clawser-mobile — initMobile / destroyMobile', async () => {
  const { initMobile, destroyMobile } = await import('../clawser-mobile.js');

  it('initMobile does not throw in stub environment', () => {
    assert.doesNotThrow(() => initMobile());
  });

  it('destroyMobile cleans up', () => {
    initMobile();
    assert.doesNotThrow(() => destroyMobile());
  });

  it('sets --keyboard-height CSS property on init', () => {
    initMobile();
    assert.equal(
      document.documentElement.style._props['--keyboard-height'],
      '0px'
    );
    destroyMobile();
  });

  it('removes --keyboard-height on destroy', () => {
    initMobile();
    destroyMobile();
    assert.equal(
      document.documentElement.style._props['--keyboard-height'],
      undefined
    );
  });
});

describe('clawser-mobile — PANEL_ORDER coverage', async () => {
  const { switchPanel } = await import('../clawser-mobile.js');

  it('switching to each known panel does not throw', () => {
    const panels = [
      'chat', 'tools', 'files', 'memory', 'goals',
      'events', 'skills', 'terminal', 'dashboard',
      'servers', 'toolMgmt', 'agents', 'channels',
      'marketplace', 'swarms', 'transfers', 'mesh',
      'peers', 'remote', 'config',
    ];
    for (const p of panels) {
      assert.doesNotThrow(() => switchPanel(p));
    }
  });
});

describe('clawser-mobile — exports', async () => {
  const mod = await import('../clawser-mobile.js');

  it('exports all expected functions', () => {
    const expected = [
      'isMobile', 'isTouch', 'isPortrait', 'getBreakpoint',
      'switchPanel', 'initMobile', 'destroyMobile',
    ];
    for (const name of expected) {
      assert.equal(typeof mod[name], 'function', `missing export: ${name}`);
    }
  });
});
