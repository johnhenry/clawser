//! wsh-core: Shared protocol library for the Web Shell.
//!
//! Provides CBOR message types, codec, identity/fingerprint management,
//! authorized_keys parsing, HMAC session tokens, and abstract transport traits.

pub mod codec;
pub mod error;
pub mod identity;
pub mod keys;
pub mod messages;
pub mod token;
pub mod transport;

// Re-export commonly used items at crate root.
pub use error::{WshError, WshResult};
pub use messages::{MsgType, ChannelKind, AuthMethod, PROTOCOL_VERSION};
pub use codec::{frame_encode, cbor_decode, FrameDecoder};
pub use identity::{fingerprint, short_fingerprint, FingerprintIndex};
pub use token::{create_token, verify_token, generate_secret};
