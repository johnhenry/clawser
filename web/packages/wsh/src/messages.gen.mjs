/**
 * wsh protocol control message types and constructors.
 * AUTO-GENERATED from wsh-v1.yaml — do not edit.
 * Run: node web/packages/wsh/spec/codegen.mjs
 */

// ── Message type constants ────────────────────────────────────────────

export const MSG = Object.freeze({
  // Handshake
  HELLO:             0x01,
  SERVER_HELLO:      0x02,
  CHALLENGE:         0x03,
  AUTH_METHODS:      0x04,
  AUTH:              0x05,
  AUTH_OK:           0x06,
  AUTH_FAIL:         0x07,

  // Channel
  OPEN:              0x10,
  OPEN_OK:           0x11,
  OPEN_FAIL:         0x12,
  RESIZE:            0x13,
  SIGNAL:            0x14,
  EXIT:              0x15,
  CLOSE:             0x16,

  // Transport
  ERROR:             0x20,
  PING:              0x21,
  PONG:              0x22,

  // Session
  ATTACH:            0x30,
  RESUME:            0x31,
  RENAME:            0x32,
  IDLE_WARNING:      0x33,
  SHUTDOWN:          0x34,
  SNAPSHOT:          0x35,
  PRESENCE:          0x36,
  CONTROL_CHANGED:   0x37,
  METRICS:           0x38,
  CLIPBOARD:         0x39,
  RECORDING_EXPORT:  0x3a,
  COMMAND_JOURNAL:   0x3b,
  METRICS_REQUEST:   0x3c,
  SUSPEND_SESSION:   0x3d,
  RESTART_PTY:       0x3e,

  // Mcp
  MCP_DISCOVER:      0x40,
  MCP_TOOLS:         0x41,
  MCP_CALL:          0x42,
  MCP_RESULT:        0x43,

  // Reverse
  REVERSE_REGISTER:  0x50,
  REVERSE_LIST:      0x51,
  REVERSE_PEERS:     0x52,
  REVERSE_CONNECT:   0x53,

  // Framing
  WS_DATA:           0x60,

  // Gateway
  OPEN_TCP:          0x70,
  OPEN_UDP:          0x71,
  RESOLVE_DNS:       0x72,
  GATEWAY_OK:        0x73,
  GATEWAY_FAIL:      0x74,
  GATEWAY_CLOSE:     0x75,
  INBOUND_OPEN:      0x76,
  INBOUND_ACCEPT:    0x77,
  INBOUND_REJECT:    0x78,
  DNS_RESULT:        0x79,
  LISTEN_REQUEST:    0x7a,
  LISTEN_OK:         0x7b,
  LISTEN_FAIL:       0x7c,
  LISTEN_CLOSE:      0x7d,
  GATEWAY_DATA:      0x7e,

  // Guest
  GUEST_INVITE:      0x80,
  GUEST_JOIN:        0x81,
  GUEST_REVOKE:      0x82,

  // Sharing
  SHARE_SESSION:     0x83,
  SHARE_REVOKE:      0x84,

  // Compression
  COMPRESS_BEGIN:    0x85,
  COMPRESS_ACK:      0x86,
});

// Reverse lookup: number → name
export const MSG_NAMES = Object.freeze(
  Object.fromEntries(Object.entries(MSG).map(([k, v]) => [v, k]))
);

// ── Channel kinds ─────────────────────────────────────────────────────

export const CHANNEL_KIND = Object.freeze({
  PTY:   'pty',
  EXEC:  'exec',
  META:  'meta',
  FILE:  'file',
  TCP:   'tcp',
  UDP:   'udp',
  JOB:   'job',
});

// ── Auth methods ──────────────────────────────────────────────────────

export const AUTH_METHOD = Object.freeze({
  PUBKEY:    'pubkey',
  PASSWORD:  'password',
});

// ── Protocol version ──────────────────────────────────────────────────

export const PROTOCOL_VERSION = 'wsh-v1';

// ── Message constructors ──────────────────────────────────────────────

