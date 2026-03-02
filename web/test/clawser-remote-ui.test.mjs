// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-remote-ui.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  RemoteUI,
  RemoteUIState,
} from '../remote-ui.js';

// ── Mock fetch ───────────────────────────────────────────────────

function makeFetch(responses = {}) {
  return async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    // Extract pathname from full URL for matching
    let pathname;
    try {
      pathname = new URL(url).pathname;
    } catch {
      pathname = url;
    }
    const key = `${method} ${pathname}`;

    for (const [pattern, resp] of Object.entries(responses)) {
      if (key.includes(pattern)) {
        return {
          ok: resp.status >= 200 && resp.status < 300,
          status: resp.status,
          json: async () => resp.body,
          text: async () => JSON.stringify(resp.body),
        };
      }
    }

    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
}

// ── RemoteUIState ────────────────────────────────────────────────

describe('RemoteUIState', () => {
  it('starts unauthenticated', () => {
    const state = new RemoteUIState();
    assert.equal(state.authenticated, false);
    assert.equal(state.token, null);
    assert.equal(state.connected, false);
  });

  it('setToken sets authentication', () => {
    const state = new RemoteUIState();
    state.setToken('bearer_abc');
    assert.equal(state.authenticated, true);
    assert.equal(state.token, 'bearer_abc');
  });

  it('clearToken removes authentication', () => {
    const state = new RemoteUIState();
    state.setToken('bearer_abc');
    state.clearToken();
    assert.equal(state.authenticated, false);
    assert.equal(state.token, null);
  });

  it('addMessage appends to message list', () => {
    const state = new RemoteUIState();
    state.addMessage({ role: 'user', content: 'hello' });
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].content, 'hello');
  });

  it('clearMessages empties the list', () => {
    const state = new RemoteUIState();
    state.addMessage({ role: 'user', content: 'hello' });
    state.clearMessages();
    assert.equal(state.messages.length, 0);
  });

  it('onChange notifies on state changes', () => {
    const state = new RemoteUIState();
    const events = [];
    state.onChange((evt) => events.push(evt));
    state.setToken('bearer_abc');
    assert.ok(events.length > 0);
    assert.equal(events[0].type, 'auth');
  });
});

// ── RemoteUI ─────────────────────────────────────────────────────

describe('RemoteUI', () => {
  let ui, fetchFn;

  beforeEach(() => {
    fetchFn = makeFetch({
      'POST /pair': { status: 200, body: { token: 'bearer_test', expires: Date.now() + 86400000 } },
      'POST /message': { status: 200, body: { response: 'Echo: hello' } },
      'GET /status': { status: 200, body: { ok: true, sessions: 1 } },
    });
    ui = new RemoteUI({ baseUrl: 'https://example.com', fetchFn });
  });

  it('constructs with base URL', () => {
    assert.ok(ui);
    assert.equal(ui.baseUrl, 'https://example.com');
  });

  it('pair exchanges code for token', async () => {
    const result = await ui.pair('123456');
    assert.ok(result.token);
    assert.equal(ui.state.authenticated, true);
    assert.equal(ui.state.token, 'bearer_test');
  });

  it('pair fails with invalid code', async () => {
    const fetchBad = makeFetch({
      'POST /pair': { status: 401, body: { error: 'Invalid code' } },
    });
    const uiBad = new RemoteUI({ baseUrl: 'https://example.com', fetchFn: fetchBad });
    await assert.rejects(() => uiBad.pair('000000'), /pair/i);
    assert.equal(uiBad.state.authenticated, false);
  });

  it('sendMessage posts to /message', async () => {
    await ui.pair('123456');
    const result = await ui.sendMessage('hello');
    assert.ok(result.response);
    assert.equal(ui.state.messages.length, 2); // user + assistant
  });

  it('sendMessage fails without auth', async () => {
    await assert.rejects(() => ui.sendMessage('hello'), /not authenticated/i);
  });

  it('getStatus fetches server status', async () => {
    const status = await ui.getStatus();
    assert.equal(status.ok, true);
    assert.equal(typeof status.sessions, 'number');
  });

  it('disconnect clears state', async () => {
    await ui.pair('123456');
    ui.disconnect();
    assert.equal(ui.state.authenticated, false);
    assert.equal(ui.state.token, null);
  });

  it('formatMessage returns formatted message objects', () => {
    const msg = RemoteUI.formatMessage('user', 'hello world');
    assert.equal(msg.role, 'user');
    assert.equal(msg.content, 'hello world');
    assert.ok(msg.timestamp);
  });
});

// ── SSE connection ───────────────────────────────────────────────

describe('RemoteUI SSE', () => {
  it('createEventSourceUrl builds correct URL with token', () => {
    const ui = new RemoteUI({ baseUrl: 'https://example.com', fetchFn: makeFetch({}) });
    ui.state.setToken('bearer_abc');
    const url = ui.createEventSourceUrl();
    assert.ok(url.includes('/stream'));
    assert.ok(url.includes('token=bearer_abc'));
  });
});
