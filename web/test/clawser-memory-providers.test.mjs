// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-memory-providers.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  EmbeddingProvider,
  NoopEmbedder,
  SemanticMemory,
} from '../clawser-memory.js';

// ── OpenAI Embedding Provider ───────────────────────────────────

describe('OpenAIEmbeddingProvider', () => {
  it('exports OpenAIEmbeddingProvider class', async () => {
    const mod = await import('../clawser-memory.js');
    assert.ok(mod.OpenAIEmbeddingProvider, 'should export OpenAIEmbeddingProvider');
  });

  it('has correct name and dimensions', async () => {
    const { OpenAIEmbeddingProvider } = await import('../clawser-memory.js');
    const provider = new OpenAIEmbeddingProvider({ apiKey: 'test-key' });
    assert.equal(provider.name, 'openai');
    assert.equal(provider.dimensions, 1536);
  });

  it('supports custom model and dimensions', async () => {
    const { OpenAIEmbeddingProvider } = await import('../clawser-memory.js');
    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'test-key',
      model: 'text-embedding-3-large',
      dimensions: 3072,
    });
    assert.equal(provider.dimensions, 3072);
  });

  it('calls fetch with correct OpenAI API format', async () => {
    const { OpenAIEmbeddingProvider } = await import('../clawser-memory.js');

    let capturedUrl, capturedOpts;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return {
        ok: true,
        json: async () => ({
          data: [{ embedding: new Array(1536).fill(0.1) }],
        }),
      };
    };

    try {
      const provider = new OpenAIEmbeddingProvider({ apiKey: 'sk-test-123' });
      const result = await provider.embed('Hello world');

      assert.ok(capturedUrl.includes('embeddings'), 'should call embeddings endpoint');
      const body = JSON.parse(capturedOpts.body);
      assert.equal(body.input, 'Hello world');
      assert.equal(body.model, 'text-embedding-3-small');
      assert.ok(capturedOpts.headers['Authorization'].includes('sk-test-123'));
      assert.ok(result instanceof Float32Array);
      assert.equal(result.length, 1536);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns null on API error', async () => {
    const { OpenAIEmbeddingProvider } = await import('../clawser-memory.js');

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    });

    try {
      const provider = new OpenAIEmbeddingProvider({ apiKey: 'sk-test' });
      const result = await provider.embed('test');
      assert.equal(result, null, 'should return null on error');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns null on network failure', async () => {
    const { OpenAIEmbeddingProvider } = await import('../clawser-memory.js');

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('Network error'); };

    try {
      const provider = new OpenAIEmbeddingProvider({ apiKey: 'sk-test' });
      const result = await provider.embed('test');
      assert.equal(result, null, 'should return null on network failure');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('supports custom base URL', async () => {
    const { OpenAIEmbeddingProvider } = await import('../clawser-memory.js');

    let capturedUrl;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          data: [{ embedding: new Array(1536).fill(0) }],
        }),
      };
    };

    try {
      const provider = new OpenAIEmbeddingProvider({
        apiKey: 'sk-test',
        baseUrl: 'https://custom-api.example.com/v1',
      });
      await provider.embed('test');
      assert.ok(capturedUrl.startsWith('https://custom-api.example.com'), 'should use custom base URL');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ── Integration with SemanticMemory ──────────────────────────────

describe('OpenAI provider + SemanticMemory integration', () => {
  it('works as embedder for SemanticMemory', async () => {
    const { OpenAIEmbeddingProvider } = await import('../clawser-memory.js');

    const origFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({
          data: [{ embedding: new Array(1536).fill(Math.random()) }],
        }),
      };
    };

    try {
      const provider = new OpenAIEmbeddingProvider({ apiKey: 'sk-test' });
      const memory = new SemanticMemory(provider);

      memory.store({ key: 'test', content: 'Hello world', category: 'core' });
      const embedded = await memory.embedEntry('mem_1');
      assert.ok(embedded, 'should embed the entry');
      assert.ok(callCount >= 1, 'should have called the API');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('backfillEmbeddings uses the provider', async () => {
    const { OpenAIEmbeddingProvider } = await import('../clawser-memory.js');

    const origFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({
          data: [{ embedding: new Array(1536).fill(0.5) }],
        }),
      };
    };

    try {
      const provider = new OpenAIEmbeddingProvider({ apiKey: 'sk-test' });
      const memory = new SemanticMemory(provider);

      memory.store({ key: 'a', content: 'Alpha' });
      memory.store({ key: 'b', content: 'Beta' });
      memory.store({ key: 'c', content: 'Gamma' });

      const count = await memory.backfillEmbeddings();
      assert.equal(count, 3, 'should backfill 3 entries');
      assert.ok(callCount >= 3, 'should call API for each entry');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
