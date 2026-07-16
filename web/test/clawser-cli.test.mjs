// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-cli.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFlags,
  CLAWSER_SUBCOMMAND_META,
  registerClawserCli,
} from '../clawser-cli.js';
import { CommandRegistry } from '../clawser-shell.js';

/**
 * Minimal fake agent exposing just the goal-tracking surface `cmdGoal`
 * touches: addGoal/removeGoal/getState().goals. Mirrors ClawserAgent's
 * real (non-GoalManager) goal store so the same data is visible to
 * `clawser status` and the Goals UI panel, which both read
 * agent.getState().goals.
 */
function makeFakeAgentWithGoals() {
  let goals = [];
  let nextId = 1;
  return {
    addGoal(description) {
      const id = `goal_${nextId++}`;
      goals.push({ id, description, status: 'active' });
      return id;
    },
    removeGoal(id) {
      const before = goals.length;
      goals = goals.filter(g => g.id !== id);
      return goals.length < before;
    },
    getState() {
      return { goals };
    },
  };
}

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
    assert.ok(names.includes('goal'));
  });
});

// ── clawser goal ──────────────────────────────────────────────

describe('clawser goal', () => {
  function makeClawserCommand(agent) {
    const registry = new CommandRegistry();
    registerClawserCli(registry, () => agent, () => null);
    return registry.get('clawser');
  }

  it('reports no agent when none is provided', async () => {
    const clawser = makeClawserCommand(null);
    const { stdout, stderr, exitCode } = await clawser({ args: ['goal', 'list'] });
    assert.equal(exitCode, 1);
    assert.equal(stdout, '');
    assert.match(stderr, /No agent available/);
  });

  it('reports no goals tracked initially', async () => {
    const clawser = makeClawserCommand(makeFakeAgentWithGoals());
    const { stdout, exitCode } = await clawser({ args: ['goal', 'list'] });
    assert.equal(exitCode, 0);
    assert.match(stdout, /No goals tracked/);
  });

  it('adds a goal and it shows up in the list (regression: used to silently no-op)', async () => {
    const agent = makeFakeAgentWithGoals();
    const clawser = makeClawserCommand(agent);

    const addResult = await clawser({ args: ['goal', 'add', 'Write', 'the', 'getting-started', 'tutorial'] });
    assert.equal(addResult.exitCode, 0);
    assert.match(addResult.stdout, /Goal added:/);
    assert.match(addResult.stdout, /Write the getting-started tutorial/);

    // The goal must actually exist in agent.getState().goals — the same
    // array the Goals UI panel and `clawser status` read — not just print
    // a success message without persisting anything.
    assert.equal(agent.getState().goals.length, 1);
    assert.equal(agent.getState().goals[0].description, 'Write the getting-started tutorial');

    const listResult = await clawser({ args: ['goal', 'list'] });
    assert.equal(listResult.exitCode, 0);
    assert.match(listResult.stdout, /Write the getting-started tutorial/);
  });

  it('returns JSON output with --json', async () => {
    const agent = makeFakeAgentWithGoals();
    const clawser = makeClawserCommand(agent);
    const { stdout, exitCode } = await clawser({ args: ['goal', 'add', 'Ship', 'the', 'feature', '--json'] });
    assert.equal(exitCode, 0);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.data.description, 'Ship the feature');
    assert.ok(parsed.data.id);
  });

  it('removes a goal by id', async () => {
    const agent = makeFakeAgentWithGoals();
    const id = agent.addGoal('Temporary goal');
    const clawser = makeClawserCommand(agent);

    const removeResult = await clawser({ args: ['goal', 'remove', id] });
    assert.equal(removeResult.exitCode, 0);
    assert.equal(agent.getState().goals.length, 0);
  });

  it('errors on missing description for add', async () => {
    const clawser = makeClawserCommand(makeFakeAgentWithGoals());
    const { stderr, exitCode } = await clawser({ args: ['goal', 'add'] });
    assert.equal(exitCode, 1);
    assert.match(stderr, /Usage: clawser goal add DESCRIPTION/);
  });

  it('errors on unknown goal id for remove', async () => {
    const clawser = makeClawserCommand(makeFakeAgentWithGoals());
    const { stderr, exitCode } = await clawser({ args: ['goal', 'remove', 'does-not-exist'] });
    assert.equal(exitCode, 1);
    assert.match(stderr, /Goal not found/);
  });
});
