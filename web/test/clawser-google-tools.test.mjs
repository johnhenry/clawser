// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-google-tools.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal BrowserTool stub
globalThis.BrowserTool = class { constructor() {} };

import {
  GoogleCalendarListTool,
  GoogleCalendarCreateTool,
  GoogleGmailSearchTool,
  GoogleGmailSendTool,
  GoogleDriveListTool,
  GoogleDriveReadTool,
  GoogleDriveCreateTool,
} from '../clawser-google-tools.js';

// ── Helpers ──────────────────────────────────────────────────────

function mockOAuth(responseData, { status = 200 } = {}) {
  return {
    getClient: async (provider) => provider === 'google' ? {
      fetch: async (path, opts) => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
      }),
    } : null,
  };
}

function failOAuth() {
  return { getClient: async () => null };
}

// ── Tool class basics ────────────────────────────────────────────

describe('Google tool class basics', () => {
  const tools = [
    new GoogleCalendarListTool(mockOAuth({})),
    new GoogleCalendarCreateTool(mockOAuth({})),
    new GoogleGmailSearchTool(mockOAuth({})),
    new GoogleGmailSendTool(mockOAuth({})),
    new GoogleDriveListTool(mockOAuth({})),
    new GoogleDriveReadTool(mockOAuth({})),
    new GoogleDriveCreateTool(mockOAuth({})),
  ];

  it('all have unique names', () => {
    const names = tools.map(t => t.name);
    assert.equal(new Set(names).size, 7);
  });

  it('all have descriptions', () => {
    for (const t of tools) assert.ok(t.description.length > 0);
  });

  it('all have schema with type object', () => {
    for (const t of tools) assert.equal(t.schema.type, 'object');
  });

  it('all names start with google_', () => {
    for (const t of tools) assert.ok(t.name.startsWith('google_'), `${t.name}`);
  });
});

// ── GoogleCalendarListTool ────────────────────────────────────────

describe('GoogleCalendarListTool', () => {
  it('returns events on success', async () => {
    const oauth = mockOAuth({ items: [{ summary: 'Meeting', start: { dateTime: '2026-01-01T10:00:00Z' } }] });
    const tool = new GoogleCalendarListTool(oauth);
    const result = await tool.execute({ calendar_id: 'primary', max_results: 5 });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('Meeting'));
  });

  it('returns error when not connected', async () => {
    const tool = new GoogleCalendarListTool(failOAuth());
    const result = await tool.execute({});
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Not connected'));
  });
});

// ── GoogleCalendarCreateTool ──────────────────────────────────────

describe('GoogleCalendarCreateTool', () => {
  it('creates event and returns confirmation', async () => {
    const oauth = mockOAuth({ id: 'evt_1', htmlLink: 'https://calendar.google.com/event/evt_1' });
    const tool = new GoogleCalendarCreateTool(oauth);
    const result = await tool.execute({ summary: 'Standup', start: '2026-03-01T09:00:00Z', end: '2026-03-01T09:30:00Z' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('evt_1'));
  });
});

// ── GoogleGmailSearchTool ─────────────────────────────────────────

describe('GoogleGmailSearchTool', () => {
  it('returns message list', async () => {
    const oauth = mockOAuth({ messages: [{ id: 'msg_1', threadId: 'th_1' }] });
    const tool = new GoogleGmailSearchTool(oauth);
    const result = await tool.execute({ query: 'from:boss', max_results: 10 });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('msg_1'));
  });
});

// ── GoogleGmailSendTool ───────────────────────────────────────────

describe('GoogleGmailSendTool', () => {
  it('sends email and returns message id', async () => {
    const oauth = mockOAuth({ id: 'sent_1', labelIds: ['SENT'] });
    const tool = new GoogleGmailSendTool(oauth);
    const result = await tool.execute({ to: 'user@example.com', subject: 'Hello', body: 'Hi there' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('sent_1'));
  });
});

// ── GoogleDriveListTool ───────────────────────────────────────────

describe('GoogleDriveListTool', () => {
  it('lists files', async () => {
    const oauth = mockOAuth({ files: [{ id: 'f1', name: 'doc.txt', mimeType: 'text/plain' }] });
    const tool = new GoogleDriveListTool(oauth);
    const result = await tool.execute({ query: 'name contains "doc"' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('doc.txt'));
  });
});

// ── GoogleDriveReadTool ───────────────────────────────────────────

describe('GoogleDriveReadTool', () => {
  it('reads file metadata', async () => {
    const oauth = mockOAuth({ id: 'f1', name: 'readme.md', mimeType: 'text/markdown', size: '1024' });
    const tool = new GoogleDriveReadTool(oauth);
    const result = await tool.execute({ file_id: 'f1' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('readme.md'));
  });
});

// ── GoogleDriveCreateTool ─────────────────────────────────────────

describe('GoogleDriveCreateTool', () => {
  it('creates file and returns id', async () => {
    const oauth = mockOAuth({ id: 'new_f1', name: 'notes.txt' });
    const tool = new GoogleDriveCreateTool(oauth);
    const result = await tool.execute({ name: 'notes.txt', content: 'Hello world', mime_type: 'text/plain' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('new_f1'));
  });
});
