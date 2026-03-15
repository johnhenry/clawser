;(async () => {
  const { state } = await import('./clawser-state.js')
  const ft = state.fileTransfer
  const transfers = ft.listTransfers()

  // Look for offers where we are the recipient
  const localPodId = state.pod.podId
  const inbound = transfers.filter(t =>
    t.offer && t.offer.recipient === localPodId
  )

  return JSON.stringify({
    totalTransfers: transfers.length,
    inboundOffers: inbound.length,
    hasOffer: transfers.length > 0,
    firstOffer: transfers.length > 0 ? {
      transferId: transfers[0].offer?.transferId,
      status: transfers[0].state?.status,
    } : null,
  })
})()
