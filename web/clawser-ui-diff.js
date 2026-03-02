/**
 * clawser-ui-diff.js — Line-by-line diff renderer.
 *
 * Renders a side-by-side or unified diff view with add/del highlighting.
 */

/**
 * Compute a simple line-by-line diff between two strings.
 * Returns an array of {type: 'equal'|'add'|'del', line: string} entries.
 * Uses a basic LCS-based approach.
 */
export function computeDiff(oldText, newText) {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');
  const result = [];

  // Simple LCS using dynamic programming
  const m = oldLines.length, n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      result.push({ type: 'equal', line: oldLines[i] });
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ type: 'add', line: newLines[j] });
      j++;
    } else {
      result.push({ type: 'del', line: oldLines[i] });
      i++;
    }
  }
  return result;
}

/**
 * Render a diff into an HTML element.
 * @param {HTMLElement} el - Container
 * @param {string} oldCode - Old version
 * @param {string} newCode - New version
 */
export function renderDiff(el, oldCode, newCode) {
  const diff = computeDiff(oldCode, newCode);
  if (diff.length === 0) {
    el.innerHTML = '<div class="diff-empty">No changes</div>';
    return;
  }

  let html = '<div class="diff-view">';
  let lineNum = 0;
  for (const entry of diff) {
    lineNum++;
    const cls = entry.type === 'add' ? 'diff-add' : entry.type === 'del' ? 'diff-del' : 'diff-eq';
    const prefix = entry.type === 'add' ? '+' : entry.type === 'del' ? '-' : ' ';
    html += `<div class="diff-line ${cls}"><span class="diff-num">${lineNum}</span><span class="diff-prefix">${prefix}</span><span class="diff-text">${esc(entry.line)}</span></div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
