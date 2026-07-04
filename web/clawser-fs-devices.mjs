/**
 * clawser-fs-devices.mjs — Device file system layer (/dev/clawser/)
 *
 * Unlike /proc (read-only), device files support BOTH reading and writing
 * with special semantics. Writing to a device triggers an action; reading
 * returns the result.
 *
 * Architecture:
 *   DeviceFileHandler — registry of device file handlers
 *   Each device has:
 *     - write(content, state): called on write to the device
 *     - read(state): called on read from the device
 *     - state: mutable state object
 *   Supports file reads, writes, directory listings, and stat.
 *
 * @example
 *   import { DeviceFileHandler, registerProviderDevice } from './clawser-fs-devices.mjs';
 *   const devices = new DeviceFileHandler();
 *   registerProviderDevice(devices, 'openai', providerRegistry);
 *   await devices.handleWrite('/dev/clawser/providers/openai', 'What is 2+2?');
 *   const answer = await devices.handleRead('/dev/clawser/providers/openai');
 */

// ── DeviceFileHandler ──────────────────────────────────────────────

/**
 * @typedef {object} DeviceDescriptor
 * @property {(content: string, state: object) => Promise<string>} write
 * @property {(state: object) => Promise<string>} read
 * @property {object} state
 */

/**
 * Virtual device file handler for /dev/clawser/ paths.
 * Intercepts reads and writes to device file paths, dispatching
 * to registered device handlers instead of the real filesystem.
 */
export class DeviceFileHandler {
  /** @type {Map<string, DeviceDescriptor>} path → device descriptor */
  #devices = new Map();

  /**
   * Register a device file handler.
   * @param {string} path - Device path (e.g. '/dev/clawser/providers/openai')
   * @param {object} descriptor
   * @param {(content: string, state: object) => Promise<string>} descriptor.write
   * @param {(state: object) => Promise<string>} descriptor.read
   * @param {object} [descriptor.state] - Initial mutable state
   */
  register(path, { write, read, state = {} }) {
    const norm = this.#normalize(path);
    this.#devices.set(norm, { write, read, state });
  }

  /**
   * Unregister a device file handler.
   * @param {string} path
   * @returns {boolean} true if the device was found and removed
   */
  unregister(path) {
    return this.#devices.delete(this.#normalize(path));
  }

