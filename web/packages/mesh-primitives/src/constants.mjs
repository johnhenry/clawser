/**
 * BrowserMesh wire format type codes.
 * Reserved range: 0xA0–0xBF for mesh-specific message types.
 *
 * @enum {number}
 */
export const MESH_TYPE = Object.freeze({
  /** Pod-to-pod unicast message */
  UNICAST: 0xa0,
  /** Broadcast to all connected pods */
  BROADCAST: 0xa1,
  /** Capability grant envelope */
  CAP_GRANT: 0xa2,
  /** Capability revocation */
  CAP_REVOKE: 0xa3,
  /** Trust attestation */
  TRUST_ATTEST: 0xa4,
  /** Identity announcement (join) */
  IDENTITY_ANNOUNCE: 0xa5,
  /** Identity departure (leave) */
  IDENTITY_DEPART: 0xa6,
  /** CRDT sync frame */
  CRDT_SYNC: 0xa7,
  /** Consensus proposal */
  CONSENSUS_PROPOSE: 0xa8,
  /** Consensus vote */
  CONSENSUS_VOTE: 0xa9,
  /** Resource claim */
  RESOURCE_CLAIM: 0xaa,
  /** Resource release */
  RESOURCE_RELEASE: 0xab,

  // ── ACL operations ──────────────────────────────────────────────────
  /** Grant access to identity */
  ACL_GRANT: 0xac,
  /** Revoke access */
  ACL_REVOKE: 0xad,
  /** Invitation token */
  ACL_INVITE: 0xae,

  // ── Chat protocol ───────────────────────────────────────────────────
  /** Join room */
  CHAT_JOIN: 0xb0,
  /** Leave room */
  CHAT_LEAVE: 0xb1,
  /** Typing/presence update */
  CHAT_PRESENCE: 0xb2,
  /** Moderation action */
  CHAT_MODERATE: 0xb3,

  // ── Stream operations ──────────────────────────────────────────────
  /** Named stream open request */
  STREAM_OPEN: 0xaf,

  // ── Name resolution ─────────────────────────────────────────────────
  /** Register/renew a name */
  NAME_REGISTER: 0xb5,
  /** Resolve a name query */
  NAME_RESOLVE: 0xb6,
  /** Transfer name ownership */
  NAME_TRANSFER: 0xb7,

  // ── File transfer ─────────────────────────────────────────────────
  /** Transfer offer */
  FILE_OFFER: 0xb8,
  /** Accept transfer */
  FILE_ACCEPT: 0xb9,
  /** Reject transfer */
  FILE_REJECT: 0xba,
  /** Progress update */
  FILE_PROGRESS: 0xbb,
  /** Transfer complete */
  FILE_COMPLETE: 0xbc,
  /** Cancel transfer */
  FILE_CANCEL: 0xbd,

  /** Ping / keepalive */
  PING: 0xbe,
  /** Pong / keepalive response */
  PONG: 0xbf,
});

/**
 * Error codes for mesh protocol errors.
 *
 * @enum {number}
 */
export const MESH_ERROR = Object.freeze({
  /** Unknown or unclassified error */
  UNKNOWN: 0,
  /** Invalid wire format / decode failure */
  INVALID_FORMAT: 1,
  /** Capability check failed */
  CAPABILITY_DENIED: 2,
  /** Identity verification failed */
  IDENTITY_INVALID: 3,
  /** Trust threshold not met */
  TRUST_INSUFFICIENT: 4,
  /** Message expired (TTL exceeded) */
  MESSAGE_EXPIRED: 5,
  /** Resource unavailable */
  RESOURCE_UNAVAILABLE: 6,
  /** Consensus quorum not reached */
  QUORUM_NOT_REACHED: 7,
  /** ACL denied */
  ACL_DENIED: 8,
  /** Name already taken */
  NAME_TAKEN: 9,
  /** Name not found */
  NAME_NOT_FOUND: 10,
  /** Name expired */
  NAME_EXPIRED: 11,
  /** Room is full */
  ROOM_FULL: 12,
  /** Identity is banned */
  BANNED: 13,
  /** Stream closed */
  STREAM_CLOSED: 14,
  /** Stream limit exceeded */
  STREAM_LIMIT: 15,
  /** Transfer rejected */
  TRANSFER_REJECTED: 16,
  /** Transfer failed */
  TRANSFER_FAILED: 17,
  /** Chunk invalid */
  CHUNK_INVALID: 18,
});
