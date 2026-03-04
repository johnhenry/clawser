/**
 * clawser-ui-peers.js -- P2P peer management UI panels.
 *
 * Provides UI for identity management, contact book, peer connections,
 * and audit log viewing. Pure render + event binding -- no domain logic.
 *
 * Depends on:
 *   - clawser-state.js ($, esc, state, lsKey)
 *   - clawser-modal.js (modal)
 *   - clawser-ui-chat.js (addMsg, addErrorMsg)
 *   - PeerNode, IdentityWallet, PeerRegistry, AuditChain (injected via args)
 */
import { $, esc, state, lsKey } from './clawser-state.js'
import { modal } from './clawser-modal.js'
import { addMsg, addErrorMsg } from './clawser-ui-chat.js'

// ── Helpers ──────────────────────────────────────────────────────

/** Truncate a hex string to a readable prefix + suffix. */
function truncHex(hex, prefixLen = 8, suffixLen = 4) {
  if (!hex || hex.length <= prefixLen + suffixLen + 3) return hex || ''
  return `${hex.slice(0, prefixLen)}...${hex.slice(-suffixLen)}`
}

/** Format a unix-ms timestamp to a locale string. */
function fmtTime(ms) {
  if (!ms) return '--'
  return new Date(ms).toLocaleString()
}

