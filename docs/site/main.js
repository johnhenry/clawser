/**
 * Clawser Documentation Site — Main Script
 *
 * Client-side markdown rendering with hash-based navigation.
 * Fetches .md files from the docs directory and renders them
 * as HTML using a lightweight markdown-to-HTML converter.
 */

// ── Minimal Markdown-to-HTML converter ──────────────────────────

function markdownToHtml(md) {
  let html = md;

  // Fenced code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = escapeHtml(code.trimEnd());
    return `<pre><code class="language-${lang || 'text'}">${escaped}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  // Merge adjacent blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // Unordered lists
  html = html.replace(/^(\s*)[-*] (.+)$/gm, '$1<li>$2</li>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Tables
  html = html.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/gm, (_, headerLine, _sep, bodyLines) => {
    const headers = headerLine.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
    const rows = bodyLines.trim().split('\n').map(line => {
      const cells = line.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('\n');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Paragraphs — wrap remaining text blocks
  html = html.replace(/^(?!<[a-z]|$)(.+)$/gm, '<p>$1</p>');

  // Clean up double-wrapped paragraphs
  html = html.replace(/<p><(h[1-4]|ul|ol|li|pre|blockquote|table|hr)/g, '<$1');
  html = html.replace(/<\/(h[1-4]|ul|ol|li|pre|blockquote|table)><\/p>/g, '</$1>');

  return html;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Navigation ──────────────────────────────────────────────────

let navData = null;
let flatNav = []; // Flattened for easy lookup: { slug, file, title }

async function loadNav() {
  try {
    const resp = await fetch('nav.json');
    navData = await resp.json();
    flatNav = [];
    for (const section of navData.sections) {
      flatNav.push({ slug: section.slug, file: section.file, title: section.title });
      for (const child of (section.children || [])) {
        flatNav.push({ slug: child.slug, file: child.file, title: child.title, parent: section.slug });
      }
    }
  } catch (err) {
    console.error('Failed to load nav.json:', err);
    navData = { sections: [] };
  }
}

function renderNav(activeSlug) {
  const container = document.getElementById('nav-tree');
  if (!container || !navData) return;

  container.innerHTML = '';
  for (const section of navData.sections) {
    const div = document.createElement('div');
    div.className = 'nav-section';

    const link = document.createElement('a');
    link.className = `nav-link ${section.slug === activeSlug ? 'active' : ''}`;
    link.href = `#${section.slug}`;
    link.textContent = section.title;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(section.slug);
    });
    div.appendChild(link);

    for (const child of (section.children || [])) {
      const childLink = document.createElement('a');
      childLink.className = `nav-link child ${child.slug === activeSlug ? 'active' : ''}`;
      childLink.href = `#${child.slug}`;
      childLink.textContent = child.title;
      childLink.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(child.slug);
      });
      div.appendChild(childLink);
    }

    container.appendChild(div);
  }
}

// ── Page loading ────────────────────────────────────────────────

async function loadPage(slug) {
  const entry = flatNav.find(n => n.slug === slug);
  const contentEl = document.getElementById('content');
  if (!contentEl) return;

  if (!entry) {
    contentEl.innerHTML = '<h1>Page Not Found</h1><p>The requested documentation page could not be found.</p>';
    return;
  }

  contentEl.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const resp = await fetch(entry.file);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const md = await resp.text();
    contentEl.innerHTML = markdownToHtml(md);
  } catch (err) {
    contentEl.innerHTML = `<h1>${entry.title}</h1><p>Could not load <code>${entry.file}</code>: ${err.message}</p>`;
  }

  renderNav(slug);
  document.title = `${entry.title} | Clawser Docs`;
}

function navigateTo(slug) {
  window.location.hash = slug;
  loadPage(slug);

  // Close mobile sidebar
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.remove('open');
}

// ── Init ─────────────────────────────────────────────────────────

async function init() {
  await loadNav();

  // Mobile menu toggle
  const toggle = document.querySelector('.menu-toggle');
  const sidebar = document.getElementById('sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
  }

  // Logo click navigates home
  const logo = document.querySelector('.logo');
  if (logo) {
    logo.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(logo.dataset.page || 'getting-started');
    });
  }

  // Hash change handler
  window.addEventListener('hashchange', () => {
    const slug = window.location.hash.slice(1) || 'getting-started';
    loadPage(slug);
  });

  // Initial load
  const slug = window.location.hash.slice(1) || 'getting-started';
  loadPage(slug);
}

init();
