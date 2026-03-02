// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-fs-observer.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Stub EventTarget for Node ──────────────────────────────────
globalThis.EventTarget = globalThis.EventTarget || class {
  #listeners = {};
  addEventListener(type, fn) { (this.#listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) {
    const list = this.#listeners[type];
    if (list) { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); }
  }
  dispatchEvent(evt) {
    for (const fn of (this.#listeners[evt.type] || [])) fn(evt);
    return true;
  }
};
globalThis.CustomEvent = globalThis.CustomEvent || class CustomEvent extends Event {
  constructor(type, opts = {}) { super(type); this.detail = opts.detail ?? null; }
};

import { FsObserver } from '../clawser-fs-observer.js';

// ── FsObserver ──────────────────────────────────────────────────

describe('FsObserver', () => {
  let observer;

  beforeEach(() => {
    observer = new FsObserver();
  });

  afterEach(() => {
    observer.destroy();
  });

  it('constructor initializes with no watched paths', () => {
    assert.equal(observer.watchedPaths.length, 0);
    assert.equal(typeof observer.available, 'boolean');
  });

  it('available reflects FileSystemObserver feature detection', () => {
    // In Node test env, FileSystemObserver is not defined
    assert.equal(observer.available, false);
  });

  it('watchMount adds a path to the watch list (graceful no-op when unavailable)', () => {
    observer.watchMount('/mnt/test');
    assert.equal(observer.watchedPaths.length, 1);
    assert.equal(observer.watchedPaths[0], '/mnt/test');
  });

  it('watchMount is idempotent — duplicate paths not added', () => {
    observer.watchMount('/mnt/test');
    observer.watchMount('/mnt/test');
    assert.equal(observer.watchedPaths.length, 1);
  });

  it('unwatchMount removes a path', () => {
    observer.watchMount('/mnt/alpha');
    observer.watchMount('/mnt/beta');
    const removed = observer.unwatchMount('/mnt/alpha');
    assert.equal(removed, true);
    assert.equal(observer.watchedPaths.length, 1);
    assert.equal(observer.watchedPaths[0], '/mnt/beta');
  });

  it('unwatchMount returns false for unknown path', () => {
    assert.equal(observer.unwatchMount('/mnt/unknown'), false);
  });

  it('destroy clears all watches', () => {
    observer.watchMount('/mnt/a');
    observer.watchMount('/mnt/b');
    observer.destroy();
    assert.equal(observer.watchedPaths.length, 0);
  });

  it('emits mount:changed event via dispatchEvent after debounce', async () => {
    let received = null;
    observer.addEventListener('mount:changed', (e) => {
      received = e.detail;
    });
    // Simulate an internal change notification
    observer._notifyChange('/mnt/test', [{ type: 'modified', name: 'file.txt' }]);
    // Wait for debounce (500ms + margin)
    await new Promise(r => setTimeout(r, 600));
    assert.ok(received);
    assert.equal(received.path, '/mnt/test');
    assert.equal(received.changes.length, 1);
  });

  it('debounces rapid change notifications', async () => {
    let callCount = 0;
    observer.addEventListener('mount:changed', () => { callCount++; });
    observer._notifyChange('/mnt/test', [{ type: 'modified', name: 'a.txt' }]);
    observer._notifyChange('/mnt/test', [{ type: 'modified', name: 'b.txt' }]);
    observer._notifyChange('/mnt/test', [{ type: 'modified', name: 'c.txt' }]);
    // Before debounce fires, count should be 0
    assert.equal(callCount, 0);
    // Wait for debounce (500ms + margin)
    await new Promise(r => setTimeout(r, 600));
    assert.equal(callCount, 1);
  });

  it('isWatching returns correct status', () => {
    assert.equal(observer.isWatching('/mnt/test'), false);
    observer.watchMount('/mnt/test');
    assert.equal(observer.isWatching('/mnt/test'), true);
  });
});

describe('FsObserver with mock FileSystemObserver', () => {
  let original;

  beforeEach(() => {
    original = globalThis.FileSystemObserver;
    globalThis.FileSystemObserver = class {
      constructor(cb) { this._cb = cb; }
      observe(handle) { this._handle = handle; }
      disconnect() { this._handle = null; }
    };
  });

  afterEach(() => {
    if (original === undefined) delete globalThis.FileSystemObserver;
    else globalThis.FileSystemObserver = original;
  });

  it('available returns true when FileSystemObserver exists', () => {
    const obs = new FsObserver();
    assert.equal(obs.available, true);
    obs.destroy();
  });
});
