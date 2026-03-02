// clawser-notion-tools.js — Notion API tool classes
//
// 4 tool classes using OAuthManager for authenticated Notion API calls.
// Notion API requires Notion-Version header and uses /v1/ base paths.
//
// Tools:
//   NotionSearchTool         — Search across pages and databases
//   NotionCreatePageTool     — Create a new page in a database or under a parent page
//   NotionUpdatePageTool     — Update page properties
//   NotionQueryDatabaseTool  — Query a Notion database with optional filter/sort

const NOTION_VERSION = '2022-06-28';

// ── Base ──────────────────────────────────────────────────────────

class NotionToolBase {
  #oauth;

  constructor(oauth) { this.#oauth = oauth; }

  get schema() { return { type: 'object', properties: {}, required: [] }; }

  async _getClient() {
    const client = await this.#oauth.getClient('notion');
    if (!client) throw new Error('Not connected to Notion. Use oauth_connect first.');
    return client;
  }

  async _apiPost(path, body) {
    const client = await this._getClient();
    const resp = await client.fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Notion API error ${resp.status}: ${text.slice(0, 200)}`);
    }
    return resp.json();
  }

  async _apiPatch(path, body) {
    const client = await this._getClient();
    const resp = await client.fetch(path, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Notion API error ${resp.status}: ${text.slice(0, 200)}`);
    }
    return resp.json();
  }
}

// ── Tools ─────────────────────────────────────────────────────────

export class NotionSearchTool extends NotionToolBase {
  get name() { return 'notion_search'; }
  get description() { return 'Search across Notion pages and databases by query.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        filter_type: { type: 'string', description: 'Filter by object type: page or database' },
        page_size: { type: 'number', description: 'Max results (default: 10)' },
      },
      required: ['query'],
    };
  }

  async execute({ query, filter_type, page_size = 10 }) {
    try {
      const body = { query, page_size };
      if (filter_type) body.filter = { value: filter_type, property: 'object' };
      const data = await this._apiPost('/search', body);
      const results = (data.results || []).map(r => ({
        id: r.id,
        object: r.object,
        url: r.url || '',
      }));
      return { success: true, output: JSON.stringify(results, null, 2) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class NotionCreatePageTool extends NotionToolBase {
  get name() { return 'notion_create_page'; }
  get description() { return 'Create a new page in a Notion database or under a parent page.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        parent_id: { type: 'string', description: 'Database ID or parent page ID' },
        title: { type: 'string', description: 'Page title' },
        parent_type: { type: 'string', description: '"database_id" or "page_id" (default: database_id)' },
        properties: { type: 'string', description: 'Additional properties as JSON string' },
        content: { type: 'string', description: 'Page body text (paragraph block)' },
      },
      required: ['parent_id', 'title'],
    };
  }

  async execute({ parent_id, title, parent_type = 'database_id', properties: propsJson, content }) {
    try {
      const parent = { [parent_type]: parent_id };
      const props = propsJson ? JSON.parse(propsJson) : {};
      // Title property — Notion databases require a title property
      props.title = props.title || {
        title: [{ type: 'text', text: { content: title } }],
      };
      // If parent is a page, use Name instead
      if (parent_type === 'page_id') {
        delete props.title;
        props.Name = { title: [{ type: 'text', text: { content: title } }] };
      }

      const body = { parent, properties: props };

      // Add content as paragraph blocks
      if (content) {
        body.children = [{
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content } }],
          },
        }];
      }

      const data = await this._apiPost('/pages', body);
      return { success: true, output: `Created page ${data.id}${data.url ? ` — ${data.url}` : ''}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class NotionUpdatePageTool extends NotionToolBase {
  get name() { return 'notion_update_page'; }
  get description() { return 'Update properties of an existing Notion page.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Page ID to update' },
        properties: { type: 'string', description: 'Properties to update as JSON string' },
        archived: { type: 'boolean', description: 'Set to true to archive the page' },
      },
      required: ['page_id'],
    };
  }

  async execute({ page_id, properties: propsJson, archived }) {
    try {
      const body = {};
      if (propsJson) body.properties = JSON.parse(propsJson);
      if (archived !== undefined) body.archived = archived;

      const data = await this._apiPatch(`/pages/${page_id}`, body);
      return { success: true, output: `Updated page ${data.id} (last edited: ${data.last_edited_time || 'unknown'})` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class NotionQueryDatabaseTool extends NotionToolBase {
  get name() { return 'notion_query_database'; }
  get description() { return 'Query a Notion database with optional filter and sorts.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        database_id: { type: 'string', description: 'Database ID to query' },
        filter: { type: 'string', description: 'Filter object as JSON string' },
        sorts: { type: 'string', description: 'Sorts array as JSON string' },
        page_size: { type: 'number', description: 'Max results (default: 20)' },
      },
      required: ['database_id'],
    };
  }

  async execute({ database_id, filter: filterJson, sorts: sortsJson, page_size = 20 }) {
    try {
      const body = { page_size };
      if (filterJson) body.filter = JSON.parse(filterJson);
      if (sortsJson) body.sorts = JSON.parse(sortsJson);

      const data = await this._apiPost(`/databases/${database_id}/query`, body);
      const results = (data.results || []).map(r => ({
        id: r.id,
        url: r.url || '',
        last_edited: r.last_edited_time || '',
      }));
      return { success: true, output: JSON.stringify(results, null, 2) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}
