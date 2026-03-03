// Vitest setup — polyfill browser globals for Node.js test environment.
// Equivalent of _setup-globals.mjs but for vitest.

const store = {};
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
};

globalThis.document = {
  getElementById: () => null,
  createElement: () => ({
    style: {},
    classList: { add() {}, remove() {} },
    addEventListener() {},
    appendChild() {},
  }),
  addEventListener: () => {},
};

globalThis.location = { search: '', hash: '', href: '', origin: 'http://localhost:3000' };
globalThis.history = { replaceState() {} };

try {
  globalThis.navigator = {
    storage: { getDirectory: async () => ({}) },
    locks: { request: async () => {} },
  };
} catch {
  if (globalThis.navigator) {
    if (!globalThis.navigator.storage) {
      Object.defineProperty(globalThis.navigator, 'storage', {
        value: { getDirectory: async () => ({}) },
        configurable: true,
      });
    }
    if (!globalThis.navigator.locks) {
      Object.defineProperty(globalThis.navigator, 'locks', {
        value: { request: async () => {} },
        configurable: true,
      });
    }
  }
}

globalThis.BroadcastChannel = class { postMessage() {} close() {} onmessage() {} };

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    postMessage: () => {},
  };
}
