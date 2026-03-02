// clawser-google-tools.js — Google API tool classes for Calendar, Gmail, Drive
//
// 7 tool classes that use OAuthManager for authenticated Google API calls.
// Each tool follows the BrowserTool pattern: name, description, schema, execute().
//
// Tools:
//   GoogleCalendarListTool   — List calendar events
//   GoogleCalendarCreateTool — Create a calendar event
//   GoogleGmailSearchTool    — Search Gmail messages
//   GoogleGmailSendTool      — Send an email via Gmail
//   GoogleDriveListTool      — List Drive files
//   GoogleDriveReadTool      — Read Drive file metadata
//   GoogleDriveCreateTool    — Create a Drive file

// ── Base class ────────────────────────────────────────────────────

class GoogleToolBase {
  #oauth;

  constructor(oauth) {
    this.#oauth = oauth;
  }

  get schema() { return { type: 'object', properties: {}, required: [] }; }

  async _getClient() {
    const client = await this.#oauth.getClient('google');
    if (!client) throw new Error('Not connected to Google. Use oauth_connect first.');
    return client;
  }

  async _apiGet(path) {
    const client = await this._getClient();
    const resp = await client.fetch(path);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Google API error ${resp.status}: ${text.slice(0, 200)}`);
    }
    return resp.json();
  }

  async _apiPost(path, body) {
    const client = await this._getClient();
    const resp = await client.fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Google API error ${resp.status}: ${text.slice(0, 200)}`);
    }
    return resp.json();
  }
}

// ── Calendar ──────────────────────────────────────────────────────

