import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractCodeBlocks, stripCodeBlocks } from '../src/code-extractor.mjs';

describe('extractCodeBlocks', () => {
  it('extracts js code blocks', () => {
    const text = 'Here is code:\n```js\nconsole.log("hi")\n```\nDone.';
    const blocks = extractCodeBlocks(text);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].lang, 'js');
    assert.equal(blocks[0].code, 'console.log("hi")');
  });

  it('extracts multiple blocks', () => {
    const text = '```js\na()\n```\ntext\n```python\nb()\n```';
    const blocks = extractCodeBlocks(text);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].lang, 'js');
    assert.equal(blocks[1].lang, 'python');
  });

  it('extracts bare code blocks', () => {
    const text = '```\nfoo()\n```';
    const blocks = extractCodeBlocks(text);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].lang, '');
  });

  it('skips empty code blocks', () => {
    const text = '```js\n\n```';
    const blocks = extractCodeBlocks(text);
    assert.equal(blocks.length, 0);
  });

  it('returns empty for no code blocks', () => {
    assert.equal(extractCodeBlocks('no code here').length, 0);
  });
});

describe('stripCodeBlocks', () => {
  it('strips code blocks leaving text', () => {
    const text = 'Before\n```js\ncode()\n```\nAfter';
    assert.equal(stripCodeBlocks(text), 'Before\n\nAfter');
  });

  it('returns original if no code blocks', () => {
    assert.equal(stripCodeBlocks('hello world'), 'hello world');
  });
});
