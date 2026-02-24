/**
 * clawser-ui-goals.js — Goals panel
 *
 * Renders the goals tree with indentation, progress bars, artifact links,
 * collapse toggles, and completion controls.
 */
import { $, esc, state } from './clawser-state.js';
import { updateState } from './clawser-ui-chat.js';

// ── Goals (tree view — Block 8) ────────────────────────────────
const _collapsedGoals = new Set();

/** Toggle goal expand/collapse state. */
export function toggleGoalExpand(goalId) {
  if (_collapsedGoals.has(goalId)) _collapsedGoals.delete(goalId);
  else _collapsedGoals.add(goalId);
  renderGoals();
}

/** Render the goals tree with indentation, progress bars, artifact links, and collapse toggles. */
export function renderGoals() {
  if (!state.agent) return;
  const agentState = state.agent.getState();
  const goals = agentState.goals || [];
  const el = $('goalList');
  el.innerHTML = '';

  // Build parent->children map
  const childMap = new Map();
  const roots = [];
  for (const g of goals) {
    if (g.parentId) {
      if (!childMap.has(g.parentId)) childMap.set(g.parentId, []);
      childMap.get(g.parentId).push(g);
    } else {
      roots.push(g);
    }
  }

  function renderGoalNode(g, depth) {
    const children = childMap.get(g.id) || [];
    const hasChildren = children.length > 0;
    const collapsed = _collapsedGoals.has(g.id);

    const d = document.createElement('div');
    d.className = 'goal-item goal-tree-item';
    d.style.marginLeft = `${depth * 16}px`;

    // Toggle arrow
    let arrow = '';
    if (hasChildren) {
      arrow = `<span class="goal-toggle" data-gid="${g.id}">${collapsed ? '\u25B6' : '\u25BC'}</span>`;
    }

    d.innerHTML = `${arrow}<span class="goal-dot ${esc(g.status)}">●</span><span class="goal-desc">${esc(g.description)}</span>`;

    // Progress bar for goals with sub-goals
    if (hasChildren) {
      const completed = children.filter(c => c.status === 'completed').length;
      const pct = Math.round((completed / children.length) * 100);
      d.insertAdjacentHTML('beforeend',
        `<div class="goal-progress"><div class="goal-progress-fill" style="width:${pct}%"></div></div>`);
    }

    // Artifact links
    if (g.artifacts?.length > 0) {
      for (const a of g.artifacts) {
        const link = document.createElement('a');
        link.className = 'goal-artifact-link';
        link.href = '#';
        link.textContent = a.name || a.path || 'artifact';
        link.addEventListener('click', (e) => { e.preventDefault(); });
        d.appendChild(link);
      }
    }

    // Complete button
    if (g.status === 'active') {
      const btn = document.createElement('button');
      btn.textContent = '\u2713';
      btn.className = 'goal-complete-btn';
      btn.addEventListener('click', () => { state.agent.completeGoal(g.id); renderGoals(); updateState(); });
      d.appendChild(btn);
    }

    // Collapse toggle handler
    if (hasChildren) {
      d.querySelector('.goal-toggle').addEventListener('click', () => toggleGoalExpand(g.id));
    }

    el.appendChild(d);

    // Render children recursively if not collapsed
    if (hasChildren && !collapsed) {
      for (const child of children) {
        renderGoalNode(child, depth + 1);
      }
    }
  }

  for (const root of roots) {
    renderGoalNode(root, 0);
  }

  // Handle flat goals with no roots (all have parentId but parent doesn't exist)
  if (roots.length === 0 && goals.length > 0) {
    for (const g of goals) {
      renderGoalNode(g, 0);
    }
  }
}
