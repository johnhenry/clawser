/**
 * Clawser Mesh Tools
 *
 * BrowserTool subclasses exposing mesh stream and file transfer operations
 * to the AI agent. Follows the pattern in clawser-wsh-tools.js.
 *
 * @module clawser-mesh-tools
 */

import { BrowserTool } from './clawser-tools.js';

// ── Shared state ─────────────────────────────────────────────────────

/**
 * Holds references to the StreamMultiplexer and MeshFileTransfer instances
 * so tools can access them without import cycles.
 */
export class MeshToolsContext {
  #multiplexer = null;
  #fileTransfer = null;

  setMultiplexer(mux) { this.#multiplexer = mux; }
  getMultiplexer() { return this.#multiplexer; }

  setFileTransfer(ft) { this.#fileTransfer = ft; }
  getFileTransfer() { return this.#fileTransfer; }
}

/** Singleton context for mesh tools. */
export const meshToolsContext = new MeshToolsContext();

// ── mesh_stream_open ─────────────────────────────────────────────────

export class MeshStreamOpenTool extends BrowserTool {
  get name() { return 'mesh_stream_open'; }
  get description() {
    return 'Open a multiplexed data stream to a peer. Returns the stream ID for subsequent read/write operations.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        peerId: { type: 'string', description: 'Target peer identity' },
        method: { type: 'string', description: 'Stream purpose (e.g., "chat", "storage/upload")' },
        ordered: { type: 'boolean', description: 'Whether delivery must be ordered (default: true)' },
        encrypted: { type: 'boolean', description: 'Whether to use per-stream encryption (default: false)' },
      },
      required: ['peerId', 'method'],
    };
  }
  get permission() { return 'network'; }

  async execute({ peerId, method, ordered, encrypted }) {
    try {
      const mux = meshToolsContext.getMultiplexer();
      if (!mux) {
        return { success: false, output: '', error: 'Stream multiplexer not initialized. Start a mesh session first.' };
      }

      const stream = mux.open(method, { ordered, encrypted });
      return {
        success: true,
        output: `Stream opened: ${stream.hexId} (method: ${method}, peer: ${peerId}, ordered: ${stream.ordered}, encrypted: ${stream.encrypted})`,
      };
    } catch (err) {
      return { success: false, output: '', error: `Stream open failed: ${err.message}` };
    }
  }
}

// ── mesh_stream_close ────────────────────────────────────────────────

export class MeshStreamCloseTool extends BrowserTool {
  get name() { return 'mesh_stream_close'; }
  get description() {
    return 'Close an open data stream by ID.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        streamId: { type: 'string', description: 'Hex stream ID to close' },
      },
      required: ['streamId'],
    };
  }
  get permission() { return 'network'; }

  async execute({ streamId }) {
    try {
      const mux = meshToolsContext.getMultiplexer();
      if (!mux) {
        return { success: false, output: '', error: 'Stream multiplexer not initialized.' };
      }

      const stream = mux.getStream(streamId);
      if (!stream) {
        return { success: false, output: '', error: `Stream ${streamId} not found.` };
      }

      mux.close(streamId);
      return { success: true, output: `Stream ${streamId} closed.` };
    } catch (err) {
      return { success: false, output: '', error: `Stream close failed: ${err.message}` };
    }
  }
}

// ── mesh_stream_list ─────────────────────────────────────────────────

export class MeshStreamListTool extends BrowserTool {
  get name() { return 'mesh_stream_list'; }
  get description() {
    return 'List active mesh streams, optionally filtered by peer.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        peerId: { type: 'string', description: 'Filter by peer identity (optional)' },
      },
    };
  }
  get permission() { return 'read'; }

  async execute({ peerId } = {}) {
    try {
      const mux = meshToolsContext.getMultiplexer();
      if (!mux) {
        return { success: true, output: 'No active streams (multiplexer not initialized).' };
      }

      const streams = mux.listStreams();
      if (streams.length === 0) {
        return { success: true, output: 'No active streams.' };
      }

      const lines = streams.map(s => {
        const json = s.toJSON();
        return `${json.id} | ${json.method} | ${json.state} | sent:${json.bytesSent} recv:${json.bytesReceived}`;
      });
      return {
        success: true,
        output: `ID | METHOD | STATE | BYTES\n${lines.join('\n')}`,
      };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── mesh_file_send ───────────────────────────────────────────────────

export class MeshFileSendTool extends BrowserTool {
  get name() { return 'mesh_file_send'; }
  get description() {
    return 'Send files to a peer. Creates a transfer offer with file metadata. The peer must accept before data is sent.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        peerId: { type: 'string', description: 'Recipient peer identity' },
        files: {
          type: 'array',
          description: 'Files to send: [{ name, size, mimeType? }]',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              size: { type: 'number' },
              mimeType: { type: 'string' },
            },
            required: ['name', 'size'],
          },
        },
      },
      required: ['peerId', 'files'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ peerId, files }) {
    try {
      const ft = meshToolsContext.getFileTransfer();
      if (!ft) {
        return { success: false, output: '', error: 'File transfer not initialized. Start a mesh session first.' };
      }

      const offer = ft.createOffer(peerId, files);
      const fileList = offer.files.map(f => `  ${f.name} (${f.size} bytes)`).join('\n');
      return {
        success: true,
        output: `Transfer offer created: ${offer.transferId}\nRecipient: ${peerId}\nFiles:\n${fileList}\nTotal: ${offer.totalSize} bytes\nWaiting for acceptance...`,
      };
    } catch (err) {
      return { success: false, output: '', error: `File send failed: ${err.message}` };
    }
  }
}

