// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-tunnel.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  TunnelProvider,
  CloudflareTunnel,
  NgrokTunnel,
  TunnelManager,
  TUNNEL_STATE,
} from '../clawser-tunnel.js';

// ── Mock wsh exec ────────────────────────────────────────────────

function makeWshExec(responses = {}) {
  return async (cmd, args = []) => {
    const key = `${cmd} ${args.join(' ')}`.trim();
    for (const [pattern, response] of Object.entries(responses)) {
      if (key.includes(pattern)) return response;
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
}

// ── TUNNEL_STATE ─────────────────────────────────────────────────

describe('TUNNEL_STATE', () => {
  it('has all expected states', () => {
    assert.equal(TUNNEL_STATE.DISCONNECTED, 'disconnected');
    assert.equal(TUNNEL_STATE.CONNECTING, 'connecting');
    assert.equal(TUNNEL_STATE.CONNECTED, 'connected');
    assert.equal(TUNNEL_STATE.ERROR, 'error');
  });
});

// ── TunnelProvider interface ─────────────────────────────────────

describe('TunnelProvider', () => {
  it('has required interface methods', () => {
    const provider = new TunnelProvider();
    assert.equal(typeof provider.connect, 'function');
    assert.equal(typeof provider.disconnect, 'function');
    assert.equal(typeof provider.getUrl, 'function');
    assert.equal(typeof provider.getState, 'function');
    assert.equal(typeof provider.getName, 'function');
  });

  it('connect throws not-implemented by default', async () => {
    const provider = new TunnelProvider();
    await assert.rejects(() => provider.connect(3000), /not implemented/i);
  });
});

// ── CloudflareTunnel ─────────────────────────────────────────────

describe('CloudflareTunnel', () => {
  it('getName returns cloudflare', () => {
    const tunnel = new CloudflareTunnel({ exec: makeWshExec() });
    assert.equal(tunnel.getName(), 'cloudflare');
  });

  it('starts disconnected', () => {
    const tunnel = new CloudflareTunnel({ exec: makeWshExec() });
    assert.equal(tunnel.getState(), TUNNEL_STATE.DISCONNECTED);
    assert.equal(tunnel.getUrl(), null);
  });

  it('connect transitions to connected state with URL', async () => {
    const exec = makeWshExec({
      'cloudflared': { exitCode: 0, stdout: 'https://test-tunnel.trycloudflare.com', stderr: '' },
    });
    const tunnel = new CloudflareTunnel({ exec });
    await tunnel.connect(3000);
    assert.equal(tunnel.getState(), TUNNEL_STATE.CONNECTED);
    assert.equal(tunnel.getUrl(), 'https://test-tunnel.trycloudflare.com');
  });

  it('connect handles exec failure', async () => {
    const exec = makeWshExec({
      'cloudflared': { exitCode: 1, stdout: '', stderr: 'command not found' },
    });
    const tunnel = new CloudflareTunnel({ exec });
    await assert.rejects(() => tunnel.connect(3000), /cloudflared/i);
    assert.equal(tunnel.getState(), TUNNEL_STATE.ERROR);
  });

  it('disconnect resets state', async () => {
    const exec = makeWshExec({
      'cloudflared': { exitCode: 0, stdout: 'https://test.trycloudflare.com', stderr: '' },
    });
    const tunnel = new CloudflareTunnel({ exec });
    await tunnel.connect(3000);
    await tunnel.disconnect();
    assert.equal(tunnel.getState(), TUNNEL_STATE.DISCONNECTED);
    assert.equal(tunnel.getUrl(), null);
  });
});

// ── NgrokTunnel ──────────────────────────────────────────────────

describe('NgrokTunnel', () => {
  it('getName returns ngrok', () => {
    const tunnel = new NgrokTunnel({ exec: makeWshExec(), fetchFn: async () => ({}) });
    assert.equal(tunnel.getName(), 'ngrok');
  });

  it('starts disconnected', () => {
    const tunnel = new NgrokTunnel({ exec: makeWshExec(), fetchFn: async () => ({}) });
    assert.equal(tunnel.getState(), TUNNEL_STATE.DISCONNECTED);
    assert.equal(tunnel.getUrl(), null);
  });

  it('connect parses ngrok API tunnels list', async () => {
    const exec = makeWshExec({
      'ngrok': { exitCode: 0, stdout: '', stderr: '' },
    });
    const fetchFn = async (url) => ({
      ok: true,
      json: async () => ({
        tunnels: [{ public_url: 'https://abc123.ngrok-free.app', proto: 'https' }],
      }),
    });
    const tunnel = new NgrokTunnel({ exec, fetchFn });
    await tunnel.connect(3000);
    assert.equal(tunnel.getState(), TUNNEL_STATE.CONNECTED);
    assert.equal(tunnel.getUrl(), 'https://abc123.ngrok-free.app');
  });

  it('disconnect resets state', async () => {
    const exec = makeWshExec({
      'ngrok': { exitCode: 0, stdout: '', stderr: '' },
    });
    const fetchFn = async () => ({
      ok: true,
      json: async () => ({ tunnels: [{ public_url: 'https://abc.ngrok-free.app', proto: 'https' }] }),
    });
    const tunnel = new NgrokTunnel({ exec, fetchFn });
    await tunnel.connect(3000);
    await tunnel.disconnect();
    assert.equal(tunnel.getState(), TUNNEL_STATE.DISCONNECTED);
    assert.equal(tunnel.getUrl(), null);
  });
});

// ── TunnelManager ────────────────────────────────────────────────

describe('TunnelManager', () => {
  let mgr;

  beforeEach(() => {
    mgr = new TunnelManager();
  });

  it('starts with no active tunnel', () => {
    assert.equal(mgr.getActiveTunnel(), null);
    assert.equal(mgr.getUrl(), null);
    assert.equal(mgr.getState(), TUNNEL_STATE.DISCONNECTED);
  });

  it('registerProvider adds a provider by name', () => {
    const provider = new CloudflareTunnel({ exec: makeWshExec() });
    mgr.registerProvider('cloudflare', provider);
    assert.deepEqual(mgr.listProviders(), ['cloudflare']);
  });

  it('connect activates a provider by name', async () => {
    const exec = makeWshExec({
      'cloudflared': { exitCode: 0, stdout: 'https://tunnel.trycloudflare.com', stderr: '' },
    });
    mgr.registerProvider('cloudflare', new CloudflareTunnel({ exec }));
    await mgr.connect('cloudflare', 3000);
    assert.equal(mgr.getActiveTunnel(), 'cloudflare');
    assert.equal(mgr.getUrl(), 'https://tunnel.trycloudflare.com');
    assert.equal(mgr.getState(), TUNNEL_STATE.CONNECTED);
  });

  it('connect rejects unknown provider', async () => {
    await assert.rejects(() => mgr.connect('unknown', 3000), /unknown provider/i);
  });

  it('disconnect clears active tunnel', async () => {
    const exec = makeWshExec({
      'cloudflared': { exitCode: 0, stdout: 'https://tunnel.trycloudflare.com', stderr: '' },
    });
    mgr.registerProvider('cloudflare', new CloudflareTunnel({ exec }));
    await mgr.connect('cloudflare', 3000);
    await mgr.disconnect();
    assert.equal(mgr.getActiveTunnel(), null);
    assert.equal(mgr.getState(), TUNNEL_STATE.DISCONNECTED);
  });

  it('onChange notifies listeners on state change', async () => {
    const states = [];
    mgr.onChange((state) => states.push(state));
    const exec = makeWshExec({
      'cloudflared': { exitCode: 0, stdout: 'https://tunnel.trycloudflare.com', stderr: '' },
    });
    mgr.registerProvider('cloudflare', new CloudflareTunnel({ exec }));
    await mgr.connect('cloudflare', 3000);
    assert.ok(states.length > 0);
    assert.ok(states.includes(TUNNEL_STATE.CONNECTED));
  });
});
