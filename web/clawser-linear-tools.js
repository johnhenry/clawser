// clawser-linear-tools.js — Linear API tool classes
//
// 3 tool classes using OAuthManager for authenticated Linear GraphQL API calls.
// Linear uses a GraphQL endpoint at https://api.linear.app/graphql.
//
// Tools:
//   LinearIssuesTool      — List/search issues
//   LinearCreateIssueTool — Create a new issue
//   LinearUpdateIssueTool — Update an existing issue

// ── Base ──────────────────────────────────────────────────────────

class LinearToolBase {
  #oauth;

  constructor(oauth) { this.#oauth = oauth; }

  get schema() { return { type: 'object', properties: {}, required: [] }; }

  async _getClient() {
    const client = await this.#oauth.getClient('linear');
    if (!client) throw new Error('Not connected to Linear. Use oauth_connect first.');
    return client;
  }

  /**
   * Execute a GraphQL query against Linear API.
   * @param {string} query - GraphQL query
   * @param {object} [variables] - Query variables
   * @returns {Promise<object>} Response data
   */
  async _graphql(query, variables = {}) {
    const client = await this._getClient();
    const resp = await client.fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Linear HTTP error ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = await resp.json();
    if (data.errors?.length > 0) {
      throw new Error(`Linear GraphQL error: ${data.errors.map(e => e.message).join(', ')}`);
    }
    return data.data;
  }
}

// ── Tools ─────────────────────────────────────────────────────────

export class LinearIssuesTool extends LinearToolBase {
  get name() { return 'linear_issues'; }
  get description() { return 'List or search Linear issues with optional filters.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        team_id: { type: 'string', description: 'Filter by team ID' },
        state_name: { type: 'string', description: 'Filter by state name (e.g., "In Progress")' },
        assignee_id: { type: 'string', description: 'Filter by assignee user ID' },
        first: { type: 'number', description: 'Max issues to return (default: 20)' },
        query: { type: 'string', description: 'Search query string' },
      },
      required: [],
    };
  }

  async execute({ team_id, state_name, assignee_id, first = 20, query: searchQuery } = {}) {
    try {
      // Build filter
      const filters = [];
      if (team_id) filters.push(`team: { id: { eq: "${team_id}" } }`);
      if (state_name) filters.push(`state: { name: { eq: "${state_name}" } }`);
      if (assignee_id) filters.push(`assignee: { id: { eq: "${assignee_id}" } }`);
      const filterStr = filters.length > 0 ? `filter: { ${filters.join(', ')} },` : '';

      const gql = `
        query {
          issues(${filterStr} first: ${first}, orderBy: updatedAt) {
            nodes {
              id
              identifier
              title
              state { name }
              priority
              assignee { name }
              updatedAt
            }
          }
        }
      `;

      const data = await this._graphql(gql);
      const issues = (data.issues?.nodes || []).map(i => ({
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        state: i.state?.name || '',
        priority: i.priority,
        assignee: i.assignee?.name || 'unassigned',
        updatedAt: i.updatedAt,
      }));
      return { success: true, output: JSON.stringify(issues, null, 2) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class LinearCreateIssueTool extends LinearToolBase {
  get name() { return 'linear_create_issue'; }
  get description() { return 'Create a new issue in Linear.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Issue title' },
        team_id: { type: 'string', description: 'Team ID to create the issue in' },
        description: { type: 'string', description: 'Issue description (Markdown)' },
        priority: { type: 'number', description: 'Priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)' },
        assignee_id: { type: 'string', description: 'Assignee user ID' },
        label_ids: { type: 'array', items: { type: 'string' }, description: 'Label IDs to attach' },
      },
      required: ['title', 'team_id'],
    };
  }

  async execute({ title, team_id, description, priority, assignee_id, label_ids }) {
    try {
      const inputParts = [`title: "${title.replace(/"/g, '\\"')}"`, `teamId: "${team_id}"`];
      if (description) inputParts.push(`description: "${description.replace(/"/g, '\\"')}"`);
      if (priority !== undefined) inputParts.push(`priority: ${priority}`);
      if (assignee_id) inputParts.push(`assigneeId: "${assignee_id}"`);
      if (label_ids?.length > 0) inputParts.push(`labelIds: [${label_ids.map(id => `"${id}"`).join(', ')}]`);

      const gql = `
        mutation {
          issueCreate(input: { ${inputParts.join(', ')} }) {
            success
            issue {
              id
              identifier
              url
            }
          }
        }
      `;

      const data = await this._graphql(gql);
      const issue = data.issueCreate?.issue;
      if (!issue) throw new Error('Issue creation returned no data');
      return { success: true, output: `Created issue ${issue.identifier} (${issue.id})${issue.url ? ` — ${issue.url}` : ''}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class LinearUpdateIssueTool extends LinearToolBase {
  get name() { return 'linear_update_issue'; }
  get description() { return 'Update an existing Linear issue.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        issue_id: { type: 'string', description: 'Issue ID to update' },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
        state_name: { type: 'string', description: 'New state name (e.g., "Done")' },
        priority: { type: 'number', description: 'New priority level' },
        assignee_id: { type: 'string', description: 'New assignee user ID' },
      },
      required: ['issue_id'],
    };
  }

  async execute({ issue_id, title, description, state_name, priority, assignee_id }) {
    try {
      const inputParts = [];
      if (title) inputParts.push(`title: "${title.replace(/"/g, '\\"')}"`);
      if (description) inputParts.push(`description: "${description.replace(/"/g, '\\"')}"`);
      if (state_name) inputParts.push(`stateName: "${state_name}"`);
      if (priority !== undefined) inputParts.push(`priority: ${priority}`);
      if (assignee_id) inputParts.push(`assigneeId: "${assignee_id}"`);

      const gql = `
        mutation {
          issueUpdate(id: "${issue_id}", input: { ${inputParts.join(', ')} }) {
            success
            issue {
              id
              identifier
              state { name }
            }
          }
        }
      `;

      const data = await this._graphql(gql);
      const issue = data.issueUpdate?.issue;
      if (!issue) throw new Error('Issue update returned no data');
      return {
        success: true,
        output: `Updated issue ${issue.identifier} (state: ${issue.state?.name || 'unchanged'})`,
      };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}
