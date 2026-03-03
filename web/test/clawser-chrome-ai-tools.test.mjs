// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-chrome-ai-tools.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ChromeWriterTool, ChromeRewriterTool, ChromeSummarizerTool, registerChromeAITools } from '../clawser-chrome-ai-tools.js';

// ── Stub Chrome AI APIs ──────────────────────────────────────────

function makeStubApi(returnValue = 'stub result') {
  const calls = [];
  return {
    calls,
    availability: async () => 'available',
    create: async (opts) => {
      const session = {
        opts,
        write: async (prompt) => { calls.push({ method: 'write', prompt, opts }); return returnValue; },
        rewrite: async (text) => { calls.push({ method: 'rewrite', text, opts }); return returnValue; },
        summarize: async (text) => { calls.push({ method: 'summarize', text, opts }); return returnValue; },
        destroy: () => { calls.push({ method: 'destroy' }); },
      };
      return session;
    },
  };
}

function installStubApis(overrides = {}) {
  globalThis.self = globalThis.self || globalThis;
  self.ai = {
    writer: makeStubApi(overrides.writer ?? 'Written content here'),
    rewriter: makeStubApi(overrides.rewriter ?? 'Rewritten content here'),
    summarizer: makeStubApi(overrides.summarizer ?? 'Summary content here'),
  };
  return self.ai;
}

function removeStubApis() {
  if (self.ai) delete self.ai;
}

// ── Tool specs ───────────────────────────────────────────────────

describe('Chrome AI Tools — specs', () => {
  it('ChromeWriterTool has correct name and parameters', () => {
    const tool = new ChromeWriterTool();
    assert.equal(tool.name, 'chrome_ai_write');
    assert.equal(tool.permission, 'auto');
    assert.ok(tool.parameters.properties.prompt);
    assert.ok(tool.parameters.properties.tone);
    assert.ok(tool.parameters.properties.format);
    assert.ok(tool.parameters.properties.length);
    assert.ok(tool.parameters.properties.sharedContext);
    assert.deepEqual(tool.parameters.required, ['prompt']);
  });

  it('ChromeRewriterTool has correct name and parameters', () => {
    const tool = new ChromeRewriterTool();
    assert.equal(tool.name, 'chrome_ai_rewrite');
    assert.equal(tool.permission, 'auto');
    assert.ok(tool.parameters.properties.text);
    assert.ok(tool.parameters.properties.tone);
    assert.ok(tool.parameters.properties.context);
    assert.deepEqual(tool.parameters.required, ['text']);
  });

  it('ChromeSummarizerTool has correct name and parameters', () => {
    const tool = new ChromeSummarizerTool();
    assert.equal(tool.name, 'chrome_ai_summarize');
    assert.equal(tool.permission, 'auto');
    assert.ok(tool.parameters.properties.text);
    assert.ok(tool.parameters.properties.type);
    assert.ok(tool.parameters.properties.format);
    assert.deepEqual(tool.parameters.required, ['text']);
    // Verify summary types
    assert.deepEqual(tool.parameters.properties.type.enum, ['key-points', 'tl;dr', 'teaser', 'headline']);
  });
});

// ── Execution with stubs ─────────────────────────────────────────

describe('Chrome AI Tools — execution', () => {
  let apis;

  beforeEach(() => {
    apis = installStubApis();
  });

  afterEach(() => {
    removeStubApis();
  });

  it('ChromeWriterTool.execute writes via session', async () => {
    const tool = new ChromeWriterTool();
    const result = await tool.execute({ prompt: 'Write a haiku about code' });
    assert.ok(result.success);
    assert.equal(result.output, 'Written content here');
    assert.ok(apis.writer.calls.some(c => c.method === 'write'));
    assert.ok(apis.writer.calls.some(c => c.method === 'destroy'), 'session destroyed');
  });

  it('ChromeWriterTool passes options to session create', async () => {
    const tool = new ChromeWriterTool();
    await tool.execute({ prompt: 'test', tone: 'formal', format: 'markdown', length: 'short', sharedContext: 'ctx' });
    const writeCall = apis.writer.calls.find(c => c.method === 'write');
    assert.equal(writeCall.opts.tone, 'formal');
    assert.equal(writeCall.opts.format, 'markdown');
    assert.equal(writeCall.opts.length, 'short');
    assert.equal(writeCall.opts.sharedContext, 'ctx');
  });

  it('ChromeRewriterTool.execute rewrites via session', async () => {
    const tool = new ChromeRewriterTool();
    const result = await tool.execute({ text: 'Original text', tone: 'more-formal' });
    assert.ok(result.success);
    assert.equal(result.output, 'Rewritten content here');
    assert.ok(apis.rewriter.calls.some(c => c.method === 'rewrite' && c.text === 'Original text'));
  });

  it('ChromeRewriterTool passes context as sharedContext', async () => {
    const tool = new ChromeRewriterTool();
    await tool.execute({ text: 'hello', context: 'Business email' });
    const call = apis.rewriter.calls.find(c => c.method === 'rewrite');
    assert.equal(call.opts.sharedContext, 'Business email');
  });

  it('ChromeSummarizerTool.execute summarizes via session', async () => {
    const tool = new ChromeSummarizerTool();
    const result = await tool.execute({ text: 'Long article text...', type: 'tl;dr', length: 'short' });
    assert.ok(result.success);
    assert.equal(result.output, 'Summary content here');
    const call = apis.summarizer.calls.find(c => c.method === 'summarize');
    assert.equal(call.opts.type, 'tl;dr');
    assert.equal(call.opts.length, 'short');
  });
});

// ── Error handling ───────────────────────────────────────────────

describe('Chrome AI Tools — error handling', () => {
  afterEach(() => {
    removeStubApis();
  });

  it('returns error when API is unavailable', async () => {
    // Don't install stub APIs — self.ai is undefined
    removeStubApis();
    const tool = new ChromeWriterTool();
    const result = await tool.execute({ prompt: 'test' });
    assert.ok(!result.success);
    assert.ok(result.error.includes('not available') || result.error.includes('unavailable') || result.error.includes('Cannot read'));
  });

  it('returns error when availability check returns unavailable', async () => {
    globalThis.self = globalThis.self || globalThis;
    self.ai = {
      writer: {
        availability: async () => 'unavailable',
        create: async () => { throw new Error('should not be called'); },
      },
    };
    const tool = new ChromeWriterTool();
    const result = await tool.execute({ prompt: 'test' });
    assert.ok(!result.success);
    assert.ok(result.error.includes('unavailable'));
  });
});

// ── Registration ─────────────────────────────────────────────────

describe('Chrome AI Tools — registration', () => {
  it('registerChromeAITools adds all 3 tools to a registry', () => {
    const tools = new Map();
    const registry = {
      register(tool) { tools.set(tool.name, tool); },
    };
    registerChromeAITools(registry);
    assert.ok(tools.has('chrome_ai_write'));
    assert.ok(tools.has('chrome_ai_rewrite'));
    assert.ok(tools.has('chrome_ai_summarize'));
    assert.equal(tools.size, 3);
  });
});
