#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { resolve, join, basename } from 'node:path';

const TEST_DIR = resolve(import.meta.dirname);
const ROOT_DIR = resolve(TEST_DIR, '..', '..');

// ── Group definitions (prefix match on filename) ──────────────────────
const GROUP_PREFIXES = {
  mesh:         'clawser-mesh-',
  channels:     'clawser-channel',
  sprint:       'clawser-sprint',
  completeness: 'clawser-completeness-',
  e2e:          'clawser-e2e-',
};

// Mesh sub-groups (stems after "clawser-mesh-")
const MESH_SUBGROUPS = {
  'mesh-net':      ['peer', 'transport', 'relay', 'gateway', 'websocket', 'discovery', 'swarm'],
  'mesh-sync':     ['sync', 'delta-sync', 'streams', 'migration'],
  'mesh-identity': ['identity', 'identity-tools', 'keyring', 'trust', 'acl', 'capabilities'],
  'mesh-apps':     ['apps', 'marketplace', 'payments', 'quotas', 'resources', 'naming'],
  'mesh-ops':      ['audit', 'consensus', 'scheduler', 'visualizations', 'chat', 'tools', 'files', 'wsh-bridge'],
};

// Meta-groups composed from the above
const MESH_ALL = Object.keys(MESH_SUBGROUPS);
const META_GROUPS = {
  fast: ['core', 'channels'],
  slow: ['mesh', 'sprint', 'completeness', 'e2e'],
  all:  ['core', 'mesh', 'channels', 'sprint', 'completeness', 'e2e'],
  mesh: MESH_ALL,
};

// ── Arg parsing ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
let group = 'all';
let concurrency = 4;
let listOnly = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--group':
      group = args[++i];
      break;
    case '--concurrency':
      concurrency = parseInt(args[++i], 10);
      break;
    case '--list':
      listOnly = true;
      break;
    case '--help':
      console.log(`Usage: node web/test/run-tests.mjs [options]

Options:
  --group <name>       Test group to run (default: all)
                       Groups: core, mesh, channels, sprint, completeness, e2e
                       Mesh sub-groups: mesh-net, mesh-sync, mesh-identity, mesh-apps, mesh-ops
                       Meta-groups: fast, slow, all, changed
  --concurrency <n>    Max parallel test files (default: 4)
  --list               List matching files without running
  --help               Show help`);
      process.exit(0);
  }
}

// ── File resolution ───────────────────────────────────────────────────
function allTestFiles() {
  return readdirSync(TEST_DIR)
    .filter(f => f.endsWith('.test.mjs'))
    .sort();
}

function filesForGroup(name) {
  const all = allTestFiles();
  if (name === 'core') {
    const nonCorePatterns = Object.values(GROUP_PREFIXES);
    return all.filter(f => !nonCorePatterns.some(p => f.startsWith(p)));
  }
  // Mesh sub-groups: match by stem list
  const stems = MESH_SUBGROUPS[name];
  if (stems) {
    const expected = new Set(stems.map(s => `clawser-mesh-${s}.test.mjs`));
    return all.filter(f => expected.has(f));
  }
  const prefix = GROUP_PREFIXES[name];
  if (!prefix) return [];
  return all.filter(f => f.startsWith(prefix));
}

function resolveGroup(name) {
  if (name === 'changed') return changedTestFiles();
  const expand = META_GROUPS[name];
  if (expand) {
    const seen = new Set();
    const files = [];
    for (const g of expand) {
      for (const f of filesForGroup(g)) {
        if (!seen.has(f)) { seen.add(f); files.push(f); }
      }
    }
    return files;
  }
  if (GROUP_PREFIXES[name] || MESH_SUBGROUPS[name] || name === 'core') return filesForGroup(name);
  console.error(`Unknown group: ${name}`);
  process.exit(1);
}

function changedTestFiles() {
  const testFileSet = new Set(allTestFiles());
  try {
    const unstaged = execSync('git diff --name-only HEAD', { cwd: ROOT_DIR, encoding: 'utf8' });
    const staged = execSync('git diff --name-only --staged', { cwd: ROOT_DIR, encoding: 'utf8' });
    const changed = new Set(
      (unstaged + staged)
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(p => basename(p))
    );
    return allTestFiles().filter(f => changed.has(f));
  } catch {
    console.error('Failed to get changed files from git');
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────
const files = resolveGroup(group);

if (files.length === 0) {
  console.log(`No test files matched group "${group}".`);
  process.exit(0);
}

if (listOnly) {
  console.log(`${group}: ${files.length} file(s)\n`);
  for (const f of files) console.log(`  ${f}`);
  process.exit(0);
}

console.log(`Running ${files.length} test file(s) [group=${group}, concurrency=${concurrency}]\n`);

const filePaths = files.map(f => join(TEST_DIR, f));
const child = spawn(
  process.execPath,
  [
    '--import', join(TEST_DIR, '_setup-globals.mjs'),
    '--test',
    `--test-concurrency=${concurrency}`,
    ...filePaths,
  ],
  { stdio: 'inherit', cwd: ROOT_DIR }
);

child.on('close', code => process.exit(code ?? 1));
