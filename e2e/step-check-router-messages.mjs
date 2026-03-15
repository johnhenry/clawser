;(async () => {
  const msgs = window.__rtcMessages || []
  // Look for router-wrapped messages
  const routerMsgs = msgs.filter(m =>
    m.data && (m.data._mesh === 'router' || (m.data.type === 'e2e-router-test'))
  )
  // Also check for any messages with the router payload
  const routerPayloads = msgs.filter(m =>
    m.data && m.data._mesh === 'router' &&
    m.data.payload && m.data.payload.body &&
    m.data.payload.body.body === 'hello-from-router'
  )

  return JSON.stringify({
    totalMessages: msgs.length,
    routerMessages: routerMsgs.length,
    routerPayloads: routerPayloads.length,
    receivedRouterMsg: routerMsgs.length > 0,
  })
})()
