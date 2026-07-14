// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-tool-picker.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildToolPickerModel,
  renderToolPickerHtml,
  collectToolPickerSelection,
} from '../clawser-tool-picker.mjs';

const SPECS = [
  { name: 'browser_fetch', category: 'network', description: 'Fetch a URL' },
  { name: 'browser_fs_write', category: 'filesystem', description: 'Write a file' },
  { name: 'browser_fs_read', category: 'filesystem', description: 'Read a file' },
  { name: 'agent_goal_add', description: 'Add a goal' }, // no category → 'other'
];

describe('buildToolPickerModel', () => {
  it('groups tools by category, sorted, with checked state', () => {
    const model = buildToolPickerModel(SPECS, ['browser_fs_read']);
    assert.deepEqual(model.map(g => g.category), ['filesystem', 'network', 'other']);

    const fsGroup = model[0];
    assert.deepEqual(fsGroup.tools.map(t => t.name), ['browser_fs_read', 'browser_fs_write']);
    assert.equal(fsGroup.tools[0].checked, true);
    assert.equal(fsGroup.tools[1].checked, false);
  });

  it('handles empty selection and empty specs', () => {
    assert.deepEqual(buildToolPickerModel([], []), []);
    const model = buildToolPickerModel(SPECS, []);
    assert.ok(model.every(g => g.tools.every(t => !t.checked)));
  });
});

describe('renderToolPickerHtml', () => {
  it('renders a checkbox per tool with data-tool attributes', () => {
    const html = renderToolPickerHtml(buildToolPickerModel(SPECS, ['browser_fetch']));
    assert.ok(html.includes('data-tool="browser_fetch"'));
    assert.ok(html.includes('data-tool="browser_fs_write"'));
    // checked only on the selected one
    assert.match(html, /data-tool="browser_fetch"[^>]*checked/);
    assert.doesNotMatch(html, /data-tool="browser_fs_write"[^>]*checked/);
  });

  it('escapes tool names and descriptions', () => {
    const html = renderToolPickerHtml(buildToolPickerModel(
      [{ name: 'x', category: 'c', description: '<img onerror=alert(1)>' }], [],
    ));
    assert.ok(!html.includes('<img'));
  });
});

describe('collectToolPickerSelection', () => {
  it('returns the names of checked checkboxes', () => {
    const root = {
      querySelectorAll: (sel) => {
        assert.equal(sel, 'input.tool-picker-cb');
        return [
          { dataset: { tool: 'a' }, checked: true },
          { dataset: { tool: 'b' }, checked: false },
          { dataset: { tool: 'c' }, checked: true },
        ];
      },
    };
    assert.deepEqual(collectToolPickerSelection(root), ['a', 'c']);
  });

  it('returns empty for a null root', () => {
    assert.deepEqual(collectToolPickerSelection(null), []);
  });
});
