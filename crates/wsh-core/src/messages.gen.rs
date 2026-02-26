// wsh protocol control message types.
// AUTO-GENERATED from wsh-v1.yaml — do not edit.
// Run: node web/packages/wsh/spec/codegen.mjs

use serde::{Deserialize, Serialize};

/// Numeric message type tags — must match JS `MSG` constants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(into = "u8", try_from = "u8")]
#[repr(u8)]
pub enum MsgType {
    Hello = 0x01,
    ServerHello = 0x02,
    Challenge = 0x03,
    AuthMethods = 0x04,
    Auth = 0x05,
    AuthOk = 0x06,
    AuthFail = 0x07,

    Open = 0x10,
    OpenOk = 0x11,
    OpenFail = 0x12,
    Resize = 0x13,
    Signal = 0x14,
    Exit = 0x15,
    Close = 0x16,

    Error = 0x20,
    Ping = 0x21,
    Pong = 0x22,

    Attach = 0x30,
    Resume = 0x31,
    Rename = 0x32,
    IdleWarning = 0x33,
    Shutdown = 0x34,
    Snapshot = 0x35,
    Presence = 0x36,
    ControlChanged = 0x37,
    Metrics = 0x38,

    McpDiscover = 0x40,
    McpTools = 0x41,
    McpCall = 0x42,
    McpResult = 0x43,

    ReverseRegister = 0x50,
    ReverseList = 0x51,
    ReversePeers = 0x52,
    ReverseConnect = 0x53,

    OpenTcp = 0x70,
    OpenUdp = 0x71,
    ResolveDns = 0x72,
    GatewayOk = 0x73,
    GatewayFail = 0x74,
    GatewayClose = 0x75,
    InboundOpen = 0x76,
    InboundAccept = 0x77,
    InboundReject = 0x78,
    DnsResult = 0x79,
    ListenRequest = 0x7a,
    ListenOk = 0x7b,
    ListenFail = 0x7c,
    ListenClose = 0x7d,
    GatewayData = 0x7e,
}

impl From<MsgType> for u8 {
    fn from(m: MsgType) -> u8 {
        m as u8
    }
}

impl TryFrom<u8> for MsgType {
    type Error = String;
    fn try_from(v: u8) -> Result<Self, String> {
        match v {
            0x01 => Ok(Self::Hello),
            0x02 => Ok(Self::ServerHello),
            0x03 => Ok(Self::Challenge),
            0x04 => Ok(Self::AuthMethods),
            0x05 => Ok(Self::Auth),
            0x06 => Ok(Self::AuthOk),
            0x07 => Ok(Self::AuthFail),
            0x10 => Ok(Self::Open),
            0x11 => Ok(Self::OpenOk),
            0x12 => Ok(Self::OpenFail),
            0x13 => Ok(Self::Resize),
            0x14 => Ok(Self::Signal),
            0x15 => Ok(Self::Exit),
            0x16 => Ok(Self::Close),
            0x20 => Ok(Self::Error),
            0x21 => Ok(Self::Ping),
            0x22 => Ok(Self::Pong),
            0x30 => Ok(Self::Attach),
            0x31 => Ok(Self::Resume),
            0x32 => Ok(Self::Rename),
            0x33 => Ok(Self::IdleWarning),
            0x34 => Ok(Self::Shutdown),
            0x35 => Ok(Self::Snapshot),
            0x36 => Ok(Self::Presence),
            0x37 => Ok(Self::ControlChanged),
            0x38 => Ok(Self::Metrics),
            0x40 => Ok(Self::McpDiscover),
            0x41 => Ok(Self::McpTools),
            0x42 => Ok(Self::McpCall),
            0x43 => Ok(Self::McpResult),
            0x50 => Ok(Self::ReverseRegister),
            0x51 => Ok(Self::ReverseList),
            0x52 => Ok(Self::ReversePeers),
            0x53 => Ok(Self::ReverseConnect),
            0x70 => Ok(Self::OpenTcp),
            0x71 => Ok(Self::OpenUdp),
            0x72 => Ok(Self::ResolveDns),
            0x73 => Ok(Self::GatewayOk),
            0x74 => Ok(Self::GatewayFail),
            0x75 => Ok(Self::GatewayClose),
            0x76 => Ok(Self::InboundOpen),
            0x77 => Ok(Self::InboundAccept),
            0x78 => Ok(Self::InboundReject),
            0x79 => Ok(Self::DnsResult),
            0x7a => Ok(Self::ListenRequest),
            0x7b => Ok(Self::ListenOk),
            0x7c => Ok(Self::ListenFail),
            0x7d => Ok(Self::ListenClose),
            0x7e => Ok(Self::GatewayData),
            _ => Err(format!("unknown message type: 0x{v:02x}")),
        }
    }
}

