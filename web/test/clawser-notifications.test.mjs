// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-notifications.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { NotificationManager } from '../clawser-notifications.js';

describe('NotificationManager', () => {
  let mgr;

  beforeEach(() => {
    mgr = new NotificationManager();
  });

  it('constructor defaults', () => {
    assert.equal(mgr.pending, 0);
    assert.deepEqual(mgr.list(), []);
    const prefs = mgr.preferences;
    assert.equal(prefs.info, true);
    assert.equal(prefs.error, true);
  });

  it('setPreference updates preference', () => {
    mgr.setPreference('info', false);
    assert.equal(mgr.preferences.info, false);
  });

  it('notify adds to history (immediate mode)', () => {
    mgr.notify({ type: 'info', title: 'Test', body: 'Hello' });
    const list = mgr.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].title, 'Test');
    assert.equal(list[0].body, 'Hello');
    assert.equal(list[0].type, 'info');
  });

  it('notify respects type preference (disabled)', () => {
    mgr.setPreference('warning', false);
    mgr.notify({ type: 'warning', title: 'Warn', body: 'skip' });
    assert.equal(mgr.list().length, 0);
  });

  it('notify auto-generates id', () => {
    mgr.notify({ type: 'info', title: 'A' });
    const list = mgr.list();
    assert.ok(list[0].id.startsWith('notif-'));
  });

  it('dismiss removes by id', () => {
    mgr.notify({ type: 'info', title: 'A' });
    const id = mgr.list()[0].id;
    mgr.dismiss(id);
    assert.equal(mgr.list().length, 0);
  });

  it('clear empties all', () => {
    mgr.notify({ type: 'info', title: 'A' });
    mgr.notify({ type: 'error', title: 'B' });
    mgr.clear();
    assert.equal(mgr.list().length, 0);
  });

  it('onNotify setter receives notifications', () => {
    let received = null;
    mgr.onNotify = (n) => { received = n; };
    mgr.notify({ type: 'success', title: 'Done', body: 'ok' });
    assert.ok(received);
    assert.equal(received.title, 'Done');
  });

  it('batching coalesces rapid notifications', async () => {
    const delivered = [];
    const batched = new NotificationManager({
      batchWindow: 50,
      onNotify: (n) => { delivered.push(n); },
    });

    batched.notify({ type: 'info', title: 'A', body: '1' });
    batched.notify({ type: 'info', title: 'B', body: '2' });
    batched.notify({ type: 'info', title: 'C', body: '3' });

    // pending should have items before flush
    assert.equal(batched.pending, 3);

    // After batch window, should deliver summary
    await new Promise(r => setTimeout(r, 100));
    assert.equal(delivered.length, 1); // summary notification
    assert.ok(delivered[0].title.includes('3'));
    batched.clear();
  });

  it('flush delivers batched notifications immediately', () => {
    const delivered = [];
    const batched = new NotificationManager({
      batchWindow: 10000,
      onNotify: (n) => { delivered.push(n); },
    });

    batched.notify({ type: 'info', title: 'X', body: 'y' });
    assert.equal(batched.pending, 1);
    batched.flush();
    assert.equal(delivered.length, 1);
    assert.equal(batched.pending, 0);
    batched.clear();
  });

  it('single batched notification delivers directly', () => {
    const delivered = [];
    const batched = new NotificationManager({
      batchWindow: 10000,
      onNotify: (n) => { delivered.push(n); },
    });

    batched.notify({ type: 'error', title: 'Solo', body: 'only one' });
    batched.flush();
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].title, 'Solo');
    batched.clear();
  });
});
