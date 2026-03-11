/**
 * clawser-ui-remote.js -- Remote access UI panels.
 *
 * Provides the canonical remote-runtime UI: route inspection, terminal,
 * remote files, and peer-scoped services. Pure render + event binding.
 *
 * Depends on:
 *   - clawser-state.js ($, esc)
 *   - clawser-modal.js (modal)
 *   - clawser-ui-chat.js (addMsg, addErrorMsg)
 */
import { $, esc } from './clawser-state.js'
import { modal } from './clawser-modal.js'
import { addMsg, addErrorMsg } from './clawser-ui-chat.js'
import { supportHintsForRuntime } from './clawser-remote-runtime-types.js'

// ── Helpers ──────────────────────────────────────────────────────

/** Truncate a hex or ID string for display. */
function truncId(id, prefixLen = 8, suffixLen = 4) {
  if (!id || id.length <= prefixLen + suffixLen + 3) return id || ''
  return `${id.slice(0, prefixLen)}...${id.slice(-suffixLen)}`
}

/** Format a unix-ms timestamp to a locale time string. */
function fmtTime(ms) {
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString()
}

/** Format a file size in bytes to human-readable. */
function fmtSize(bytes) {
  if (bytes == null) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

/** File type icon. */
function fileIcon(type) {
  return type === 'directory' ? '\u{1F4C1}' : '\u{1F4C4}'
}

function runtimeLabel(peer) {
  if (!peer) return ''
  return `${peer.peerType || 'host'} / ${peer.shellBackend || 'pty'}`
}

function peerLastSeen(peer) {
  const values = (peer?.reachability || [])
    .map((route) => Number.isFinite(route?.lastSeen) ? route.lastSeen : null)
    .filter((value) => value != null)
  if (!values.length) return ''
  return fmtTime(Math.max(...values))
}

function peerDisplayId(peer) {
  if (!peer) return ''
  return peer.identity?.fingerprint
    || peer.identity?.podId
    || peer.identity?.canonicalId
    || peer.username
    || ''
}

function sessionSupportSummary(peer) {
  const hints = supportHintsForRuntime(peer)
  const flags = []
  if (peer?.supportsAttach ?? hints.supportsAttach) flags.push('attach')
  if (peer?.supportsReplay ?? hints.supportsReplay) flags.push(`replay:${peer?.metadata?.replayMode || hints.replayMode}`)
  if (peer?.supportsEcho ?? hints.supportsEcho) flags.push('echo')
  if (peer?.supportsTermSync ?? hints.supportsTermSync) flags.push('sync')
  return flags.length ? flags.join(', ') : 'none'
}

// ── Remote Terminal Panel ───────────────────────────────────────

/**
 * Render the remote terminal panel with output area and command input.
 *
 * @param {import('./clawser-peer-terminal.js').TerminalClient} terminalClient
 * @param {object} session - Session info
 * @returns {string} HTML string
 */
export function renderRemoteTerminal(terminalClient, session) {
  const title = session?.terminalTitle || 'Remote Terminal'
  const welcome = session?.terminalWelcome || 'Connected to remote shell. Type a command below.'
  return `
    <div class="rc-panel rc-terminal-panel">
      <div class="rc-panel-header">
        <span class="rc-panel-title">${esc(title)}</span>
        <span class="rc-panel-peer" title="${esc(session.pubKey || '')}">${esc(truncId(session.pubKey || session.remotePodId || ''))}</span>
      </div>
      <div class="rc-terminal-output" id="rcTerminalOutput">
        <div class="rc-terminal-welcome">${esc(welcome)}</div>
      </div>
      <div class="rc-terminal-input-row">
        <span class="rc-terminal-prompt">$</span>
        <input type="text" id="rcTerminalInput" class="rc-input rc-terminal-input" placeholder="Enter command..." autocomplete="off" />
        <button class="btn-sm" id="rcTerminalExecBtn">Run</button>
      </div>
    </div>`
}

/**
 * Bind event listeners for the remote terminal panel.
 *
 * @param {import('./clawser-peer-terminal.js').TerminalClient} terminalClient
 */
export function initRemoteTerminalListeners(terminalClient) {
  const input = $('rcTerminalInput')
  const execBtn = $('rcTerminalExecBtn')
  const outputEl = $('rcTerminalOutput')

  /** Command history for up/down arrow navigation. */
  const cmdHistory = []
  let historyIdx = -1

  async function executeCommand() {
    const command = input?.value?.trim()
    if (!command) return

    // Add to history
    cmdHistory.push(command)
    historyIdx = cmdHistory.length

    // Show command in output
    _appendTerminalLine(outputEl, `$ ${command}`, 'rc-term-cmd')
    input.value = ''

    try {
      const result = await terminalClient.execute(command)
      const output = result?.output ?? result?.result ?? ''
      const exitCode = result?.exitCode ?? 0
      if (output) {
        _appendTerminalLine(outputEl, output, 'rc-term-output')
      }
      if (exitCode !== 0) {
        _appendTerminalLine(outputEl, `Exit code: ${exitCode}`, 'rc-term-error')
      }
    } catch (err) {
      _appendTerminalLine(outputEl, `Error: ${err.message}`, 'rc-term-error')
    }
  }

  execBtn?.addEventListener('click', executeCommand)
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      executeCommand()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (historyIdx > 0) {
        historyIdx--
        input.value = cmdHistory[historyIdx] || ''
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIdx < cmdHistory.length - 1) {
        historyIdx++
        input.value = cmdHistory[historyIdx] || ''
      } else {
        historyIdx = cmdHistory.length
        input.value = ''
      }
    }
  })

  // Focus the input
  input?.focus()
}

