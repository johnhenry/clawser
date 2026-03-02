// clawser-integration-email.js — Email integration tools via Gmail
//
// Higher-level tools wrapping Gmail search/send for agent-friendly email operations.
//
// Tools:
//   EmailDraftTool      — Compose and save/send an email draft
//   EmailSummarizeTool  — Summarize recent emails matching a query
//   EmailTriageTool     — Triage unread emails with priority categorization

import { BrowserTool } from './clawser-tools.js';

// ── EmailDraftTool ────────────────────────────────────────────────

export class EmailDraftTool extends BrowserTool {
  #gmailSend;

  /**
   * @param {object} gmailSendTool - A GoogleGmailSendTool instance (or compatible)
   */
  constructor(gmailSendTool) {
    super();
    this.#gmailSend = gmailSendTool;
  }

  get name() { return 'email_draft'; }
  get description() { return 'Compose and send an email draft via Gmail.'; }
  get permission() { return 'approve'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body text' },
        cc: { type: 'string', description: 'CC recipients (comma-separated)' },
        tone: { type: 'string', description: 'Desired tone: formal, casual, concise (hint for agent)' },
      },
      required: ['to', 'subject', 'body'],
    };
  }

  async execute({ to, subject, body, cc, tone }) {
    try {
      const result = await this.#gmailSend.execute({ to, subject, body, cc });
      if (!result.success) return result;
      return { success: true, output: `Draft sent. ${result.output}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

// ── EmailSummarizeTool ────────────────────────────────────────────

export class EmailSummarizeTool extends BrowserTool {
  #gmailSearch;
  #oauth;

  /**
   * @param {object} gmailSearchTool - A GoogleGmailSearchTool instance (or compatible)
   * @param {object} oauth - OAuthManager for fetching full message details
   */
  constructor(gmailSearchTool, oauth) {
    super();
    this.#gmailSearch = gmailSearchTool;
    this.#oauth = oauth;
  }

  get name() { return 'email_summarize'; }
  get description() { return 'Summarize recent emails matching a Gmail search query.'; }
  get permission() { return 'approve'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query (e.g., "from:alice after:2026/01/01")' },
        max_results: { type: 'number', description: 'Max emails to summarize (default: 5)' },
      },
      required: ['query'],
    };
  }

  async execute({ query, max_results = 5 }) {
    try {
      // Get message list
      const searchResult = await this.#gmailSearch.execute({ query, max_results });
      if (!searchResult.success) return searchResult;

      const messages = JSON.parse(searchResult.output);
      if (messages.length === 0) {
        return { success: true, output: 'No emails found matching the query.' };
      }

      // Fetch details for each message
      const client = await this.#oauth.getClient('google');
      const summaries = [];

      for (const msg of messages.slice(0, max_results)) {
        try {
          const resp = await client.fetch(`/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
          const data = await resp.json();

          const headers = data.payload?.headers || [];
          const from = headers.find(h => h.name === 'From')?.value || 'unknown';
          const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
          const date = headers.find(h => h.name === 'Date')?.value || '';

          summaries.push({
            id: msg.id,
            from,
            subject,
            date,
            snippet: data.snippet || '',
          });
        } catch {
          summaries.push({ id: msg.id, error: 'Failed to fetch details' });
        }
      }

      return { success: true, output: JSON.stringify(summaries, null, 2) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

// ── EmailTriageTool ───────────────────────────────────────────────

export class EmailTriageTool extends BrowserTool {
  #gmailSearch;
  #oauth;

  constructor(gmailSearchTool, oauth) {
    super();
    this.#gmailSearch = gmailSearchTool;
    this.#oauth = oauth;
  }

  get name() { return 'email_triage'; }
  get description() { return 'Triage unread emails, categorizing by apparent priority.'; }
  get permission() { return 'approve'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        max_results: { type: 'number', description: 'Max emails to triage (default: 20)' },
        label: { type: 'string', description: 'Gmail label to filter (default: INBOX)' },
      },
      required: [],
    };
  }

  async execute({ max_results = 20, label = 'INBOX' } = {}) {
    try {
      const query = `is:unread label:${label}`;
      const searchResult = await this.#gmailSearch.execute({ query, max_results });
      if (!searchResult.success) return searchResult;

      const messages = JSON.parse(searchResult.output);
      if (messages.length === 0) {
        return { success: true, output: 'No unread emails to triage.' };
      }

      const client = await this.#oauth.getClient('google');
      const triaged = [];

      for (const msg of messages.slice(0, max_results)) {
        try {
          const resp = await client.fetch(`/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
          const data = await resp.json();

          const headers = data.payload?.headers || [];
          const from = headers.find(h => h.name === 'From')?.value || 'unknown';
          const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
          const snippet = data.snippet || '';

          // Simple priority heuristic based on subject keywords
          const subjectLower = subject.toLowerCase();
          let priority = 'normal';
          if (subjectLower.includes('urgent') || subjectLower.includes('asap') || subjectLower.includes('critical')) {
            priority = 'high';
          } else if (subjectLower.includes('fyi') || subjectLower.includes('newsletter') || subjectLower.includes('digest')) {
            priority = 'low';
          }

          triaged.push({ id: msg.id, from, subject, snippet, priority });
        } catch {
          triaged.push({ id: msg.id, error: 'Failed to fetch' });
        }
      }

      // Group by priority
      const high = triaged.filter(t => t.priority === 'high');
      const normal = triaged.filter(t => t.priority === 'normal');
      const low = triaged.filter(t => t.priority === 'low');
      const errors = triaged.filter(t => t.error);

      const lines = [`Triaged ${triaged.length} unread emails:`];
      if (high.length > 0) {
        lines.push('', `HIGH PRIORITY (${high.length}):`);
        for (const e of high) lines.push(`  ${e.from}: ${e.subject}`);
      }
      if (normal.length > 0) {
        lines.push('', `NORMAL (${normal.length}):`);
        for (const e of normal) lines.push(`  ${e.from}: ${e.subject}`);
      }
      if (low.length > 0) {
        lines.push('', `LOW PRIORITY (${low.length}):`);
        for (const e of low) lines.push(`  ${e.from}: ${e.subject}`);
      }
      if (errors.length > 0) {
        lines.push('', `ERRORS (${errors.length}): ${errors.map(e => e.id).join(', ')}`);
      }

      return { success: true, output: lines.join('\n') };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}
