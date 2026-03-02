/**
 * Clawser Marketplace UI
 *
 * Renders a browsable skill marketplace panel with search, category filters,
 * install buttons, and rating stars. Designed to be embedded in the main
 * Clawser UI or used standalone.
 *
 * Usage:
 *   import { renderMarketplace } from './clawser-ui-marketplace.js';
 *   const cleanup = renderMarketplace(document.getElementById('panel'), marketplace);
 *   // Later: cleanup() to remove event listeners
 */

// ── Helpers ──────────────────────────────────────────────────────

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'textContent') node.textContent = v;
    else if (k === 'innerHTML') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else if (child) node.appendChild(child);
  }
  return node;
}

function renderStars(rating, interactive = false, onChange = null) {
  const container = el('span', { className: 'mp-stars' });
  const rounded = Math.round(rating * 2) / 2; // round to nearest 0.5
  for (let i = 1; i <= 5; i++) {
    const filled = i <= Math.floor(rounded);
    const half = !filled && i - 0.5 <= rounded;
    const star = el('span', {
      className: `mp-star ${filled ? 'mp-star-filled' : half ? 'mp-star-half' : 'mp-star-empty'}`,
      textContent: filled ? '\u2605' : half ? '\u2605' : '\u2606',
    });
    if (interactive && onChange) {
      star.style.cursor = 'pointer';
      const val = i;
      star.addEventListener('click', () => onChange(val));
    }
    container.appendChild(star);
  }
  const label = el('span', { className: 'mp-rating-label', textContent: ` ${rating.toFixed(1)}` });
  container.appendChild(label);
  return container;
}

// ── Styles ───────────────────────────────────────────────────────

const MARKETPLACE_CSS = `
.mp-container {
  font-family: system-ui, -apple-system, sans-serif;
  color: #e0e0e0;
  background: #1a1a2e;
  border-radius: 8px;
  padding: 16px;
  max-width: 800px;
}
.mp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.mp-title {
  font-size: 1.3em;
  font-weight: 600;
  color: #fff;
}
.mp-search-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.mp-search {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #16213e;
  color: #e0e0e0;
  font-size: 0.9em;
}
.mp-search:focus {
  outline: none;
  border-color: #0f3460;
}
.mp-categories {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.mp-cat-btn {
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid #333;
  background: #16213e;
  color: #aaa;
  cursor: pointer;
  font-size: 0.8em;
  transition: all 0.15s;
}
.mp-cat-btn:hover, .mp-cat-btn.active {
  background: #0f3460;
  color: #fff;
  border-color: #0f3460;
}
.mp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.mp-card {
  background: #16213e;
  border: 1px solid #222;
  border-radius: 8px;
  padding: 14px;
  transition: border-color 0.15s;
}
.mp-card:hover {
  border-color: #0f3460;
}
.mp-card-name {
  font-size: 1em;
  font-weight: 600;
  color: #fff;
  margin-bottom: 4px;
}
.mp-card-author {
  font-size: 0.8em;
  color: #888;
  margin-bottom: 6px;
}
.mp-card-desc {
  font-size: 0.85em;
  color: #bbb;
  margin-bottom: 8px;
  line-height: 1.4;
}
.mp-card-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8em;
  color: #888;
}
.mp-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
}
.mp-install-btn {
  padding: 5px 14px;
  border-radius: 6px;
  border: none;
  background: #0f3460;
  color: #fff;
  cursor: pointer;
  font-size: 0.85em;
  transition: background 0.15s;
}
.mp-install-btn:hover {
  background: #1a5276;
}
.mp-install-btn.installed {
  background: #1e8449;
}
.mp-install-btn.installed:hover {
  background: #922b21;
}
.mp-stars {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}
.mp-star {
  font-size: 0.95em;
}
.mp-star-filled {
  color: #f1c40f;
}
.mp-star-half {
  color: #f1c40f;
  opacity: 0.6;
}
.mp-star-empty {
  color: #555;
}
.mp-rating-label {
  font-size: 0.8em;
  color: #999;
  margin-left: 4px;
}
.mp-downloads {
  font-size: 0.8em;
  color: #888;
}
.mp-empty {
  text-align: center;
  color: #666;
  padding: 32px;
  font-size: 0.95em;
}
.mp-sort-select {
  padding: 6px 10px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #16213e;
  color: #e0e0e0;
  font-size: 0.85em;
}
`;

// ── Main render function ─────────────────────────────────────────

/**
 * Render the marketplace panel into a container element.
 * @param {HTMLElement} container - DOM node to render into
 * @param {import('./clawser-marketplace.js').SkillMarketplace} marketplace
 * @param {object} [opts]
 * @param {Function} [opts.onInstall] - Callback when a skill is installed: (skillId) => void
 * @param {Function} [opts.onUninstall] - Callback when a skill is uninstalled: (skillId) => void
 * @returns {Function} cleanup - Call to remove listeners and styles
 */
