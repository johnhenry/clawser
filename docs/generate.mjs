#!/usr/bin/env node

/**
 * Clawser documentation generator.
 *
 * Reads YAML data files from docs/data/ and generates a multi-page guide
 * under guide/ with an index, plus a tool reference page.
 *
 * @example
 *   // Generate all docs
 *   node docs/generate.mjs
 *
 * @example
 *   // Preview without writing files
 *   node docs/generate.mjs --dry-run
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const DATA_DIR = join(__dirname, 'data');
const GUIDE_DIR = join(ROOT, 'guide');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
const STATUS_BADGES = {
  implemented: '✅ Implemented',
  partial: '⚠️ Partial',
  planned: '📋 Planned',
};

/**
 * Return the badge string for a status value.
 *
 * @param {string} status - One of "implemented", "partial", or "planned"
 * @returns {string}
 *
 * @example
 *   badge('implemented') // '✅ Implemented'
 *   badge('unknown')     // '❓ unknown'
 */
const badge = (status) => STATUS_BADGES[status] ?? `❓ ${status}`;

// ---------------------------------------------------------------------------
// YAML loading
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable title from a filename slug.
 *
 * @param {string} filename - e.g. "getting-started.yaml"
 * @returns {string} e.g. "Getting Started"
 *
 * @example
 *   titleFromFilename('getting-started.yaml') // 'Getting Started'
 */
