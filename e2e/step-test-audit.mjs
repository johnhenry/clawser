;(async () => {
  const { state } = await import('./clawser-state.js')
  const ac = state.auditChain
  ac.append({ action: 'e2e-test', actor: state.pod.podId, data: 'test' })
  const v = ac.verify()
  return JSON.stringify({ length: ac.length, verified: v && (v.valid !== false) })
})()