/** Append a line to the terminal output. */
function _appendTerminalLine(container, text, cls = '') {
  if (!container) return
  const line = document.createElement('div')
  line.className = `rc-term-line ${cls}`
  line.textContent = text
  container.appendChild(line)
  container.scrollTop = container.scrollHeight
}

// ── Remote File Browser Panel ───────────────────────────────────

/**
 * Render the remote file browser panel with directory listing,
 * breadcrumbs, and file action buttons.
 *
 * @param {import('./clawser-peer-files.js').FileClient} fileClient
 * @param {object} session - Session info
 * @returns {string} HTML string
 */
export function renderRemoteFiles(fileClient, session) {
  return `
    <div class="rc-panel rc-files-panel">
      <div class="rc-panel-header">
        <span class="rc-panel-title">Remote Files</span>
        <span class="rc-panel-peer" title="${esc(session.pubKey || '')}">${esc(truncId(session.pubKey || session.remotePodId || ''))}</span>
      </div>
      <div class="rc-files-breadcrumb" id="rcFilesBreadcrumb">
        <span class="rc-breadcrumb-part rc-breadcrumb-link" data-path="/">/</span>
      </div>
      <div class="rc-files-list" id="rcFilesList">
        <div class="rc-empty">Loading...</div>
      </div>
      <div class="rc-files-actions">
        <button class="btn-sm" id="rcFilesRefreshBtn">Refresh</button>
        <button class="btn-sm btn-surface2" id="rcFilesUploadBtn">Upload</button>
      </div>
    </div>`
}

/**
 * Bind event listeners for the remote file browser panel.
 *
 * @param {import('./clawser-peer-files.js').FileClient} fileClient
 */
