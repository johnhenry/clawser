mod mock;

pub use mock::MockProvider;

use serde::{Deserialize, Serialize};

/// Role in a chat conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
    Tool,
}

/// A part of multimodal message content.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { url: String },
    #[serde(rename = "image_base64")]
    ImageBase64 { media_type: String, data: String },
}

/// A message in a chat conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_parts: Option<Vec<ContentPart>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: Role::System,
            content: content.into(),
            content_parts: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: content.into(),
            content_parts: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: Role::Assistant,
            content: content.into(),
            content_parts: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn tool_result(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: Role::Tool,
            content: content.into(),
            content_parts: None,
            tool_call_id: Some(tool_call_id.into()),
            name: None,
        }
    }
}

/// A tool call requested by the model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

/// Token usage statistics.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

impl TokenUsage {
    pub fn total(&self) -> u32 {
        self.input_tokens + self.output_tokens
    }
}

/// Response from a chat completion.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub usage: TokenUsage,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
}

/// A chunk from a streaming chat response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatStreamChunk {
    pub delta: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_delta: Option<ToolCallDelta>,
    pub is_final: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
}

/// Incremental tool call data from streaming.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallDelta {
    pub id: Option<String>,
    pub name: Option<String>,
    pub arguments_delta: String,
}

/// Options for a chat request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatOptions {
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_sequences: Option<Vec<String>>,
}

impl Default for ChatOptions {
    fn default() -> Self {
        Self {
            model: "default".to_string(),
            temperature: Some(0.7),
            max_tokens: None,
            stop_sequences: None,
        }
    }
}

/// Capabilities declared by a provider.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub native_tool_calling: bool,
    pub vision: bool,
    pub streaming: bool,
    pub embeddings: bool,
}

use crate::tools::ToolSpec;

/// Trait that all AI providers must implement.
pub trait Provider: Send + Sync {
    fn name(&self) -> &str;
    fn capabilities(&self) -> ProviderCapabilities;

    /// Perform a chat completion (synchronous in WASM context, callback-based).
    fn chat(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[ToolSpec]>,
        options: &ChatOptions,
    ) -> Result<ChatResponse, ProviderError>;

    /// Embed text into a vector.
    fn embed(&self, _text: &str) -> Result<Vec<f32>, ProviderError> {
        Err(ProviderError::Unsupported("embeddings".to_string()))
    }

    /// Estimate token count for text.
    fn token_count(&self, text: &str) -> usize {
        // Rough estimate: ~4 chars per token
        text.len() / 4
    }
}

/// Errors from provider operations.
#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("provider request failed: {0}")]
    RequestFailed(String),
    #[error("provider returned invalid response: {0}")]
    InvalidResponse(String),
    #[error("provider rate limited")]
    RateLimited,
    #[error("provider authentication failed")]
    AuthenticationFailed,
    #[error("feature not supported: {0}")]
    Unsupported(String),
    #[error("provider timeout")]
    Timeout,
    #[error("provider call pending (async trampoline)")]
    Pending,
}

/// A serialized provider request for the host to execute.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderRequest {
    pub messages: Vec<ChatMessage>,
    pub tools: Option<Vec<ToolSpec>>,
    pub options: ChatOptions,
}

/// Reliability wrapper that provides fallback and retry logic.
pub struct ReliableProvider {
    pub primary: Box<dyn Provider>,
    pub fallbacks: Vec<Box<dyn Provider>>,
    pub max_retries: u32,
}

impl ReliableProvider {
    pub fn new(primary: Box<dyn Provider>) -> Self {
        Self {
            primary,
            fallbacks: Vec::new(),
            max_retries: 3,
        }
    }

    pub fn with_fallback(mut self, provider: Box<dyn Provider>) -> Self {
        self.fallbacks.push(provider);
        self
    }

    pub fn with_retries(mut self, max_retries: u32) -> Self {
        self.max_retries = max_retries;
        self
    }
}

impl Provider for ReliableProvider {
    fn name(&self) -> &str {
        self.primary.name()
    }

