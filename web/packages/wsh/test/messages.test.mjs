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
  openTcp, openUdp, resolveDns, gatewayOk, gatewayFail, gatewayClose,
  inboundOpen, inboundAccept, inboundReject, dnsResult,
  listenRequest, listenOk, listenFail, listenClose, gatewayData,
  guestInvite, guestJoin, guestRevoke,
  shareSession, shareRevoke,
  compressBegin, compressAck,
  rateControl, rateWarning,
  sessionLink, sessionUnlink,
  copilotAttach, copilotSuggest, copilotDetach,
  keyExchange, encryptedFrame,
  echoAck, echoState,
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

  // ── Gateway messages ─────────────────────────────────────────────

  it('openTcp', () => {
    const msg = openTcp({ gatewayId: 1, host: 'example.com', port: 80 });
    assert.equal(msg.type, MSG.OPEN_TCP);
    assert.equal(msg.gateway_id, 1);
    assert.equal(msg.host, 'example.com');
    assert.equal(msg.port, 80);
  });

  it('openUdp', () => {
    const msg = openUdp({ gatewayId: 2, host: '10.0.0.1', port: 53 });
    assert.equal(msg.type, MSG.OPEN_UDP);
    assert.equal(msg.gateway_id, 2);
    assert.equal(msg.host, '10.0.0.1');
    assert.equal(msg.port, 53);
  });

  it('resolveDns', () => {
    const msg = resolveDns({ gatewayId: 3, name: 'example.com' });
    assert.equal(msg.type, MSG.RESOLVE_DNS);
    assert.equal(msg.gateway_id, 3);
    assert.equal(msg.name, 'example.com');
    assert.equal(msg.record_type, 'A');
  });

  it('resolveDns with custom record type', () => {
    const msg = resolveDns({ gatewayId: 4, name: 'example.com', recordType: 'AAAA' });
    assert.equal(msg.record_type, 'AAAA');
  });

  it('gatewayOk', () => {
    const msg = gatewayOk({ gatewayId: 1, resolvedAddr: '93.184.216.34' });
    assert.equal(msg.type, MSG.GATEWAY_OK);
    assert.equal(msg.gateway_id, 1);
    assert.equal(msg.resolved_addr, '93.184.216.34');
  });

  it('gatewayOk without resolved addr', () => {
    const msg = gatewayOk({ gatewayId: 1 });
    assert.equal(msg.type, MSG.GATEWAY_OK);
    assert.equal(msg.resolved_addr, undefined);
  });

  it('gatewayFail', () => {
    const msg = gatewayFail({ gatewayId: 1, code: 111, message: 'Connection refused' });
    assert.equal(msg.type, MSG.GATEWAY_FAIL);
    assert.equal(msg.gateway_id, 1);
    assert.equal(msg.code, 111);
    assert.equal(msg.message, 'Connection refused');
  });

  it('gatewayClose', () => {
    const msg = gatewayClose({ gatewayId: 1, reason: 'peer reset' });
    assert.equal(msg.type, MSG.GATEWAY_CLOSE);
    assert.equal(msg.gateway_id, 1);
    assert.equal(msg.reason, 'peer reset');
  });

  it('gatewayClose without reason', () => {
    const msg = gatewayClose({ gatewayId: 1 });
    assert.equal(msg.reason, undefined);
  });

  it('inboundOpen', () => {
    const msg = inboundOpen({ listenerId: 1, channelId: 5, peerAddr: '10.0.0.2', peerPort: 54321 });
    assert.equal(msg.type, MSG.INBOUND_OPEN);
    assert.equal(msg.listener_id, 1);
    assert.equal(msg.channel_id, 5);
    assert.equal(msg.peer_addr, '10.0.0.2');
    assert.equal(msg.peer_port, 54321);
  });

  it('inboundAccept', () => {
    const msg = inboundAccept({ channelId: 5 });
    assert.equal(msg.type, MSG.INBOUND_ACCEPT);
    assert.equal(msg.channel_id, 5);
    assert.equal(msg.gateway_id, undefined);
  });

  it('inboundAccept with gateway_id', () => {
    const msg = inboundAccept({ channelId: 5, gatewayId: 42 });
    assert.equal(msg.type, MSG.INBOUND_ACCEPT);
    assert.equal(msg.channel_id, 5);
    assert.equal(msg.gateway_id, 42);
  });

  it('inboundReject', () => {
    const msg = inboundReject({ channelId: 5, reason: 'policy denied' });
    assert.equal(msg.type, MSG.INBOUND_REJECT);
    assert.equal(msg.channel_id, 5);
    assert.equal(msg.reason, 'policy denied');
  });

  it('inboundReject without reason', () => {
    const msg = inboundReject({ channelId: 5 });
    assert.equal(msg.reason, undefined);
  });

  it('dnsResult', () => {
    const msg = dnsResult({ gatewayId: 3, addresses: ['93.184.216.34', '2606:2800:220:1::'], ttl: 300 });
    assert.equal(msg.type, MSG.DNS_RESULT);
    assert.equal(msg.gateway_id, 3);
    assert.deepEqual(msg.addresses, ['93.184.216.34', '2606:2800:220:1::']);
    assert.equal(msg.ttl, 300);
  });

  it('dnsResult without ttl', () => {
    const msg = dnsResult({ gatewayId: 3, addresses: ['127.0.0.1'] });
    assert.equal(msg.ttl, undefined);
  });

  it('listenRequest', () => {
    const msg = listenRequest({ listenerId: 1, port: 8080 });
    assert.equal(msg.type, MSG.LISTEN_REQUEST);
    assert.equal(msg.listener_id, 1);
    assert.equal(msg.port, 8080);
    assert.equal(msg.bind_addr, '0.0.0.0');
  });

  it('listenRequest with custom bind addr', () => {
    const msg = listenRequest({ listenerId: 1, port: 8080, bindAddr: '127.0.0.1' });
    assert.equal(msg.bind_addr, '127.0.0.1');
  });

  it('listenOk', () => {
    const msg = listenOk({ listenerId: 1, actualPort: 8080 });
    assert.equal(msg.type, MSG.LISTEN_OK);
    assert.equal(msg.listener_id, 1);
    assert.equal(msg.actual_port, 8080);
  });

  it('listenFail', () => {
    const msg = listenFail({ listenerId: 1, reason: 'address in use' });
    assert.equal(msg.type, MSG.LISTEN_FAIL);
    assert.equal(msg.listener_id, 1);
    assert.equal(msg.reason, 'address in use');
  });

  it('listenClose', () => {
    const msg = listenClose({ listenerId: 1 });
    assert.equal(msg.type, MSG.LISTEN_CLOSE);
    assert.equal(msg.listener_id, 1);
  });

  it('gatewayData', () => {
    const payload = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const msg = gatewayData({ gatewayId: 7, data: payload });
    assert.equal(msg.type, MSG.GATEWAY_DATA);
    assert.equal(msg.gateway_id, 7);
    assert.equal(msg.data, payload);
  });
});

