// clawser-slack-tools.js — Slack API tool classes
//
// 3 tool classes using OAuthManager for authenticated Slack Web API calls.
// Slack API uses form-encoded params for some endpoints and JSON for others.
//
// Tools:
//   SlackChannelsTool — List channels the bot has access to
//   SlackPostTool     — Post a message to a Slack channel
//   SlackHistoryTool  — Retrieve recent messages from a channel

// ── Base ──────────────────────────────────────────────────────────

class SlackToolBase {
  #oauth;

  constructor(oauth) { this.#oauth = oauth; }

  get schema() { return { type: 'object', properties: {}, required: [] }; }

  async _getClient() {
    const client = await this.#oauth.getClient('slack');
    if (!client) throw new Error('Not connected to Slack. Use oauth_connect first.');
    return client;
  }

  async _apiGet(path) {
    const client = await this._getClient();
    const resp = await client.fetch(path);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Slack HTTP error ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = await resp.json();
    if (!data.ok) throw new Error(`Slack API error: ${data.error || 'unknown'}`);
    return data;
  }

  async _apiPost(path, body) {
    const client = await this._getClient();
    const resp = await client.fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Slack HTTP error ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = await resp.json();
    if (!data.ok) throw new Error(`Slack API error: ${data.error || 'unknown'}`);
    return data;
  }
}

// ── Tools ─────────────────────────────────────────────────────────

export class SlackChannelsTool extends SlackToolBase {
  get name() { return 'slack_channels'; }
  get description() { return 'List Slack channels the bot has access to.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max channels to return (default: 100)' },
        types: { type: 'string', description: 'Channel types (default: "public_channel,private_channel")' },
      },
      required: [],
    };
  }

  async execute({ limit = 100, types = 'public_channel,private_channel' } = {}) {
    try {
      const params = new URLSearchParams({ limit: String(limit), types });
      const data = await this._apiGet(`/conversations.list?${params}`);
      const channels = (data.channels || []).map(ch => ({
        id: ch.id,
        name: ch.name,
        topic: ch.topic?.value || '',
        num_members: ch.num_members || 0,
        is_private: ch.is_private || false,
      }));
      return { success: true, output: JSON.stringify(channels, null, 2) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class SlackPostTool extends SlackToolBase {
  get name() { return 'slack_post'; }
  get description() { return 'Post a message to a Slack channel.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel ID (e.g., C01234567)' },
        text: { type: 'string', description: 'Message text (supports Slack markdown)' },
        thread_ts: { type: 'string', description: 'Thread timestamp to reply in a thread' },
        unfurl_links: { type: 'boolean', description: 'Unfurl links in the message (default: true)' },
      },
      required: ['channel', 'text'],
    };
  }

  async execute({ channel, text, thread_ts, unfurl_links = true }) {
    try {
      const body = { channel, text, unfurl_links };
      if (thread_ts) body.thread_ts = thread_ts;

      const data = await this._apiPost('/chat.postMessage', body);
      return { success: true, output: `Posted message ${data.ts} to ${data.channel}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class SlackHistoryTool extends SlackToolBase {
  get name() { return 'slack_history'; }
  get description() { return 'Retrieve recent messages from a Slack channel.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel ID' },
        limit: { type: 'number', description: 'Max messages to return (default: 20)' },
        oldest: { type: 'string', description: 'Only messages after this timestamp' },
        latest: { type: 'string', description: 'Only messages before this timestamp' },
      },
      required: ['channel'],
    };
  }

  async execute({ channel, limit = 20, oldest, latest }) {
    try {
      const params = new URLSearchParams({ channel, limit: String(limit) });
      if (oldest) params.set('oldest', oldest);
      if (latest) params.set('latest', latest);

      const data = await this._apiGet(`/conversations.history?${params}`);
      const messages = (data.messages || []).map(m => ({
        ts: m.ts,
        user: m.user || m.bot_id || '',
        text: m.text || '',
        type: m.type || 'message',
      }));
      return { success: true, output: JSON.stringify(messages, null, 2) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}
