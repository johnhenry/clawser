// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-trust.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TrustGraph, TRUST_CATEGORIES, createTrustEdge, computeTransitiveTrust } from '../clawser-mesh-trust.js';

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

describe('Re-exports', () => {
  it('TRUST_CATEGORIES has expected keys and values', () => {
    assert.equal(TRUST_CATEGORIES.DIRECT, 'direct');
    assert.equal(TRUST_CATEGORIES.TRANSITIVE, 'transitive');
    assert.equal(TRUST_CATEGORIES.MEMBERSHIP, 'membership');
    assert.equal(TRUST_CATEGORIES.REPUTATION, 'reputation');
  });

  it('TRUST_CATEGORIES is frozen', () => {
    assert.ok(Object.isFrozen(TRUST_CATEGORIES));
  });

  it('createTrustEdge returns a frozen edge', () => {
    const edge = createTrustEdge({ from: 'a', to: 'b', category: 'direct', value: 0.5 });
    assert.ok(Object.isFrozen(edge));
    assert.equal(edge.from, 'a');
    assert.equal(edge.to, 'b');
    assert.equal(edge.value, 0.5);
  });

  it('computeTransitiveTrust is a function', () => {
    assert.equal(typeof computeTransitiveTrust, 'function');
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.addEdge
// ---------------------------------------------------------------------------

describe('TrustGraph.addEdge', () => {
  let tg;
  beforeEach(() => {
    tg = new TrustGraph();
  });

  it('creates an edge and increases size', () => {
    const edge = tg.addEdge('a', 'b', 0.8);
    assert.equal(tg.size, 1);
    assert.equal(edge.from, 'a');
    assert.equal(edge.to, 'b');
    assert.equal(edge.value, 0.8);
    assert.equal(edge.category, TRUST_CATEGORIES.DIRECT);
  });

  it('returns a frozen TrustEdge', () => {
    const edge = tg.addEdge('a', 'b', 0.5);
    assert.ok(Object.isFrozen(edge));
  });

  it('accepts custom category and timestamp via opts', () => {
    const edge = tg.addEdge('a', 'b', 0.6, [], {
      category: TRUST_CATEGORIES.MEMBERSHIP,
      timestamp: 1234,
    });
    assert.equal(edge.category, 'membership');
    assert.equal(edge.timestamp, 1234);
  });

  it('throws RangeError for level below 0', () => {
    assert.throws(() => tg.addEdge('a', 'b', -0.1), RangeError);
  });

  it('throws RangeError for level above 1', () => {
    assert.throws(() => tg.addEdge('a', 'b', 1.5), RangeError);
  });

  it('throws RangeError for non-numeric level', () => {
    assert.throws(() => tg.addEdge('a', 'b', 'high'), RangeError);
  });

  it('accepts boundary values 0.0 and 1.0', () => {
    tg.addEdge('a', 'b', 0.0);
    tg.addEdge('c', 'd', 1.0);
    assert.equal(tg.size, 2);
    assert.equal(tg.getEdge('a', 'b').value, 0);
    assert.equal(tg.getEdge('c', 'd').value, 1);
  });

  it('replaces existing edge between same pair', () => {
    tg.addEdge('a', 'b', 0.3);
    tg.addEdge('a', 'b', 0.9);
    assert.equal(tg.size, 1);
    assert.equal(tg.getEdge('a', 'b').value, 0.9);
  });

  it('stores scopes with the edge', () => {
    tg.addEdge('a', 'b', 0.5, ['code', 'data']);
    assert.deepEqual(tg.getEdgeScopes('a', 'b'), ['code', 'data']);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.removeEdge
// ---------------------------------------------------------------------------

describe('TrustGraph.removeEdge', () => {
  let tg;
  beforeEach(() => {
    tg = new TrustGraph();
    tg.addEdge('a', 'b', 0.7);
    tg.addEdge('b', 'c', 0.5);
  });

  it('removes an existing edge and returns true', () => {
    assert.equal(tg.removeEdge('a', 'b'), true);
    assert.equal(tg.size, 1);
    assert.equal(tg.getEdge('a', 'b'), null);
  });

  it('returns false when edge does not exist', () => {
    assert.equal(tg.removeEdge('x', 'y'), false);
    assert.equal(tg.size, 2);
  });

  it('does not affect other edges', () => {
    tg.removeEdge('a', 'b');
    assert.notEqual(tg.getEdge('b', 'c'), null);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.getEdge
// ---------------------------------------------------------------------------

describe('TrustGraph.getEdge', () => {
  let tg;
  beforeEach(() => {
    tg = new TrustGraph();
    tg.addEdge('a', 'b', 0.6, ['code']);
  });

  it('returns the edge for an existing pair', () => {
    const edge = tg.getEdge('a', 'b');
    assert.notEqual(edge, null);
    assert.equal(edge.from, 'a');
    assert.equal(edge.to, 'b');
    assert.equal(edge.value, 0.6);
  });

  it('returns null for the reverse direction', () => {
    assert.equal(tg.getEdge('b', 'a'), null);
  });

  it('returns null for completely unknown nodes', () => {
    assert.equal(tg.getEdge('x', 'y'), null);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.getEdgeScopes
// ---------------------------------------------------------------------------

describe('TrustGraph.getEdgeScopes', () => {
  let tg;
  beforeEach(() => {
    tg = new TrustGraph();
    tg.addEdge('a', 'b', 0.5, ['code', 'data']);
    tg.addEdge('c', 'd', 0.4);
  });

  it('returns scopes for existing edge', () => {
    assert.deepEqual(tg.getEdgeScopes('a', 'b'), ['code', 'data']);
  });

  it('returns empty array for edge with no scopes', () => {
    assert.deepEqual(tg.getEdgeScopes('c', 'd'), []);
  });

  it('returns empty array for missing edge', () => {
    assert.deepEqual(tg.getEdgeScopes('x', 'y'), []);
  });

  it('returns a copy (mutations do not leak back)', () => {
    const scopes = tg.getEdgeScopes('a', 'b');
    scopes.push('extra');
    assert.deepEqual(tg.getEdgeScopes('a', 'b'), ['code', 'data']);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.getTrustLevel
// ---------------------------------------------------------------------------

describe('TrustGraph.getTrustLevel', () => {
  let tg;
  beforeEach(() => {
    tg = new TrustGraph();
  });

  it('returns direct trust when edge exists', () => {
    tg.addEdge('a', 'b', 0.8);
    assert.equal(tg.getTrustLevel('a', 'b'), 0.8);
  });

  it('returns 0 when no path exists', () => {
    tg.addEdge('a', 'b', 0.8);
    assert.equal(tg.getTrustLevel('b', 'a'), 0);
  });

  it('computes transitive trust through intermediary', () => {
    tg.addEdge('a', 'b', 0.8);
    tg.addEdge('b', 'c', 0.5);
    const level = tg.getTrustLevel('a', 'c');
    assert.ok(Math.abs(level - 0.4) < 1e-10);
  });

  it('prefers direct edge over transitive path', () => {
    tg.addEdge('a', 'c', 0.95);
    tg.addEdge('a', 'b', 0.9);
    tg.addEdge('b', 'c', 0.9);
    // Direct is 0.95, transitive would be 0.81
    assert.equal(tg.getTrustLevel('a', 'c'), 0.95);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.getTransitiveTrust
// ---------------------------------------------------------------------------

describe('TrustGraph.getTransitiveTrust', () => {
  let tg;
  beforeEach(() => {
    tg = new TrustGraph();
  });

  it('returns level and direct=true for direct edge', () => {
    tg.addEdge('a', 'b', 0.9);
    const result = tg.getTransitiveTrust('a', 'b');
    assert.equal(result.level, 0.9);
    assert.equal(result.direct, true);
  });

  it('returns level and direct=false for transitive path', () => {
    tg.addEdge('a', 'b', 0.8);
    tg.addEdge('b', 'c', 0.5);
    const result = tg.getTransitiveTrust('a', 'c');
    assert.ok(Math.abs(result.level - 0.4) < 1e-10);
    assert.equal(result.direct, false);
  });

  it('returns level=0 and direct=false when no path exists', () => {
    const result = tg.getTransitiveTrust('x', 'y');
    assert.equal(result.level, 0);
    assert.equal(result.direct, false);
  });

  it('respects maxDepth parameter', () => {
    tg.addEdge('a', 'b', 0.9);
    tg.addEdge('b', 'c', 0.9);
    tg.addEdge('c', 'd', 0.9);
    // maxDepth=2: a->b->c->d requires 3 hops, should fail
    const shallow = tg.getTransitiveTrust('a', 'd', 2);
    assert.equal(shallow.level, 0);
    // maxDepth=3: should find the path
    const deep = tg.getTransitiveTrust('a', 'd', 3);
    assert.ok(deep.level > 0);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.getTrustedPeers
// ---------------------------------------------------------------------------

describe('TrustGraph.getTrustedPeers', () => {
  let tg;
  beforeEach(() => {
    tg = new TrustGraph();
    tg.addEdge('a', 'b', 0.8, ['code']);
    tg.addEdge('a', 'c', 0.3, ['data']);
    tg.addEdge('a', 'd', 0.05, ['code']);
    tg.addEdge('b', 'e', 0.9);
  });

  it('returns peers above default minLevel', () => {
    const peers = tg.getTrustedPeers('a');
    assert.deepEqual(peers.sort(), ['b', 'c', 'd']);
  });

  it('filters by minLevel', () => {
    const peers = tg.getTrustedPeers('a', 0.5);
    assert.deepEqual(peers, ['b']);
  });

  it('filters by scope', () => {
    const peers = tg.getTrustedPeers('a', 0.01, 'code');
    assert.deepEqual(peers.sort(), ['b', 'd']);
  });

  it('returns empty for unknown fromId', () => {
    assert.deepEqual(tg.getTrustedPeers('unknown'), []);
  });

  it('includes edges with empty scopes when filtering by scope', () => {
    // b->e has no scopes, so it is unrestricted
    const peers = tg.getTrustedPeers('b', 0.01, 'anything');
    assert.deepEqual(peers, ['e']);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.isTrusted
// ---------------------------------------------------------------------------

describe('TrustGraph.isTrusted', () => {
  let tg;
  beforeEach(() => {
    tg = new TrustGraph();
    tg.addEdge('a', 'b', 0.8, ['code']);
    tg.addEdge('a', 'c', 0.1, ['data']);
  });

  it('returns true when trust exceeds default threshold', () => {
    assert.equal(tg.isTrusted('a', 'b'), true);
  });

  it('returns false when trust below default threshold (0.25)', () => {
    assert.equal(tg.isTrusted('a', 'c'), false);
  });

  it('respects custom minLevel', () => {
    assert.equal(tg.isTrusted('a', 'c', null, 0.05), true);
  });

  it('checks scope when provided -- matching scope', () => {
    assert.equal(tg.isTrusted('a', 'b', 'code'), true);
  });

  it('checks scope when provided -- non-matching scope', () => {
    assert.equal(tg.isTrusted('a', 'b', 'data'), false);
  });

  it('returns true for unrestricted edge with any scope query', () => {
    tg.addEdge('a', 'd', 0.8);
    assert.equal(tg.isTrusted('a', 'd', 'anything', 0.1), true);
  });

  it('returns false for unknown pair', () => {
    assert.equal(tg.isTrusted('x', 'y'), false);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.getReputation
// ---------------------------------------------------------------------------

describe('TrustGraph.getReputation', () => {
  let tg;
  beforeEach(() => {
    tg = new TrustGraph();
    tg.addEdge('a', 'target', 0.8, ['code']);
    tg.addEdge('b', 'target', 0.6, ['data']);
    tg.addEdge('c', 'target', 0.4);
  });

  it('returns correct trustCount', () => {
    const rep = tg.getReputation('target');
    assert.equal(rep.trustCount, 3);
  });

  it('computes correct avgLevel', () => {
    const rep = tg.getReputation('target');
    const expected = (0.8 + 0.6 + 0.4) / 3;
    assert.ok(Math.abs(rep.avgLevel - expected) < 1e-10);
  });

  it('returns union of all inbound scopes', () => {
    const rep = tg.getReputation('target');
    assert.deepEqual(rep.scopes.sort(), ['code', 'data']);
  });

  it('returns zeros for unknown peer', () => {
    const rep = tg.getReputation('nobody');
    assert.equal(rep.trustCount, 0);
    assert.equal(rep.avgLevel, 0);
    assert.deepEqual(rep.scopes, []);
  });

  it('handles single inbound edge', () => {
    const tg2 = new TrustGraph();
    tg2.addEdge('x', 'y', 1.0);
    const rep = tg2.getReputation('y');
    assert.equal(rep.trustCount, 1);
    assert.equal(rep.avgLevel, 1.0);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.pruneExpired
// ---------------------------------------------------------------------------

describe('TrustGraph.pruneExpired', () => {
  let tg;
  beforeEach(() => {
    tg = new TrustGraph();
  });

  it('removes edges whose expires <= now', () => {
    tg.addEdge('a', 'b', 0.5, [], { expires: 500 });
    tg.addEdge('a', 'c', 0.5, [], { expires: 1000 });
    tg.addEdge('a', 'd', 0.5, [], { expires: 2000 });
    const pruned = tg.pruneExpired(1000);
    assert.equal(pruned, 2);
    assert.equal(tg.size, 1);
    assert.notEqual(tg.getEdge('a', 'd'), null);
  });

  it('does not remove edges with no expiration', () => {
    tg.addEdge('a', 'b', 0.5);
    assert.equal(tg.pruneExpired(), 0);
    assert.equal(tg.size, 1);
  });

  it('returns 0 when nothing to prune', () => {
    tg.addEdge('a', 'b', 0.5, [], { expires: Date.now() + 100000 });
    assert.equal(tg.pruneExpired(), 0);
  });

  it('removes all edges when all expired', () => {
    tg.addEdge('a', 'b', 0.5, [], { expires: 100 });
    tg.addEdge('c', 'd', 0.5, [], { expires: 200 });
    const pruned = tg.pruneExpired(1000);
    assert.equal(pruned, 2);
    assert.equal(tg.size, 0);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.size
// ---------------------------------------------------------------------------

describe('TrustGraph.size', () => {
  it('starts at 0', () => {
    const tg = new TrustGraph();
    assert.equal(tg.size, 0);
  });

  it('tracks additions and removals', () => {
    const tg = new TrustGraph();
    tg.addEdge('a', 'b', 0.5);
    tg.addEdge('a', 'c', 0.5);
    assert.equal(tg.size, 2);
    tg.removeEdge('a', 'b');
    assert.equal(tg.size, 1);
  });
});

// ---------------------------------------------------------------------------
// TrustGraph.toJSON / static fromJSON round-trip
// ---------------------------------------------------------------------------

describe('TrustGraph.toJSON / fromJSON', () => {
  it('round-trips edges with scopes, category, and expires', () => {
    const tg = new TrustGraph();
    tg.addEdge('a', 'b', 0.8, ['code'], {
      category: TRUST_CATEGORIES.DIRECT,
      timestamp: 1000,
      expires: 9999,
    });
    tg.addEdge('b', 'c', 0.6, ['data'], {
      category: TRUST_CATEGORIES.TRANSITIVE,
    });

    const json = tg.toJSON();
    const tg2 = TrustGraph.fromJSON(json);

    assert.equal(tg2.size, 2);

    const eAB = tg2.getEdge('a', 'b');
    assert.equal(eAB.value, 0.8);
    assert.equal(eAB.category, 'direct');
    assert.equal(eAB.timestamp, 1000);
    assert.deepEqual(tg2.getEdgeScopes('a', 'b'), ['code']);

    const eBC = tg2.getEdge('b', 'c');
    assert.equal(eBC.value, 0.6);
    assert.equal(eBC.category, 'transitive');
    assert.deepEqual(tg2.getEdgeScopes('b', 'c'), ['data']);
  });

  it('toJSON returns a plain array with correct shape', () => {
    const tg = new TrustGraph();
    tg.addEdge('a', 'b', 0.7, ['x']);
    const json = tg.toJSON();
    assert.ok(Array.isArray(json));
    assert.equal(json.length, 1);
    assert.equal(json[0].from, 'a');
    assert.equal(json[0].to, 'b');
    assert.equal(json[0].value, 0.7);
    assert.deepEqual(json[0].scopes, ['x']);
    assert.equal(typeof json[0].timestamp, 'number');
  });

  it('fromJSON handles empty array', () => {
    const tg = TrustGraph.fromJSON([]);
    assert.equal(tg.size, 0);
  });

  it('preserves category through round-trip', () => {
    const tg = new TrustGraph();
    tg.addEdge('a', 'b', 0.5, [], { category: TRUST_CATEGORIES.REPUTATION });
    const json = tg.toJSON();
    assert.equal(json[0].category, TRUST_CATEGORIES.REPUTATION);
    const tg2 = TrustGraph.fromJSON(json);
    assert.equal(tg2.getEdge('a', 'b').category, TRUST_CATEGORIES.REPUTATION);
  });

  it('preserves expires through round-trip (verified via pruneExpired)', () => {
    const tg = new TrustGraph();
    tg.addEdge('a', 'b', 0.5, [], { expires: 5000 });
    const json = tg.toJSON();
    const tg2 = TrustGraph.fromJSON(json);
    // Pruning before expiry keeps the edge
    assert.equal(tg2.pruneExpired(4000), 0);
    // Pruning after expiry removes it
    assert.equal(tg2.pruneExpired(6000), 1);
  });
});
