//! Core server: accepts connections and dispatches to the handshake flow.
//!
//! Owns the server secret (for token signing), session manager, relay subsystem,
//! and MCP bridge. Coordinates the lifecycle of all incoming connections.

use crate::config::ServerConfig;
use crate::handshake;
use crate::mcp::{McpBridge, McpProxy};
use crate::relay::{PeerRegistry, RelayBroker};
use crate::session::SessionManager;
use crate::transport::{websocket, webtransport};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};
use wsh_core::keys::{load_authorized_keys, AuthorizedKey};
use wsh_core::messages::*;
use wsh_core::{cbor_decode, frame_encode, WshError, WshResult};

/// The wsh server instance.
pub struct WshServer {
    /// Server configuration.
    config: ServerConfig,
    /// HMAC secret for session tokens.
    secret: Vec<u8>,
    /// Authorized keys loaded from disk.
    authorized_keys: Vec<AuthorizedKey>,
    /// Session manager.
    sessions: Arc<SessionManager>,
    /// Peer registry for reverse connections.
    peer_registry: Arc<PeerRegistry>,
    /// Relay broker.
    relay_broker: Arc<RelayBroker>,
    /// MCP CLI tool bridge.
    mcp_bridge: Arc<RwLock<McpBridge>>,
    /// MCP proxy to local servers.
    mcp_proxy: Arc<RwLock<McpProxy>>,
    /// Directory for session recordings.
    recording_dir: Option<PathBuf>,
}

impl WshServer {
    /// Create a new server instance.
    pub fn new(config: ServerConfig) -> WshResult<Self> {
        // Generate server secret
        let secret = wsh_core::generate_secret();

        // Load authorized keys
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        let authorized_keys = load_authorized_keys(&home).unwrap_or_else(|e| {
            warn!(error = %e, "failed to load authorized_keys, no pubkey auth available");
            Vec::new()
        });

        if authorized_keys.is_empty() {
            warn!("no authorized keys loaded — pubkey authentication will fail");
        } else {
            info!(count = authorized_keys.len(), "loaded authorized keys");
        }

        // Session manager
        let sessions = Arc::new(SessionManager::new(
            config.max_sessions,
            config.session_ttl,
            config.idle_timeout,
        ));

        // Relay
        let peer_registry = Arc::new(PeerRegistry::new());
        let relay_broker = Arc::new(RelayBroker::new(peer_registry.clone()));

        // MCP
        let mcp_bridge = Arc::new(RwLock::new(McpBridge::new()));
        let mcp_proxy = Arc::new(RwLock::new(McpProxy::new()));

        // Recording directory
        let recording_dir = dirs::home_dir().map(|h| h.join(".wsh").join("recordings"));
        if let Some(ref dir) = recording_dir {
            if let Err(e) = std::fs::create_dir_all(dir) {
                warn!(path = %dir.display(), error = %e, "could not create recordings dir");
            }
        }

        Ok(Self {
            config,
            secret,
            authorized_keys,
            sessions,
            peer_registry,
            relay_broker,
            mcp_bridge,
            mcp_proxy,
            recording_dir,
        })
    }

