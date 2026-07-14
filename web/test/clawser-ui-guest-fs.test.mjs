import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLsOutput,
  parseStatOutput,
  stripAnsi,
  extractCommandOutput,
  createGuestFsState,
} from '../clawser-ui-guest-fs.mjs';

// ── parseLsOutput ──────────────────────────────────────────────────

describe('parseLsOutput', () => {
  it('parses standard ls -la output', () => {
    const raw = [
      'total 24',
      'drwxr-xr-x    5 root root  4096 Jan  1 00:00 bin',
      '-rw-r--r--    1 root root   123 Feb 15 12:30 file.txt',
      '-rwxr-xr-x    1 user staff  8192 Mar 10 09:00 script.sh',
    ].join('\n');

    const entries = parseLsOutput(raw);
    assert.equal(entries.length, 3);

    assert.equal(entries[0].name, 'bin');
    assert.equal(entries[0].type, 'directory');
    assert.equal(entries[0].permissions, 'drwxr-xr-x');
    assert.equal(entries[0].size, 4096);
    assert.equal(entries[0].owner, 'root');

    assert.equal(entries[1].name, 'file.txt');
    assert.equal(entries[1].type, 'file');
    assert.equal(entries[1].size, 123);

    assert.equal(entries[2].name, 'script.sh');
    assert.equal(entries[2].type, 'file');
    assert.equal(entries[2].size, 8192);
  });

  it('parses symlinks with target', () => {
    const raw = 'lrwxrwxrwx    1 root root     7 Jan  1 00:00 lib -> usr/lib';
    const entries = parseLsOutput(raw);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, 'symlink');
    assert.equal(entries[0].name, 'lib');
    assert.equal(entries[0].target, 'usr/lib');
  });

  it('skips . and .. entries', () => {
    const raw = [
      'drwxr-xr-x    2 root root  4096 Jan  1 00:00 .',
      'drwxr-xr-x    5 root root  4096 Jan  1 00:00 ..',
      '-rw-r--r--    1 root root   100 Jan  1 00:00 hello.txt',
    ].join('\n');
    const entries = parseLsOutput(raw);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, 'hello.txt');
  });

  it('skips total line', () => {
    const raw = 'total 48\n-rw-r--r--    1 root root   100 Jan  1 00:00 a.txt';
    const entries = parseLsOutput(raw);
    assert.equal(entries.length, 1);
  });

  it('returns empty array for empty or malformed input', () => {
    assert.deepEqual(parseLsOutput(''), []);
    assert.deepEqual(parseLsOutput('some random text'), []);
    assert.deepEqual(parseLsOutput('total 0'), []);
  });

  it('handles special file types', () => {
    const raw = 'crw-rw----    1 root tty  5 Jan  1 00:00 console';
    const entries = parseLsOutput(raw);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, 'other');
    assert.equal(entries[0].name, 'console');
  });

  it('handles filenames with spaces (via full-line match)', () => {
    const raw = '-rw-r--r--    1 root root   100 Jan  1 00:00 my file.txt';
    const entries = parseLsOutput(raw);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, 'my file.txt');
  });
});

// ── parseStatOutput ────────────────────────────────────────────────

describe('parseStatOutput', () => {
  it('parses standard stat output', () => {
    const raw = [
      "  File: '/etc/hostname'",
      '  Size: 12        Blocks: 8          IO Block: 4096   regular file',
      'Access: (0644/-rw-r--r--)  Uid: (    0/    root)   Gid: (    0/    root)',
      'Access: 2024-01-01 00:00:00.000000000 +0000',
      'Modify: 2024-01-01 00:00:00.000000000 +0000',
      'Change: 2024-01-01 00:00:00.000000000 +0000',
    ].join('\n');

    const info = parseStatOutput(raw);
    assert.ok(info);
    assert.equal(info.name, '/etc/hostname');
    assert.equal(info.size, 12);
    assert.equal(info.blocks, 8);
    assert.equal(info.type, 'regular file');
    assert.ok(info.permissions.includes('0644'));
    assert.ok(info.uid.includes('root'));
  });

  it('returns null for empty input', () => {
    assert.equal(parseStatOutput(''), null);
    assert.equal(parseStatOutput('random text'), null);
  });
});

// ── stripAnsi ──────────────────────────────────────────────────────

describe('stripAnsi', () => {
  it('strips ANSI color codes', () => {
    assert.equal(stripAnsi('\x1b[32mhello\x1b[0m'), 'hello');
    assert.equal(stripAnsi('\x1b[1;31merror\x1b[0m'), 'error');
  });

  it('strips carriage returns', () => {
    assert.equal(stripAnsi('line1\r\nline2\r\n'), 'line1\nline2\n');
  });

  it('passes through clean text', () => {
    assert.equal(stripAnsi('hello world'), 'hello world');
  });
});

