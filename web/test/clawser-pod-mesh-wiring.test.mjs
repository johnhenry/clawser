// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-pod-mesh-wiring.test.mjs
//
// Pins that ClawserPod.initMesh() instantiates and exposes the mesh
// subsystems that the browsermesh specs claimed were "Implemented, not wired
// to app bootstrap": MeshNameResolver, MigrationEngine, AppRegistry/AppStore,
// and (when relayUrl is configured) MeshRelayClient.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { ClawserPod } from '../clawser-pod.js';

class StubBroadcastChannel {
  constructor(name) { this.name = name; this.onmessage = null; }
  postMessage() {}
  close() {}
}
if (!globalThis.BroadcastChannel) globalThis.BroadcastChannel = StubBroadcastChannel;

describe('ClawserPod.initMesh — accessors are populated', () => {
  let pod;

  after(async () => {
    if (pod && typeof pod.shutdown === 'function') {
      try { await pod.shutdown(); } catch { /* best-effort */ }
    }
  });

  it('exposes nameResolver, migrationEngine, appRegistry, appStore after initMesh', async () => {
    pod = new ClawserPod();
    await pod.initMesh({});

    // B1 — MeshNameResolver
    assert.ok(pod.nameResolver, 'nameResolver should be set after initMesh');
    assert.equal(typeof pod.nameResolver.register, 'function');
    assert.equal(typeof pod.nameResolver.resolve, 'function');

    // B2 — MigrationEngine
    assert.ok(pod.migrationEngine, 'migrationEngine should be set after initMesh');

    // B4 — AppRegistry + AppStore
    assert.ok(pod.appRegistry, 'appRegistry should be set after initMesh');
    assert.ok(pod.appStore, 'appStore should be set after initMesh');

    // B3 — MeshRelayClient is intentionally absent without relayUrl
    assert.equal(pod.relayClient, null, 'relayClient should be null without relayUrl');
  });

  it('instantiates MeshRelayClient when relayUrl is provided', async () => {
    const otherPod = new ClawserPod();
    try {
      await otherPod.initMesh({ relayUrl: 'wss://test.invalid' });
      assert.ok(otherPod.relayClient, 'relayClient should be present with relayUrl');
    } finally {
      try { await otherPod.shutdown(); } catch { /* best-effort */ }
    }
  });

  it('exposes consensusManager (B5 — voting protocol)', async () => {
    const cmPod = new ClawserPod();
    try {
      await cmPod.initMesh({});
      assert.ok(cmPod.consensusManager, 'consensusManager should be set after initMesh');
      assert.equal(typeof cmPod.consensusManager.propose, 'function');
    } finally {
      try { await cmPod.shutdown(); } catch { /* best-effort */ }
    }
  });

  it('exposes sendMessage (A3 — unicast)', async () => {
    const sendPod = new ClawserPod();
    try {
      await sendPod.initMesh({});
      assert.equal(typeof sendPod.sendMessage, 'function');

      // No active session → clear error
      await assert.rejects(
        () => sendPod.sendMessage('nonexistent-peer', { type: 'ping' }),
        /no active session/,
      );

      // Empty peerId → clear error
      await assert.rejects(
        () => sendPod.sendMessage('', { type: 'ping' }),
        /peerId required/,
      );
    } finally {
      try { await sendPod.shutdown(); } catch { /* best-effort */ }
    }
  });

  it('peerNode.sendTo routes through an active session', async () => {
    const p = new ClawserPod();
    try {
      await p.initMesh({});
      const peerNode = p.peerNode;
      assert.equal(typeof peerNode.sendTo, 'function');
      assert.equal(typeof peerNode.hasActiveSession, 'function');

      // No active session for an arbitrary podId
      assert.equal(peerNode.hasActiveSession('made-up-peer'), false);
      await assert.rejects(
        () => peerNode.sendTo('made-up-peer', 'data'),
        /no active session/,
      );
    } finally {
      try { await p.shutdown(); } catch { /* best-effort */ }
    }
  });
});
