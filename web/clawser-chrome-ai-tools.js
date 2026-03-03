/**
 * clawser-chrome-ai-tools.js — Chrome AI Specialized API tools
 *
 * Wraps Chrome 138+ Writer, Rewriter, and Summarizer APIs as agent tools.
 * These are on-device AI capabilities, not LLM providers.
 *
 * @see https://developer.chrome.com/docs/ai
 */

import { BrowserTool } from './clawser-tools.js';

// ── Availability helpers ─────────────────────────────────────────

/**
 * Check availability for a Chrome AI API.
 * @param {'writer'|'rewriter'|'summarizer'} apiName
 * @returns {Promise<'available'|'downloadable'|'unavailable'>}
 */
async function checkAvailability(apiName) {
  const api = typeof self !== 'undefined' && self.ai?.[apiName];
  if (!api || typeof api.availability !== 'function') return 'unavailable';
  try {
    return await api.availability();
  } catch {
    return 'unavailable';
  }
}

/**
 * Create a session for a Chrome AI API, execute a function, then destroy.
 * @template T
 * @param {'writer'|'rewriter'|'summarizer'} apiName
 * @param {object} createOpts - Options passed to the create() call
 * @param {(session: object) => Promise<T>} fn - Callback that uses the session
 * @returns {Promise<T>}
 */
async function withSession(apiName, createOpts, fn) {
  const api = self.ai?.[apiName];
  if (!api) throw new Error(`Chrome AI ${apiName} API not available`);
  const avail = await checkAvailability(apiName);
  if (avail === 'unavailable') {
    throw new Error(`Chrome AI ${apiName} is unavailable on this device/browser`);
  }
  const session = await api.create(createOpts);
  try {
    return await fn(session);
  } finally {
    if (typeof session.destroy === 'function') session.destroy();
  }
}

// ── ChromeWriterTool ─────────────────────────────────────────────

export class ChromeWriterTool extends BrowserTool {
  get name() { return 'chrome_ai_write'; }
  get description() {
    return 'Generate text using Chrome\'s on-device Writer API. Produces original content from a prompt.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Writing prompt describing what to generate' },
        tone: { type: 'string', enum: ['formal', 'neutral', 'casual'], description: 'Writing tone (default: neutral)' },
        format: { type: 'string', enum: ['plain-text', 'markdown'], description: 'Output format (default: markdown)' },
        length: { type: 'string', enum: ['short', 'medium', 'long'], description: 'Output length (default: medium)' },
        sharedContext: { type: 'string', description: 'Shared context for the writing session' },
      },
      required: ['prompt'],
    };
  }
  get permission() { return 'auto'; }

  async execute({ prompt, tone, format, length, sharedContext }) {
    try {
      const createOpts = {};
      if (tone) createOpts.tone = tone;
      if (format) createOpts.format = format;
      if (length) createOpts.length = length;
      if (sharedContext) createOpts.sharedContext = sharedContext;

      const result = await withSession('writer', createOpts, async (session) => {
        return await session.write(prompt);
      });
      return { success: true, output: result };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── ChromeRewriterTool ───────────────────────────────────────────

export class ChromeRewriterTool extends BrowserTool {
  get name() { return 'chrome_ai_rewrite'; }
  get description() {
    return 'Rewrite text using Chrome\'s on-device Rewriter API. Adjusts tone, format, or length of existing text.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to rewrite' },
        tone: { type: 'string', enum: ['as-is', 'more-formal', 'more-casual'], description: 'Target tone (default: as-is)' },
        format: { type: 'string', enum: ['as-is', 'plain-text', 'markdown'], description: 'Output format (default: as-is)' },
        length: { type: 'string', enum: ['as-is', 'shorter', 'longer'], description: 'Target length (default: as-is)' },
        context: { type: 'string', description: 'Context to guide the rewriting' },
      },
      required: ['text'],
    };
  }
  get permission() { return 'auto'; }

  async execute({ text, tone, format, length, context }) {
    try {
      const createOpts = {};
      if (tone) createOpts.tone = tone;
      if (format) createOpts.format = format;
      if (length) createOpts.length = length;
      if (context) createOpts.sharedContext = context;

      const result = await withSession('rewriter', createOpts, async (session) => {
        return await session.rewrite(text);
      });
      return { success: true, output: result };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── ChromeSummarizerTool ─────────────────────────────────────────

export class ChromeSummarizerTool extends BrowserTool {
  get name() { return 'chrome_ai_summarize'; }
  get description() {
    return 'Summarize text using Chrome\'s on-device Summarizer API. Supports key-points, tl;dr, teaser, and headline types.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to summarize' },
        type: { type: 'string', enum: ['key-points', 'tl;dr', 'teaser', 'headline'], description: 'Summary type (default: key-points)' },
        format: { type: 'string', enum: ['plain-text', 'markdown'], description: 'Output format (default: markdown)' },
        length: { type: 'string', enum: ['short', 'medium', 'long'], description: 'Summary length (default: medium)' },
        context: { type: 'string', description: 'Context to guide summarization' },
      },
      required: ['text'],
    };
  }
  get permission() { return 'auto'; }

  async execute({ text, type, format, length, context }) {
    try {
      const createOpts = {};
      if (type) createOpts.type = type;
      if (format) createOpts.format = format;
      if (length) createOpts.length = length;
      if (context) createOpts.sharedContext = context;

      const result = await withSession('summarizer', createOpts, async (session) => {
        return await session.summarize(text);
      });
      return { success: true, output: result };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── Registration helper ──────────────────────────────────────────

/**
 * Register all Chrome AI specialized tools with a BrowserToolRegistry.
 * Safe to call even when APIs are unavailable (tools will return errors).
 * @param {import('./clawser-tools.js').BrowserToolRegistry} registry
 */
export function registerChromeAITools(registry) {
  registry.register(new ChromeWriterTool());
  registry.register(new ChromeRewriterTool());
  registry.register(new ChromeSummarizerTool());
}
