// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-oauth-wsh.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exchangeCodeViaWsh } from '../clawser-oauth-wsh.js';

describe('exchangeCodeViaWsh', () => {
  it('builds correct curl command and parses JSON response', async () => {
    let captured;
    const wshExec = async (cmd) => {
      captured = cmd;
      return JSON.stringify({ access_token: 'tok_abc', refresh_token: 'rt_xyz', expires_in: 3600 });
    };

    const result = await exchangeCodeViaWsh(
      'https://oauth2.googleapis.com/token',
      { grant_type: 'authorization_code', code: 'AUTH_CODE', client_id: 'cid', client_secret: 'csec', redirect_uri: 'http://localhost' },
      wshExec,
    );

    assert.equal(result.access_token, 'tok_abc');
    assert.equal(result.refresh_token, 'rt_xyz');
    assert.equal(result.expires_in, 3600);
    assert.ok(captured.includes('curl'));
    assert.ok(captured.includes('https://oauth2.googleapis.com/token'));
    assert.ok(captured.includes('grant_type=authorization_code'));
  });

  it('throws on non-JSON response', async () => {
    const wshExec = async () => 'Not JSON at all';
    await assert.rejects(
      () => exchangeCodeViaWsh('https://example.com/token', { code: 'c' }, wshExec),
      { message: /Failed to parse token response/ },
    );
  });

  it('throws on error in response body', async () => {
    const wshExec = async () => JSON.stringify({ error: 'invalid_grant', error_description: 'Code expired' });
    await assert.rejects(
      () => exchangeCodeViaWsh('https://example.com/token', { code: 'c' }, wshExec),
      { message: /invalid_grant/ },
    );
  });

  it('throws if wshExec is not a function', async () => {
    await assert.rejects(
      () => exchangeCodeViaWsh('https://example.com/token', {}, null),
      { message: /wshExec must be a function/ },
    );
  });

  it('escapes single quotes in param values', async () => {
    let captured;
    const wshExec = async (cmd) => { captured = cmd; return '{"access_token":"t"}'; };
    await exchangeCodeViaWsh('https://example.com/token', { code: "it's" }, wshExec);
    // The value should be escaped so curl doesn't break
    assert.ok(!captured.includes("it's") || captured.includes("it'\\''s") || captured.includes('code=it'));
  });
});
