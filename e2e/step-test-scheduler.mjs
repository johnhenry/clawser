;(async () => {
  const { state } = await import('./clawser-state.js')
  const ms = state.meshScheduler
  const task = ms.submit({ type: 'compute', payload: { op: 'echo' }, priority: 1 })
  return JSON.stringify({ submitted: !!task, queueDepth: ms.getQueueDepth() })
})()
