/**
 * WSH CORS Transport Tests — Block 2 (WSH bridge replacement)
 *
 * Validates that:
 *   1. WSH is preferred over the extension bridge for CORS fetching
 *   2. Extension bridge still works as a fallback
 *   3. Deprecation warnings fire when the bridge is used while WSH is available
 *   4. hasWshTransport() correctly reflects connection state
 *   5. setCorsFetchWshProvider wiring works
 *
 * Run with:
 *   node --import ./web/test/_setup-globals.mjs --test web/test/clawser-wsh-cors-transport.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Polyfills ────────────────────────────────────────────────────
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    postMessage: () => {},
  };
}

const mod = await import('../clawser-cors-fetch-util.js');
const {
  setCorsFetchClient,
  setCorsFetchWshProvider,
  corsFetchFallback,
  hasWshTransport,
  _resetBridgeDeprecation,
} = mod;

// ── Mock helpers ─────────────────────────────────────────────────

/**
 * Create a mock WshClient with configurable exec results.
 * @param {object} [overrides]
 */
const makeMockWshClient = (overrides = {}) => ({
  state: 'authenticated',
  openSession: async ({ command }) => {
    const encoder = new TextEncoder();
    const responseBody = overrides.responseBody ?? '<h1>WSH Hello</h1>';
    const status = overrides.status ?? 200;
    const raw = `HTTP/1.1 ${status} OK\r\ncontent-type: text/html\r\n\r\n${responseBody}`;
    const data = encoder.encode(raw);

    let onData, onExit, onClose;
    const session = {
      get id() { return 'mock-session-1'; },
      close: () => {},
      set onData(fn) { onData = fn; },
      set onExit(fn) { onExit = fn; },
      set onClose(fn) { onClose = fn; },
    };

    // Simulate async data delivery
    setTimeout(() => {
      if (onData) onData(data);
      if (onExit) onExit(overrides.exitCode ?? 0);
    }, 1);

    return session;
  },
  ...overrides,
});

const makeMockExtClient = (overrides = {}) => ({
  connected: true,
  call: async (action, params) => ({
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: '<h1>Extension Hello</h1>',
  }),
  ...overrides,
});

// ── Tests ────────────────────────────────────────────────────────

