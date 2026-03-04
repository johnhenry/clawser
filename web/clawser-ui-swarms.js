/**
 * clawser-ui-swarms.js -- Swarm management UI panel.
 *
 * Provides UI for viewing/joining/leaving swarms, creating new swarms,
 * viewing per-swarm member lists, and task distribution.
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

/** Truncate an ID string to a readable prefix. */
function truncId(id, len = 12) {
  if (!id || id.length <= len) return id || ''
  return id.slice(0, len) + '...'
}

/** Format a unix-ms timestamp to a locale string. */
function fmtTime(ms) {
  if (!ms) return '--'
  return new Date(ms).toLocaleString()
}

/** Create an HTML badge element string. */
function badge(text, cls = '') {
  return `<span class="swarm-badge ${esc(cls)}">${esc(text)}</span>`
}

/** Badge with role-specific styling. */
function roleBadge(role) {
  const cls = role === 'leader' ? 'swarm-badge-primary'
    : role === 'observer' ? 'swarm-badge-dim' : ''
  return badge(role, cls)
}

/** Status badge with colour class. */
function statusBadge(status) {
  const cls = status === 'active' || status === 'executing' ? 'swarm-badge-active'
    : status === 'completed' ? 'swarm-badge-success'
    : status === 'failed' || status === 'disbanded' ? 'swarm-badge-danger'
    : ''
  return badge(status, cls)
}

/** Format a progress percentage into a mini bar. */
function progressBar(pct) {
  return `<div class="swarm-progress"><div class="swarm-progress-fill" style="width:${pct}%"></div><span class="swarm-progress-label">${pct}%</span></div>`
}

// ── Render ───────────────────────────────────────────────────────

/**
 * Render the swarm management panel.
 *
 * @param {object} [opts]
 * @param {Array}  [opts.swarms]     - Array of SwarmInstance-like objects
 * @param {string} [opts.localPodId] - Local pod identifier
 * @returns {string} HTML string
 */
export function renderSwarmPanel(opts = {}) {
  const swarms = opts.swarms || []
  const localPodId = opts.localPodId || ''

  let swarmCards = ''
  if (swarms.length === 0) {
    swarmCards = '<div class="swarm-empty">No active swarms. Create or join one.</div>'
  } else {
    for (const swarm of swarms) {
      swarmCards += _renderSwarmCard(swarm, localPodId)
    }
  }

  return `
    <div class="swarm-panel">
      <div class="swarm-panel-header">
        <span class="swarm-panel-title">Swarm Management</span>
        <span class="swarm-panel-count">${swarms.length} swarm${swarms.length === 1 ? '' : 's'}</span>
        <button class="btn-sm" id="swarmCreateBtn">Create Swarm</button>
      </div>
      <div class="swarm-list">${swarmCards}</div>
      <div class="swarm-create-form" id="swarmCreateForm" style="display:none">
        <div class="swarm-form-title">New Swarm</div>
        <div class="swarm-form-row">
          <label>Goal / Name</label>
          <input type="text" id="swarmGoalInput" class="swarm-input" placeholder="Describe the swarm goal" />
        </div>
        <div class="swarm-form-row">
          <label>Strategy</label>
          <select id="swarmStrategySelect" class="swarm-select">
            <option value="round_robin">Round Robin</option>
            <option value="leader_decompose">Leader Decompose</option>
            <option value="capability_match">Capability Match</option>
            <option value="collective_vote">Collective Vote</option>
          </select>
        </div>
        <div class="swarm-form-row">
          <label>Max Agents</label>
          <input type="number" id="swarmMaxAgents" class="swarm-input" value="10" min="2" max="100" />
        </div>
        <div class="swarm-form-row">
          <label>Members (comma-separated pod IDs)</label>
          <input type="text" id="swarmMembersInput" class="swarm-input" placeholder="podId1, podId2, ..." />
        </div>
        <div class="swarm-form-row">
          <button class="btn-sm" id="swarmSubmitCreate">Create</button>
          <button class="btn-sm btn-surface2" id="swarmCancelCreate">Cancel</button>
        </div>
      </div>
    </div>`
}

/**
 * Render a single swarm card.
 *
 * @param {object} swarm  - SwarmInstance-like object
 * @param {string} localPodId
 * @returns {string} HTML string
 */
