//! Reverse-host runtime for `wsh reverse`.
//!
//! Accepts relay-forwarded OPEN/SESSION_DATA/RESIZE/SIGNAL/CLOSE messages and
//! serves them from a local PTY so another client can remote into this machine
//! through a relay.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

use anyhow::{Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use wsh_client::WshClient;
use wsh_core::messages::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReverseHostOptions {
    pub capabilities: Vec<String>,
    pub peer_type: String,
    pub shell_backend: String,
    pub supports_attach: bool,
    pub supports_replay: bool,
    pub supports_echo: bool,
    pub supports_term_sync: bool,
}

impl Default for ReverseHostOptions {
    fn default() -> Self {
        Self {
            capabilities: vec!["shell".to_string(), "exec".to_string()],
            peer_type: "host".to_string(),
            shell_backend: "pty".to_string(),
            supports_attach: false,
            supports_replay: false,
            supports_echo: false,
            supports_term_sync: false,
        }
    }
}

impl ReverseHostOptions {
    pub fn reverse_register_payload(
        &self,
        username: String,
        public_key: Vec<u8>,
    ) -> ReverseRegisterPayload {
        ReverseRegisterPayload {
            username,
            capabilities: self.capabilities.clone(),
            peer_type: self.peer_type.clone(),
            shell_backend: self.shell_backend.clone(),
            supports_attach: self.supports_attach,
            supports_replay: self.supports_replay,
            supports_echo: self.supports_echo,
            supports_term_sync: self.supports_term_sync,
            public_key,
        }
    }

    fn reverse_accept_payload(&self, request: ReverseConnectPayload) -> ReverseAcceptPayload {
        ReverseAcceptPayload {
            target_fingerprint: request.target_fingerprint,
            username: request.username,
            capabilities: self.capabilities.clone(),
            peer_type: self.peer_type.clone(),
            shell_backend: self.shell_backend.clone(),
            supports_attach: self.supports_attach,
            supports_replay: self.supports_replay,
            supports_echo: self.supports_echo,
            supports_term_sync: self.supports_term_sync,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReverseHostRunOutcome {
    Interrupted,
    TransportClosed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReverseHostStatusEvent {
    ReverseConnectionAccepted {
        requester: String,
        target_fingerprint: String,
    },
    SessionCountChanged {
        active_sessions: usize,
    },
}

pub async fn run_with_options(
    client: Arc<WshClient>,
    mut reverse_connect_rx: mpsc::Receiver<Envelope>,
    mut relay_message_rx: mpsc::Receiver<Envelope>,
    options: ReverseHostOptions,
    status_tx: Option<mpsc::Sender<ReverseHostStatusEvent>>,
) -> Result<ReverseHostRunOutcome> {
    let (event_tx, mut event_rx) = mpsc::channel::<RuntimeEvent>(256);
    let mut runtime = ReverseHostRuntime::new(client, options, status_tx);
    let mut reverse_channel_closed = false;
    let mut relay_channel_closed = false;

    loop {
        tokio::select! {
            envelope = reverse_connect_rx.recv(), if !reverse_channel_closed => {
                match envelope {
                    Some(envelope) => runtime.handle_reverse_connect(envelope).await?,
                    None => reverse_channel_closed = true,
                }
            }
            envelope = relay_message_rx.recv(), if !relay_channel_closed => {
                match envelope {
                    Some(envelope) => runtime.handle_relay_message(envelope, event_tx.clone()).await?,
                    None => relay_channel_closed = true,
                }
            }
            Some(event) = event_rx.recv() => {
                runtime.handle_runtime_event(event).await?;
            }
            _ = tokio::signal::ctrl_c() => {
                info!("reverse host runtime received Ctrl+C");
                runtime.shutdown().await;
                return Ok(ReverseHostRunOutcome::Interrupted);
            }
        }

        if reverse_channel_closed && relay_channel_closed {
            info!("reverse host runtime transport closed");
            runtime.shutdown().await;
            return Ok(ReverseHostRunOutcome::TransportClosed);
        }
    }
}

struct ReverseHostRuntime {
    client: Arc<WshClient>,
    options: ReverseHostOptions,
    status_tx: Option<mpsc::Sender<ReverseHostStatusEvent>>,
    active_request: Option<ReverseConnectPayload>,
    sessions: HashMap<u32, ReverseHostSession>,
    next_channel_id: u32,
}

impl ReverseHostRuntime {
    fn new(
        client: Arc<WshClient>,
        options: ReverseHostOptions,
        status_tx: Option<mpsc::Sender<ReverseHostStatusEvent>>,
    ) -> Self {
        Self {
            client,
            options,
            status_tx,
            active_request: None,
            sessions: HashMap::new(),
            next_channel_id: 1,
        }
    }

    async fn handle_reverse_connect(&mut self, envelope: Envelope) -> Result<()> {
        let Payload::ReverseConnect(request) = envelope.payload else {
            return Ok(());
        };

        if self.active_request.is_some() || !self.sessions.is_empty() {
            self.client
                .send_fire_and_forget(Envelope {
                    msg_type: MsgType::ReverseReject,
                    payload: Payload::ReverseReject(ReverseRejectPayload {
                        target_fingerprint: request.target_fingerprint.clone(),
                        username: request.username.clone(),
                        reason: "reverse host is busy".to_string(),
                    }),
                })
                .await
                .map_err(|err| anyhow::anyhow!("{err}"))?;
            return Ok(());
        }

        info!(
            requester = %request.username,
            target = %request.target_fingerprint,
            "accepting reverse host connection"
        );
        self.notify_status(ReverseHostStatusEvent::ReverseConnectionAccepted {
            requester: request.username.clone(),
            target_fingerprint: request.target_fingerprint.clone(),
        })
        .await;
        self.active_request = Some(request.clone());
        self.client
            .send_fire_and_forget(Envelope {
                msg_type: MsgType::ReverseAccept,
                payload: Payload::ReverseAccept(self.options.reverse_accept_payload(request)),
            })
            .await
            .map_err(|err| anyhow::anyhow!("{err}"))?;

        Ok(())
    }

    async fn handle_relay_message(
        &mut self,
        envelope: Envelope,
        event_tx: mpsc::Sender<RuntimeEvent>,
    ) -> Result<()> {
        match envelope.payload {
            Payload::Open(open) => self.handle_open(open, event_tx).await,
            Payload::SessionData(data) => self.handle_session_data(data).await,
            Payload::Resize(resize) => self.handle_resize(resize).await,
            Payload::Signal(signal) => self.handle_signal(signal).await,
            Payload::Close(close) => self.handle_close(close).await,
            Payload::McpDiscover(_) | Payload::McpCall(_) => {
                self.send_open_fail("reverse host tools are not exposed yet").await
            }
            other => {
                debug!("ignoring unsupported reverse-host relay message: {:?}", other);
                Ok(())
            }
        }
    }

    async fn handle_runtime_event(&mut self, event: RuntimeEvent) -> Result<()> {
        match event {
            RuntimeEvent::Output { channel_id, data } => {
                self.client
                    .send_fire_and_forget(Envelope {
                        msg_type: MsgType::SessionData,
                        payload: Payload::SessionData(SessionDataPayload { channel_id, data }),
                    })
                    .await
                    .map_err(|err| anyhow::anyhow!("{err}"))?;
            }
            RuntimeEvent::Exited { channel_id, code } => {
                self.client
                    .send_fire_and_forget(Envelope {
                        msg_type: MsgType::Exit,
                        payload: Payload::Exit(ExitPayload { channel_id, code }),
                    })
                    .await
                    .map_err(|err| anyhow::anyhow!("{err}"))?;
                self.client
                    .send_fire_and_forget(Envelope {
                        msg_type: MsgType::Close,
                        payload: Payload::Close(ClosePayload { channel_id }),
                    })
                    .await
                    .map_err(|err| anyhow::anyhow!("{err}"))?;
                self.drop_session(channel_id).await;
            }
            RuntimeEvent::ReadFailed { channel_id, error } => {
                warn!(channel_id, "reverse host PTY read failed: {error}");
                self.drop_session(channel_id).await;
            }
        }

        Ok(())
    }

    async fn handle_open(
        &mut self,
        open: OpenPayload,
        event_tx: mpsc::Sender<RuntimeEvent>,
    ) -> Result<()> {
        match open.kind {
            ChannelKind::Pty | ChannelKind::Exec => {}
            _ => {
                return self
                    .send_open_fail("reverse host currently supports only pty and exec channels")
                    .await;
            }
        }

        let channel_id = self.next_channel_id;
        self.next_channel_id += 1;

        let cols = open.cols.unwrap_or(80);
        let rows = open.rows.unwrap_or(24);
        let command = open.command.clone();
        let env = open.env.clone();

        let pty = LocalPty::spawn(command.as_deref(), cols, rows, env.as_ref())
            .with_context(|| format!("failed to spawn local PTY for channel {channel_id}"))?;
        let pty = Arc::new(pty);

        let output_task = spawn_output_task(channel_id, pty.clone(), event_tx.clone());
        let wait_task = spawn_wait_task(channel_id, pty.clone(), event_tx);

        self.sessions.insert(
            channel_id,
            ReverseHostSession {
                pty,
                output_task,
                wait_task,
            },
        );

        self.client
            .send_fire_and_forget(Envelope {
                msg_type: MsgType::OpenOk,
                payload: Payload::OpenOk(OpenOkPayload {
                    channel_id,
                    stream_ids: vec![],
                    data_mode: SessionDataMode::Virtual,
                    capabilities: match open.kind {
                        ChannelKind::Pty => vec!["resize".into(), "signal".into()],
                        ChannelKind::Exec => vec!["signal".into()],
                        _ => vec![],
                    },
                }),
            })
            .await
            .map_err(|err| anyhow::anyhow!("{err}"))?;
        self.emit_session_count().await;

        Ok(())
    }

    async fn handle_session_data(&mut self, data: SessionDataPayload) -> Result<()> {
        let Some(session) = self.sessions.get(&data.channel_id) else {
            return Ok(());
        };

        let pty = session.pty.clone();
        tokio::task::spawn_blocking(move || pty.write_blocking(&data.data))
            .await
            .map_err(|err| anyhow::anyhow!("join error: {err}"))?
            .with_context(|| format!("failed to write to PTY channel {}", data.channel_id))
    }

    async fn handle_resize(&mut self, resize: ResizePayload) -> Result<()> {
        let Some(session) = self.sessions.get(&resize.channel_id) else {
            return Ok(());
        };

        let pty = session.pty.clone();
        tokio::task::spawn_blocking(move || pty.resize_blocking(resize.cols, resize.rows))
            .await
            .map_err(|err| anyhow::anyhow!("join error: {err}"))?
            .with_context(|| format!("failed to resize PTY channel {}", resize.channel_id))
    }

    async fn handle_signal(&mut self, signal: SignalPayload) -> Result<()> {
        let Some(session) = self.sessions.get(&signal.channel_id) else {
            return Ok(());
        };

        let pty = session.pty.clone();
        let signal_name = signal.signal.clone();
        tokio::task::spawn_blocking(move || pty.signal_blocking(&signal_name))
            .await
            .map_err(|err| anyhow::anyhow!("join error: {err}"))?
            .with_context(|| format!("failed to signal PTY channel {}", signal.channel_id))
    }

    async fn handle_close(&mut self, close: ClosePayload) -> Result<()> {
        self.drop_session(close.channel_id).await;
        Ok(())
    }

    async fn send_open_fail(&self, reason: &str) -> Result<()> {
        self.client
            .send_fire_and_forget(Envelope {
                msg_type: MsgType::OpenFail,
                payload: Payload::OpenFail(OpenFailPayload {
                    reason: reason.to_string(),
                }),
            })
            .await
            .map_err(|err| anyhow::anyhow!("{err}"))?;
        Ok(())
    }

    async fn drop_session(&mut self, channel_id: u32) {
        if let Some(session) = self.sessions.remove(&channel_id) {
            let pty = session.pty.clone();
            let _ = tokio::task::spawn_blocking(move || pty.kill_blocking()).await;
            session.output_task.abort();
            session.wait_task.abort();
        }

        if self.sessions.is_empty() {
            self.active_request = None;
        }
        self.emit_session_count().await;
    }

    async fn shutdown(&mut self) {
        let channel_ids: Vec<u32> = self.sessions.keys().copied().collect();
        for channel_id in channel_ids {
            self.drop_session(channel_id).await;
        }
    }

    async fn notify_status(&self, event: ReverseHostStatusEvent) {
        if let Some(status_tx) = &self.status_tx {
            let _ = status_tx.send(event).await;
        }
    }

    async fn emit_session_count(&self) {
        self.notify_status(ReverseHostStatusEvent::SessionCountChanged {
            active_sessions: self.sessions.len(),
        })
        .await;
    }
}

struct ReverseHostSession {
    pty: Arc<LocalPty>,
    output_task: tokio::task::JoinHandle<()>,
    wait_task: tokio::task::JoinHandle<()>,
}

enum RuntimeEvent {
    Output { channel_id: u32, data: Vec<u8> },
    Exited { channel_id: u32, code: i32 },
    ReadFailed { channel_id: u32, error: String },
}

fn spawn_output_task(
    channel_id: u32,
    pty: Arc<LocalPty>,
    event_tx: mpsc::Sender<RuntimeEvent>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            let pty = pty.clone();
            let read_result = tokio::task::spawn_blocking(move || {
                let mut buf = vec![0_u8; 8192];
                match pty.read_blocking(&mut buf) {
                    Ok(0) => Ok(None),
                    Ok(n) => {
                        buf.truncate(n);
                        Ok(Some(buf))
                    }
                    Err(err) => Err(err.to_string()),
                }
            })
            .await;

            match read_result {
                Ok(Ok(Some(data))) => {
                    if event_tx
                        .send(RuntimeEvent::Output { channel_id, data })
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(Ok(None)) => break,
                Ok(Err(error)) => {
                    let _ = event_tx
                        .send(RuntimeEvent::ReadFailed { channel_id, error })
                        .await;
                    break;
                }
                Err(join_error) => {
                    let _ = event_tx
                        .send(RuntimeEvent::ReadFailed {
                            channel_id,
                            error: join_error.to_string(),
                        })
                        .await;
                    break;
                }
            }
        }
    })
}

fn spawn_wait_task(
    channel_id: u32,
    pty: Arc<LocalPty>,
    event_tx: mpsc::Sender<RuntimeEvent>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        match tokio::task::spawn_blocking(move || pty.wait_blocking()).await {
            Ok(Ok(code)) => {
                let _ = event_tx.send(RuntimeEvent::Exited { channel_id, code }).await;
            }
            Ok(Err(err)) => {
                let _ = event_tx
                    .send(RuntimeEvent::ReadFailed {
                        channel_id,
                        error: err.to_string(),
                    })
                    .await;
            }
            Err(join_err) => {
                let _ = event_tx
                    .send(RuntimeEvent::ReadFailed {
                        channel_id,
                        error: join_err.to_string(),
                    })
                    .await;
            }
        }
    })
}

struct LocalPty {
    master_reader: std::sync::Mutex<Box<dyn Read + Send>>,
    master_writer: std::sync::Mutex<Box<dyn Write + Send>>,
    master: std::sync::Mutex<Box<dyn MasterPty + Send>>,
    child: std::sync::Mutex<Box<dyn portable_pty::Child + Send>>,
}

impl LocalPty {
    fn spawn(
        command: Option<&str>,
        cols: u16,
        rows: u16,
        env: Option<&HashMap<String, String>>,
    ) -> Result<Self> {
        let pty_system = native_pty_system();
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system
            .openpty(size)
            .context("failed to allocate PTY pair")?;

        let mut cmd = build_command_builder(command)?;

        if let Some(env_map) = env {
            for (key, value) in env_map {
                cmd.env(key, value);
            }
        }
        cmd.env("TERM", "xterm-256color");

        let child = pair
            .slave
            .spawn_command(cmd)
            .context("failed to spawn PTY command")?;

        let reader = pair
            .master
            .try_clone_reader()
            .context("failed to clone PTY reader")?;
        let writer = pair.master.take_writer().context("failed to take PTY writer")?;

        Ok(Self {
            master_reader: std::sync::Mutex::new(reader),
            master_writer: std::sync::Mutex::new(writer),
            master: std::sync::Mutex::new(pair.master),
            child: std::sync::Mutex::new(child),
        })
    }

    fn read_blocking(&self, buf: &mut [u8]) -> Result<usize> {
        let mut reader = self
            .master_reader
            .lock()
            .map_err(|_| anyhow::anyhow!("PTY reader lock poisoned"))?;
        let n = reader.read(buf)?;
        Ok(n)
    }

    fn write_blocking(&self, data: &[u8]) -> Result<()> {
        let mut writer = self
            .master_writer
            .lock()
            .map_err(|_| anyhow::anyhow!("PTY writer lock poisoned"))?;
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    fn resize_blocking(&self, cols: u16, rows: u16) -> Result<()> {
        let master = self
            .master
            .lock()
            .map_err(|_| anyhow::anyhow!("PTY master lock poisoned"))?;
        master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    fn signal_blocking(&self, signal: &str) -> Result<()> {
        match signal {
            "SIGINT" | "INT" => self.write_blocking(&[3]),
            "SIGTERM" | "TERM" | "SIGKILL" | "KILL" => self.kill_blocking(),
            _ => Ok(()),
        }
    }

    fn kill_blocking(&self) -> Result<()> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| anyhow::anyhow!("PTY child lock poisoned"))?;
        child.kill()?;
        Ok(())
    }

    fn wait_blocking(&self) -> Result<i32> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| anyhow::anyhow!("PTY child lock poisoned"))?;
        let status = child.wait()?;
        Ok(status.exit_code() as i32)
    }
}

