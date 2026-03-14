;(async () => {
  const { state } = await import('./clawser-state.js')
  const sd = state.serviceDirectory
  const name = 'echo-' + state.pod.podId.slice(0, 6)
  let registered = false
  try {
    sd.register(name, async (req) => ({ echo: req }), { metadata: { v: '1.0' } })
    registered = true
  } catch (e) {
    if (e.message.includes('already registered')) registered = true
    else return JSON.stringify({ registered, error: e.message })
  }
  return JSON.stringify({ registered, localCount: sd.listLocal().length })
})()