// ── mesh_file_accept ─────────────────────────────────────────────────

export class MeshFileAcceptTool extends BrowserTool {
  get name() { return 'mesh_file_accept'; }
  get description() {
    return 'Accept an incoming file transfer offer.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        transferId: { type: 'string', description: 'Transfer ID from the incoming offer' },
      },
      required: ['transferId'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ transferId }) {
    try {
      const ft = meshToolsContext.getFileTransfer();
      if (!ft) {
        return { success: false, output: '', error: 'File transfer not initialized.' };
      }

      const offer = ft.getOffer(transferId);
      if (!offer) {
        return { success: false, output: '', error: `Transfer offer ${transferId} not found.` };
      }

      const state = ft.acceptOffer(offer);
      return {
        success: true,
        output: `Transfer ${transferId} accepted. Status: ${state.status}`,
      };
    } catch (err) {
      return { success: false, output: '', error: `Accept failed: ${err.message}` };
    }
  }
}

// ── mesh_file_list ───────────────────────────────────────────────────

export class MeshFileListTool extends BrowserTool {
  get name() { return 'mesh_file_list'; }
  get description() {
    return 'List file transfers, optionally filtered by status or peer.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status: offered, accepted, transferring, completed, failed, cancelled' },
        peerId: { type: 'string', description: 'Filter by peer identity (optional)' },
      },
    };
  }
  get permission() { return 'read'; }

  async execute({ status, peerId } = {}) {
    try {
      const ft = meshToolsContext.getFileTransfer();
      if (!ft) {
        return { success: true, output: 'No transfers (file transfer not initialized).' };
      }

      const transfers = ft.listTransfers({ status, peerId });
      if (transfers.length === 0) {
        return { success: true, output: 'No transfers found.' };
      }

      const lines = transfers.map(t => {
        const s = t.state;
        const fileNames = t.offer?.files?.map(f => f.name).join(', ') || '?';
        return `${s.transferId} | ${s.status} | ${fileNames} | ${s.bytesTransferred}/${s.totalSize} (${Math.round(s.percentComplete)}%)`;
      });
      return {
        success: true,
        output: `ID | STATUS | FILES | PROGRESS\n${lines.join('\n')}`,
      };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── mesh_file_cancel ─────────────────────────────────────────────────

export class MeshFileCancelTool extends BrowserTool {
  get name() { return 'mesh_file_cancel'; }
  get description() {
    return 'Cancel an in-progress file transfer.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        transferId: { type: 'string', description: 'Transfer ID to cancel' },
        reason: { type: 'string', description: 'Cancellation reason (optional)' },
      },
      required: ['transferId'],
    };
  }
  get permission() { return 'write'; }

  async execute({ transferId, reason }) {
    try {
      const ft = meshToolsContext.getFileTransfer();
      if (!ft) {
        return { success: false, output: '', error: 'File transfer not initialized.' };
      }

      ft.cancelTransfer(transferId, reason);
      return {
        success: true,
        output: `Transfer ${transferId} cancelled${reason ? ': ' + reason : ''}.`,
      };
    } catch (err) {
      return { success: false, output: '', error: `Cancel failed: ${err.message}` };
    }
  }
}

// ── Registry helper ──────────────────────────────────────────────────

/**
 * Register all mesh stream/file tools with a BrowserToolRegistry.
 * @param {import('./clawser-tools.js').BrowserToolRegistry} registry
 * @param {import('./clawser-mesh-streams.js').StreamMultiplexer} [multiplexer]
 * @param {import('./clawser-mesh-files.js').MeshFileTransfer} [fileTransfer]
 */
export function registerMeshTools(registry, multiplexer, fileTransfer) {
  if (multiplexer) meshToolsContext.setMultiplexer(multiplexer);
  if (fileTransfer) meshToolsContext.setFileTransfer(fileTransfer);

  registry.register(new MeshStreamOpenTool());
  registry.register(new MeshStreamCloseTool());
  registry.register(new MeshStreamListTool());
  registry.register(new MeshFileSendTool());
  registry.register(new MeshFileAcceptTool());
  registry.register(new MeshFileListTool());
  registry.register(new MeshFileCancelTool());
}
