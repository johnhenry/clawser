import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
  sanitizeEvents,
  exportSessionAsMarkdown,
  exportSessionAsHTML,
  exportSessionAsJSON,
} = await import('../clawser-session-export.js');

// ── Test fixtures ────────────────────────────────────────────────

const sampleEvents = [
  {
    type: 'agent_prompt',
    data: { content: 'How do I implement a B-tree in Rust?' },
    source: 'user',
    timestamp: 1714300202000,
  },
  {
    type: 'agent_response',
    data: { content: 'Here is a basic B-tree implementation in Rust...' },
    source: 'system',
    timestamp: 1714300205000,
  },
  {
    type: 'shell_command',
    data: { command: 'cargo build', cwd: '/project' },
    source: 'user',
    timestamp: 1714300210000,
  },
  {
    type: 'shell_result',
    data: { stdout: 'Compiling btree v0.1.0\n    Finished dev', stderr: '', exitCode: 0 },
    source: 'system',
    timestamp: 1714300212000,
  },
  {
    type: 'tool_call',
    data: { name: 'web_search', arguments: { query: 'B-tree Rust crate' } },
    source: 'system',
    timestamp: 1714300215000,
  },
  {
    type: 'tool_result',
    data: { name: 'web_search', result: 'Found 3 relevant crates: btree-rs, im-rs, sled' },
    source: 'system',
    timestamp: 1714300216000,
  },
  {
    type: 'state_snapshot',
    data: { cwd: '/project' },
    source: 'system',
    timestamp: 1714300220000,
  },
];

const eventsWithSecrets = [
  {
    type: 'shell_command',
    data: { command: 'export ANTHROPIC_API_KEY=sk-ant-abcdef1234567890abcdef1234567890' },
    source: 'user',
    timestamp: 1714300202000,
  },
  {
    type: 'shell_result',
    data: {
      stdout: 'Token: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      stderr: '',
      exitCode: 0,
    },
    source: 'system',
    timestamp: 1714300203000,
  },
  {
    type: 'agent_response',
    data: {
      content: 'I see you set the key sk-ant-abcdef1234567890abcdef1234567890 and a GitHub token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh',
    },
    source: 'system',
    timestamp: 1714300204000,
  },
  {
    type: 'tool_result',
    data: {
      name: 'read_file',
      result: 'SLACK_TOKEN=xoxb-123-456-abcdefghijklmnop\nAWS_KEY=AKIAIOSFODNN7EXAMPLE',
    },
    source: 'system',
    timestamp: 1714300205000,
  },
];

// ── sanitizeEvents ───────────────────────────────────────────────