describe('CHANNEL_KIND extensions', () => {
  it('has tcp and udp kinds', () => {
    assert.equal(CHANNEL_KIND.TCP, 'tcp');
    assert.equal(CHANNEL_KIND.UDP, 'udp');
  });

  it('still has original kinds', () => {
    assert.equal(CHANNEL_KIND.PTY, 'pty');
    assert.equal(CHANNEL_KIND.EXEC, 'exec');
    assert.equal(CHANNEL_KIND.META, 'meta');
    assert.equal(CHANNEL_KIND.FILE, 'file');
  });

  it('has exactly 7 kinds', () => {
    assert.equal(Object.keys(CHANNEL_KIND).length, 7);
  });
});

describe('ephemeral guest sessions', () => {
  it('guestInvite', () => {
    const msg = guestInvite({ sessionId: 's1', ttl: 600, permissions: ['read'] });
    assert.equal(msg.type, MSG.GUEST_INVITE);
    assert.equal(msg.session_id, 's1');
    assert.equal(msg.ttl, 600);
    assert.deepEqual(msg.permissions, ['read']);
  });

  it('guestInvite with default permissions', () => {
    const msg = guestInvite({ sessionId: 's1', ttl: 300 });
    assert.deepEqual(msg.permissions, ['read']);
  });

  it('guestJoin', () => {
    const msg = guestJoin({ token: 'abc123', deviceLabel: 'Guest/Chrome' });
    assert.equal(msg.type, MSG.GUEST_JOIN);
    assert.equal(msg.token, 'abc123');
    assert.equal(msg.device_label, 'Guest/Chrome');
  });

  it('guestJoin without device label', () => {
    const msg = guestJoin({ token: 'abc123' });
    assert.equal(msg.device_label, undefined);
  });

  it('guestRevoke', () => {
    const msg = guestRevoke({ token: 'abc123', reason: 'expired' });
    assert.equal(msg.type, MSG.GUEST_REVOKE);
    assert.equal(msg.token, 'abc123');
    assert.equal(msg.reason, 'expired');
  });

  it('guestRevoke without reason', () => {
    const msg = guestRevoke({ token: 'abc123' });
    assert.equal(msg.reason, undefined);
  });

  it('guest message codes in 0x80-0x82 range', () => {
    assert.equal(MSG.GUEST_INVITE, 0x80);
    assert.equal(MSG.GUEST_JOIN, 0x81);
    assert.equal(MSG.GUEST_REVOKE, 0x82);
  });

  it('guest messages validate correctly', () => {
    assert.ok(isValidMessage(guestInvite({ sessionId: 's1', ttl: 300 })));
    assert.ok(isValidMessage(guestJoin({ token: 'x' })));
    assert.ok(isValidMessage(guestRevoke({ token: 'x' })));
  });
});

