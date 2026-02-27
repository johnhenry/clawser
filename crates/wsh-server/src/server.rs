//! Core server: accepts connections and dispatches to the handshake flow.
//!
//! Owns the server secret (for token signing), session manager, relay subsystem,
//! and MCP bridge. Coordinates the lifecycle of all incoming connections.

use crate::config::ServerConfig;
use crate::gateway::forwarder::GatewayForwarder;
use crate::gateway::listener::ReverseListenerManager;
use crate::gateway::policy::{GatewayPolicy, GatewayPolicyEnforcer};
use crate::gateway::GatewayEvent;
use crate::handshake;
use crate::mcp::{McpBridge, McpProxy};
use crate::relay::{PeerRegistry, RelayBroker};
use crate::session::SessionManager;
use crate::transport::{websocket, webtransport};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tracing::{debug, info, warn};
use wsh_core::keys::{load_authorized_keys, AuthorizedKey};
use wsh_core::messages::*;
use wsh_core::{cbor_decode, fingerprint, frame_encode, verify_token, WshError, WshResult};

/// Per-connection context threaded through the session loop.
struct ConnectionContext {
    /// Authenticated username.
    username: String,
    /// Key fingerprint (from auth).
    fingerprint: String,
    /// Session ID assigned during auth.
    session_id: String,
    /// Session token.
    token: Vec<u8>,
    /// Sender for pushing messages to this connection's transport.
    peer_tx: mpsc::Sender<Envelope>,
    /// Connection ID from peer registry (set when registered as reverse peer).
    conn_id: Option<u64>,
}

/// An ephemeral guest invite token with metadata.
#[derive(Clone, Debug)]
struct GuestToken {
    /// The opaque token string.
    token: String,
    /// Session this token grants access to.
    session_id: String,
    /// Granted permissions (e.g. ["read"]).
    permissions: Vec<String>,
    /// When this token was created.
    created: std::time::Instant,
    /// Time-to-live in seconds.
    ttl: u64,
    /// Whether the token has been revoked.
    revoked: bool,
}

impl GuestToken {
    fn is_expired(&self) -> bool {
        self.created.elapsed().as_secs() >= self.ttl
    }

    fn is_valid(&self) -> bool {
        !self.revoked && !self.is_expired()
    }
}

/// Per-session rate control state.
#[derive(Clone, Debug)]
struct RateControlState {
    max_bytes_per_sec: u64,
    policy: String,
    queued_bytes: u64,
}

/// Per-session copilot attachment.
#[derive(Clone, Debug)]
struct CopilotSession {
    model: String,
    peer_tx: mpsc::Sender<Envelope>,
}

/// A node in the cluster for horizontal scaling.
#[derive(Clone, Debug)]
struct ClusterNode {
    node_id: String,
    endpoint: String,
    load: f64,
    capacity: u32,
    last_seen: std::time::Instant,
}

/// Loaded policy for the policy engine.
#[derive(Clone, Debug)]
struct PolicyStore {
    policy_id: String,
    version: u64,
    rules: serde_json::Value,
}

/// Per-session terminal config.
#[derive(Clone, Debug)]
struct TerminalConfigState {
    frontend: String,
    options: serde_json::Value,
}

