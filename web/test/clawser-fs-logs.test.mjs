// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-fs-logs.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.BrowserTool = globalThis.BrowserTool || class { constructor() {} };

import { RotatingLogWriter } from '../clawser-fs-logs.mjs';
import { MemoryFs } from '../clawser-shell.js';
import { EventLog } from '../clawser-agent.js';

const LOG = '/var/log/clawser/events.jsonl';

describe('RotatingLogWriter', () => {
  let fs;

  beforeEach(() => {
    fs = new MemoryFs();
  });

  it('appends buffered lines to the log file on flush', async () => {
    const writer = new RotatingLogWriter(fs, LOG);
    writer.append('{"a":1}');
    writer.append('{"a":2}');
    await writer.close();

    const content = await fs.readFile(LOG);
    assert.equal(content, '{"a":1}\n{"a":2}\n');
  });

  it('appends across multiple flushes without overwriting', async () => {
    const writer = new RotatingLogWriter(fs, LOG);
    writer.append('first');
    await writer.flush();
    writer.append('second');
    await writer.close();

    assert.equal(await fs.readFile(LOG), 'first\nsecond\n');
  });

  it('rotates when the file exceeds maxBytes', async () => {
    const writer = new RotatingLogWriter(fs, LOG, { maxBytes: 10, checkEvery: 1, flushLines: 1 });
    writer.append('0123456789abcdef'); // 16 bytes > 10
    await writer.flush();
    writer.append('next');
    await writer.close();

    const rotated = await fs.readFile(`${LOG}.1`);
    assert.ok(rotated.includes('0123456789abcdef'));
    const current = await fs.readFile(LOG);
    assert.equal(current, 'next\n');
  });

  it('keeps at most maxRotations rotated files, shifting older ones', async () => {
    const writer = new RotatingLogWriter(fs, LOG, { maxBytes: 4, checkEvery: 1, flushLines: 1, maxRotations: 3 });
    for (const line of ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd']) {
      writer.append(line);
      await writer.flush();
    }
    await writer.close();

    assert.ok((await fs.readFile(`${LOG}.1`)).includes('dddddddd'));
    assert.ok((await fs.readFile(`${LOG}.2`)).includes('cccccccc'));
    assert.ok((await fs.readFile(`${LOG}.3`)).includes('bbbbbbbb'));
    // 'aaaaaaaa' fell off the end (only 3 rotations kept)
    await assert.rejects(() => fs.readFile(`${LOG}.4`));
  });

  it('init() rotates an oversized pre-existing file', async () => {
    await fs.writeFile(LOG, 'x'.repeat(100));
    const writer = new RotatingLogWriter(fs, LOG, { maxBytes: 10 });
    await writer.init();

    assert.equal((await fs.readFile(`${LOG}.1`)).length, 100);
    assert.equal(await fs.readFile(LOG), '');
    await writer.close();
  });

  it('init() is a no-op when the file is small or missing', async () => {
    const writer = new RotatingLogWriter(fs, LOG, { maxBytes: 10 });
    await writer.init(); // missing file — no throw
    await fs.writeFile(LOG, 'tiny');
    await writer.init();
    assert.equal(await fs.readFile(LOG), 'tiny');
    await writer.close();
  });
});

describe('EventLog onAppend', () => {
  it('invokes onAppend for every appended event', () => {
    const log = new EventLog();
    const seen = [];
    log.onAppend = (event) => seen.push(event.type);

    log.append('user_message', { text: 'hi' }, 'user');
    log.append('tool_call', { tool: 'x' }, 'agent');

    assert.deepEqual(seen, ['user_message', 'tool_call']);
  });

  it('observer errors do not break append', () => {
    const log = new EventLog();
    log.onAppend = () => { throw new Error('observer boom'); };

    const event = log.append('user_message', {}, 'user');
    assert.ok(event.id);
    assert.equal(log.size, 1);
  });
});