function _renderSwarmCard(swarm, localPodId) {
  const isMember = (swarm.members || []).includes(localPodId)
  const isLeader = swarm.leader === localPodId
  const memberCount = swarm.members?.length || 0

  // Members list
  let memberRows = ''
  if (swarm.members && swarm.members.length > 0) {
    for (const podId of swarm.members) {
      const role = podId === swarm.leader ? 'leader' : 'worker'
      memberRows += `
        <div class="swarm-member-row">
          <span class="swarm-member-id" title="${esc(podId)}">${esc(truncId(podId))}</span>
          ${roleBadge(role)}
        </div>`
    }
  }

  // Subtasks / task distribution
  let taskSection = ''
  if (swarm.subtasks && swarm.subtasks.length > 0) {
    const progress = _getProgress(swarm.subtasks)
    const taskRows = swarm.subtasks.map(st => {
      const stStatus = st.status || 'pending'
      const statusCls = stStatus === 'completed' ? 'swarm-task-done'
        : stStatus === 'failed' ? 'swarm-task-failed'
        : stStatus === 'running' ? 'swarm-task-running'
        : ''
      return `
        <div class="swarm-task-row ${statusCls}">
          <span class="swarm-task-desc" title="${esc(st.description || st.id)}">${esc(truncId(st.description || st.id, 40))}</span>
          <span class="swarm-task-assignee">${esc(truncId(st.assignee || 'unassigned'))}</span>
          ${badge(stStatus)}
        </div>`
    }).join('')

    taskSection = `
      <div class="swarm-tasks">
        <div class="swarm-section-label">Tasks (${progress.completed}/${progress.total})</div>
        ${progressBar(progress.pct)}
        ${taskRows}
      </div>`
  }

  // Action buttons
  let actions = ''
  if (swarm.status === 'disbanded' || swarm.status === 'completed') {
    actions = `<button class="btn-sm btn-surface2 swarm-remove-btn" data-swarm-id="${esc(swarm.id)}">Remove</button>`
  } else if (isMember) {
    actions = `<button class="btn-sm btn-danger swarm-leave-btn" data-swarm-id="${esc(swarm.id)}">Leave</button>`
    if (isLeader) {
      actions += ` <button class="btn-sm btn-danger swarm-disband-btn" data-swarm-id="${esc(swarm.id)}">Disband</button>`
    }
  } else {
    actions = `<button class="btn-sm swarm-join-btn" data-swarm-id="${esc(swarm.id)}">Join</button>`
  }

  return `
    <div class="swarm-card" data-swarm-id="${esc(swarm.id)}">
      <div class="swarm-card-header">
        <span class="swarm-name" title="${esc(swarm.goal || swarm.id)}">${esc(truncId(swarm.goal || swarm.id, 50))}</span>
        <span class="swarm-meta">
          ${badge(memberCount + ' member' + (memberCount !== 1 ? 's' : ''))}
          ${isLeader ? badge('leader', 'swarm-badge-primary') : ''}
          ${statusBadge(swarm.status || 'forming')}
        </span>
      </div>
      <div class="swarm-card-strategy">
        <span class="swarm-section-label">Strategy</span>
        ${badge(swarm.strategy || 'round_robin', 'swarm-badge-dim')}
      </div>
      <div class="swarm-members">
        <div class="swarm-section-label">Members</div>
        ${memberRows || '<div class="swarm-empty">No members</div>'}
      </div>
      ${taskSection}
      <div class="swarm-card-actions">${actions}</div>
    </div>`
}

/**
 * Compute progress from a subtask array.
 *
 * @param {Array} subtasks
 * @returns {{ total: number, completed: number, failed: number, pct: number }}
 */
function _getProgress(subtasks) {
  const total = subtasks.length
  if (total === 0) return { total: 0, completed: 0, failed: 0, pct: 0 }
  const completed = subtasks.filter(st => st.status === 'completed').length
  const failed = subtasks.filter(st => st.status === 'failed').length
  const pct = Math.round((completed / total) * 100)
  return { total, completed, failed, pct }
}

// ── Event Binding ────────────────────────────────────────────────

/**
 * Bind event listeners for swarm panel controls.
 *
 * @param {object} [opts]
 * @param {Function} [opts.onJoin]    - (swarmId) => void
 * @param {Function} [opts.onLeave]   - (swarmId) => void
 * @param {Function} [opts.onDisband] - (swarmId) => void
 * @param {Function} [opts.onRemove]  - (swarmId) => void
 * @param {Function} [opts.onCreate]  - ({ goal, strategy, maxAgents, members }) => void
 * @param {Function} [opts.onRefresh] - () => void  — called after mutations
 */