const titleFromFilename = (filename) =>
  filename
    .replace(/\.(yaml|yml)$/, '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/**
 * Normalize a feature object to a canonical shape, accepting both formats:
 *   - Original: { source_files, api_surface, see_also: ["[link](url)"] }
 *   - Alternate: { files, api, see_also: ["PlainName"], category, since }
 *
 * @param {Object} raw - Raw feature from YAML
 * @returns {Object} Normalized feature
 *
 * @example
 *   normalizeFeature({ name: 'Foo', files: ['a.js'], api: ['init'] })
 *   // { name: 'Foo', source_files: ['a.js'], api_surface: ['init'], ... }
 */
const normalizeFeature = (raw) => ({
  ...raw,
  source_files: raw.source_files ?? raw.files ?? [],
  api_surface: raw.api_surface ?? raw.api ?? [],
  see_also: raw.see_also ?? [],
  category: raw.category ?? null,
  since: raw.since ?? null,
});

/**
 * Normalize a parsed YAML document into a section object. Handles two formats:
 *   1. Object with { title, slug, description, features: [...] }
 *   2. Flat array of features (slug/title derived from filename)
 *
 * @param {Object|Array} doc - Parsed YAML
 * @param {string} filename - Source filename for fallback slug/title
 * @returns {Object} Normalized section
 *
 * @example
 *   normalizeSection([{ name: 'Foo', status: 'implemented' }], 'core.yaml')
 *   // { title: 'Core', slug: 'core', features: [...], ... }
 */
/**
 * Extract a section description from the first YAML comment line.
 * Expects format: `# Clawser Foo — description text here`
 *
 * @param {string} raw - Raw YAML file content
 * @returns {string} Extracted description or empty string
 *
 * @example
 *   extractCommentDescription('# Clawser Core — Agent engine, hooks\n- name: ...')
 *   // 'Agent engine, hooks'
 */
const extractCommentDescription = (raw) => {
  const firstLine = raw.trim().split('\n')[0];
  if (!firstLine.startsWith('#')) return '';
  const match = firstLine.match(/^#\s*(?:Clawser\s+)?[\w\s()-]+?\s*[—–-]\s*(.+)$/);
  return match ? match[1].trim() : '';
};

const normalizeSection = (doc, filename, raw = '') => {
  const slug = filename.replace(/\.(yaml|yml)$/, '');
  const commentDesc = extractCommentDescription(raw);

  // Format 2: flat array of features
  if (Array.isArray(doc)) {
    return {
      title: titleFromFilename(filename),
      slug,
      description: commentDesc,
      order: 999,
      features: doc.map(normalizeFeature),
      _sourceFile: filename,
    };
  }

  // Format 1: object with top-level metadata
  return {
    ...doc,
    slug: doc.slug ?? slug,
    title: doc.title ?? titleFromFilename(filename),
    description: doc.description || commentDesc,
    features: (doc.features ?? []).map(normalizeFeature),
    _sourceFile: filename,
  };
};

/**
 * Load all .yaml files from the data directory, sorted by `order` field.
 *
 * @returns {Array<Object>} Parsed and normalized YAML sections sorted by order.
 *
 * @example
 *   const sections = loadDataFiles();
 *   sections.forEach(s => console.log(s.title));
 */
/**
 * Load the _meta.yaml project metadata file if present.
 *
 * @returns {Object|null} Parsed meta object or null
 *
 * @example
 *   const meta = loadMeta();
 *   if (meta) console.log(meta.project);
 */
const loadMeta = () => {
  const metaPath = join(DATA_DIR, '_meta.yaml');
  if (!existsSync(metaPath)) return null;
  return yaml.load(readFileSync(metaPath, 'utf8'));
};

const loadDataFiles = () => {
  if (!existsSync(DATA_DIR)) {
    console.error(`\n  ❌  Data directory not found: ${DATA_DIR}`);
    console.error(`     Create .yaml files in docs/data/ and re-run.\n`);
    process.exit(1);
  }

  const files = readdirSync(DATA_DIR).filter(
    (f) => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('_')
  );

  if (files.length === 0) {
    console.error(`\n  ❌  No .yaml files found in ${DATA_DIR}`);
    console.error(`     Add YAML data files and re-run.\n`);
    process.exit(1);
  }

  // Use _meta.yaml file list for ordering when sections lack an explicit order
  const meta = loadMeta();
  const metaOrder = new Map();
  if (meta?.files) {
    meta.files.forEach((f, i) => metaOrder.set(f.replace(/\.(yaml|yml)$/, ''), i + 100));
  }

  const docs = files.map((file) => {
    const raw = readFileSync(join(DATA_DIR, file), 'utf8');
    const doc = yaml.load(raw);
    const section = normalizeSection(doc, file, raw);

    // Fall back to _meta ordering if no explicit order
    if (section.order === 999 && metaOrder.has(section.slug)) {
      section.order = metaOrder.get(section.slug);
    }

    return section;
  });

  docs.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  return docs;
};

// ---------------------------------------------------------------------------
// Markdown generators
// ---------------------------------------------------------------------------

/**
 * Generate the feature section markdown for a single feature entry.
 *
 * @param {Object} feature - Feature object from YAML
 * @returns {string} Markdown string
 *
 * @example
 *   renderFeature({ name: 'Foo', status: 'implemented', description: 'Does foo.' })
 *   // '### Foo\n\n**Status:** ✅ Implemented\n\nDoes foo.\n'
 */
const renderFeature = (feature) => {
  const lines = [];

  lines.push(`### ${feature.name}`);
  lines.push('');

  // Status line with optional category and since version
  const meta = [`**Status:** ${badge(feature.status)}`];
  if (feature.category) meta.push(`**Category:** ${feature.category}`);
  if (feature.since) meta.push(`**Since:** v${feature.since}`);
  lines.push(meta.join(' · '));
  lines.push('');

  if (feature.description) {
    lines.push(feature.description.trim());
    lines.push('');
  }

  if (feature.source_files?.length) {
    lines.push('**Source files:**');
    lines.push('');
    for (const f of feature.source_files) {
      lines.push(`- \`${f}\``);
    }
    lines.push('');
  }

  if (feature.api_surface?.length) {
    lines.push('**API surface:**');
    lines.push('');
    for (const api of feature.api_surface) {
      lines.push(`- \`${api}\``);
    }
    lines.push('');
  }

  if (feature.screenshot) {
    lines.push(`![${feature.name}](../docs/screenshots/${feature.screenshot})`);
    lines.push('');
  }

  if (feature.notes) {
    lines.push(`> **Note:** ${feature.notes.trim()}`);
    lines.push('');
  }

  if (feature.see_also?.length) {
    lines.push('**See also:**');
    lines.push('');
    for (const link of feature.see_also) {
      // If it's already a markdown link, use as-is; otherwise render as plain text
      lines.push(`- ${link}`);
    }
    lines.push('');
  }

  return lines.join('\n');
};

/**
 * Generate a full guide page for a section.
 *
 * @param {Object} section - Parsed YAML section
 * @param {Object|null} prev - Previous section (for nav link) or null
 * @param {Object|null} next - Next section (for nav link) or null
 * @returns {string} Full markdown page content
 *
 * @example
 *   renderGuidePage(section, prevSection, nextSection)
 */
const renderGuidePage = (section, prev, next) => {
  const lines = [];

  lines.push(`# ${section.title}`);
  lines.push('');
  if (section.description) {
    lines.push(section.description);
    lines.push('');
  }
  lines.push('---');
  lines.push('');

  if (section.features?.length) {
    for (const feature of section.features) {
      lines.push(renderFeature(feature));
      lines.push('---');
      lines.push('');
    }
  }

  // Navigation
  lines.push('---');
  lines.push('');
  const navParts = [];
  if (prev) {
    navParts.push(`[← ${prev.title}](./${prev.slug}.md)`);
  }
  navParts.push('[Index](./index.md)');
  if (next) {
    navParts.push(`[${next.title} →](./${next.slug}.md)`);
  }
  lines.push(navParts.join(' | '));
  lines.push('');

  return lines.join('\n');
};

/**
 * Generate the tools reference page with tools grouped by category in tables.
 *
 * @param {Object} toolsSection - The tools YAML section
 * @param {Object|null} prev - Previous section for nav
 * @param {Object|null} next - Next section for nav
 * @returns {string} Markdown content for tools.md
 *
 * @example
 *   renderToolsPage(toolsData, prevSection, nextSection)
 */
const renderToolsPage = (toolsSection, prev, next) => {
  const lines = [];

  lines.push(`# ${toolsSection.title}`);
  lines.push('');
  if (toolsSection.description) {
    lines.push(toolsSection.description);
    lines.push('');
  }

  // Group tools by category
  /** @type {Record<string, Array<Object>>} */
  const groups = {};
  for (const tool of toolsSection.features ?? []) {
    const cat = tool.category ?? 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(tool);
  }

  // Render each category as a table
  for (const [category, tools] of Object.entries(groups)) {
    lines.push(`## ${category}`);
    lines.push('');
    lines.push('| Tool | Description | Permission | Status |');
    lines.push('|------|-------------|------------|--------|');
    for (const tool of tools) {
      const desc = (tool.description ?? '').trim().split('\n')[0];
      const perm = tool.permission ?? '—';
      const status = badge(tool.status);
      lines.push(`| \`${tool.name}\` | ${desc} | \`${perm}\` | ${status} |`);
    }
    lines.push('');
  }

  // Also render full detail sections below the tables
  lines.push('---');
  lines.push('');
  lines.push('## Detailed Reference');
  lines.push('');

  for (const feature of toolsSection.features ?? []) {
    lines.push(renderFeature(feature));
    lines.push('---');
    lines.push('');
  }

  // Navigation
  lines.push('---');
  lines.push('');
  const navParts = [];
  if (prev) {
    navParts.push(`[← ${prev.title}](./${prev.slug}.md)`);
  }
  navParts.push('[Index](./index.md)');
  if (next) {
    navParts.push(`[${next.title} →](./${next.slug}.md)`);
  }
  lines.push(navParts.join(' | '));
  lines.push('');

  return lines.join('\n');
};

/**
 * Compute aggregate stats across all sections.
 *
 * @param {Array<Object>} sections - All parsed YAML sections
 * @returns {{ total: number, implemented: number, partial: number, planned: number }}
 *
 * @example
 *   const stats = computeStats(sections);
 *   console.log(`${stats.implemented}/${stats.total} implemented`);
 */
const computeStats = (sections) => {
  const stats = { total: 0, implemented: 0, partial: 0, planned: 0 };
  for (const section of sections) {
    for (const feature of section.features ?? []) {
      stats.total++;
      if (feature.status === 'implemented') stats.implemented++;
      else if (feature.status === 'partial') stats.partial++;
      else if (feature.status === 'planned') stats.planned++;
    }
  }
  return stats;
};

/**
 * Generate the index.md table of contents with stats.
 *
 * @param {Array<Object>} sections - All parsed YAML sections
 * @returns {string} Markdown content for index.md
 *
 * @example
 *   const indexContent = renderIndex(sections);
 */
const renderIndex = (sections) => {
  const stats = computeStats(sections);
  const meta = loadMeta();
  const lines = [];

  lines.push(`# ${meta?.project ?? 'Clawser'} Guide`);
  lines.push('');
  if (meta?.tagline) {
    lines.push(`> ${meta.tagline}`);
    lines.push('');
  }
  lines.push('Comprehensive guide to every subsystem.');
  lines.push('');

  // Stats summary
  lines.push('## Status Overview');
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total features | ${stats.total} |`);
  lines.push(`| ${STATUS_BADGES.implemented} | ${stats.implemented} |`);
  lines.push(`| ${STATUS_BADGES.partial} | ${stats.partial} |`);
  lines.push(`| ${STATUS_BADGES.planned} | ${stats.planned} |`);
  lines.push('');

  // Table of contents
  lines.push('## Sections');
  lines.push('');

  for (const section of sections) {
    const featureCount = section.features?.length ?? 0;
    lines.push(`- [**${section.title}**](./${section.slug}.md) — ${section.description ?? ''} *(${featureCount} features)*`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`*Generated on ${new Date().toISOString().split('T')[0]} by \`docs/generate.mjs\`*`);
  lines.push('');

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// File writer (respects --dry-run)
// ---------------------------------------------------------------------------

/**
 * Write a file to disk, or print what would be written in dry-run mode.
 *
 * @param {string} filePath - Absolute path to write
 * @param {string} content - File content
 *
 * @example
 *   writeOutput('/path/to/guide/index.md', '# Index\n...');
 */
const writeOutput = (filePath, content) => {
  if (DRY_RUN) {
    const lines = content.split('\n').length;
    console.log(`  [dry-run] would write ${filePath} (${lines} lines)`);
    return;
  }

  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, content, 'utf8');
  const lines = content.split('\n').length;
  console.log(`  ✅  wrote ${filePath} (${lines} lines)`);
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  console.log('');
  console.log('  Clawser docs generator');
  console.log('  ─────────────────────');
  if (DRY_RUN) {
    console.log('  🏜️  Dry-run mode — no files will be written');
  }
  console.log('');

  // Load data
  const sections = loadDataFiles();
  console.log(`  📂  Loaded ${sections.length} data files from docs/data/`);
  console.log('');

  // Ensure guide/ directory
  if (!DRY_RUN && !existsSync(GUIDE_DIR)) {
    mkdirSync(GUIDE_DIR, { recursive: true });
  }

  // Generate index
  const indexContent = renderIndex(sections);
  writeOutput(join(GUIDE_DIR, 'index.md'), indexContent);

  // Generate each section page
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const prev = i > 0 ? sections[i - 1] : null;
    const next = i < sections.length - 1 ? sections[i + 1] : null;

    let content;
    if (section.slug === 'tools') {
      content = renderToolsPage(section, prev, next);
    } else {
      content = renderGuidePage(section, prev, next);
    }

    writeOutput(join(GUIDE_DIR, `${section.slug}.md`), content);
  }

  // Summary
  const stats = computeStats(sections);
  console.log('');
  console.log(`  📊  Stats: ${stats.total} features — ${stats.implemented} implemented, ${stats.partial} partial, ${stats.planned} planned`);
  console.log(`  📁  Generated ${sections.length + 1} files in guide/`);
  console.log('');
};

await main();