  /**
   * Check if a path is a registered device file or a device directory.
   * @param {string} path
   * @returns {boolean}
   */
  isDevice(path) {
    const norm = this.#normalize(path);
    if (this.#devices.has(norm)) return true;
    // Check if it's a directory containing devices
    const prefix = norm.endsWith('/') ? norm : norm + '/';
    for (const key of this.#devices.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  /**
   * Write data to a device file.
   * @param {string} path
   * @param {string} content
   * @returns {Promise<string>}
   * @throws {Error} If no device at path
   */
  async handleWrite(path, content) {
    const norm = this.#normalize(path);
    const dev = this.#devices.get(norm);
    if (!dev) throw new Error(`No device at ${path}`);
    return dev.write(content, dev.state);
  }

  /**
   * Read data from a device file.
   * @param {string} path
   * @returns {Promise<string>}
   * @throws {Error} If no device at path
   */
  async handleRead(path) {
    const norm = this.#normalize(path);
    const dev = this.#devices.get(norm);
    if (!dev) throw new Error(`No device at ${path}`);
    return dev.read(dev.state);
  }

  /**
   * Get the state object for a device.
   * @param {string} path
   * @returns {object|undefined}
   */
  getState(path) {
    return this.#devices.get(this.#normalize(path))?.state;
  }

  /**
   * Deliver an inbound channel message to /dev/clawser/channels/{name}.
   * Makes the message readable via handleRead (e.g. `cat /dev/clawser/channels/slack`).
   *
   * @param {string} channelName - Channel device name (e.g. 'slack')
   * @param {string} message - Message content
   * @returns {boolean} true if the channel device exists and received the message
   */
  deliverToChannel(channelName, message) {
    const state = this.getState(`/dev/clawser/channels/${channelName}`);
    if (!state) return false;
    state.lastReceived = message;
    return true;
  }

  /**
   * List entries in a device directory.
   * @param {string} path
   * @returns {Array<{name: string, kind: 'file'|'directory'}>}
   */
  listDir(path) {
    const norm = this.#normalize(path);
    const prefix = norm.endsWith('/') ? norm : norm + '/';
    const seen = new Set();
    const entries = [];

    for (const key of this.#devices.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const name = rest.split('/')[0];
        if (!seen.has(name)) {
          seen.add(name);
          const isDir = rest.includes('/');
          entries.push({ name, kind: isDir ? 'directory' : 'file' });
        }
      }
    }

    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get all registered device paths.
   * @returns {string[]}
   */
  get paths() {
    return [...this.#devices.keys()];
  }

  #normalize(path) {
    return path.replace(/\/+$/, '').replace(/\/+/g, '/');
  }
}

// ── Provider Device Registration ───────────────────────────────────

/**
 * Register a provider as a device file at /dev/clawser/providers/{name}.
 *
 * Write sends a prompt (non-blocking trigger, but waits for completion).
 * Read returns the last response (blocks if response isn't ready yet).
 * Separate read/write streams — not a single synchronous call.
 *
 * @param {DeviceFileHandler} deviceHandler
 * @param {string} providerName - e.g. 'openai', 'anthropic'
 * @param {import('./clawser-providers.js').ProviderRegistry} providerRegistry
 * @param {object} [opts]
 * @param {string} [opts.apiKey] - API key for the provider
 * @param {string} [opts.model] - Model override
 *
 * @example
 *   registerProviderDevice(devices, 'openai', registry);
 *   // Shell: echo "What is 2+2?" > /dev/clawser/providers/openai
 *   // Shell: cat /dev/clawser/providers/openai
 */
export const registerProviderDevice = (deviceHandler, providerName, providerRegistry, opts = {}) => {
  const path = `/dev/clawser/providers/${providerName}`;

  deviceHandler.register(path, {
    state: {
      lastPrompt: null,
      lastResponse: null,
      status: 'idle',        // idle | thinking | streaming | error
      streaming: false,
      streamBuffer: '',
      /** @type {((val: string) => void)|null} */
      streamResolve: null,
      error: null,
    },

    write: async (content, state) => {
      state.lastPrompt = content.trim();
      state.status = 'thinking';
      state.lastResponse = null;
      state.streamBuffer = '';
      state.error = null;

      // Create a promise that resolves when the response completes
      const responsePromise = new Promise((resolve) => {
        state.streamResolve = resolve;
      });

      const provider = providerRegistry.get(providerName);
      if (!provider) {
        state.status = 'error';
        state.error = `Provider ${providerName} not configured`;
        state.lastResponse = `Error: Provider ${providerName} not configured`;
        state.streamResolve?.(state.lastResponse);
        state.streamResolve = null;
        throw new Error(state.error);
      }

      // Fire the request — don't await the full completion here so the
      // write returns relatively quickly, but we do need to await to
      // capture errors properly. The streamResolve unblocks any pending read.
      try {
        const result = await provider.chat(
          { messages: [{ role: 'user', content: state.lastPrompt }] },
          opts.apiKey,
          opts.model,
        );

        state.lastResponse = result.content || '';
        state.status = 'idle';
        state.streamResolve?.(state.lastResponse);
        state.streamResolve = null;
      } catch (e) {
        state.status = 'error';
        state.error = e.message;
        state.lastResponse = `Error: ${e.message}`;
        state.streamResolve?.(state.lastResponse);
        state.streamResolve = null;
        throw e;
      }

      return state.lastResponse;
    },

    read: async (state) => {
      // If a request is in progress, block until complete
      if (state.status === 'thinking' || state.status === 'streaming') {
        if (state.streamResolve) {
          await new Promise((resolve) => {
            const original = state.streamResolve;
            state.streamResolve = (val) => {
              original?.(val);
              resolve(val);
            };
          });
        }
      }

      return state.lastResponse ?? '';
    },
  });
};

// ── Channel Device Registration ────────────────────────────────────

/**
 * Register a channel as a device file at /dev/clawser/channels/{name}.
 *
 * Write sends a message to the channel via ChannelManager.
 * Read returns the last received message.
 *
 * @param {DeviceFileHandler} deviceHandler
 * @param {string} channelName - e.g. 'slack', 'discord', 'telegram'
 * @param {import('./clawser-channels.js').ChannelManager} channelManager
 *
 * @example
 *   registerChannelDevice(devices, 'slack', channelManager);
 *   // Shell: echo "Deploy complete!" > /dev/clawser/channels/slack
 *   // Shell: cat /dev/clawser/channels/slack
 */
export const registerChannelDevice = (deviceHandler, channelName, channelManager) => {
  const path = `/dev/clawser/channels/${channelName}`;

  deviceHandler.register(path, {
    state: {
      lastReceived: null,
      lastSent: null,
    },

    write: async (content, state) => {
      const message = content.trim();
      state.lastSent = message;
      // ChannelManager.send takes (channel, channelId, message).
      // For the device file interface we use the channel name as both
      // channel type and default channelId. Callers needing a specific
      // channelId should use the ChannelManager directly.
      channelManager.send(channelName, channelName, message);
      return '';
    },

    read: async (state) => {
      return state.lastReceived ?? '';
    },
  });
};

// ── Hardware Device Registration ───────────────────────────────────

/**
 * Register a hardware peripheral as a device file at /dev/clawser/hardware/{name}.
 *
 * Maps to WebSerial, WebBluetooth, WebUSB etc.
 * Write sends data to the hardware device.
 * Read returns data from the device.
 *
 * @param {DeviceFileHandler} deviceHandler
 * @param {string} deviceName - e.g. 'serial0', 'bluetooth0', 'usb0'
 * @param {object} hardwareAdapter - Adapter object
 * @param {(data: string) => Promise<string>} hardwareAdapter.write - Send data to device
 * @param {() => Promise<string>} hardwareAdapter.read - Read data from device
 *
 * @example
 *   registerHardwareDevice(devices, 'serial0', serialAdapter);
 *   // Shell: echo "AT+RST" > /dev/clawser/hardware/serial0
 *   // Shell: cat /dev/clawser/hardware/serial0
 */
export const registerHardwareDevice = (deviceHandler, deviceName, hardwareAdapter) => {
  const path = `/dev/clawser/hardware/${deviceName}`;

  deviceHandler.register(path, {
    state: {
      lastWritten: null,
      lastRead: null,
    },

    write: async (content, state) => {
      state.lastWritten = content;
      return hardwareAdapter.write(content);
    },

    read: async (state) => {
      const data = await hardwareAdapter.read();
      state.lastRead = data;
      return data;
    },
  });
};

// ── Special Device Files ───────────────────────────────────────────

/**
 * Register special Unix-like device files:
 *   /dev/clawser/null   — discard all writes, read returns empty
 *   /dev/clawser/random — read returns random hex string
 *   /dev/clawser/zero   — read returns null bytes (empty string in text mode)
 *
 * @param {DeviceFileHandler} deviceHandler
 *
 * @example
 *   registerSpecialDevices(devices);
 *   // Shell: echo "noise" > /dev/clawser/null
 *   // Shell: cat /dev/clawser/random
 */
export const registerSpecialDevices = (deviceHandler) => {
  // /dev/clawser/null — discard writes, empty reads
  deviceHandler.register('/dev/clawser/null', {
    write: async () => '',
    read: async () => '',
  });

  // /dev/clawser/random — read returns random hex string
  deviceHandler.register('/dev/clawser/random', {
    write: async () => '',
    read: async () => {
      const bytes = new Uint8Array(32);
      // Use crypto.getRandomValues if available, else fallback
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
      } else {
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = Math.floor(Math.random() * 256);
        }
      }
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    },
  });

  // /dev/clawser/zero — read returns null bytes (as empty string in text mode)
  deviceHandler.register('/dev/clawser/zero', {
    write: async () => '',
    read: async () => '\0'.repeat(256),
  });
};
