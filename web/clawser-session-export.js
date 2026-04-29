/**
 * Clawser Session Export — Markdown, HTML, and JSON export for terminal sessions.
 *
 * Provides sanitization (credential stripping), formatting, and self-contained
 * HTML generation for sharing conversation sessions.
 *
 * @module clawser-session-export
 */

// ── Constants ──────────────────────────────────────────────────────

const MAX_RESULT_LENGTH = 5_000;
const CLAWSER_VERSION = '0.1.0';
const EXPORT_VERSION = 1;

/**
 * Regex patterns for known secrets/credentials that must be stripped from exports.
 * @type {RegExp[]}
 */
const SECRET_PATTERNS = [
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,       // Anthropic API keys
  /sk-[a-zA-Z0-9]{20,}/g,             // OpenAI-style keys
  /Bearer [a-zA-Z0-9._\-/+=]{10,}/g,  // Bearer tokens
  /ghp_[a-zA-Z0-9]{20,}/g,             // GitHub PATs
  /github_pat_[a-zA-Z0-9_]{22,}/g,    // GitHub fine-grained PATs
  /gho_[a-zA-Z0-9]{20,}/g,             // GitHub OAuth tokens
  /xoxb-[a-zA-Z0-9-]+/g,             // Slack bot tokens
  /xoxp-[a-zA-Z0-9-]+/g,             // Slack user tokens
  /xoxa-[a-zA-Z0-9-]+/g,             // Slack app tokens
  /AKIA[A-Z0-9]{16}/g,               // AWS access keys
  /AIza[a-zA-Z0-9_-]{35}/g,          // Google API keys
  /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/g, // JWTs
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g,
];

// ── Sanitization ───────────────────────────────────────────────────

/**
 * Deep-scrub all string values in an object, replacing known credential
 * patterns with `[REDACTED]`.
 *
 * @param {*} obj - Object to scrub (mutated in place)
 * @returns {*} The same object, scrubbed
 */
const scrubSecrets = (obj) => {
  if (typeof obj === 'string') {
    let s = obj;
    for (const pat of SECRET_PATTERNS) {
      s = s.replace(pat, '[REDACTED]');
    }
    return s;
  }
  if (Array.isArray(obj)) {
    return obj.map(scrubSecrets);
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      obj[k] = scrubSecrets(v);
    }
  }
  return obj;
};

/**
 * Sanitize a list of session events: deep-clone, strip credentials,
 * and truncate very long tool results.
 *
 * @param {object[]} events - Raw session events
 * @param {{ maxResultLength?: number }} [opts]
 * @returns {object[]} Sanitized copy of events
 */
export const sanitizeEvents = (events, opts = {}) => {
  const maxLen = opts.maxResultLength ?? MAX_RESULT_LENGTH;
  const clone = structuredClone(events);

  for (const evt of clone) {
    scrubSecrets(evt.data);

    // Truncate long stdout/stderr in shell results
    if (evt.type === 'shell_result' && evt.data) {
      if (typeof evt.data.stdout === 'string' && evt.data.stdout.length > maxLen) {
        evt.data.stdout = evt.data.stdout.slice(0, maxLen) + '\n... (truncated)';
      }
      if (typeof evt.data.stderr === 'string' && evt.data.stderr.length > maxLen) {
        evt.data.stderr = evt.data.stderr.slice(0, maxLen) + '\n... (truncated)';
      }
    }

    // Truncate long tool results
    if (evt.type === 'tool_result' && evt.data) {
      if (typeof evt.data.result === 'string' && evt.data.result.length > maxLen) {
        evt.data.result = evt.data.result.slice(0, maxLen) + '\n... (truncated)';
      }
      if (typeof evt.data.output === 'string' && evt.data.output.length > maxLen) {
        evt.data.output = evt.data.output.slice(0, maxLen) + '\n... (truncated)';
      }
    }

    // Truncate long agent responses (edge case: very large responses)
    if (evt.type === 'agent_response' && evt.data) {
      if (typeof evt.data.content === 'string' && evt.data.content.length > maxLen * 2) {
        evt.data.content = evt.data.content.slice(0, maxLen * 2) + '\n... (truncated)';
      }
    }
  }

  return clone;
};

// ── Helpers ────────────────────────────────────────────────────────

const formatTimestamp = (ts) => {
  if (!ts) return '';
  try {
    return new Date(ts).toISOString();
  } catch {
    return String(ts);
  }
};

