// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-channel-irc.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  IrcPlugin,
  parseIrcMessage,
} from '../clawser-channel-irc.js';

describe('parseIrcMessage', () => {
  it('parses PRIVMSG', () => {
    const parsed = parseIrcMessage(':alice!user@host PRIVMSG #general :hello world');
    assert.equal(parsed.prefix, 'alice!user@host');
    assert.equal(parsed.command, 'PRIVMSG');
    assert.deepEqual(parsed.params, ['#general']);
    assert.equal(parsed.trailing, 'hello world');
  });

  it('parses PING', () => {
    const parsed = parseIrcMessage('PING :server.example.com');
    assert.equal(parsed.command, 'PING');
    assert.equal(parsed.trailing, 'server.example.com');
  });

  it('parses numeric command', () => {
    const parsed = parseIrcMessage(':server 001 nick :Welcome');
    assert.equal(parsed.prefix, 'server');
    assert.equal(parsed.command, '001');
    assert.equal(parsed.trailing, 'Welcome');
  });

  it('handles message with no trailing', () => {
    const parsed = parseIrcMessage(':nick!u@h JOIN #channel');
    assert.equal(parsed.command, 'JOIN');
    assert.deepEqual(parsed.params, ['#channel']);
    assert.equal(parsed.trailing, '');
  });
});

describe('IrcPlugin', () => {
  let plugin;
  let wsSent;

  beforeEach(() => {
    wsSent = [];
    globalThis.WebSocket = class {
      constructor(url) {
        this.url = url;
        this.readyState = 1;
      }
      send(data) { wsSent.push(data); }
      close() { this.readyState = 3; }
    };
    plugin = new IrcPlugin({
      server: 'wss://irc.example.com',
      channel: '#general',
      nick: 'clawser-bot',
    });
  });

  afterEach(() => {
    plugin.stop();
  });

  // ── constructor ──────────────────────────────────────────

  it('stores config from constructor', () => {
    assert.equal(plugin.config.server, 'wss://irc.example.com');
    assert.equal(plugin.config.channel, '#general');
    assert.equal(plugin.config.nick, 'clawser-bot');
  });

  it('defaults password to null', () => {
    assert.equal(plugin.config.password, null);
  });

  // ── createInboundMessage ─────────────────────────────────

  it('normalizes a PRIVMSG', () => {
    const raw = {
      prefix: 'alice!user@host',
      command: 'PRIVMSG',
      params: ['#general'],
      trailing: 'hello irc',
    };
    const msg = plugin.createInboundMessage(raw);
    assert.equal(msg.text, 'hello irc');
    assert.equal(msg.sender, 'alice');
    assert.equal(msg.channel, 'irc');
    assert.ok(msg.id);
    assert.equal(typeof msg.timestamp, 'number');
  });

  it('extracts nick from prefix', () => {
    const msg = plugin.createInboundMessage({
      prefix: 'bob!user@host',
      command: 'PRIVMSG',
      params: ['#test'],
      trailing: 'hi',
    });
    assert.equal(msg.sender, 'bob');
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

  it('sendMessage sends PRIVMSG over WebSocket', () => {
    plugin.start();
    plugin._ws = { readyState: 1, send: (d) => wsSent.push(d), close() {} };
    plugin.sendMessage('hello irc world');
    assert.equal(wsSent.length, 1);
    assert.ok(wsSent[0].includes('PRIVMSG #general :hello irc world'));
  });

  it('sendMessage allows channel override', () => {
    plugin.start();
    plugin._ws = { readyState: 1, send: (d) => wsSent.push(d), close() {} };
    plugin.sendMessage('hi', { channel: '#other' });
    assert.ok(wsSent[0].includes('PRIVMSG #other :hi'));
  });

  it('sendMessage returns false when not connected', () => {
    const ok = plugin.sendMessage('nope');
    assert.equal(ok, false);
  });

  // ── onMessage ────────────────────────────────────────────

  it('onMessage registers callback', () => {
    const cb = () => {};
    plugin.onMessage(cb);
    assert.equal(plugin._callback, cb);
  });

  // ── IRC line handling ────────────────────────────────────

  it('handleLine dispatches PRIVMSG to callback', () => {
    const received = [];
    plugin.onMessage((msg) => received.push(msg));
    plugin.handleLine(':alice!u@h PRIVMSG #general :test message');
    assert.equal(received.length, 1);
    assert.equal(received[0].text, 'test message');
    assert.equal(received[0].sender, 'alice');
  });

  it('handleLine responds to PING with PONG', () => {
    plugin._ws = { readyState: 1, send: (d) => wsSent.push(d), close() {} };
    plugin.handleLine('PING :server.example.com');
    assert.ok(wsSent.some(s => s.includes('PONG :server.example.com')));
  });

  it('handleLine ignores non-PRIVMSG commands', () => {
    const received = [];
    plugin.onMessage((msg) => received.push(msg));
    plugin.handleLine(':nick!u@h JOIN #channel');
    assert.equal(received.length, 0);
  });
});
