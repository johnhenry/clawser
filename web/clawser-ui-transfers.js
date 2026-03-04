/**
 * clawser-ui-transfers.js -- File transfer monitoring UI panel.
 *
 * Provides UI for viewing active/completed file transfers, drag-and-drop
 * upload initiation, and transfer cancellation.
 *
 * Depends on:
 *   - clawser-state.js ($, esc, state)
 *   - clawser-modal.js (modal)
 *   - clawser-ui-chat.js (addMsg, addErrorMsg)
 */
import { $, esc, state } from './clawser-state.js'
import { modal } from './clawser-modal.js'
import { addMsg, addErrorMsg } from './clawser-ui-chat.js'

// ── Helpers ──────────────────────────────────────────────────────

function truncId(id, len = 12) {
  if (!id || id.length <= len) return id || ''
  return id.slice(0, len) + '...'
}

function fmtSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function fmtSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '--'
  return fmtSize(bytesPerSec) + '/s'
}

function fmtTime(ms) {
  if (!ms) return '--'
  return new Date(ms).toLocaleString()
}

function progressBar(pct) {
  const clamped = Math.max(0, Math.min(100, pct || 0))
  return `<div class="transfer-progress-bar">
    <div class="transfer-progress-fill" style="width:${clamped}%"></div>
    <span class="transfer-progress-text">${clamped.toFixed(0)}%</span>
  </div>`
}

// ── Render ───────────────────────────────────────────────────────

/**
 * Render the file transfer panel.
 * @param {object} [opts]
 * @param {Array} [opts.active] - Active transfers
 * @param {Array} [opts.history] - Completed/failed transfers
 * @param {string} [opts.localPodId]
 * @returns {string} HTML string
 */
export function renderTransferPanel(opts = {}) {
  const active = opts.active || []
  const history = opts.history || []

  // Active transfers
  let activeSection = ''
  if (active.length === 0) {
    activeSection = '<div class="transfer-empty">No active transfers</div>'
  } else {
    for (const t of active) {
      const direction = t.direction === 'upload' ? '\u2191' : '\u2193'  // ↑ or ↓
      const pct = t.totalSize > 0 ? (t.transferredSize / t.totalSize) * 100 : 0
      activeSection += `
        <div class="transfer-row transfer-active" data-transfer-id="${esc(t.id)}">
          <div class="transfer-info">
            <span class="transfer-direction">${direction}</span>
            <span class="transfer-filename">${esc(t.filename || 'unknown')}</span>
            <span class="transfer-peer">${esc(truncId(t.peerId))}</span>
          </div>
          <div class="transfer-stats">
            <span class="transfer-size">${fmtSize(t.transferredSize)} / ${fmtSize(t.totalSize)}</span>
            <span class="transfer-speed">${fmtSpeed(t.speed)}</span>
          </div>
          ${progressBar(pct)}
          <div class="transfer-actions">
            <button class="btn-sm btn-danger transfer-cancel-btn" data-transfer-id="${esc(t.id)}">Cancel</button>
          </div>
        </div>`
    }
  }

  // Transfer history
  let historySection = ''
  if (history.length === 0) {
    historySection = '<div class="transfer-empty">No transfer history</div>'
  } else {
    for (const t of history) {
      const direction = t.direction === 'upload' ? '\u2191' : '\u2193'
      const statusCls = t.status === 'completed' ? 'transfer-status-ok' : 'transfer-status-err'
      historySection += `
        <div class="transfer-row transfer-history-row">
          <span class="transfer-direction">${direction}</span>
          <span class="transfer-filename">${esc(t.filename || 'unknown')}</span>
          <span class="transfer-peer">${esc(truncId(t.peerId))}</span>
          <span class="transfer-size">${fmtSize(t.totalSize)}</span>
          <span class="transfer-status ${statusCls}">${esc(t.status || 'unknown')}</span>
          <span class="transfer-time">${fmtTime(t.completedAt)}</span>
        </div>`
    }
  }

  return `
    <div class="transfer-panel">
      <div class="transfer-panel-header">
        <span class="transfer-panel-title">File Transfers</span>
      </div>

      <div class="transfer-section">
        <div class="transfer-section-label">Active Transfers</div>
        ${activeSection}
      </div>

      <div class="transfer-dropzone" id="transferDropzone">
        <div class="transfer-dropzone-text">
          Drop files here to send to a peer
        </div>
        <input type="file" id="transferFileInput" class="transfer-file-input" multiple style="display:none" />
        <button class="btn-sm" id="transferBrowseBtn">Browse Files</button>
        <div class="transfer-form-row" style="margin-top:8px">
          <input type="text" id="transferTargetPeer" class="transfer-input" placeholder="Target peer ID" />
        </div>
      </div>

      <div class="transfer-section">
        <div class="transfer-section-label">History</div>
        ${historySection}
      </div>
    </div>`
}

// ── Event Binding ────────────────────────────────────────────────

/**
 * Bind event listeners for file transfer panel controls.
 * @param {object} [opts]
 * @param {Function} [opts.onSend] - (files, targetPeerId) => void
 * @param {Function} [opts.onCancel] - (transferId) => void
 */
export function initTransferListeners(opts = {}) {
  const dropzone = $('transferDropzone')
  const fileInput = $('transferFileInput')
  const browseBtn = $('transferBrowseBtn')
  const targetInput = $('transferTargetPeer')

  // Browse button
  if (browseBtn && fileInput) {
    browseBtn.onclick = () => fileInput.click()
  }

  // File input change
  if (fileInput) {
    fileInput.onchange = () => {
      const files = [...fileInput.files]
      const target = targetInput?.value?.trim()
      if (files.length === 0) return
      if (!target) {
        addErrorMsg('Target peer ID is required')
        return
      }
      if (opts.onSend) opts.onSend(files, target)
      addMsg('system', `Sending ${files.length} file(s) to ${target}...`)
      fileInput.value = ''
    }
  }

  // Drag and drop
  if (dropzone) {
    dropzone.ondragover = (e) => {
      e.preventDefault()
      dropzone.classList.add('transfer-dropzone-active')
    }
    dropzone.ondragleave = () => {
      dropzone.classList.remove('transfer-dropzone-active')
    }
    dropzone.ondrop = (e) => {
      e.preventDefault()
      dropzone.classList.remove('transfer-dropzone-active')
      const files = [...(e.dataTransfer?.files || [])]
      const target = targetInput?.value?.trim()
      if (files.length === 0) return
      if (!target) {
        addErrorMsg('Target peer ID is required')
        return
      }
      if (opts.onSend) opts.onSend(files, target)
      addMsg('system', `Sending ${files.length} file(s) to ${target}...`)
    }
  }

  // Cancel buttons
  document.querySelectorAll('.transfer-cancel-btn').forEach(btn => {
    btn.onclick = () => {
      const transferId = btn.dataset.transferId
      if (opts.onCancel) opts.onCancel(transferId)
      addMsg('system', `Cancelling transfer ${transferId}...`)
    }
  })
}
