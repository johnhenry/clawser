/**
 * Re-export bridge for the mesh-primitives package.
 * In development: resolves via node_modules (npm install browsermesh-primitives).
 * In browser: resolves via import map (esm.sh/browsermesh-primitives).
 */
export {
  // Constants
  MESH_TYPE, MESH_ERROR,

  // Errors
  MeshError, MeshProtocolError, MeshCapabilityError,

  // Identity
  PodIdentity, derivePodId, encodeBase64url, decodeBase64url,

  // Wire format
  messageTypeRegistry, encodeMeshMessage, decodeMeshMessage,

  // Capabilities
  parseScope, matchScope, CapabilityToken,

  // Trust
  TRUST_CATEGORIES, createTrustEdge, computeTransitiveTrust,

  // ACL
  matchResourcePattern, Permission, AccessGrant, ACLEngine, generateGrantId,

  // CRDTs
  VectorClock, LWWRegister, GCounter, PNCounter, ORSet, RGA, LWWMap,

  // Test transport
  DeterministicRNG, LocalChannel, createLocalChannelPair, TestMesh, TESTMESH_LIMITS,
} from 'browsermesh-primitives';