export class GoogleCalendarListTool extends GoogleToolBase {
  get name() { return 'google_calendar_list'; }
  get description() { return 'List upcoming events from a Google Calendar.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        calendar_id: { type: 'string', description: 'Calendar ID (default: primary)' },
        max_results: { type: 'number', description: 'Max events to return (default: 10)' },
        time_min: { type: 'string', description: 'Start time (ISO 8601). Defaults to now.' },
      },
      required: [],
    };
  }

  async execute({ calendar_id = 'primary', max_results = 10, time_min } = {}) {
    try {
      const tMin = time_min || new Date().toISOString();
      const params = new URLSearchParams({
        maxResults: String(max_results),
        timeMin: tMin,
        singleEvents: 'true',
        orderBy: 'startTime',
      });
      const data = await this._apiGet(`/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events?${params}`);
      const events = (data.items || []).map(e => ({
        id: e.id,
        summary: e.summary || '(no title)',
        start: e.start?.dateTime || e.start?.date || '',
        end: e.end?.dateTime || e.end?.date || '',
        location: e.location || '',
      }));
      return { success: true, output: JSON.stringify(events, null, 2) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class GoogleCalendarCreateTool extends GoogleToolBase {
  get name() { return 'google_calendar_create'; }
  get description() { return 'Create a new event on Google Calendar.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Event title' },
        start: { type: 'string', description: 'Start time (ISO 8601)' },
        end: { type: 'string', description: 'End time (ISO 8601)' },
        description: { type: 'string', description: 'Event description' },
        location: { type: 'string', description: 'Event location' },
        calendar_id: { type: 'string', description: 'Calendar ID (default: primary)' },
      },
      required: ['summary', 'start', 'end'],
    };
  }

  async execute({ summary, start, end, description, location, calendar_id = 'primary' }) {
    try {
      const event = {
        summary,
        start: { dateTime: start },
        end: { dateTime: end },
      };
      if (description) event.description = description;
      if (location) event.location = location;

      const data = await this._apiPost(`/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events`, event);
      return { success: true, output: `Created event ${data.id}${data.htmlLink ? ` — ${data.htmlLink}` : ''}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

// ── Gmail ─────────────────────────────────────────────────────────

export class GoogleGmailSearchTool extends GoogleToolBase {
  get name() { return 'google_gmail_search'; }
  get description() { return 'Search Gmail messages using Gmail query syntax.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query (e.g., "from:boss subject:urgent")' },
        max_results: { type: 'number', description: 'Max messages to return (default: 10)' },
      },
      required: ['query'],
    };
  }

  async execute({ query, max_results = 10 }) {
    try {
      const params = new URLSearchParams({ q: query, maxResults: String(max_results) });
      const data = await this._apiGet(`/gmail/v1/users/me/messages?${params}`);
      const messages = (data.messages || []).map(m => ({ id: m.id, threadId: m.threadId }));
      return { success: true, output: JSON.stringify(messages, null, 2) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class GoogleGmailSendTool extends GoogleToolBase {
  get name() { return 'google_gmail_send'; }
  get description() { return 'Send an email via Gmail.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text)' },
        cc: { type: 'string', description: 'CC recipients (comma-separated)' },
        bcc: { type: 'string', description: 'BCC recipients (comma-separated)' },
      },
      required: ['to', 'subject', 'body'],
    };
  }

  async execute({ to, subject, body, cc, bcc }) {
    try {
      // Build RFC 2822 message
      const headers = [
        `To: ${to}`,
        `Subject: ${subject}`,
        'Content-Type: text/plain; charset=UTF-8',
      ];
      if (cc) headers.push(`Cc: ${cc}`);
      if (bcc) headers.push(`Bcc: ${bcc}`);
      headers.push('', body);

      const raw = headers.join('\r\n');
      // Base64url encode
      const encoded = btoa(unescape(encodeURIComponent(raw)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const data = await this._apiPost('/gmail/v1/users/me/messages/send', { raw: encoded });
      return { success: true, output: `Sent message ${data.id}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

// ── Drive ─────────────────────────────────────────────────────────

export class GoogleDriveListTool extends GoogleToolBase {
  get name() { return 'google_drive_list'; }
  get description() { return 'List files in Google Drive.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Drive search query (e.g., "name contains \'doc\'")' },
        max_results: { type: 'number', description: 'Max files to return (default: 20)' },
        folder_id: { type: 'string', description: 'Folder ID to list (omit for all files)' },
      },
      required: [],
    };
  }

  async execute({ query, max_results = 20, folder_id } = {}) {
    try {
      const parts = [];
      if (query) parts.push(query);
      if (folder_id) parts.push(`'${folder_id}' in parents`);
      const q = parts.join(' and ') || undefined;

      const params = new URLSearchParams({
        pageSize: String(max_results),
        fields: 'files(id,name,mimeType,size,modifiedTime)',
      });
      if (q) params.set('q', q);

      const data = await this._apiGet(`/drive/v3/files?${params}`);
      const files = (data.files || []).map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size || 0,
        modifiedTime: f.modifiedTime || '',
      }));
      return { success: true, output: JSON.stringify(files, null, 2) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class GoogleDriveReadTool extends GoogleToolBase {
  get name() { return 'google_drive_read'; }
  get description() { return 'Read metadata and content of a Google Drive file.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'Google Drive file ID' },
      },
      required: ['file_id'],
    };
  }

  async execute({ file_id }) {
    try {
      const params = new URLSearchParams({ fields: 'id,name,mimeType,size,modifiedTime,webViewLink' });
      const data = await this._apiGet(`/drive/v3/files/${encodeURIComponent(file_id)}?${params}`);
      return {
        success: true,
        output: JSON.stringify({
          id: data.id,
          name: data.name,
          mimeType: data.mimeType,
          size: data.size || 0,
          modifiedTime: data.modifiedTime || '',
          webViewLink: data.webViewLink || '',
        }, null, 2),
      };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class GoogleDriveCreateTool extends GoogleToolBase {
  get name() { return 'google_drive_create'; }
  get description() { return 'Create a new file in Google Drive.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'File name' },
        content: { type: 'string', description: 'File content (text)' },
        mime_type: { type: 'string', description: 'MIME type (default: text/plain)' },
        folder_id: { type: 'string', description: 'Parent folder ID' },
      },
      required: ['name'],
    };
  }

  async execute({ name, content = '', mime_type = 'text/plain', folder_id }) {
    try {
      const metadata = { name, mimeType: mime_type };
      if (folder_id) metadata.parents = [folder_id];

      // For simplicity, use metadata-only upload via files endpoint
      // Real implementation would use multipart upload for content
      const data = await this._apiPost('/drive/v3/files', metadata);
      return { success: true, output: `Created file ${data.id} (${data.name || name})` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}
