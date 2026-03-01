// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-remote.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Polyfill crypto for Node
if (!globalThis.crypto) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}

// Stub BrowserTool before import
globalThis.BrowserTool = class { constructor() {} };

import {
  DEFAULT_CODE_LENGTH,
  DEFAULT_CODE_EXPIRY_MS,
  DEFAULT_TOKEN_EXPIRY_MS,
  DEFAULT_RATE_LIMIT,
  generatePairingCode,
  generateToken,
  PairingManager,
  RateLimiter,
} from '../clawser-remote.js';

// ── Constants ───────────────────────────────────────────────────

describe('Remote constants', () => {
  it('DEFAULT_CODE_LENGTH is 6', () => {
    assert.equal(DEFAULT_CODE_LENGTH, 6);
  });

  it('DEFAULT_CODE_EXPIRY_MS is 5 minutes', () => {
    assert.equal(DEFAULT_CODE_EXPIRY_MS, 5 * 60_000);
  });

  it('DEFAULT_TOKEN_EXPIRY_MS is 24 hours', () => {
    assert.equal(DEFAULT_TOKEN_EXPIRY_MS, 24 * 60 * 60_000);
  });

  it('DEFAULT_RATE_LIMIT is 60', () => {
    assert.equal(DEFAULT_RATE_LIMIT, 60);
  });
});

// ── generatePairingCode ─────────────────────────────────────────

describe('generatePairingCode', () => {
  it('returns a string of correct length', () => {
    const code = generatePairingCode();
    assert.equal(code.length, 6);
  });

  it('returns only digits', () => {
    const code = generatePairingCode();
    assert.ok(/^\d+$/.test(code));
  });

  it('respects custom length', () => {
    const code = generatePairingCode(8);
    assert.equal(code.length, 8);
  });
});

// ── generateToken ───────────────────────────────────────────────

describe('generateToken', () => {
  it('starts with bearer_', () => {
    const token = generateToken();
    assert.ok(token.startsWith('bearer_'));
  });

  it('has sufficient length', () => {
    const token = generateToken();
    assert.ok(token.length > 32);
  });

  it('generates unique tokens', () => {
    const t1 = generateToken();
    const t2 = generateToken();
    assert.notEqual(t1, t2);
  });
});

// ── PairingManager ──────────────────────────────────────────────

describe('PairingManager', () => {
  let mgr;

  beforeEach(() => {
    mgr = new PairingManager({ maxExchangeAttempts: 100 });
  });

  it('constructor defaults', () => {
    assert.equal(mgr.sessionCount, 0);
    assert.equal(mgr.codeCount, 0);
  });

  it('createCode returns a 6-digit string', () => {
    const code = mgr.createCode();
    assert.equal(code.length, 6);
    assert.ok(/^\d+$/.test(code));
    assert.equal(mgr.codeCount, 1);
  });

  it('exchangeCode returns token for valid code', () => {
    const code = mgr.createCode();
    const result = mgr.exchangeCode(code);
    assert.ok(result);
    assert.ok(result.token.startsWith('bearer_'));
    assert.equal(typeof result.expires, 'number');
  });

  it('exchangeCode returns null for invalid code', () => {
    assert.equal(mgr.exchangeCode('000000'), null);
  });

  it('exchangeCode returns null for already-used code', () => {
    const code = mgr.createCode();
    mgr.exchangeCode(code); // first use
    const result = mgr.exchangeCode(code); // second use
    assert.equal(result, null);
  });

  it('validateToken returns true for valid token', () => {
    const code = mgr.createCode();
    const { token } = mgr.exchangeCode(code);
    assert.equal(mgr.validateToken(token), true);
  });

  it('validateToken returns false for unknown token', () => {
    assert.equal(mgr.validateToken('bearer_fake'), false);
  });

  it('revokeToken removes a session', () => {
    const code = mgr.createCode();
    const { token } = mgr.exchangeCode(code);
    assert.equal(mgr.revokeToken(token), true);
    assert.equal(mgr.validateToken(token), false);
  });

  it('revokeAll clears all sessions and codes', () => {
    mgr.createCode();
    const code2 = mgr.createCode();
    mgr.exchangeCode(code2);
    mgr.revokeAll();
    assert.equal(mgr.sessionCount, 0);
    assert.equal(mgr.codeCount, 0);
  });

  it('listSessions returns session info', () => {
    const code = mgr.createCode();
    mgr.exchangeCode(code, { device: 'phone' });
    const sessions = mgr.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].device, 'phone');
    assert.ok(sessions[0].token.endsWith('...'));
  });

  it('sessionCount reflects active sessions', () => {
    const code = mgr.createCode();
    mgr.exchangeCode(code);
    assert.equal(mgr.sessionCount, 1);
  });
});

// ── RateLimiter ─────────────────────────────────────────────────

describe('RateLimiter', () => {
  it('constructor with default maxPerMinute', () => {
    const rl = new RateLimiter();
    assert.equal(rl.maxPerMinute, 60);
  });

  it('allow returns true within limit', () => {
    const rl = new RateLimiter(3);
    assert.equal(rl.allow('t1'), true);
    assert.equal(rl.allow('t1'), true);
    assert.equal(rl.allow('t1'), true);
  });

  it('allow returns false when exceeded', () => {
    const rl = new RateLimiter(2);
    rl.allow('t1');
    rl.allow('t1');
    assert.equal(rl.allow('t1'), false);
  });

  it('remaining returns correct count', () => {
    const rl = new RateLimiter(5);
    assert.equal(rl.remaining('t1'), 5);
    rl.allow('t1');
    rl.allow('t1');
    assert.equal(rl.remaining('t1'), 3);
  });

  it('remaining returns max for unknown token', () => {
    const rl = new RateLimiter(10);
    assert.equal(rl.remaining('unknown'), 10);
  });

  it('reset clears single token', () => {
    const rl = new RateLimiter(2);
    rl.allow('t1');
    rl.allow('t1');
    rl.reset('t1');
    assert.equal(rl.remaining('t1'), 2);
  });

  it('reset clears all tokens', () => {
    const rl = new RateLimiter(2);
    rl.allow('t1');
    rl.allow('t2');
    rl.reset();
    assert.equal(rl.remaining('t1'), 2);
    assert.equal(rl.remaining('t2'), 2);
  });
});
