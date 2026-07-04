/**
 * clawser-snapshot-cli.js — Shell `snapshot` command for atomic workspace snapshots
 *
 * Subcommands: save, restore, list, delete, info
 *
 * Usage:
 *   import { registerSnapshotCli } from './clawser-snapshot-cli.js';
 *   registerSnapshotCli(registry, getAgent, getShell, getRoutineEngine, getSkillRegistry);
 */

import { SnapshotManager } from './clawser-snapshots.js';

/**
 * Format bytes to a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
const fmtBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Format a timestamp for display.
 * @param {number} ts
 * @returns {string}
 */
const fmtTime = (ts) => {
  if (!ts) return 'unknown';
  return new Date(ts).toLocaleString();
};

/**
 * Register the `snapshot` command with a shell registry.
 *
 * @param {object} registry - Shell command registry
 * @param {() => import('./clawser-agent.js').ClawserAgent} getAgent
 * @param {() => import('./clawser-shell.js').ClawserShell} getShell
 * @param {() => import('./clawser-routines.js').RoutineEngine} getRoutineEngine
 * @param {() => import('./clawser-skills.js').SkillRegistry} getSkillRegistry
 */
export const registerSnapshotCli = (registry, getAgent, getShell, getRoutineEngine, getSkillRegistry) => {
  const mgr = new SnapshotManager();

  const HELP = `Usage: snapshot <subcommand> [args]

Subcommands:
  save [name]           Save an atomic snapshot of the current workspace
  restore <id>          Restore workspace state from a snapshot
  list                  List all snapshots
  delete <id>           Delete a snapshot
  info <id>             Show detailed info about a snapshot
  clear                 Delete all snapshots

Options:
  --json                Output in JSON format

Examples:
  snapshot save "before-refactor"
  snapshot list
  snapshot restore snap_abc123
  snapshot delete snap_abc123`;

  registry.register('snapshot', async ({ args }) => {
    if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
      return { stdout: HELP, stderr: '', exitCode: 0 };
    }

    const json = args.includes('--json') || args.includes('-j');
    const cleanArgs = args.filter(a => a !== '--json' && a !== '-j');
    const subcmd = cleanArgs[0];
    const subArgs = cleanArgs.slice(1);

    switch (subcmd) {
      case 'save':
        return cmdSave(subArgs, json);
      case 'restore':
        return cmdRestore(subArgs, json);
      case 'list':
      case 'ls':
        return cmdList(json);
      case 'delete':
      case 'rm':
        return cmdDelete(subArgs, json);
      case 'info':
        return cmdInfo(subArgs, json);
      case 'clear':
        return cmdClear(json);
      default:
        return { stdout: '', stderr: `Unknown subcommand: ${subcmd}\n\n${HELP}`, exitCode: 1 };
    }
  }, {
    description: 'Save and restore atomic workspace snapshots',
    category: 'Workspace',
    usage: 'snapshot <save|restore|list|delete|info|clear> [args]',
  });

  // ── save ────────────────────────────────────────────────────

  /**
   * Resolve a workspace fs adapter for tar snapshots.
   * Prefers `shell.fs` (VirtualFs falls through to the real fs for
   * non-virtual paths like `~/.local/share/clawser/snapshots/`).
   * Returns null when no shell is available — caller falls back to IDB.
   */
  const getFs = () => {
    const shell = getShell?.();
    return shell?.fs || null;
  };

  const cmdSave = async (args, json) => {
    const agent = getAgent();
    if (!agent) {
      const msg = 'No agent available — cannot create snapshot';
      return json
        ? { stdout: JSON.stringify({ error: msg }), stderr: '', exitCode: 1 }
        : { stdout: '', stderr: msg, exitCode: 1 };
    }

    const name = args.join(' ') || undefined;
    const fs = getFs();

    try {
      // Per UFS §2.4: tar to OPFS is the canonical path. Fall back to IDB
      // only when no shell fs is available (early boot / disposable mode).
      let meta;
      if (fs) {
        meta = await mgr.createTarSnapshot({
          agent,
          routineEngine: getRoutineEngine?.(),
          shell: getShell?.(),
          skillRegistry: getSkillRegistry?.(),
          name,
          wsId: agent.getWorkspace?.(),
          fs,
        });
      } else {
        meta = await mgr.createAtomicSnapshot({
          agent,
          routineEngine: getRoutineEngine?.(),
          shell: getShell?.(),
          skillRegistry: getSkillRegistry?.(),
          name,
          wsId: agent.getWorkspace?.(),
        });
      }

      if (json) {
        return { stdout: JSON.stringify(meta, null, 2), stderr: '', exitCode: 0 };
      }

      const sizeLine = meta.compressedSize != null
        ? `  Size:       ${fmtBytes(meta.size)} → ${fmtBytes(meta.compressedSize)} compressed`
        : `  Size:       ${fmtBytes(meta.size)} (tar)`;
      const lines = [
        `Snapshot saved: ${meta.id}`,
        `  Name:       ${meta.name}`,
        `  Workspace:  ${meta.wsId}`,
        sizeLine,
        `  Subsystems: ${meta.subsystems.join(', ')}`,
        `  Created:    ${fmtTime(meta.timestamp)}`,
      ];
      if (meta.path) lines.push(`  Path:       ${meta.path}`);
      return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
    } catch (e) {
      const msg = `Snapshot save failed: ${e.message}`;
      return json
        ? { stdout: JSON.stringify({ error: msg }), stderr: '', exitCode: 1 }
        : { stdout: '', stderr: msg, exitCode: 1 };
    }
  };

  // ── restore ─────────────────────────────────────────────────

  const cmdRestore = async (args, json) => {
    if (args.length === 0) {
      const msg = 'Usage: snapshot restore <id>';
      return json
        ? { stdout: JSON.stringify({ error: msg }), stderr: '', exitCode: 1 }
        : { stdout: '', stderr: msg, exitCode: 1 };
    }

    const agent = getAgent();
    if (!agent) {
      const msg = 'No agent available — cannot restore snapshot';
      return json
        ? { stdout: JSON.stringify({ error: msg }), stderr: '', exitCode: 1 }
        : { stdout: '', stderr: msg, exitCode: 1 };
    }

    const id = args[0];
    const fs = getFs();

    try {
      // Try tar-on-OPFS first; fall back to IDB for legacy snapshots.
      let result = null;
      if (fs) {
        result = await mgr.restoreTarSnapshot(id, {
          agent,
          routineEngine: getRoutineEngine?.(),
          shell: getShell?.(),
          skillRegistry: getSkillRegistry?.(),
          fs,
        });
      }
      if (!result) {
        result = await mgr.restoreAtomicSnapshot(id, {
          agent,
          routineEngine: getRoutineEngine?.(),
          shell: getShell?.(),
          skillRegistry: getSkillRegistry?.(),
        });
      }

      if (!result) {
        const msg = `Snapshot not found: ${id}`;
        return json
          ? { stdout: JSON.stringify({ error: msg }), stderr: '', exitCode: 1 }
          : { stdout: '', stderr: msg, exitCode: 1 };
      }

      if (json) {
        return { stdout: JSON.stringify(result, null, 2), stderr: '', exitCode: 0 };
      }

      const lines = [
        `Restored snapshot: ${result.meta.name} (${result.meta.id})`,
        `  Restored:  ${result.restored.join(', ') || 'none'}`,
      ];
      if (result.skipped.length) lines.push(`  Skipped:   ${result.skipped.join(', ')}`);
      if (result.errors.length) lines.push(`  Errors:    ${result.errors.join('; ')}`);
      return { stdout: lines.join('\n'), stderr: '', exitCode: result.errors.length > 0 ? 1 : 0 };
    } catch (e) {
      const msg = `Snapshot restore failed: ${e.message}`;
      return json
        ? { stdout: JSON.stringify({ error: msg }), stderr: '', exitCode: 1 }
        : { stdout: '', stderr: msg, exitCode: 1 };
    }
  };

  // ── list ────────────────────────────────────────────────────

  const cmdList = async (json) => {
    try {
      const fs = getFs();
      // Merge tar (OPFS) and legacy IDB snapshot lists, deduping by id.
      const tarList = fs ? await mgr.listTarSnapshots({ fs }).catch(() => []) : [];
      const idbList = await mgr.listSnapshots().catch(() => []);
      const seen = new Set(tarList.map(s => s.id));
      const snapshots = [
        ...tarList,
        ...idbList.filter(s => !seen.has(s.id)),
      ];

      if (json) {
        return { stdout: JSON.stringify(snapshots, null, 2), stderr: '', exitCode: 0 };
      }

      if (snapshots.length === 0) {
        return { stdout: 'No snapshots found.', stderr: '', exitCode: 0 };
      }

      const lines = [`${snapshots.length} snapshot(s):\n`];
      for (const s of snapshots) {
        const sizeStr = s.compressedSize != null
          ? fmtBytes(s.compressedSize)
          : fmtBytes(s.size);
        lines.push(`  ${s.id}  ${s.name}`);
        lines.push(`    ${fmtTime(s.timestamp)}  ${sizeStr}  ws:${s.wsId}${s.path ? '  tar' : '  idb'}`);
      }
      return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
    } catch (e) {
      const msg = `Snapshot list failed: ${e.message}`;
      return json
        ? { stdout: JSON.stringify({ error: msg }), stderr: '', exitCode: 1 }
        : { stdout: '', stderr: msg, exitCode: 1 };
    }
  };

  // ── delete ──────────────────────────────────────────────────

  const cmdDelete = async (args, json) => {
    if (args.length === 0) {
      const msg = 'Usage: snapshot delete <id>';
      return json
        ? { stdout: JSON.stringify({ error: msg }), stderr: '', exitCode: 1 }
        : { stdout: '', stderr: msg, exitCode: 1 };
    }

    const id = args[0];
    const fs = getFs();

    try {
      // Try tar first, then IDB. Either backend may legitimately not have it.
      let deleted = false;
      if (fs) deleted = await mgr.deleteTarSnapshot(id, { fs });
      if (!deleted) deleted = await mgr.deleteSnapshot(id);
      if (!deleted) {
        const msg = `Snapshot not found: ${id}`;
        return json
          ? { stdout: JSON.stringify({ error: msg }), stderr: '', exitCode: 1 }
          : { stdout: '', stderr: msg, exitCode: 1 };
      }

      const msg = `Deleted snapshot: ${id}`;
      return json
        ? { stdout: JSON.stringify({ success: true, id }), stderr: '', exitCode: 0 }
        : { stdout: msg, stderr: '', exitCode: 0 };
    } catch (e) {
      const msg = `Snapshot delete failed: ${e.message}`;
      return json
        ? { stdout: JSON.stringify({ error: msg }), stderr: '', exitCode: 1 }
        : { stdout: '', stderr: msg, exitCode: 1 };
    }
  };

  // ── info ────────────────────────────────────────────────────

  const cmdInfo = async (args, json) => {
    if (args.length === 0) {
      const msg = 'Usage: snapshot info <id>';
      return json
        ? { stdout: JSON.stringify({ error: msg }), stderr: '', exitCode: 1 }
        : { stdout: '', stderr: msg, exitCode: 1 };
    }

    const id = args[0];

    try {
      const meta = await mgr.getSnapshotMeta(id);
      if (!meta) {
        const msg = `Snapshot not found: ${id}`;
        return json
          ? { stdout: JSON.stringify({ error: msg }), stderr: '', exitCode: 1 }
          : { stdout: '', stderr: msg, exitCode: 1 };
      }

      if (json) {
        return { stdout: JSON.stringify(meta, null, 2), stderr: '', exitCode: 0 };
      }

      const ratio = meta.size > 0 ? ((1 - meta.compressedSize / meta.size) * 100).toFixed(1) : 0;
      const lines = [
        `Snapshot: ${meta.id}`,
        `  Name:        ${meta.name}`,
        `  Workspace:   ${meta.wsId}`,
        `  Created:     ${fmtTime(meta.timestamp)}`,
        `  Raw size:    ${fmtBytes(meta.size)}`,
        `  Compressed:  ${fmtBytes(meta.compressedSize)} (${ratio}% reduction)`,
        `  Version:     ${meta.version}`,
        `  Subsystems:  ${meta.subsystems.join(', ')}`,
      ];
      return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
    } catch (e) {
      const msg = `Snapshot info failed: ${e.message}`;
      return json
        ? { stdout: JSON.stringify({ error: msg }), stderr: '', exitCode: 1 }
        : { stdout: '', stderr: msg, exitCode: 1 };
    }
  };

  // ── clear ───────────────────────────────────────────────────

  const cmdClear = async (json) => {
    try {
      await mgr.clearAll();
      const msg = 'All snapshots deleted.';
      return json
        ? { stdout: JSON.stringify({ success: true }), stderr: '', exitCode: 0 }
        : { stdout: msg, stderr: '', exitCode: 0 };
    } catch (e) {
      const msg = `Snapshot clear failed: ${e.message}`;
      return json
        ? { stdout: JSON.stringify({ error: msg }), stderr: '', exitCode: 1 }
        : { stdout: '', stderr: msg, exitCode: 1 };
    }
  };
};