fn build_command_builder(command: Option<&str>) -> Result<CommandBuilder> {
    let shell = default_shell();
    let (program, args) = command_spec(command, &shell)?;
    let mut builder = CommandBuilder::new(program);
    for arg in args {
        builder.arg(arg);
    }
    Ok(builder)
}

fn command_spec(command: Option<&str>, shell: &str) -> Result<(String, Vec<String>)> {
    match command {
        Some(command) => {
            let trimmed = command.trim();
            if trimmed.is_empty() {
                anyhow::bail!("empty command");
            }
            Ok((shell.to_string(), vec!["-c".to_string(), trimmed.to_string()]))
        }
        None => Ok((shell.to_string(), Vec::new())),
    }
}

fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

#[cfg(test)]
mod tests {
    use super::command_spec;

    #[test]
    fn reverse_host_command_spec_uses_shell_c() {
        let (program, args) = command_spec(Some("printf hello"), "/bin/sh").unwrap();
        assert_eq!(program, "/bin/sh");
        assert_eq!(args, vec!["-c".to_string(), "printf hello".to_string()]);
    }

    #[test]
    fn reverse_host_command_spec_preserves_quotes_and_redirects() {
        let command = r#"echo "a b" > hello.txt"#;
        let (_program, args) = command_spec(Some(command), "/bin/sh").unwrap();
        assert_eq!(args[1], command);
    }
}