export function initSwarmListeners(opts = {}) {
  const createBtn = $('swarmCreateBtn')
  const form = $('swarmCreateForm')
  const submitBtn = $('swarmSubmitCreate')
  const cancelBtn = $('swarmCancelCreate')

  // Toggle create form
  if (createBtn && form) {
    createBtn.addEventListener('click', () => {
      form.style.display = form.style.display === 'none' ? 'block' : 'none'
    })
  }

  if (cancelBtn && form) {
    cancelBtn.addEventListener('click', () => {
      form.style.display = 'none'
    })
  }

  // Submit create
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      const goal = $('swarmGoalInput')?.value?.trim()
      const strategy = $('swarmStrategySelect')?.value || 'round_robin'
      const maxAgents = parseInt($('swarmMaxAgents')?.value || '10', 10)
      const membersRaw = $('swarmMembersInput')?.value?.trim() || ''
      const members = membersRaw ? membersRaw.split(',').map(s => s.trim()).filter(Boolean) : []

      if (!goal) {
        addErrorMsg('Swarm goal is required.')
        return
      }

      if (opts.onCreate) {
        opts.onCreate({ goal, strategy, maxAgents, members })
      }
      if (form) form.style.display = 'none'
      addMsg('system', `Swarm creation requested: "${goal}"`)
    })
  }

  // Delegate clicks for join, leave, disband, remove
  const container = document.querySelector('.swarm-list')
  if (!container) return

  container.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement} */ (e.target)

    // Join
    if (target.classList.contains('swarm-join-btn')) {
      const swarmId = target.dataset.swarmId
      if (opts.onJoin) opts.onJoin(swarmId)
      addMsg('system', `Joining swarm ${truncId(swarmId)}...`)
      return
    }

    // Leave
    if (target.classList.contains('swarm-leave-btn')) {
      const swarmId = target.dataset.swarmId
      const confirmed = await modal.confirm(
        `Leave swarm ${truncId(swarmId)}?`,
        { okLabel: 'Leave' }
      )
      if (!confirmed) return
      if (opts.onLeave) opts.onLeave(swarmId)
      addMsg('system', `Left swarm ${truncId(swarmId)}`)
      if (opts.onRefresh) opts.onRefresh()
      return
    }

    // Disband
    if (target.classList.contains('swarm-disband-btn')) {
      const swarmId = target.dataset.swarmId
      const confirmed = await modal.confirm(
        `Disband swarm ${truncId(swarmId)}? All members will be removed.`,
        { danger: true, okLabel: 'Disband' }
      )
      if (!confirmed) return
      if (opts.onDisband) opts.onDisband(swarmId)
      addMsg('system', `Swarm ${truncId(swarmId)} disbanded`)
      if (opts.onRefresh) opts.onRefresh()
      return
    }

    // Remove (completed/disbanded swarms)
    if (target.classList.contains('swarm-remove-btn')) {
      const swarmId = target.dataset.swarmId
      if (opts.onRemove) opts.onRemove(swarmId)
      addMsg('system', `Removed swarm ${truncId(swarmId)}`)
      if (opts.onRefresh) opts.onRefresh()
    }
  })
}

// ── Swarm Detail Dialog ──────────────────────────────────────────

/**
 * Show a modal dialog with full swarm details — members, subtasks,
 * progress, and management controls.
 *
 * @param {object} swarm  - SwarmInstance-like object
 * @param {object} [opts]
 * @param {string} [opts.localPodId]
 * @param {Function} [opts.onDisband]
 */