export function hello({ username, features = [], authMethod = AUTH_METHOD.PUBKEY } = {}) {
  return {
    type: MSG.HELLO,
    version: PROTOCOL_VERSION,
    username,
    features,
    auth_method: authMethod,
  };
}

export function serverHello({ sessionId, features = [], fingerprints = [] } = {}) {
  return {
    type: MSG.SERVER_HELLO,
    session_id: sessionId,
    features,
    fingerprints,
  };
}

export function challenge({ nonce } = {}) {
  return {
    type: MSG.CHALLENGE,
    nonce,
  };
}

export function authMethods({ methods = [AUTH_METHOD.PUBKEY] } = {}) {
  return {
    type: MSG.AUTH_METHODS,
    methods,
  };
}

export function auth({ method, signature, publicKey, password } = {}) {
  const msg = { type: MSG.AUTH, method };
  if (method === AUTH_METHOD.PUBKEY) {
    msg.signature = signature;
    msg.public_key = publicKey;
  } else if (method === AUTH_METHOD.PASSWORD) {
    msg.password = password;
  }
  return msg;
}

export function authOk({ sessionId, token, ttl } = {}) {
  return {
    type: MSG.AUTH_OK,
    session_id: sessionId,
    token,
    ttl,
  };
}

export function authFail({ reason } = {}) {
  return {
    type: MSG.AUTH_FAIL,
    reason,
  };
}

export function open({ kind, command, cols, rows, env } = {}) {
  const msg = { type: MSG.OPEN, kind };
  if (command !== undefined) msg.command = command;
  if (cols !== undefined) msg.cols = cols;
  if (rows !== undefined) msg.rows = rows;
  if (env !== undefined) msg.env = env;
  return msg;
}

export function openOk({ channelId, streamIds = [] } = {}) {
  return {
    type: MSG.OPEN_OK,
    channel_id: channelId,
    stream_ids: streamIds,
  };
}

export function openFail({ reason } = {}) {
  return {
    type: MSG.OPEN_FAIL,
    reason,
  };
}

export function resize({ channelId, cols, rows } = {}) {
  return {
    type: MSG.RESIZE,
    channel_id: channelId,
    cols,
    rows,
  };
}

export function signal({ channelId, signal } = {}) {
  return {
    type: MSG.SIGNAL,
    channel_id: channelId,
    signal,
  };
}

export function exit({ channelId, code } = {}) {
  return {
    type: MSG.EXIT,
    channel_id: channelId,
    code,
  };
}

export function close({ channelId } = {}) {
  return {
    type: MSG.CLOSE,
    channel_id: channelId,
  };
}

export function error({ code, message } = {}) {
  return {
    type: MSG.ERROR,
    code,
    message,
  };
}

export function ping({ id } = {}) {
  return {
    type: MSG.PING,
    id,
  };
}

export function pong({ id } = {}) {
  return {
    type: MSG.PONG,
    id,
  };
}

export function attach({ sessionId, token, mode = "control", deviceLabel } = {}) {
  const msg = { type: MSG.ATTACH, session_id: sessionId, token, mode };
  if (deviceLabel !== undefined) msg.device_label = deviceLabel;
  return msg;
}

export function resume({ sessionId, token, lastSeq } = {}) {
  return {
    type: MSG.RESUME,
    session_id: sessionId,
    token,
    last_seq: lastSeq,
  };
}

export function rename({ sessionId, name } = {}) {
  return {
    type: MSG.RENAME,
    session_id: sessionId,
    name,
  };
}

export function idleWarning({ expiresIn } = {}) {
  return {
    type: MSG.IDLE_WARNING,
    expires_in: expiresIn,
  };
}

export function shutdown({ reason, retryAfter } = {}) {
  const msg = { type: MSG.SHUTDOWN, reason };
  if (retryAfter !== undefined) msg.retry_after = retryAfter;
  return msg;
}

export function snapshot({ label } = {}) {
  return {
    type: MSG.SNAPSHOT,
    label,
  };
}

