// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-intent.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Need to stub BrowserTool before importing
globalThis.BrowserTool = class { constructor() {} };

import {
  MessageIntent,
  PIPELINE_CONFIG,
  IntentRouter,
} from '../clawser-intent.js';

// ── MessageIntent ───────────────────────────────────────────────

describe('MessageIntent', () => {
  it('has expected values', () => {
    assert.equal(MessageIntent.COMMAND, 'command');
    assert.equal(MessageIntent.QUERY, 'query');
    assert.equal(MessageIntent.TASK, 'task');
    assert.equal(MessageIntent.CHAT, 'chat');
    assert.equal(MessageIntent.SYSTEM, 'system');
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(MessageIntent));
  });
});

// ── PIPELINE_CONFIG ─────────────────────────────────────────────

describe('PIPELINE_CONFIG', () => {
  it('has config for every intent', () => {
    for (const intent of Object.values(MessageIntent)) {
      assert.ok(PIPELINE_CONFIG[intent], `Missing config for ${intent}`);
    }
  });

  it('COMMAND config disables LLM and tools', () => {
    const cfg = PIPELINE_CONFIG[MessageIntent.COMMAND];
    assert.equal(cfg.useLLM, false);
    assert.equal(cfg.useTools, false);
  });

  it('TASK config enables LLM, tools, memory, and goals', () => {
    const cfg = PIPELINE_CONFIG[MessageIntent.TASK];
    assert.equal(cfg.useLLM, true);
    assert.equal(cfg.useTools, true);
    assert.equal(cfg.useMemory, true);
    assert.equal(cfg.useGoals, true);
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(PIPELINE_CONFIG));
  });
});

// ── IntentRouter ────────────────────────────────────────────────

describe('IntentRouter', () => {
  let router;

  beforeEach(() => {
    router = new IntentRouter();
  });

  // classify
  it('classifies slash commands as COMMAND', () => {
    assert.equal(router.classify('/help'), MessageIntent.COMMAND);
    assert.equal(router.classify('/clear'), MessageIntent.COMMAND);
  });

  it('classifies "undo" and "redo" as COMMAND', () => {
    assert.equal(router.classify('undo'), MessageIntent.COMMAND);
    assert.equal(router.classify('redo'), MessageIntent.COMMAND);
  });

  it('classifies scheduler source as SYSTEM', () => {
    assert.equal(router.classify('run checks', { source: 'scheduler' }), MessageIntent.SYSTEM);
  });

  it('classifies short greetings as CHAT', () => {
    assert.equal(router.classify('hi'), MessageIntent.CHAT);
    assert.equal(router.classify('hello'), MessageIntent.CHAT);
    assert.equal(router.classify('thanks'), MessageIntent.CHAT);
  });

  it('classifies question words as QUERY', () => {
    assert.equal(router.classify('What is the weather?'), MessageIntent.QUERY);
    assert.equal(router.classify('How do I fix this?'), MessageIntent.QUERY);
  });

  it('classifies messages ending with ? as QUERY', () => {
    assert.equal(router.classify('Is this correct?'), MessageIntent.QUERY);
  });

  it('defaults long non-question messages to TASK', () => {
    const long = 'Please implement a new feature that does X and Y and Z and integrates with the existing system to provide comprehensive functionality.';
    assert.equal(router.classify(long), MessageIntent.TASK);
  });

  it('classifies null/empty as CHAT', () => {
    assert.equal(router.classify(null), MessageIntent.CHAT);
    assert.equal(router.classify(''), MessageIntent.CHAT);
    assert.equal(router.classify('   '), MessageIntent.CHAT);
  });

  // route
  it('route returns intent and config', () => {
    const result = router.route('/help');
    assert.equal(result.intent, MessageIntent.COMMAND);
    assert.ok(result.config);
    assert.equal(result.config.useLLM, false);
  });

  // addPattern
  it('addPattern registers custom pattern', () => {
    router.addPattern(MessageIntent.SYSTEM, (msg) => msg.startsWith('!sys'));
    assert.equal(router.classify('!sys check'), MessageIntent.SYSTEM);
  });

  it('addPattern throws for invalid intent', () => {
    assert.throws(() => router.addPattern('invalid', () => true), /Invalid intent/);
  });

  // addOverride
  it('addOverride registers prefix override', () => {
    router.addOverride('!task:', MessageIntent.TASK);
    assert.equal(router.classify('!task: do something'), MessageIntent.TASK);
  });

  it('addOverride throws for invalid intent', () => {
    assert.throws(() => router.addOverride('!x:', 'bad'), /Invalid intent/);
  });

  // stripOverride
  it('stripOverride removes prefix from message', () => {
    router.addOverride('!task:', MessageIntent.TASK);
    assert.equal(router.stripOverride('!task: do something'), 'do something');
  });

  it('stripOverride returns trimmed message when no prefix matches', () => {
    assert.equal(router.stripOverride('  hello  '), 'hello');
  });

  // resetPatterns
  it('resetPatterns restores defaults', () => {
    router.addPattern(MessageIntent.SYSTEM, () => true);
    router.addOverride('!x:', MessageIntent.CHAT);
    const before = router.patternCount;
    router.resetPatterns();
    assert.equal(router.overrideCount, 0);
    // Default patterns count should be 6
    assert.equal(router.patternCount, 6);
  });

  // patternCount / overrideCount
  it('patternCount returns number of patterns', () => {
    const initial = router.patternCount;
    router.addPattern(MessageIntent.CHAT, () => false);
    assert.equal(router.patternCount, initial + 1);
  });

  it('overrideCount starts at 0', () => {
    assert.equal(router.overrideCount, 0);
    router.addOverride('!q:', MessageIntent.QUERY);
    assert.equal(router.overrideCount, 1);
  });
});
