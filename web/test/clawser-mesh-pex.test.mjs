// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-pex.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { PexStrategy, DiscoveryRecord } from '../clawser-mesh-discovery.js';

// ── Construction ────────────────────────────────────────────────────

describe('PexStrategy construction', () => {
  it('sets type to pex', () => {
    const pex = new PexStrategy({ localId: 'pod-a' });
    assert.equal(pex.type, 'pex');
  });

  it('throws without localId', () => {
    assert.throws(() => new PexStrategy({}), /localId/);
  });

  it('starts inactive', () => {
    const pex = new PexStrategy({ localId: 'pod-a' });
    assert.equal(pex.active, false);
  });
});

// ── Lifecycle ───────────────────────────────────────────────────────

describe('PexStrategy lifecycle', () => {
  let pex;

  beforeEach(() => {
    pex = new PexStrategy({ localId: 'local', exchangeIntervalMs: 100 });
  });

  afterEach(() => {
    pex.stop();
  });

  it('start activates', async () => {
    await pex.start();
    assert.equal(pex.active, true);
  });

  it('stop deactivates and clears state', async () => {
    await pex.start();
    pex.addPeer('peer-1', () => {});
    await pex.stop();
    assert.equal(pex.active, false);
    assert.equal(pex.connectedCount, 0);
    assert.deepEqual(pex.knownPeers(), []);
  });

  it('start is idempotent', async () => {
    await pex.start();
    await pex.start();
    assert.equal(pex.active, true);
  });
});

// ── Peer Exchange ───────────────────────────────────────────────────

describe('PexStrategy peer exchange', () => {
  let pex;
  let sent;

  beforeEach(() => {
    sent = [];
    pex = new PexStrategy({ localId: 'local' });
  });

  afterEach(() => {
    pex.stop();
  });

  it('addPeer sends exchange immediately', () => {
    pex.addPeer('peer-1', (msg) => sent.push(msg));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'pex-exchange');
    assert.equal(sent[0].from, 'local');
    assert.ok(Array.isArray(sent[0].peers));
    assert.ok(sent[0].peers.includes('peer-1'));
  });

  it('addPeer fires discovered callback', () => {
    const discovered = [];
    pex.onDiscovered((record) => discovered.push(record));
    pex.addPeer('peer-1', () => {});
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].podId, 'peer-1');
    assert.equal(discovered[0].source, 'pex');
  });

  it('addPeer ignores self', () => {
    const discovered = [];
    pex.onDiscovered((record) => discovered.push(record));
    pex.addPeer('local', () => {});
    assert.equal(discovered.length, 0);
  });

  it('addPeer is idempotent for discovery', () => {
    const discovered = [];
    pex.onDiscovered((record) => discovered.push(record));
    pex.addPeer('peer-1', () => {});
    pex.addPeer('peer-1', () => {});
    assert.equal(discovered.length, 1); // only fires once
  });

  it('handleMessage discovers new peers from exchange', () => {
    const discovered = [];
    pex.onDiscovered((record) => discovered.push(record));

    pex.handleMessage('peer-1', {
      type: 'pex-exchange',
      from: 'peer-1',
      peers: ['peer-2', 'peer-3', 'local'],
    });

    // Should discover peer-2 and peer-3 (not local)
    assert.equal(discovered.length, 2);
    assert.ok(discovered.some(r => r.podId === 'peer-2'));
    assert.ok(discovered.some(r => r.podId === 'peer-3'));
  });

  it('handleMessage ignores already known peers', () => {
    const discovered = [];
    pex.onDiscovered((record) => discovered.push(record));

    pex.addPeer('peer-1', () => {});
    discovered.length = 0; // clear

    pex.handleMessage('peer-1', {
      type: 'pex-exchange',
      from: 'peer-1',
      peers: ['peer-1', 'peer-2'],
    });

    // Only peer-2 is new
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].podId, 'peer-2');
  });

  it('handleMessage ignores non-pex messages', () => {
    const discovered = [];
    pex.onDiscovered((record) => discovered.push(record));
    pex.handleMessage('peer-1', { type: 'other', peers: ['x'] });
    assert.equal(discovered.length, 0);
  });

  it('removePeer clears transport but keeps discovery record', () => {
    pex.addPeer('peer-1', () => {});
    assert.equal(pex.connectedCount, 1);
    pex.removePeer('peer-1');
    assert.equal(pex.connectedCount, 0);
    // Still known as a peer
    assert.ok(pex.knownPeers().includes('peer-1'));
  });

  it('query returns known peers', async () => {
    pex.addPeer('peer-1', () => {});
    pex.handleMessage('peer-1', {
      type: 'pex-exchange',
      from: 'peer-1',
      peers: ['peer-2'],
    });

    const results = await pex.query();
    assert.equal(results.length, 2);
  });
});

// ── Transitive Discovery ────────────────────────────────────────────

describe('PexStrategy transitive discovery', () => {
  it('peer A discovers peer C through peer B', () => {
    const sentA = [];
    const sentB = [];
    const pexA = new PexStrategy({ localId: 'pod-a' });
    const pexB = new PexStrategy({ localId: 'pod-b' });

    const discoveredByA = [];
    const discoveredByB = [];
    pexA.onDiscovered((r) => discoveredByA.push(r));
    pexB.onDiscovered((r) => discoveredByB.push(r));

    // B already knows about C
    pexB.handleMessage('pod-c', {
      type: 'pex-exchange',
      from: 'pod-c',
      peers: ['pod-c'],
    });

    // A connects to B — they exchange peer lists
    pexA.addPeer('pod-b', (msg) => {
      sentA.push(msg);
      // Forward to B
      pexB.handleMessage('pod-a', msg);
    });
    pexB.addPeer('pod-a', (msg) => {
      sentB.push(msg);
      // Forward to A
      pexA.handleMessage('pod-b', msg);
    });

    // A should now know about C (discovered transitively via B)
    assert.ok(
      discoveredByA.some(r => r.podId === 'pod-c'),
      'A should discover C through B'
    );

    pexA.stop();
    pexB.stop();
  });
});

// ── Periodic Exchange ───────────────────────────────────────────────

describe('PexStrategy periodic exchange', () => {
  it('exchanges peer lists on interval', async () => {
    const sent = [];
    const pex = new PexStrategy({ localId: 'local', exchangeIntervalMs: 50 });
    pex.addPeer('peer-1', (msg) => sent.push(msg));
    sent.length = 0; // clear initial exchange

    await pex.start();
    await new Promise(r => setTimeout(r, 120));
    pex.stop();

    // Should have sent at least 1 periodic exchange
    const exchanges = sent.filter(m => m.type === 'pex-exchange');
    assert.ok(exchanges.length >= 1, `Expected periodic exchanges, got ${exchanges.length}`);
  });
});
