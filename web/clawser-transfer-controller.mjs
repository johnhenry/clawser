/**
 * clawser-transfer-controller.mjs — production controller + view-model
 * for the file transfers panel.
 *
 * The render+bind layer in `clawser-ui-transfers.js` accepts
 * `{onSend, onCancel}` opts. This module supplies them, mapping to
 * `state.fileTransfer.createOffer` and `.cancelTransfer`. Also
 * exposes `buildTransferViewModel(listTransfersOutput)` which maps
 * the backend's `{offer, state}` pair shape into the flat shape the
 * panel render expects.
 */

/**
 * Map a `listTransfers()` row (`{offer, state}`) into the panel's
 * flat `{id, filename, peerId, direction, transferredSize,
 * totalSize, speed, status, completedAt}` shape.
 *
 * @param {{offer:object|null, state:object}} row
 * @param {string} localPodId
 * @returns {object}
 */
export function mapTransferRow(row, localPodId) {
  const o = row?.offer || {};
  const s = row?.state || {};
  const sender = o.sender || '';
  const recipient = o.recipient || '';
  const direction = sender === localPodId ? 'upload' : (recipient === localPodId ? 'download' : 'upload');
  const peerId = sender === localPodId ? recipient : sender;
  const firstFile = (o.files && o.files[0]) || null;
  const filename = firstFile?.name
    || (o.files && o.files.length > 1 ? `${o.files.length} files` : 'unknown');
  return {
    id: s.transferId || o.transferId || '',
    filename,
    peerId,
    direction,
    transferredSize: s.bytesTransferred ?? 0,
    totalSize: s.totalSize ?? o.totalSize ?? 0,
    speed: s.transferRate ?? 0,
    status: s.status || 'unknown',
    completedAt: s.completedAt ?? null,
  };
}

/**
 * Build view-model objects for the active and history sections.
 *
 * @param {{listTransfers:(filter?:object) => Array}} fileTransfer
 * @param {string} localPodId
 * @returns {{active: object[], history: object[]}}
 */
export function buildTransferViewModel(fileTransfer, localPodId) {
  if (!fileTransfer || typeof fileTransfer.listTransfers !== 'function') {
    return { active: [], history: [] };
  }
  const all = fileTransfer.listTransfers({}) || [];
  const active = [];
  const history = [];
  for (const row of all) {
    const m = mapTransferRow(row, localPodId);
    if (m.status === 'transferring' || m.status === 'offered' || m.status === 'accepted') {
      active.push(m);
    } else if (m.status === 'completed' || m.status === 'failed' || m.status === 'cancelled') {
      history.push(m);
    }
  }
  return { active, history };
}

/**
 * @typedef {object} TransferControllerCtx
 * @property {{createOffer:Function, cancelTransfer:Function}} fileTransfer
 * @property {Function} [readFileBytes]   - (file:File) => Promise<Uint8Array>
 *   Optional; if omitted, defaults to `file.arrayBuffer()` → Uint8Array.
 * @property {Function} [onLog]           - (msg:string) => void
 * @property {Function} [onError]         - (err:Error|string) => void
 */

/**
 * Default file-bytes reader for browser File objects.
 * @param {File} file
 * @returns {Promise<Uint8Array>}
 */
async function defaultReadFileBytes(file) {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Build the transfers panel controller.
 *
 * @param {TransferControllerCtx} ctx
 * @returns {{onSend:Function, onCancel:Function}}
 */
export function buildTransferController(ctx) {
  const ft = ctx?.fileTransfer;
  const readBytes = ctx?.readFileBytes || defaultReadFileBytes;
  const log = ctx?.onLog || (() => {});
  const onError = ctx?.onError || (() => {});

  return {
    /**
     * Send a list of files to a target peer. Creates an offer and,
     * once accepted by the recipient, the chunk pump runs separately
     * via the mesh transport's offer/accept handler — this method's
     * job is to register the offer so the recipient sees it.
     *
     * @param {File[]|object[]} files
     * @param {string} targetPeerId
     * @returns {Promise<{ok:boolean, transferId?:string, error?:string}>}
     */
    async onSend(files, targetPeerId) {
      if (!ft || typeof ft.createOffer !== 'function') {
        const err = 'fileTransfer not initialized';
        onError(err);
        return { ok: false, error: err };
      }
      if (!Array.isArray(files) || files.length === 0) {
        return { ok: false, error: 'no files to send' };
      }
      if (!targetPeerId || typeof targetPeerId !== 'string') {
        return { ok: false, error: 'target peer id required' };
      }
      try {
        // Build file descriptors. For real File objects we read bytes
        // up-front so the chunk pump can run; for plain {name,size}
        // objects (tests) we trust the caller to have done so.
        const descriptors = [];
        const bytes = [];
        for (const f of files) {
          if (typeof File !== 'undefined' && f instanceof File) {
            const b = await readBytes(f);
            descriptors.push({ name: f.name, size: f.size, mimeType: f.type || null });
            bytes.push(b);
          } else {
            descriptors.push({ name: f.name, size: f.size, mimeType: f.mimeType || null });
            bytes.push(f.bytes || null);
          }
        }
        const offer = ft.createOffer(targetPeerId, descriptors);
        log(`Transfer offer created: ${offer.transferId} → ${targetPeerId}`);
        // Drive the chunk pump opportunistically — the mesh transport
        // gates real delivery on the recipient's accept handshake but
        // calling sendChunks here primes the chunk store so chunks are
        // ready when the accept arrives.
        if (typeof ft.sendChunks === 'function' && bytes.every(b => b)) {
          (async () => {
            try {
              for await (const _chunk of ft.sendChunks(offer.transferId, bytes)) {
                // sendChunks emits progress internally; just drain.
              }
            } catch (e) { onError(e); }
          })();
        }
        return { ok: true, transferId: offer.transferId };
      } catch (err) {
        const msg = err?.message || String(err);
        onError(err);
        return { ok: false, error: msg };
      }
    },

    /**
     * Cancel an in-progress transfer.
     *
     * @param {string} transferId
     * @returns {{ok:boolean, error?:string}}
     */
    onCancel(transferId) {
      if (!ft || typeof ft.cancelTransfer !== 'function') {
        return { ok: false, error: 'fileTransfer not initialized' };
      }
      if (!transferId) return { ok: false, error: 'transferId required' };
      try {
        ft.cancelTransfer(transferId, 'user-cancelled');
        log(`Transfer cancelled: ${transferId}`);
        return { ok: true };
      } catch (err) {
        const msg = err?.message || String(err);
        onError(err);
        return { ok: false, error: msg };
      }
    },
  };
}
