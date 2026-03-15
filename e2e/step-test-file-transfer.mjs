;(async () => {
  const { state } = await import('./clawser-state.js')
  const localPodId = state.pod.podId
  const ft = state.fileTransfer
  const peers = Object.keys(window.__rtcConns || {}).filter(
    rp => window.__rtcConns[rp].isOpen
  )
  if (peers.length === 0) return JSON.stringify({ error: 'no connected peers' })

  const recipient = peers[0]

  // Create a file offer
  const offer = ft.createOffer(recipient, [
    { name: 'test.txt', size: 128, mimeType: 'text/plain' },
  ], { sender: localPodId })

  // The onSend callback (wired in full-mesh-connect or step-wire-transport)
  // will route the FILE_OFFER message through WebRTC to the recipient.
  await new Promise(r => setTimeout(r, 500))

  // List local transfers
  const transfers = ft.listTransfers()

  return JSON.stringify({
    offerId: offer.transferId,
    offerSent: !!offer.transferId,
    transferCount: transfers.length,
    recipientPodId: recipient.slice(0, 12),
  })
})()