export function presence({ attachments } = {}) {
  return {
    type: MSG.PRESENCE,
    attachments,
  };
}

export function controlChanged({ newController } = {}) {
  return {
    type: MSG.CONTROL_CHANGED,
    new_controller: newController,
  };
}

export function metrics({ cpu, memory, sessions, rtt } = {}) {
  const msg = { type: MSG.METRICS,  };
  if (cpu !== undefined) msg.cpu = cpu;
  if (memory !== undefined) msg.memory = memory;
  if (sessions !== undefined) msg.sessions = sessions;
  if (rtt !== undefined) msg.rtt = rtt;
  return msg;
}

export function clipboard({ direction, data } = {}) {
  return {
    type: MSG.CLIPBOARD,
    direction,
    data,
  };
}

export function recordingExport({ sessionId, format = "jsonl", data } = {}) {
  const msg = { type: MSG.RECORDING_EXPORT, session_id: sessionId, format };
  if (data !== undefined) msg.data = data;
  return msg;
}

export function commandJournal({ sessionId, command, exitCode, durationMs, cwd, timestamp } = {}) {
  const msg = { type: MSG.COMMAND_JOURNAL, session_id: sessionId, command, timestamp };
  if (exitCode !== undefined) msg.exit_code = exitCode;
  if (durationMs !== undefined) msg.duration_ms = durationMs;
  if (cwd !== undefined) msg.cwd = cwd;
  return msg;
}

export function metricsRequest() {
  return { type: MSG.METRICS_REQUEST };
}

export function suspendSession({ sessionId, action } = {}) {
  return {
    type: MSG.SUSPEND_SESSION,
    session_id: sessionId,
    action,
  };
}

export function restartPty({ sessionId, command } = {}) {
  const msg = { type: MSG.RESTART_PTY, session_id: sessionId };
  if (command !== undefined) msg.command = command;
  return msg;
}

export function mcpDiscover() {
  return { type: MSG.MCP_DISCOVER };
}

export function mcpTools({ tools } = {}) {
  return {
    type: MSG.MCP_TOOLS,
    tools,
  };
}

export function mcpCall({ tool, arguments: args } = {}) {
  return { type: MSG.MCP_CALL, tool, arguments: args };
}

export function mcpResult({ result } = {}) {
  return {
    type: MSG.MCP_RESULT,
    result,
  };
}

export function reverseRegister({ username, capabilities = [], publicKey } = {}) {
  return {
    type: MSG.REVERSE_REGISTER,
    username,
    capabilities,
    public_key: publicKey,
  };
}

export function reverseList() {
  return { type: MSG.REVERSE_LIST };
}

export function reversePeers({ peers } = {}) {
  return {
    type: MSG.REVERSE_PEERS,
    peers,
  };
}

export function reverseConnect({ targetFingerprint, username } = {}) {
  return {
    type: MSG.REVERSE_CONNECT,
    target_fingerprint: targetFingerprint,
    username,
  };
}

export function openTcp({ gatewayId, host, port } = {}) {
  return {
    type: MSG.OPEN_TCP,
    gateway_id: gatewayId,
    host,
    port,
  };
}

export function openUdp({ gatewayId, host, port } = {}) {
  return {
    type: MSG.OPEN_UDP,
    gateway_id: gatewayId,
    host,
    port,
  };
}

export function resolveDns({ gatewayId, name, recordType = "A" } = {}) {
  return {
    type: MSG.RESOLVE_DNS,
    gateway_id: gatewayId,
    name,
    record_type: recordType,
  };
}

export function gatewayOk({ gatewayId, resolvedAddr } = {}) {
  const msg = { type: MSG.GATEWAY_OK, gateway_id: gatewayId };
  if (resolvedAddr !== undefined) msg.resolved_addr = resolvedAddr;
  return msg;
}

export function gatewayFail({ gatewayId, code, message } = {}) {
  return {
    type: MSG.GATEWAY_FAIL,
    gateway_id: gatewayId,
    code,
    message,
  };
}

