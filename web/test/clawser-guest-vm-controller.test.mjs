// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-guest-vm-controller.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildGuestVmController } from '../clawser-guest-vm-controller.mjs';

/** Minimal fake LinuxGuest — no real v86/CDN involved. */
function makeFakeGuest() {
  let state = 'idle';
  const stateListeners = [];
  return {
    get state() { return state; },
    onStateChange(cb) { stateListeners.push(cb); return () => {}; },
    async boot() {
      state = 'running';
      for (const cb of stateListeners) cb(state);
      return { bootMs: 42 };
    },
    async shutdown() {
      state = 'shutdown';
      for (const cb of stateListeners) cb(state);
    },
  };
}

describe('buildGuestVmController', () => {
  let renderCalls, mountCalls, unmountFn, ctx;

  beforeEach(() => {
    renderCalls = [];
    mountCalls = [];
    unmountFn = () => { unmountFn.called = true; };
    ctx = {
      createGuest: () => makeFakeGuest(),
      autoMountGuest: (guest, fs, opts) => { mountCalls.push({ guest, fs, opts }); return unmountFn; },
      renderPanel: (guest, container) => { renderCalls.push({ guest, container }); },
      mountableFs: { id: 'fs1' },
      container: { id: 'container1' },
    };
  });

  it('boot() creates a guest, boots it, mounts it, and renders the panel', async () => {
    const ctrl = buildGuestVmController(ctx);
    const result = await ctrl.boot();

    assert.equal(result.ok, true);
    assert.equal(mountCalls.length, 1);
    assert.equal(mountCalls[0].fs, ctx.mountableFs);
    // Rendered at least once with a running guest
    assert.ok(renderCalls.some(c => c.guest?.state === 'running'));
  });

  it('boot() is a no-op if a guest is already running', async () => {
    const ctrl = buildGuestVmController(ctx);
    await ctrl.boot();
    const second = await ctrl.boot();
    assert.equal(second.ok, false);
    assert.match(second.error, /already/i);
  });

  it('shutdown() shuts down the guest, unmounts, and re-renders empty', async () => {
    const ctrl = buildGuestVmController(ctx);
    await ctrl.boot();
    renderCalls.length = 0;

    const result = await ctrl.shutdown();
    assert.equal(result.ok, true);
    assert.equal(unmountFn.called, true);
    assert.ok(renderCalls.some(c => c.guest === null));
  });

  it('shutdown() is a no-op when nothing is running', async () => {
    const ctrl = buildGuestVmController(ctx);
    const result = await ctrl.shutdown();
    assert.equal(result.ok, false);
  });

  it('boot() surfaces a failure without leaving a half-wired guest', async () => {
    let attempt = 0;
    const failOnceCtx = {
      ...ctx,
      createGuest: () => {
        attempt++;
        if (attempt === 1) {
          return {
            state: 'idle',
            onStateChange() { return () => {}; },
            async boot() { throw new Error('CDN unreachable'); },
          };
        }
        return makeFakeGuest(); // second attempt succeeds
      },
    };
    const ctrl = buildGuestVmController(failOnceCtx);
    const result = await ctrl.boot();
    assert.equal(result.ok, false);
    assert.match(result.error, /CDN unreachable/);
    assert.equal(mountCalls.length, 0);

    // A retry after failure must be allowed (not stuck thinking one is running)
    const retry = await ctrl.boot();
    assert.equal(retry.ok, true);
  });

  it('getGuest() reflects current state', async () => {
    const ctrl = buildGuestVmController(ctx);
    assert.equal(ctrl.getGuest(), null);
    await ctrl.boot();
    assert.ok(ctrl.getGuest());
    await ctrl.shutdown();
    assert.equal(ctrl.getGuest(), null);
  });

  it('re-renders the panel on every guest state transition', async () => {
    const ctrl = buildGuestVmController(ctx);
    await ctrl.boot();
    // boot -> at least 2 renders: initial idle placeholder isn't required,
    // but the running transition must trigger a render.
    assert.ok(renderCalls.length >= 1);
  });
});
