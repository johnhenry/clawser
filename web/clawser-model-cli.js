/**
 * clawser-model-cli.js — Shell commands for local AI model management
 *
 * Registers the `model` command with subcommands:
 *   model list [--task X]   — List models with cached/loaded status
 *   model pull <id>         — Download model to cache
 *   model rm <id>           — Delete cached model
 *   model info <id>         — Show model metadata
 *   model status            — Overview of all models
 *   model cache             — Show cache backend and usage
 *
 * Usage:
 *   import { registerModelCli } from './clawser-model-cli.js';
 *   registerModelCli(registry, getManager);
 */

import { formatBytes } from './clawser-models.js'

/**
 * Register the `model` command with a shell CommandRegistry.
 * @param {import('./clawser-shell.js').CommandRegistry} registry
 * @param {() => import('./clawser-models.js').ModelManager} getManager
 */
export function registerModelCli(registry, getManager) {
  registry.register('model', async ({ args }) => {
    const sub = args[0]
    const manager = getManager()

    if (!manager) {
      return { stdout: '', stderr: 'Model manager not initialized', exitCode: 1 }
    }

    switch (sub) {
      case 'list':
      case 'ls':
        return modelList(manager, args.slice(1))

      case 'pull':
      case 'download':
        return modelPull(manager, args.slice(1))

      case 'rm':
      case 'remove':
        return modelRemove(manager, args.slice(1))

      case 'info':
        return modelInfo(manager, args.slice(1))

      case 'status':
      case 'st':
        return modelStatus(manager)

      case 'cache':
        return modelCache(manager)

      default:
        return {
          stdout: [
            'Usage: model <command> [args]',
            '',
            'Commands:',
            '  list [--task X]   List available models',
            '  pull <id>         Download model to cache',
            '  rm <id>           Remove cached model',
            '  info <id>         Show model details',
            '  status            Show all model statuses',
            '  cache             Show cache backend info',
          ].join('\n'),
          stderr: '',
          exitCode: sub ? 1 : 0,
        }
    }
  }, {
    description: 'Manage local AI models',
    category: 'ai',
    usage: 'model <list|pull|rm|info|status|cache> [args]',
  })
}

// ── Subcommands ──────────────────────────────────────────────────

async function modelList(manager, args) {
  // Parse --task flag
  let task = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task' && args[i + 1]) {
      task = args[i + 1]
      break
    }
  }

  const models = manager.registry.list(task)
  if (!models.length) {
    return { stdout: task ? `No models for task: ${task}` : 'No models registered', stderr: '', exitCode: 0 }
  }

  const statuses = await manager.statusAll()
  const statusMap = new Map(statuses.map(s => [s.id, s.status]))

  // Column widths
  const idW = Math.max(4, ...models.map(m => m.id.length + (m.defaultForTask ? 2 : 0)))
  const taskW = Math.max(4, ...models.map(m => m.task.length))
  const rtW = Math.max(7, ...models.map(m => m.runtime.length))
  const sizeW = 8
  const statW = 10

  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length))
  const header = `${pad('ID', idW)}  ${pad('TASK', taskW)}  ${pad('RUNTIME', rtW)}  ${pad('SIZE', sizeW)}  STATUS`
  const sep = '-'.repeat(header.length)

  const rows = models.map(m => {
    const id = m.defaultForTask ? `${m.id} *` : m.id
    const status = statusMap.get(m.id) || '?'
    return `${pad(id, idW)}  ${pad(m.task, taskW)}  ${pad(m.runtime, rtW)}  ${pad(formatBytes(m.sizeEstimate || 0), sizeW)}  ${status}`
  })

  const output = [header, sep, ...rows, '', '* = default for task']
  if (task) output.push(`(filtered by task: ${task})`)

  return { stdout: output.join('\n'), stderr: '', exitCode: 0 }
}

async function modelPull(manager, args) {
  const id = args[0]
  if (!id) return { stdout: '', stderr: 'Usage: model pull <model-id>', exitCode: 1 }

  const entry = manager.registry.get(id)
  if (!entry) return { stdout: '', stderr: `Unknown model: ${id}`, exitCode: 1 }

  try {
    await manager.pull(id, (p) => {
      // Progress is not shown in CLI output (non-interactive)
    })
    return { stdout: `Downloaded ${id} (${entry.runtime}, ~${formatBytes(entry.sizeEstimate || 0)})`, stderr: '', exitCode: 0 }
  } catch (e) {
    return { stdout: '', stderr: `Failed to pull ${id}: ${e.message}`, exitCode: 1 }
  }
}

async function modelRemove(manager, args) {
  const id = args[0]
  if (!id) return { stdout: '', stderr: 'Usage: model rm <model-id>', exitCode: 1 }

  try {
    await manager.remove(id)
    return { stdout: `Removed ${id}`, stderr: '', exitCode: 0 }
  } catch (e) {
    return { stdout: '', stderr: `Failed to remove ${id}: ${e.message}`, exitCode: 1 }
  }
}

async function modelInfo(manager, args) {
  const id = args[0]
  if (!id) return { stdout: '', stderr: 'Usage: model info <model-id>', exitCode: 1 }

  const entry = manager.registry.get(id)
  if (!entry) return { stdout: '', stderr: `Unknown model: ${id}`, exitCode: 1 }

  const status = await manager.statusAsync(id)
  const lines = [
    `ID:          ${entry.id}`,
    `Repo:        ${entry.repo}`,
    `Task:        ${entry.task}`,
    `Runtime:     ${entry.runtime}`,
    `Description: ${entry.description || 'N/A'}`,
    `Size:        ~${formatBytes(entry.sizeEstimate || 0)}`,
    `Quantized:   ${entry.quantized !== false ? 'yes' : 'no'}`,
    `Default:     ${entry.defaultForTask ? 'yes' : 'no'}`,
    `Status:      ${status}`,
  ]
  if (entry.runtime === 'mediapipe') {
    lines.push(`Delegate:    ${entry.mediapipeDelegate || 'GPU'}`)
  }

  return { stdout: lines.join('\n'), stderr: '', exitCode: 0 }
}

async function modelStatus(manager) {
  const all = await manager.statusAll()
  const loaded = all.filter(s => s.status === 'loaded')
  const cached = all.filter(s => s.status === 'cached')
  const notCached = all.filter(s => s.status === 'not_cached')

  const lines = [
    `Total: ${all.length} models`,
    `Loaded: ${loaded.length}`,
    `Cached: ${cached.length}`,
    `Not cached: ${notCached.length}`,
    `Backend: ${manager.cache.backendName}`,
  ]

  if (loaded.length) {
    lines.push('\nLoaded models:')
    for (const s of loaded) lines.push(`  ${s.id} (${s.runtime}, ${s.task})`)
  }

  return { stdout: lines.join('\n'), stderr: '', exitCode: 0 }
}

async function modelCache(manager) {
  const usage = await manager.cache.usage()
  const cached = await manager.cache.list()

  const lines = [
    `Backend: ${manager.cache.backendName}`,
    `Usage: ${formatBytes(usage)}`,
    `Cached repos: ${cached.length}`,
  ]

  if (cached.length) {
    lines.push('')
    for (const repo of cached) lines.push(`  ${repo}`)
  }

  return { stdout: lines.join('\n'), stderr: '', exitCode: 0 }
}
