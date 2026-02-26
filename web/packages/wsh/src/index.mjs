/**
 * wsh — Web Shell client library
 *
 * Browser-native remote command execution over WebTransport/WebSocket
 * with Ed25519 authentication.
 */

// CBOR codec + framing
export { cborEncode, cborDecode, frameEncode, FrameDecoder } from './cbor.mjs';

// Protocol messages
export {
  MSG, MSG_NAMES, CHANNEL_KIND, AUTH_METHOD, PROTOCOL_VERSION,
  hello, serverHello, challenge, authMethods, auth, authOk, authFail,
  open, openOk, openFail, resize, signal, exit, close, error, ping, pong,
  attach, resume, rename, idleWarning, shutdown, snapshot,
  presence, controlChanged, metrics,
  mcpDiscover, mcpTools, mcpCall, mcpResult,
  reverseRegister, reverseList, reversePeers, reverseConnect,
  openTcp, openUdp, resolveDns, gatewayOk, gatewayFail, gatewayClose,
  inboundOpen, inboundAccept, inboundReject, dnsResult,
  listenRequest, listenOk, listenFail, listenClose,
  msgName, isValidMessage,
} from './messages.mjs';

// Auth + crypto
export {
  generateKeyPair, exportPublicKeyRaw, exportPublicKeySSH,
  importPublicKeyRaw, exportPrivateKeyPKCS8, importPrivateKeyPKCS8,
  sign, verify, buildTranscript, signChallenge, verifyChallenge,
  fingerprint, shortFingerprint, generateNonce,
  parseSSHPublicKey, extractRawFromSSHWire, base64Decode,
} from './auth.mjs';

// Transport
export { WshTransport, WebTransportTransport } from './transport.mjs';
export { WebSocketTransport } from './transport-ws.mjs';

// Session + Client
export { WshSession } from './session.mjs';
export { WshClient } from './client.mjs';

// Key storage
export { WshKeyStore } from './keystore.mjs';

// File transfer
export { WshFileTransfer } from './file-transfer.mjs';

// Session recording
export { SessionRecorder, SessionPlayer } from './recording.mjs';

// MCP bridge
export { WshMcpBridge } from './mcp-bridge.mjs';
