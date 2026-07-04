// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-panel-dirty.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── DOM stub ─────────────────────────────────────────────────────

const makeInput = (id, opts = {}) => {
  const listeners = {};
  const el = {
    id,
    type: opts.type || 'text',
    value: opts.value ?? '',
    checked: opts.checked ?? false,
    name: opts.name || '',
    dataset: {},
    addEventListener(type, cb) { (listeners[type] ||= []).push(cb); },
    removeEventListener(type, cb) {
      listeners[type] = (listeners[type] || []).filter(c => c !== cb);
    },
    _fire(type) { for (const cb of listeners[type] || []) cb({ target: el }); },
    querySelectorAll: () => [],
  };
  return el;
};

const setupDom = (inputs) => {
  const byId = new Map();
  const byName = new Map();
  for (const el of inputs) {
    byId.set(el.id, el);
    if (el.name) {
      const arr = byName.get(el.name) || [];
      arr.push(el);
      byName.set(el.name, arr);
    }
  }
  globalThis.document = {
    getElementById: (id) => byId.get(id) || null,
    querySelectorAll: (sel) => {
      // Minimal selector parsing for `input[type="radio"][name="X"]`
      const m = sel.match(/name="([^"]+)"/);
      if (m) return byName.get(m[1]) || [];
      return [];
    },
  };
  return inputs;
};

// ── Tests ────────────────────────────────────────────────────────

const mod = await import('../clawser-panel-dirty.mjs');

describe('panel-dirty: markDirty / markClean / isDirty', () => {
  beforeEach(() => mod.__resetForTests());

  it('marks an element dirty and back to clean', () => {
    const el = makeInput('x');
    assert.equal(mod.isDirty(el), false);
    mod.markDirty(el);
    assert.equal(mod.isDirty(el), true);
    mod.markClean(el);
    assert.equal(mod.isDirty(el), false);
  });

  it('handles null/undefined safely', () => {
    assert.doesNotThrow(() => mod.markDirty(null));
    assert.doesNotThrow(() => mod.markClean(null));
    assert.equal(mod.isDirty(null), false);
    assert.equal(mod.isDirty(undefined), false);
  });
});

describe('panel-dirty: bindDirtyTracking', () => {
  it('marks dirty on first input event', () => {
    const el = makeInput('x');
    mod.bindDirtyTracking(el);
    assert.equal(mod.isDirty(el), false);
    el._fire('input');
    assert.equal(mod.isDirty(el), true);
  });

  it('marks dirty on first change event', () => {
    const el = makeInput('x');
    mod.bindDirtyTracking(el);
    el._fire('change');
    assert.equal(mod.isDirty(el), true);
  });

  it('is idempotent — second bind does not double-attach', () => {
    const el = makeInput('x');
    mod.bindDirtyTracking(el);
    mod.bindDirtyTracking(el);
    el._fire('input');
    // Still dirty, no errors from duplicate listeners
    assert.equal(mod.isDirty(el), true);
  });
});

describe('panel-dirty: setIfClean', () => {
  it('updates clean inputs', () => {
    const el = makeInput('autonomy', { value: '' });
    setupDom([el]);
    const ok = mod.setIfClean('autonomy', '42');
    assert.equal(ok, true);
    assert.equal(el.value, '42');
  });

  it('skips dirty inputs', () => {
    const el = makeInput('autonomy', { value: 'user-typed' });
    setupDom([el]);
    mod.markDirty(el);
    const ok = mod.setIfClean('autonomy', 'overwrite');
    assert.equal(ok, false);
    assert.equal(el.value, 'user-typed');
  });

  it('handles checkbox type', () => {
    const el = makeInput('flag', { type: 'checkbox', checked: false });
    setupDom([el]);
    mod.setIfClean('flag', true);
    assert.equal(el.checked, true);
    mod.setIfClean('flag', false);
    assert.equal(el.checked, false);
  });

  it('returns false for missing inputs', () => {
    setupDom([]);
    assert.equal(mod.setIfClean('nope', 'x'), false);
  });

  it('coerces null to empty string', () => {
    const el = makeInput('x', { value: 'old' });
    setupDom([el]);
    mod.setIfClean('x', null);
    assert.equal(el.value, '');
  });
});

describe('panel-dirty: setRadioIfClean', () => {
  it('selects the matching radio when none are dirty', () => {
    const r1 = makeInput('r1', { type: 'radio', name: 'level', value: 'low' });
    const r2 = makeInput('r2', { type: 'radio', name: 'level', value: 'high' });
    setupDom([r1, r2]);
    const ok = mod.setRadioIfClean('level', 'high');
    assert.equal(ok, true);
    assert.equal(r1.checked, false);
    assert.equal(r2.checked, true);
  });

  it('leaves the group alone if any member is dirty', () => {
    const r1 = makeInput('r1', { type: 'radio', name: 'level', value: 'low', checked: true });
    const r2 = makeInput('r2', { type: 'radio', name: 'level', value: 'high' });
    setupDom([r1, r2]);
    mod.markDirty(r1);
    const ok = mod.setRadioIfClean('level', 'high');
    assert.equal(ok, false);
    // r1 remains checked because the group is dirty
    assert.equal(r1.checked, true);
    assert.equal(r2.checked, false);
  });
});

describe('panel-dirty: markPanelClean', () => {
  it('clears dirty flag for listed ids', () => {
    const a = makeInput('a');
    const b = makeInput('b');
    setupDom([a, b]);
    mod.markDirty(a);
    mod.markDirty(b);
    mod.markPanelClean(['a', 'b']);
    assert.equal(mod.isDirty(a), false);
    assert.equal(mod.isDirty(b), false);
  });

  it('handles missing ids without throwing', () => {
    setupDom([]);
    assert.doesNotThrow(() => mod.markPanelClean(['nope']));
  });
});

describe('panel-dirty: integrated render flow', () => {
  it('clean → updates; user types → preserves; save → clean → updates again', () => {
    const a = makeInput('a', { value: '' });
    const b = makeInput('b', { value: '' });
    setupDom([a, b]);
    mod.bindDirtyTracking(a);
    mod.bindDirtyTracking(b);

    // 1. Initial clean render
    mod.setIfClean('a', '1');
    mod.setIfClean('b', '2');
    assert.equal(a.value, '1');
    assert.equal(b.value, '2');

    // 2. User types into a
    a.value = 'user-edit';
    a._fire('input');

    // 3. External update fires renderer — only b should change
    mod.setIfClean('a', 'remote-1');
    mod.setIfClean('b', 'remote-2');
    assert.equal(a.value, 'user-edit');
    assert.equal(b.value, 'remote-2');

    // 4. User saves — both clean again
    mod.markPanelClean(['a', 'b']);

    // 5. Next external update applies to both
    mod.setIfClean('a', 'after-save-1');
    mod.setIfClean('b', 'after-save-2');
    assert.equal(a.value, 'after-save-1');
    assert.equal(b.value, 'after-save-2');
  });
});