export function renderMarketplace(container, marketplace, opts = {}) {
  // Inject styles
  let styleEl = document.getElementById('mp-marketplace-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'mp-marketplace-styles';
    styleEl.textContent = MARKETPLACE_CSS;
    document.head.appendChild(styleEl);
  }

  let currentQuery = '';
  let currentCategory = '';
  let currentSort = 'downloads';

  function render() {
    container.innerHTML = '';

    const wrapper = el('div', { className: 'mp-container' });

    // Header
    const header = el('div', { className: 'mp-header' }, [
      el('span', { className: 'mp-title', textContent: 'Skill Marketplace' }),
    ]);
    wrapper.appendChild(header);

    // Search row
    const searchInput = el('input', {
      className: 'mp-search',
      type: 'text',
      placeholder: 'Search skills...',
    });
    searchInput.value = currentQuery;
    searchInput.addEventListener('input', (e) => {
      currentQuery = e.target.value;
      render();
    });

    const sortSelect = el('select', { className: 'mp-sort-select' }, [
      el('option', { value: 'downloads', textContent: 'Most Downloaded' }),
      el('option', { value: 'rating', textContent: 'Highest Rated' }),
      el('option', { value: 'name', textContent: 'Name A-Z' }),
    ]);
    sortSelect.value = currentSort;
    sortSelect.addEventListener('change', (e) => {
      currentSort = e.target.value;
      render();
    });

    wrapper.appendChild(el('div', { className: 'mp-search-row' }, [searchInput, sortSelect]));

    // Category filters
    const categories = marketplace.getCategories();
    if (categories.length > 0) {
      const catRow = el('div', { className: 'mp-categories' });

      const allBtn = el('button', {
        className: `mp-cat-btn ${currentCategory === '' ? 'active' : ''}`,
        textContent: 'All',
        onClick: () => { currentCategory = ''; render(); },
      });
      catRow.appendChild(allBtn);

      for (const cat of categories) {
        const btn = el('button', {
          className: `mp-cat-btn ${currentCategory === cat ? 'active' : ''}`,
          textContent: cat.charAt(0).toUpperCase() + cat.slice(1),
          onClick: () => { currentCategory = cat; render(); },
        });
        catRow.appendChild(btn);
      }
      wrapper.appendChild(catRow);
    }

    // Skills grid
    const skills = marketplace.browse(currentQuery, {
      category: currentCategory || undefined,
      sort: currentSort,
    });

    if (skills.length === 0) {
      wrapper.appendChild(el('div', { className: 'mp-empty', textContent: 'No skills found.' }));
    } else {
      const grid = el('div', { className: 'mp-grid' });

      for (const skill of skills) {
        const isInstalled = marketplace.isInstalled(skill.id);

        const card = el('div', { className: 'mp-card' }, [
          el('div', { className: 'mp-card-name', textContent: skill.name }),
          el('div', { className: 'mp-card-author', textContent: `by ${skill.author} \u00b7 v${skill.version}` }),
          el('div', { className: 'mp-card-desc', textContent: skill.description }),
          el('div', { className: 'mp-card-meta' }, [
            renderStars(skill.rating || 0, true, (stars) => {
              marketplace.rate(skill.id, stars);
              render();
            }),
            el('span', { className: 'mp-downloads', textContent: `${skill.downloads || 0} downloads` }),
          ]),
        ]);

        const footer = el('div', { className: 'mp-card-footer' });

        const installBtn = el('button', {
          className: `mp-install-btn ${isInstalled ? 'installed' : ''}`,
          textContent: isInstalled ? 'Uninstall' : 'Install',
        });
        installBtn.addEventListener('click', () => {
          if (isInstalled) {
            marketplace.uninstall(skill.id);
            if (opts.onUninstall) opts.onUninstall(skill.id);
          } else {
            marketplace.install(skill.id);
            if (opts.onInstall) opts.onInstall(skill.id);
          }
          render();
        });
        footer.appendChild(installBtn);

        if (skill.category) {
          footer.appendChild(el('span', {
            className: 'mp-cat-btn',
            textContent: skill.category,
            style: 'cursor: default; font-size: 0.75em;',
          }));
        }

        card.appendChild(footer);
        grid.appendChild(card);
      }

      wrapper.appendChild(grid);
    }

    container.appendChild(wrapper);
  }

  render();

  // Cleanup function
  return function cleanup() {
    container.innerHTML = '';
    if (styleEl && styleEl.parentNode) {
      styleEl.parentNode.removeChild(styleEl);
    }
  };
}
