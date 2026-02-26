//! Reverse tunnel listener management.
//!
//! On `ListenRequest`: bind a TCP listener on the server, accept incoming
//! connections, and notify the client via `InboundOpen` messages sent through
//! an `mpsc` channel.
//!
//! Each listener runs in its own spawned accept-loop task that can be
//! cancelled via [`ReverseListenerManager::close_listener`].

use super::policy::GatewayPolicyEnforcer;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, info, warn};
use wsh_core::messages::*;

/// Manages reverse tunnel TCP listeners.
///
/// Holds a shared [`GatewayPolicyEnforcer`] for listen-permission checks and
/// connection counting, and a map of active listeners keyed by `listener_id`.
pub struct ReverseListenerManager {
    /// Shared policy enforcer for reverse-tunnel checks.
    policy: Arc<GatewayPolicyEnforcer>,
    /// Active listeners: `listener_id` to [`ListenerEntry`].
    listeners: Mutex<HashMap<u32, ListenerEntry>>,
}

/// Bookkeeping for a single active reverse tunnel listener.
///
/// Stored in the [`ReverseListenerManager`]'s map and removed when the
/// listener is closed.
struct ListenerEntry {
    /// Sender half of the cancel channel; dropping or sending signals the
    /// accept loop to shut down.
    cancel_tx: mpsc::Sender<()>,
    /// The port the OS actually bound (may differ from the requested port
    /// when the request specified port 0).
    actual_port: u16,
}

impl ReverseListenerManager {
    /// Create a new listener manager backed by the given policy enforcer.
    ///
    /// # Arguments
    ///
    /// * `policy` - Shared [`GatewayPolicyEnforcer`] used for listen-permission
    ///   checks and connection counting.
    pub fn new(policy: Arc<GatewayPolicyEnforcer>) -> Self {
        Self {
            policy,
            listeners: Mutex::new(HashMap::new()),
        }
    }

    /// Handle a `ListenRequest` message.
    ///
    /// Checks the policy, binds a TCP listener on `bind_addr:port`, spawns an
    /// accept loop, and returns [`MsgType::ListenOk`] or [`MsgType::ListenFail`].
    ///
    /// # Arguments
    ///
    /// * `listener_id` - Client-assigned identifier for this listener.
    /// * `port` - Requested TCP port to bind. Use `0` for an OS-assigned port.
    /// * `bind_addr` - Local address to bind (e.g. `"0.0.0.0"` or `"127.0.0.1"`).
    /// * `inbound_tx` - Channel sender used to notify the session loop when a
    ///   new inbound connection is accepted.
    pub async fn handle_listen_request(
        &self,
        listener_id: u32,
        port: u16,
        bind_addr: &str,
        inbound_tx: mpsc::Sender<InboundEvent>,
    ) -> Envelope {
        // Policy check
        if let Err(reason) = self.policy.check_listen(port) {
            return build_listen_fail(listener_id, &reason);
        }

        let addr = format!("{}:{}", bind_addr, port);
        match TcpListener::bind(&addr).await {
            Ok(tcp_listener) => {
                let actual_port = tcp_listener
                    .local_addr()
                    .map(|a| a.port())
                    .unwrap_or(port);

                let guard = self.policy.acquire();

                let (cancel_tx, cancel_rx) = mpsc::channel::<()>(1);
                self.listeners.lock().await.insert(
                    listener_id,
                    ListenerEntry {
                        cancel_tx,
                        actual_port,
                    },
                );

                info!(
                    listener_id,
                    addr = %addr,
                    actual_port,
                    "reverse tunnel listener started"
                );

                // Spawn accept loop — guard lives until loop ends
                let listener_id_copy = listener_id;
                tokio::spawn(async move {
                    let _guard = guard; // keep alive for connection counting
                    Self::accept_loop(tcp_listener, cancel_rx, listener_id_copy, inbound_tx).await;
                    debug!(listener_id = listener_id_copy, "accept loop ended");
                });

                build_listen_ok(listener_id, actual_port)
            }
            Err(e) => {
                warn!(listener_id, addr = %addr, error = %e, "listen bind failed");
                build_listen_fail(listener_id, &e.to_string())
            }
        }
    }