export function initRemoteFilesListeners(fileClient) {
  let currentPath = '/'

  async function loadDirectory(path) {
    currentPath = path
    const listEl = $('rcFilesList')
    if (!listEl) return

    listEl.innerHTML = '<div class="rc-empty">Loading...</div>'
    _updateBreadcrumb(path)

    try {
      const entries = await fileClient.listFiles(path)
      listEl.innerHTML = ''

      if (path !== '/') {
        const backEl = document.createElement('div')
        backEl.className = 'rc-file-item rc-file-back'
        backEl.textContent = '\u{1F4C1} .. (back)'
        backEl.addEventListener('click', () => {
          const parentPath = path.replace(/[^/]+\/$/, '') || '/'
          loadDirectory(parentPath)
        })
        listEl.appendChild(backEl)
      }

      if (!entries || entries.length === 0) {
        const emptyDiv = document.createElement('div')
        emptyDiv.className = 'rc-empty'
        emptyDiv.textContent = 'Empty directory.'
        listEl.appendChild(emptyDiv)
        return
      }

      // Sort: directories first, then alphabetical
      const sorted = [...entries].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return (a.name || '').localeCompare(b.name || '')
      })

      for (const entry of sorted) {
        const item = document.createElement('div')
        item.className = 'rc-file-item'
        item.dataset.path = `${path}${path.endsWith('/') ? '' : '/'}${entry.name}`
        item.dataset.type = entry.type || 'file'
        item.innerHTML = `
          <span class="rc-file-icon">${fileIcon(entry.type)}</span>
          <span class="rc-file-name">${esc(entry.name)}</span>
          <span class="rc-file-size">${entry.type === 'directory' ? '--' : fmtSize(entry.size)}</span>
          <span class="rc-file-actions-inline">
            ${entry.type !== 'directory' ? `<button class="btn-sm rc-file-download-btn" data-path="${esc(item.dataset.path)}">Download</button>` : ''}
            <button class="btn-sm btn-danger rc-file-delete-btn" data-path="${esc(item.dataset.path)}">Delete</button>
          </span>`

        // Click to navigate into directory
        item.addEventListener('click', (e) => {
          if (e.target.tagName === 'BUTTON') return
          if (entry.type === 'directory') {
            loadDirectory(`${path}${path.endsWith('/') ? '' : '/'}${entry.name}/`)
          }
        })

        listEl.appendChild(item)
      }

    } catch (err) {
      listEl.innerHTML = `<div class="rc-error">Error: ${esc(err.message)}</div>`
    }
  }

  // File action delegation — set up ONCE, not inside loadDirectory
  $('rcFilesList')?.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement} */ (e.target)

    // Download
    if (target.classList.contains('rc-file-download-btn')) {
      const filePath = target.dataset.path
      try {
        const result = await fileClient.readFile(filePath)
        const data = result?.data
        if (data) {
          const blob = data instanceof Uint8Array
            ? new Blob([data])
            : new Blob([data], { type: 'text/plain' })
          const a = document.createElement('a')
          const url = URL.createObjectURL(blob)
          a.href = url
          a.download = filePath.split('/').pop() || 'download'
          a.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
          addMsg('system', `Downloaded: ${filePath}`)
        }
      } catch (err) {
        addErrorMsg(`Download failed: ${err.message}`)
      }
      return
    }

    // Delete
    if (target.classList.contains('rc-file-delete-btn')) {
      const filePath = target.dataset.path
      const confirmed = await modal.confirm(
        `Delete remote file "${filePath}"?`,
        { danger: true, okLabel: 'Delete' }
      )
      if (!confirmed) return
      try {
        await fileClient.deleteFile(filePath)
        addMsg('system', `Deleted: ${filePath}`)
        loadDirectory(currentPath)
      } catch (err) {
        addErrorMsg(`Delete failed: ${err.message}`)
      }
    }
  })

  // Refresh button
  $('rcFilesRefreshBtn')?.addEventListener('click', () => loadDirectory(currentPath))

  // Upload button
  $('rcFilesUploadBtn')?.addEventListener('click', async () => {
    const filename = await modal.prompt('File name to create:', '')
    if (!filename) return
    const content = await modal.prompt('File content:', '')
    if (content === null) return
    const fullPath = `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${filename}`
    try {
      await fileClient.writeFile(fullPath, content)
      addMsg('system', `Uploaded: ${fullPath}`)
      loadDirectory(currentPath)
    } catch (err) {
      addErrorMsg(`Upload failed: ${err.message}`)
    }
  })

  // Breadcrumb clicks
  const breadcrumb = $('rcFilesBreadcrumb')
  breadcrumb?.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target)
    if (target.classList.contains('rc-breadcrumb-link')) {
      const path = target.dataset.path
      if (path) loadDirectory(path)
    }
  })

  // Initial load
  loadDirectory('/')
}

/** Update the breadcrumb display for a given path. */
function _updateBreadcrumb(path) {
  const el = $('rcFilesBreadcrumb')
  if (!el) return

  const parts = path.split('/').filter(Boolean)
  let html = '<span class="rc-breadcrumb-part rc-breadcrumb-link" data-path="/">/</span>'
  let accumulated = '/'
  for (const part of parts) {
    accumulated += `${part}/`
    html += ` <span class="rc-breadcrumb-sep">/</span> `
    html += `<span class="rc-breadcrumb-part rc-breadcrumb-link" data-path="${esc(accumulated)}">${esc(part)}</span>`
  }
  el.innerHTML = html
}

