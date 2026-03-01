// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-skills-hooks.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SkillParser } from '../clawser-skills.js';

// ── SkillParser hooks frontmatter ───────────────────────────────

describe('SkillParser hooks frontmatter', () => {
  it('parses hooks from inline array-of-objects syntax', () => {
    const skillMd = `---
name: my-skill
description: A skill with hooks
hooks: [{point: beforeOutbound, handler: filter.js, priority: 10}]
---
# My Skill
Body text here.`;

    const { metadata } = SkillParser.parseFrontmatter(skillMd);
    assert.ok(Array.isArray(metadata.hooks), 'hooks should be an array');
    assert.equal(metadata.hooks.length, 1);
    assert.equal(metadata.hooks[0].point, 'beforeOutbound');
    assert.equal(metadata.hooks[0].handler, 'filter.js');
    assert.equal(metadata.hooks[0].priority, 10);
  });

  it('parses multiple hooks', () => {
    const skillMd = `---
name: multi-hook
description: Multiple hooks
hooks: [{point: beforeOutbound, handler: out.js}, {point: onSessionStart, handler: init.js}]
---
Body`;

    const { metadata } = SkillParser.parseFrontmatter(skillMd);
    assert.equal(metadata.hooks.length, 2);
    assert.equal(metadata.hooks[0].point, 'beforeOutbound');
    assert.equal(metadata.hooks[1].point, 'onSessionStart');
  });

  it('handles skills without hooks gracefully', () => {
    const skillMd = `---
name: no-hooks
description: No hooks here
---
Body`;

    const { metadata } = SkillParser.parseFrontmatter(skillMd);
    assert.equal(metadata.hooks, undefined);
  });
});

// ── SkillParser.validateHooks ───────────────────────────────────

describe('SkillParser.validateHooks', () => {
  it('exports validateHooks static method', () => {
    assert.equal(typeof SkillParser.validateHooks, 'function');
  });

  it('validates a correct hook entry', () => {
    const result = SkillParser.validateHooks([
      { point: 'beforeOutbound', handler: 'filter.js', priority: 5 },
    ]);
    assert.ok(result.valid);
    assert.equal(result.errors.length, 0);
  });

  it('rejects hook with missing point', () => {
    const result = SkillParser.validateHooks([
      { handler: 'filter.js' },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('point'));
  });

  it('rejects hook with missing handler', () => {
    const result = SkillParser.validateHooks([
      { point: 'beforeOutbound' },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('handler'));
  });

  it('rejects hook with invalid point name', () => {
    const result = SkillParser.validateHooks([
      { point: 'invalidHookPoint', handler: 'hook.js' },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('point'));
  });

  it('accepts all valid hook points', () => {
    const validPoints = [
      'beforeInbound', 'beforeOutbound', 'transformResponse',
      'onSessionStart', 'onSessionEnd', 'onError',
    ];

    for (const point of validPoints) {
      const result = SkillParser.validateHooks([
        { point, handler: 'h.js' },
      ]);
      assert.ok(result.valid, `${point} should be valid`);
    }
  });

  it('validates multiple hooks and reports all errors', () => {
    const result = SkillParser.validateHooks([
      { point: 'beforeOutbound', handler: 'good.js' },
      { point: 'bad_point', handler: 'bad.js' },
      { handler: 'no-point.js' },
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 2, 'should report multiple errors');
  });

  it('returns valid for empty array', () => {
    const result = SkillParser.validateHooks([]);
    assert.ok(result.valid);
  });

  it('returns valid for non-array input', () => {
    const result = SkillParser.validateHooks(undefined);
    assert.ok(result.valid);
  });

  it('defaults priority to 10 in normalization', () => {
    const hooks = [{ point: 'beforeOutbound', handler: 'h.js' }];
    const result = SkillParser.validateHooks(hooks);
    assert.ok(result.valid);
    assert.equal(result.normalized[0].priority, 10, 'default priority should be 10');
  });

  it('preserves explicitly set priority', () => {
    const hooks = [{ point: 'beforeOutbound', handler: 'h.js', priority: 3 }];
    const result = SkillParser.validateHooks(hooks);
    assert.equal(result.normalized[0].priority, 3);
  });

  it('normalizes hook entries with enabled=true by default', () => {
    const hooks = [{ point: 'onSessionStart', handler: 'init.js' }];
    const result = SkillParser.validateHooks(hooks);
    assert.equal(result.normalized[0].enabled, true);
  });
});