// ── extractCommandOutput ───────────────────────────────────────────

describe('extractCommandOutput', () => {
  it('strips echoed command and trailing prompt', () => {
    const raw = 'ls -la\ntotal 4\ndrwxr-xr-x 2 root root 4096 Jan 1 00:00 bin\n# ';
    const output = extractCommandOutput(raw, 'ls -la');
    assert.ok(output.includes('total 4'));
    assert.ok(output.includes('bin'));
    assert.ok(!output.includes('# '));
  });

  it('handles prompt with path prefix', () => {
    const raw = 'cat file.txt\nhello world\n/etc # ';
    const output = extractCommandOutput(raw, 'cat file.txt');
    assert.equal(output.trim(), 'hello world');
  });

  it('handles output with ANSI codes', () => {
    const raw = '\x1b[32mls\x1b[0m\nfile1\nfile2\n$ ';
    const output = extractCommandOutput(raw, 'ls');
    assert.ok(output.includes('file1'));
    assert.ok(output.includes('file2'));
  });

  it('returns empty for command-only output', () => {
    const raw = 'pwd\n/\n~ # ';
    const output = extractCommandOutput(raw, 'pwd');
    assert.equal(output.trim(), '/');
  });
});

// ── createGuestFsState ─────────────────────────────────────────────

describe('createGuestFsState', () => {
  it('starts with default state', () => {
    const s = createGuestFsState();
    const state = s.getState();
    assert.equal(state.cwd, '/');
    assert.deepEqual(state.entries, []);
    assert.equal(state.loading, false);
    assert.equal(state.error, null);
    assert.equal(state.preview, null);
    assert.equal(state.canGoBack, false);
  });

  it('setCwd updates path and pushes history', () => {
    const s = createGuestFsState();
    s.setCwd('/etc');
    assert.equal(s.getState().cwd, '/etc/');
    assert.equal(s.getState().canGoBack, true);
  });

  it('setEntries clears loading and error', () => {
    const s = createGuestFsState();
    s.setLoading(true);
    s.setError('something broke');
    const entries = [{ name: 'test', type: 'file' }];
    s.setEntries(entries);
    const state = s.getState();
    assert.equal(state.loading, false);
    assert.equal(state.error, null);
    assert.deepEqual(state.entries, entries);
  });

  it('setLoading clears error', () => {
    const s = createGuestFsState();
    s.setError('oops');
    s.setLoading(true);
    assert.equal(s.getState().error, null);
    assert.equal(s.getState().loading, true);
  });

  it('goBack pops history', () => {
    const s = createGuestFsState();
    s.setCwd('/etc');
    s.setCwd('/etc/ssh');
    assert.equal(s.getState().cwd, '/etc/ssh/');

    const prev = s.goBack();
    assert.equal(prev, '/etc/');
    assert.equal(s.getState().cwd, '/etc/');

    const prev2 = s.goBack();
    assert.equal(prev2, '/');
  });

  it('goBack returns null at root', () => {
    const s = createGuestFsState();
    assert.equal(s.goBack(), null);
  });

  it('subscribe notifies on state changes', () => {
    const s = createGuestFsState();
    const events = [];
    s.subscribe((state) => events.push(state.cwd));
    s.setCwd('/tmp');
    s.setCwd('/var');
    assert.ok(events.length >= 2);
    assert.ok(events.includes('/tmp/'));
    assert.ok(events.includes('/var/'));
  });

  it('unsubscribe stops notifications', () => {
    const s = createGuestFsState();
    const events = [];
    const unsub = s.subscribe(() => events.push(1));
    s.setCwd('/a');
    unsub();
    s.setCwd('/b');
    // Only got notifications from the first setCwd
    const countBefore = events.length;
    s.setCwd('/c');
    assert.equal(events.length, countBefore);
  });

  it('reset restores initial state', () => {
    const s = createGuestFsState();
    s.setCwd('/deep/path');
    s.setEntries([{ name: 'x' }]);
    s.setPreview({ name: 'x', content: 'hi' });
    s.reset();
    const state = s.getState();
    assert.equal(state.cwd, '/');
    assert.deepEqual(state.entries, []);
    assert.equal(state.preview, null);
    assert.equal(state.canGoBack, false);
  });

  it('setPreview and clearPreview work', () => {
    const s = createGuestFsState();
    s.setPreview({ name: 'test.txt', content: 'hello' });
    assert.deepEqual(s.getState().preview, { name: 'test.txt', content: 'hello' });
    s.clearPreview();
    assert.equal(s.getState().preview, null);
  });

  it('setCwd clears preview', () => {
    const s = createGuestFsState();
    s.setPreview({ name: 'a', content: 'b' });
    s.setCwd('/new');
    assert.equal(s.getState().preview, null);
  });
});