export function renderRemoteServiceList(services = [], {
  title = 'Peer Services',
  countLabel = null,
} = {}) {
  const safeServices = Array.isArray(services) ? services : []
  const types = new Set()
  for (const svc of safeServices) {
    if (svc?.type) types.add(svc.type)
  }

  let tableRows = ''
  if (safeServices.length === 0) {
    tableRows = '<tr><td colspan="5" class="rc-empty">No services advertised.</td></tr>'
  } else {
    for (const svc of safeServices) {
      tableRows += `
        <tr class="rc-svc-row" data-type="${esc(svc.type || '')}" data-pod="${esc(svc.podId || '')}">
          <td class="rc-svc-name">${esc(svc.name || '--')}</td>
          <td class="rc-svc-type"><span class="rc-svc-type-badge">${esc(svc.type || '--')}</span></td>
          <td class="rc-svc-pod" title="${esc(svc.podId || '')}">${esc(truncId(svc.podId || ''))}</td>
          <td class="rc-svc-version">${esc(svc.version || '--')}</td>
          <td class="rc-svc-address" title="${esc(svc.address || '')}">${esc(truncId(svc.address || '', 16, 0))}</td>
        </tr>`
    }
  }

  return `
    <div class="rc-panel rc-service-browser">
      <div class="rc-panel-header">
        <span class="rc-panel-title">${esc(title)}</span>
        <span class="rc-panel-count">${esc(countLabel || `${safeServices.length} service${safeServices.length === 1 ? '' : 's'}`)}</span>
      </div>
      <div class="rc-svc-filters">
        <select id="rcSvcTypeFilter" class="rc-select">
          <option value="">All types</option>
          ${[...types].sort().map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
        </select>
      </div>
      <div class="rc-svc-table-wrap">
        <table class="rc-svc-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Peer</th>
              <th>Version</th>
              <th>Address</th>
            </tr>
          </thead>
          <tbody id="rcSvcBody">${tableRows}</tbody>
        </table>
      </div>
    </div>`
}

export function renderRemoteRuntimePanel(runtimeRegistry, {
  activeSelector = null,
  activeView = null,
  routeExplanation = null,
  activeServices = [],
  error = null,
} = {}) {
  const peers = runtimeRegistry?.listPeers?.() || []
  const activePeer = activeSelector ? runtimeRegistry?.resolvePeer?.(activeSelector) : null

  let peerRows = ''
  if (peers.length === 0) {
    peerRows = '<div class="rc-empty">No remote runtimes discovered yet.</div>'
  } else {
    peerRows = peers.map((peer) => {
      const selector = peer.identity?.canonicalId || ''
      const active = selector === activeSelector
      const hasExec = peer.capabilities?.includes('exec') || peer.capabilities?.includes('shell')
      const hasFiles = peer.capabilities?.includes('fs')
      const hasServices = ((peer.metadata?.serviceDetails || peer.metadata?.services || []).length > 0)
      const sources = (peer.sources || []).join(', ')
      return `
        <div class="rc-runtime-row ${active ? 'rc-runtime-row-active' : ''}" data-selector="${esc(selector)}">
          <div class="rc-runtime-summary">
            <div class="rc-runtime-summary-main">
              <span class="rc-runtime-name">${esc(peer.username || truncId(selector))}</span>
              <span class="rc-runtime-backend">${esc(runtimeLabel(peer))}</span>
            </div>
            <div class="rc-runtime-summary-meta">
              <span class="rc-runtime-id" title="${esc(peerDisplayId(peer))}">${esc(truncId(peerDisplayId(peer) || selector))}</span>
              <span class="rc-runtime-last-seen">${esc(peerLastSeen(peer) || sources || '--')}</span>
            </div>
          </div>
          <div class="rc-runtime-session-hints">${esc(sessionSupportSummary(peer))}</div>
          <div class="rc-runtime-capabilities">
            ${(peer.capabilities || []).map((cap) => `<span class="rc-svc-type-badge">${esc(cap)}</span>`).join('') || '<span class="rc-empty">No capabilities</span>'}
          </div>
          <div class="rc-runtime-actions">
            <button class="btn-sm rc-runtime-open-btn" data-selector="${esc(selector)}" data-view="terminal" ${hasExec ? '' : 'disabled'}>Shell</button>
            <button class="btn-sm rc-runtime-open-btn" data-selector="${esc(selector)}" data-view="files" ${hasFiles ? '' : 'disabled'}>Files</button>
            <button class="btn-sm rc-runtime-open-btn" data-selector="${esc(selector)}" data-view="services" ${hasServices ? '' : 'disabled'}>Services</button>
            <button class="btn-sm btn-surface2 rc-runtime-route-btn" data-selector="${esc(selector)}">Route</button>
          </div>
        </div>`
    }).join('')
  }

  let detailHtml = `
    <div class="rc-panel rc-runtime-detail rc-runtime-detail-empty">
      <div class="rc-panel-header">
        <span class="rc-panel-title">Remote Runtime</span>
      </div>
      <div class="rc-empty">Select a peer to inspect its route, shell, files, or services.</div>
    </div>`

  if (activePeer && activeView?.kind === 'terminal') {
    const isVmGuest = activePeer.peerType === 'vm-guest' || activePeer.shellBackend === 'vm-console'
    detailHtml = renderRemoteTerminal(activeView.client, {
      pubKey: peerDisplayId(activePeer),
      remotePodId: activePeer.identity?.canonicalId,
      terminalTitle: isVmGuest ? 'VM Guest Console' : 'Remote Terminal',
      terminalWelcome: isVmGuest
        ? 'Connected to a browser-hosted VM console. Terminal behavior is guest-backed, not a host PTY.'
        : 'Connected to remote shell. Type a command below.',
    })
  } else if (activePeer && activeView?.kind === 'files') {
    detailHtml = renderRemoteFiles(activeView.client, {
      pubKey: peerDisplayId(activePeer),
      remotePodId: activePeer.identity?.canonicalId,
    })
  } else if (activePeer && activeView?.kind === 'services') {
    detailHtml = renderRemoteServiceList(activeServices, {
      title: `${activePeer.username} Services`,
    })
  }

  return `
    <div class="rc-runtime-browser">
      <div class="rc-panel rc-runtime-list">
        <div class="rc-panel-header">
          <span class="rc-panel-title">Remote Runtimes</span>
          <span class="rc-panel-count">${peers.length} peer${peers.length === 1 ? '' : 's'}</span>
        </div>
        ${error ? `<div class="rc-error">${esc(error)}</div>` : ''}
        <div class="rc-runtime-list-body">${peerRows}</div>
      </div>
      <div class="rc-runtime-detail-wrap">
        ${routeExplanation ? `
          <div class="rc-panel rc-runtime-route">
            <div class="rc-panel-header">
              <span class="rc-panel-title">Route</span>
              <span class="rc-panel-count">${esc(routeExplanation.connectionKind || routeExplanation.route?.kind || '--')}</span>
            </div>
            <div class="rc-runtime-route-reason">${esc(routeExplanation.reason || '')}</div>
            <div class="rc-runtime-route-meta">
              <span>Intent: ${esc(routeExplanation.target?.intent || '--')}</span>
              <span>Capabilities: ${esc((routeExplanation.descriptor?.capabilities || []).join(', ') || '--')}</span>
              <span>Health: ${esc(routeExplanation.health?.health || routeExplanation.route?.health || '--')}</span>
              <span>Replay: ${esc(routeExplanation.resumability?.replayMode || routeExplanation.descriptor?.metadata?.replayMode || '--')}</span>
            </div>
            ${routeExplanation.failure ? `<div class="rc-runtime-route-warning">Failure: ${esc(routeExplanation.failure.layer || '--')} / ${esc(routeExplanation.failure.code || '--')}</div>` : ''}
            ${routeExplanation.health?.lastOutcomeLayer ? `<div class="rc-runtime-route-warning">Layer: ${esc(routeExplanation.health.lastOutcomeLayer)}</div>` : ''}
            ${routeExplanation.health?.lastOutcomeReason ? `<div class="rc-runtime-route-warning">Last failure: ${esc(routeExplanation.health.lastOutcomeReason)}</div>` : ''}
            ${routeExplanation.warnings?.length ? `<div class="rc-runtime-route-warning">${esc(routeExplanation.warnings.join(' | '))}</div>` : ''}
            ${routeExplanation.alternatives?.length ? `<div class="rc-runtime-route-meta">Fallbacks: ${esc(routeExplanation.alternatives.map((route) => `${route.kind}:${route.health}`).join(', '))}</div>` : ''}
          </div>` : ''}
        ${detailHtml}
      </div>
    </div>`
}

