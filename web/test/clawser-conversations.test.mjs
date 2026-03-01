// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-conversations.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Polyfill crypto for Node
if (!globalThis.crypto) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}

import {
  generateConvId,
  loadConversations,
  updateConversationMeta,
} from '../clawser-conversations.js';

// ── generateConvId ──────────────────────────────────────────────

describe('generateConvId', () => {
  it('returns a non-empty string', () => {
    const id = generateConvId();
    assert.equal(typeof id, 'string');
    assert.ok(id.length > 0);
  });

  it('starts with "conv_"', () => {
    const id = generateConvId();
    assert.ok(id.startsWith('conv_'));
  });

  it('returns unique values on successive calls', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) {
      ids.add(generateConvId());
    }
    assert.equal(ids.size, 50);
  });
});

// ── loadConversations ───────────────────────────────────────────

describe('loadConversations', () => {
  it('returns empty array when no conversations exist', async () => {
    const convs = await loadConversations('nonexistent_ws');
    assert.deepEqual(convs, []);
  });
});

// ── updateConversationMeta ──────────────────────────────────────

describe('updateConversationMeta', () => {
  it('does not throw on missing workspace', async () => {
    // OPFS stub in _setup-globals returns {} for getDirectory, so this should handle gracefully
    await assert.doesNotReject(
      updateConversationMeta('missing_ws', 'conv1', { name: 'test' })
    );
  });
});