/// ChannelKind enum.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChannelKind {
    Pty,
    Exec,
    Meta,
    File,
    Tcp,
    Udp,
}

/// AuthMethod enum.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    Pubkey,
    Password,
}

/// Protocol version string.
pub const PROTOCOL_VERSION: &str = "wsh-v1";

// ── Message payloads ──────────────────────────────────────────────────

/// Envelope: every control message has a `type` plus a payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    #[serde(rename = "type")]
    pub msg_type: MsgType,

    #[serde(flatten)]
    pub payload: Payload,
}

/// All possible message payloads (untagged for CBOR compatibility).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Payload {
    Hello(HelloPayload),
    ServerHello(ServerHelloPayload),
    Challenge(ChallengePayload),
    AuthMethods(AuthMethodsPayload),
    Auth(AuthPayload),
    AuthOk(AuthOkPayload),
    AuthFail(AuthFailPayload),
    Open(OpenPayload),
    OpenOk(OpenOkPayload),
    OpenFail(OpenFailPayload),
    Resize(ResizePayload),
    Signal(SignalPayload),
    Exit(ExitPayload),
    Close(ClosePayload),
    Error(ErrorPayload),
    PingPong(PingPongPayload),
    Attach(AttachPayload),
    Resume(ResumePayload),
    Rename(RenamePayload),
    IdleWarning(IdleWarningPayload),
    Shutdown(ShutdownPayload),
    Snapshot(SnapshotPayload),
    Presence(PresencePayload),
    ControlChanged(ControlChangedPayload),
    Metrics(MetricsPayload),
    McpDiscover(McpDiscoverPayload),
    McpTools(McpToolsPayload),
    McpCall(McpCallPayload),
    McpResult(McpResultPayload),
    ReverseRegister(ReverseRegisterPayload),
    ReverseList(ReverseListPayload),
    ReversePeers(ReversePeersPayload),
    ReverseConnect(ReverseConnectPayload),
    OpenTcp(OpenTcpPayload),
    OpenUdp(OpenUdpPayload),
    ResolveDns(ResolveDnsPayload),
    GatewayOk(GatewayOkPayload),
    GatewayFail(GatewayFailPayload),
    GatewayClose(GatewayClosePayload),
    InboundOpen(InboundOpenPayload),
    InboundAccept(InboundAcceptPayload),
    InboundReject(InboundRejectPayload),
    DnsResult(DnsResultPayload),
    ListenRequest(ListenRequestPayload),
    ListenOk(ListenOkPayload),
    ListenFail(ListenFailPayload),
    ListenClose(ListenClosePayload),
    GatewayData(GatewayDataPayload),
    Empty(EmptyPayload),
}

