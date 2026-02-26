//! WebTransport listener using quinn (QUIC).
//!
//! Accepts incoming QUIC connections, negotiates ALPN for WebTransport,
//! and dispatches each connection to a handler task.

use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use wsh_core::{WshError, WshResult};

/// A handle to an accepted WebTransport connection.
pub struct WebTransportConnection {
    /// The QUIC connection.
    pub connection: quinn::Connection,
    /// Remote address.
    pub remote_addr: SocketAddr,
}

/// Start the WebTransport (QUIC) listener.
///
/// Returns a receiver that yields accepted connections. The listener runs
/// in a background task until the endpoint is dropped.
pub async fn start_listener(
    bind_addr: SocketAddr,
    tls_config: Arc<rustls::ServerConfig>,
) -> WshResult<(quinn::Endpoint, mpsc::Receiver<WebTransportConnection>)> {
    let quic_server_config =
        quinn::crypto::rustls::QuicServerConfig::try_from(tls_config)
            .map_err(|e| WshError::Transport(format!("QUIC crypto config failed: {e}")))?;
    let quinn_server_config = quinn::ServerConfig::with_crypto(Arc::new(quic_server_config));

    let endpoint = quinn::Endpoint::server(quinn_server_config, bind_addr)
        .map_err(|e| WshError::Transport(format!("QUIC bind failed: {e}")))?;

    info!(addr = %bind_addr, "WebTransport (QUIC) listener started");

    let (tx, rx) = mpsc::channel::<WebTransportConnection>(64);
    let ep = endpoint.clone();

    tokio::spawn(async move {
        loop {
            match ep.accept().await {
                Some(incoming) => {
                    let tx = tx.clone();
                    tokio::spawn(async move {
                        match incoming.await {
                            Ok(conn) => {
                                let remote = conn.remote_address();
                                debug!(remote = %remote, "QUIC connection accepted");
                                let wt_conn = WebTransportConnection {
                                    connection: conn,
                                    remote_addr: remote,
                                };
                                if tx.send(wt_conn).await.is_err() {
                                    warn!("WebTransport connection channel closed");
                                }
                            }
                            Err(e) => {
                                warn!(error = %e, "QUIC handshake failed");
                            }
                        }
                    });
                }
                None => {
                    info!("QUIC endpoint closed, stopping listener");
                    break;
                }
            }
        }
    });

    Ok((endpoint, rx))
}

/// Accept a bidirectional stream from a QUIC connection (used as the control channel).
pub async fn accept_bidi_stream(
    conn: &quinn::Connection,
) -> WshResult<(quinn::SendStream, quinn::RecvStream)> {
    conn.accept_bi()
        .await
        .map_err(|e| WshError::Transport(format!("failed to accept bidi stream: {e}")))
}

/// Open a new bidirectional stream on a QUIC connection (for data channels).
pub async fn open_bidi_stream(
    conn: &quinn::Connection,
) -> WshResult<(quinn::SendStream, quinn::RecvStream)> {
    conn.open_bi()
        .await
        .map_err(|e| WshError::Transport(format!("failed to open bidi stream: {e}")))
}
