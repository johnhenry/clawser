// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-notion-tools.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  NotionSearchTool,
  NotionCreatePageTool,
  NotionUpdatePageTool,
  NotionQueryDatabaseTool,
} from '../clawser-notion-tools.js';

function mockOAuth(responseData, { status = 200 } = {}) {
  return {
    getClient: async (provider) => provider === 'notion' ? {
      fetch: async (path, opts) => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
      }),
    } : null,
  };
}

function failOAuth() { return { getClient: async () => null }; }

describe('Notion tool class basics', () => {
  const tools = [
    new NotionSearchTool(mockOAuth({})),
    new NotionCreatePageTool(mockOAuth({})),
    new NotionUpdatePageTool(mockOAuth({})),
    new NotionQueryDatabaseTool(mockOAuth({})),
  ];

  it('all have unique names starting with notion_', () => {
    const names = tools.map(t => t.name);
    assert.equal(new Set(names).size, 4);
    for (const n of names) assert.ok(n.startsWith('notion_'), n);
  });

  it('all have descriptions and schemas', () => {
    for (const t of tools) {
      assert.ok(t.description.length > 0);
      assert.equal(t.schema.type, 'object');
    }
  });
});

describe('NotionSearchTool', () => {
  it('returns search results', async () => {
    const oauth = mockOAuth({ results: [{ id: 'page_1', object: 'page' }] });
    const result = await new NotionSearchTool(oauth).execute({ query: 'meeting notes' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('page_1'));
  });

  it('fails when not connected', async () => {
    const result = await new NotionSearchTool(failOAuth()).execute({ query: 'x' });
    assert.equal(result.success, false);
  });
});

describe('NotionCreatePageTool', () => {
  it('creates page and returns id', async () => {
    const oauth = mockOAuth({ id: 'new_page_1', url: 'https://notion.so/new_page_1' });
    const result = await new NotionCreatePageTool(oauth).execute({ parent_id: 'db_1', title: 'My Page' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('new_page_1'));
  });
});

describe('NotionUpdatePageTool', () => {
  it('updates page properties', async () => {
    const oauth = mockOAuth({ id: 'page_1', last_edited_time: '2026-01-01T00:00:00Z' });
    const result = await new NotionUpdatePageTool(oauth).execute({
      page_id: 'page_1',
      properties: JSON.stringify({ Status: { select: { name: 'Done' } } }),
    });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('page_1'));
  });
});

describe('NotionQueryDatabaseTool', () => {
  it('returns database rows', async () => {
    const oauth = mockOAuth({ results: [{ id: 'row_1' }, { id: 'row_2' }] });
    const result = await new NotionQueryDatabaseTool(oauth).execute({ database_id: 'db_1' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('row_1'));
  });
});
