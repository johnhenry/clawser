// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-channel-matrix.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  MatrixPlugin,
} from '../clawser-channel-matrix.js';

describe('MatrixPlugin', () => {
  let plugin;
  let fetchCalls;

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      return {
        ok: true,
        json: async () => ({ next_batch: 'batch_2', rooms: { join: {} } }),
      };
    };
    plugin = new MatrixPlugin({
      homeserver: 'https://matrix.example.org',
      accessToken: 'MAT_TOKEN',
      roomId: '!room:example.org',
    });
  });

  afterEach(() => {
    plugin.stop();
    delete globalThis.fetch;
  });

  // ── constructor ──────────────────────────────────────────

  it('stores config from constructor', () => {
    assert.equal(plugin.config.homeserver, 'https://matrix.example.org');
    assert.equal(plugin.config.accessToken, 'MAT_TOKEN');
    assert.equal(plugin.config.roomId, '!room:example.org');
  });

  it('defaults pollingTimeout to 30000', () => {
    assert.equal(plugin.config.pollingTimeout, 30000);
  });

  // ── createInboundMessage ─────────────────────────────────

  it('normalizes a Matrix m.room.message event', () => {
    const raw = {
      event_id: '$evt_1',
      sender: '@alice:example.org',
      content: { msgtype: 'm.text', body: 'hello matrix' },
      origin_server_ts: 1700000000000,
    };
    const msg = plugin.createInboundMessage(raw);
    assert.equal(msg.id, '$evt_1');
    assert.equal(msg.text, 'hello matrix');
    assert.equal(msg.sender, '@alice:example.org');
    assert.equal(msg.channel, 'matrix');
    assert.equal(msg.timestamp, 1700000000000);
  });

  it('handles missing content gracefully', () => {
    const msg = plugin.createInboundMessage({ event_id: '$x' });
    assert.equal(msg.text, '');
    assert.equal(msg.sender, 'unknown');
  });

  // ── lifecycle ────────────────────────────────────────────

  it('start sets running to true', () => {
    plugin.start();
    assert.equal(plugin.running, true);
  });

  it('stop sets running to false', () => {
    plugin.start();
    plugin.stop();
    assert.equal(plugin.running, false);
  });

  // ── sendMessage ──────────────────────────────────────────

  it('sendMessage calls Matrix PUT /send/m.room.message', async () => {
    const ok = await plugin.sendMessage('hello matrix world');
    assert.equal(ok, true);
    assert.equal(fetchCalls.length, 1);
    const url = fetchCalls[0].url;
    assert.ok(url.includes('matrix.example.org'));
    assert.ok(url.includes('m.room.message'));
    assert.equal(fetchCalls[0].opts.method, 'PUT');
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.msgtype, 'm.text');
    assert.equal(body.body, 'hello matrix world');
  });

  it('sendMessage includes auth header', async () => {
    await plugin.sendMessage('auth test');
    const headers = fetchCalls[0].opts.headers;
    assert.ok(headers['Authorization'].includes('Bearer MAT_TOKEN'));
  });

  it('sendMessage allows overriding roomId', async () => {
    await plugin.sendMessage('hi', { roomId: '!other:example.org' });
    assert.ok(fetchCalls[0].url.includes(encodeURIComponent('!other:example.org')));
  });

  it('sendMessage returns false on failure', async () => {
    globalThis.fetch = async () => ({ ok: false });
    const ok = await plugin.sendMessage('fail');
    assert.equal(ok, false);
  });

  // ── onMessage ────────────────────────────────────────────

  it('onMessage registers callback', () => {
    const cb = () => {};
    plugin.onMessage(cb);
    assert.equal(plugin._callback, cb);
  });

  // ── sync processing ──────────────────────────────────────

  it('processSyncResponse dispatches room messages', () => {
    const received = [];
    plugin.onMessage((msg) => received.push(msg));
    plugin.processSyncResponse({
      next_batch: 'batch_3',
      rooms: {
        join: {
          '!room:example.org': {
            timeline: {
              events: [
                {
                  event_id: '$e1',
                  type: 'm.room.message',
                  sender: '@bob:example.org',
                  content: { msgtype: 'm.text', body: 'sync msg' },
                  origin_server_ts: 1700000001000,
                },
              ],
            },
          },
        },
      },
    });
    assert.equal(received.length, 1);
    assert.equal(received[0].text, 'sync msg');
  });

  it('processSyncResponse updates since token', () => {
    plugin.processSyncResponse({ next_batch: 'batch_99', rooms: { join: {} } });
    assert.equal(plugin._since, 'batch_99');
  });

  it('processSyncResponse ignores non-message events', () => {
    const received = [];
    plugin.onMessage((msg) => received.push(msg));
    plugin.processSyncResponse({
      next_batch: 'batch_4',
      rooms: {
        join: {
          '!room:example.org': {
            timeline: {
              events: [
                { event_id: '$e2', type: 'm.room.member', sender: '@x:y', content: {} },
              ],
            },
          },
        },
      },
    });
    assert.equal(received.length, 0);
  });
});
