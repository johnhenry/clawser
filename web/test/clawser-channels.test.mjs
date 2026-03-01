// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-channels.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub BrowserTool before import
globalThis.BrowserTool = class { constructor() {} };

import {
  CHANNEL_TYPES,
  createInboundMessage,
  createChannelConfig,
  isMessageAllowed,
  formatForChannel,
  ChannelManager,
  resetMessageCounter,
} from '../clawser-channels.js';

// ── CHANNEL_TYPES ───────────────────────────────────────────────

describe('CHANNEL_TYPES', () => {
  it('has expected values', () => {
    assert.equal(CHANNEL_TYPES.WEBHOOK, 'webhook');
    assert.equal(CHANNEL_TYPES.TELEGRAM, 'telegram');
    assert.equal(CHANNEL_TYPES.DISCORD, 'discord');
    assert.equal(CHANNEL_TYPES.SLACK, 'slack');
    assert.equal(CHANNEL_TYPES.EMAIL, 'email');
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(CHANNEL_TYPES));
  });
});

// ── createInboundMessage ────────────────────────────────────────

describe('createInboundMessage', () => {
  beforeEach(() => { resetMessageCounter(); });

  it('returns message with auto-generated id', () => {
    const msg = createInboundMessage({ content: 'hello' });
    assert.ok(msg.id.startsWith('msg_'));
    assert.equal(msg.content, 'hello');
  });

  it('returns message with timestamp', () => {
    const msg = createInboundMessage();
    assert.equal(typeof msg.timestamp, 'number');
  });

  it('defaults channel to webhook', () => {
    const msg = createInboundMessage();
    assert.equal(msg.channel, 'webhook');
  });

  it('creates sender with defaults', () => {
    const msg = createInboundMessage();
    assert.equal(msg.sender.id, 'unknown');
    assert.equal(msg.sender.name, 'Unknown');
  });

  it('accepts custom sender', () => {
    const msg = createInboundMessage({ sender: { id: 'u1', name: 'Alice', username: 'alice' } });
    assert.equal(msg.sender.id, 'u1');
    assert.equal(msg.sender.name, 'Alice');
    assert.equal(msg.sender.username, 'alice');
  });
});

// ── createChannelConfig ─────────────────────────────────────────

describe('createChannelConfig', () => {
  it('returns config with defaults', () => {
    const cfg = createChannelConfig();
    assert.equal(cfg.name, 'unknown');
    assert.equal(cfg.enabled, true);
    assert.deepEqual(cfg.allowedUsers, []);
    assert.deepEqual(cfg.allowedChannels, []);
  });

  it('accepts custom options', () => {
    const cfg = createChannelConfig({ name: 'telegram', enabled: false, allowedUsers: ['alice'] });
    assert.equal(cfg.name, 'telegram');
    assert.equal(cfg.enabled, false);
    assert.deepEqual(cfg.allowedUsers, ['alice']);
  });
});

// ── isMessageAllowed ────────────────────────────────────────────

describe('isMessageAllowed', () => {
  it('returns false when config is disabled', () => {
    const cfg = createChannelConfig({ enabled: false });
    const msg = createInboundMessage();
    assert.equal(isMessageAllowed(cfg, msg), false);
  });

  it('returns true when no restrictions', () => {
    const cfg = createChannelConfig({ enabled: true });
    const msg = createInboundMessage();
    assert.equal(isMessageAllowed(cfg, msg), true);
  });

  it('checks allowedUsers by sender id', () => {
    const cfg = createChannelConfig({ allowedUsers: ['alice'] });
    const msgOk = createInboundMessage({ sender: { id: 'alice' } });
    const msgBad = createInboundMessage({ sender: { id: 'bob' } });
    assert.equal(isMessageAllowed(cfg, msgOk), true);
    assert.equal(isMessageAllowed(cfg, msgBad), false);
  });

  it('checks allowedUsers by sender username', () => {
    const cfg = createChannelConfig({ allowedUsers: ['alice'] });
    const msg = createInboundMessage({ sender: { id: 'u1', username: 'alice' } });
    assert.equal(isMessageAllowed(cfg, msg), true);
  });

  it('checks allowedChannels', () => {
    const cfg = createChannelConfig({ allowedChannels: ['general'] });
    const msgOk = createInboundMessage({ channelId: 'general' });
    const msgBad = createInboundMessage({ channelId: 'random' });
    assert.equal(isMessageAllowed(cfg, msgOk), true);
    assert.equal(isMessageAllowed(cfg, msgBad), false);
  });
});