/** Format a duration in ms to a human-readable string. */
function fmtDuration(ms) {
  if (!ms || ms < 0) return '--'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ${sec % 60}s`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

/** Create an HTML badge element string. */
function badge(text, cls = '') {
  return `<span class="peer-badge ${esc(cls)}">${esc(text)}</span>`
}

// ── Identity Wallet Panel ───────────────────────────────────────

/**
 * Render the identity wallet panel showing all identities with
 * create, delete, import, export, and set-default controls.
 *
 * @param {import('./clawser-peer-node.js').PeerNode} peerNode
 * @returns {string} HTML string
 */
export function renderIdentityWallet(peerNode) {
  const wallet = peerNode.wallet
  const identities = wallet.listIdentities()
  const defaultId = wallet.getDefault()

  let rows = ''
  if (identities.length === 0) {
    rows = '<div class="peer-empty">No identities yet. Create one to get started.</div>'
  } else {
    for (const id of identities) {
      const isDefault = defaultId && defaultId.podId === id.podId
      rows += `
        <div class="peer-identity-row ${isDefault ? 'peer-identity-default' : ''}">
          <div class="peer-identity-info">
            <span class="peer-identity-label">${esc(id.label || 'Untitled')}</span>
            ${isDefault ? badge('default', 'peer-badge-primary') : ''}
          </div>
          <div class="peer-identity-pod">${esc(truncHex(id.podId))}</div>
          <div class="peer-identity-created">${fmtTime(id.createdAt)}</div>
          <div class="peer-identity-actions">
            ${!isDefault ? `<button class="btn-sm peer-set-default-btn" data-pod-id="${esc(id.podId)}">Set Default</button>` : ''}
            <button class="btn-sm peer-export-id-btn" data-pod-id="${esc(id.podId)}">Export</button>
            <button class="btn-sm btn-danger peer-delete-id-btn" data-pod-id="${esc(id.podId)}">Delete</button>
          </div>
        </div>`
    }
  }

  return `
    <div class="peer-panel peer-identity-wallet">
      <div class="peer-panel-header">
        <span class="peer-panel-title">Identity Wallet</span>
        <span class="peer-panel-count">${identities.length} identit${identities.length === 1 ? 'y' : 'ies'}</span>
      </div>
      <div class="peer-identity-list">${rows}</div>
      <div class="peer-form-row" id="peerCreateIdentityForm">
        <input type="text" id="peerNewIdentityLabel" class="peer-input" placeholder="Identity label" />
        <button class="btn-sm" id="peerCreateIdentityBtn">Create</button>
        <button class="btn-sm btn-surface2" id="peerImportIdentityBtn">Import</button>
      </div>
    </div>`
}

/**
 * Bind event listeners for identity wallet panel controls.
 *
 * @param {import('./clawser-peer-node.js').PeerNode} peerNode
 */
export function initIdentityWalletListeners(peerNode) {
  const wallet = peerNode.wallet

  // Create identity
  $('peerCreateIdentityBtn')?.addEventListener('click', async () => {
    const labelInput = $('peerNewIdentityLabel')
    const label = labelInput?.value?.trim()
    if (!label) {
      addErrorMsg('Please enter a label for the new identity.')
      return
    }
    try {
      const summary = await wallet.createIdentity(label)
      addMsg('system', `Identity created: ${truncHex(summary.podId)} (${label})`)
      labelInput.value = ''
      _refreshIdentityPanel(peerNode)
    } catch (err) {
      addErrorMsg(`Failed to create identity: ${err.message}`)
    }
  })

  // Import identity
  $('peerImportIdentityBtn')?.addEventListener('click', async () => {
    const raw = await modal.prompt('Paste exported identity JSON:', '')
    if (raw === null) return
    try {
      const exported = JSON.parse(raw)
      const label = exported.label || 'imported'
      const summary = await wallet.importIdentity(exported, label)
      addMsg('system', `Identity imported: ${truncHex(summary.podId)} (${label})`)
      _refreshIdentityPanel(peerNode)
    } catch (err) {
      addErrorMsg(`Import failed: ${err.message}`)
    }
  })

  // Delegate clicks for set-default, export, delete
  const container = document.querySelector('.peer-identity-list')
  if (!container) return

  container.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement} */ (e.target)

    // Set default
    if (target.classList.contains('peer-set-default-btn')) {
      const podId = target.dataset.podId
      try {
        wallet.setDefault(podId)
        addMsg('system', `Default identity set to ${truncHex(podId)}`)
        _refreshIdentityPanel(peerNode)
      } catch (err) {
        addErrorMsg(`Failed to set default: ${err.message}`)
      }
      return
    }

    // Export
    if (target.classList.contains('peer-export-id-btn')) {
      const podId = target.dataset.podId
      try {
        const exported = await wallet.exportIdentity(podId)
        const json = JSON.stringify(exported, null, 2)
        await navigator.clipboard.writeText(json)
        addMsg('system', 'Identity exported to clipboard.')
      } catch (err) {
        addErrorMsg(`Export failed: ${err.message}`)
      }
      return
    }

    // Delete
    if (target.classList.contains('peer-delete-id-btn')) {
      const podId = target.dataset.podId
      const confirmed = await modal.confirm(
        `Delete identity ${truncHex(podId)}? This cannot be undone.`,
        { danger: true, okLabel: 'Delete' }
      )
      if (!confirmed) return
      try {
        wallet.deleteIdentity(podId)
        addMsg('system', `Identity deleted: ${truncHex(podId)}`)
        _refreshIdentityPanel(peerNode)
      } catch (err) {
        addErrorMsg(`Delete failed: ${err.message}`)
      }
    }
  })
}

/** Re-render the identity panel in place. */
function _refreshIdentityPanel(peerNode) {
  const panel = document.querySelector('.peer-identity-wallet')
  if (!panel) return
  panel.outerHTML = renderIdentityWallet(peerNode)
  initIdentityWalletListeners(peerNode)
}

// ── Contact Book Panel ──────────────────────────────────────────

/**
 * Render the contact book showing all contacts with trust levels,
 * permission controls, and add/remove actions.
 *
 * @param {import('./clawser-identity-wallet.js').IdentityWallet} wallet
 * @returns {string} HTML string
 */
export function renderContactBook(wallet) {
  const contacts = wallet.listContacts()

  let rows = ''
  if (contacts.length === 0) {
    rows = '<div class="peer-empty">No contacts. Add a peer\'s public key to get started.</div>'
  } else {
    for (const c of contacts) {
      const trustPct = Math.round(c.trustLevel * 100)
      const trustClass = c.trustLevel >= 0.7 ? 'trust-high'
        : c.trustLevel >= 0.4 ? 'trust-med' : 'trust-low'

      rows += `
        <div class="peer-contact-row">
          <div class="peer-contact-info">
            <span class="peer-contact-label">${esc(c.label)}</span>
            <span class="peer-contact-key" title="${esc(c.publicKeyHex)}">${esc(truncHex(c.publicKeyHex, 12, 6))}</span>
          </div>
          <div class="peer-contact-trust ${trustClass}">
            <span class="peer-trust-bar" style="width:${trustPct}%"></span>
            <span class="peer-trust-label">${trustPct}%</span>
          </div>
          <div class="peer-contact-actions">
            <button class="btn-sm peer-edit-contact-btn" data-key="${esc(c.publicKeyHex)}">Edit</button>
            <button class="btn-sm btn-danger peer-remove-contact-btn" data-key="${esc(c.publicKeyHex)}">Remove</button>
          </div>
        </div>`
    }
  }

  return `
    <div class="peer-panel peer-contact-book">
      <div class="peer-panel-header">
        <span class="peer-panel-title">Contact Book</span>
        <span class="peer-panel-count">${contacts.length} contact${contacts.length === 1 ? '' : 's'}</span>
      </div>
      <div class="peer-contact-list">${rows}</div>
      <div class="peer-form-row" id="peerAddContactForm">
        <input type="text" id="peerContactKeyInput" class="peer-input peer-input-wide" placeholder="Public key (hex)" />
        <input type="text" id="peerContactLabelInput" class="peer-input" placeholder="Label" />
        <button class="btn-sm" id="peerAddContactBtn">Add</button>
      </div>
    </div>`
}

/**
 * Bind event listeners for contact book panel controls.
 *
 * @param {import('./clawser-identity-wallet.js').IdentityWallet} wallet
 */
export function initContactBookListeners(wallet) {
  // Add contact
  $('peerAddContactBtn')?.addEventListener('click', () => {
    const keyInput = $('peerContactKeyInput')
    const labelInput = $('peerContactLabelInput')
    const key = keyInput?.value?.trim()
    const label = labelInput?.value?.trim()

    if (!key) {
      addErrorMsg('Public key is required.')
      return
    }
    if (!label) {
      addErrorMsg('Label is required.')
      return
    }

    try {
      wallet.addContact(key, label)
      addMsg('system', `Contact added: ${label} (${truncHex(key)})`)
      keyInput.value = ''
      labelInput.value = ''
      _refreshContactPanel(wallet)
    } catch (err) {
      addErrorMsg(`Failed to add contact: ${err.message}`)
    }
  })

  // Delegate clicks for edit, remove
  const container = document.querySelector('.peer-contact-list')
  if (!container) return

  container.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement} */ (e.target)

    // Edit contact
    if (target.classList.contains('peer-edit-contact-btn')) {
      const key = target.dataset.key
      const contact = wallet.getContact(key)
      if (!contact) return

      const newLabel = await modal.prompt('Contact label:', contact.label)
      if (newLabel === null) return

      const trustStr = await modal.prompt('Trust level (0-100):', String(Math.round(contact.trustLevel * 100)))
      if (trustStr === null) return

      const trustLevel = Math.max(0, Math.min(100, parseInt(trustStr, 10) || 50)) / 100
      try {
        wallet.updateContact(key, { label: newLabel || contact.label, trustLevel })
        addMsg('system', `Contact updated: ${newLabel || contact.label}`)
        _refreshContactPanel(wallet)
      } catch (err) {
        addErrorMsg(`Update failed: ${err.message}`)
      }
      return
    }

    // Remove contact
    if (target.classList.contains('peer-remove-contact-btn')) {
      const key = target.dataset.key
      const contact = wallet.getContact(key)
      const label = contact?.label || truncHex(key)
      const confirmed = await modal.confirm(
        `Remove contact "${label}"? Their access grants will also be revoked.`,
        { danger: true, okLabel: 'Remove' }
      )
      if (!confirmed) return
      wallet.removeContact(key)
      addMsg('system', `Contact removed: ${label}`)
      _refreshContactPanel(wallet)
    }
  })
}

/** Re-render the contact book in place. */
function _refreshContactPanel(wallet) {
  const panel = document.querySelector('.peer-contact-book')
  if (!panel) return
  panel.outerHTML = renderContactBook(wallet)
  initContactBookListeners(wallet)
}

// ── Connection Panel ────────────────────────────────────────────

/**
 * Render the connection panel showing active sessions, connection
 * controls, and session statistics.
 *
 * @param {import('./clawser-peer-node.js').PeerNode} peerNode
 * @returns {string} HTML string
 */
export function renderConnectionPanel(peerNode) {
  const sessions = peerNode.listSessions()
  const peers = peerNode.listPeers()
  const connectedPeers = peers.filter(p => p.status === 'connected')

  let sessionRows = ''
  if (sessions.length === 0) {
    sessionRows = '<div class="peer-empty">No active sessions.</div>'
  } else {
    for (const s of sessions) {
      const duration = s.connectedAt ? fmtDuration(Date.now() - s.connectedAt) : '--'
      sessionRows += `
        <div class="peer-session-row">
          <div class="peer-session-info">
            <span class="peer-session-id" title="${esc(s.sessionId)}">${esc(truncHex(s.sessionId, 8, 4))}</span>
            <span class="peer-session-peer">${esc(truncHex(s.pubKey))}</span>
          </div>
          <div class="peer-session-meta">
            ${badge(s.transport || 'direct', 'peer-badge-transport')}
            ${badge(s.state || 'active', s.state === 'active' ? 'peer-badge-active' : 'peer-badge-closed')}
            <span class="peer-session-duration">${esc(duration)}</span>
          </div>
          <div class="peer-session-actions">
            <button class="btn-sm btn-danger peer-disconnect-btn" data-pub-key="${esc(s.pubKey)}">Disconnect</button>
          </div>
        </div>`
    }
  }

  return `
    <div class="peer-panel peer-connection-panel">
      <div class="peer-panel-header">
        <span class="peer-panel-title">Connections</span>
        <span class="peer-panel-count">${connectedPeers.length} connected, ${sessions.length} session${sessions.length === 1 ? '' : 's'}</span>
      </div>
      <div class="peer-session-list">${sessionRows}</div>
      <div class="peer-form-row">
        <button class="btn-sm" id="peerConnectBtn">Connect to Peer</button>
        <button class="btn-sm btn-surface2" id="peerDiscoverBtn">Discover</button>
      </div>
    </div>`
}

/**
 * Bind event listeners for connection panel controls.
 *
 * @param {import('./clawser-peer-node.js').PeerNode} peerNode
 */
export function initConnectionListeners(peerNode) {
  // Connect button opens dialog
  $('peerConnectBtn')?.addEventListener('click', () => {
    showConnectDialog(peerNode)
  })

  // Discover button
  $('peerDiscoverBtn')?.addEventListener('click', async () => {
    try {
      const records = await peerNode.discover()
      if (records.length === 0) {
        addMsg('system', 'No peers discovered on the mesh.')
      } else {
        addMsg('system', `Discovered ${records.length} peer${records.length === 1 ? '' : 's'} on the mesh.`)
      }
    } catch (err) {
      addErrorMsg(`Discovery failed: ${err.message}`)
    }
  })

  // Delegate disconnect clicks
  const container = document.querySelector('.peer-session-list')
  if (!container) return

  container.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement} */ (e.target)
    if (!target.classList.contains('peer-disconnect-btn')) return

    const pubKey = target.dataset.pubKey
    const confirmed = await modal.confirm(
      `Disconnect peer ${truncHex(pubKey)}?`,
      { okLabel: 'Disconnect' }
    )
    if (!confirmed) return

    try {
      peerNode.disconnectPeer(pubKey)
      addMsg('system', `Disconnected peer: ${truncHex(pubKey)}`)
      _refreshConnectionPanel(peerNode)
    } catch (err) {
      addErrorMsg(`Disconnect failed: ${err.message}`)
    }
  })
}

/** Re-render the connection panel in place. */
function _refreshConnectionPanel(peerNode) {
  const panel = document.querySelector('.peer-connection-panel')
  if (!panel) return
  panel.outerHTML = renderConnectionPanel(peerNode)
  initConnectionListeners(peerNode)
}

// ── Audit Log Panel ─────────────────────────────────────────────

/**
 * Render the audit log panel with searchable, filterable entries.
 *
 * @param {import('./clawser-peer-node.js').PeerNode} peerNode
 * @returns {string} HTML string
 */
export function renderAuditLog(peerNode) {
  const entries = peerNode.getAuditEntries()

  let tableRows = ''
  if (entries.length === 0) {
    tableRows = '<tr><td colspan="4" class="peer-empty">No audit entries.</td></tr>'
  } else {
    // Show most recent first, limit to 200
    const visible = entries.slice(-200).reverse()
    for (const entry of visible) {
      const data = entry.data || {}
      const details = typeof data === 'object' ? JSON.stringify(data) : String(data)
      const truncDetails = details.length > 120 ? details.slice(0, 120) + '...' : details
      tableRows += `
        <tr class="peer-audit-row" data-operation="${esc(entry.operation || '')}" data-peer="${esc(data.pubKey || data.podId || '')}">
          <td class="peer-audit-time">${fmtTime(entry.timestamp)}</td>
          <td class="peer-audit-op">${esc(entry.operation || '--')}</td>
          <td class="peer-audit-peer">${esc(truncHex(data.pubKey || data.podId || '--'))}</td>
          <td class="peer-audit-details" title="${esc(details)}">${esc(truncDetails)}</td>
        </tr>`
    }
  }

  return `
    <div class="peer-panel peer-audit-log">
      <div class="peer-panel-header">
        <span class="peer-panel-title">Audit Log</span>
        <span class="peer-panel-count">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</span>
      </div>
      <div class="peer-audit-filters">
        <input type="text" id="peerAuditSearch" class="peer-input" placeholder="Search operations..." />
        <select id="peerAuditFilter" class="peer-select">
          <option value="">All operations</option>
          ${_uniqueOperations(entries).map(op => `<option value="${esc(op)}">${esc(op)}</option>`).join('')}
        </select>
        <button class="btn-sm btn-surface2" id="peerAuditExportBtn">Export JSON</button>
      </div>
      <div class="peer-audit-table-wrap">
        <table class="peer-audit-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Operation</th>
              <th>Peer</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody id="peerAuditBody">${tableRows}</tbody>
        </table>
      </div>
    </div>`
}

/** Extract unique operation names from audit entries. */
function _uniqueOperations(entries) {
  const ops = new Set()
  for (const e of entries) {
    if (e.operation) ops.add(e.operation)
  }
  return [...ops].sort()
}

/**
 * Bind event listeners for audit log panel controls.
 *
 * @param {import('./clawser-peer-node.js').PeerNode} peerNode
 */
export function initAuditLogListeners(peerNode) {
  const searchInput = $('peerAuditSearch')
  const filterSelect = $('peerAuditFilter')
  const tbody = $('peerAuditBody')

  function applyFilter() {
    if (!tbody) return
    const query = (searchInput?.value || '').toLowerCase()
    const opFilter = filterSelect?.value || ''

    const rows = tbody.querySelectorAll('.peer-audit-row')
    for (const row of rows) {
      const op = row.dataset.operation || ''
      const peer = row.dataset.peer || ''
      const text = row.textContent?.toLowerCase() || ''

      const matchesOp = !opFilter || op === opFilter
      const matchesSearch = !query || text.includes(query) || op.includes(query) || peer.includes(query)

      row.style.display = (matchesOp && matchesSearch) ? '' : 'none'
    }
  }

  searchInput?.addEventListener('input', applyFilter)
  filterSelect?.addEventListener('change', applyFilter)

  // Export to JSON
  $('peerAuditExportBtn')?.addEventListener('click', () => {
    const entries = peerNode.getAuditEntries()
    const json = JSON.stringify(entries, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `audit-log-${Date.now()}.json`
    const url = a.href
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    addMsg('system', `Exported ${entries.length} audit entries.`)
  })
}

// ── Connect Dialog ──────────────────────────────────────────────

/**
 * Show a modal dialog for connecting to a peer via signaling server,
 * connection token, or share token generation.
 *
 * @param {import('./clawser-peer-node.js').PeerNode} peerNode
 */
export function showConnectDialog(peerNode) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'

  const box = document.createElement('div')
  box.className = 'modal-box peer-connect-dialog'

  box.innerHTML = `
    <div class="modal-title">Connect to Peer</div>
    <div class="peer-connect-tabs">
      <button class="peer-tab-btn peer-tab-active" data-tab="signaling">Signaling Server</button>
      <button class="peer-tab-btn" data-tab="token">Connection Token</button>
      <button class="peer-tab-btn" data-tab="share">Share Token</button>
    </div>

    <div class="peer-tab-content" id="peerTabSignaling">
      <div class="config-group">
        <label>Signaling Server URL</label>
        <input type="text" id="peerSignalingUrl" class="peer-input" placeholder="wss://signal.example.com" />
      </div>
      <div class="config-group">
        <label>Remote Pod ID</label>
        <input type="text" id="peerRemotePodId" class="peer-input" placeholder="Pod ID of peer to connect to" />
      </div>
      <div class="btn-row">
        <button class="btn-sm" id="peerConnectSignalingBtn">Connect</button>
      </div>
    </div>

    <div class="peer-tab-content" id="peerTabToken" style="display:none">
      <div class="config-group">
        <label>Paste Connection Token</label>
        <textarea id="peerConnectionToken" class="peer-textarea" rows="4" placeholder="Paste token from peer..."></textarea>
      </div>
      <div class="btn-row">
        <button class="btn-sm" id="peerConnectTokenBtn">Connect</button>
      </div>
    </div>

    <div class="peer-tab-content" id="peerTabShare" style="display:none">
      <div class="config-group">
        <label>Your Connection Token</label>
        <textarea id="peerShareToken" class="peer-textarea" rows="4" readonly placeholder="Click Generate to create a token"></textarea>
      </div>
      <div class="btn-row">
        <button class="btn-sm" id="peerGenerateTokenBtn">Generate</button>
        <button class="btn-sm btn-surface2" id="peerCopyTokenBtn">Copy</button>
      </div>
    </div>

    <div class="btn-row" style="margin-top:12px">
      <button class="btn-sm btn-surface2" id="peerConnectCancelBtn">Cancel</button>
    </div>
  `

  overlay.appendChild(box)
  document.body.appendChild(overlay)

  // Tab switching
  const tabs = box.querySelectorAll('.peer-tab-btn')
  const tabContents = {
    signaling: box.querySelector('#peerTabSignaling'),
    token: box.querySelector('#peerTabToken'),
    share: box.querySelector('#peerTabShare'),
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const t of tabs) t.classList.remove('peer-tab-active')
      tab.classList.add('peer-tab-active')
      const target = tab.dataset.tab
      for (const [key, el] of Object.entries(tabContents)) {
        if (el) el.style.display = key === target ? '' : 'none'
      }
    })
  }

  function close() {
    overlay.remove()
  }

  // Cancel / overlay click
  box.querySelector('#peerConnectCancelBtn')?.addEventListener('click', close)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })

  // Connect via signaling
  box.querySelector('#peerConnectSignalingBtn')?.addEventListener('click', async () => {
    const url = box.querySelector('#peerSignalingUrl')?.value?.trim()
    const remotePodId = box.querySelector('#peerRemotePodId')?.value?.trim()
    if (!url || !remotePodId) {
      addErrorMsg('Both signaling URL and remote Pod ID are required.')
      return
    }
    try {
      await peerNode.connectToPeer(remotePodId, { websocket: url })
      addMsg('system', `Connected to peer: ${truncHex(remotePodId)}`)
      close()
      _refreshConnectionPanel(peerNode)
    } catch (err) {
      addErrorMsg(`Connection failed: ${err.message}`)
    }
  })

  // Connect via token
  box.querySelector('#peerConnectTokenBtn')?.addEventListener('click', async () => {
    const token = box.querySelector('#peerConnectionToken')?.value?.trim()
    if (!token) {
      addErrorMsg('Please paste a connection token.')
      return
    }
    try {
      const parsed = JSON.parse(token)
      const pubKey = parsed.pubKey || parsed.podId
      if (!pubKey) throw new Error('Token missing pubKey/podId')
      await peerNode.connectToPeer(pubKey, parsed.endpoints || {})
      addMsg('system', `Connected via token to: ${truncHex(pubKey)}`)
      close()
      _refreshConnectionPanel(peerNode)
    } catch (err) {
      addErrorMsg(`Token connection failed: ${err.message}`)
    }
  })

  // Generate share token
  box.querySelector('#peerGenerateTokenBtn')?.addEventListener('click', () => {
    const podId = peerNode.podId
    if (!podId) {
      addErrorMsg('No default identity set. Create one first.')
      return
    }
    const token = JSON.stringify({ podId, timestamp: Date.now() }, null, 2)
    const textarea = box.querySelector('#peerShareToken')
    if (textarea) textarea.value = token
  })

  // Copy share token
  box.querySelector('#peerCopyTokenBtn')?.addEventListener('click', async () => {
    const textarea = box.querySelector('#peerShareToken')
    const text = textarea?.value
    if (!text) {
      addErrorMsg('Generate a token first.')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      addMsg('system', 'Token copied to clipboard.')
    } catch {
      addErrorMsg('Failed to copy to clipboard.')
    }
  })
}

// ── Peer Stats Summary ──────────────────────────────────────────

/**
 * Render a compact peer stats bar.
 *
 * @param {import('./clawser-peer-node.js').PeerNode} peerNode
 * @returns {string} HTML string
 */
export function renderPeerStats(peerNode) {
  const peers = peerNode.listPeers()
  const sessions = peerNode.listSessions()
  const connected = peers.filter(p => p.status === 'connected').length
  const nodeState = peerNode.state

  const stateClass = nodeState === 'running' ? 'peer-state-running'
    : nodeState === 'booting' ? 'peer-state-booting'
    : 'peer-state-stopped'

  return `
    <div class="peer-stats-bar">
      <span class="peer-stat">${badge(nodeState, stateClass)}</span>
      <span class="peer-stat">${peers.length} peer${peers.length === 1 ? '' : 's'}</span>
      <span class="peer-stat">${connected} connected</span>
      <span class="peer-stat">${sessions.length} session${sessions.length === 1 ? '' : 's'}</span>
      ${peerNode.podId ? `<span class="peer-stat peer-stat-pod" title="${esc(peerNode.podId)}">Pod: ${esc(truncHex(peerNode.podId))}</span>` : ''}
    </div>`
}