export function gatewayClose({ gatewayId, reason } = {}) {
  const msg = { type: MSG.GATEWAY_CLOSE, gateway_id: gatewayId };
  if (reason !== undefined) msg.reason = reason;
  return msg;
}

export function inboundOpen({ listenerId, channelId, peerAddr, peerPort } = {}) {
  return {
    type: MSG.INBOUND_OPEN,
    listener_id: listenerId,
    channel_id: channelId,
    peer_addr: peerAddr,
    peer_port: peerPort,
  };
}

export function inboundAccept({ channelId, gatewayId } = {}) {
  const msg = { type: MSG.INBOUND_ACCEPT, channel_id: channelId };
  if (gatewayId !== undefined) msg.gateway_id = gatewayId;
  return msg;
}

export function inboundReject({ channelId, reason } = {}) {
  const msg = { type: MSG.INBOUND_REJECT, channel_id: channelId };
  if (reason !== undefined) msg.reason = reason;
  return msg;
}

export function dnsResult({ gatewayId, addresses, ttl } = {}) {
  const msg = { type: MSG.DNS_RESULT, gateway_id: gatewayId, addresses };
  if (ttl !== undefined) msg.ttl = ttl;
  return msg;
}

export function listenRequest({ listenerId, port, bindAddr = "0.0.0.0" } = {}) {
  return {
    type: MSG.LISTEN_REQUEST,
    listener_id: listenerId,
    port,
    bind_addr: bindAddr,
  };
}

export function listenOk({ listenerId, actualPort } = {}) {
  return {
    type: MSG.LISTEN_OK,
    listener_id: listenerId,
    actual_port: actualPort,
  };
}

export function listenFail({ listenerId, reason } = {}) {
  return {
    type: MSG.LISTEN_FAIL,
    listener_id: listenerId,
    reason,
  };
}

export function listenClose({ listenerId } = {}) {
  return {
    type: MSG.LISTEN_CLOSE,
    listener_id: listenerId,
  };
}

export function gatewayData({ gatewayId, data } = {}) {
  return {
    type: MSG.GATEWAY_DATA,
    gateway_id: gatewayId,
    data,
  };
}

export function guestInvite({ sessionId, ttl, permissions = ["read"] } = {}) {
  return {
    type: MSG.GUEST_INVITE,
    session_id: sessionId,
    ttl,
    permissions,
  };
}

export function guestJoin({ token, deviceLabel } = {}) {
  const msg = { type: MSG.GUEST_JOIN, token };
  if (deviceLabel !== undefined) msg.device_label = deviceLabel;
  return msg;
}

export function guestRevoke({ token, reason } = {}) {
  const msg = { type: MSG.GUEST_REVOKE, token };
  if (reason !== undefined) msg.reason = reason;
  return msg;
}

export function shareSession({ sessionId, mode = "read", ttl } = {}) {
  return {
    type: MSG.SHARE_SESSION,
    session_id: sessionId,
    mode,
    ttl,
  };
}

export function shareRevoke({ shareId, reason } = {}) {
  const msg = { type: MSG.SHARE_REVOKE, share_id: shareId };
  if (reason !== undefined) msg.reason = reason;
  return msg;
}

export function compressBegin({ algorithm, level = 3 } = {}) {
  return {
    type: MSG.COMPRESS_BEGIN,
    algorithm,
    level,
  };
}

export function compressAck({ algorithm, accepted } = {}) {
  return {
    type: MSG.COMPRESS_ACK,
    algorithm,
    accepted,
  };
}

// ── Utility ───────────────────────────────────────────────────────────

/**
 * Get the human-readable name for a message type number.
 * @param {number} typeNum
 * @returns {string}
 */
export function msgName(typeNum) {
  return MSG_NAMES[typeNum] || `UNKNOWN(0x${typeNum.toString(16)})`;
}

/**
 * Validate that a message has a recognized type field.
 * @param {object} msg
 * @returns {boolean}
 */
export function isValidMessage(msg) {
  return msg != null && typeof msg === 'object' && typeof msg.type === 'number' && msg.type in MSG_NAMES;
}
