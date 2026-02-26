//! Client-side wsh session.
//!
//! A `WshSession` wraps a data stream and provides read/write/resize/signal/close
//! operations on a single channel.

use std::sync::Arc;
use tokio::sync::Mutex;
use wsh_core::error::{WshError, WshResult};
use wsh_core::messages::ChannelKind;
use wsh_core::transport::ByteStream;

/// The state of a session channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    /// The channel is open and active.
    Open,
    /// The channel is closing (sent close, waiting for confirmation).
    Closing,
    /// The channel is fully closed.
    Closed,
}

/// Options for opening a new session.
#[derive(Debug, Clone)]
pub struct SessionOpts {
    /// Channel kind (pty, exec, meta, file).
    pub kind: ChannelKind,
    /// Command to execute (for exec channels).
    pub command: Option<String>,
    /// Terminal columns (for pty channels).
    pub cols: Option<u16>,
    /// Terminal rows (for pty channels).
    pub rows: Option<u16>,
    /// Environment variables to set.
    pub env: Option<std::collections::HashMap<String, String>>,
}

impl Default for SessionOpts {
    fn default() -> Self {
        Self {
            kind: ChannelKind::Pty,
            command: None,
            cols: Some(80),
            rows: Some(24),
            env: None,
        }
    }
}

/// Information about an existing session.
#[derive(Debug, Clone)]
pub struct SessionInfo {
    /// Session identifier.
    pub session_id: String,
    /// Channel ID.
    pub channel_id: u32,
    /// Channel kind.
    pub kind: ChannelKind,
    /// Current state.
    pub state: SessionState,
    /// Human-readable name (if set).
    pub name: Option<String>,
}

/// A client-side wsh session wrapping a data stream.
///
/// Provides buffered read/write operations plus control actions
/// (resize, signal, close) that are dispatched via the control channel.
pub struct WshSession {
    /// Channel ID assigned by the server.
    channel_id: u32,
    /// Channel kind.
    kind: ChannelKind,
    /// Current state.
    state: Arc<Mutex<SessionState>>,
    /// The data stream for this channel.
    stream: Arc<Mutex<Box<dyn ByteStream>>>,
    /// Sender for control messages (resize, signal, close) — sent to the client's
    /// control dispatch loop.
    control_tx: tokio::sync::mpsc::Sender<ControlAction>,
}

/// Internal control actions that the session sends to the client dispatch loop.
#[derive(Debug)]
pub enum ControlAction {
    Resize {
        channel_id: u32,
        cols: u16,
        rows: u16,
    },
    Signal {
        channel_id: u32,
        signal: String,
    },
    Close {
        channel_id: u32,
    },
}

impl WshSession {
    /// Create a new session. Called internally by `WshClient::open_session`.
    pub(crate) fn new(
        channel_id: u32,
        kind: ChannelKind,
        stream: Box<dyn ByteStream>,
        control_tx: tokio::sync::mpsc::Sender<ControlAction>,
    ) -> Self {
        Self {
            channel_id,
            kind,
            state: Arc::new(Mutex::new(SessionState::Open)),
            stream: Arc::new(Mutex::new(stream)),
            control_tx,
        }
    }

    /// The channel ID assigned by the server.
    pub fn channel_id(&self) -> u32 {
        self.channel_id
    }

    /// The kind of this channel.
    pub fn kind(&self) -> &ChannelKind {
        &self.kind
    }

    /// Current session state.
    pub async fn state(&self) -> SessionState {
        *self.state.lock().await
    }

    /// Write data to the session's data stream.
    pub async fn write(&self, data: &[u8]) -> WshResult<()> {
        let state = self.state.lock().await;
        if *state != SessionState::Open {
            return Err(WshError::Channel(format!(
                "channel {} is not open (state: {:?})",
                self.channel_id, *state
            )));
        }
        drop(state);

        let mut stream = self.stream.lock().await;
        stream.write_all(data).await
    }

    /// Read data from the session's data stream.
    ///
    /// Returns the number of bytes read. Returns 0 on EOF.
    pub async fn read(&self, buf: &mut [u8]) -> WshResult<usize> {
        let mut stream = self.stream.lock().await;
        stream.read(buf).await
    }

    /// Resize the terminal (for pty sessions).
    pub async fn resize(&self, cols: u16, rows: u16) -> WshResult<()> {
        self.control_tx
            .send(ControlAction::Resize {
                channel_id: self.channel_id,
                cols,
                rows,
            })
            .await
            .map_err(|_| WshError::Channel("control channel closed".into()))
    }

    /// Send a signal to the session process.
    pub async fn signal(&self, sig: &str) -> WshResult<()> {
        self.control_tx
            .send(ControlAction::Signal {
                channel_id: self.channel_id,
                signal: sig.to_string(),
            })
            .await
            .map_err(|_| WshError::Channel("control channel closed".into()))
    }

    /// Close this session.
    pub async fn close(&self) -> WshResult<()> {
        {
            let mut state = self.state.lock().await;
            if *state == SessionState::Closed {
                return Ok(());
            }
            *state = SessionState::Closing;
        }

        self.control_tx
            .send(ControlAction::Close {
                channel_id: self.channel_id,
            })
            .await
            .map_err(|_| WshError::Channel("control channel closed".into()))?;

        // Close the data stream
        {
            let mut stream = self.stream.lock().await;
            stream.close().await?;
        }

        {
            let mut state = self.state.lock().await;
            *state = SessionState::Closed;
        }

        Ok(())
    }

    /// Mark this session as closed (called externally when an Exit message is received).
    pub(crate) async fn mark_closed(&self) {
        let mut state = self.state.lock().await;
        *state = SessionState::Closed;
    }

    /// Mark this session as open (called when transitioning from a connecting state).
    #[allow(dead_code)]
    pub(crate) async fn mark_open(&self) {
        let mut state = self.state.lock().await;
        *state = SessionState::Open;
    }
}