describe('multi-attach read-only URL sharing', () => {
  it('shareSession', () => {
    const msg = shareSession({ sessionId: 's1', mode: 'read', ttl: 3600 });
    assert.equal(msg.type, MSG.SHARE_SESSION);
    assert.equal(msg.session_id, 's1');
    assert.equal(msg.mode, 'read');
    assert.equal(msg.ttl, 3600);
  });

  it('shareSession with default mode', () => {
    const msg = shareSession({ sessionId: 's1', ttl: 600 });
    assert.equal(msg.mode, 'read');
  });

  it('shareRevoke', () => {
    const msg = shareRevoke({ shareId: 'share-abc', reason: 'no longer needed' });
    assert.equal(msg.type, MSG.SHARE_REVOKE);
    assert.equal(msg.share_id, 'share-abc');
    assert.equal(msg.reason, 'no longer needed');
  });

  it('shareRevoke without reason', () => {
    const msg = shareRevoke({ shareId: 'share-abc' });
    assert.equal(msg.reason, undefined);
  });

  it('share message codes', () => {
    assert.equal(MSG.SHARE_SESSION, 0x83);
    assert.equal(MSG.SHARE_REVOKE, 0x84);
  });

  it('share messages validate correctly', () => {
    assert.ok(isValidMessage(shareSession({ sessionId: 's1', ttl: 60 })));
    assert.ok(isValidMessage(shareRevoke({ shareId: 'x' })));
  });
});

describe('stream compression negotiation', () => {
  it('compressBegin', () => {
    const msg = compressBegin({ algorithm: 'zstd', level: 3 });
    assert.equal(msg.type, MSG.COMPRESS_BEGIN);
    assert.equal(msg.algorithm, 'zstd');
    assert.equal(msg.level, 3);
  });

  it('compressBegin with default level', () => {
    const msg = compressBegin({ algorithm: 'zstd' });
    assert.equal(msg.level, 3);
  });

  it('compressAck', () => {
    const msg = compressAck({ algorithm: 'zstd', accepted: true });
    assert.equal(msg.type, MSG.COMPRESS_ACK);
    assert.equal(msg.algorithm, 'zstd');
    assert.equal(msg.accepted, true);
  });

  it('compressAck rejected', () => {
    const msg = compressAck({ algorithm: 'zstd', accepted: false });
    assert.equal(msg.accepted, false);
  });

  it('compress message codes', () => {
    assert.equal(MSG.COMPRESS_BEGIN, 0x85);
    assert.equal(MSG.COMPRESS_ACK, 0x86);
  });

  it('compress messages validate correctly', () => {
    assert.ok(isValidMessage(compressBegin({ algorithm: 'zstd' })));
    assert.ok(isValidMessage(compressAck({ algorithm: 'zstd', accepted: true })));
  });
});

describe('per-attachment rate control', () => {
  it('rateControl', () => {
    const msg = rateControl({ sessionId: 's1', maxBytesPerSec: 1048576, policy: 'drop' });
    assert.equal(msg.type, MSG.RATE_CONTROL);
    assert.equal(msg.session_id, 's1');
    assert.equal(msg.max_bytes_per_sec, 1048576);
    assert.equal(msg.policy, 'drop');
  });

  it('rateControl with default policy', () => {
    const msg = rateControl({ sessionId: 's1', maxBytesPerSec: 0 });
    assert.equal(msg.policy, 'pause');
  });

  it('rateWarning', () => {
    const msg = rateWarning({ sessionId: 's1', queuedBytes: 4096, action: 'dropping' });
    assert.equal(msg.type, MSG.RATE_WARNING);
    assert.equal(msg.session_id, 's1');
    assert.equal(msg.queued_bytes, 4096);
    assert.equal(msg.action, 'dropping');
  });

  it('rate control codes', () => {
    assert.equal(MSG.RATE_CONTROL, 0x87);
    assert.equal(MSG.RATE_WARNING, 0x88);
  });

  it('rate control messages validate correctly', () => {
    assert.ok(isValidMessage(rateControl({ sessionId: 's1', maxBytesPerSec: 0 })));
    assert.ok(isValidMessage(rateWarning({ sessionId: 's1', queuedBytes: 0, action: 'ok' })));
  });
});

