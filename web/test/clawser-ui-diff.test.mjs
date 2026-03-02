// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-ui-diff.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeDiff, renderDiff } from '../clawser-ui-diff.js';

describe('computeDiff', () => {
  it('returns empty for identical strings', () => {
    const diff = computeDiff('hello\nworld', 'hello\nworld');
    assert.ok(diff.every(d => d.type === 'equal'));
    assert.strictEqual(diff.length, 2);
  });

  it('detects additions', () => {
    const diff = computeDiff('a\nb', 'a\nb\nc');
    const adds = diff.filter(d => d.type === 'add');
    assert.strictEqual(adds.length, 1);
    assert.strictEqual(adds[0].line, 'c');
  });

  it('detects deletions', () => {
    const diff = computeDiff('a\nb\nc', 'a\nc');
    const dels = diff.filter(d => d.type === 'del');
    assert.strictEqual(dels.length, 1);
    assert.strictEqual(dels[0].line, 'b');
  });

  it('handles empty old text', () => {
    const diff = computeDiff('', 'new\ntext');
    assert.ok(diff.length >= 2);
    assert.ok(diff.some(d => d.type === 'add'));
  });

  it('handles empty new text', () => {
    const diff = computeDiff('old\ntext', '');
    assert.ok(diff.length >= 2);
    assert.ok(diff.some(d => d.type === 'del'));
  });

  it('handles complex changes', () => {
    const diff = computeDiff('a\nb\nc\nd', 'a\nx\nc\ny');
    const adds = diff.filter(d => d.type === 'add');
    const dels = diff.filter(d => d.type === 'del');
    assert.ok(adds.length >= 2);
    assert.ok(dels.length >= 2);
  });
});

describe('renderDiff', () => {
  it('renders diff HTML with add/del classes', () => {
    const el = { innerHTML: '' };
    renderDiff(el, 'old line', 'new line');
    assert.ok(el.innerHTML.includes('diff-del'));
    assert.ok(el.innerHTML.includes('diff-add'));
  });

  it('handles no changes', () => {
    const el = { innerHTML: '' };
    renderDiff(el, 'same', 'same');
    assert.ok(el.innerHTML.includes('diff-eq'));
  });

  it('handles empty inputs', () => {
    const el = { innerHTML: '' };
    renderDiff(el, '', '');
    // Should not error
    assert.ok(typeof el.innerHTML === 'string');
  });
});
