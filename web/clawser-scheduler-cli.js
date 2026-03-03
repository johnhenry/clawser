/**
 * clawser-scheduler-cli.js — Shell `cron` command for scheduler/routine management
 *
 * Subcommands: list, add, remove, pause, resume, history, run, status
 */

import { RoutineEngine } from './clawser-routines.js';

/**
 * Parse a human-readable duration string to milliseconds.
 * Supports: 5m, 1h, 30s, 2h30m, etc.
 * @param {string} str
 * @returns {number|null}
 */
function parseDuration(str) {
  let ms = 0;
  let matched = false;
  const re = /(\d+)\s*(h|m|s)/gi;
  let match;
  while ((match = re.exec(str)) !== null) {
    matched = true;
    const n = parseInt(match[1]);
    switch (match[2].toLowerCase()) {
      case 'h': ms += n * 3_600_000; break;
      case 'm': ms += n * 60_000; break;
      case 's': ms += n * 1_000; break;
    }
  }
  return matched ? ms : null;
}

/**
 * Format a timestamp for display.
 * @param {number|null} ts
 * @returns {string}
 */
function fmtTime(ts) {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

/**
 * Register the `cron` (alias: `schedule`) command with a shell registry.
 * @param {object} registry - Shell command registry
 * @param {() => import('./clawser-routines.js').RoutineEngine} getEngine
 * @param {() => import('./clawser-agent.js').ClawserAgent} getAgent
 */
export function registerSchedulerCli(registry, getEngine, getAgent) {
  const HELP = `Usage: cron <subcommand> [args]

Subcommands:
  list                              List all routines
  add "cron_expr" "prompt"          Add a cron routine
  add --interval 5m "prompt"        Add an interval routine
  add --once 2h "prompt"            Add a one-shot delayed routine
  remove <id>                       Delete a routine
  pause <id>                        Disable a routine
  resume <id>                       Re-enable a routine
  history [id]                      Show execution history
  run <id>                          Force-execute a routine now
  status                            Summary of scheduler state`;

  async function handler({ args }) {
    const engine = getEngine();
    const agent = getAgent();
    if (!engine) return { stdout: '', stderr: 'Routine engine not available', exitCode: 1 };

    if (args.length === 0) return { stdout: HELP, stderr: '', exitCode: 0 };

    const subcmd = args[0];
    const subArgs = args.slice(1);

    switch (subcmd) {
      case 'list': return cmdList(engine);
      case 'add': return cmdAdd(engine, agent, subArgs);
      case 'remove': case 'rm': case 'delete': return cmdRemove(engine, subArgs);
      case 'pause': return cmdPause(engine, subArgs);
      case 'resume': return cmdResume(engine, subArgs);
      case 'history': return cmdHistory(engine, subArgs);
      case 'run': return cmdRun(engine, subArgs);
      case 'status': return cmdStatus(engine);
      case 'help': return { stdout: HELP, stderr: '', exitCode: 0 };
      default:
        return { stdout: '', stderr: `Unknown subcommand: ${subcmd}\n${HELP}`, exitCode: 1 };
    }
  }

  registry.register('cron', handler);
  registry.register('schedule', handler);
}

// ── Subcommand implementations ───────────────────────────────────

function cmdList(engine) {
  const routines = engine.listRoutines();
  if (routines.length === 0) {
    return { stdout: 'No routines configured.', stderr: '', exitCode: 0 };
  }

  const header = 'ID                | Name                | Trigger      | Status  | Last Run             | Next Fire            | Runs';
  const sep = '-'.repeat(header.length);
  const rows = routines.map(r => {
    const trigger = r.trigger?.cron ? `cron(${r.trigger.cron})`
      : r.meta?.scheduleType === 'interval' ? `every ${Math.round((r.meta.intervalMs || 0) / 1000)}s`
      : r.meta?.scheduleType === 'once' ? `once`
      : r.trigger?.type === 'event' ? `event(${r.trigger.event})`
      : r.trigger?.type === 'webhook' ? `webhook`
      : 'unknown';
    const status = r.enabled ? 'active' : 'paused';
    const lastRun = fmtTime(r.state?.lastRun);
    const nextFire = fmtTime(RoutineEngine.nextFireTime(r));
    const runs = r.state?.runCount || 0;
    const id = (r.id || '').padEnd(17);
    const name = (r.name || '').slice(0, 20).padEnd(20);
    return `${id} | ${name} | ${trigger.padEnd(12)} | ${status.padEnd(7)} | ${lastRun.padEnd(20)} | ${nextFire.padEnd(20)} | ${runs}`;
  });

  return { stdout: `${header}\n${sep}\n${rows.join('\n')}`, stderr: '', exitCode: 0 };
}

function cmdAdd(engine, agent, args) {
  // Parse flags: --interval <dur>, --once <dur>
  let scheduleType = 'cron';
  let cronExpr = null;
  let intervalMs = null;
  let delayMs = null;
  let prompt = null;

  let i = 0;
  while (i < args.length) {
    if (args[i] === '--interval' && i + 1 < args.length) {
      scheduleType = 'interval';
      intervalMs = parseDuration(args[i + 1]);
      if (!intervalMs) return { stdout: '', stderr: `Invalid duration: ${args[i + 1]}`, exitCode: 1 };
      i += 2;
    } else if (args[i] === '--once' && i + 1 < args.length) {
      scheduleType = 'once';
      delayMs = parseDuration(args[i + 1]);
      if (!delayMs) return { stdout: '', stderr: `Invalid duration: ${args[i + 1]}`, exitCode: 1 };
      i += 2;
    } else if (!cronExpr && scheduleType === 'cron' && !prompt) {
      cronExpr = args[i];
      i++;
    } else {
      prompt = args.slice(i).join(' ');
      break;
    }
  }

  if (!prompt) return { stdout: '', stderr: 'Missing prompt text', exitCode: 1 };

  if (agent && scheduleType !== 'cron') {
    // Use agent's addSchedulerJob for delegation
    const id = agent.addSchedulerJob({
      schedule_type: scheduleType,
      prompt,
      interval_ms: intervalMs,
      delay_ms: delayMs,
    });
    return { stdout: `Added ${scheduleType} routine: ${id}`, stderr: '', exitCode: 0 };
  }

  if (scheduleType === 'cron') {
    if (!cronExpr) return { stdout: '', stderr: 'Missing cron expression', exitCode: 1 };
    if (agent) {
      const id = agent.addSchedulerJob({ schedule_type: 'cron', prompt, cron_expr: cronExpr });
      return { stdout: `Added cron routine: ${id}`, stderr: '', exitCode: 0 };
    }
    // Fallback: add directly to engine
    const routine = engine.addRoutine({
      name: prompt.slice(0, 60),
      trigger: { type: 'cron', cron: cronExpr },
      action: { type: 'prompt', prompt },
    });
    return { stdout: `Added cron routine: ${routine.id}`, stderr: '', exitCode: 0 };
  }

  return { stdout: '', stderr: 'Could not add routine', exitCode: 1 };
}

function cmdRemove(engine, args) {
  const id = args[0];
  if (!id) return { stdout: '', stderr: 'Missing routine ID', exitCode: 1 };
  if (engine.removeRoutine(id)) {
    return { stdout: `Removed: ${id}`, stderr: '', exitCode: 0 };
  }
  return { stdout: '', stderr: `Routine not found: ${id}`, exitCode: 1 };
}

function cmdPause(engine, args) {
  const id = args[0];
  if (!id) return { stdout: '', stderr: 'Missing routine ID', exitCode: 1 };
  if (engine.setEnabled(id, false)) {
    return { stdout: `Paused: ${id}`, stderr: '', exitCode: 0 };
  }
  return { stdout: '', stderr: `Routine not found: ${id}`, exitCode: 1 };
}

function cmdResume(engine, args) {
  const id = args[0];
  if (!id) return { stdout: '', stderr: 'Missing routine ID', exitCode: 1 };
  if (engine.setEnabled(id, true)) {
    return { stdout: `Resumed: ${id}`, stderr: '', exitCode: 0 };
  }
  return { stdout: '', stderr: `Routine not found: ${id}`, exitCode: 1 };
}

function cmdHistory(engine, args) {
  const id = args[0];
  if (id) {
    const routine = engine.getRoutine(id);
    if (!routine) return { stdout: '', stderr: `Routine not found: ${id}`, exitCode: 1 };
    const history = routine.state?.history || [];
    if (history.length === 0) return { stdout: `${routine.name}: No history.`, stderr: '', exitCode: 0 };
    const last10 = history.slice(-10);
    const lines = last10.map((h, i) => {
      const ts = fmtTime(h.timestamp);
      const err = h.error ? ` — ${h.error}` : '';
      return `  ${i + 1}. [${ts}] ${h.result} (${h.trigger})${err}`;
    });
    return { stdout: `${routine.name} — last ${last10.length} runs:\n${lines.join('\n')}`, stderr: '', exitCode: 0 };
  }

  // Global history: last 10 across all routines
  const all = [];
  for (const r of engine.listRoutines()) {
    for (const h of (r.state?.history || [])) {
      all.push({ ...h, routineId: r.id, routineName: r.name });
    }
  }
  all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const last10 = all.slice(0, 10);
  if (last10.length === 0) return { stdout: 'No execution history.', stderr: '', exitCode: 0 };
  const lines = last10.map((h, i) => {
    const ts = fmtTime(h.timestamp);
    return `  ${i + 1}. [${ts}] ${h.routineName}: ${h.result}`;
  });
  return { stdout: `Last 10 executions:\n${lines.join('\n')}`, stderr: '', exitCode: 0 };
}

async function cmdRun(engine, args) {
  const id = args[0];
  if (!id) return { stdout: '', stderr: 'Missing routine ID', exitCode: 1 };
  try {
    const result = await engine.triggerManual(id);
    return { stdout: `Run ${id}: ${result}`, stderr: '', exitCode: 0 };
  } catch (e) {
    return { stdout: '', stderr: e.message, exitCode: 1 };
  }
}

function cmdStatus(engine) {
  const routines = engine.listRoutines();
  const active = routines.filter(r => r.enabled).length;
  const paused = routines.filter(r => !r.enabled).length;
  const totalRuns = routines.reduce((s, r) => s + (r.state?.runCount || 0), 0);
  const running = engine.running ? 'running' : 'stopped';

  return {
    stdout: `Scheduler: ${running}
Total routines: ${routines.length}
Active: ${active}
Paused: ${paused}
Total executions: ${totalRuns}`,
    stderr: '',
    exitCode: 0,
  };
}
