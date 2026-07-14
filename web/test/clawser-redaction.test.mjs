// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-redaction.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SECRET_FIELD_RE,
  SECRET_VALUE_RE,
  redactedPlaceholder,
  redactArgs,
  redactResult,
  redactSecretValuesInText,
  redactEvent,
  redactEventLog,
} from '../clawser-redaction.mjs';

describe('SECRET_FIELD_RE', () => {
  it('matches common secret-bearing field names', () => {
    for (const name of [
      'apiKey', 'api_key', 'api-key', 'API_KEY',
      'token', 'accessToken', 'access_token', 'refreshToken',
      'password', 'passphrase',
      'secret', 'clientSecret', 'client_secret',
      'auth', 'authorization', 'Authorization',
      'cookie', 'Cookie',
      'bearer',
      'credential', 'credentials',
      'privateKey', 'private_key',
      'sessionId', 'session_id',
    ]) {
      assert.ok(SECRET_FIELD_RE.test(name), `expected ${name} to match`);
    }
  });

  it('does not match common non-secret field names', () => {
    for (const name of ['url', 'path', 'method', 'body', 'name', 'id', 'value', 'data']) {
      assert.equal(SECRET_FIELD_RE.test(name), false, `${name} should not match`);
    }
  });
});

describe('redactedPlaceholder', () => {
  it('preserves type + length for strings', () => {
    assert.deepEqual(redactedPlaceholder('sk-abc123'),
      { redacted: true, kind: 'string', length: 9 });
  });

  it('preserves byte length for Uint8Array', () => {
    assert.deepEqual(redactedPlaceholder(new Uint8Array(32)),
      { redacted: true, kind: 'bytes', length: 32 });
  });

  it('handles arrays, objects, null', () => {
    assert.equal(redactedPlaceholder([1, 2, 3]).kind, 'array');
    assert.equal(redactedPlaceholder({ a: 1 }).keys, 1);
    assert.equal(redactedPlaceholder(null).kind, 'null');
  });
});

describe('redactArgs', () => {
  it('redacts top-level fields matching the regex', () => {
    const out = redactArgs({ url: 'https://x', apiKey: 'sk-secret' });
    assert.equal(out.url, 'https://x');
    assert.equal(out.apiKey.redacted, true);
    assert.equal(out.apiKey.length, 9);
  });

  it('redacts explicit fields the tool declared', () => {
    const out = redactArgs({ host: 'irc.example.com', nick: 'me', botToken: 'abc' }, ['botToken']);
    assert.equal(out.host, 'irc.example.com');
    assert.equal(out.botToken.redacted, true);
  });

  it('redacts both explicit + regex (defense-in-depth)', () => {
    const out = redactArgs({ host: 'x', nick: 'me', token: 'X', custom: 'Y' }, ['custom']);
    assert.equal(out.token.redacted, true);
    assert.equal(out.custom.redacted, true);
    assert.equal(out.host, 'x');
    assert.equal(out.nick, 'me');
  });

  it('recurses into nested objects', () => {
    const out = redactArgs({
      config: { url: 'x', auth: { bearer: 'secret-token' } },
    });
    assert.equal(out.config.url, 'x');
    // 'auth' field name matches; the entire object is replaced.
    assert.equal(out.config.auth.redacted, true);
    assert.equal(out.config.auth.kind, 'object');
  });

  it('recurses into arrays', () => {
    const out = redactArgs({ headers: [{ name: 'Authorization', value: 'Bearer X' }] });
    // 'headers' itself isn't sensitive but contains nested 'value' field —
    // 'value' doesn't match regex so it stays. But Authorization-bearing
    // header values are notoriously tricky; this test just confirms
    // recursion doesn't error.
    assert.ok(Array.isArray(out.headers));
  });

  it('parses pre-stringified JSON, redacts, re-stringifies', () => {
    const json = JSON.stringify({ url: 'x', apiKey: 'sk-secret' });
    const out = redactArgs(json);
    assert.equal(typeof out, 'string');
    const parsed = JSON.parse(out);
    assert.equal(parsed.url, 'x');
    assert.equal(parsed.apiKey.redacted, true);
  });

  it('passes through invalid JSON strings unchanged', () => {
    assert.equal(redactArgs('not-json'), 'not-json');
  });

  it('passes through non-objects unchanged', () => {
    assert.equal(redactArgs(42), 42);
    assert.equal(redactArgs(null), null);
  });
});

describe('redactEvent', () => {
  it('redacts arguments inside a tool_call event', () => {
    const ev = { type: 'tool_call', data: { name: 'auth_set', arguments: { apiKey: 'sk-abc' } } };
    redactEvent(ev);
    assert.equal(ev.data.arguments.apiKey.redacted, true);
  });

  it('passes non-tool_call events through', () => {
    const ev = { type: 'user_message', data: { content: 'hello' } };
    redactEvent(ev);
    assert.equal(ev.data.content, 'hello');
  });

  it('is idempotent on already-redacted entries', () => {
    const ev = {
      type: 'tool_call',
      data: { name: 'x', arguments: { token: { redacted: true, kind: 'string', length: 5 } } },
    };
    redactEvent(ev);
    // The placeholder shouldn't be touched (no nested secret-named field).
    assert.equal(ev.data.arguments.token.redacted, true);
    assert.equal(ev.data.arguments.token.kind, 'string');
  });

  it('scans tool_result output text for high-confidence secret shapes', () => {
    const ev = {
      type: 'tool_result',
      data: { name: 'oauth_api', result: { success: true, output: 'token is sk-abcdefghijklmnopqrstuvwx here' } },
    };
    redactEvent(ev);
    assert.ok(!ev.data.result.output.includes('sk-abcdefghijklmnopqrstuvwx'));
    assert.match(ev.data.result.output, /token is \[redacted:\d+chars\] here/);
  });

  it('redacts structured secret fields in tool_result', () => {
    const ev = { type: 'tool_result', data: { name: 'x', result: { success: true, apiKey: 'sk-verysecretvalue1234' } } };
    redactEvent(ev);
    assert.equal(ev.data.result.apiKey.redacted, true);
  });

  it('leaves clean tool_result output untouched', () => {
    const ev = { type: 'tool_result', data: { name: 'x', result: { success: true, output: 'Connected to github.' } } };
    redactEvent(ev);
    assert.equal(ev.data.result.output, 'Connected to github.');
  });
});