export function initRemoteRuntimePanelListeners({
  onOpenView = null,
  onExplainRoute = null,
} = {}) {
  document.querySelector('.rc-runtime-list-body')?.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target)
    if (target.classList.contains('rc-runtime-open-btn')) {
      const selector = target.dataset.selector
      const view = target.dataset.view
      if (selector && view) {
        onOpenView?.(selector, view)
      }
      return
    }
    if (target.classList.contains('rc-runtime-route-btn')) {
      const selector = target.dataset.selector
      if (selector) {
        onExplainRoute?.(selector)
      }
    }
  })
}

// ── Peer Status Badge ───────────────────────────────────────────

/**
 * Update the header badge showing connected peer count.
 * Looks for an element with id "peerBadge" and updates its text.
 *
 * @param {import('./clawser-peer-node.js').PeerNode} peerNode
 */
export function updatePeerBadge(peerNode) {
  const badge = $('peerBadge')
  if (!badge) return

  if (!peerNode || peerNode.state !== 'running') {
    badge.textContent = 'offline'
    badge.className = 'peer-badge-indicator peer-badge-offline'
    return
  }

  const peers = peerNode.listPeers()
  const connected = peers.filter(p => p.status === 'connected').length

  badge.textContent = `${connected} peer${connected === 1 ? '' : 's'}`
  badge.className = connected > 0
    ? 'peer-badge-indicator peer-badge-online'
    : 'peer-badge-indicator peer-badge-idle'
}