    fn capabilities(&self) -> ProviderCapabilities {
        self.primary.capabilities()
    }

    fn chat(
        &self,
        messages: &[ChatMessage],
        tools: Option<&[ToolSpec]>,
        options: &ChatOptions,
    ) -> Result<ChatResponse, ProviderError> {
        // Try primary with retries
        let mut last_err = None;
        for _ in 0..self.max_retries {
            match self.primary.chat(messages, tools, options) {
                Ok(response) => return Ok(response),
                Err(ProviderError::RateLimited) => {
                    last_err = Some(ProviderError::RateLimited);
                    // In real impl, would sleep with backoff here
                    continue;
                }
                Err(e) => {
                    last_err = Some(e);
                    break;
                }
            }
        }

        // Try fallbacks
        for fallback in &self.fallbacks {
            match fallback.chat(messages, tools, options) {
                Ok(response) => return Ok(response),
                Err(e) => {
                    last_err = Some(e);
                    continue;
                }
            }
        }

        Err(last_err.unwrap_or(ProviderError::RequestFailed(
            "all providers failed".to_string(),
        )))
    }

    fn embed(&self, text: &str) -> Result<Vec<f32>, ProviderError> {
        self.primary.embed(text)
    }

    fn token_count(&self, text: &str) -> usize {
        self.primary.token_count(text)
    }
}

/// Cost tracking for provider usage.
#[derive(Debug, Clone, Default)]
pub struct CostTracker {
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cost_cents: f64,
    pub daily_cost_cents: f64,
    pub daily_limit_cents: Option<f64>,
}

impl CostTracker {
    pub fn record(&mut self, usage: &TokenUsage, cost_per_input_token: f64, cost_per_output_token: f64) {
        self.total_input_tokens += usage.input_tokens as u64;
        self.total_output_tokens += usage.output_tokens as u64;
        let cost = (usage.input_tokens as f64 * cost_per_input_token)
            + (usage.output_tokens as f64 * cost_per_output_token);
        self.total_cost_cents += cost;
        self.daily_cost_cents += cost;
    }

    pub fn is_over_daily_limit(&self) -> bool {
        self.daily_limit_cents
            .map(|limit| self.daily_cost_cents >= limit)
            .unwrap_or(false)
    }

    pub fn reset_daily(&mut self) {
        self.daily_cost_cents = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chat_message_constructors() {
        let sys = ChatMessage::system("You are helpful");
        assert_eq!(sys.role, Role::System);
        assert_eq!(sys.content, "You are helpful");
        assert!(sys.tool_call_id.is_none());

        let user = ChatMessage::user("Hello");
        assert_eq!(user.role, Role::User);

        let asst = ChatMessage::assistant("Hi there");
        assert_eq!(asst.role, Role::Assistant);

        let tool = ChatMessage::tool_result("call_123", "result data");
        assert_eq!(tool.role, Role::Tool);
        assert_eq!(tool.tool_call_id.as_deref(), Some("call_123"));
    }

    #[test]
    fn test_token_usage() {
        let usage = TokenUsage {
            input_tokens: 100,
            output_tokens: 50,
        };
        assert_eq!(usage.total(), 150);
    }

    #[test]
    fn test_chat_options_default() {
        let opts = ChatOptions::default();
        assert_eq!(opts.model, "default");
        assert_eq!(opts.temperature, Some(0.7));
        assert!(opts.max_tokens.is_none());
    }

    #[test]
    fn test_provider_capabilities_default() {
        let caps = ProviderCapabilities::default();
        assert!(!caps.native_tool_calling);
        assert!(!caps.vision);
        assert!(!caps.streaming);
        assert!(!caps.embeddings);
    }

    #[test]
    fn test_chat_message_serialization() {
        let msg = ChatMessage::user("Hello world");
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: ChatMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.role, Role::User);
        assert_eq!(parsed.content, "Hello world");
    }

