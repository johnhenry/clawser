/**
 * clawser-ui-charts.js — Pure CSS chart rendering for dashboard.
 *
 * Three chart types: bar chart, time series, and cost breakdown.
 * All charts render as plain HTML+CSS (no external library).
 */

/**
 * Render a vertical bar chart.
 * @param {HTMLElement} el - Container element
 * @param {Array<{label: string, value: number}>} data
 * @param {{title?: string, color?: string, unit?: string}} [opts]
 */
export function renderBarChart(el, data, opts = {}) {
  if (!data || data.length === 0) {
    el.innerHTML = '<div class="chart-empty">No data</div>';
    return;
  }

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const color = opts.color || 'var(--accent)';
  const unit = opts.unit || '';

  let html = '';
  if (opts.title) html += `<div class="chart-title">${esc(opts.title)}</div>`;
  html += '<div class="chart-bar-container">';
  for (const d of data) {
    const pct = Math.round((d.value / maxVal) * 100);
    html += `<div class="chart-bar-col">
      <div class="chart-bar-value">${formatNum(d.value)}${unit}</div>
      <div class="chart-bar-track"><div class="chart-bar" style="height:${pct}%;background:${color}"></div></div>
      <div class="chart-bar-label">${esc(d.label)}</div>
    </div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

/**
 * Render a time series chart (horizontal bars / sparkline-style).
 * @param {HTMLElement} el - Container element
 * @param {Array<{label: string, value: number}>} series
 * @param {{title?: string, color?: string, unit?: string}} [opts]
 */
export function renderTimeSeriesChart(el, series, opts = {}) {
  if (!series || series.length === 0) {
    el.innerHTML = '<div class="chart-empty">No data</div>';
    return;
  }

  const maxVal = Math.max(...series.map(d => d.value), 1);
  const color = opts.color || 'var(--accent)';
  const unit = opts.unit || '';

  let html = '';
  if (opts.title) html += `<div class="chart-title">${esc(opts.title)}</div>`;
  html += '<div class="chart-ts">';
  for (const d of series) {
    const pct = Math.round((d.value / maxVal) * 100);
    html += `<div class="chart-ts-row">
      <span class="chart-ts-label">${esc(d.label)}</span>
      <div class="chart-ts-track"><div class="chart-ts-bar" style="width:${pct}%;background:${color}"></div></div>
      <span class="chart-ts-value">${formatNum(d.value)}${unit}</span>
    </div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

/**
 * Render per-model cost breakdown.
 * @param {HTMLElement} el - Container element
 * @param {Object<string, {costCents: number, totalTokens: number, calls: number}>} perModel
 */
export function renderCostBreakdown(el, perModel) {
  const entries = Object.entries(perModel || {});
  if (entries.length === 0) {
    el.innerHTML = '<div class="chart-empty">No cost data</div>';
    return;
  }

  // Sort by cost descending
  entries.sort((a, b) => b[1].costCents - a[1].costCents);
  const totalCost = entries.reduce((s, [, v]) => s + v.costCents, 0) || 1;

  const colors = [
    'var(--accent)', 'var(--green)', 'var(--orange)', 'var(--red)',
    'var(--purple, #a371f7)', 'var(--cyan, #56d4dd)', 'var(--pink, #db61a2)',
  ];

  let html = '<div class="cost-breakdown">';

  // Stacked bar
  html += '<div class="cost-breakdown-bar">';
  entries.forEach(([, v], i) => {
    const pct = (v.costCents / totalCost * 100).toFixed(1);
    html += `<div class="cost-seg" style="width:${pct}%;background:${colors[i % colors.length]}" title="${pct}%"></div>`;
  });
  html += '</div>';

  // Legend table
  html += '<div class="cost-breakdown-legend">';
  entries.forEach(([model, v], i) => {
    const pct = (v.costCents / totalCost * 100).toFixed(0);
    html += `<div class="cost-legend-row">
      <span class="cost-legend-dot" style="background:${colors[i % colors.length]}"></span>
      <span class="cost-legend-model">${esc(model)}</span>
      <span class="cost-legend-pct">${pct}%</span>
      <span class="cost-legend-cost">$${(v.costCents / 100).toFixed(4)}</span>
      <span class="cost-legend-tokens">${formatNum(v.totalTokens)} tok</span>
      <span class="cost-legend-calls">${v.calls} calls</span>
    </div>`;
  });
  html += '</div></div>';
  el.innerHTML = html;
}

// ── Helpers ──────────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return typeof n === 'number' && !Number.isInteger(n) ? n.toFixed(2) : String(n);
}