describe('cross-session linking (jump host)', () => {
  it('sessionLink', () => {
    const msg = sessionLink({ sourceSession: 's1', targetHost: 'jump.example.com', targetPort: 22, targetUser: 'admin' });
    assert.equal(msg.type, MSG.SESSION_LINK);
    assert.equal(msg.source_session, 's1');
    assert.equal(msg.target_host, 'jump.example.com');
    assert.equal(msg.target_port, 22);
    assert.equal(msg.target_user, 'admin');
  });

  it('sessionLink with optional target user', () => {
    const msg = sessionLink({ sourceSession: 's1', targetHost: 'host', targetPort: 22 });
    assert.equal(msg.target_user, undefined);
  });

  it('sessionUnlink', () => {
    const msg = sessionUnlink({ linkId: 'link-42', reason: 'user requested' });
    assert.equal(msg.type, MSG.SESSION_UNLINK);
    assert.equal(msg.link_id, 'link-42');
    assert.equal(msg.reason, 'user requested');
  });

  it('sessionUnlink without reason', () => {
    const msg = sessionUnlink({ linkId: 'link-42' });
    assert.equal(msg.reason, undefined);
  });

  it('session link codes', () => {
    assert.equal(MSG.SESSION_LINK, 0x89);
    assert.equal(MSG.SESSION_UNLINK, 0x8a);
  });

  it('session link messages validate correctly', () => {
    assert.ok(isValidMessage(sessionLink({ sourceSession: 's1', targetHost: 'h', targetPort: 22 })));
    assert.ok(isValidMessage(sessionUnlink({ linkId: 'x' })));
  });
});

describe('AI co-pilot attachment mode', () => {
  it('copilotAttach', () => {
    const msg = copilotAttach({ sessionId: 's1', model: 'claude-sonnet', contextWindow: 200000 });
    assert.equal(msg.type, MSG.COPILOT_ATTACH);
    assert.equal(msg.session_id, 's1');
    assert.equal(msg.model, 'claude-sonnet');
    assert.equal(msg.context_window, 200000);
  });

  it('copilotAttach with optional context window', () => {
    const msg = copilotAttach({ sessionId: 's1', model: 'gpt-4' });
    assert.equal(msg.context_window, undefined);
  });

  it('copilotSuggest', () => {
    const msg = copilotSuggest({ sessionId: 's1', suggestion: 'try: git stash', confidence: 0.95 });
    assert.equal(msg.type, MSG.COPILOT_SUGGEST);
    assert.equal(msg.session_id, 's1');
    assert.equal(msg.suggestion, 'try: git stash');
    assert.equal(msg.confidence, 0.95);
  });

  it('copilotSuggest with optional confidence', () => {
    const msg = copilotSuggest({ sessionId: 's1', suggestion: 'hello' });
    assert.equal(msg.confidence, undefined);
  });

  it('copilotDetach', () => {
    const msg = copilotDetach({ sessionId: 's1', reason: 'user dismissed' });
    assert.equal(msg.type, MSG.COPILOT_DETACH);
    assert.equal(msg.session_id, 's1');
    assert.equal(msg.reason, 'user dismissed');
  });

  it('copilotDetach without reason', () => {
    const msg = copilotDetach({ sessionId: 's1' });
    assert.equal(msg.reason, undefined);
  });

  it('copilot codes', () => {
    assert.equal(MSG.COPILOT_ATTACH, 0x8b);
    assert.equal(MSG.COPILOT_SUGGEST, 0x8c);
    assert.equal(MSG.COPILOT_DETACH, 0x8d);
  });

  it('copilot messages validate correctly', () => {
    assert.ok(isValidMessage(copilotAttach({ sessionId: 's1', model: 'm' })));
    assert.ok(isValidMessage(copilotSuggest({ sessionId: 's1', suggestion: 's' })));
    assert.ok(isValidMessage(copilotDetach({ sessionId: 's1' })));
  });
});

