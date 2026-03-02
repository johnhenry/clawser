// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-slack-tools.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SlackChannelsTool,
  SlackPostTool,
  SlackHistoryTool,
} from '../clawser-slack-tools.js';

function mockOAuth(responseData) {
  return {
    getClient: async (provider) => provider === 'slack' ? {
      fetch: async (path, opts) => ({
        ok: true,
        status: 200,
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
      }),
    } : null,
  };
}

function failOAuth() { return { getClient: async () => null }; }

describe('Slack tool class basics', () => {
  const tools = [
    new SlackChannelsTool(mockOAuth({})),
    new SlackPostTool(mockOAuth({})),
    new SlackHistoryTool(mockOAuth({})),
  ];

  it('all have unique names starting with slack_', () => {
    const names = tools.map(t => t.name);
    assert.equal(new Set(names).size, 3);
    for (const n of names) assert.ok(n.startsWith('slack_'), n);
  });

  it('all have descriptions and schemas', () => {
    for (const t of tools) {
      assert.ok(t.description.length > 0);
      assert.equal(t.schema.type, 'object');
    }
  });
});

describe('SlackChannelsTool', () => {
  it('returns channel list', async () => {
    const oauth = mockOAuth({ ok: true, channels: [{ id: 'C01', name: 'general' }, { id: 'C02', name: 'dev' }] });
    const result = await new SlackChannelsTool(oauth).execute({});
    assert.equal(result.success, true);
    assert.ok(result.output.includes('general'));
  });

  it('fails when not connected', async () => {
    const result = await new SlackChannelsTool(failOAuth()).execute({});
    assert.equal(result.success, false);
  });
});

describe('SlackPostTool', () => {
  it('posts message and returns ts', async () => {
    const oauth = mockOAuth({ ok: true, ts: '1234567890.123456', channel: 'C01' });
    const result = await new SlackPostTool(oauth).execute({ channel: 'C01', text: 'Hello world' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('1234567890'));
  });
});

describe('SlackHistoryTool', () => {
  it('returns channel history', async () => {
    const oauth = mockOAuth({ ok: true, messages: [{ ts: '1.0', text: 'Hello' }, { ts: '2.0', text: 'World' }] });
    const result = await new SlackHistoryTool(oauth).execute({ channel: 'C01', limit: 5 });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('Hello'));
  });

  it('handles Slack API error response', async () => {
    const oauth = mockOAuth({ ok: false, error: 'channel_not_found' });
    const result = await new SlackHistoryTool(oauth).execute({ channel: 'C_INVALID' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('channel_not_found'));
  });
});