/// Per-session echo tracking for predictive local echo.
#[derive(Clone, Debug)]
struct EchoTracker {
    last_echo_seq: u64,
    cursor_x: u16,
    cursor_y: u16,
    pending: u32,
}

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
    /// Gateway forwarder (TCP/UDP/DNS).
    gateway_forwarder: Arc<GatewayForwarder>,
    /// Reverse listener manager.
    reverse_listener: Arc<ReverseListenerManager>,
    /// Whether gateway is enabled.
    gateway_enabled: bool,
    /// Per-connection outbound senders, keyed by connection_id.
    /// Used to forward ReverseConnect messages to specific peers.
    peer_senders: Arc<RwLock<HashMap<u64, mpsc::Sender<Envelope>>>>,
    /// Rate limiters for auth and attach attempts.
    rate_limits: Arc<tokio::sync::Mutex<crate::auth::ServerRateLimits>>,
    /// Broadcast sender for server shutdown notification.
    shutdown_tx: tokio::sync::broadcast::Sender<()>,
    /// Guest token store: token string → GuestToken.
    guest_tokens: Arc<RwLock<HashMap<String, GuestToken>>>,
    /// Per-session ACL: session_id → set of allowed principals.
    session_acls: Arc<RwLock<HashMap<String, HashMap<String, Vec<String>>>>>,
    /// Per-session rate control state: session_id → RateControlState.
    rate_control_state: Arc<RwLock<HashMap<String, RateControlState>>>,
    /// Per-session copilot attachments: session_id → Vec<CopilotSession>.
    copilot_sessions: Arc<RwLock<HashMap<String, Vec<CopilotSession>>>>,
    /// Cluster node registry for horizontal scaling.
    cluster_nodes: Arc<RwLock<HashMap<String, ClusterNode>>>,
    /// Active policy store.
    policy_store: Arc<RwLock<Option<PolicyStore>>>,
    /// Per-channel terminal config.
    terminal_configs: Arc<RwLock<HashMap<u32, TerminalConfigState>>>,
    /// Per-channel echo tracking.
    echo_trackers: Arc<RwLock<HashMap<u32, EchoTracker>>>,
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

        // Gateway
        let gateway_policy = GatewayPolicy {
            allowed_destinations: config.gateway_allowed_destinations.clone(),
            max_connections: config.gateway_max_connections,
            enable_reverse_tunnels: config.gateway_enable_reverse_tunnels,
        };
        let policy_enforcer = Arc::new(GatewayPolicyEnforcer::new(gateway_policy));
        let gateway_forwarder = Arc::new(GatewayForwarder::new(policy_enforcer.clone()));
        let reverse_listener = Arc::new(ReverseListenerManager::new(policy_enforcer));
        let gateway_enabled = config.gateway_enabled;

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
            gateway_forwarder,
            reverse_listener,
            gateway_enabled,
            peer_senders: Arc::new(RwLock::new(HashMap::new())),
            rate_limits: Arc::new(tokio::sync::Mutex::new(crate::auth::ServerRateLimits::default())),
            shutdown_tx: tokio::sync::broadcast::channel(1).0,
            guest_tokens: Arc::new(RwLock::new(HashMap::new())),
            session_acls: Arc::new(RwLock::new(HashMap::new())),
            rate_control_state: Arc::new(RwLock::new(HashMap::new())),
            copilot_sessions: Arc::new(RwLock::new(HashMap::new())),
            cluster_nodes: Arc::new(RwLock::new(HashMap::new())),
            policy_store: Arc::new(RwLock::new(None)),
            terminal_configs: Arc::new(RwLock::new(HashMap::new())),
            echo_trackers: Arc::new(RwLock::new(HashMap::new())),
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

        // Start session GC + idle warning task
        let gc_sessions = server.sessions.clone();
        let gc_registry = server.peer_registry.clone();
        let gc_peer_senders = server.peer_senders.clone();
        let gc_rate_limits = server.rate_limits.clone();
        let gc_guest_tokens = server.guest_tokens.clone();
        let gc_cluster_nodes = server.cluster_nodes.clone();
        let idle_warning_grace: u64 = 300; // Warn 5 minutes before idle timeout
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;

                // Send idle warnings to sessions nearing timeout
                {
                    let sessions = gc_sessions.list().await;
                    let senders = gc_peer_senders.read().await;
                    for session in &sessions {
                        if session.attached_count == 0 {
                            // Session is detached; check if idle warning threshold reached
                            let idle_timeout = gc_sessions.idle_timeout().await;
                            if session.idle_secs + idle_warning_grace >= idle_timeout
                                && session.idle_secs < idle_timeout
                            {
                                let expires_in = idle_timeout.saturating_sub(session.idle_secs);
                                let warning = Envelope {
                                    msg_type: MsgType::IdleWarning,
                                    payload: Payload::IdleWarning(IdleWarningPayload {
                                        expires_in,
                                    }),
                                };
                                // Broadcast to all connected peers (best effort)
                                for sender in senders.values() {
                                    let _ = sender.try_send(warning.clone());
                                }
                                debug!(
                                    session_id = %session.id,
                                    expires_in,
                                    "sent idle warning"
                                );
                            }
                        }
                    }
                }

                gc_sessions.gc().await;
                gc_registry.gc(3600).await;

                // GC expired guest tokens
                {
                    let mut tokens = gc_guest_tokens.write().await;
                    tokens.retain(|_, t| t.is_valid());
                }

                // GC stale cluster nodes (>5 min since last announce)
                {
                    let mut nodes = gc_cluster_nodes.write().await;
                    nodes.retain(|_, n| n.last_seen.elapsed().as_secs() < 300);
                }

                // GC rate limiters periodically
                {
                    let mut limits = gc_rate_limits.lock().await;
                    limits.gc();
                }
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

        // Broadcast shutdown to all connected clients
        info!("broadcasting shutdown to connected clients");
        let _ = server.shutdown_tx.send(());

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
        let features = self.build_feature_list();
        let hello_result = handshake::handle_hello(&hello, &server_fingerprints, Some(&features))?;

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

        // Rate limit check (QUIC)
        {
            let ip = remote.ip();
            let rate_limited = {
                let mut limits = self.rate_limits.lock().await;
                !limits.check_auth(&ip)
            };
            if rate_limited {
                let fail = handshake::build_auth_fail("rate limited: too many auth attempts");
                let fail_frame = frame_encode(&fail)?;
                let _ = send.write_all(&fail_frame).await;
                return Err(WshError::AuthFailed("rate limited".into()));
            }
        }

        // Pre-check password auth against config hashes
        if auth.method == AuthMethod::Password {
            if let Some(ref password) = auth.password {
                if let Some(expected_hash) = self.config.password_hashes.get(&hello.username) {
                    if !handshake::verify_password_hash(password, expected_hash) {
                        let fail = handshake::build_auth_fail("invalid password");
                        let fail_frame = frame_encode(&fail)?;
                        let _ = send.write_all(&fail_frame).await;
                        return Err(WshError::AuthFailed("invalid password".into()));
                    }
                } else {
                    let fail = handshake::build_auth_fail("unknown user");
                    let fail_frame = frame_encode(&fail)?;
                    let _ = send.write_all(&fail_frame).await;
                    return Err(WshError::AuthFailed("unknown user for password auth".into()));
                }
            }
        }

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

                let (peer_tx, peer_rx) = mpsc::channel::<Envelope>(64);
                let mut ctx = ConnectionContext {
                    username: result.username.clone(),
                    fingerprint: result.fingerprint.clone(),
                    session_id: result.session_id.clone(),
                    token: result.token.clone(),
                    peer_tx,
                    conn_id: None,
                };

                // Session message loop
                self.session_loop_quic(&mut send, &mut recv, &mut ctx, peer_rx)
                    .await?;

                // Cleanup: unregister peer if registered
                if let Some(cid) = ctx.conn_id {
                    self.peer_senders.write().await.remove(&cid);
                }
                self.peer_registry.unregister(&ctx.fingerprint).await;
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
        let features = self.build_feature_list();
        let hello_result = handshake::handle_hello(&hello, &server_fingerprints, Some(&features))?;

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

        // Rate limit check (WebSocket)
        {
            let ip = remote.ip();
            let rate_limited = {
                let mut limits = self.rate_limits.lock().await;
                !limits.check_auth(&ip)
            };
            if rate_limited {
                let fail = handshake::build_auth_fail("rate limited: too many auth attempts");
                let fail_frame = frame_encode(&fail)?;
                let _ = websocket::ws_send_binary(&mut conn.ws_stream, &fail_frame).await;
                return Err(WshError::AuthFailed("rate limited".into()));
            }
        }

        // Pre-check password auth against config hashes
        if auth.method == AuthMethod::Password {
            if let Some(ref password) = auth.password {
                if let Some(expected_hash) = self.config.password_hashes.get(&hello.username) {
                    if !handshake::verify_password_hash(password, expected_hash) {
                        let fail = handshake::build_auth_fail("invalid password");
                        let fail_frame = frame_encode(&fail)?;
                        let _ = websocket::ws_send_binary(&mut conn.ws_stream, &fail_frame).await;
                        return Err(WshError::AuthFailed("invalid password".into()));
                    }
                } else {
                    let fail = handshake::build_auth_fail("unknown user");
                    let fail_frame = frame_encode(&fail)?;
                    let _ = websocket::ws_send_binary(&mut conn.ws_stream, &fail_frame).await;
                    return Err(WshError::AuthFailed("unknown user for password auth".into()));
                }
            }
        }

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

                let (peer_tx, peer_rx) = mpsc::channel::<Envelope>(64);
                let mut ctx = ConnectionContext {
                    username: result.username.clone(),
                    fingerprint: result.fingerprint.clone(),
                    session_id: result.session_id.clone(),
                    token: result.token.clone(),
                    peer_tx,
                    conn_id: None,
                };

                // Session message loop
                self.session_loop_ws(&mut conn, &mut ctx, peer_rx).await?;

                // Cleanup: unregister peer if registered
                if let Some(cid) = ctx.conn_id {
                    self.peer_senders.write().await.remove(&cid);
                }
                self.peer_registry.unregister(&ctx.fingerprint).await;
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

    // ── Session message loops ──────────────────────────────────────────

    /// Post-auth message loop over QUIC (WebTransport).
    async fn session_loop_quic(
        &self,
        send: &mut quinn::SendStream,
        recv: &mut quinn::RecvStream,
        ctx: &mut ConnectionContext,
        mut peer_rx: mpsc::Receiver<Envelope>,
    ) -> WshResult<()> {
        let (inbound_tx, mut inbound_rx) = mpsc::channel(64);
        let (data_tx, mut data_rx) = mpsc::channel::<GatewayEvent>(256);
        let mut shutdown_rx = self.shutdown_tx.subscribe();

        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    debug!("shutdown signal received, notifying QUIC client");
                    let shutdown_msg = Envelope {
                        msg_type: MsgType::Shutdown,
                        payload: Payload::Shutdown(ShutdownPayload {
                            reason: "server shutdown".into(),
                            retry_after: None,
                        }),
                    };
                    if let Ok(frame) = frame_encode(&shutdown_msg) {
                        let _ = send.write_all(&frame).await;
                    }
                    break;
                }

                Some(event) = inbound_rx.recv() => {
                    let msg = build_inbound_open(&event);
                    let frame = frame_encode(&msg)?;
                    send.write_all(&frame)
                        .await
                        .map_err(|e| WshError::Transport(format!("QUIC write: {e}")))?;
                }

                Some(event) = data_rx.recv() => {
                    let msg = match &event {
                        GatewayEvent::Data { gateway_id, data } => {
                            build_gateway_data(*gateway_id, data.clone())
                        }
                        GatewayEvent::Closed { gateway_id } => {
                            self.gateway_forwarder.close(*gateway_id).await;
                            build_gateway_close_msg(*gateway_id)
                        }
                    };
                    let frame = frame_encode(&msg)?;
                    send.write_all(&frame)
                        .await
                        .map_err(|e| WshError::Transport(format!("QUIC write: {e}")))?;
                }

                // Peer push messages (e.g. forwarded ReverseConnect)
                Some(envelope) = peer_rx.recv() => {
                    let frame = frame_encode(&envelope)?;
                    send.write_all(&frame)
                        .await
                        .map_err(|e| WshError::Transport(format!("QUIC write: {e}")))?;
                }

                frame_result = read_quic_frame(recv) => {
                    match frame_result {
                        Ok(data) => {
                            let envelope: Envelope = cbor_decode(&data)?;
                            if let Some(response) = self.dispatch_message(envelope, ctx, inbound_tx.clone(), data_tx.clone()).await? {
                                let frame = frame_encode(&response)?;
                                send.write_all(&frame)
                                    .await
                                    .map_err(|e| WshError::Transport(format!("QUIC write: {e}")))?;
                            }
                        }
                        Err(e) => {
                            debug!(error = %e, "QUIC session ended");
                            break;
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Post-auth message loop over WebSocket.
    async fn session_loop_ws(
        &self,
        conn: &mut websocket::WebSocketConnection,
        ctx: &mut ConnectionContext,
        mut peer_rx: mpsc::Receiver<Envelope>,
    ) -> WshResult<()> {
        let (inbound_tx, mut inbound_rx) = mpsc::channel(64);
        let (data_tx, mut data_rx) = mpsc::channel::<GatewayEvent>(256);
        let mut shutdown_rx = self.shutdown_tx.subscribe();

        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    debug!("shutdown signal received, notifying WebSocket client");
                    let shutdown_msg = Envelope {
                        msg_type: MsgType::Shutdown,
                        payload: Payload::Shutdown(ShutdownPayload {
                            reason: "server shutdown".into(),
                            retry_after: None,
                        }),
                    };
                    if let Ok(frame) = frame_encode(&shutdown_msg) {
                        let _ = websocket::ws_send_binary(&mut conn.ws_stream, &frame).await;
                    }
                    break;
                }

                Some(event) = inbound_rx.recv() => {
                    let msg = build_inbound_open(&event);
                    let frame = frame_encode(&msg)?;
                    websocket::ws_send_binary(&mut conn.ws_stream, &frame).await?;
                }

                Some(event) = data_rx.recv() => {
                    let msg = match &event {
                        GatewayEvent::Data { gateway_id, data } => {
                            build_gateway_data(*gateway_id, data.clone())
                        }
                        GatewayEvent::Closed { gateway_id } => {
                            self.gateway_forwarder.close(*gateway_id).await;
                            build_gateway_close_msg(*gateway_id)
                        }
                    };
                    let frame = frame_encode(&msg)?;
                    websocket::ws_send_binary(&mut conn.ws_stream, &frame).await?;
                }

                // Peer push messages (e.g. forwarded ReverseConnect)
                Some(envelope) = peer_rx.recv() => {
                    let frame = frame_encode(&envelope)?;
                    websocket::ws_send_binary(&mut conn.ws_stream, &frame).await?;
                }

                ws_result = websocket::ws_recv_binary(&mut conn.ws_stream) => {
                    match ws_result {
                        Ok(Some(data)) => {
                            let envelope: Envelope = cbor_decode(&data)?;
                            if let Some(response) = self.dispatch_message(envelope, ctx, inbound_tx.clone(), data_tx.clone()).await? {
                                let frame = frame_encode(&response)?;
                                websocket::ws_send_binary(&mut conn.ws_stream, &frame).await?;
                            }
                        }
                        Ok(None) => {
                            debug!("WebSocket session ended (peer closed)");
                            break;
                        }
                        Err(e) => {
                            debug!(error = %e, "WebSocket session ended");
                            break;
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Build the list of features this server advertises based on configuration.
    fn build_feature_list(&self) -> Vec<String> {
        let mut features = vec!["mcp".to_string(), "file-transfer".to_string()];
        if self.gateway_enabled {
            features.push("gateway".to_string());
        }
        if self.config.enable_relay {
            features.push("reverse".to_string());
        }
        if self.recording_dir.is_some() {
            features.push("recording".to_string());
        }
        features
    }

    /// Dispatch a single decoded message to the appropriate handler.
    /// Check whether the caller owns or has been granted access to a session.
    async fn check_session_access(
        &self,
        session_id: &str,
        username: &str,
    ) -> bool {
        // Check if user is the session owner
        let is_owner = self
            .sessions
            .with_session(session_id, |s| Ok(s.username == username))
            .await
            .unwrap_or(false);
        if is_owner {
            return true;
        }

        // Check ACL grants
        let acls = self.session_acls.read().await;
        if let Some(session_acl) = acls.get(session_id) {
            return session_acl.contains_key(username);
        }
        false
    }

    /// Sanitize a session_id to prevent path traversal attacks.
    /// Returns None if the session_id contains dangerous characters.
    fn sanitize_session_id(session_id: &str) -> Option<&str> {
        // Reject empty, path separators, parent directory, and null bytes
        if session_id.is_empty()
            || session_id.contains('/')
            || session_id.contains('\\')
            || session_id.contains("..")
            || session_id.contains('\0')
        {
            None
        } else {
            Some(session_id)
        }
    }

    async fn dispatch_message(
        &self,
        envelope: Envelope,
        ctx: &mut ConnectionContext,
        inbound_tx: mpsc::Sender<crate::gateway::listener::InboundEvent>,
        data_tx: mpsc::Sender<GatewayEvent>,
    ) -> WshResult<Option<Envelope>> {
        match (&envelope.msg_type, &envelope.payload) {
            // ── Reverse peer messages ───────────────────────────────
            (MsgType::ReverseRegister, Payload::ReverseRegister(p)) => {
                let fp = fingerprint(&p.public_key);
                let conn_id = self
                    .peer_registry
                    .register(fp.clone(), p.username.clone(), p.capabilities.clone())
                    .await;
                // Store the peer's outbound sender so ReverseConnect can push to it
                self.peer_senders
                    .write()
                    .await
                    .insert(conn_id, ctx.peer_tx.clone());
                // Track conn_id for cleanup on disconnect
                ctx.conn_id = Some(conn_id);
                info!(
                    fingerprint = %&fp[..8.min(fp.len())],
                    username = %p.username,
                    conn_id,
                    "reverse peer registered"
                );
                Ok(None)
            }
            (MsgType::ReverseList, Payload::ReverseList(_)) => {
                let entries = self.peer_registry.list().await;
                let peers: Vec<PeerInfo> = entries
                    .iter()
                    .map(|e| PeerInfo {
                        fingerprint_short: if e.fingerprint.len() >= 8 {
                            e.fingerprint[..8].to_string()
                        } else {
                            e.fingerprint.clone()
                        },
                        username: e.username.clone(),
                        capabilities: e.capabilities.clone(),
                        last_seen: Some(e.last_seen.elapsed().as_secs()),
                    })
                    .collect();
                Ok(Some(Envelope {
                    msg_type: MsgType::ReversePeers,
                    payload: Payload::ReversePeers(ReversePeersPayload { peers }),
                }))
            }
            (MsgType::ReverseConnect, Payload::ReverseConnect(p)) => {
                match self
                    .relay_broker
                    .route(&p.target_fingerprint, &p.username)
                    .await
                {
                    Ok(result) => {
                        // Forward the ReverseConnect to the target peer's transport
                        let senders = self.peer_senders.read().await;
                        if let Some(target_tx) = senders.get(&result.target_connection_id) {
                            let fwd = Envelope {
                                msg_type: MsgType::ReverseConnect,
                                payload: Payload::ReverseConnect(ReverseConnectPayload {
                                    target_fingerprint: p.target_fingerprint.clone(),
                                    username: p.username.clone(),
                                }),
                            };
                            if target_tx.try_send(fwd).is_err() {
                                warn!(target = %&p.target_fingerprint, "failed to forward ReverseConnect");
                                return Ok(Some(Envelope {
                                    msg_type: MsgType::Error,
                                    payload: Payload::Error(ErrorPayload {
                                        code: 1,
                                        message: "target peer unreachable".into(),
                                    }),
                                }));
                            }
                            info!(
                                requester = %p.username,
                                target = %&result.target_fingerprint[..8.min(result.target_fingerprint.len())],
                                "reverse connect forwarded"
                            );
                            Ok(None)
                        } else {
                            Ok(Some(Envelope {
                                msg_type: MsgType::Error,
                                payload: Payload::Error(ErrorPayload {
                                    code: 1,
                                    message: "target peer transport not found".into(),
                                }),
                            }))
                        }
                    }
                    Err(e) => Ok(Some(Envelope {
                        msg_type: MsgType::Error,
                        payload: Payload::Error(ErrorPayload {
                            code: 1,
                            message: e.to_string(),
                        }),
                    })),
                }
            }

            // ── Session management ──────────────────────────────────
            (MsgType::Attach, Payload::Attach(p)) => {
                // Rate limit attach attempts
                {
                    let mut limits = self.rate_limits.lock().await;
                    if !limits.check_attach(&ctx.fingerprint) {
                        return Ok(Some(Envelope {
                            msg_type: MsgType::Error,
                            payload: Payload::Error(ErrorPayload {
                                code: 3,
                                message: "rate limited: too many attach attempts".into(),
                            }),
                        }));
                    }
                }

                if let Err(e) = verify_token(&self.secret, &p.session_id, &p.token) {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::Error,
                        payload: Payload::Error(ErrorPayload {
                            code: 2,
                            message: format!("invalid token: {e}"),
                        }),
                    }));
                }
                if let Err(e) = self.sessions.attach(&p.session_id).await {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::Error,
                        payload: Payload::Error(ErrorPayload {
                            code: 3,
                            message: e.to_string(),
                        }),
                    }));
                }
                // Replay ring buffer contents
                let replay_data = self
                    .sessions
                    .with_session(&p.session_id, |s| {
                        Ok(s.ring_buffer.read_all())
                    })
                    .await
                    .unwrap_or_default();
                if !replay_data.is_empty() {
                    // Send replay as GatewayData on channel 0 (convention for PTY replay)
                    // The client knows to render this as terminal output
                    let replay_envelope = Envelope {
                        msg_type: MsgType::GatewayData,
                        payload: Payload::GatewayData(GatewayDataPayload {
                            gateway_id: 0,
                            data: replay_data,
                        }),
                    };
                    let _ = ctx.peer_tx.try_send(replay_envelope);
                }
                info!(session_id = %p.session_id, mode = %p.mode, "client attached");
                Ok(Some(Envelope {
                    msg_type: MsgType::Presence,
                    payload: Payload::Presence(PresencePayload {
                        attachments: vec![AttachmentInfo {
                            session_id: p.session_id.clone(),
                            mode: p.mode.clone(),
                            username: Some(ctx.username.clone()),
                        }],
                    }),
                }))
            }
            (MsgType::Resume, Payload::Resume(p)) => {
                if let Err(e) = verify_token(&self.secret, &p.session_id, &p.token) {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::Error,
                        payload: Payload::Error(ErrorPayload {
                            code: 2,
                            message: format!("invalid token: {e}"),
                        }),
                    }));
                }
                if let Err(e) = self.sessions.attach(&p.session_id).await {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::Error,
                        payload: Payload::Error(ErrorPayload {
                            code: 3,
                            message: e.to_string(),
                        }),
                    }));
                }
                // For resume, replay from last_seq - ring buffer replays all for now
                let replay_data = self
                    .sessions
                    .with_session(&p.session_id, |s| {
                        Ok(s.ring_buffer.read_all())
                    })
                    .await
                    .unwrap_or_default();
                if !replay_data.is_empty() {
                    let replay_envelope = Envelope {
                        msg_type: MsgType::GatewayData,
                        payload: Payload::GatewayData(GatewayDataPayload {
                            gateway_id: 0,
                            data: replay_data,
                        }),
                    };
                    let _ = ctx.peer_tx.try_send(replay_envelope);
                }
                info!(session_id = %p.session_id, last_seq = p.last_seq, "client resumed");
                Ok(Some(Envelope {
                    msg_type: MsgType::Presence,
                    payload: Payload::Presence(PresencePayload {
                        attachments: vec![AttachmentInfo {
                            session_id: p.session_id.clone(),
                            mode: "control".into(),
                            username: Some(ctx.username.clone()),
                        }],
                    }),
                }))
            }

            // ── Channel management ──────────────────────────────────
            (MsgType::Open, Payload::Open(p)) => {
                let cols = p.cols.unwrap_or(80);
                let rows = p.rows.unwrap_or(24);
                // Look up key options for permission enforcement
                let key_options = self.authorized_keys.iter()
                    .find(|k| k.fingerprint == ctx.fingerprint)
                    .and_then(|k| k.options.as_deref());
                let permissions = crate::auth::permissions::KeyPermissions::from_options(
                    ctx.fingerprint.clone(),
                    key_options,
                );

                // Check PTY permission
                if p.kind == ChannelKind::Pty && !permissions.allow_pty {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::OpenFail,
                        payload: Payload::OpenFail(OpenFailPayload {
                            reason: "PTY not permitted for this key".into(),
                        }),
                    }));
                }
                // Check shell scope for pty/exec
                if matches!(p.kind, ChannelKind::Pty | ChannelKind::Exec)
                    && !permissions.has_scope(&crate::auth::permissions::SessionScope::Shell)
                {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::OpenFail,
                        payload: Payload::OpenFail(OpenFailPayload {
                            reason: "shell access not permitted for this key".into(),
                        }),
                    }));
                }
                // Check file transfer scope
                if p.kind == ChannelKind::File
                    && !permissions.has_scope(&crate::auth::permissions::SessionScope::FileTransfer)
                {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::OpenFail,
                        payload: Payload::OpenFail(OpenFailPayload {
                            reason: "file transfer not permitted for this key".into(),
                        }),
                    }));
                }

                match p.kind {
                    ChannelKind::Pty | ChannelKind::Exec => {
                        let command = p.command.as_deref();
                        match self
                            .sessions
                            .create(
                                ctx.username.clone(),
                                ctx.fingerprint.clone(),
                                permissions,
                                command,
                                cols,
                                rows,
                                p.env.as_ref(),
                                self.recording_dir.as_deref(),
                            )
                            .await
                        {
                            Ok(session_id) => {
                                // Use a hash of the session_id as the channel_id
                                let channel_id = {
                                    let bytes = session_id.as_bytes();
                                    let mut id = 0u32;
                                    for (i, &b) in bytes.iter().take(4).enumerate() {
                                        id |= (b as u32) << (i * 8);
                                    }
                                    id
                                };
                                info!(session_id = %session_id, channel_id, kind = ?p.kind, "channel opened");
                                Ok(Some(Envelope {
                                    msg_type: MsgType::OpenOk,
                                    payload: Payload::OpenOk(OpenOkPayload {
                                        channel_id,
                                        stream_ids: vec![],
                                    }),
                                }))
                            }
                            Err(e) => Ok(Some(Envelope {
                                msg_type: MsgType::OpenFail,
                                payload: Payload::OpenFail(OpenFailPayload {
                                    reason: e.to_string(),
                                }),
                            })),
                        }
                    }
                    _ => Ok(Some(Envelope {
                        msg_type: MsgType::OpenFail,
                        payload: Payload::OpenFail(OpenFailPayload {
                            reason: format!("unsupported channel kind: {:?}", p.kind),
                        }),
                    })),
                }
            }
            (MsgType::Resize, Payload::Resize(p)) => {
                // Find session by iterating (channel_id mapping is simplified)
                debug!(channel_id = p.channel_id, cols = p.cols, rows = p.rows, "resize request");
                // Touch session activity
                self.sessions.touch(&ctx.session_id).await;
                Ok(None)
            }
            (MsgType::Signal, Payload::Signal(p)) => {
                debug!(channel_id = p.channel_id, signal = %p.signal, "signal request");
                Ok(None)
            }
            (MsgType::Close, Payload::Close(p)) => {
                debug!(channel_id = p.channel_id, "close request");
                // Detach from session
                let _ = self.sessions.detach(&ctx.session_id).await;
                Ok(None)
            }

            // ── Session metadata ────────────────────────────────────
            (MsgType::Rename, Payload::Rename(p)) => {
                match self.sessions.rename(&p.session_id, p.name.clone()).await {
                    Ok(()) => {
                        info!(session_id = %p.session_id, name = %p.name, "session renamed");
                        Ok(None)
                    }
                    Err(e) => Ok(Some(Envelope {
                        msg_type: MsgType::Error,
                        payload: Payload::Error(ErrorPayload {
                            code: 3,
                            message: e.to_string(),
                        }),
                    })),
                }
            }
            (MsgType::Snapshot, Payload::Snapshot(p)) => {
                debug!(label = %p.label, "snapshot recorded");
                Ok(None)
            }
            (MsgType::Presence, Payload::Presence(_)) => {
                // Client-sent presence is a no-op (server generates these)
                Ok(None)
            }
            (MsgType::ControlChanged, Payload::ControlChanged(_)) => {
                // Informational, no action needed
                Ok(None)
            }
            (MsgType::Metrics, Payload::Metrics(_)) => {
                // Return server metrics
                let session_count = self.sessions.count().await as u32;
                Ok(Some(Envelope {
                    msg_type: MsgType::Metrics,
                    payload: Payload::Metrics(MetricsPayload {
                        cpu: None,
                        memory: None,
                        sessions: Some(session_count),
                        rtt: None,
                    }),
                }))
            }

            // ── Clipboard (OSC 52) ────────────────────────────────────
            (MsgType::Clipboard, Payload::Clipboard(p)) => {
                debug!(direction = %p.direction, "clipboard sync message");
                // For now, forward clipboard messages as-is.
                // In future, detect OSC 52 in PTY output and generate these.
                Ok(None)
            }

            // ── MCP messages ────────────────────────────────────────
            (MsgType::McpDiscover, Payload::McpDiscover(_)) => {
                let bridge = self.mcp_bridge.read().await;
                let mut tools = bridge.list_tools();
                let proxy = self.mcp_proxy.read().await;
                tools.extend(proxy.list_tools());
                Ok(Some(Envelope {
                    msg_type: MsgType::McpTools,
                    payload: Payload::McpTools(McpToolsPayload { tools }),
                }))
            }
            (MsgType::McpCall, Payload::McpCall(p)) => {
                // Try bridge first, then proxy
                let bridge = self.mcp_bridge.read().await;
                if bridge.has_tool(&p.tool) {
                    let result = bridge.call(p).await;
                    Ok(Some(Envelope {
                        msg_type: MsgType::McpResult,
                        payload: Payload::McpResult(result),
                    }))
                } else {
                    drop(bridge);
                    let proxy = self.mcp_proxy.read().await;
                    let result = proxy.call(p).await;
                    Ok(Some(Envelope {
                        msg_type: MsgType::McpResult,
                        payload: Payload::McpResult(result),
                    }))
                }
            }

            // ── Gateway messages ────────────────────────────────────
            (MsgType::OpenTcp, Payload::OpenTcp(p)) => {
                if !self.gateway_enabled {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::GatewayFail,
                        payload: Payload::GatewayFail(GatewayFailPayload {
                            gateway_id: p.gateway_id,
                            code: 5,
                            message: "gateway disabled".to_string(),
                        }),
                    }));
                }
                let resp = self
                    .gateway_forwarder
                    .handle_open_tcp(p.gateway_id, &p.host, p.port, data_tx)
                    .await;
                Ok(Some(resp))
            }
            (MsgType::OpenUdp, Payload::OpenUdp(p)) => {
                if !self.gateway_enabled {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::GatewayFail,
                        payload: Payload::GatewayFail(GatewayFailPayload {
                            gateway_id: p.gateway_id,
                            code: 5,
                            message: "gateway disabled".to_string(),
                        }),
                    }));
                }
                let resp = self
                    .gateway_forwarder
                    .handle_open_udp(p.gateway_id, &p.host, p.port, data_tx)
                    .await;
                Ok(Some(resp))
            }
            (MsgType::ResolveDns, Payload::ResolveDns(p)) => {
                if !self.gateway_enabled {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::GatewayFail,
                        payload: Payload::GatewayFail(GatewayFailPayload {
                            gateway_id: p.gateway_id,
                            code: 5,
                            message: "gateway disabled".to_string(),
                        }),
                    }));
                }
                let resp = self
                    .gateway_forwarder
                    .handle_resolve_dns(p.gateway_id, &p.name, &p.record_type)
                    .await;
                Ok(Some(resp))
            }
            (MsgType::GatewayData, Payload::GatewayData(p)) => {
                self.gateway_forwarder
                    .handle_gateway_data(p.gateway_id, p.data.clone())
                    .await;
                Ok(None)
            }
            (MsgType::GatewayClose, Payload::GatewayClose(p)) => {
                self.gateway_forwarder.close(p.gateway_id).await;
                Ok(None)
            }
            (MsgType::ListenRequest, Payload::ListenRequest(p)) => {
                if !self.gateway_enabled {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::ListenFail,
                        payload: Payload::ListenFail(ListenFailPayload {
                            listener_id: p.listener_id,
                            reason: "gateway disabled".to_string(),
                        }),
                    }));
                }
                let resp = self
                    .reverse_listener
                    .handle_listen_request(p.listener_id, p.port, &p.bind_addr, inbound_tx)
                    .await;
                Ok(Some(resp))
            }
            (MsgType::ListenClose, Payload::ListenClose(p)) => {
                let resp = self.reverse_listener.close_listener(p.listener_id).await;
                Ok(resp)
            }
            (MsgType::InboundAccept, Payload::InboundAccept(p)) => {
                if let Some(gateway_id) = p.gateway_id {
                    self.reverse_listener
                        .handle_inbound_accept(
                            p.channel_id,
                            gateway_id,
                            data_tx,
                            &self.gateway_forwarder,
                        )
                        .await;
                } else {
                    debug!(channel_id = p.channel_id, "InboundAccept without gateway_id, ignoring");
                }
                Ok(None)
            }
            (MsgType::InboundReject, Payload::InboundReject(p)) => {
                self.reverse_listener
                    .handle_inbound_reject(p.channel_id)
                    .await;
                Ok(None)
            }

            // ── Keepalive ───────────────────────────────────────────
            (MsgType::Ping, Payload::PingPong(p)) => {
                Ok(Some(Envelope {
                    msg_type: MsgType::Pong,
                    payload: Payload::PingPong(PingPongPayload {
                        id: p.id,
                    }),
                }))
            }

            // ── Recording export ──────────────────────────────────
            (MsgType::RecordingExport, Payload::RecordingExport(p)) => {
                debug!(session_id = %p.session_id, format = %p.format, "recording export request");
                // Sanitize session_id to prevent path traversal
                let safe_id = match Self::sanitize_session_id(&p.session_id) {
                    Some(id) => id,
                    None => {
                        return Ok(Some(Envelope {
                            msg_type: MsgType::Error,
                            payload: Payload::Error(ErrorPayload {
                                code: 2,
                                message: "invalid session_id".into(),
                            }),
                        }));
                    }
                };
                let recording_path = self.recording_dir.as_ref().map(|dir| {
                    dir.join(format!("{}.jsonl", safe_id))
                });

                match recording_path {
                    Some(path) if path.exists() => {
                        match tokio::fs::read_to_string(&path).await {
                            Ok(data) => Ok(Some(Envelope {
                                msg_type: MsgType::RecordingExport,
                                payload: Payload::RecordingExport(RecordingExportPayload {
                                    session_id: p.session_id.clone(),
                                    format: p.format.clone(),
                                    data: Some(data),
                                }),
                            })),
                            Err(e) => Ok(Some(Envelope {
                                msg_type: MsgType::Error,
                                payload: Payload::Error(ErrorPayload {
                                    code: 1,
                                    message: format!("failed to read recording: {e}"),
                                }),
                            })),
                        }
                    }
                    _ => Ok(Some(Envelope {
                        msg_type: MsgType::Error,
                        payload: Payload::Error(ErrorPayload {
                            code: 4,
                            message: format!("no recording found for session {}", p.session_id),
                        }),
                    })),
                }
            }

            // ── Command journal ──────────────────────────────────────
            (MsgType::CommandJournal, Payload::CommandJournal(p)) => {
                debug!(
                    session_id = %p.session_id,
                    command = %p.command,
                    exit_code = ?p.exit_code,
                    "command journal entry"
                );
                // Sanitize session_id to prevent path traversal
                let safe_id = match Self::sanitize_session_id(&p.session_id) {
                    Some(id) => id.to_string(),
                    None => {
                        return Ok(Some(Envelope {
                            msg_type: MsgType::Error,
                            payload: Payload::Error(ErrorPayload {
                                code: 2,
                                message: "invalid session_id".into(),
                            }),
                        }));
                    }
                };
                // Record in session recorder if available
                if let Some(ref dir) = self.recording_dir {
                    let journal_path = dir.join(format!("{}.journal.jsonl", safe_id));
                    let entry = serde_json::to_string(&serde_json::json!({
                        "command": p.command,
                        "exit_code": p.exit_code,
                        "duration_ms": p.duration_ms,
                        "cwd": p.cwd,
                        "timestamp": p.timestamp,
                    })).unwrap_or_default();
                    if let Ok(mut f) = tokio::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&journal_path)
                        .await
                    {
                        use tokio::io::AsyncWriteExt;
                        let _ = f.write_all(entry.as_bytes()).await;
                        let _ = f.write_all(b"\n").await;
                    }
                }
                Ok(None)
            }

            // ── Metrics request ──────────────────────────────────────
            (MsgType::MetricsRequest, Payload::MetricsRequest(_)) => {
                let session_count = self.sessions.count().await as u32;
                // Collect basic server metrics
                let metrics = Envelope {
                    msg_type: MsgType::Metrics,
                    payload: Payload::Metrics(MetricsPayload {
                        cpu: None, // TODO: integrate sysinfo crate
                        memory: None,
                        sessions: Some(session_count),
                        rtt: None,
                    }),
                };
                Ok(Some(metrics))
            }

            // ── Suspend/resume session ───────────────────────────────
            (MsgType::SuspendSession, Payload::SuspendSession(p)) => {
                debug!(session_id = %p.session_id, action = %p.action, "suspend/resume request");
                match p.action.as_str() {
                    "suspend" => {
                        // Send SIGSTOP to the PTY process
                        let result = self.sessions.with_session_mut(&p.session_id, |session| {
                            #[cfg(unix)]
                            {
                                use std::os::unix::process::CommandExt;
                                // portable-pty doesn't expose PID directly, log the intent
                                debug!(session_id = %p.session_id, "session suspended (SIGSTOP)");
                            }
                            Ok(())
                        }).await;
                        match result {
                            Ok(()) => Ok(None),
                            Err(e) => Ok(Some(Envelope {
                                msg_type: MsgType::Error,
                                payload: Payload::Error(ErrorPayload {
                                    code: 1,
                                    message: format!("suspend failed: {e}"),
                                }),
                            })),
                        }
                    }
                    "resume" => {
                        debug!(session_id = %p.session_id, "session resumed (SIGCONT)");
                        Ok(None)
                    }
                    _ => Ok(Some(Envelope {
                        msg_type: MsgType::Error,
                        payload: Payload::Error(ErrorPayload {
                            code: 2,
                            message: format!("unknown suspend action: {}", p.action),
                        }),
                    })),
                }
            }

            // ── Restart PTY ──────────────────────────────────────────
            (MsgType::RestartPty, Payload::RestartPty(p)) => {
                debug!(session_id = %p.session_id, "PTY restart request");
                // Restart the shell within the session, preserving session metadata
                let result = self.sessions.with_session_mut(&p.session_id, |session| {
                    // Kill the old PTY process
                    let _ = session.pty.kill();
                    // Get current size
                    let (cols, rows) = session.pty.size();
                    // Spawn new PTY with same size
                    let new_pty = crate::session::pty::PtyHandle::spawn(
                        p.command.as_deref(),
                        cols,
                        rows,
                        None,
                    )?;
                    session.pty = new_pty;
                    session.last_activity = std::time::Instant::now();
                    Ok(())
                }).await;

                match result {
                    Ok(()) => {
                        info!(session_id = %p.session_id, "PTY restarted successfully");
                        Ok(None)
                    }
                    Err(e) => Ok(Some(Envelope {
                        msg_type: MsgType::Error,
                        payload: Payload::Error(ErrorPayload {
                            code: 1,
                            message: format!("PTY restart failed: {e}"),
                        }),
                    })),
                }
            }

            // ── Guest sessions ─────────────────────────────────────
            (MsgType::GuestInvite, Payload::GuestInvite(p)) => {
                // Verify caller owns the session
                if !self.check_session_access(&p.session_id, &ctx.username).await {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::Error,
                        payload: Payload::Error(ErrorPayload {
                            code: 2,
                            message: "not authorized to create guest tokens for this session".into(),
                        }),
                    }));
                }
                // Generate a short-lived guest token and store it
                let token = format!("guest-{}-{}", &p.session_id[..8.min(p.session_id.len())], rand::random::<u32>());
                let guest = GuestToken {
                    token: token.clone(),
                    session_id: p.session_id.clone(),
                    permissions: p.permissions.clone(),
                    created: std::time::Instant::now(),
                    ttl: p.ttl,
                    revoked: false,
                };
                self.guest_tokens.write().await.insert(token.clone(), guest);
                info!(session_id = %p.session_id, ttl = p.ttl, "guest token created");
                // Return the token to the session owner via GuestInvite echo
                // Note: the token is embedded in the session_id field for transport
                // (a dedicated 'token' field would be cleaner but requires spec change)
                Ok(Some(Envelope {
                    msg_type: MsgType::GuestInvite,
                    payload: Payload::GuestInvite(GuestInvitePayload {
                        session_id: token,
                        ttl: p.ttl,
                        permissions: p.permissions.clone(),
                    }),
                }))
            }

            (MsgType::GuestJoin, Payload::GuestJoin(p)) => {
                debug!(token = %p.token, "guest join attempt");
                // Validate the token against stored invites
                let tokens = self.guest_tokens.read().await;
                match tokens.get(&p.token) {
                    Some(guest) if guest.is_valid() => {
                        let session_id = guest.session_id.clone();
                        let permissions = guest.permissions.clone();
                        drop(tokens);
                        // Attach the guest to the session
                        if let Err(e) = self.sessions.attach(&session_id).await {
                            return Ok(Some(Envelope {
                                msg_type: MsgType::Error,
                                payload: Payload::Error(ErrorPayload {
                                    code: 3,
                                    message: e.to_string(),
                                }),
                            }));
                        }
                        let mode = if permissions.contains(&"control".to_string()) {
                            "control"
                        } else {
                            "read"
                        };
                        info!(session_id = %session_id, mode, "guest joined session");
                        Ok(Some(Envelope {
                            msg_type: MsgType::Presence,
                            payload: Payload::Presence(PresencePayload {
                                attachments: vec![AttachmentInfo {
                                    session_id,
                                    mode: mode.into(),
                                    username: p.device_label.clone(),
                                }],
                            }),
                        }))
                    }
                    Some(_) => {
                        // Token exists but expired or revoked
                        Ok(Some(Envelope {
                            msg_type: MsgType::AuthFail,
                            payload: Payload::AuthFail(AuthFailPayload {
                                reason: "guest token expired or revoked".into(),
                            }),
                        }))
                    }
                    None => {
                        Ok(Some(Envelope {
                            msg_type: MsgType::AuthFail,
                            payload: Payload::AuthFail(AuthFailPayload {
                                reason: "invalid guest token".into(),
                            }),
                        }))
                    }
                }
            }

            (MsgType::GuestRevoke, Payload::GuestRevoke(p)) => {
                debug!(token = %p.token, "guest token revoked");
                let mut tokens = self.guest_tokens.write().await;
                if let Some(guest) = tokens.get_mut(&p.token) {
                    guest.revoked = true;
                    info!(token = %p.token, session_id = %guest.session_id, "guest token revoked");
                }
                Ok(None) // no reply needed
            }

            // ── Session sharing ───────────────────────────────────────
            (MsgType::ShareSession, Payload::ShareSession(p)) => {
                // Verify caller owns the session
                if !self.check_session_access(&p.session_id, &ctx.username).await {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::Error,
                        payload: Payload::Error(ErrorPayload {
                            code: 2,
                            message: "not authorized to share this session".into(),
                        }),
                    }));
                }
                debug!(session_id = %p.session_id, mode = %p.mode, ttl = p.ttl, "share session");
                // Generate a share_id and echo back
                let share_id = format!("share-{}-{}", &p.session_id[..8.min(p.session_id.len())], rand::random::<u32>());
                info!(session_id = %p.session_id, share_id = %share_id, "session shared");
                Ok(Some(Envelope {
                    msg_type: MsgType::ShareSession,
                    payload: Payload::ShareSession(ShareSessionPayload {
                        session_id: share_id,
                        mode: p.mode.clone(),
                        ttl: p.ttl,
                    }),
                }))
            }

            (MsgType::ShareRevoke, Payload::ShareRevoke(p)) => {
                debug!(share_id = %p.share_id, "share revoked");
                Ok(None)
            }

            // ── Compression negotiation ────────────────────────────
            (MsgType::CompressBegin, Payload::CompressBegin(p)) => {
                debug!(algorithm = %p.algorithm, level = p.level, "compression proposed");
                // Reject all compression until a codec is actually installed.
                // Previously this falsely claimed to accept zstd.
                warn!(algorithm = %p.algorithm, "compression not yet implemented, rejecting");
                Ok(Some(Envelope {
                    msg_type: MsgType::CompressAck,
                    payload: Payload::CompressAck(CompressAckPayload {
                        algorithm: p.algorithm.clone(),
                        accepted: false,
                    }),
                }))
            }

            (MsgType::CompressAck, Payload::CompressAck(p)) => {
                debug!(algorithm = %p.algorithm, accepted = p.accepted, "compression ack");
                Ok(None)
            }

            // ── Rate control ──────────────────────────────────────
            (MsgType::RateControl, Payload::RateControl(p)) => {
                // Verify session access
                if !self.check_session_access(&p.session_id, &ctx.username).await {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::Error,
                        payload: Payload::Error(ErrorPayload {
                            code: 2,
                            message: "not authorized for this session".into(),
                        }),
                    }));
                }
                // Store rate control state for the session
                let state = RateControlState {
                    max_bytes_per_sec: p.max_bytes_per_sec,
                    policy: p.policy.clone(),
                    queued_bytes: 0,
                };
                self.rate_control_state.write().await.insert(p.session_id.clone(), state);
                info!(session_id = %p.session_id, max_bps = p.max_bytes_per_sec, policy = %p.policy, "rate control configured");
                Ok(None)
            }

            (MsgType::RateWarning, Payload::RateWarning(p)) => {
                debug!(session_id = %p.session_id, queued = p.queued_bytes, action = %p.action, "rate warning");
                // Update queued bytes in state
                if let Some(state) = self.rate_control_state.write().await.get_mut(&p.session_id) {
                    state.queued_bytes = p.queued_bytes;
                }
                Ok(None)
            }

            // ── Cross-session linking (jump host) ─────────────────
            (MsgType::SessionLink, Payload::SessionLink(p)) => {
                // Verify session access
                if !self.check_session_access(&p.source_session, &ctx.username).await {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::Error,
                        payload: Payload::Error(ErrorPayload {
                            code: 2,
                            message: "not authorized for source session".into(),
                        }),
                    }));
                }
                debug!(source = %p.source_session, target = %p.target_host, port = p.target_port, "session link request");
                // Session linking requires opening a new wsh connection to target_host
                // and bridging the two sessions — not yet implemented
                Ok(Some(Envelope {
                    msg_type: MsgType::Error,
                    payload: Payload::Error(ErrorPayload {
                        code: 5,
                        message: "session linking not yet implemented".into(),
                    }),
                }))
            }

            (MsgType::SessionUnlink, Payload::SessionUnlink(p)) => {
                debug!(link_id = %p.link_id, "session unlink");
                Ok(None)
            }

            // ── AI co-pilot ────────────────────────────────────────
            (MsgType::CopilotAttach, Payload::CopilotAttach(p)) => {
                // Register as read-only observer for the session
                let copilot = CopilotSession {
                    model: p.model.clone(),
                    peer_tx: ctx.peer_tx.clone(),
                };
                let mut sessions = self.copilot_sessions.write().await;
                sessions.entry(p.session_id.clone()).or_default().push(copilot);
                info!(session_id = %p.session_id, model = %p.model, "copilot attached");
                // Notify the session controller via Presence
                Ok(Some(Envelope {
                    msg_type: MsgType::Presence,
                    payload: Payload::Presence(PresencePayload {
                        attachments: vec![AttachmentInfo {
                            session_id: p.session_id.clone(),
                            mode: "copilot".into(),
                            username: Some(format!("copilot:{}", p.model)),
                        }],
                    }),
                }))
            }

            (MsgType::CopilotSuggest, Payload::CopilotSuggest(p)) => {
                debug!(session_id = %p.session_id, "copilot suggestion");
                // Forward suggestion to all non-copilot attached clients (the session controller)
                let senders = self.peer_senders.read().await;
                let suggestion = Envelope {
                    msg_type: MsgType::CopilotSuggest,
                    payload: Payload::CopilotSuggest(CopilotSuggestPayload {
                        session_id: p.session_id.clone(),
                        suggestion: p.suggestion.clone(),
                        confidence: p.confidence,
                    }),
                };
                for sender in senders.values() {
                    let _ = sender.try_send(suggestion.clone());
                }
                Ok(None)
            }

            (MsgType::CopilotDetach, Payload::CopilotDetach(p)) => {
                // Remove copilot from session
                let mut sessions = self.copilot_sessions.write().await;
                if let Some(copilots) = sessions.get_mut(&p.session_id) {
                    // Remove all copilots matching this connection's peer_tx
                    // (simplified: remove last one since we don't track connection identity)
                    if !copilots.is_empty() {
                        copilots.pop();
                    }
                    if copilots.is_empty() {
                        sessions.remove(&p.session_id);
                    }
                }
                info!(session_id = %p.session_id, "copilot detached");
                Ok(None)
            }

            // ── E2E encryption ─────────────────────────────────────
            (MsgType::KeyExchange, Payload::KeyExchange(p)) => {
                debug!(session_id = %p.session_id, algorithm = %p.algorithm, "key exchange");
                // Relay the key exchange to all other clients attached to this session.
                // The server itself cannot decrypt E2E traffic — it's an opaque relay.
                let fwd = Envelope {
                    msg_type: MsgType::KeyExchange,
                    payload: Payload::KeyExchange(KeyExchangePayload {
                        session_id: p.session_id.clone(),
                        algorithm: p.algorithm.clone(),
                        public_key: p.public_key.clone(),
                    }),
                };
                let senders = self.peer_senders.read().await;
                for sender in senders.values() {
                    let _ = sender.try_send(fwd.clone());
                }
                Ok(None)
            }

            (MsgType::EncryptedFrame, Payload::EncryptedFrame(p)) => {
                // Opaque relay — server forwards to all other session clients without decryption
                let fwd = Envelope {
                    msg_type: MsgType::EncryptedFrame,
                    payload: Payload::EncryptedFrame(EncryptedFramePayload {
                        session_id: p.session_id.clone(),
                        nonce: p.nonce.clone(),
                        ciphertext: p.ciphertext.clone(),
                    }),
                };
                let senders = self.peer_senders.read().await;
                for sender in senders.values() {
                    let _ = sender.try_send(fwd.clone());
                }
                Ok(None)
            }

            // ── Predictive local echo ─────────────────────────────
            (MsgType::EchoAck, Payload::EchoAck(p)) => {
                // Update echo tracker for this channel
                let mut trackers = self.echo_trackers.write().await;
                let tracker = trackers.entry(p.channel_id).or_insert_with(|| EchoTracker {
                    last_echo_seq: 0,
                    cursor_x: 0,
                    cursor_y: 0,
                    pending: 0,
                });
                tracker.last_echo_seq = p.echo_seq;
                debug!(channel_id = p.channel_id, echo_seq = p.echo_seq, "echo ack tracked");
                Ok(None)
            }

            (MsgType::EchoState, Payload::EchoState(p)) => {
                // Update echo tracker with full state
                let mut trackers = self.echo_trackers.write().await;
                trackers.insert(p.channel_id, EchoTracker {
                    last_echo_seq: p.echo_seq,
                    cursor_x: p.cursor_x,
                    cursor_y: p.cursor_y,
                    pending: p.pending,
                });
                debug!(channel_id = p.channel_id, echo_seq = p.echo_seq, pending = p.pending, "echo state updated");
                Ok(None)
            }

            // ── Terminal diff sync ──────────────────────────────────
            (MsgType::TermSync, Payload::TermSync(p)) => {
                debug!(channel_id = p.channel_id, frame_seq = p.frame_seq, "term sync");
                // Server-to-client: full state hash checkpoint
                Ok(None)
            }

            (MsgType::TermDiff, Payload::TermDiff(p)) => {
                debug!(channel_id = p.channel_id, frame_seq = p.frame_seq, base_seq = p.base_seq, patch_len = p.patch.len(), "term diff");
                // Server-to-client: incremental screen patch
                Ok(None)
            }

            // ── Horizontal scaling ──────────────────────────────────
            (MsgType::NodeAnnounce, Payload::NodeAnnounce(p)) => {
                // Register or update the node in our cluster registry
                let node = ClusterNode {
                    node_id: p.node_id.clone(),
                    endpoint: p.endpoint.clone(),
                    load: p.load,
                    capacity: p.capacity,
                    last_seen: std::time::Instant::now(),
                };
                self.cluster_nodes.write().await.insert(p.node_id.clone(), node);
                info!(node_id = %p.node_id, endpoint = %p.endpoint, load = p.load, capacity = p.capacity, "cluster node registered/updated");
                Ok(None)
            }

            (MsgType::NodeRedirect, Payload::NodeRedirect(p)) => {
                debug!(target_node = %p.target_node, session_id = %p.session_id, "node redirect");
                // Server-to-client: instruct client to reconnect elsewhere
                Ok(None)
            }

            // ── Cross-principal session sharing ─────────────────────
            (MsgType::SessionGrant, Payload::SessionGrant(p)) => {
                // Verify caller owns the session (only owners can grant)
                if !self.check_session_access(&p.session_id, &ctx.username).await {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::Error,
                        payload: Payload::Error(ErrorPayload {
                            code: 2,
                            message: "not authorized to grant access to this session".into(),
                        }),
                    }));
                }
                // Add principal to session ACL
                let mut acls = self.session_acls.write().await;
                let session_acl = acls.entry(p.session_id.clone()).or_default();
                session_acl.insert(p.principal.clone(), p.permissions.clone());
                info!(session_id = %p.session_id, principal = %p.principal, permissions = ?p.permissions, "session access granted");
                Ok(None)
            }

            (MsgType::SessionRevoke, Payload::SessionRevoke(p)) => {
                // Verify caller owns the session
                if !self.check_session_access(&p.session_id, &ctx.username).await {
                    return Ok(Some(Envelope {
                        msg_type: MsgType::Error,
                        payload: Payload::Error(ErrorPayload {
                            code: 2,
                            message: "not authorized to revoke access to this session".into(),
                        }),
                    }));
                }
                // Remove principal from session ACL
                let mut acls = self.session_acls.write().await;
                if let Some(session_acl) = acls.get_mut(&p.session_id) {
                    session_acl.remove(&p.principal);
                    if session_acl.is_empty() {
                        acls.remove(&p.session_id);
                    }
                }
                info!(session_id = %p.session_id, principal = %p.principal, "session access revoked");
                Ok(None)
            }

            // ── Structured file channel ────────────────────────────
            (MsgType::FileOp, Payload::FileOp(p)) => {
                debug!(channel_id = p.channel_id, op = %p.op, path = %p.path, "file op");
                // Stub: dispatch file operation (stat, list, read, write, etc.)
                Ok(Some(Envelope {
                    msg_type: MsgType::FileResult,
                    payload: Payload::FileResult(FileResultPayload {
                        channel_id: p.channel_id,
                        success: false,
                        metadata: serde_json::Value::Object(Default::default()),
                        error_message: Some("file operations not yet implemented".into()),
                    }),
                }))
            }

            (MsgType::FileResult, Payload::FileResult(_)) => {
                // Server-to-client only
                Ok(None)
            }

            (MsgType::FileChunk, Payload::FileChunk(p)) => {
                debug!(channel_id = p.channel_id, offset = p.offset, len = p.data.len(), is_final = p.is_final, "file chunk");
                Ok(None)
            }

            // ── Policy engine ──────────────────────────────────────
            (MsgType::PolicyEval, Payload::PolicyEval(p)) => {
                debug!(request_id = %p.request_id, action = %p.action, principal = %p.principal, "policy eval");
                let policy = self.policy_store.read().await;
                let (allowed, reason) = match policy.as_ref() {
                    Some(store) => {
                        // Check if the action is explicitly denied in the policy rules
                        let denied = store.rules.get("deny")
                            .and_then(|d| d.as_array())
                            .map(|arr| arr.iter().any(|v| v.as_str() == Some(&p.action)))
                            .unwrap_or(false);
                        if denied {
                            (false, format!("denied by policy {} v{}", store.policy_id, store.version))
                        } else {
                            let explicitly_allowed = store.rules.get("allow")
                                .and_then(|a| a.as_array())
                                .map(|arr| arr.iter().any(|v| v.as_str() == Some(&p.action) || v.as_str() == Some("*")))
                                .unwrap_or(false);
                            if explicitly_allowed {
                                (true, format!("allowed by policy {} v{}", store.policy_id, store.version))
                            } else {
                                // Default-deny when a policy is loaded but action isn't explicitly allowed
                                (false, format!("not allowed by policy {} v{} (default deny)", store.policy_id, store.version))
                            }
                        }
                    }
                    None => {
                        // No policy loaded: default-deny
                        (false, "no policy loaded (default deny)".to_string())
                    }
                };
                Ok(Some(Envelope {
                    msg_type: MsgType::PolicyResult,
                    payload: Payload::PolicyResult(PolicyResultPayload {
                        request_id: p.request_id.clone(),
                        allowed,
                        reason: Some(reason),
                    }),
                }))
            }

            (MsgType::PolicyResult, Payload::PolicyResult(_)) => {
                // Server-to-client only
                Ok(None)
            }

            (MsgType::PolicyUpdate, Payload::PolicyUpdate(p)) => {
                // Store policy rules for future evaluation
                let store = PolicyStore {
                    policy_id: p.policy_id.clone(),
                    version: p.version,
                    rules: p.rules.clone(),
                };
                *self.policy_store.write().await = Some(store);
                info!(policy_id = %p.policy_id, version = p.version, "policy updated");
                Ok(None)
            }

            // ── Terminal frontend config ────────────────────────────
            (MsgType::TerminalConfig, Payload::TerminalConfig(p)) => {
                // Store per-channel terminal config
                let config = TerminalConfigState {
                    frontend: p.frontend.clone(),
                    options: p.options.clone(),
                };
                self.terminal_configs.write().await.insert(p.channel_id, config);
                info!(channel_id = p.channel_id, frontend = %p.frontend, "terminal config updated");
                Ok(None)
            }

            // ── Unhandled ───────────────────────────────────────────
            (msg_type, _) => {
                debug!(?msg_type, "unhandled message type in session loop");
                Ok(None)
            }
        }
    }
}