const formatTime = (ts) => {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return '';
  }
};

const escapeHtml = (str) => {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

// ── Markdown Export ────────────────────────────────────────────────

/**
 * Export session events as a Markdown document.
 *
 * @param {object[]} events - Session events (will be sanitized)
 * @param {{ title?: string, model?: string, sessionMeta?: object }} [opts]
 * @returns {string} Markdown string
 *
 * @example
 *   const md = exportSessionAsMarkdown(events, { title: 'Debug Session', model: 'claude-sonnet-4-20250514' });
 */
export const exportSessionAsMarkdown = (events, opts = {}) => {
  const clean = sanitizeEvents(events);
  const title = opts.title || 'Clawser Session';
  const model = opts.model || 'unknown';
  const created = clean.length > 0 ? formatTimestamp(clean[0].timestamp) : 'N/A';
  const eventCount = clean.length;

  const lines = [
    `# ${title}`,
    '',
    `**Model**: ${model} · **Date**: ${created} · **Events**: ${eventCount}`,
    '',
    '---',
    '',
  ];

  for (const evt of clean) {
    const time = formatTime(evt.timestamp);

    switch (evt.type) {
      case 'shell_command':
        lines.push(`**User** (${time}):`, '');
        lines.push('```sh', `$ ${evt.data?.command || ''}`, '```', '');
        break;

      case 'shell_result': {
        if (evt.data?.stdout) {
          lines.push('```', evt.data.stdout, '```', '');
        }
        if (evt.data?.stderr) {
          lines.push('> **stderr:**', '> ```', `> ${evt.data.stderr}`, '> ```', '');
        }
        if (evt.data?.exitCode !== undefined && evt.data.exitCode !== 0) {
          lines.push(`> Exit code: ${evt.data.exitCode}`, '');
        }
        break;
      }

      case 'agent_prompt':
        lines.push(`**User** (${time}):`, '', evt.data?.content || '', '', '---', '');
        break;

      case 'agent_response':
        lines.push(`**Agent** (${time}):`, '', evt.data?.content || '', '', '---', '');
        break;

      case 'tool_call':
        lines.push(
          `> **Tool Call**: \`${evt.data?.name || 'unknown'}\``,
          '> ```json',
          `> ${JSON.stringify(evt.data?.arguments || evt.data?.args || {}, null, 2).replace(/\n/g, '\n> ')}`,
          '> ```',
          '',
        );
        break;

      case 'tool_result':
        lines.push(
          `> **Tool Result** (\`${evt.data?.name || ''}\`):`,
          '> ```',
          `> ${(evt.data?.result || evt.data?.output || '').replace(/\n/g, '\n> ')}`,
          '> ```',
          '',
        );
        break;

      case 'state_snapshot':
        // Skip state snapshots in markdown — they're internal
        break;

      default:
        // Include unknown event types as collapsed detail
        lines.push(`> *${evt.type}* (${time}): ${JSON.stringify(evt.data)}`, '');
        break;
    }
  }

  return lines.join('\n');
};

// ── JSON Export ─────────────────────────────────────────────────────

/**
 * Export session events as a JSON document with metadata envelope.
 *
 * @param {object[]} events - Session events (will be sanitized)
 * @param {{ title?: string, model?: string, branch?: string, sessionMeta?: object }} [opts]
 * @returns {string} Pretty-printed JSON string
 *
 * @example
 *   const json = exportSessionAsJSON(events, { title: 'Debug Session' });
 */
export const exportSessionAsJSON = (events, opts = {}) => {
  const clean = sanitizeEvents(events);
  const title = opts.title || 'Clawser Session';
  const model = opts.model || 'unknown';
  const created = clean.length > 0 ? formatTimestamp(clean[0].timestamp) : null;

  const envelope = {
    clawser_version: CLAWSER_VERSION,
    export_version: EXPORT_VERSION,
    session: {
      title,
      model,
      created,
      event_count: clean.length,
      branch: opts.branch || 'main',
      ...(opts.sessionMeta || {}),
    },
    events: clean,
  };

  return JSON.stringify(envelope, null, 2);
};

// ── HTML Export ─────────────────────────────────────────────────────

/**
 * Export session events as a standalone HTML file with embedded CSS.
 * No external dependencies — renders offline.
 *
 * @param {object[]} events - Session events (will be sanitized)
 * @param {{ title?: string, model?: string, sessionMeta?: object }} [opts]
 * @returns {string} Complete HTML document string
 *
 * @example
 *   const html = exportSessionAsHTML(events, { title: 'Debug Session' });
 *   // Write to file or download as .html
 */
export const exportSessionAsHTML = (events, opts = {}) => {
  const clean = sanitizeEvents(events);
  const title = opts.title || 'Clawser Session';
  const model = opts.model || 'unknown';
  const created = clean.length > 0 ? formatTimestamp(clean[0].timestamp) : 'N/A';
  const eventCount = clean.length;

  const messagesHtml = clean.map((evt) => {
    const time = formatTime(evt.timestamp);

    switch (evt.type) {
      case 'shell_command':
        return `<div class="message user-message">
  <div class="message-header"><span class="role">User</span><span class="time">${escapeHtml(time)}</span></div>
  <div class="message-body"><pre class="code-block"><code>$ ${escapeHtml(evt.data?.command || '')}</code></pre></div>
</div>`;

      case 'shell_result': {
        const parts = [];
        if (evt.data?.stdout) {
          parts.push(`<pre class="code-block"><code>${escapeHtml(evt.data.stdout)}</code></pre>`);
        }
        if (evt.data?.stderr) {
          parts.push(`<pre class="code-block stderr"><code>${escapeHtml(evt.data.stderr)}</code></pre>`);
        }
        if (evt.data?.exitCode !== undefined && evt.data.exitCode !== 0) {
          parts.push(`<span class="exit-code">Exit code: ${evt.data.exitCode}</span>`);
        }
        if (parts.length === 0) return '';
        return `<div class="message system-message">
  <div class="message-body">${parts.join('\n')}</div>
</div>`;
      }

      case 'agent_prompt':
        return `<div class="message user-message">
  <div class="message-header"><span class="role">User</span><span class="time">${escapeHtml(time)}</span></div>
  <div class="message-body"><p>${escapeHtml(evt.data?.content || '').replace(/\n/g, '<br>')}</p></div>
</div>`;

      case 'agent_response':
        return `<div class="message agent-message">
  <div class="message-header"><span class="role">Agent</span><span class="time">${escapeHtml(time)}</span></div>
  <div class="message-body"><p>${escapeHtml(evt.data?.content || '').replace(/\n/g, '<br>')}</p></div>
</div>`;

      case 'tool_call':
        return `<div class="message tool-message">
  <details>
    <summary><span class="tool-icon">&#9881;</span> Tool Call: <code>${escapeHtml(evt.data?.name || 'unknown')}</code> <span class="time">${escapeHtml(time)}</span></summary>
    <pre class="code-block"><code>${escapeHtml(JSON.stringify(evt.data?.arguments || evt.data?.args || {}, null, 2))}</code></pre>
  </details>
</div>`;

      case 'tool_result':
        return `<div class="message tool-result-message">
  <details>
    <summary><span class="tool-icon">&#10003;</span> Tool Result: <code>${escapeHtml(evt.data?.name || '')}</code></summary>
    <pre class="code-block"><code>${escapeHtml(evt.data?.result || evt.data?.output || '')}</code></pre>
  </details>
</div>`;

      case 'state_snapshot':
        return ''; // Skip internal state snapshots

      default:
        return `<div class="message system-message">
  <div class="message-header"><span class="role">${escapeHtml(evt.type)}</span><span class="time">${escapeHtml(time)}</span></div>
  <div class="message-body"><pre class="code-block"><code>${escapeHtml(JSON.stringify(evt.data, null, 2))}</code></pre></div>
</div>`;
    }
  }).filter(Boolean).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — Clawser Session Export</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #1a1a1c;
    color: #e9e9ea;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    padding: 0;
    margin: 0;
  }

  .container {
    max-width: 860px;
    margin: 0 auto;
    padding: 40px 20px;
  }

  header {
    border-bottom: 1px solid #393941;
    padding-bottom: 20px;
    margin-bottom: 32px;
  }

  header h1 {
    font-size: 20px;
    font-weight: 600;
    color: #e9e9ea;
    margin-bottom: 8px;
  }

  header .meta {
    font-size: 12px;
    color: #a1a1a8;
    font-style: italic;
  }

  header .meta span + span::before {
    content: ' \\00b7 ';
  }

  .message {
    margin-bottom: 16px;
    border-radius: 8px;
    overflow: hidden;
  }

  .message-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 16px;
    font-size: 12px;
  }

  .message-body {
    padding: 12px 16px;
  }

  .message-body p {
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .user-message {
    background: #27272a;
    border-left: 3px solid #8c7ae6;
  }

  .user-message .role {
    color: #8c7ae6;
    font-weight: 600;
  }

  .agent-message {
    background: #27272a;
    border-left: 3px solid #a192ea;
  }

  .agent-message .role {
    color: #a192ea;
    font-weight: 600;
  }

  .system-message {
    background: #232334;
    border-left: 3px solid #393941;
  }

  .system-message .role {
    color: #a1a1a8;
    font-weight: 600;
  }

  .tool-message, .tool-result-message {
    background: #232334;
    border-left: 3px solid #e67e22;
    padding: 8px 16px;
  }

  .tool-message summary, .tool-result-message summary {
    cursor: pointer;
    font-size: 13px;
    color: #a1a1a8;
    padding: 4px 0;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tool-message summary::-webkit-details-marker,
  .tool-result-message summary::-webkit-details-marker {
    display: none;
  }

  .tool-message summary::before,
  .tool-result-message summary::before {
    content: '\\25b6';
    font-size: 10px;
    transition: transform 0.15s;
  }

  .tool-message details[open] summary::before,
  .tool-result-message details[open] summary::before {
    transform: rotate(90deg);
  }

  .tool-icon {
    color: #e67e22;
  }

  .time {
    color: #a1a1a8;
    font-size: 11px;
    font-style: italic;
    margin-left: auto;
  }

  .code-block {
    background: #1a1a1c;
    border: 1px solid #393941;
    border-radius: 8px;
    padding: 12px 16px;
    overflow-x: auto;
    margin: 8px 0;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 13px;
    line-height: 1.5;
  }

  .code-block code {
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .code-block.stderr {
    border-color: #e25f73;
    color: #e25f73;
  }

  .exit-code {
    display: inline-block;
    font-size: 12px;
    color: #e25f73;
    padding: 2px 8px;
    margin-top: 4px;
  }

  footer {
    margin-top: 40px;
    padding-top: 16px;
    border-top: 1px solid #393941;
    font-size: 11px;
    color: #a1a1a8;
    text-align: center;
  }

  /* Search bar */
  .search-bar {
    position: sticky;
    top: 0;
    background: #1a1a1c;
    padding: 12px 0;
    z-index: 10;
    margin-bottom: 16px;
  }

  .search-bar input {
    width: 100%;
    background: #27272a;
    border: 1px solid #393941;
    border-radius: 8px;
    color: #e9e9ea;
    padding: 8px 14px;
    font-size: 14px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  }

  .search-bar input:focus {
    border-color: #8c7ae6;
  }

  .search-bar input::placeholder {
    color: #a1a1a8;
  }

  .hidden { display: none !important; }

  @media print {
    body { background: #fff; color: #111; }
    .search-bar { display: none; }
    .user-message, .agent-message, .system-message,
    .tool-message, .tool-result-message { background: #f5f5f5; border-left-width: 3px; }
    .code-block { background: #f0f0f0; border-color: #ddd; }
    .user-message .role { color: #5a4db8; }
    .agent-message .role { color: #7b6bc4; }
    .time { color: #888; }
    header .meta { color: #888; }
    footer { color: #888; }
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p class="meta">
      <span>Model: ${escapeHtml(model)}</span>
      <span>${eventCount} events</span>
      <span>${escapeHtml(created)}</span>
    </p>
  </header>

  <div class="search-bar">
    <input type="text" id="searchInput" placeholder="Search conversation..." autocomplete="off" spellcheck="false">
  </div>

  <div id="messages">
${messagesHtml}
  </div>

  <footer>
    Exported from Clawser v${CLAWSER_VERSION}
  </footer>
</div>

<script>
(function() {
  var input = document.getElementById('searchInput');
  var messages = document.querySelectorAll('#messages > .message');
  if (!input) return;
  input.addEventListener('input', function() {
    var q = this.value.toLowerCase().trim();
    for (var i = 0; i < messages.length; i++) {
      var text = messages[i].textContent.toLowerCase();
      if (!q || text.indexOf(q) !== -1) {
        messages[i].classList.remove('hidden');
      } else {
        messages[i].classList.add('hidden');
      }
    }
  });
})();
</script>
</body>
</html>`;
};
