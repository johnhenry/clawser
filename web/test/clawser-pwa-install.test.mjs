// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-pwa-install.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Stub window/navigator with the bits the module reads ─────────

const listeners = new Map();
const fireEvent = (type, payload) => {
  const cbs = listeners.get(type) || [];
  for (const cb of cbs) cb(payload);
};

const setupWindow = () => {
  globalThis.window = {
    addEventListener: (type, cb) => {
      const arr = listeners.get(type) || [];
      arr.push(cb);
      listeners.set(type, arr);
    },
    removeEventListener: (type, cb) => {
      const arr = (listeners.get(type) || []).filter(x => x !== cb);
      listeners.set(type, arr);
    },
    matchMedia: (q) => ({ matches: false, media: q }),
  };
};

const setStandalone = (val) => {
  globalThis.window.matchMedia = (q) => ({
    matches: q === '(display-mode: standalone)' && val,
    media: q,
  });
};

let mod;

beforeEach(async () => {
  listeners.clear();
  setupWindow();
  // Reset module state via the documented test helper
  mod = await import('../clawser-pwa-install.js');
  mod.__resetForTests();
});

describe('clawser-pwa-install', () => {
  it('starts as not installable + not installed', () => {
    mod.initPwaInstall();
    const s = mod.getInstallState();
    assert.equal(s.installable, false);
    assert.equal(s.installed, false);
  });

  it('flips to installable after beforeinstallprompt fires', () => {
    mod.initPwaInstall();
    let lastState = null;
    mod.onInstallStateChange((s) => { lastState = s; });

    const prompt = {
      prompt: () => {},
      userChoice: Promise.resolve({ outcome: 'accepted' }),
      preventDefault: () => {},
    };
    fireEvent('beforeinstallprompt', prompt);

    assert.equal(mod.getInstallState().installable, true);
    assert.equal(lastState.installable, true);
  });

  it('tryInstall returns "unavailable" when no prompt is captured', async () => {
    mod.initPwaInstall();
    const result = await mod.tryInstall();
    assert.equal(result.outcome, 'unavailable');
  });

  it('tryInstall fires the captured prompt and reports user choice', async () => {
    mod.initPwaInstall();
    let prompted = false;
    const prompt = {
      prompt: () => { prompted = true; },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
      preventDefault: () => {},
    };
    fireEvent('beforeinstallprompt', prompt);

    const result = await mod.tryInstall();
    assert.equal(prompted, true);
    assert.equal(result.outcome, 'accepted');
    // After consumption, no longer installable
    assert.equal(mod.getInstallState().installable, false);
  });

  it('marks installed when appinstalled fires', () => {
    mod.initPwaInstall();
    fireEvent('appinstalled', {});
    assert.equal(mod.getInstallState().installed, true);
    assert.equal(mod.getInstallState().installable, false);
  });

  it('isStandalone respects display-mode media query', async () => {
    setStandalone(true);
    // Re-import not needed — isStandalone reads window.matchMedia at call time
    assert.equal(mod.isStandalone(), true);

    setStandalone(false);
    assert.equal(mod.isStandalone(), false);
  });

  it('detectPlatform recognises iOS / Android / desktop', () => {
    const setUA = (ua) => Object.defineProperty(globalThis.navigator, 'userAgent', {
      value: ua, configurable: true,
    });
    setUA('iPhone Safari');
    assert.equal(mod.detectPlatform(), 'ios');
    setUA('Android Chrome');
    assert.equal(mod.detectPlatform(), 'android');
    setUA('Mac Chrome');
    assert.equal(mod.detectPlatform(), 'desktop');
  });

  it('listener fires immediately with current state on subscribe', () => {
    mod.initPwaInstall();
    let saw = null;
    mod.onInstallStateChange((s) => { saw = s; });
    assert.ok(saw, 'callback should fire immediately');
    assert.equal(typeof saw.installable, 'boolean');
    assert.equal(typeof saw.platform, 'string');
  });

  it('teardown function returned by initPwaInstall removes listeners', () => {
    const teardown = mod.initPwaInstall();
    teardown();
    fireEvent('beforeinstallprompt', { preventDefault: () => {} });
    // installable should remain false because listener was detached
    assert.equal(mod.getInstallState().installable, false);
  });
});
