/**
 * Runtime-aware routine execution helpers.
 *
 * Keeps background/automation flows on the same canonical target-resolution
 * path as interactive remote-runtime sessions.
 */
import { normalizeRemoteRuntimeQuery, resolveRuntimeQuerySelector } from './clawser-remote-runtime-query.js'

function routinePrompt(routine) {
  return routine?.action?.command
    || routine?.action?.prompt
    || routine?.name
    || 'routine'
}

function normalizeRoutineTarget(action = {}) {
  if (!action?.target) return null
  if (typeof action.target === 'string') {
    return {
      selector: action.target,
      intent: action.intent || 'automation',
    }
  }
  if (typeof action.target === 'object') {
    return {
      selector: action.target.selector || action.target.podId || null,
      query: action.target.query ? normalizeRemoteRuntimeQuery(action.target.query) : null,
      intent: action.target.intent || action.intent || 'automation',
      operation: action.target.operation || action.operation || null,
      path: action.target.path || action.path || null,
      data: action.target.data || action.data || null,
      requiredCapabilities: [...(action.target.requiredCapabilities || [])],
      constraints: { ...(action.target.constraints || action.constraints || {}) },
    }
  }
  return null
}

export async function executeRoutineAction({
  routine,
  triggerEvent = null,
  orchestrator = null,
  remoteSessionBroker = null,
  remoteRuntimeRegistry = null,
  gateway = null,
  agent = null,
} = {}) {
  const target = normalizeRoutineTarget(routine?.action || {})
  const prompt = routinePrompt(routine)
  const timeoutMs = routine?.guardrails?.timeoutMs || undefined
  const selector = target?.query
    ? resolveRuntimeQuerySelector(remoteRuntimeRegistry, target.query)
    : target?.selector

  if (selector) {
    if (
      orchestrator?.runComputeTask
      && (target.intent === 'automation' || target.intent === 'exec' || target.intent === 'terminal')
    ) {
      return orchestrator.runComputeTask({
        selector,
        command: prompt,
        constraints: target.constraints || {},
        timeoutMs,
      })
    }

    if (remoteSessionBroker?.openSession) {
      return remoteSessionBroker.openSession(selector, {
        intent: target.intent || 'automation',
        command: prompt,
        operation: target.operation || undefined,
        path: target.path || undefined,
        data: target.data || undefined,
        requiredCapabilities: target.requiredCapabilities || undefined,
        timeout: timeoutMs,
        actor: 'automation',
        triggerEvent,
      })
    }
  }

  const routineId = routine?.id || `unnamed_${Date.now()}`
  const routineName = routine?.name || routineId
  if (gateway) {
    try {
      return await gateway.ingest({
        id: `routine_${routineId}_${Date.now()}`,
        channel: 'scheduler',
        channelId: routineId,
        sender: { id: 'scheduler', name: routineName, username: null },
        content: prompt,
        attachments: [],
        replyTo: null,
        timestamp: Date.now(),
      }, `scheduler:${routineId}`)
    } catch {
      // Fall through to direct agent execution below.
    }
  }

  if (agent) {
    agent.sendMessage(prompt)
    return agent.run()
  }

  throw new Error('No routine execution path is available')
}

export { normalizeRoutineTarget, routinePrompt }
