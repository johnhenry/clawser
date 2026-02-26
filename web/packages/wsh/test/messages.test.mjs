import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MSG, MSG_NAMES, PROTOCOL_VERSION,
  hello, serverHello, challenge, authMethods, auth, authOk, authFail,
  open, openOk, openFail, resize, signal, exit, close, error, ping, pong,
  attach, resume, rename, idleWarning, shutdown, snapshot,
  presence, controlChanged, metrics,
  mcpDiscover, mcpTools, mcpCall, mcpResult,
  reverseRegister, reverseList, reversePeers, reverseConnect,
  msgName, isValidMessage,
  AUTH_METHOD, CHANNEL_KIND,
} from '../src/messages.mjs';

describe('MSG constants', () => {
  it('has unique values', () => {
    const values = Object.values(MSG);
    const unique = new Set(values);
    assert.equal(values.length, unique.size, 'MSG values must be unique');
  });

  it('MSG_NAMES maps back correctly', () => {
    for (const [name, value] of Object.entries(MSG)) {
      assert.equal(MSG_NAMES[value], name);
    }
  });
});

describe('msgName', () => {
  it('returns name for known types', () => {
    assert.equal(msgName(MSG.HELLO), 'HELLO');
    assert.equal(msgName(MSG.AUTH_OK), 'AUTH_OK');
    assert.equal(msgName(MSG.MCP_CALL), 'MCP_CALL');
  });

  it('returns UNKNOWN for unrecognized types', () => {
    assert.ok(msgName(0xff).startsWith('UNKNOWN'));
  });
});

describe('isValidMessage', () => {
  it('validates known message objects', () => {
    assert.ok(isValidMessage(hello({ username: 'test' })));
    assert.ok(isValidMessage(ping({ id: 1 })));
  });

  it('rejects invalid inputs', () => {
    assert.ok(!isValidMessage(null));
    assert.ok(!isValidMessage({}));
    assert.ok(!isValidMessage({ type: 'string' }));
    assert.ok(!isValidMessage({ type: 0xff }));
  });
});

describe('message constructors', () => {
  it('hello', () => {
    const msg = hello({ username: 'john', features: ['pty'] });
    assert.equal(msg.type, MSG.HELLO);
    assert.equal(msg.version, PROTOCOL_VERSION);
    assert.equal(msg.username, 'john');
    assert.deepEqual(msg.features, ['pty']);
    assert.equal(msg.auth_method, AUTH_METHOD.PUBKEY);
  });

  it('serverHello', () => {
    const msg = serverHello({ sessionId: 'abc', fingerprints: ['a3f8'] });
    assert.equal(msg.type, MSG.SERVER_HELLO);
    assert.equal(msg.session_id, 'abc');
    assert.deepEqual(msg.fingerprints, ['a3f8']);
  });

  it('challenge', () => {
    const nonce = new Uint8Array(32);
    const msg = challenge({ nonce });
    assert.equal(msg.type, MSG.CHALLENGE);
    assert.equal(msg.nonce, nonce);
  });

  it('auth (pubkey)', () => {
    const sig = new Uint8Array(64);
    const pk = new Uint8Array(32);
    const msg = auth({ method: AUTH_METHOD.PUBKEY, signature: sig, publicKey: pk });
    assert.equal(msg.type, MSG.AUTH);
    assert.equal(msg.method, 'pubkey');
    assert.equal(msg.signature, sig);
    assert.equal(msg.public_key, pk);
    assert.equal(msg.password, undefined);
  });

  it('auth (password)', () => {
    const msg = auth({ method: AUTH_METHOD.PASSWORD, password: 'secret' });
    assert.equal(msg.type, MSG.AUTH);
    assert.equal(msg.method, 'password');
    assert.equal(msg.password, 'secret');
  });

  it('authOk', () => {
    const token = new Uint8Array(40);
    const msg = authOk({ sessionId: 's1', token, ttl: 3600 });
    assert.equal(msg.type, MSG.AUTH_OK);
    assert.equal(msg.session_id, 's1');
    assert.equal(msg.ttl, 3600);
  });

  it('authFail', () => {
    const msg = authFail({ reason: 'bad key' });
    assert.equal(msg.type, MSG.AUTH_FAIL);
    assert.equal(msg.reason, 'bad key');
  });

  it('open', () => {
    const msg = open({ kind: CHANNEL_KIND.PTY, cols: 80, rows: 24 });
    assert.equal(msg.type, MSG.OPEN);
    assert.equal(msg.kind, 'pty');
    assert.equal(msg.cols, 80);
    assert.equal(msg.rows, 24);
  });

  it('open (exec with command)', () => {
    const msg = open({ kind: CHANNEL_KIND.EXEC, command: 'ls -la' });
    assert.equal(msg.kind, 'exec');
    assert.equal(msg.command, 'ls -la');
  });

  it('openOk', () => {
    const msg = openOk({ channelId: 1, streamIds: [2, 3] });
    assert.equal(msg.type, MSG.OPEN_OK);
    assert.equal(msg.channel_id, 1);
    assert.deepEqual(msg.stream_ids, [2, 3]);
  });

  it('resize', () => {
    const msg = resize({ channelId: 1, cols: 120, rows: 40 });
    assert.equal(msg.type, MSG.RESIZE);
    assert.equal(msg.channel_id, 1);
    assert.equal(msg.cols, 120);
  });

  it('signal', () => {
    const msg = signal({ channelId: 1, signal: 'SIGINT' });
    assert.equal(msg.type, MSG.SIGNAL);
    assert.equal(msg.signal, 'SIGINT');
  });

  it('exit', () => {
    const msg = exit({ channelId: 1, code: 0 });
    assert.equal(msg.type, MSG.EXIT);
    assert.equal(msg.code, 0);
  });

  it('close', () => {
    const msg = close({ channelId: 1 });
    assert.equal(msg.type, MSG.CLOSE);
    assert.equal(msg.channel_id, 1);
  });

  it('ping/pong', () => {
    assert.equal(ping({ id: 42 }).type, MSG.PING);
    assert.equal(pong({ id: 42 }).type, MSG.PONG);
    assert.equal(pong({ id: 42 }).id, 42);
  });

  it('attach', () => {
    const msg = attach({ sessionId: 's1', token: new Uint8Array(40), mode: 'read' });
    assert.equal(msg.type, MSG.ATTACH);
    assert.equal(msg.mode, 'read');
  });

  it('mcpDiscover', () => {
    assert.equal(mcpDiscover().type, MSG.MCP_DISCOVER);
  });

  it('mcpTools', () => {
    const msg = mcpTools({ tools: [{ name: 'git', description: 'Git tool' }] });
    assert.equal(msg.type, MSG.MCP_TOOLS);
    assert.equal(msg.tools.length, 1);
  });

  it('reverseRegister', () => {
    const msg = reverseRegister({
      username: 'john',
      capabilities: ['shell', 'fs'],
      publicKey: new Uint8Array(32),
    });
    assert.equal(msg.type, MSG.REVERSE_REGISTER);
    assert.deepEqual(msg.capabilities, ['shell', 'fs']);
  });

  it('metrics', () => {
    const msg = metrics({ cpu: 0.5, memory: 1024, sessions: 3, rtt: 50 });
    assert.equal(msg.type, MSG.METRICS);
    assert.equal(msg.cpu, 0.5);
  });
});