    #[test]
    fn test_tool_call_serialization() {
        let call = ToolCall {
            id: "tc_1".to_string(),
            name: "file_read".to_string(),
            arguments: r#"{"path": "/workspace/test.md"}"#.to_string(),
        };
        let json = serde_json::to_string(&call).unwrap();
        let parsed: ToolCall = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "file_read");
    }

    #[test]
    fn test_cost_tracker() {
        let mut tracker = CostTracker::default();
        tracker.daily_limit_cents = Some(500.0);

        let usage = TokenUsage {
            input_tokens: 1000,
            output_tokens: 500,
        };
        // $0.01 per 1K input, $0.03 per 1K output (in cents: 1.0 and 3.0 per 1K)
        tracker.record(&usage, 0.001, 0.003);
        assert_eq!(tracker.total_input_tokens, 1000);
        assert_eq!(tracker.total_output_tokens, 500);
        assert!((tracker.total_cost_cents - 2.5).abs() < 0.001);
        assert!(!tracker.is_over_daily_limit());

        tracker.reset_daily();
        assert_eq!(tracker.daily_cost_cents, 0.0);
    }

    #[test]
    fn test_cost_tracker_over_limit() {
        let mut tracker = CostTracker::default();
        tracker.daily_limit_cents = Some(1.0);
        tracker.daily_cost_cents = 1.5;
        assert!(tracker.is_over_daily_limit());
    }

    #[test]
    fn test_reliable_provider_primary_succeeds() {
        let primary = MockProvider::new("primary").with_response(ChatResponse {
            content: "Hello!".to_string(),
            tool_calls: vec![],
            usage: TokenUsage::default(),
            model: "test".to_string(),
            reasoning_content: None,
        });

        let reliable = ReliableProvider::new(Box::new(primary));
        let result = reliable.chat(&[ChatMessage::user("Hi")], None, &ChatOptions::default());
        assert!(result.is_ok());
        assert_eq!(result.unwrap().content, "Hello!");
    }

    #[test]
    fn test_reliable_provider_falls_back() {
        let primary = MockProvider::new("primary"); // No responses = will fail
        let fallback = MockProvider::new("fallback").with_response(ChatResponse {
            content: "Fallback here".to_string(),
            tool_calls: vec![],
            usage: TokenUsage::default(),
            model: "fallback-model".to_string(),
            reasoning_content: None,
        });

        let reliable = ReliableProvider::new(Box::new(primary))
            .with_fallback(Box::new(fallback))
            .with_retries(1);

        let result = reliable.chat(&[ChatMessage::user("Hi")], None, &ChatOptions::default());
        assert!(result.is_ok());
        assert_eq!(result.unwrap().content, "Fallback here");
    }

    #[test]
    fn test_reliable_provider_all_fail() {
        let primary = MockProvider::new("primary");
        let reliable = ReliableProvider::new(Box::new(primary)).with_retries(1);
        let result = reliable.chat(&[ChatMessage::user("Hi")], None, &ChatOptions::default());
        assert!(result.is_err());
    }

    #[test]
    fn test_content_part_serialization() {
        let text = ContentPart::Text { text: "hello".to_string() };
        let json = serde_json::to_string(&text).unwrap();
        assert!(json.contains("\"type\":\"text\""));

        let img = ContentPart::ImageUrl { url: "https://example.com/img.png".to_string() };
        let json = serde_json::to_string(&img).unwrap();
        assert!(json.contains("\"type\":\"image_url\""));
    }

    #[test]
    fn test_role_serialization() {
        let json = serde_json::to_string(&Role::System).unwrap();
        assert_eq!(json, "\"system\"");
        let json = serde_json::to_string(&Role::User).unwrap();
        assert_eq!(json, "\"user\"");
        let json = serde_json::to_string(&Role::Assistant).unwrap();
        assert_eq!(json, "\"assistant\"");
        let json = serde_json::to_string(&Role::Tool).unwrap();
        assert_eq!(json, "\"tool\"");
    }

    #[test]
    fn test_default_token_count() {
        let provider = MockProvider::new("test");
        // "Hello world" = 11 chars, ~2 tokens at 4 chars/token
        assert_eq!(provider.token_count("Hello world"), 2);
        // Empty string
        assert_eq!(provider.token_count(""), 0);
    }
}
