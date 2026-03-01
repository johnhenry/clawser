// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-agent-ref.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAgentRefs,
  hasAgentRefs,
  filterToolsForAgent,
} from '../clawser-agent-ref.js';

// ── parseAgentRefs ──────────────────────────────────────────────

describe('parseAgentRefs', () => {
  it('returns [{type:"text"}] for plain text', () => {
    const result = parseAgentRefs('hello world');
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'text');
    assert.equal(result[0].content, 'hello world');
  });

  it('parses a single @agent reference', () => {
    const result = parseAgentRefs('@sql-expert What index?');
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'ref');
    assert.equal(result[0].agent, 'sql-expert');
    assert.equal(result[0].content, 'What index?');
  });

  it('parses multiple @agent references', () => {
    const result = parseAgentRefs('text @a do thing @b do other');
    const refs = result.filter(s => s.type === 'ref');
    assert.equal(refs.length, 2);
    assert.equal(refs[0].agent, 'a');
    assert.equal(refs[1].agent, 'b');
  });

  it('returns text segments before references', () => {
    const result = parseAgentRefs('prefix @agent rest');
    assert.ok(result.some(s => s.type === 'text' && s.content === 'prefix'));
    assert.ok(result.some(s => s.type === 'ref' && s.agent === 'agent'));
  });

  it('handles null input', () => {
    const result = parseAgentRefs(null);
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'text');
    assert.equal(result[0].content, '');
  });

  it('handles empty string', () => {
    const result = parseAgentRefs('');
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'text');
  });

  it('handles non-string input', () => {
    const result = parseAgentRefs(42);
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'text');
  });

  it('handles agent names with hyphens', () => {
    const result = parseAgentRefs('@code-reviewer check this');
    assert.equal(result[0].type, 'ref');
    assert.equal(result[0].agent, 'code-reviewer');
  });
});

// ── hasAgentRefs ────────────────────────────────────────────────

describe('hasAgentRefs', () => {
  it('returns true for text with @ref', () => {
    assert.equal(hasAgentRefs('@agent hello'), true);
  });

  it('returns false for plain text', () => {
    assert.equal(hasAgentRefs('just text'), false);
  });

  it('returns false for null/empty', () => {
    assert.equal(hasAgentRefs(null), false);
    assert.equal(hasAgentRefs(''), false);
  });

  it('returns true for @ref mid-sentence', () => {
    assert.equal(hasAgentRefs('talk to @helper about this'), true);
  });
});

// ── filterToolsForAgent ─────────────────────────────────────────

describe('filterToolsForAgent', () => {
  const tools = [
    { name: 'fetch' },
    { name: 'search' },
    { name: 'memory' },
  ];

  it('returns all tools when config is null', () => {
    const result = filterToolsForAgent(tools, null);
    assert.equal(result.length, 3);
  });

  it('mode "all" returns all tools', () => {
    const result = filterToolsForAgent(tools, { mode: 'all' });
    assert.equal(result.length, 3);
  });

  it('mode "none" returns empty', () => {
    const result = filterToolsForAgent(tools, { mode: 'none' });
    assert.equal(result.length, 0);
  });

  it('mode "allowlist" filters to named tools', () => {
    const result = filterToolsForAgent(tools, { mode: 'allowlist', list: ['fetch', 'memory'] });
    assert.equal(result.length, 2);
    assert.ok(result.some(t => t.name === 'fetch'));
    assert.ok(result.some(t => t.name === 'memory'));
  });

  it('mode "blocklist" excludes named tools', () => {
    const result = filterToolsForAgent(tools, { mode: 'blocklist', list: ['search'] });
    assert.equal(result.length, 2);
    assert.ok(!result.some(t => t.name === 'search'));
  });

  it('unknown mode returns all tools (copy)', () => {
    const result = filterToolsForAgent(tools, { mode: 'custom' });
    assert.equal(result.length, 3);
    assert.notEqual(result, tools); // should be a copy
  });
});
