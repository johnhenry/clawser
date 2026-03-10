// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-ui-remote-runtime.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createReachabilityDescriptor,
  createRemoteIdentity,
  createRemotePeerDescriptor,
  supportHintsForRuntime,
} from '../clawser-remote-runtime-types.js';
import { RemoteRuntimeRegistry } from '../clawser-remote-runtime-registry.js';
import {
  renderRemoteRuntimePanel,
  renderRemoteServiceList,
} from '../clawser-ui-remote.js';

function makeRegistry() {
  const registry = new RemoteRuntimeRegistry();
  registry.ingestDescriptor(createRemotePeerDescriptor({
    identity: createRemoteIdentity({
      canonicalId: 'host:alpha',
      fingerprint: 'df46c9c7abcdef0123456789abcdef01',
      aliases: ['@alpha'],
    }),
    username: 'alpha',
    peerType: 'host',
    shellBackend: 'pty',
    capabilities: ['shell', 'exec', 'fs', 'tools'],
    reachability: [
      createReachabilityDescriptor({
        kind: 'direct-host',
        source: 'direct-bookmark',
        endpoint: 'alpha.local:4422',
        lastSeen: Date.now(),
      }),
    ],
    metadata: {
      serviceDetails: {
        ssh: {
          name: 'ssh',
          type: 'terminal',
          podId: 'alpha-pod',
          address: 'mesh://alpha/ssh',
        },
      },
    },
  }));
  registry.ingestDescriptor(createRemotePeerDescriptor({
    identity: createRemoteIdentity({
      canonicalId: 'browser:beta',
      fingerprint: 'be46c9c7abcdef0123456789abcdef02',
      aliases: ['@beta'],
    }),
    username: 'beta',
    peerType: 'browser-shell',
    shellBackend: 'virtual-shell',
    capabilities: ['shell'],
    reachability: [
      createReachabilityDescriptor({
        kind: 'reverse-relay',
        source: 'wsh-relay',
        relayHost: 'localhost',
        relayPort: 4422,
        lastSeen: Date.now(),
      }),
    ],
  }));
  return registry;
}

describe('renderRemoteRuntimePanel', () => {
  it('renders runtime rows with actions and route explanation', () => {
    const html = renderRemoteRuntimePanel(makeRegistry(), {
      activeSelector: 'host:alpha',
      routeExplanation: {
        connectionKind: 'direct',
        reason: 'host/pty via direct-host',
        route: { kind: 'direct-host' },
        target: { intent: 'exec' },
        descriptor: { capabilities: ['shell', 'exec', 'fs'] },
        health: { health: 'degraded', lastOutcomeReason: 'timeout' },
        resumability: { replayMode: 'lossless' },
        warnings: ['route degraded', 'last failure: timeout'],
        alternatives: [{ kind: 'reverse-relay', health: 'healthy' }],
      },
    });

    assert.match(html, /Remote Runtimes/);
    assert.match(html, /alpha/);
    assert.match(html, /browser-shell \/ virtual-shell/);
    assert.match(html, /host\/pty via direct-host/);
    assert.match(html, /data-view="terminal"/);
    assert.match(html, /data-view="files"/);
    assert.match(html, /data-view="services"/);
    assert.match(html, /replay:lossless/);
    assert.match(html, /Health: degraded/);
    assert.match(html, /Last failure: timeout/);
    assert.match(html, /Fallbacks: reverse-relay:healthy/);
  });

  it('disables files and services actions when the peer does not advertise them', () => {
    const html = renderRemoteRuntimePanel(makeRegistry(), {});

    assert.match(html, /beta/);
    assert.match(html, /data-selector="browser:beta" data-view="files" disabled/);
    assert.match(html, /data-selector="browser:beta" data-view="services" disabled/);
  });

  it('labels vm-console sessions as VM guest consoles', () => {
    const registry = new RemoteRuntimeRegistry();
    registry.ingestDescriptor(createRemotePeerDescriptor({
      identity: createRemoteIdentity({
        canonicalId: 'vm:gamma',
        fingerprint: 'ce46c9c7abcdef0123456789abcdef03',
      }),
      username: 'gamma',
      peerType: 'vm-guest',
      shellBackend: 'vm-console',
      capabilities: ['shell'],
      reachability: [
        createReachabilityDescriptor({
          kind: 'reverse-relay',
          source: 'wsh-relay',
          relayHost: 'localhost',
          relayPort: 4422,
          lastSeen: Date.now(),
        }),
      ],
    }));

    const html = renderRemoteRuntimePanel(registry, {
      activeSelector: 'vm:gamma',
      activeView: { kind: 'terminal', client: {} },
    });

    assert.match(html, /VM Guest Console/);
    assert.match(html, /browser-hosted VM console/);
  });
});

describe('supportHintsForRuntime', () => {
  it('derives partial replay for vm-console backends', () => {
    const hints = supportHintsForRuntime({ peerType: 'vm-guest', shellBackend: 'vm-console' });

    assert.equal(hints.supportsAttach, true);
    assert.equal(hints.supportsReplay, true);
    assert.equal(hints.supportsEcho, false);
    assert.equal(hints.supportsTermSync, false);
    assert.equal(hints.replayMode, 'partial');
  });
});

describe('renderRemoteServiceList', () => {
  it('renders a peer-scoped service table', () => {
    const html = renderRemoteServiceList([
      { name: 'ssh', type: 'terminal', podId: 'alpha-pod', version: '1.0.0', address: 'mesh://alpha/ssh' },
    ], { title: 'alpha Services' });

    assert.match(html, /alpha Services/);
    assert.match(html, /ssh/);
    assert.match(html, /terminal/);
    assert.match(html, /mesh:\/\/alpha\/ssh/);
  });
});