// ── SECRET_VALUE_RE / redactSecretValuesInText ────────────────────

describe('SECRET_VALUE_RE / redactSecretValuesInText', () => {
  it('matches well-known prefixed secret shapes', () => {
    const samples = [
      'sk-' + 'a'.repeat(24),
      'ghp_' + 'B'.repeat(36),
      'AKIAABCDEFGHIJKLMNOP',
      'xoxb-1234567890-abc',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ_signature123',
    ];
    for (const s of samples) {
      // SECRET_VALUE_RE carries the 'g' flag (used by .replace() in
      // production); .test() with 'g' is stateful across calls via
      // lastIndex, so reset it before each check in this loop.
      SECRET_VALUE_RE.lastIndex = 0;
      assert.ok(SECRET_VALUE_RE.test(s), `expected to match: ${s}`);
    }
  });

  it('does not match ordinary prose or short strings', () => {
    for (const s of ['hello world', 'the sky is blue', 'error code 404', 'sk-short', 'user@example.com']) {
      SECRET_VALUE_RE.lastIndex = 0;
      assert.equal(SECRET_VALUE_RE.test(s), false, `should not match: ${s}`);
    }
  });

  it('redacts matches in place, preserving surrounding text', () => {
    const text = `Set apiKey to sk-${'x'.repeat(24)} and continue.`;
    const out = redactSecretValuesInText(text);
    assert.ok(out.startsWith('Set apiKey to [redacted:'));
    assert.ok(out.endsWith('] and continue.'));
  });

  it('passes non-strings through unchanged', () => {
    assert.equal(redactSecretValuesInText(42), 42);
    assert.equal(redactSecretValuesInText(null), null);
  });
});

// ── redactResult ───────────────────────────────────────────────────

describe('redactResult', () => {
  it('redacts declared result fields fully', () => {
    const out = redactResult({ success: true, sessionToken: 'abc123' }, ['sessionToken']);
    assert.equal(out.sessionToken.redacted, true);
  });

  it('redacts regex-matched field names by default', () => {
    const out = redactResult({ success: true, apiKey: 'sk-abc' });
    assert.equal(out.apiKey.redacted, true);
  });

  it('scans string leaf values for secret shapes regardless of field name', () => {
    const out = redactResult({ success: true, output: `key: sk-${'y'.repeat(24)}` });
    assert.ok(!out.output.includes('y'.repeat(24)));
  });

  it('handles a bare string result', () => {
    const out = redactResult(`token sk-${'z'.repeat(24)} end`);
    assert.ok(!out.includes('z'.repeat(24)));
  });

  it('recurses into nested objects and arrays', () => {
    const out = redactResult({ items: [{ name: 'x', token: 'secret-value' }] });
    assert.equal(out.items[0].token.redacted, true);
    assert.equal(out.items[0].name, 'x');
  });

  it('is idempotent on already-redacted placeholders', () => {
    const out = redactResult({ apiKey: { redacted: true, kind: 'string', length: 5 } });
    assert.equal(out.apiKey.length, 5);
  });

  it('passes through non-object, non-string results unchanged', () => {
    assert.equal(redactResult(42), 42);
    assert.equal(redactResult(null), null);
    assert.equal(redactResult(undefined), undefined);
  });
});

describe('redactEventLog (migration)', () => {
  it('rewrites legacy entries and counts scrubbed', () => {
    const events = [
      { type: 'user_message', data: { content: 'hi' } },
      { type: 'tool_call', data: { name: 't1', arguments: { url: 'x' } } },
      { type: 'tool_call', data: { name: 't2', arguments: { apiKey: 'sk-old-leaked' } } },
      { type: 'tool_call', data: { name: 't3', arguments: { passphrase: 'pw' } } },
    ];
    const { scrubbed } = redactEventLog(events);
    assert.equal(scrubbed, 2, 'two tool_call entries had secret content');
    assert.equal(events[1].data.arguments.url, 'x', 'non-secret kept');
    assert.equal(events[2].data.arguments.apiKey.redacted, true);
    assert.equal(events[3].data.arguments.passphrase.redacted, true);
  });

  it('returns 0 scrubbed when no legacy secrets are present', () => {
    const events = [
      { type: 'tool_call', data: { name: 't', arguments: { url: 'x' } } },
    ];
    const { scrubbed } = redactEventLog(events);
    assert.equal(scrubbed, 0);
  });

  it('handles empty/non-array input safely', () => {
    assert.deepEqual(redactEventLog([]), { events: [], scrubbed: 0 });
    assert.deepEqual(redactEventLog(null), { events: [], scrubbed: 0 });
  });

  it('also scrubs legacy tool_result entries with leaked secrets', () => {
    const events = [
      { type: 'tool_result', data: { name: 't1', result: { success: true, output: 'clean output' } } },
      { type: 'tool_result', data: { name: 't2', result: { success: true, apiKey: 'sk-leaked-in-old-log' } } },
    ];
    const { scrubbed } = redactEventLog(events);
    assert.equal(scrubbed, 1);
    assert.equal(events[0].data.result.output, 'clean output');
    assert.equal(events[1].data.result.apiKey.redacted, true);
  });
});