describe('E2E encrypted session mode', () => {
  it('keyExchange', () => {
    const pk = new Uint8Array(32);
    const msg = keyExchange({ algorithm: 'x25519', publicKey: pk, sessionId: 's1' });
    assert.equal(msg.type, MSG.KEY_EXCHANGE);
    assert.equal(msg.algorithm, 'x25519');
    assert.equal(msg.public_key, pk);
    assert.equal(msg.session_id, 's1');
  });

  it('encryptedFrame', () => {
    const nonce = new Uint8Array(12);
    const ciphertext = new Uint8Array([0xde, 0xad]);
    const msg = encryptedFrame({ nonce, ciphertext, sessionId: 's1' });
    assert.equal(msg.type, MSG.ENCRYPTED_FRAME);
    assert.equal(msg.nonce, nonce);
    assert.equal(msg.ciphertext, ciphertext);
    assert.equal(msg.session_id, 's1');
  });

  it('E2E codes', () => {
    assert.equal(MSG.KEY_EXCHANGE, 0x8e);
    assert.equal(MSG.ENCRYPTED_FRAME, 0x8f);
  });

  it('E2E messages validate correctly', () => {
    assert.ok(isValidMessage(keyExchange({ algorithm: 'x25519', publicKey: new Uint8Array(32), sessionId: 's1' })));
    assert.ok(isValidMessage(encryptedFrame({ nonce: new Uint8Array(12), ciphertext: new Uint8Array(0), sessionId: 's1' })));
  });
});

describe('predictive local echo (mosh-style)', () => {
  it('echoAck', () => {
    const msg = echoAck({ channelId: 1, echoSeq: 42 });
    assert.equal(msg.type, MSG.ECHO_ACK);
    assert.equal(msg.channel_id, 1);
    assert.equal(msg.echo_seq, 42);
  });

  it('echoState', () => {
    const msg = echoState({ channelId: 1, echoSeq: 42, cursorX: 10, cursorY: 5, pending: 3 });
    assert.equal(msg.type, MSG.ECHO_STATE);
    assert.equal(msg.channel_id, 1);
    assert.equal(msg.echo_seq, 42);
    assert.equal(msg.cursor_x, 10);
    assert.equal(msg.cursor_y, 5);
    assert.equal(msg.pending, 3);
  });

  it('echoState with defaults', () => {
    const msg = echoState({ channelId: 1, echoSeq: 0, cursorX: 0, cursorY: 0, pending: 0 });
    assert.equal(msg.pending, 0);
  });

  it('echo codes', () => {
    assert.equal(MSG.ECHO_ACK, 0x90);
    assert.equal(MSG.ECHO_STATE, 0x91);
  });

  it('echo messages validate correctly', () => {
    assert.ok(isValidMessage(echoAck({ channelId: 1, echoSeq: 0 })));
    assert.ok(isValidMessage(echoState({ channelId: 1, echoSeq: 0, cursorX: 0, cursorY: 0, pending: 0 })));
  });
});

describe('gateway MSG constants', () => {
  it('gateway codes are in 0x70-0x7e range', () => {
    assert.equal(MSG.OPEN_TCP, 0x70);
    assert.equal(MSG.OPEN_UDP, 0x71);
    assert.equal(MSG.RESOLVE_DNS, 0x72);
    assert.equal(MSG.GATEWAY_OK, 0x73);
    assert.equal(MSG.GATEWAY_FAIL, 0x74);
    assert.equal(MSG.GATEWAY_CLOSE, 0x75);
    assert.equal(MSG.INBOUND_OPEN, 0x76);
    assert.equal(MSG.INBOUND_ACCEPT, 0x77);
    assert.equal(MSG.INBOUND_REJECT, 0x78);
    assert.equal(MSG.DNS_RESULT, 0x79);
    assert.equal(MSG.LISTEN_REQUEST, 0x7a);
    assert.equal(MSG.LISTEN_OK, 0x7b);
    assert.equal(MSG.LISTEN_FAIL, 0x7c);
    assert.equal(MSG.LISTEN_CLOSE, 0x7d);
    assert.equal(MSG.GATEWAY_DATA, 0x7e);
  });

  it('gateway messages validate correctly', () => {
    assert.ok(isValidMessage(openTcp({ gatewayId: 1, host: 'x', port: 80 })));
    assert.ok(isValidMessage(gatewayOk({ gatewayId: 1 })));
    assert.ok(isValidMessage(listenClose({ listenerId: 1 })));
    assert.ok(isValidMessage(gatewayData({ gatewayId: 1, data: new Uint8Array(0) })));
  });
});
