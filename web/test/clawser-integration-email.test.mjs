// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-integration-email.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EmailDraftTool,
  EmailSummarizeTool,
  EmailTriageTool,
} from '../clawser-integration-email.js';

function mockGmailSearch(messages) {
  return {
    execute: async (params) => ({
      success: true,
      output: JSON.stringify(messages),
    }),
  };
}

function mockGmailSend(result) {
  return {
    execute: async (params) => ({ success: true, output: result }),
  };
}

function mockOAuthForRead(messageData) {
  return {
    getClient: async (provider) => provider === 'google' ? {
      fetch: async (path) => ({
        ok: true, status: 200,
        json: async () => messageData,
        text: async () => JSON.stringify(messageData),
      }),
    } : null,
  };
}

describe('Email integration tool basics', () => {
  const tools = [
    new EmailDraftTool(mockGmailSend('ok')),
    new EmailSummarizeTool(mockGmailSearch([]), mockOAuthForRead({})),
    new EmailTriageTool(mockGmailSearch([]), mockOAuthForRead({})),
  ];

  it('all have unique names starting with email_', () => {
    const names = tools.map(t => t.name);
    assert.equal(new Set(names).size, 3);
    for (const n of names) assert.ok(n.startsWith('email_'), n);
  });

  it('all have descriptions and schemas', () => {
    for (const t of tools) {
      assert.ok(t.description.length > 0);
      assert.equal(t.schema.type, 'object');
    }
  });
});

describe('EmailDraftTool', () => {
  it('creates a draft and returns confirmation', async () => {
    const tool = new EmailDraftTool(mockGmailSend('Sent message draft_1'));
    const result = await tool.execute({ to: 'user@example.com', subject: 'Hello', body: 'Hi!' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('draft') || result.output.includes('Draft'));
  });
});

describe('EmailSummarizeTool', () => {
  it('summarizes emails matching a query', async () => {
    const msgs = [{ id: 'msg1', threadId: 'th1' }];
    const msgData = {
      id: 'msg1',
      payload: {
        headers: [
          { name: 'From', value: 'alice@example.com' },
          { name: 'Subject', value: 'Project update' },
          { name: 'Date', value: '2026-03-01' },
        ],
        body: { data: '' },
      },
      snippet: 'Here is the latest update on the project...',
    };
    const tool = new EmailSummarizeTool(mockGmailSearch(msgs), mockOAuthForRead(msgData));
    const result = await tool.execute({ query: 'from:alice', max_results: 5 });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('Project update') || result.output.includes('alice'));
  });
});

describe('EmailTriageTool', () => {
  it('categorizes unread emails', async () => {
    const msgs = [{ id: 'msg1', threadId: 'th1' }];
    const msgData = {
      id: 'msg1',
      labelIds: ['UNREAD', 'INBOX'],
      payload: {
        headers: [
          { name: 'From', value: 'boss@company.com' },
          { name: 'Subject', value: 'Urgent: review needed' },
        ],
      },
      snippet: 'Please review the attached document ASAP.',
    };
    const tool = new EmailTriageTool(mockGmailSearch(msgs), mockOAuthForRead(msgData));
    const result = await tool.execute({ max_results: 10 });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('Urgent') || result.output.includes('boss'));
  });
});
