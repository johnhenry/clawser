import { sessionData as sessionDataMsg } from './messages.mjs';

const textEncoder = new TextEncoder();

/**
 * Normalize user input into session bytes for a virtual terminal channel.
 *
 * @param {Uint8Array|string} data
 * @returns {Uint8Array}
 */
export function normalizeSessionData(data) {
  if (data instanceof Uint8Array) {
    return data;
  }
  return textEncoder.encode(String(data));
}

/**
 * Message-backed data plane for browser-hosted virtual sessions.
 */
export class WshVirtualSessionBackend {
  /** @type {function(object): Promise<void>} */
  #sendControl;

  /** @type {number} */
  #channelId;

  /**
   * @param {function(object): Promise<void>} sendControl
   * @param {number} channelId
   */
  constructor(sendControl, channelId) {
    this.#sendControl = sendControl;
    this.#channelId = channelId;
  }

  /**
   * @param {Uint8Array|string} data
   * @returns {Promise<void>}
   */
  async write(data) {
    await this.#sendControl(
      sessionDataMsg({
        channelId: this.#channelId,
        data: normalizeSessionData(data),
      })
    );
  }
}
