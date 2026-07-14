// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-event-replay.test.mjs
//
// Guards the replay registry: every event type appended anywhere in the
// agent must be either replayed (REPLAY_HANDLERS) or explicitly ignored
// (IGNORED_EVENT_TYPES). A new eventLog.append('<type>', ...) without a
// registry decision fails this test — that's the point.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.BrowserTool = globalThis.BrowserTool || class { constructor() {} };

import { REPLAY_HANDLERS, IGNORED_EVENT_TYPES } from '../clawser-ui-chat.js';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Scan production modules for eventLog.append('<type>' / recordEvent('<type>' literals. */
function appendedEventTypes() {
  const types = new Set();
  const re = /(?:eventLog\.append|#eventLog\.append|recordEvent)\(\s*['"]([a-z_]+)['"]/g;
  for (const file of readdirSync(WEB_DIR)) {
    if (!/^clawser-.*\.(js|mjs)$/.test(file)) continue;
    const src = readFileSync(join(WEB_DIR, file), 'utf8');
    for (const m of src.matchAll(re)) types.add(m[1]);
  }
  return types;
}

describe('event replay registry completeness', () => {
  const types = appendedEventTypes();

  it('finds a plausible number of appended event types', () => {
    assert.ok(types.size >= 20, `expected >=20 types, found ${types.size}: ${[...types].join(', ')}`);
    assert.ok(types.has('user_message'));
    assert.ok(types.has('tool_call'));
  });

  it('every appended event type is either replayed or explicitly ignored', () => {
    const undecided = [...types].filter(
      t => !REPLAY_HANDLERS.has(t) && !IGNORED_EVENT_TYPES.has(t),
    );
    assert.deepEqual(
      undecided, [],
      `Event types with no replay decision: ${undecided.join(', ')} — add a handler to REPLAY_HANDLERS or list in IGNORED_EVENT_TYPES (clawser-ui-chat.js)`,
    );
  });

  it('no event type is both replayed and ignored', () => {
    const both = [...REPLAY_HANDLERS.keys()].filter(t => IGNORED_EVENT_TYPES.has(t));
    assert.deepEqual(both, []);
  });
});
