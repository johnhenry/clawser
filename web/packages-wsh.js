/**
 * Local re-export of wsh for browser use.
 * Maps `import { WshClient } from './packages-wsh.js'` to the local package.
 */
export {
  // CBOR codec + framing
  cborEncode, cborDecode, frameEncode, FrameDecoder,

  // Protocol messages
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

  // Auth + crypto
  generateKeyPair, exportPublicKeyRaw, exportPublicKeySSH,
  importPublicKeyRaw, exportPrivateKeyPKCS8, importPrivateKeyPKCS8,
  sign, verify, buildTranscript, signChallenge, verifyChallenge,
  fingerprint, shortFingerprint, generateNonce,
  parseSSHPublicKey, extractRawFromSSHWire, base64Decode,

  // Transport
  WshTransport, WebTransportTransport,
  WebSocketTransport,

  // Session + Client
  WshSession,
  WshClient,

  // Key storage
  WshKeyStore,

  // File transfer
  WshFileTransfer,

  // Session recording
  SessionRecorder, SessionPlayer,

  // MCP bridge
  WshMcpBridge,
} from './packages/wsh/src/index.mjs';