describe('sanitizeEvents', () => {
  it('returns a deep clone without modifying originals', () => {
    const original = [{ type: 'agent_prompt', data: { content: 'hello' }, timestamp: 1 }];
    const cleaned = sanitizeEvents(original);
    cleaned[0].data.content = 'MUTATED';
    assert.equal(original[0].data.content, 'hello');
  });

  it('redacts Anthropic API keys', () => {
    const cleaned = sanitizeEvents(eventsWithSecrets);
    assert.ok(!cleaned[0].data.command.includes('sk-ant-'));
    assert.ok(cleaned[0].data.command.includes('[REDACTED]'));
  });

  it('redacts Bearer tokens', () => {
    const cleaned = sanitizeEvents(eventsWithSecrets);
    assert.ok(!cleaned[1].data.stdout.includes('Bearer eyJ'));
    assert.ok(cleaned[1].data.stdout.includes('[REDACTED]'));
  });

  it('redacts GitHub PATs', () => {
    const cleaned = sanitizeEvents(eventsWithSecrets);
    assert.ok(!cleaned[2].data.content.includes('ghp_'));
    assert.ok(cleaned[2].data.content.includes('[REDACTED]'));
  });

  it('redacts Slack tokens', () => {
    const cleaned = sanitizeEvents(eventsWithSecrets);
    assert.ok(!cleaned[3].data.result.includes('xoxb-'));
    assert.ok(cleaned[3].data.result.includes('[REDACTED]'));
  });

  it('redacts AWS access keys', () => {
    const cleaned = sanitizeEvents(eventsWithSecrets);
    assert.ok(!cleaned[3].data.result.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(cleaned[3].data.result.includes('[REDACTED]'));
  });

  it('truncates very long stdout', () => {
    const longOutput = 'x'.repeat(10_000);
    const events = [{
      type: 'shell_result',
      data: { stdout: longOutput, stderr: '', exitCode: 0 },
      source: 'system',
      timestamp: 1,
    }];
    const cleaned = sanitizeEvents(events);
    assert.ok(cleaned[0].data.stdout.length < longOutput.length);
    assert.ok(cleaned[0].data.stdout.includes('(truncated)'));
  });

  it('truncates long tool results', () => {
    const longResult = 'y'.repeat(10_000);
    const events = [{
      type: 'tool_result',
      data: { name: 'test', result: longResult },
      source: 'system',
      timestamp: 1,
    }];
    const cleaned = sanitizeEvents(events);
    assert.ok(cleaned[0].data.result.length < longResult.length);
    assert.ok(cleaned[0].data.result.includes('(truncated)'));
  });

  it('respects custom maxResultLength', () => {
    const events = [{
      type: 'shell_result',
      data: { stdout: 'a'.repeat(200), stderr: '', exitCode: 0 },
      source: 'system',
      timestamp: 1,
    }];
    const cleaned = sanitizeEvents(events, { maxResultLength: 50 });
    assert.ok(cleaned[0].data.stdout.length <= 80); // 50 + truncation message
  });

  it('handles empty events array', () => {
    const cleaned = sanitizeEvents([]);
    assert.deepEqual(cleaned, []);
  });

  it('handles events with null data', () => {
    const events = [{ type: 'unknown', data: null, timestamp: 1 }];
    const cleaned = sanitizeEvents(events);
    assert.equal(cleaned[0].data, null);
  });
});

// ── exportSessionAsMarkdown ──────────────────────────────────────

describe('exportSessionAsMarkdown', () => {
  it('starts with a title header', () => {
    const md = exportSessionAsMarkdown(sampleEvents, { title: 'Test Session' });
    assert.ok(md.startsWith('# Test Session\n'));
  });

  it('includes model and event count in metadata', () => {
    const md = exportSessionAsMarkdown(sampleEvents, { title: 'Test', model: 'claude-sonnet' });
    assert.ok(md.includes('claude-sonnet'));
    assert.ok(md.includes(`${sampleEvents.length}`));
  });

  it('renders user prompts with role label', () => {
    const md = exportSessionAsMarkdown(sampleEvents);
    assert.ok(md.includes('**User**'));
    assert.ok(md.includes('B-tree'));
  });

  it('renders agent responses with role label', () => {
    const md = exportSessionAsMarkdown(sampleEvents);
    assert.ok(md.includes('**Agent**'));
    assert.ok(md.includes('basic B-tree implementation'));
  });

  it('renders shell commands in code blocks', () => {
    const md = exportSessionAsMarkdown(sampleEvents);
    assert.ok(md.includes('```sh'));
    assert.ok(md.includes('$ cargo build'));
  });

  it('renders tool calls with name', () => {
    const md = exportSessionAsMarkdown(sampleEvents);
    assert.ok(md.includes('`web_search`'));
  });

  it('renders tool results', () => {
    const md = exportSessionAsMarkdown(sampleEvents);
    assert.ok(md.includes('Tool Result'));
    assert.ok(md.includes('btree-rs'));
  });

  it('skips state snapshots', () => {
    const md = exportSessionAsMarkdown(sampleEvents);
    assert.ok(!md.includes('state_snapshot'));
  });

  it('sanitizes credentials in output', () => {
    const md = exportSessionAsMarkdown(eventsWithSecrets);
    assert.ok(!md.includes('sk-ant-'));
    assert.ok(md.includes('[REDACTED]'));
  });

  it('uses default title when none provided', () => {
    const md = exportSessionAsMarkdown(sampleEvents);
    assert.ok(md.includes('# Clawser Session'));
  });

  it('handles empty events', () => {
    const md = exportSessionAsMarkdown([]);
    assert.ok(md.includes('# Clawser Session'));
    assert.ok(md.includes('**Events**: 0'));
  });
});

// ── exportSessionAsJSON ──────────────────────────────────────────

describe('exportSessionAsJSON', () => {
  it('returns valid JSON', () => {
    const json = exportSessionAsJSON(sampleEvents);
    assert.doesNotThrow(() => JSON.parse(json));
  });

  it('includes metadata envelope', () => {
    const parsed = JSON.parse(exportSessionAsJSON(sampleEvents, { title: 'Test' }));
    assert.ok(parsed.clawser_version);
    assert.ok(parsed.export_version);
    assert.ok(parsed.session);
    assert.equal(parsed.session.title, 'Test');
  });

  it('includes correct event count', () => {
    const parsed = JSON.parse(exportSessionAsJSON(sampleEvents));
    assert.equal(parsed.session.event_count, sampleEvents.length);
    assert.equal(parsed.events.length, sampleEvents.length);
  });

  it('sanitizes credentials in JSON output', () => {
    const json = exportSessionAsJSON(eventsWithSecrets);
    assert.ok(!json.includes('sk-ant-'));
    assert.ok(!json.includes('ghp_'));
    assert.ok(json.includes('[REDACTED]'));
  });

  it('includes model and branch in session metadata', () => {
    const parsed = JSON.parse(exportSessionAsJSON(sampleEvents, {
      model: 'claude-sonnet',
      branch: 'experiment',
    }));
    assert.equal(parsed.session.model, 'claude-sonnet');
    assert.equal(parsed.session.branch, 'experiment');
  });

  it('defaults branch to main', () => {
    const parsed = JSON.parse(exportSessionAsJSON(sampleEvents));
    assert.equal(parsed.session.branch, 'main');
  });
});

// ── exportSessionAsHTML ──────────────────────────────────────────

describe('exportSessionAsHTML', () => {
  it('returns a complete HTML document', () => {
    const html = exportSessionAsHTML(sampleEvents);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
  });

  it('includes the title in the page', () => {
    const html = exportSessionAsHTML(sampleEvents, { title: 'My Debug Session' });
    assert.ok(html.includes('My Debug Session'));
  });

  it('uses clawser dark theme colors', () => {
    const html = exportSessionAsHTML(sampleEvents);
    assert.ok(html.includes('#1a1a1c'));
    assert.ok(html.includes('#27272a'));
    assert.ok(html.includes('#e9e9ea'));
    assert.ok(html.includes('#8c7ae6'));
  });

  it('includes embedded CSS (no external deps)', () => {
    const html = exportSessionAsHTML(sampleEvents);
    assert.ok(html.includes('<style>'));
    // No external stylesheet links
    assert.ok(!html.includes('<link rel="stylesheet"'));
  });

  it('renders user messages', () => {
    const html = exportSessionAsHTML(sampleEvents);
    assert.ok(html.includes('user-message'));
    assert.ok(html.includes('B-tree'));
  });

  it('renders agent messages', () => {
    const html = exportSessionAsHTML(sampleEvents);
    assert.ok(html.includes('agent-message'));
  });

  it('renders tool calls in collapsible details', () => {
    const html = exportSessionAsHTML(sampleEvents);
    assert.ok(html.includes('<details>'));
    assert.ok(html.includes('web_search'));
  });

  it('includes a search bar', () => {
    const html = exportSessionAsHTML(sampleEvents);
    assert.ok(html.includes('searchInput'));
    assert.ok(html.includes('Search conversation'));
  });

  it('includes print-friendly CSS', () => {
    const html = exportSessionAsHTML(sampleEvents);
    assert.ok(html.includes('@media print'));
  });

  it('escapes HTML in user content', () => {
    const events = [{
      type: 'agent_prompt',
      data: { content: '<script>alert("xss")</script>' },
      source: 'user',
      timestamp: 1,
    }];
    const html = exportSessionAsHTML(events);
    assert.ok(!html.includes('<script>alert'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('sanitizes credentials', () => {
    const html = exportSessionAsHTML(eventsWithSecrets);
    assert.ok(!html.includes('sk-ant-'));
    assert.ok(!html.includes('ghp_'));
    assert.ok(html.includes('[REDACTED]'));
  });

  it('skips state snapshots', () => {
    const html = exportSessionAsHTML(sampleEvents);
    assert.ok(!html.includes('state_snapshot'));
  });

  it('handles shell results with exit codes', () => {
    const events = [{
      type: 'shell_result',
      data: { stdout: '', stderr: 'not found', exitCode: 127 },
      source: 'system',
      timestamp: 1,
    }];
    const html = exportSessionAsHTML(events);
    assert.ok(html.includes('127'));
    assert.ok(html.includes('not found'));
  });
});