describe('WSH CORS Transport (Block 2)', () => {
  beforeEach(() => {
    setCorsFetchClient(null);
    setCorsFetchWshProvider(null);
    _resetBridgeDeprecation();
  });

  // ── hasWshTransport ──────────────────────────────────────────

  describe('hasWshTransport', () => {
    it('returns false when no provider is set', () => {
      assert.equal(hasWshTransport(), false);
    });

    it('returns false when provider returns empty map', () => {
      setCorsFetchWshProvider(() => new Map());
      assert.equal(hasWshTransport(), false);
    });

    it('returns false when all connections are disconnected', () => {
      const connections = new Map([
        ['host1', { state: 'disconnected' }],
        ['host2', { state: 'closed' }],
      ]);
      setCorsFetchWshProvider(() => connections);
      assert.equal(hasWshTransport(), false);
    });

    it('returns true when an authenticated connection exists', () => {
      const connections = new Map([
        ['host1', { state: 'disconnected' }],
        ['host2', makeMockWshClient()],
      ]);
      setCorsFetchWshProvider(() => connections);
      assert.equal(hasWshTransport(), true);
    });

    it('returns false when provider throws', () => {
      setCorsFetchWshProvider(() => { throw new Error('boom'); });
      assert.equal(hasWshTransport(), false);
    });
  });

  // ── WSH preferred over extension ─────────────────────────────

  describe('WSH transport priority', () => {
    it('uses WSH when both WSH and extension are available', async () => {
      const connections = new Map([
        ['wss://remote:4422', makeMockWshClient({ responseBody: 'from-wsh' })],
      ]);
      setCorsFetchWshProvider(() => connections);
      setCorsFetchClient(makeMockExtClient());

      const result = await corsFetchFallback('https://example.com');
      assert.ok(result, 'should return a result');
      assert.equal(result.status, 200);
      assert.ok(result.body.includes('from-wsh'), 'should use WSH response, not extension');
    });

    it('falls back to extension when WSH has no authenticated connections', async () => {
      const connections = new Map([
        ['host1', { state: 'disconnected' }],
      ]);
      setCorsFetchWshProvider(() => connections);
      setCorsFetchClient(makeMockExtClient());

      const result = await corsFetchFallback('https://example.com');
      assert.ok(result, 'should return a result');
      assert.ok(result.body.includes('Extension Hello'), 'should use extension response');
    });

    it('falls back to extension when WSH fetch fails (non-zero exit)', async () => {
      const connections = new Map([
        ['host1', makeMockWshClient({ exitCode: 1 })],
      ]);
      setCorsFetchWshProvider(() => connections);
      setCorsFetchClient(makeMockExtClient());

      const result = await corsFetchFallback('https://example.com');
      assert.ok(result, 'should return a result from extension');
      assert.ok(result.body.includes('Extension Hello'));
    });

    it('returns null when neither WSH nor extension is available', async () => {
      const result = await corsFetchFallback('https://example.com');
      assert.equal(result, null);
    });
  });

  // ── WSH fetch response parsing ───────────────────────────────

  describe('WSH fetch response parsing', () => {
    it('parses HTTP status from curl -D- output', async () => {
      const connections = new Map([
        ['host1', makeMockWshClient({ status: 404, responseBody: 'Not Found' })],
      ]);
      setCorsFetchWshProvider(() => connections);

      const result = await corsFetchFallback('https://example.com/missing');
      assert.ok(result);
      assert.equal(result.status, 404);
      assert.equal(result.body, 'Not Found');
    });

    it('parses response headers from curl output', async () => {
      const encoder = new TextEncoder();
      const raw = 'HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nx-custom: foo\r\n\r\n{"ok":true}';
      const client = {
        state: 'authenticated',
        openSession: async () => {
          let onData, onExit;
          const session = {
            close: () => {},
            set onData(fn) { onData = fn; },
            set onExit(fn) { onExit = fn; },
            set onClose(fn) {},
          };
          setTimeout(() => {
            onData(encoder.encode(raw));
            onExit(0);
          }, 1);
          return session;
        },
      };
      setCorsFetchWshProvider(() => new Map([['h', client]]));

      const result = await corsFetchFallback('https://api.example.com');
      assert.ok(result);
      assert.equal(result.headers['content-type'], 'application/json');
      assert.equal(result.headers['x-custom'], 'foo');
      assert.equal(result.body, '{"ok":true}');
    });

    it('passes method and headers to WSH curl command', async () => {
      let capturedCommand = '';
      const client = {
        state: 'authenticated',
        openSession: async ({ command }) => {
          capturedCommand = command;
          const encoder = new TextEncoder();
          let onData, onExit;
          const session = {
            close: () => {},
            set onData(fn) { onData = fn; },
            set onExit(fn) { onExit = fn; },
            set onClose(fn) {},
          };
          setTimeout(() => {
            onData(encoder.encode('HTTP/1.1 200 OK\r\n\r\nok'));
            onExit(0);
          }, 1);
          return session;
        },
      };
      setCorsFetchWshProvider(() => new Map([['h', client]]));

      await corsFetchFallback('https://api.example.com', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer token123' },
        body: '{"data":1}',
      });

      assert.ok(capturedCommand.includes('-X POST'), 'should include HTTP method');
      assert.ok(capturedCommand.includes('Authorization: Bearer token123'), 'should include headers');
      assert.ok(capturedCommand.includes('-d'), 'should include body flag');
    });
  });

  // ── Deprecation warnings ─────────────────────────────────────

  describe('deprecation warnings', () => {
    // Polyfill addEventListener/removeEventListener on globalThis for Node
    const _listeners = [];
    const _addListener = globalThis.addEventListener?.bind(globalThis);
    const _removeListener = globalThis.removeEventListener?.bind(globalThis);

    const addListener = (type, fn) => {
      if (_addListener) return _addListener(type, fn);
      _listeners.push({ type, fn });
    };
    const removeListener = (type, fn) => {
      if (_removeListener) return _removeListener(type, fn);
      const idx = _listeners.findIndex(l => l.type === type && l.fn === fn);
      if (idx >= 0) _listeners.splice(idx, 1);
    };

    // Patch globalThis.dispatchEvent if missing (Node.js env)
    let _origDispatch;
    beforeEach(() => {
      _origDispatch = globalThis.dispatchEvent;
      if (!_origDispatch) {
        globalThis.dispatchEvent = (event) => {
          for (const l of _listeners) {
            if (l.type === event.type) l.fn(event);
          }
        };
      }
      if (!globalThis.addEventListener) {
        globalThis.addEventListener = addListener;
        globalThis.removeEventListener = removeListener;
      }
    });

    it('emits deprecation event when bridge is used while WSH connection exists', async () => {
      // WSH connection exists but fetch fails → falls back to extension
      const connections = new Map([
        ['host1', makeMockWshClient({ exitCode: 1 })],
      ]);
      setCorsFetchWshProvider(() => connections);
      setCorsFetchClient(makeMockExtClient());

      let deprecationFired = false;
      const handler = (e) => { deprecationFired = true; };
      addListener('clawser:cors-bridge-deprecated', handler);

      await corsFetchFallback('https://example.com');

      removeListener('clawser:cors-bridge-deprecated', handler);
      assert.equal(deprecationFired, true, 'should fire deprecation event');
    });

    it('does not emit deprecation when no WSH connections exist', async () => {
      setCorsFetchClient(makeMockExtClient());

      let deprecationFired = false;
      const handler = () => { deprecationFired = true; };
      addListener('clawser:cors-bridge-deprecated', handler);

      await corsFetchFallback('https://example.com');

      removeListener('clawser:cors-bridge-deprecated', handler);
      assert.equal(deprecationFired, false, 'should not fire deprecation');
    });

    it('only emits deprecation once (debounced)', async () => {
      const connections = new Map([
        ['host1', makeMockWshClient({ exitCode: 1 })],
      ]);
      setCorsFetchWshProvider(() => connections);
      setCorsFetchClient(makeMockExtClient());

      let count = 0;
      const handler = () => { count++; };
      addListener('clawser:cors-bridge-deprecated', handler);

      await corsFetchFallback('https://example.com/a');
      await corsFetchFallback('https://example.com/b');
      await corsFetchFallback('https://example.com/c');

      removeListener('clawser:cors-bridge-deprecated', handler);
      assert.equal(count, 1, 'should only fire once');
    });

    it('_resetBridgeDeprecation allows warning to fire again', async () => {
      const connections = new Map([
        ['host1', makeMockWshClient({ exitCode: 1 })],
      ]);
      setCorsFetchWshProvider(() => connections);
      setCorsFetchClient(makeMockExtClient());

      let count = 0;
      const handler = () => { count++; };
      addListener('clawser:cors-bridge-deprecated', handler);

      await corsFetchFallback('https://example.com/a');
      _resetBridgeDeprecation();
      await corsFetchFallback('https://example.com/b');

      removeListener('clawser:cors-bridge-deprecated', handler);
      assert.equal(count, 2, 'should fire again after reset');
    });
  });

  // ── setCorsFetchWshProvider ──────────────────────────────────

  describe('setCorsFetchWshProvider', () => {
    it('can be set to null to disable WSH transport', () => {
      setCorsFetchWshProvider(() => new Map([['h', makeMockWshClient()]]));
      assert.equal(hasWshTransport(), true);

      setCorsFetchWshProvider(null);
      assert.equal(hasWshTransport(), false);
    });

    it('uses live connection state (dynamic)', () => {
      const connections = new Map();
      setCorsFetchWshProvider(() => connections);
      assert.equal(hasWshTransport(), false);

      connections.set('host1', makeMockWshClient());
      assert.equal(hasWshTransport(), true);

      connections.delete('host1');
      assert.equal(hasWshTransport(), false);
    });
  });

  // ── Backward compatibility ───────────────────────────────────

  describe('backward compatibility', () => {
    it('corsFetchFallback still works with only extension (no WSH)', async () => {
      setCorsFetchClient(makeMockExtClient());
      // No WSH provider set

      const result = await corsFetchFallback('https://example.com');
      assert.ok(result);
      assert.equal(result.status, 200);
      assert.ok(result.body.includes('Extension Hello'));
    });

    it('corsFetchFallback returns null with only disconnected extension', async () => {
      setCorsFetchClient(makeMockExtClient({ connected: false }));

      const result = await corsFetchFallback('https://example.com');
      assert.equal(result, null);
    });
  });
});
