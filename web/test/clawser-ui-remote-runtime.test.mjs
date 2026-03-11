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
    assert.match(html, /Host PTY Peer/);
    assert.match(html, /browser-shell \/ virtual-shell/);
    assert.match(html, /host\/pty via direct-host/);
    assert.match(html, /data-view="terminal"/);
    assert.match(html, /data-view="files"/);
    assert.match(html, /data-view="services"/);
    assert.match(html, /replay:lossless/);
    assert.match(html, /deploy:skillSync, toolInjection, packageInstall/);
    assert.match(html, /Health: degraded/);
    assert.match(html, /Last failure: timeout/);
    assert.match(html, /Fallbacks: reverse-relay:healthy/);
  });

  it('renders failure provenance for denied routes', () => {
    const html = renderRemoteRuntimePanel(makeRegistry(), {
      activeSelector: 'host:alpha',
      routeExplanation: {
        connectionKind: 'failed',
        reason: 'mesh ACL denied exec',
        target: { intent: 'exec' },
        descriptor: { capabilities: [] },
        health: {
          health: 'failed',
          lastOutcomeReason: 'mesh ACL denied exec',
          lastOutcomeLayer: 'mesh-acl',
        },
        resumability: { replayMode: 'unsupported' },
        warnings: ['layer:mesh-acl', 'code:policy-denied'],
        alternatives: [],
        failure: { layer: 'mesh-acl', code: 'policy-denied' },
      },
    });

    assert.match(html, /Failure: mesh-acl \/ policy-denied/);
    assert.match(html, /Layer: mesh-acl/);
    assert.match(html, /Last failure: mesh ACL denied exec/);
    assert.match(html, /layer:mesh-acl \| code:policy-denied/);
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
    assert.match(html, /VM Guest Peer/);
    assert.match(html, /browser-hosted VM console/);
  });

  it('renders local reverse exposure registrations separately from remote runtimes', () => {
    const html = renderRemoteRuntimePanel(makeRegistry(), {
      localExposure: [{
        host: 'localhost',
        preset: 'full',
        approvalMode: 'per-session',
        activeIncomingSessions: 2,
        expose: { shell: true, tools: true, fs: false },
        metadata: { peerType: 'browser-shell', shellBackend: 'virtual-shell' },
      }],
    });

    assert.match(html, /Local Exposure/);
    assert.match(html, /localhost/);
    assert.match(html, /per-session/);
    assert.match(html, /incoming:2/);
  });

  it('renders canonical search filters and telemetry summaries', () => {
    const html = renderRemoteRuntimePanel(makeRegistry(), {
      filterText: 'alpha',
      filterCapability: 'shell',
      filterPeerType: 'host',
      telemetry: {
        registry: {
          health: { healthy: 1, degraded: 0, offline: 0 },
          relayUsage: { relayRoutes: 1 },
        },
        denialsByLayer: { 'mesh-acl': 2 },
      },
    });

    assert.match(html, /Search peers, aliases, services/);
    assert.match(html, /Healthy: 1/);
    assert.match(html, /Relay routes: 1/);
    assert.match(html, /Denials: 2/);
    assert.match(html, /All peer types/);
  });

  it('renders canonical remote audit entries', () => {
    const html = renderRemoteRuntimePanel(makeRegistry(), {
      activeSelector: 'host:alpha',
      auditEntries: [
        {
          sequence: 41,
          timestamp: Date.now(),
          operation: 'remote_session_opened',
          actor: 'operator',
          selector: 'host:alpha',
          layer: 'direct-host',
          outcome: 'success',
          summary: 'pwd',
        },
      ],
    });

    assert.match(html, /Remote Audit/);
    assert.match(html, /remote_session_opened/);
    assert.match(html, /operator/);
    assert.match(html, /target:host:alpha/);
    assert.match(html, /via:direct-host/);
    assert.match(html, /outcome:success/);
    assert.match(html, /pwd/);
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