export function showSwarmDetail(swarm, opts = {}) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'

  const box = document.createElement('div')
  box.className = 'modal-box swarm-detail-dialog'

  const progress = _getProgress(swarm.subtasks || [])
  const isLeader = swarm.leader === (opts.localPodId || '')

  let memberList = ''
  for (const podId of (swarm.members || [])) {
    const role = podId === swarm.leader ? 'leader' : 'worker'
    memberList += `<div class="swarm-member-row"><span class="swarm-member-id" title="${esc(podId)}">${esc(truncId(podId))}</span> ${roleBadge(role)}</div>`
  }
  if (!memberList) memberList = '<div class="swarm-empty">No members</div>'

  let taskList = ''
  for (const st of (swarm.subtasks || [])) {
    taskList += `
      <div class="swarm-task-row">
        <span class="swarm-task-desc">${esc(st.description || st.id)}</span>
        <span class="swarm-task-assignee">${esc(truncId(st.assignee || 'unassigned'))}</span>
        ${badge(st.status || 'pending')}
        ${st.result ? `<div class="swarm-task-result">${esc(String(st.result).slice(0, 200))}</div>` : ''}
      </div>`
  }
  if (!taskList) taskList = '<div class="swarm-empty">No subtasks defined</div>'

  box.innerHTML = `
    <div class="modal-title">Swarm: ${esc(truncId(swarm.goal || swarm.id, 50))}</div>
    <div class="swarm-detail-meta">
      <div><strong>ID:</strong> ${esc(swarm.id)}</div>
      <div><strong>Status:</strong> ${statusBadge(swarm.status || 'forming')}</div>
      <div><strong>Strategy:</strong> ${badge(swarm.strategy || 'round_robin', 'swarm-badge-dim')}</div>
      <div><strong>Leader:</strong> ${esc(truncId(swarm.leader))}</div>
    </div>
    ${progress.total > 0 ? `<div class="swarm-detail-progress">${progressBar(progress.pct)} <span>${progress.completed}/${progress.total} tasks complete</span></div>` : ''}
    <div class="swarm-detail-section">
      <div class="swarm-section-label">Members (${(swarm.members || []).length})</div>
      ${memberList}
    </div>
    <div class="swarm-detail-section">
      <div class="swarm-section-label">Subtasks (${(swarm.subtasks || []).length})</div>
      ${taskList}
    </div>
    <div class="btn-row" style="margin-top:12px">
      ${isLeader && swarm.status !== 'disbanded' && swarm.status !== 'completed'
        ? '<button class="btn-sm btn-danger" id="swarmDetailDisbandBtn">Disband</button>'
        : ''}
      <button class="btn-sm btn-surface2" id="swarmDetailCloseBtn">Close</button>
    </div>
  `

  overlay.appendChild(box)
  document.body.appendChild(overlay)

  function close() {
    overlay.remove()
  }

  box.querySelector('#swarmDetailCloseBtn')?.addEventListener('click', close)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })

  box.querySelector('#swarmDetailDisbandBtn')?.addEventListener('click', async () => {
    const confirmed = await modal.confirm(
      `Disband swarm "${truncId(swarm.goal || swarm.id, 30)}"? This cannot be undone.`,
      { danger: true, okLabel: 'Disband' }
    )
    if (!confirmed) return
    if (opts.onDisband) opts.onDisband(swarm.id)
    addMsg('system', `Swarm ${truncId(swarm.id)} disbanded`)
    close()
  })
}

// ── Compact Stats Bar ────────────────────────────────────────────

/**
 * Render a compact swarm stats summary bar.
 *
 * @param {Array} swarms - Array of SwarmInstance-like objects
 * @param {string} [localPodId]
 * @returns {string} HTML string
 */
export function renderSwarmStats(swarms = [], localPodId = '') {
  const total = swarms.length
  const active = swarms.filter(s => s.status === 'active' || s.status === 'executing').length
  const leading = swarms.filter(s => s.leader === localPodId).length
  const memberOf = swarms.filter(s => (s.members || []).includes(localPodId)).length

  return `
    <div class="swarm-stats-bar">
      <span class="swarm-stat">${total} swarm${total === 1 ? '' : 's'}</span>
      <span class="swarm-stat">${active} active</span>
      <span class="swarm-stat">${memberOf} joined</span>
      ${leading > 0 ? `<span class="swarm-stat">${leading} leading</span>` : ''}
    </div>`
}

// ── Refresh Helper ───────────────────────────────────────────────

/**
 * Re-render the swarm panel in place.
 *
 * @param {object} opts - Same shape as renderSwarmPanel opts
 * @param {object} [listenerOpts] - Same shape as initSwarmListeners opts
 */
export function refreshSwarmPanel(opts, listenerOpts) {
  const panel = document.querySelector('.swarm-panel')
  if (!panel) return
  panel.outerHTML = renderSwarmPanel(opts)
  initSwarmListeners(listenerOpts || {})
}
