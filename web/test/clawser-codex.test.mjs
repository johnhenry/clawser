// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-codex.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Stub BrowserTool before import
globalThis.BrowserTool = class { constructor() {} };

import { extractCodeBlocks, stripCodeBlocks, adaptPythonisms, autoAwait } from '../clawser-codex.js';

describe('extractCodeBlocks', () => {
  it('extracts a single js code block', () => {
    const text = 'Hello\n```js\nconsole.log("hi")\n```\nBye';
    const blocks = extractCodeBlocks(text);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].lang, 'js');
    assert.equal(blocks[0].code, 'console.log("hi")');
  });

  it('extracts multiple code blocks', () => {
    const text = '```js\nconst a = 1;\n```\ntext\n```python\nprint("hi")\n```';
    const blocks = extractCodeBlocks(text);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].lang, 'js');
    assert.equal(blocks[1].lang, 'python');
  });

  it('extracts bare code blocks (no language)', () => {
    const text = '```\nfoo()\n```';
    const blocks = extractCodeBlocks(text);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].lang, '');
    assert.equal(blocks[0].code, 'foo()');
  });

  it('normalizes language to lowercase', () => {
    const text = '```JavaScript\nlet x = 1;\n```';
    const blocks = extractCodeBlocks(text);
    assert.equal(blocks[0].lang, 'javascript');
  });

  it('skips empty code blocks', () => {
    const text = '```js\n\n```';
    const blocks = extractCodeBlocks(text);
    assert.equal(blocks.length, 0);
  });

  it('returns empty array for text without code blocks', () => {
    assert.deepEqual(extractCodeBlocks('just plain text'), []);
  });

  it('handles tool_code language tag', () => {
    const text = '```tool_code\nbrowser_fetch({url: "https://example.com"})\n```';
    const blocks = extractCodeBlocks(text);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].lang, 'tool_code');
  });

  it('trims whitespace from code content', () => {
    const text = '```js\n  const x = 1;  \n```';
    const blocks = extractCodeBlocks(text);
    assert.equal(blocks[0].code, 'const x = 1;');
  });
});

describe('stripCodeBlocks', () => {
  it('removes a single code block', () => {
    const text = 'Hello\n```js\nconsole.log("hi")\n```\nBye';
    const result = stripCodeBlocks(text);
    assert.equal(result, 'Hello\n\nBye');
  });

  it('removes multiple code blocks', () => {
    const text = 'A\n```js\n1\n```\nB\n```python\n2\n```\nC';
    const result = stripCodeBlocks(text);
    assert.equal(result, 'A\n\nB\n\nC');
  });

  it('returns original text when no code blocks', () => {
    assert.equal(stripCodeBlocks('plain text'), 'plain text');
  });

  it('trims the result', () => {
    const text = '  ```js\ncode\n```  ';
    const result = stripCodeBlocks(text);
    assert.equal(result, '');
  });
});

describe('adaptPythonisms', () => {
  it('converts True to true', () => {
    assert.equal(adaptPythonisms('x = True'), 'x = true');
  });

  it('converts False to false', () => {
    assert.equal(adaptPythonisms('x = False'), 'x = false');
  });

  it('converts None to null', () => {
    assert.equal(adaptPythonisms('x = None'), 'x = null');
  });

  it('converts all Python booleans in one pass', () => {
    assert.equal(adaptPythonisms('if True and not False: None'), 'if true and not false: null');
  });

  it('converts f-strings with double quotes to template literals', () => {
    assert.equal(adaptPythonisms('f"hello {name}"'), '`hello ${name}`');
  });

  it('converts f-strings with single quotes to template literals', () => {
    assert.equal(adaptPythonisms("f'hello {name}'"), '`hello ${name}`');
  });

  it('does not modify non-Python code', () => {
    const code = 'const x = true; let y = null;';
    assert.equal(adaptPythonisms(code), code);
  });

  it('handles mixed Python and JS', () => {
    const code = 'const ok = True;\nconst val = None;';
    const expected = 'const ok = true;\nconst val = null;';
    assert.equal(adaptPythonisms(code), expected);
  });
});

describe('autoAwait', () => {
  it('adds await before print() calls', () => {
    const result = autoAwait('print("hello")');
    assert.ok(result.includes('await print'));
  });

  it('does not double-await print()', () => {
    const code = 'await print("hello")';
    const result = autoAwait(code);
    // Should not have "await await"
    assert.ok(!result.includes('await await'));
  });

  it('adds await before browser_* calls at statement level', () => {
    const code = 'browser_fetch({url: "https://example.com"})';
    const result = autoAwait(code);
    assert.ok(result.includes('await browser_fetch'));
  });

  it('does not double-await browser_* calls', () => {
    const code = 'await browser_fetch({url: "x"})';
    const result = autoAwait(code);
    assert.ok(!result.includes('await await'));
  });

  it('handles multiple statements', () => {
    const code = 'print("a");\nbrowser_fetch({url: "b"})';
    const result = autoAwait(code);
    assert.ok(result.includes('await print'));
    assert.ok(result.includes('await browser_fetch'));
  });

  it('preserves code without async calls', () => {
    const code = 'const x = 1 + 2;\nconsole.log(x);';
    const result = autoAwait(code);
    assert.equal(result, code);
  });
});

describe('Codex class', () => {
  it('exports Codex class', async () => {
    const mod = await import('../clawser-codex.js');
    assert.ok(typeof mod.Codex === 'function');
  });

  it('Codex constructor accepts browserTools', async () => {
    const { Codex } = await import('../clawser-codex.js');
    const mockTools = { names: () => [], allSpecs: () => [], execute: async () => ({}) };
    const codex = new Codex(mockTools);
    assert.ok(codex);
  });

  it('buildToolPrompt returns string', async () => {
    const { Codex } = await import('../clawser-codex.js');
    const mockTools = { names: () => ['browser_fetch'], allSpecs: () => [{ name: 'browser_fetch', description: 'Fetch URL', parameters: { properties: { url: { type: 'string' } } } }], execute: async () => ({}) };
    const codex = new Codex(mockTools);
    const prompt = codex.buildToolPrompt();
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.includes('browser_fetch'));
    assert.ok(prompt.includes('Available functions'));
  });

  it('execute returns text for no code blocks', async () => {
    const { Codex } = await import('../clawser-codex.js');
    const mockTools = { names: () => [], allSpecs: () => [], execute: async () => ({}) };
    const codex = new Codex(mockTools);
    const result = await codex.execute('just plain text');
    assert.equal(result.text, 'just plain text');
    assert.equal(result.results.length, 0);
    assert.equal(result.toolCalls.length, 0);
  });
});
