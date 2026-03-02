// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-integration-github.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GitHubPrReviewTool,
  GitHubIssueCreateTool,
  GitHubCodeSearchTool,
} from '../clawser-integration-github.js';

function mockOAuth(responseData, { status = 200 } = {}) {
  return {
    getClient: async (provider) => provider === 'github' ? {
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

describe('GitHub integration tool basics', () => {
  const tools = [
    new GitHubPrReviewTool(mockOAuth({})),
    new GitHubIssueCreateTool(mockOAuth({})),
    new GitHubCodeSearchTool(mockOAuth({})),
  ];

  it('all have unique names starting with github_', () => {
    const names = tools.map(t => t.name);
    assert.equal(new Set(names).size, 3);
    for (const n of names) assert.ok(n.startsWith('github_'), n);
  });

  it('all have descriptions and schemas', () => {
    for (const t of tools) {
      assert.ok(t.description.length > 0);
      assert.equal(t.schema.type, 'object');
    }
  });
});

describe('GitHubPrReviewTool', () => {
  it('returns PR details with files and reviews', async () => {
    const oauth = mockOAuth({
      number: 42, title: 'Fix typo', state: 'open', user: { login: 'alice' },
      body: 'Fixes a small typo', html_url: 'https://github.com/org/repo/pull/42',
      changed_files: 2, additions: 10, deletions: 3,
    });
    const result = await new GitHubPrReviewTool(oauth).execute({ owner: 'org', repo: 'repo', pull_number: 42 });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('Fix typo'));
    assert.ok(result.output.includes('42'));
  });

  it('fails when not connected', async () => {
    const result = await new GitHubPrReviewTool(failOAuth()).execute({ owner: 'o', repo: 'r', pull_number: 1 });
    assert.equal(result.success, false);
  });
});

describe('GitHubIssueCreateTool', () => {
  it('creates issue and returns url', async () => {
    const oauth = mockOAuth({ number: 99, html_url: 'https://github.com/org/repo/issues/99', title: 'Bug report' });
    const result = await new GitHubIssueCreateTool(oauth).execute({ owner: 'org', repo: 'repo', title: 'Bug report', body: 'Steps to reproduce...' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('#99'));
  });
});

describe('GitHubCodeSearchTool', () => {
  it('returns matching code results', async () => {
    const oauth = mockOAuth({
      total_count: 2,
      items: [
        { name: 'utils.js', path: 'src/utils.js', repository: { full_name: 'org/repo' }, html_url: 'https://github.com/org/repo/blob/main/src/utils.js' },
        { name: 'helpers.js', path: 'src/helpers.js', repository: { full_name: 'org/repo' }, html_url: 'https://github.com/org/repo/blob/main/src/helpers.js' },
      ],
    });
    const result = await new GitHubCodeSearchTool(oauth).execute({ query: 'parseConfig language:javascript' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('utils.js'));
    assert.ok(result.output.includes('helpers.js'));
  });

  it('handles empty results', async () => {
    const oauth = mockOAuth({ total_count: 0, items: [] });
    const result = await new GitHubCodeSearchTool(oauth).execute({ query: 'nonexistent_function_xyz' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('0'));
  });
});