// ── formatForChannel ────────────────────────────────────────────

describe('formatForChannel', () => {
  it('formats Telegram with HTML tags', () => {
    const result = formatForChannel('telegram', '**bold** and _italic_');
    assert.ok(result.includes('<b>bold</b>'));
    assert.ok(result.includes('<i>italic</i>'));
  });

  it('passes through Discord messages', () => {
    const result = formatForChannel('discord', '**bold**');
    assert.equal(result, '**bold**');
  });

  it('converts Slack bold syntax', () => {
    const result = formatForChannel('slack', '**bold text**');
    assert.ok(result.includes('*bold text*'));
  });

  it('formats Email with subject and body', () => {
    const result = formatForChannel('email', 'Subject line\nBody text');
    assert.equal(typeof result, 'object');
    assert.equal(result.subject, 'Subject line');
    assert.ok(result.body.includes('Body text'));
  });

  it('returns original for unknown channel type', () => {
    assert.equal(formatForChannel('unknown', 'test'), 'test');
  });
});

// ── ChannelManager ──────────────────────────────────────────────

describe('ChannelManager', () => {
  let mgr;

  beforeEach(() => {
    resetMessageCounter();
    mgr = new ChannelManager();
  });

  it('starts with 0 channels and not connected', () => {
    assert.equal(mgr.channelCount, 0);
    assert.equal(mgr.connected, false);
  });

  it('addChannel adds a channel config', () => {
    mgr.addChannel({ name: 'telegram', enabled: true });
    assert.equal(mgr.channelCount, 1);
  });

  it('removeChannel removes a channel', () => {
    mgr.addChannel({ name: 'test' });
    assert.equal(mgr.removeChannel('test'), true);
    assert.equal(mgr.channelCount, 0);
  });

  it('getChannel returns config or undefined', () => {
    mgr.addChannel({ name: 'slack' });
    assert.ok(mgr.getChannel('slack'));
    assert.equal(mgr.getChannel('nope'), undefined);
  });

  it('listChannels returns all configs', () => {
    mgr.addChannel({ name: 'a' });
    mgr.addChannel({ name: 'b' });
    assert.equal(mgr.listChannels().length, 2);
  });

  it('handleInbound stores messages in history', () => {
    mgr.handleInbound({ channel: 'webhook', content: 'test msg' });
    const history = mgr.getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].content, 'test msg');
  });

  it('handleInbound calls onMessage callback', () => {
    let received = null;
    const mgr2 = new ChannelManager({ onMessage: (msg) => { received = msg; } });
    mgr2.handleInbound({ content: 'callback test' });
    assert.ok(received);
    assert.equal(received.content, 'callback test');
  });

  it('handleInbound blocks disallowed messages', () => {
    mgr.addChannel({ name: 'webhook', allowedUsers: ['alice'] });
    mgr.handleInbound({ channel: 'webhook', sender: { id: 'bob' }, content: 'blocked' });
    assert.equal(mgr.getHistory().length, 0);
  });

  it('getHistory respects limit', () => {
    for (let i = 0; i < 30; i++) {
      mgr.handleInbound({ content: `msg ${i}` });
    }
    assert.equal(mgr.getHistory({ limit: 5 }).length, 5);
  });

  it('getHistory filters by channel', () => {
    mgr.handleInbound({ channel: 'slack', content: 'a' });
    mgr.handleInbound({ channel: 'telegram', content: 'b' });
    const slackMsgs = mgr.getHistory({ channel: 'slack' });
    assert.equal(slackMsgs.length, 1);
    assert.equal(slackMsgs[0].channel, 'slack');
  });

  it('buildPrompt returns empty for no channels', () => {
    assert.equal(mgr.buildPrompt(), '');
  });

  it('buildPrompt returns channel list', () => {
    mgr.addChannel({ name: 'slack', enabled: true });
    mgr.addChannel({ name: 'telegram', enabled: false });
    const prompt = mgr.buildPrompt();
    assert.ok(prompt.includes('slack'));
    assert.ok(prompt.includes('telegram'));
    assert.ok(prompt.includes('enabled'));
    assert.ok(prompt.includes('disabled'));
  });
});