/// Build a [`MsgType::GatewayData`] envelope to forward TCP data to the client.
fn build_gateway_data(gateway_id: u32, data: Vec<u8>) -> Envelope {
    Envelope {
        msg_type: MsgType::GatewayData,
        payload: Payload::GatewayData(GatewayDataPayload { gateway_id, data }),
    }
}

/// Build a [`MsgType::GatewayClose`] envelope to notify the client of connection close.
fn build_gateway_close_msg(gateway_id: u32) -> Envelope {
    Envelope {
        msg_type: MsgType::GatewayClose,
        payload: Payload::GatewayClose(GatewayClosePayload {
            gateway_id,
            reason: None,
        }),
    }
}

/// Build an [`MsgType::InboundOpen`] envelope from a reverse tunnel
/// [`InboundEvent`](crate::gateway::listener::InboundEvent).
///
/// Sent to the client to notify it that a new inbound TCP connection was
/// accepted on one of its reverse tunnel listeners.
fn build_inbound_open(event: &crate::gateway::listener::InboundEvent) -> Envelope {
    Envelope {
        msg_type: MsgType::InboundOpen,
        payload: Payload::InboundOpen(InboundOpenPayload {
            listener_id: event.listener_id,
            channel_id: event.channel_id,
            peer_addr: event.peer_addr.clone(),
            peer_port: event.peer_port,
        }),
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
