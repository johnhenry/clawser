// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-cli.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFlags,
  CLAWSER_SUBCOMMAND_META,
} from '../clawser-cli.js';

// ── parseFlags ──────────────────────────────────────────────────

describe('parseFlags', () => {
  const spec = {
    p: 'print',
    m: 'model',
    'no-stream': true,
    continue: true,
  };

  it('parses --flag value pairs', () => {
    const { flags } = parseFlags(['--model', 'gpt-4'], spec);
    assert.equal(flags.model, 'gpt-4');
  });

  it('parses -f short flags with value', () => {
    const { flags } = parseFlags(['-p', 'hello world'], spec);
    assert.equal(flags.print, 'hello world');
  });

  it('parses --bool-flag (no value)', () => {
    const { flags } = parseFlags(['--no-stream'], spec);
    assert.equal(flags['no-stream'], true);
  });

  it('collects positional args', () => {
    const { positional } = parseFlags(['hello', 'world'], spec);
    assert.deepEqual(positional, ['hello', 'world']);
  });

  it('handles mixed flags and positional', () => {
    const { flags, positional } = parseFlags(['-p', 'prompt', '--no-stream', 'extra'], spec);
    assert.equal(flags.print, 'prompt');
    assert.equal(flags['no-stream'], true);
    assert.deepEqual(positional, ['extra']);
  });

  it('handles -- separator', () => {
    const { flags, positional } = parseFlags(['--model', 'gpt', '--', '--not-a-flag'], spec);
    assert.equal(flags.model, 'gpt');
    assert.deepEqual(positional, ['--not-a-flag']);
  });

  it('returns empty for no args', () => {
    const { flags, positional } = parseFlags([], spec);
    assert.deepEqual(flags, {});
    assert.deepEqual(positional, []);
  });

  it('treats unknown long flags without value as boolean', () => {
    const { flags } = parseFlags(['--verbose'], spec);
    assert.equal(flags.verbose, true);
  });

  it('treats unknown short flags without value as boolean', () => {
    const { flags } = parseFlags(['-v'], spec);
    assert.equal(flags.v, true);
  });

  it('handles boolean flag with continue', () => {
    const { flags } = parseFlags(['--continue'], spec);
    assert.equal(flags.continue, true);
  });

  it('maps short to long flag names', () => {
    const { flags } = parseFlags(['-m', 'claude-3'], spec);
    assert.equal(flags.model, 'claude-3');
  });
});

// ── CLAWSER_SUBCOMMAND_META ─────────────────────────────────────

describe('CLAWSER_SUBCOMMAND_META', () => {
  it('is a non-empty array', () => {
    assert.ok(Array.isArray(CLAWSER_SUBCOMMAND_META));
    assert.ok(CLAWSER_SUBCOMMAND_META.length > 0);
  });

  it('each entry has name, description, and usage', () => {
    for (const entry of CLAWSER_SUBCOMMAND_META) {
      assert.equal(typeof entry.name, 'string');
      assert.equal(typeof entry.description, 'string');
      assert.equal(typeof entry.usage, 'string');
    }
  });

  it('contains expected subcommands', () => {
    const names = CLAWSER_SUBCOMMAND_META.map(e => e.name);
    assert.ok(names.includes('chat'));
    assert.ok(names.includes('config'));
    assert.ok(names.includes('status'));
    assert.ok(names.includes('tools'));
    assert.ok(names.includes('memory'));
  });
});
