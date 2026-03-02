// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-channel-telegram.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  TelegramPlugin,
} from '../clawser-channel-telegram.js';

describe('TelegramPlugin', () => {
  let plugin;
  let fetchCalls;

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      // Default: return empty updates
      return {
        ok: true,
        json: async () => ({ ok: true, result: [] }),
      };
    };
    plugin = new TelegramPlugin({
      botToken: 'BOT123',
      chatId: '456',
      pollingInterval: 100,
    });
  });

  afterEach(() => {
    plugin.stop();
    delete globalThis.fetch;
  });

  // ── constructor ──────────────────────────────────────────

  it('stores config from constructor', () => {
    assert.equal(plugin.config.botToken, 'BOT123');
    assert.equal(plugin.config.chatId, '456');
    assert.equal(plugin.config.pollingInterval, 100);
  });

  it('defaults pollingInterval to 3000', () => {
    const p = new TelegramPlugin({ botToken: 'X', chatId: '1' });
    assert.equal(p.config.pollingInterval, 3000);
  });

  // ── createInboundMessage ─────────────────────────────────

  it('normalizes a Telegram update', () => {
    const raw = {
      update_id: 100,
      message: {
        message_id: 42,
        text: 'hello bot',
        from: { id: 789, first_name: 'Alice', username: 'alice' },
        chat: { id: 456 },
        date: 1700000000,
      },
    };
    const msg = plugin.createInboundMessage(raw);
    assert.equal(msg.id, '42');
    assert.equal(msg.content, 'hello bot');
    assert.equal(msg.sender.username, 'alice');
    assert.equal(msg.channel, 'telegram');
    assert.equal(msg.timestamp, 1700000000000);
  });

  it('falls back to first_name when no username', () => {
    const raw = {
      update_id: 101,
      message: {
        message_id: 43,
        text: 'hi',
        from: { id: 10, first_name: 'Bob' },
        chat: { id: 1 },
        date: 1700000001,
      },
    };
    const msg = plugin.createInboundMessage(raw);
    assert.equal(msg.sender.name, 'Bob');
  });

  it('handles missing message gracefully', () => {
    const msg = plugin.createInboundMessage({ update_id: 102 });
    assert.equal(msg.content, '');
    assert.equal(msg.sender.id, 'unknown');
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

  it('sendMessage calls Telegram sendMessage API', async () => {
    await plugin.sendMessage('hello world');
    assert.equal(fetchCalls.length, 1);
    const call = fetchCalls[0];
    assert.ok(call.url.includes('bot BOT123'.replace(' ', '')));
    assert.ok(call.url.includes('/sendMessage'));
    const body = JSON.parse(call.opts.body);
    assert.equal(body.chat_id, '456');
    assert.equal(body.text, 'hello world');
  });

  it('sendMessage allows overriding chatId', async () => {
    await plugin.sendMessage('hi', { chatId: '999' });
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.chat_id, '999');
  });

  it('sendMessage returns true on success', async () => {
    const ok = await plugin.sendMessage('test');
    assert.equal(ok, true);
  });

  it('sendMessage returns false on failure', async () => {
    globalThis.fetch = async () => ({ ok: false, json: async () => ({ ok: false }) });
    const ok = await plugin.sendMessage('fail');
    assert.equal(ok, false);
  });

  // ── polling ──────────────────────────────────────────────

  it('getUpdates fetches from Telegram API', async () => {
    const updates = await plugin.getUpdates();
    assert.ok(Array.isArray(updates));
    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.includes('/getUpdates'));
  });

  it('getUpdates passes offset parameter', async () => {
    plugin._offset = 50;
    await plugin.getUpdates();
    assert.ok(fetchCalls[0].url.includes('offset=51'));
  });

  // ── onMessage ────────────────────────────────────────────

  it('onMessage registers callback', () => {
    const cb = () => {};
    plugin.onMessage(cb);
    assert.equal(plugin._callback, cb);
  });

  it('processUpdates invokes callback for each update', () => {
    const received = [];
    plugin.onMessage((msg) => received.push(msg));
    plugin.processUpdates([
      { update_id: 1, message: { message_id: 1, text: 'a', from: { id: 1, first_name: 'X' }, chat: { id: 1 }, date: 1 } },
      { update_id: 2, message: { message_id: 2, text: 'b', from: { id: 2, first_name: 'Y' }, chat: { id: 2 }, date: 2 } },
    ]);
    assert.equal(received.length, 2);
    assert.equal(received[0].content, 'a');
    assert.equal(received[1].content, 'b');
  });

  it('processUpdates updates offset', () => {
    plugin.processUpdates([
      { update_id: 10, message: { message_id: 1, text: 'x', from: { id: 1, first_name: 'Z' }, chat: { id: 1 }, date: 1 } },
    ]);
    assert.equal(plugin._offset, 10);
  });
});
