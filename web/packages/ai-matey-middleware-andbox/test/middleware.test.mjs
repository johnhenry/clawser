import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractCodeBlocks, stripCodeBlocks, adaptPythonisms, autoAwait } from '../src/index.mjs';
import { toolsToCapabilities, toolsToPreamble } from '../src/tool-injector.mjs';
import { formatResults, resultsToToolCalls } from '../src/result-formatter.mjs';

describe('adaptPythonisms', () => {
  it('converts True/False/None', () => {
    assert.equal(adaptPythonisms('x = True'), 'x = true');
    assert.equal(adaptPythonisms('y = False'), 'y = false');
    assert.equal(adaptPythonisms('z = None'), 'z = null');
  });

  it('converts f-strings to template literals', () => {
    assert.equal(adaptPythonisms('f"hello {name}"'), '`hello ${name}`');
  });
});

describe('autoAwait', () => {
  it('adds await before print()', () => {
    const result = autoAwait('print("hi")');
    assert.ok(result.includes('await print'));
  });

  it('does not double-await', () => {
    const result = autoAwait('await print("hi")');
    assert.ok(!result.includes('await await'));
  });

  it('adds await before browser_ calls', () => {
    const result = autoAwait('browser_fetch({url: "x"})');
    assert.ok(result.includes('await browser_fetch'));
  });
});

describe('toolsToCapabilities', () => {
  it('creates callable capabilities from tools', async () => {
    const tools = [{ name: 'add', description: 'Add numbers' }];
    const executeFn = async (name, params) => params.a + params.b;
    const caps = toolsToCapabilities(tools, executeFn);
    assert.equal(typeof caps.add, 'function');
    assert.equal(await caps.add({ a: 2, b: 3 }), 5);
  });
});

describe('toolsToPreamble', () => {
  it('generates function stubs', () => {
    const tools = [{ name: 'fetch_data' }, { name: 'save_file' }];
    const preamble = toolsToPreamble(tools);
    assert.ok(preamble.includes('async function fetch_data'));
    assert.ok(preamble.includes('async function save_file'));
    assert.ok(preamble.includes('async function print'));
  });
});

describe('formatResults', () => {
  it('formats successful results', () => {
    const results = [{ code: '1+1', output: '2' }];
    const formatted = formatResults(results);
    assert.ok(formatted.includes('Result: 2'));
  });

  it('formats errors', () => {
    const results = [{ code: 'bad()', output: '', error: 'ReferenceError' }];
    const formatted = formatResults(results);
    assert.ok(formatted.includes('error'));
    assert.ok(formatted.includes('ReferenceError'));
  });

  it('labels multiple blocks', () => {
    const results = [
      { code: 'a()', output: '1' },
      { code: 'b()', output: '2' },
    ];
    const formatted = formatResults(results);
    assert.ok(formatted.includes('Block 1'));
    assert.ok(formatted.includes('Block 2'));
  });

  it('truncates long results', () => {
    const longOutput = 'x'.repeat(5000);
    const results = [{ code: 'x', output: longOutput }];
    const formatted = formatResults(results, 100);
    assert.ok(formatted.length < longOutput.length);
    assert.ok(formatted.includes('truncated'));
  });
});

describe('resultsToToolCalls', () => {
  it('creates tool call entries', () => {
    const results = [{ code: '1+1', output: '2' }];
    const calls = resultsToToolCalls(results);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, '_code_exec');
    assert.ok(calls[0]._result.success);
    assert.equal(calls[0]._result.output, '2');
  });
});

describe('index re-exports', () => {
  it('exports all public API', async () => {
    const mod = await import('../src/index.mjs');
    assert.equal(typeof mod.createCodeExecutionMiddleware, 'function');
    assert.equal(typeof mod.extractCodeBlocks, 'function');
    assert.equal(typeof mod.stripCodeBlocks, 'function');
    assert.equal(typeof mod.adaptPythonisms, 'function');
    assert.equal(typeof mod.autoAwait, 'function');
    assert.equal(typeof mod.toolsToCapabilities, 'function');
    assert.equal(typeof mod.toolsToPreamble, 'function');
    assert.equal(typeof mod.formatResults, 'function');
    assert.equal(typeof mod.resultsToToolCalls, 'function');
  });
});
