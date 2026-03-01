// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-policy-engine.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyEngine } from '../clawser-policy-engine.js';

// ── Rule CRUD ─────────────────────────────────────────────────────

describe('PolicyEngine rule management', () => {
  it('adds and lists rules', () => {
    const pe = new PolicyEngine();
    pe.addRule({ name: 'r1', target: 'input', condition: { type: 'pattern', value: 'hack' }, action: 'block' });
    const rules = pe.listRules();
    assert.equal(rules.length, 1);
    assert.equal(rules[0].name, 'r1');
  });

  it('removes rules by name', () => {
    const pe = new PolicyEngine();
    pe.addRule({ name: 'r1', target: 'input', condition: { type: 'pattern', value: 'hack' }, action: 'block' });
    pe.removeRule('r1');
    assert.equal(pe.listRules().length, 0);
  });

  it('enables and disables rules', () => {
    const pe = new PolicyEngine();
    pe.addRule({ name: 'r1', target: 'input', condition: { type: 'pattern', value: 'hack' }, action: 'block' });
    pe.setEnabled('r1', false);
    assert.equal(pe.listRules()[0].enabled, false);

    // Disabled rule should not match
    const result = pe.evaluateInput('hack the system');
    assert.equal(result.blocked, false);
  });
});

// ── Input evaluation ──────────────────────────────────────────────

describe('PolicyEngine input evaluation', () => {
  it('blocks input matching a pattern rule', () => {
    const pe = new PolicyEngine();
    pe.addRule({ name: 'block-hack', target: 'input', condition: { type: 'pattern', value: 'hack' }, action: 'block' });
    const result = pe.evaluateInput('hack the system');
    assert.equal(result.blocked, true);
    assert.ok(result.reason.includes('block-hack'));
  });

  it('warns on input matching a warn rule', () => {
    const pe = new PolicyEngine();
    pe.addRule({ name: 'warn-crypto', target: 'input', condition: { type: 'pattern', value: 'bitcoin' }, action: 'warn' });
    const result = pe.evaluateInput('tell me about bitcoin');
    assert.equal(result.blocked, false);
    assert.ok(result.flags.length >= 1);
  });

  it('passes input that matches no rules', () => {
    const pe = new PolicyEngine();
    pe.addRule({ name: 'block-hack', target: 'input', condition: { type: 'pattern', value: 'hack' }, action: 'block' });
    const result = pe.evaluateInput('hello world');
    assert.equal(result.blocked, false);
    assert.equal(result.flags.length, 0);
  });

  it('case-insensitive matching', () => {
    const pe = new PolicyEngine();
    pe.addRule({ name: 'block-hack', target: 'input', condition: { type: 'pattern', value: 'HACK' }, action: 'block' });
    const result = pe.evaluateInput('Hack the system');
    assert.equal(result.blocked, true);
  });
});

// ── Tool call evaluation ──────────────────────────────────────────

describe('PolicyEngine tool call evaluation', () => {
  it('blocks tool calls by tool_name condition', () => {
    const pe = new PolicyEngine();
    pe.addRule({ name: 'block-eval', target: 'tool', condition: { type: 'tool_name', value: 'eval_js' }, action: 'block' });
    const result = pe.evaluateToolCall('eval_js', { code: 'alert(1)' });
    assert.equal(result.valid, false);
    assert.ok(result.issues.length >= 1);
  });

  it('allows tool calls that dont match', () => {
    const pe = new PolicyEngine();
    pe.addRule({ name: 'block-eval', target: 'tool', condition: { type: 'tool_name', value: 'eval_js' }, action: 'block' });
    const result = pe.evaluateToolCall('browser_echo', { text: 'hi' });
    assert.equal(result.valid, true);
  });

  it('blocks tool calls matching domain condition', () => {
    const pe = new PolicyEngine();
    pe.addRule({ name: 'block-evil', target: 'tool', condition: { type: 'domain', value: 'evil\\.com' }, action: 'block' });
    const result = pe.evaluateToolCall('browser_fetch', { url: 'https://evil.com/data' });
    assert.equal(result.valid, false);
  });
});

// ── Output evaluation ─────────────────────────────────────────────

describe('PolicyEngine output evaluation', () => {
  it('blocks output matching a pattern rule', () => {
    const pe = new PolicyEngine();
    pe.addRule({ name: 'block-secret', target: 'output', condition: { type: 'pattern', value: 'TOP SECRET' }, action: 'block' });
    const result = pe.evaluateOutput('This is TOP SECRET information');
    assert.equal(result.blocked, true);
  });

  it('redacts output matching a redact rule', () => {
    const pe = new PolicyEngine();
    pe.addRule({ name: 'redact-ssn', target: 'output', condition: { type: 'pattern', value: '\\d{3}-\\d{2}-\\d{4}' }, action: 'redact' });
    const result = pe.evaluateOutput('SSN: 123-45-6789');
    assert.equal(result.blocked, false);
    assert.ok(result.findings.length >= 1);
    assert.ok(result.content.includes('[REDACTED]'));
    assert.ok(!result.content.includes('123-45-6789'));
  });

  it('passes output that matches no rules', () => {
    const pe = new PolicyEngine();
    pe.addRule({ name: 'block-secret', target: 'output', condition: { type: 'pattern', value: 'TOP SECRET' }, action: 'block' });
    const result = pe.evaluateOutput('Hello world');
    assert.equal(result.blocked, false);
    assert.equal(result.findings.length, 0);
  });
});

// ── Priority ordering ─────────────────────────────────────────────

describe('PolicyEngine priority', () => {
  it('evaluates rules in priority order (lower = higher priority)', () => {
    const pe = new PolicyEngine();
    pe.addRule({ name: 'allow-hello', target: 'input', condition: { type: 'pattern', value: 'hello' }, action: 'allow', priority: 1 });
    pe.addRule({ name: 'block-all', target: 'input', condition: { type: 'pattern', value: '.*' }, action: 'block', priority: 10 });

    // 'allow' at priority 1 should override 'block' at priority 10
    const result = pe.evaluateInput('hello world');
    assert.equal(result.blocked, false);
  });
});

// ── JSON serialization ────────────────────────────────────────────

describe('PolicyEngine serialization', () => {
  it('toJSON/fromJSON roundtrip preserves rules', () => {
    const pe = new PolicyEngine();
    pe.addRule({ name: 'r1', target: 'input', condition: { type: 'pattern', value: 'hack' }, action: 'block', priority: 5 });
    pe.addRule({ name: 'r2', target: 'output', condition: { type: 'pattern', value: 'secret' }, action: 'redact' });

    const json = pe.toJSON();
    const pe2 = PolicyEngine.fromJSON(json);

    assert.equal(pe2.listRules().length, 2);
    assert.equal(pe2.listRules()[0].name, 'r1');
    assert.equal(pe2.listRules()[0].priority, 5);

    // Verify the restored engine still works
    const result = pe2.evaluateInput('hack the system');
    assert.equal(result.blocked, true);
  });
});
