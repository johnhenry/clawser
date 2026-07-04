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
  'mesh-net':      ['peer', 'transport', 'relay', 'gateway', 'websocket', 'discovery', 'swarm', 'dht'],
  'mesh-sync':     ['sync', 'delta-sync', 'streams', 'migration'],
  'mesh-identity': ['identity', 'identity-tools', 'keyring', 'trust', 'acl', 'capabilities'],
  'mesh-apps':     ['apps', 'marketplace', 'payments', 'quotas', 'resources', 'naming'],
  'mesh-ops':      ['audit', 'consensus', 'scheduler', 'visualizations', 'chat', 'tools', 'files', 'wsh-bridge', 'gpu', 'stealth'],
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

// ── Per-file subprocess pool ──────────────────────────────────────────
// Why per-file: --test across many files with --test-force-exit racily
// truncates the final TAP summary (random tests/suites disappear from
// the report). One process per file lets each child's reporter drain
// its own summary before we send SIGKILL — stable counts run-to-run.
const filePaths = files.map(f => join(TEST_DIR, f));

let totalTests = 0, totalSuites = 0, totalPass = 0, totalFail = 0;
let totalSkipped = 0, totalTodo = 0, totalCancelled = 0;
let totalDurationMs = 0;
const failures = [];
let nextIdx = 0;
let completed = 0;

const startedAt = Date.now();

const PER_FILE_TIMEOUT_MS = 60_000;
const POST_SUMMARY_GRACE_MS = 50;

function runOne(filePath) {
  return new Promise((resolveP) => {
    const file = basename(filePath);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let drainKilled = false;
    let summarySeen = false;
    // Why not --test-force-exit: the flag races with the reporter and can
    // truncate the final # tests / # suites lines mid-stream, causing
    // run-to-run count variance. Instead we let the reporter drain to its
    // own "# duration_ms" line, then SIGKILL after a small grace period.
    // This gives stable counts without depending on tests cleaning up
    // every leaked handle.
    const child = spawn(
      process.execPath,
      [
        '--import', join(TEST_DIR, '_setup-globals.mjs'),
        '--test',
        '--test-reporter=tap',
        filePath,
      ],
      { cwd: ROOT_DIR }
    );
    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, PER_FILE_TIMEOUT_MS);
    let graceTimer = null;
    function checkSummary(buf) {
      if (summarySeen) return;
      if (/^# duration_ms /m.test(buf)) {
        summarySeen = true;
        graceTimer = setTimeout(() => {
          drainKilled = true;
          child.kill('SIGKILL');
        }, POST_SUMMARY_GRACE_MS);
      }
    }
    child.stdout.on('data', d => { stdout += d.toString(); checkSummary(stdout); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (graceTimer) clearTimeout(graceTimer);
      // Parse TAP summary lines
      const m = (re) => { const x = stdout.match(re); return x ? Number(x[1]) : 0; };
      const tests   = m(/^# tests (\d+)/m);
      const suites  = m(/^# suites (\d+)/m);
      const pass    = m(/^# pass (\d+)/m);
      const fail    = m(/^# fail (\d+)/m);
      const skipped = m(/^# skipped (\d+)/m);
      const todo    = m(/^# todo (\d+)/m);
      const cancelled = m(/^# cancelled (\d+)/m);
      const dur     = m(/^# duration_ms ([\d.]+)/m);
      totalTests   += tests;
      totalSuites  += suites;
      totalPass    += pass;
      totalFail    += fail;
      totalSkipped += skipped;
      totalTodo    += todo;
      totalCancelled += cancelled;
      totalDurationMs += dur;
      completed++;
      // drainKilled means we let the reporter finish then SIGKILL'd the
      // hung process — that's success, not failure. timedOut means we
      // killed before the reporter ever printed its summary.
      const cleanExit = code === 0 || drainKilled;
      const failedRun = fail > 0 || timedOut || (!cleanExit);
      const tag = timedOut ? 'TIME' : (failedRun ? 'FAIL' : 'ok');
      const pct = ((completed / files.length) * 100).toFixed(0);
      const ms = timedOut ? `timeout ${PER_FILE_TIMEOUT_MS}ms` : (dur > 0 ? `${dur.toFixed(0)}ms` : `exit ${code}`);
      console.log(`[${completed}/${files.length} ${pct}%] ${tag.padEnd(4)} ${file} (${pass}/${tests}, ${ms})`);
      if (failedRun) {
        failures.push({ file, code, stdout, stderr, timedOut });
      }
      resolveP();
    });
  });
}

async function worker() {
  while (true) {
    const i = nextIdx++;
    if (i >= filePaths.length) return;
    await runOne(filePaths[i]);
  }
}

const workers = Array.from({ length: concurrency }, () => worker());
await Promise.all(workers);

const wallMs = Date.now() - startedAt;
console.log('');
console.log(`# tests ${totalTests}`);
console.log(`# suites ${totalSuites}`);
console.log(`# pass ${totalPass}`);
console.log(`# fail ${totalFail}`);
console.log(`# cancelled ${totalCancelled}`);
console.log(`# skipped ${totalSkipped}`);
console.log(`# todo ${totalTodo}`);
console.log(`# duration_ms ${totalDurationMs.toFixed(3)} (wall ${wallMs}ms)`);

if (failures.length > 0) {
  console.log('');
  console.log(`Failed files (${failures.length}):`);
  for (const f of failures) {
    console.log(`  - ${f.file} (exit ${f.code})`);
  }
  console.log('');
  console.log('--- First failure detail ---');
  const first = failures[0];
  console.log(`File: ${first.file}`);
  if (first.stderr) console.log(first.stderr);
  // Print last ~80 lines of stdout for the first failure
  const lines = first.stdout.split('\n');
  const tail = lines.slice(Math.max(0, lines.length - 80));
  console.log(tail.join('\n'));
  process.exit(1);
}
process.exit(0);
