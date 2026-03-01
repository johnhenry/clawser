// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-shell-enhanced.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Command Substitution $(cmd) (Block 1) ────────────────────────

describe('Command substitution', () => {
  it('expandVariables handles $(cmd) syntax', async () => {
    const { expandVariables } = await import('../clawser-shell.js');
    // $(cmd) should NOT be expanded by expandVariables alone — it needs
    // a shell executor. expandVariables should leave $(cmd) intact or
    // accept an executor callback. We test the dedicated expandCommandSubs fn.
    const { expandCommandSubs } = await import('../clawser-shell.js');
    assert.equal(typeof expandCommandSubs, 'function');
  });

  it('expandCommandSubs substitutes simple command output', async () => {
    const { expandCommandSubs } = await import('../clawser-shell.js');
    // Mock executor that returns "hello" for any command
    const executor = async (cmd) => ({ stdout: 'hello', stderr: '', exitCode: 0 });
    const result = await expandCommandSubs('prefix-$(echo hello)-suffix', executor);
    assert.equal(result, 'prefix-hello-suffix');
  });

  it('expandCommandSubs handles multiple substitutions', async () => {
    const { expandCommandSubs } = await import('../clawser-shell.js');
    const executor = async (cmd) => {
      if (cmd === 'echo A') return { stdout: 'A', stderr: '', exitCode: 0 };
      if (cmd === 'echo B') return { stdout: 'B', stderr: '', exitCode: 0 };
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    const result = await expandCommandSubs('$(echo A)-$(echo B)', executor);
    assert.equal(result, 'A-B');
  });

  it('expandCommandSubs handles nested $() (optional)', async () => {
    const { expandCommandSubs } = await import('../clawser-shell.js');
    const executor = async (cmd) => {
      if (cmd === 'echo inner') return { stdout: 'inner', stderr: '', exitCode: 0 };
      if (cmd === 'echo inner_result') return { stdout: 'final', stderr: '', exitCode: 0 };
      return { stdout: cmd, stderr: '', exitCode: 0 };
    };
    // Nested: $(echo $(echo inner)_result) → first inner resolves to 'inner',
    // then outer becomes $(echo inner_result) → 'final'
    const result = await expandCommandSubs('$(echo $(echo inner)_result)', executor);
    assert.equal(result, 'final');
  });

  it('expandCommandSubs strips trailing newline from output', async () => {
    const { expandCommandSubs } = await import('../clawser-shell.js');
    const executor = async () => ({ stdout: 'value\n', stderr: '', exitCode: 0 });
    const result = await expandCommandSubs('$(cmd)', executor);
    assert.equal(result, 'value');
  });

  it('expandCommandSubs preserves text without $()', async () => {
    const { expandCommandSubs } = await import('../clawser-shell.js');
    const executor = async () => ({ stdout: 'X', stderr: '', exitCode: 0 });
    const result = await expandCommandSubs('no substitution here', executor);
    assert.equal(result, 'no substitution here');
  });

  it('expandCommandSubs handles escaped \\$() as literal', async () => {
    const { expandCommandSubs } = await import('../clawser-shell.js');
    const executor = async () => ({ stdout: 'X', stderr: '', exitCode: 0 });
    const result = await expandCommandSubs('literal \\$(cmd)', executor);
    assert.ok(result.includes('$(cmd)'), 'escaped $() should be literal');
  });
});

// ── Advanced Globs (Block 1) ─────────────────────────────────────

describe('Advanced glob expansion', () => {
  it('expandGlobs handles ** recursive glob', async () => {
    const { expandGlobs } = await import('../clawser-shell.js');
    // Mock fs with nested dirs
    const fs = {
      listDir: async (path) => {
        if (path === '/') return [
          { name: 'a', isDirectory: true },
          { name: 'file.txt', isDirectory: false },
        ];
        if (path === '/a') return [
          { name: 'deep.txt', isDirectory: false },
        ];
        return [];
      },
    };
    const matches = await expandGlobs('**/*.txt', fs, '/');
    assert.ok(matches.length >= 1, 'should match files recursively');
    assert.ok(matches.some(m => m.includes('deep.txt') || m.includes('file.txt')));
  });

  it('expandGlobs handles {a,b} brace expansion', async () => {
    const { expandGlobs } = await import('../clawser-shell.js');
    const fs = {
      listDir: async () => [
        { name: 'foo.js', isDirectory: false },
        { name: 'foo.ts', isDirectory: false },
        { name: 'foo.py', isDirectory: false },
      ],
    };
    const matches = await expandGlobs('foo.{js,ts}', fs, '/');
    assert.equal(matches.length, 2);
    assert.ok(matches.includes('foo.js'));
    assert.ok(matches.includes('foo.ts'));
    assert.ok(!matches.includes('foo.py'));
  });

  it('expandGlobs handles !(pattern) negation', async () => {
    const { expandGlobs } = await import('../clawser-shell.js');
    const fs = {
      listDir: async () => [
        { name: 'app.js', isDirectory: false },
        { name: 'app.test.js', isDirectory: false },
        { name: 'util.js', isDirectory: false },
      ],
    };
    const matches = await expandGlobs('!(*.test).js', fs, '/');
    assert.ok(matches.includes('app.js'));
    assert.ok(matches.includes('util.js'));
    assert.ok(!matches.includes('app.test.js'));
  });

  it('expandBraces returns expanded alternatives', async () => {
    const { expandBraces } = await import('../clawser-shell.js');
    assert.equal(typeof expandBraces, 'function');
    const result = expandBraces('file.{js,ts,py}');
    assert.deepEqual(result, ['file.js', 'file.ts', 'file.py']);
  });

  it('expandBraces handles nested braces', async () => {
    const { expandBraces } = await import('../clawser-shell.js');
    const result = expandBraces('{a,b{1,2}}');
    assert.deepEqual(result.sort(), ['a', 'b1', 'b2'].sort());
  });

  it('expandBraces returns input when no braces present', async () => {
    const { expandBraces } = await import('../clawser-shell.js');
    const result = expandBraces('nobraces.txt');
    assert.deepEqual(result, ['nobraces.txt']);
  });
});

// ── Chrome AI Embedding Provider (Block 4) ───────────────────────

describe('ChromeAIEmbeddingProvider', () => {
  it('exports ChromeAIEmbeddingProvider class', async () => {
    const { ChromeAIEmbeddingProvider } = await import('../clawser-memory.js');
    assert.ok(ChromeAIEmbeddingProvider, 'should export ChromeAIEmbeddingProvider');
  });

  it('extends EmbeddingProvider', async () => {
    const { ChromeAIEmbeddingProvider, EmbeddingProvider } = await import('../clawser-memory.js');
    const provider = new ChromeAIEmbeddingProvider();
    assert.ok(provider instanceof EmbeddingProvider);
  });

  it('has name "chrome-ai"', async () => {
    const { ChromeAIEmbeddingProvider } = await import('../clawser-memory.js');
    const provider = new ChromeAIEmbeddingProvider();
    assert.equal(provider.name, 'chrome-ai');
  });

  it('has positive dimensions', async () => {
    const { ChromeAIEmbeddingProvider } = await import('../clawser-memory.js');
    const provider = new ChromeAIEmbeddingProvider();
    assert.ok(provider.dimensions > 0, 'should have positive dimensions');
  });

  it('returns null when Chrome AI is unavailable', async () => {
    const { ChromeAIEmbeddingProvider } = await import('../clawser-memory.js');
    // In Node.js test env, no LanguageModel API exists
    const provider = new ChromeAIEmbeddingProvider();
    const result = await provider.embed('test text');
    assert.equal(result, null, 'should return null when API unavailable');
  });

  it('exposes isAvailable() method', async () => {
    const { ChromeAIEmbeddingProvider } = await import('../clawser-memory.js');
    const provider = new ChromeAIEmbeddingProvider();
    assert.equal(typeof provider.isAvailable, 'function');
    const avail = await provider.isAvailable();
    assert.equal(avail, false, 'should be false in Node.js env');
  });
});

// ── Identity Templates/Presets (Block 7) ─────────────────────────

describe('Identity templates', () => {
  it('exports IDENTITY_TEMPLATES object', async () => {
    const { IDENTITY_TEMPLATES } = await import('../clawser-identity.js');
    assert.ok(IDENTITY_TEMPLATES, 'should export IDENTITY_TEMPLATES');
    assert.ok(typeof IDENTITY_TEMPLATES === 'object');
  });

  it('has at least 3 starter templates', async () => {
    const { IDENTITY_TEMPLATES } = await import('../clawser-identity.js');
    const keys = Object.keys(IDENTITY_TEMPLATES);
    assert.ok(keys.length >= 3, `should have >= 3 templates, got ${keys.length}`);
  });

  it('each template is a valid AIEOS identity', async () => {
    const { IDENTITY_TEMPLATES, validateAIEOS } = await import('../clawser-identity.js');
    for (const [key, template] of Object.entries(IDENTITY_TEMPLATES)) {
      const { valid, errors } = validateAIEOS(template);
      assert.ok(valid || errors.length === 0, `template '${key}' should be valid AIEOS: ${errors.join(', ')}`);
      assert.ok(template.names?.display, `template '${key}' should have a display name`);
    }
  });

  it('each template has unique display name', async () => {
    const { IDENTITY_TEMPLATES } = await import('../clawser-identity.js');
    const names = Object.values(IDENTITY_TEMPLATES).map(t => t.names.display);
    const unique = new Set(names);
    assert.equal(names.length, unique.size, 'all template display names should be unique');
  });

  it('IdentityManager.fromTemplate creates identity from template key', async () => {
    const { IdentityManager, IDENTITY_TEMPLATES } = await import('../clawser-identity.js');
    const keys = Object.keys(IDENTITY_TEMPLATES);
    assert.equal(typeof IdentityManager.fromTemplate, 'function');
    const mgr = IdentityManager.fromTemplate(keys[0]);
    assert.ok(mgr instanceof IdentityManager);
    assert.equal(mgr.format, 'aieos');
    assert.equal(mgr.displayName, IDENTITY_TEMPLATES[keys[0]].names.display);
  });

  it('IdentityManager.fromTemplate throws for unknown template', async () => {
    const { IdentityManager } = await import('../clawser-identity.js');
    assert.throws(() => IdentityManager.fromTemplate('nonexistent_key'), /unknown template/i);
  });

  it('IdentityManager.listTemplates returns template keys with descriptions', async () => {
    const { IdentityManager } = await import('../clawser-identity.js');
    assert.equal(typeof IdentityManager.listTemplates, 'function');
    const templates = IdentityManager.listTemplates();
    assert.ok(Array.isArray(templates));
    assert.ok(templates.length >= 3);
    assert.ok(templates[0].key, 'should have key');
    assert.ok(templates[0].name, 'should have name');
    assert.ok(templates[0].description, 'should have description');
  });
});

// ── Cost Estimation with Prompt Caching (Configuration) ──────────

describe('Cost estimation with prompt caching', () => {
  it('estimateCost handles cache_creation_input_tokens', async () => {
    const { estimateCost } = await import('../clawser-providers.js');
    // Anthropic charges 1.25× input price for cache creation
    const cost = estimateCost('claude-sonnet-4-6', {
      input_tokens: 1000,
      output_tokens: 100,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 0,
    });
    // 500 regular input + 500 cache-write at 1.25× ($0.003 * 1.25 = $0.00375)
    // = (500/1000 * 0.003) + (500/1000 * 0.00375) + (100/1000 * 0.015)
    // = 0.0015 + 0.001875 + 0.0015 = 0.004875
    assert.ok(cost > 0);
    // Should be more expensive than without cache creation
    const noCacheCost = estimateCost('claude-sonnet-4-6', {
      input_tokens: 1000,
      output_tokens: 100,
    });
    assert.ok(cost > noCacheCost, 'cache creation should cost more than regular input');
  });

  it('MODEL_PRICING includes cache_write_multiplier for Anthropic models', async () => {
    const { MODEL_PRICING } = await import('../clawser-providers.js');
    const sonnet = MODEL_PRICING['claude-sonnet-4-6'];
    assert.ok(sonnet.cached_input, 'should have cached_input price');
    // cache_write should be 1.25× input or explicit
    assert.ok(
      sonnet.cache_write || sonnet.cached_input < sonnet.input,
      'should have cache_write or cached_input < input'
    );
  });

  it('estimateCost handles combined cache read + cache write', async () => {
    const { estimateCost } = await import('../clawser-providers.js');
    const cost = estimateCost('claude-sonnet-4-6', {
      input_tokens: 2000,
      output_tokens: 500,
      cache_creation_input_tokens: 800,
      cache_read_input_tokens: 400,
    });
    // 800 regular + 800 cache-write + 400 cache-read
    assert.ok(cost > 0);
  });

  it('estimateCost returns 0 for free models even with caching', async () => {
    const { estimateCost } = await import('../clawser-providers.js');
    const cost = estimateCost('chrome-ai', {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 300,
    });
    assert.equal(cost, 0);
  });

  it('estimateCost handles DeepSeek cache tokens', async () => {
    const { estimateCost } = await import('../clawser-providers.js');
    const cost = estimateCost('deepseek-chat', {
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_input_tokens: 600,
    });
    // 400 regular input + 600 cached at half price
    assert.ok(cost > 0);
    const noCacheCost = estimateCost('deepseek-chat', {
      input_tokens: 1000,
      output_tokens: 200,
    });
    assert.ok(cost < noCacheCost, 'cached reads should be cheaper');
  });
});
