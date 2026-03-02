// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-linear-tools.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LinearIssuesTool,
  LinearCreateIssueTool,
  LinearUpdateIssueTool,
} from '../clawser-linear-tools.js';

function mockOAuth(responseData) {
  return {
    getClient: async (provider) => provider === 'linear' ? {
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

describe('Linear tool class basics', () => {
  const tools = [
    new LinearIssuesTool(mockOAuth({})),
    new LinearCreateIssueTool(mockOAuth({})),
    new LinearUpdateIssueTool(mockOAuth({})),
  ];

  it('all have unique names starting with linear_', () => {
    const names = tools.map(t => t.name);
    assert.equal(new Set(names).size, 3);
    for (const n of names) assert.ok(n.startsWith('linear_'), n);
  });

  it('all have descriptions and schemas', () => {
    for (const t of tools) {
      assert.ok(t.description.length > 0);
      assert.equal(t.schema.type, 'object');
    }
  });
});

describe('LinearIssuesTool', () => {
  it('returns issue list', async () => {
    const oauth = mockOAuth({
      data: { issues: { nodes: [{ id: 'iss_1', title: 'Fix bug', state: { name: 'In Progress' } }] } },
    });
    const result = await new LinearIssuesTool(oauth).execute({});
    assert.equal(result.success, true);
    assert.ok(result.output.includes('Fix bug'));
  });

  it('fails when not connected', async () => {
    const result = await new LinearIssuesTool(failOAuth()).execute({});
    assert.equal(result.success, false);
  });
});

describe('LinearCreateIssueTool', () => {
  it('creates issue and returns id', async () => {
    const oauth = mockOAuth({
      data: { issueCreate: { success: true, issue: { id: 'new_iss', identifier: 'PROJ-42', url: 'https://linear.app/issue/PROJ-42' } } },
    });
    const result = await new LinearCreateIssueTool(oauth).execute({ title: 'New feature', team_id: 'team_1' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('PROJ-42'));
  });
});

describe('LinearUpdateIssueTool', () => {
  it('updates issue', async () => {
    const oauth = mockOAuth({
      data: { issueUpdate: { success: true, issue: { id: 'iss_1', identifier: 'PROJ-1', state: { name: 'Done' } } } },
    });
    const result = await new LinearUpdateIssueTool(oauth).execute({ issue_id: 'iss_1', state_name: 'Done' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('PROJ-1'));
  });

  it('handles GraphQL error', async () => {
    const oauth = mockOAuth({ errors: [{ message: 'Issue not found' }] });
    const result = await new LinearUpdateIssueTool(oauth).execute({ issue_id: 'bad_id' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Issue not found'));
  });
});
