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

export function attach({ sessionId, token, mode = "control" } = {}) {
  return {
    type: MSG.ATTACH,
    session_id: sessionId,
    token,
    mode,
  };
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
