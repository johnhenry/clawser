// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-ui-drop.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DropHandler,
  extractHandles,
  mountPathForHandle,
} from '../clawser-ui-drop.js';

// ── extractHandles ──────────────────────────────────────────────

describe('extractHandles', () => {
  it('extracts file system handles from DataTransferItems', async () => {
    const mockHandle = { kind: 'directory', name: 'my-project' };
    const items = [
      { kind: 'file', getAsFileSystemHandle: async () => mockHandle },
    ];
    const handles = await extractHandles(items);
    assert.equal(handles.length, 1);
    assert.equal(handles[0].name, 'my-project');
  });

  it('skips items without getAsFileSystemHandle', async () => {
    const items = [
      { kind: 'file' },
      { kind: 'string', getAsString: () => {} },
    ];
    const handles = await extractHandles(items);
    assert.equal(handles.length, 0);
  });

  it('skips items that return null handle', async () => {
    const items = [
      { kind: 'file', getAsFileSystemHandle: async () => null },
    ];
    const handles = await extractHandles(items);
    assert.equal(handles.length, 0);
  });

  it('handles errors gracefully', async () => {
    const items = [
      { kind: 'file', getAsFileSystemHandle: async () => { throw new Error('denied'); } },
    ];
    const handles = await extractHandles(items);
    assert.equal(handles.length, 0);
  });
});

// ── mountPathForHandle ──────────────────────────────────────────

describe('mountPathForHandle', () => {
  it('generates /mnt/{name} for a directory handle', () => {
    const path = mountPathForHandle({ name: 'my-app', kind: 'directory' });
    assert.equal(path, '/mnt/my-app');
  });

  it('generates /mnt/{name} for a file handle', () => {
    const path = mountPathForHandle({ name: 'data.csv', kind: 'file' });
    assert.equal(path, '/mnt/data.csv');
  });

  it('sanitizes special characters in name', () => {
    const path = mountPathForHandle({ name: 'my project (2)', kind: 'directory' });
    assert.ok(path.startsWith('/mnt/'));
    assert.ok(!path.includes(' '));
  });
});

// ── DropHandler ─────────────────────────────────────────────────

describe('DropHandler', () => {
  it('constructs with default options', () => {
    const handler = new DropHandler();
    assert.ok(handler);
  });

  it('constructs with custom onMount callback', () => {
    const fn = () => {};
    const handler = new DropHandler({ onMount: fn });
    assert.ok(handler);
  });

  it('handleDragOver prevents default', () => {
    let defaultPrevented = false;
    const event = {
      preventDefault: () => { defaultPrevented = true; },
      dataTransfer: { dropEffect: '' },
    };
    const handler = new DropHandler();
    handler.handleDragOver(event);
    assert.equal(defaultPrevented, true);
    assert.equal(event.dataTransfer.dropEffect, 'copy');
  });

  it('handleDrop calls onMount for each extracted handle', async () => {
    const mounted = [];
    const mockHandle = { kind: 'directory', name: 'dropped-folder' };
    const handler = new DropHandler({
      onMount: (path, handle) => { mounted.push({ path, handle }); },
    });

    const event = {
      preventDefault: () => {},
      dataTransfer: {
        items: [
          { kind: 'file', getAsFileSystemHandle: async () => mockHandle },
        ],
      },
    };

    await handler.handleDrop(event);
    assert.equal(mounted.length, 1);
    assert.equal(mounted[0].path, '/mnt/dropped-folder');
    assert.equal(mounted[0].handle, mockHandle);
  });

  it('handleDrop handles empty drop gracefully', async () => {
    const mounted = [];
    const handler = new DropHandler({
      onMount: (path, handle) => { mounted.push({ path, handle }); },
    });

    const event = {
      preventDefault: () => {},
      dataTransfer: { items: [] },
    };

    await handler.handleDrop(event);
    assert.equal(mounted.length, 0);
  });
});
