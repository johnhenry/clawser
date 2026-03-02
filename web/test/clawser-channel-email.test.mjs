// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-channel-email.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  EmailPlugin,
} from '../clawser-channel-email.js';

describe('EmailPlugin', () => {
  let plugin;
  let fetchCalls;

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      return { ok: true, json: async () => ({ messages: [] }), text: async () => '' };
    };
    plugin = new EmailPlugin({
      imapHost: 'imap.example.com',
      smtpHost: 'smtp.example.com',
      credentials: { user: 'agent@example.com', pass: 'secret' },
      pollingInterval: 5000,
    });
  });

  afterEach(() => {
    plugin.stop();
    delete globalThis.fetch;
  });

  // ── constructor ──────────────────────────────────────────

  it('stores config from constructor', () => {
    assert.equal(plugin.config.imapHost, 'imap.example.com');
    assert.equal(plugin.config.smtpHost, 'smtp.example.com');
    assert.equal(plugin.config.credentials.user, 'agent@example.com');
  });

  it('defaults pollingInterval to 60000', () => {
    const p = new EmailPlugin({
      imapHost: 'imap.x', smtpHost: 'smtp.x',
      credentials: { user: 'a', pass: 'b' },
    });
    assert.equal(p.config.pollingInterval, 60000);
  });

  it('defaults useGmailApi to false', () => {
    assert.equal(plugin.config.useGmailApi, false);
  });

  // ── createInboundMessage ─────────────────────────────────

  it('normalizes an email envelope', () => {
    const raw = {
      messageId: '<abc@example.com>',
      from: 'alice@example.com',
      subject: 'Test Subject',
      body: 'Hello from email',
      date: '2024-01-01T00:00:00.000Z',
    };
    const msg = plugin.createInboundMessage(raw);
    assert.equal(msg.id, '<abc@example.com>');
    assert.equal(msg.text, 'Hello from email');
    assert.equal(msg.sender, 'alice@example.com');
    assert.equal(msg.channel, 'email');
    assert.equal(typeof msg.timestamp, 'number');
  });

  it('uses subject as text fallback when body is empty', () => {
    const raw = { messageId: '<x@y>', from: 'bob@z', subject: 'Important', body: '' };
    const msg = plugin.createInboundMessage(raw);
    assert.equal(msg.text, '[Subject: Important]');
  });

  it('handles missing fields gracefully', () => {
    const msg = plugin.createInboundMessage({});
    assert.equal(msg.sender, 'unknown');
    assert.equal(msg.text, '');
    assert.ok(msg.id);
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

  it('sendMessage calls SMTP endpoint', async () => {
    const ok = await plugin.sendMessage('email body', { to: 'bob@example.com', subject: 'Hi' });
    assert.equal(ok, true);
    assert.equal(fetchCalls.length, 1);
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.to, 'bob@example.com');
    assert.equal(body.subject, 'Hi');
    assert.equal(body.body, 'email body');
  });

  it('sendMessage defaults subject to "No Subject"', async () => {
    await plugin.sendMessage('body', { to: 'x@y.com' });
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.subject, 'No Subject');
  });

  it('sendMessage returns false on failure', async () => {
    globalThis.fetch = async () => ({ ok: false });
    const ok = await plugin.sendMessage('fail', { to: 'x@y' });
    assert.equal(ok, false);
  });

  // ── Gmail API mode ───────────────────────────────────────

  it('sendMessage uses Gmail API when configured', async () => {
    const p = new EmailPlugin({
      imapHost: '', smtpHost: '',
      credentials: { user: 'me@gmail.com', pass: '', accessToken: 'gtoken' },
      useGmailApi: true,
    });
    await p.sendMessage('gmail body', { to: 'x@y.com', subject: 'G' });
    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.includes('gmail.googleapis.com'));
  });

  // ── onMessage ────────────────────────────────────────────

  it('onMessage registers callback', () => {
    const cb = () => {};
    plugin.onMessage(cb);
    assert.equal(plugin._callback, cb);
  });

  // ── processEmails ────────────────────────────────────────

  it('processEmails invokes callback for each email', () => {
    const received = [];
    plugin.onMessage((msg) => received.push(msg));
    plugin.processEmails([
      { messageId: '<1>', from: 'a@b', subject: 'S1', body: 'B1', date: new Date().toISOString() },
      { messageId: '<2>', from: 'c@d', subject: 'S2', body: 'B2', date: new Date().toISOString() },
    ]);
    assert.equal(received.length, 2);
    assert.equal(received[0].text, 'B1');
    assert.equal(received[1].text, 'B2');
  });

  it('processEmails tracks seen message IDs', () => {
    const received = [];
    plugin.onMessage((msg) => received.push(msg));
    const email = { messageId: '<dup>', from: 'a@b', subject: 'S', body: 'X', date: new Date().toISOString() };
    plugin.processEmails([email]);
    plugin.processEmails([email]);
    assert.equal(received.length, 1);
  });
});
