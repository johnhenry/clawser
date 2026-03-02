// clawser-integration-github.js — GitHub integration tools via OAuth
//
// 3 tool classes for GitHub operations using authenticated GitHub API (REST v3).
// Requires a connected 'github' OAuth provider.
//
// Tools:
//   GitHubPrReviewTool    — Get PR details, diff stats, and review info
//   GitHubIssueCreateTool — Create a new GitHub issue
//   GitHubCodeSearchTool  — Search code across GitHub repositories

// ── Base ──────────────────────────────────────────────────────────

class GitHubToolBase {
  #oauth;

  constructor(oauth) { this.#oauth = oauth; }

  get schema() { return { type: 'object', properties: {}, required: [] }; }

  async _getClient() {
    const client = await this.#oauth.getClient('github');
    if (!client) throw new Error('Not connected to GitHub. Use oauth_connect first.');
    return client;
  }

  async _apiGet(path) {
    const client = await this._getClient();
    const resp = await client.fetch(path, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`GitHub API error ${resp.status}: ${text.slice(0, 200)}`);
    }
    return resp.json();
  }

  async _apiPost(path, body) {
    const client = await this._getClient();
    const resp = await client.fetch(path, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`GitHub API error ${resp.status}: ${text.slice(0, 200)}`);
    }
    return resp.json();
  }
}

// ── Tools ─────────────────────────────────────────────────────────

export class GitHubPrReviewTool extends GitHubToolBase {
  get name() { return 'github_pr_review'; }
  get description() { return 'Get pull request details including diff stats, file changes, and reviews.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        pull_number: { type: 'number', description: 'Pull request number' },
      },
      required: ['owner', 'repo', 'pull_number'],
    };
  }

  async execute({ owner, repo, pull_number }) {
    try {
      const pr = await this._apiGet(`/repos/${owner}/${repo}/pulls/${pull_number}`);

      const summary = {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.user?.login || 'unknown',
        body: (pr.body || '').slice(0, 500),
        url: pr.html_url,
        changed_files: pr.changed_files || 0,
        additions: pr.additions || 0,
        deletions: pr.deletions || 0,
        mergeable: pr.mergeable ?? null,
        draft: pr.draft || false,
      };

      return { success: true, output: JSON.stringify(summary, null, 2) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class GitHubIssueCreateTool extends GitHubToolBase {
  get name() { return 'github_issue_create'; }
  get description() { return 'Create a new issue in a GitHub repository.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body (Markdown)' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Labels to add' },
        assignees: { type: 'array', items: { type: 'string' }, description: 'Assignee usernames' },
      },
      required: ['owner', 'repo', 'title'],
    };
  }

  async execute({ owner, repo, title, body, labels, assignees }) {
    try {
      const payload = { title };
      if (body) payload.body = body;
      if (labels?.length > 0) payload.labels = labels;
      if (assignees?.length > 0) payload.assignees = assignees;

      const data = await this._apiPost(`/repos/${owner}/${repo}/issues`, payload);
      return { success: true, output: `Created issue #${data.number} — ${data.html_url}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class GitHubCodeSearchTool extends GitHubToolBase {
  get name() { return 'github_code_search'; }
  get description() { return 'Search code across GitHub repositories using GitHub code search syntax.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (e.g., "parseConfig language:javascript repo:org/repo")' },
        per_page: { type: 'number', description: 'Results per page (default: 10, max: 100)' },
        page: { type: 'number', description: 'Page number (default: 1)' },
      },
      required: ['query'],
    };
  }

  async execute({ query, per_page = 10, page = 1 }) {
    try {
      const params = new URLSearchParams({
        q: query,
        per_page: String(Math.min(per_page, 100)),
        page: String(page),
      });
      const data = await this._apiGet(`/search/code?${params}`);

      const results = {
        total_count: data.total_count || 0,
        items: (data.items || []).map(item => ({
          name: item.name,
          path: item.path,
          repository: item.repository?.full_name || '',
          url: item.html_url || '',
          score: item.score || 0,
        })),
      };

      return { success: true, output: JSON.stringify(results, null, 2) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}