    /// Start listening on both WebTransport and WebSocket.
    pub async fn run(self, tls_config: Arc<rustls::ServerConfig>) -> WshResult<()> {
        let server = Arc::new(self);

        let quic_addr: SocketAddr = format!("0.0.0.0:{}", server.config.port)
            .parse()
            .map_err(|e| WshError::Other(format!("invalid address: {e}")))?;

        let ws_port = server.config.port + 1;
        let ws_addr: SocketAddr = format!("0.0.0.0:{ws_port}")
            .parse()
            .map_err(|e| WshError::Other(format!("invalid address: {e}")))?;

        // Start WebTransport listener
        let (_endpoint, mut wt_rx) =
            webtransport::start_listener(quic_addr, tls_config).await?;

        // Start WebSocket listener
        let mut ws_rx = websocket::start_listener(ws_addr).await?;

        // Start session GC task
        let gc_sessions = server.sessions.clone();
        let gc_registry = server.peer_registry.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;
                gc_sessions.gc().await;
                gc_registry.gc(3600).await;
            }
        });

        info!(
            quic_port = server.config.port,
            ws_port,
            relay = server.config.enable_relay,
            "wsh-server ready"
        );

        // Accept connections from both transports
        loop {
            tokio::select! {
                Some(wt_conn) = wt_rx.recv() => {
                    let srv = server.clone();
                    tokio::spawn(async move {
                        if let Err(e) = srv.handle_webtransport(wt_conn).await {
                            warn!(error = %e, "WebTransport connection error");
                        }
                    });
                }
                Some(ws_conn) = ws_rx.recv() => {
                    let srv = server.clone();
                    tokio::spawn(async move {
                        if let Err(e) = srv.handle_websocket(ws_conn).await {
                            warn!(error = %e, "WebSocket connection error");
                        }
                    });
                }
                else => {
                    info!("all listeners closed, shutting down");
                    break;
                }
            }
        }

        Ok(())
    }

    /// Handle a WebTransport (QUIC) connection through the auth handshake.
    async fn handle_webtransport(
        &self,
        conn: webtransport::WebTransportConnection,
    ) -> WshResult<()> {
        let remote = conn.remote_addr;
        info!(remote = %remote, "handling WebTransport connection");

        // Accept the first bidi stream as control channel
        let (mut send, mut recv) = webtransport::accept_bidi_stream(&conn.connection).await?;

        // Read HELLO
        let hello_bytes = read_quic_frame(&mut recv).await?;
        let envelope: Envelope = cbor_decode(&hello_bytes)?;

        let hello = match (&envelope.msg_type, &envelope.payload) {
            (MsgType::Hello, Payload::Hello(h)) => h.clone(),
            _ => {
                return Err(WshError::InvalidMessage(
                    "expected HELLO as first message".into(),
                ));
            }
        };

        // Send SERVER_HELLO + CHALLENGE
        let server_fingerprints: Vec<String> = self
            .authorized_keys
            .iter()
            .map(|k| k.fingerprint.clone())
            .collect();
        let hello_result = handshake::handle_hello(&hello, &server_fingerprints)?;

        let sh_frame = frame_encode(&hello_result.server_hello)?;
        send.write_all(&sh_frame)
            .await
            .map_err(|e| WshError::Transport(format!("QUIC write failed: {e}")))?;

        let challenge_frame = frame_encode(&hello_result.challenge)?;
        send.write_all(&challenge_frame)
            .await
            .map_err(|e| WshError::Transport(format!("QUIC write failed: {e}")))?;

        // Read AUTH
        let auth_bytes = read_quic_frame(&mut recv).await?;
        let auth_envelope: Envelope = cbor_decode(&auth_bytes)?;

        let auth = match (&auth_envelope.msg_type, &auth_envelope.payload) {
            (MsgType::Auth, Payload::Auth(a)) => a.clone(),
            _ => {
                let fail = handshake::build_auth_fail("expected AUTH message");
                let fail_frame = frame_encode(&fail)?;
                let _ = send.write_all(&fail_frame).await;
                return Err(WshError::InvalidMessage("expected AUTH message".into()));
            }
        };

        // Verify
        match handshake::verify_auth(
            &auth,
            &hello_result.nonce,
            &hello_result.session_id,
            &self.authorized_keys,
            &self.secret,
            self.config.session_ttl,
            self.config.allow_pubkey,
            self.config.allow_password,
        ) {
            Ok(mut result) => {
                result.username = hello.username.clone();
                let ok = handshake::build_auth_ok(
                    &result.session_id,
                    &result.token,
                    self.config.session_ttl,
                );
                let ok_frame = frame_encode(&ok)?;
                send.write_all(&ok_frame)
                    .await
                    .map_err(|e| WshError::Transport(format!("QUIC write failed: {e}")))?;

                info!(
                    remote = %remote,
                    username = %result.username,
                    session_id = %result.session_id,
                    "WebTransport auth OK"
                );

                // TODO: enter session message loop (OPEN, RESIZE, DATA, etc.)
            }
            Err(e) => {
                let fail = handshake::build_auth_fail(&e.to_string());
                let fail_frame = frame_encode(&fail)?;
                let _ = send.write_all(&fail_frame).await;
                return Err(e);
            }
        }

        Ok(())
    }

    /// Handle a WebSocket connection through the auth handshake.
    async fn handle_websocket(
        &self,
        mut conn: websocket::WebSocketConnection,
    ) -> WshResult<()> {
        let remote = conn.remote_addr;
        info!(remote = %remote, "handling WebSocket connection");

        // Read HELLO
        let hello_bytes = websocket::ws_recv_binary(&mut conn.ws_stream)
            .await?
            .ok_or_else(|| WshError::Transport("connection closed before HELLO".into()))?;
        let envelope: Envelope = cbor_decode(&hello_bytes)?;

        let hello = match (&envelope.msg_type, &envelope.payload) {
            (MsgType::Hello, Payload::Hello(h)) => h.clone(),
            _ => {
                return Err(WshError::InvalidMessage(
                    "expected HELLO as first message".into(),
                ));
            }
        };

        // Send SERVER_HELLO + CHALLENGE
        let server_fingerprints: Vec<String> = self
            .authorized_keys
            .iter()
            .map(|k| k.fingerprint.clone())
            .collect();
        let hello_result = handshake::handle_hello(&hello, &server_fingerprints)?;

        let sh_frame = frame_encode(&hello_result.server_hello)?;
        websocket::ws_send_binary(&mut conn.ws_stream, &sh_frame).await?;

        let challenge_frame = frame_encode(&hello_result.challenge)?;
        websocket::ws_send_binary(&mut conn.ws_stream, &challenge_frame).await?;

        // Read AUTH
        let auth_bytes = websocket::ws_recv_binary(&mut conn.ws_stream)
            .await?
            .ok_or_else(|| WshError::Transport("connection closed before AUTH".into()))?;
        let auth_envelope: Envelope = cbor_decode(&auth_bytes)?;

        let auth = match (&auth_envelope.msg_type, &auth_envelope.payload) {
            (MsgType::Auth, Payload::Auth(a)) => a.clone(),
            _ => {
                let fail = handshake::build_auth_fail("expected AUTH message");
                let fail_frame = frame_encode(&fail)?;
                let _ = websocket::ws_send_binary(&mut conn.ws_stream, &fail_frame).await;
                return Err(WshError::InvalidMessage("expected AUTH message".into()));
            }
        };

        // Verify
        match handshake::verify_auth(
            &auth,
            &hello_result.nonce,
            &hello_result.session_id,
            &self.authorized_keys,
            &self.secret,
            self.config.session_ttl,
            self.config.allow_pubkey,
            self.config.allow_password,
        ) {
            Ok(mut result) => {
                result.username = hello.username.clone();
                let ok = handshake::build_auth_ok(
                    &result.session_id,
                    &result.token,
                    self.config.session_ttl,
                );
                let ok_frame = frame_encode(&ok)?;
                websocket::ws_send_binary(&mut conn.ws_stream, &ok_frame).await?;

                info!(
                    remote = %remote,
                    username = %result.username,
                    session_id = %result.session_id,
                    "WebSocket auth OK"
                );

                // TODO: enter session message loop (OPEN, RESIZE, DATA, etc.)
            }
            Err(e) => {
                let fail = handshake::build_auth_fail(&e.to_string());
                let fail_frame = frame_encode(&fail)?;
                let _ = websocket::ws_send_binary(&mut conn.ws_stream, &fail_frame).await;
                return Err(e);
            }
        }

        Ok(())
    }

    /// Access the session manager.
    pub fn sessions(&self) -> &SessionManager {
        &self.sessions
    }

    /// Access the MCP bridge.
    pub fn mcp_bridge(&self) -> &Arc<RwLock<McpBridge>> {
        &self.mcp_bridge
    }

    /// Access the MCP proxy.
    pub fn mcp_proxy(&self) -> &Arc<RwLock<McpProxy>> {
        &self.mcp_proxy
    }

    /// Access the relay broker.
    pub fn relay_broker(&self) -> &RelayBroker {
        &self.relay_broker
    }
}

/// Read a length-prefixed frame from a QUIC recv stream.
async fn read_quic_frame(recv: &mut quinn::RecvStream) -> WshResult<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    recv.read_exact(&mut len_buf)
        .await
        .map_err(|e| WshError::Transport(format!("QUIC read len failed: {e}")))?;
    let len = u32::from_be_bytes(len_buf) as usize;

    if len > 1_048_576 {
        return Err(WshError::InvalidMessage(format!(
            "frame too large: {len} bytes"
        )));
    }

    let mut buf = vec![0u8; len];
    recv.read_exact(&mut buf)
        .await
        .map_err(|e| WshError::Transport(format!("QUIC read payload failed: {e}")))?;

    Ok(buf)
}
