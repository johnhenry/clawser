//! WebSocket listener using tokio-tungstenite.
//!
//! Provides a fallback transport for clients that cannot use WebTransport/QUIC.
//! Each WebSocket connection is wrapped in an adapter that provides multiplexed
//! stream semantics over the single WS connection.

use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, warn};
use wsh_core::{WshError, WshResult};

/// A handle to an accepted WebSocket connection.
pub struct WebSocketConnection {
    /// The WebSocket stream (split into sink + stream in usage).
    pub ws_stream: tokio_tungstenite::WebSocketStream<TcpStream>,
    /// Remote address.
    pub remote_addr: SocketAddr,
}

/// Start the WebSocket listener.
///
/// Returns a receiver that yields accepted connections.
pub async fn start_listener(
    bind_addr: SocketAddr,
) -> WshResult<mpsc::Receiver<WebSocketConnection>> {
    let tcp_listener = TcpListener::bind(bind_addr)
        .await
        .map_err(|e| WshError::Transport(format!("WS bind failed: {e}")))?;

    info!(addr = %bind_addr, "WebSocket listener started");

    let (tx, rx) = mpsc::channel::<WebSocketConnection>(64);

    tokio::spawn(async move {
        loop {
            match tcp_listener.accept().await {
                Ok((stream, addr)) => {
                    let tx = tx.clone();
                    tokio::spawn(async move {
                        match tokio_tungstenite::accept_async(stream).await {
                            Ok(ws_stream) => {
                                debug!(remote = %addr, "WebSocket connection accepted");
                                let conn = WebSocketConnection {
                                    ws_stream,
                                    remote_addr: addr,
                                };
                                if tx.send(conn).await.is_err() {
                                    warn!("WebSocket connection channel closed");
                                }
                            }
                            Err(e) => {
                                warn!(remote = %addr, error = %e, "WebSocket handshake failed");
                            }
                        }
                    });
                }
                Err(e) => {
                    error!(error = %e, "TCP accept failed");
                }
            }
        }
    });

    Ok(rx)
}

/// Helper: send a binary message over a WebSocket.
pub async fn ws_send_binary(
    ws: &mut tokio_tungstenite::WebSocketStream<TcpStream>,
    data: &[u8],
) -> WshResult<()> {
    ws.send(Message::Binary(data.to_vec().into()))
        .await
        .map_err(|e| WshError::Transport(format!("WS send failed: {e}")))
}

/// Maximum frame size for WebSocket messages (1 MiB, consistent with QUIC limit).
const MAX_WS_FRAME_SIZE: usize = 1_048_576;

/// Helper: receive the next binary message from a WebSocket.
///
/// Returns `None` if the connection is closed. Text messages are ignored.
/// Rejects frames larger than 1 MiB (consistent with QUIC transport limit).
pub async fn ws_recv_binary(
    ws: &mut tokio_tungstenite::WebSocketStream<TcpStream>,
) -> WshResult<Option<Vec<u8>>> {
    loop {
        match ws.next().await {
            Some(Ok(Message::Binary(data))) => {
                if data.len() > MAX_WS_FRAME_SIZE {
                    return Err(WshError::InvalidMessage(format!(
                        "WS frame too large: {} bytes (max {})",
                        data.len(),
                        MAX_WS_FRAME_SIZE
                    )));
                }
                return Ok(Some(data.to_vec()));
            }
            Some(Ok(Message::Close(_))) => return Ok(None),
            Some(Ok(Message::Ping(payload))) => {
                // Respond to pings automatically
                let _ = ws.send(Message::Pong(payload)).await;
            }
            Some(Ok(_)) => {
                // Ignore text and other message types
                continue;
            }
            Some(Err(e)) => {
                return Err(WshError::Transport(format!("WS recv failed: {e}")));
            }
            None => return Ok(None),
        }
    }
}
