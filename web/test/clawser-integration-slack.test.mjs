// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-integration-slack.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SlackMonitorTool,
  SlackDraftResponseTool,
} from '../clawser-integration-slack.js';

function mockSlackHistory(messages) {
  return {
    execute: async (params) => ({
      success: true,
      output: JSON.stringify(messages),
    }),
  };
}

function mockSlackPost(result) {
  return {
    execute: async (params) => ({ success: true, output: result }),
  };
}

function mockSlackChannels(channels) {
  return {
    execute: async () => ({
      success: true,
      output: JSON.stringify(channels),
    }),
  };
}

describe('Slack integration tool basics', () => {
  const tools = [
    new SlackMonitorTool(mockSlackHistory([]), mockSlackChannels([])),
    new SlackDraftResponseTool(mockSlackPost('ok')),
  ];

  it('all have unique names starting with slack_integration_', () => {
    const names = tools.map(t => t.name);
    assert.equal(new Set(names).size, 2);
    for (const n of names) assert.ok(n.startsWith('slack_integration_'), n);
  });

  it('all have descriptions and schemas', () => {
    for (const t of tools) {
      assert.ok(t.description.length > 0);
      assert.equal(t.schema.type, 'object');
    }
  });
});

describe('SlackMonitorTool', () => {
  it('returns recent activity across channels', async () => {
    const channels = [{ id: 'C01', name: 'general' }];
    const messages = [
      { ts: '1.0', user: 'U01', text: 'Hello everyone' },
      { ts: '2.0', user: 'U02', text: 'Good morning' },
    ];
    const tool = new SlackMonitorTool(mockSlackHistory(messages), mockSlackChannels(channels));
    const result = await tool.execute({ channels: ['C01'], limit: 5 });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('Hello everyone') || result.output.includes('general'));
  });

  it('returns no activity message when empty', async () => {
    const tool = new SlackMonitorTool(mockSlackHistory([]), mockSlackChannels([{ id: 'C01', name: 'empty' }]));
    const result = await tool.execute({ channels: ['C01'] });
    assert.equal(result.success, true);
  });
});

describe('SlackDraftResponseTool', () => {
  it('sends a threaded response', async () => {
    const tool = new SlackDraftResponseTool(mockSlackPost('Posted message 123.456 to C01'));
    const result = await tool.execute({ channel: 'C01', thread_ts: '1.0', text: 'Thanks for the update!' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('Posted') || result.output.includes('response'));
  });

  it('sends a channel response without thread', async () => {
    const tool = new SlackDraftResponseTool(mockSlackPost('Posted message 789.012 to C01'));
    const result = await tool.execute({ channel: 'C01', text: 'Acknowledged.' });
    assert.equal(result.success, true);
  });
});
