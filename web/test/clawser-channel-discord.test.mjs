// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-channel-discord.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DiscordPlugin,
} from '../clawser-channel-discord.js';

describe('DiscordPlugin', () => {
  let plugin;
  let fetchCalls;

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      return { ok: true, json: async () => ({}) };
    };
    // Stub WebSocket
    globalThis.WebSocket = class {
      constructor(url) { this.url = url; this.readyState = 1; }
      send(data) { this._lastSent = data; }
      close() { this.readyState = 3; }
    };
    plugin = new DiscordPlugin({
      botToken: 'DISCORD_TOKEN',
      guildId: 'guild_123',
    });
  });

  afterEach(() => {
    plugin.stop();
    delete globalThis.fetch;
  });

  // ── constructor ──────────────────────────────────────────

  it('stores config from constructor', () => {
    assert.equal(plugin.config.botToken, 'DISCORD_TOKEN');
    assert.equal(plugin.config.guildId, 'guild_123');
  });

  it('defaults gatewayUrl', () => {
    assert.ok(plugin.config.gatewayUrl.includes('gateway.discord.gg'));
  });

  // ── createInboundMessage ─────────────────────────────────

  it('normalizes a Discord MESSAGE_CREATE event', () => {
    const raw = {
      id: 'disc_1',
      content: 'hello from discord',
      author: { id: 'u1', username: 'alice#1234' },
      channel_id: 'ch_1',
      timestamp: '2024-01-01T00:00:00.000Z',
    };
    const msg = plugin.createInboundMessage(raw);
    assert.equal(msg.id, 'disc_1');
    assert.equal(msg.text, 'hello from discord');
    assert.equal(msg.sender, 'alice#1234');
    assert.equal(msg.channel, 'discord');
    assert.equal(typeof msg.timestamp, 'number');
  });

  it('handles missing author gracefully', () => {
    const msg = plugin.createInboundMessage({ id: 'x', content: 'test' });
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

  it('sendMessage calls Discord REST API', async () => {
    const ok = await plugin.sendMessage('hi', { channelId: 'ch_42' });
    assert.equal(ok, true);
    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.includes('/channels/ch_42/messages'));
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.content, 'hi');
  });

  it('sendMessage includes auth header', async () => {
    await plugin.sendMessage('auth test', { channelId: 'ch_1' });
    const headers = fetchCalls[0].opts.headers;
    assert.ok(headers['Authorization'].includes('Bot DISCORD_TOKEN'));
  });

  it('sendMessage returns false on failure', async () => {
    globalThis.fetch = async () => ({ ok: false });
    const ok = await plugin.sendMessage('fail', { channelId: 'ch_1' });
    assert.equal(ok, false);
  });

  // ── onMessage ────────────────────────────────────────────

  it('onMessage registers callback', () => {
    const cb = () => {};
    plugin.onMessage(cb);
    assert.equal(plugin._callback, cb);
  });

  // ── gateway event handling ───────────────────────────────

  it('handleGatewayEvent dispatches MESSAGE_CREATE', () => {
    const received = [];
    plugin.onMessage((msg) => received.push(msg));
    plugin.handleGatewayEvent({
      t: 'MESSAGE_CREATE',
      d: {
        id: 'm1',
        content: 'gateway msg',
        author: { id: 'u1', username: 'bob' },
        channel_id: 'ch_1',
        timestamp: '2024-01-01T00:00:00.000Z',
      },
    });
    assert.equal(received.length, 1);
    assert.equal(received[0].text, 'gateway msg');
  });

  it('handleGatewayEvent ignores non-MESSAGE_CREATE events', () => {
    const received = [];
    plugin.onMessage((msg) => received.push(msg));
    plugin.handleGatewayEvent({ t: 'PRESENCE_UPDATE', d: {} });
    assert.equal(received.length, 0);
  });

  it('handleGatewayEvent ignores bot messages', () => {
    const received = [];
    plugin.onMessage((msg) => received.push(msg));
    plugin.handleGatewayEvent({
      t: 'MESSAGE_CREATE',
      d: {
        id: 'm2',
        content: 'bot says hi',
        author: { id: 'bot1', username: 'mybot', bot: true },
        channel_id: 'ch_1',
        timestamp: '2024-01-01T00:00:00.000Z',
      },
    });
    assert.equal(received.length, 0);
  });
});
