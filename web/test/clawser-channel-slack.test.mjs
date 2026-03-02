// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-channel-slack.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SlackPlugin,
} from '../clawser-channel-slack.js';

describe('SlackPlugin', () => {
  let plugin;
  let fetchCalls;

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      return { ok: true, json: async () => ({ ok: true }) };
    };
    plugin = new SlackPlugin({
      botToken: 'xoxb-SLACK-TOKEN',
      signingSecret: 'secret123',
      channel: 'C01GENERAL',
    });
  });

  afterEach(() => {
    plugin.stop();
    delete globalThis.fetch;
  });

  // ── constructor ──────────────────────────────────────────

  it('stores config from constructor', () => {
    assert.equal(plugin.config.botToken, 'xoxb-SLACK-TOKEN');
    assert.equal(plugin.config.signingSecret, 'secret123');
    assert.equal(plugin.config.channel, 'C01GENERAL');
  });

  // ── createInboundMessage ─────────────────────────────────

  it('normalizes a Slack event', () => {
    const raw = {
      type: 'message',
      text: 'hello slack',
      user: 'U123',
      channel: 'C01GENERAL',
      ts: '1700000000.000100',
      client_msg_id: 'slack_msg_1',
    };
    const msg = plugin.createInboundMessage(raw);
    assert.equal(msg.id, 'slack_msg_1');
    assert.equal(msg.content, 'hello slack');
    assert.equal(msg.sender.id, 'U123');
    assert.equal(msg.channel, 'slack');
    assert.equal(typeof msg.timestamp, 'number');
  });

  it('uses ts as id fallback', () => {
    const raw = { type: 'message', text: 'hi', user: 'U1', ts: '123.456' };
    const msg = plugin.createInboundMessage(raw);
    assert.equal(msg.id, '123.456');
  });

  it('handles missing fields gracefully', () => {
    const msg = plugin.createInboundMessage({});
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

  it('sendMessage calls Slack chat.postMessage API', async () => {
    const ok = await plugin.sendMessage('hello slack world');
    assert.equal(ok, true);
    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.includes('chat.postMessage'));
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.channel, 'C01GENERAL');
    assert.equal(body.text, 'hello slack world');
  });

  it('sendMessage includes auth header', async () => {
    await plugin.sendMessage('test');
    const headers = fetchCalls[0].opts.headers;
    assert.ok(headers['Authorization'].includes('Bearer xoxb-SLACK-TOKEN'));
  });

  it('sendMessage allows overriding channel', async () => {
    await plugin.sendMessage('hi', { channel: 'C02OTHER' });
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.channel, 'C02OTHER');
  });

  it('sendMessage returns false on failure', async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: false }) });
    const ok = await plugin.sendMessage('fail');
    assert.equal(ok, false);
  });

  // ── onMessage / webhook ──────────────────────────────────

  it('onMessage registers callback', () => {
    const cb = () => {};
    plugin.onMessage(cb);
    assert.equal(plugin._callback, cb);
  });

  it('handleEvent dispatches message events', () => {
    const received = [];
    plugin.onMessage((msg) => received.push(msg));
    plugin.handleEvent({
      type: 'event_callback',
      event: {
        type: 'message',
        text: 'webhook msg',
        user: 'U456',
        channel: 'C01GENERAL',
        ts: '1700000001.000200',
      },
    });
    assert.equal(received.length, 1);
    assert.equal(received[0].content, 'webhook msg');
  });

  it('handleEvent responds to url_verification', () => {
    const result = plugin.handleEvent({
      type: 'url_verification',
      challenge: 'abc123',
    });
    assert.equal(result.challenge, 'abc123');
  });

  it('handleEvent ignores bot messages', () => {
    const received = [];
    plugin.onMessage((msg) => received.push(msg));
    plugin.handleEvent({
      type: 'event_callback',
      event: {
        type: 'message',
        text: 'bot msg',
        bot_id: 'B123',
        channel: 'C01',
        ts: '1.0',
      },
    });
    assert.equal(received.length, 0);
  });
});
