/**
 * clawser-ui-mesh.js -- Mesh orchestration dashboard UI panel.
 *
 * Provides a comprehensive overview of the mesh network: pod topology,
 * resource usage, service directory, connection health, and quick actions.
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

function fmtTime(ms) {
  if (!ms) return '--'
  return new Date(ms).toLocaleString()
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '--'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ${sec % 60}s`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

function badge(text, cls = '') {
  return `<span class="mesh-badge ${esc(cls)}">${esc(text)}</span>`
}

function healthIndicator(latencyMs) {
  if (latencyMs == null) return badge('unknown', 'mesh-badge-dim')
  if (latencyMs < 100) return badge('good', 'mesh-badge-ok')
  if (latencyMs < 500) return badge('fair', 'mesh-badge-warn')
  return badge('poor', 'mesh-badge-err')
}

// ── Render ───────────────────────────────────────────────────────

/**
 * Render the mesh orchestration dashboard.
 * @param {object} [opts]
 * @param {object} [opts.localPod] - Local pod info { podId, label, uptime }
 * @param {Array} [opts.peers] - Connected peers array
 * @param {Array} [opts.resources] - Resource pool entries
 * @param {Array} [opts.services] - Service directory entries
 * @returns {string} HTML string
 */
export function renderMeshPanel(opts = {}) {
  const localPod = opts.localPod || {}
  const peers = opts.peers || []
  const resources = opts.resources || []
  const services = opts.services || []

  // ── Pod Topology ──────────────────────────────────
  let topologyRows = ''
  // Local pod row
  topologyRows += `
    <div class="mesh-pod-row mesh-pod-local">
      <span class="mesh-pod-id">${esc(truncId(localPod.podId || 'local'))}</span>
      <span class="mesh-pod-label">${esc(localPod.label || 'This Pod')}</span>
      ${badge('local', 'mesh-badge-primary')}
      <span class="mesh-pod-uptime">${fmtDuration(localPod.uptime)}</span>
    </div>`

  // Connected peers
  if (peers.length === 0) {
    topologyRows += '<div class="mesh-empty">No connected peers</div>'
  } else {
    for (const p of peers) {
      topologyRows += `
        <div class="mesh-pod-row" data-pod-id="${esc(p.podId)}">
          <span class="mesh-pod-id">${esc(truncId(p.podId))}</span>
          <span class="mesh-pod-label">${esc(p.label || '--')}</span>
          ${healthIndicator(p.latency)}
          <span class="mesh-pod-uptime">${fmtDuration(p.uptime)}</span>
          <span class="mesh-pod-seen">${fmtTime(p.lastSeen)}</span>
        </div>`
    }
  }

  // ── Resource Usage ────────────────────────────────
  let resourceRows = ''
  if (resources.length === 0) {
    resourceRows = '<div class="mesh-empty">No resource data</div>'
  } else {
    for (const r of resources) {
      const usagePct = r.capacity > 0 ? ((r.used / r.capacity) * 100).toFixed(0) : 0
      resourceRows += `
        <div class="mesh-resource-row">
          <span class="mesh-resource-pod">${esc(truncId(r.podId))}</span>
          <span class="mesh-resource-type">${esc(r.type || 'cpu')}</span>
          <div class="mesh-resource-bar">
            <div class="mesh-resource-fill" style="width:${usagePct}%"></div>
          </div>
          <span class="mesh-resource-text">${usagePct}%</span>
        </div>`
    }
  }

  // ── Service Directory ─────────────────────────────
  let serviceRows = ''
  if (services.length === 0) {
    serviceRows = '<div class="mesh-empty">No advertised services</div>'
  } else {
    for (const s of services) {
      serviceRows += `
        <div class="mesh-service-row">
          <span class="mesh-service-name">${esc(s.name)}</span>
          <span class="mesh-service-pod">${esc(truncId(s.podId))}</span>
          <span class="mesh-service-version">${esc(s.version || '1.0')}</span>
          ${s.isLocal ? badge('local', 'mesh-badge-primary') : badge('remote', 'mesh-badge-dim')}
        </div>`
    }
  }

  // ── Quick Actions ─────────────────────────────────
  const quickActions = `
    <div class="mesh-actions">
      <button class="btn-sm mesh-action-btn" id="meshExecRemote" title="Execute command on remote pod">Exec Remote</button>
      <button class="btn-sm mesh-action-btn" id="meshDeploySkill" title="Deploy skill to peer">Deploy Skill</button>
      <button class="btn-sm mesh-action-btn" id="meshDrainPod" title="Drain and disconnect a pod">Drain Pod</button>
      <button class="btn-sm mesh-action-btn" id="meshRefresh" title="Refresh mesh status">Refresh</button>
    </div>`

  return `
    <div class="mesh-panel">
      <div class="mesh-panel-header">
        <span class="mesh-panel-title">Mesh Dashboard</span>
        <span class="mesh-panel-count">${peers.length} peer${peers.length !== 1 ? 's' : ''} connected</span>
      </div>

      <div class="mesh-section">
        <div class="mesh-section-label">Pod Topology</div>
        <div class="mesh-topology">${topologyRows}</div>
      </div>

      <div class="mesh-section">
        <div class="mesh-section-label">Resource Usage</div>
        <div class="mesh-resources">${resourceRows}</div>
      </div>

      <div class="mesh-section">
        <div class="mesh-section-label">Service Directory</div>
        <div class="mesh-services">${serviceRows}</div>
      </div>

      <div class="mesh-section">
        <div class="mesh-section-label">Quick Actions</div>
        ${quickActions}
      </div>
    </div>`
}

// ── Event Binding ────────────────────────────────────────────────

/**
 * Bind event listeners for mesh dashboard controls.
 * @param {object} [opts]
 * @param {Function} [opts.onExecRemote] - () => void
 * @param {Function} [opts.onDeploySkill] - () => void
 * @param {Function} [opts.onDrainPod] - () => void
 * @param {Function} [opts.onRefresh] - () => void
 */
export function initMeshListeners(opts = {}) {
  const execBtn = $('meshExecRemote')
  const deployBtn = $('meshDeploySkill')
  const drainBtn = $('meshDrainPod')
  const refreshBtn = $('meshRefresh')

  if (execBtn) {
    execBtn.onclick = () => {
      if (opts.onExecRemote) {
        opts.onExecRemote()
      } else {
        modal('Remote Exec', `
          <div class="mesh-modal-form">
            <div class="mesh-form-row">
              <input type="text" id="meshExecPodId" class="mesh-input" placeholder="Target pod ID" />
            </div>
            <div class="mesh-form-row">
              <input type="text" id="meshExecCommand" class="mesh-input" placeholder="Command" />
            </div>
            <button class="btn-sm" id="meshExecSubmit">Execute</button>
          </div>
        `)
      }
    }
  }

  if (deployBtn) {
    deployBtn.onclick = () => {
      if (opts.onDeploySkill) {
        opts.onDeploySkill()
      } else {
        addMsg('system', 'Deploy Skill: select a skill and target pod')
      }
    }
  }

  if (drainBtn) {
    drainBtn.onclick = () => {
      if (opts.onDrainPod) {
        opts.onDrainPod()
      } else {
        addMsg('system', 'Drain Pod: select a pod to gracefully disconnect')
      }
    }
  }

  if (refreshBtn) {
    refreshBtn.onclick = () => {
      if (opts.onRefresh) opts.onRefresh()
      addMsg('system', 'Refreshing mesh status...')
    }
  }
}