// ── Individual payload structs ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmptyPayload {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingPongPayload {
    pub id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelloPayload {
    pub version: String,
    pub username: String,
    #[serde(default)]
    pub features: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_method: Option<AuthMethod>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerHelloPayload {
    pub session_id: String,
    #[serde(default)]
    pub features: Vec<String>,
    #[serde(default)]
    pub fingerprints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChallengePayload {
    #[serde(with = "serde_bytes")]
    pub nonce: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthMethodsPayload {
    pub methods: Vec<AuthMethod>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthPayload {
    pub method: AuthMethod,
    #[serde(default, skip_serializing_if = "Option::is_none", with = "option_bytes")]
    pub signature: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Option::is_none", with = "option_bytes")]
    pub public_key: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthOkPayload {
    pub session_id: String,
    #[serde(with = "serde_bytes")]
    pub token: Vec<u8>,
    pub ttl: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthFailPayload {
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenPayload {
    pub kind: ChannelKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cols: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenOkPayload {
    pub channel_id: u32,
    #[serde(default)]
    pub stream_ids: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenFailPayload {
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResizePayload {
    pub channel_id: u32,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalPayload {
    pub channel_id: u32,
    pub signal: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExitPayload {
    pub channel_id: u32,
    pub code: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClosePayload {
    pub channel_id: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPayload {
    pub code: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachPayload {
    pub session_id: String,
    #[serde(with = "serde_bytes")]
    pub token: Vec<u8>,
    #[serde(default = "default_attach_mode")]
    pub mode: String,
}

fn default_attach_mode() -> String {
    "control".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumePayload {
    pub session_id: String,
    #[serde(with = "serde_bytes")]
    pub token: Vec<u8>,
    pub last_seq: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenamePayload {
    pub session_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdleWarningPayload {
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShutdownPayload {
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotPayload {
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresencePayload {
    pub attachments: Vec<AttachmentInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlChangedPayload {
    pub new_controller: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricsPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cpu: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sessions: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rtt: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpDiscoverPayload {
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolsPayload {
    pub tools: Vec<McpToolSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCallPayload {
    pub tool: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResultPayload {
    pub result: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReverseRegisterPayload {
    pub username: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(with = "serde_bytes")]
    pub public_key: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReverseListPayload {
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReversePeersPayload {
    pub peers: Vec<PeerInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReverseConnectPayload {
    pub target_fingerprint: String,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenTcpPayload {
    pub gateway_id: u32,
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenUdpPayload {
    pub gateway_id: u32,
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveDnsPayload {
    pub gateway_id: u32,
    pub name: String,
    #[serde(default)]
    pub record_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayOkPayload {
    pub gateway_id: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_addr: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayFailPayload {
    pub gateway_id: u32,
    pub code: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayClosePayload {
    pub gateway_id: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundOpenPayload {
    pub listener_id: u32,
    pub channel_id: u32,
    pub peer_addr: String,
    pub peer_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundAcceptPayload {
    pub channel_id: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gateway_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundRejectPayload {
    pub channel_id: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsResultPayload {
    pub gateway_id: u32,
    pub addresses: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ttl: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListenRequestPayload {
    pub listener_id: u32,
    pub port: u16,
    #[serde(default)]
    pub bind_addr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListenOkPayload {
    pub listener_id: u32,
    pub actual_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListenFailPayload {
    pub listener_id: u32,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListenClosePayload {
    pub listener_id: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayDataPayload {
    pub gateway_id: u32,
    #[serde(with = "serde_bytes")]
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentInfo {
    pub session_id: String,
    pub mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub fingerprint_short: String,
    pub username: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolSpec {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub parameters: serde_json::Value,
}

// ── Helper for optional bytes serde ──────────────────────────────────

mod option_bytes {
    use serde::{self, Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &Option<Vec<u8>>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match value {
            Some(bytes) => super::serde_bytes::serialize(bytes, serializer),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<Vec<u8>>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let opt: Option<super::serde_bytes::ByteBuf> = Option::deserialize(deserializer)?;
        Ok(opt.map(|b: super::serde_bytes::ByteBuf| b.into_vec()))
    }
}

// serde_json::Value is used in McpToolSpec / McpCallPayload / McpResultPayload.

mod serde_bytes {
    use serde::{self, Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(bytes: &Vec<u8>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_bytes(bytes)
    }

    #[allow(dead_code)]
    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let buf: ByteBuf = Deserialize::deserialize(deserializer)?;
        Ok(buf.into_vec())
    }

    #[derive(Debug)]
    pub struct ByteBuf(Vec<u8>);

    impl ByteBuf {
        pub fn into_vec(self) -> Vec<u8> {
            self.0
        }
    }

    impl<'de> Deserialize<'de> for ByteBuf {
        fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where
            D: Deserializer<'de>,
        {
            struct ByteBufVisitor;

            impl<'de> serde::de::Visitor<'de> for ByteBufVisitor {
                type Value = ByteBuf;

                fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                    formatter.write_str("bytes")
                }

                fn visit_bytes<E>(self, v: &[u8]) -> Result<Self::Value, E> {
                    Ok(ByteBuf(v.to_vec()))
                }

                fn visit_byte_buf<E>(self, v: Vec<u8>) -> Result<Self::Value, E> {
                    Ok(ByteBuf(v))
                }

                fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
                where
                    A: serde::de::SeqAccess<'de>,
                {
                    let mut bytes = Vec::new();
                    while let Some(b) = seq.next_element::<u8>()? {
                        bytes.push(b);
                    }
                    Ok(ByteBuf(bytes))
                }
            }

            deserializer.deserialize_any(ByteBufVisitor)
        }
    }
}