    /// Close a listener by its `listener_id`.
    ///
    /// Sends a cancel signal to the accept loop and removes the entry from
    /// the map. Returns a [`MsgType::ListenClose`] envelope if the listener
    /// existed, or `None` if no listener was found for the given ID.
    ///
    /// # Arguments
    ///
    /// * `listener_id` - The identifier of the listener to close.
    pub async fn close_listener(&self, listener_id: u32) -> Option<Envelope> {
        if let Some(entry) = self.listeners.lock().await.remove(&listener_id) {
            let _ = entry.cancel_tx.send(()).await;
            info!(listener_id, "reverse tunnel listener closed");
            Some(build_listen_close(listener_id))
        } else {
            None
        }
    }

    /// Accept loop for a reverse tunnel listener.
    async fn accept_loop(
        listener: TcpListener,
        mut cancel_rx: mpsc::Receiver<()>,
        listener_id: u32,
        inbound_tx: mpsc::Sender<InboundEvent>,
    ) {
        let mut next_channel_id: u32 = 1;

        loop {
            tokio::select! {
                _ = cancel_rx.recv() => {
                    debug!(listener_id, "accept loop cancelled");
                    break;
                }
                result = listener.accept() => {
                    match result {
                        Ok((_stream, peer_addr)) => {
                            let channel_id = next_channel_id;
                            next_channel_id += 1;

                            info!(
                                listener_id,
                                channel_id,
                                peer = %peer_addr,
                                "inbound connection accepted"
                            );

                            let event = InboundEvent {
                                listener_id,
                                channel_id,
                                peer_addr: peer_addr.ip().to_string(),
                                peer_port: peer_addr.port(),
                            };

                            if inbound_tx.send(event).await.is_err() {
                                warn!(listener_id, "inbound event channel closed");
                                break;
                            }
                        }
                        Err(e) => {
                            warn!(listener_id, error = %e, "accept failed");
                        }
                    }
                }
            }
        }
    }
}

/// Event sent through the `mpsc` channel when a new inbound connection is
/// accepted on a reverse tunnel listener.
///
/// Consumed by the session loop, which converts it into an `InboundOpen`
/// message and sends it to the client.
#[derive(Debug)]
pub struct InboundEvent {
    /// The listener that accepted this connection.
    pub listener_id: u32,
    /// Locally assigned channel identifier, unique within a listener and
    /// monotonically increasing.
    pub channel_id: u32,
    /// IP address of the connecting peer.
    pub peer_addr: String,
    /// Source port of the connecting peer.
    pub peer_port: u16,
}

// ── Message builders ─────────────────────────────────────────────────

/// Build a [`MsgType::ListenOk`] envelope confirming that a listener was
/// successfully bound.
///
/// * `listener_id` - The client-assigned listener identifier.
/// * `actual_port` - The port the OS actually bound (may differ from the
///   requested port when port 0 was specified).
fn build_listen_ok(listener_id: u32, actual_port: u16) -> Envelope {
    Envelope {
        msg_type: MsgType::ListenOk,
        payload: Payload::ListenOk(ListenOkPayload {
            listener_id,
            actual_port,
        }),
    }
}

/// Build a [`MsgType::ListenFail`] envelope for a failed listen attempt.
///
/// * `listener_id` - The client-assigned listener identifier.
/// * `reason` - Human-readable description of the failure.
fn build_listen_fail(listener_id: u32, reason: &str) -> Envelope {
    Envelope {
        msg_type: MsgType::ListenFail,
        payload: Payload::ListenFail(ListenFailPayload {
            listener_id,
            reason: reason.to_string(),
        }),
    }
}

/// Build a [`MsgType::ListenClose`] envelope confirming listener teardown.
///
/// * `listener_id` - The identifier of the closed listener.
fn build_listen_close(listener_id: u32) -> Envelope {
    Envelope {
        msg_type: MsgType::ListenClose,
        payload: Payload::ListenClose(ListenClosePayload { listener_id }),
    }
}
