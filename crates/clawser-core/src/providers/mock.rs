use std::cell::RefCell;

use super::*;

/// A mock provider for testing. Returns pre-configured responses in order.
pub struct MockProvider {
    name: String,
    responses: RefCell<Vec<ChatResponse>>,
    capabilities: ProviderCapabilities,
}

impl MockProvider {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            responses: RefCell::new(Vec::new()),
            capabilities: ProviderCapabilities {
                native_tool_calling: true,
                vision: false,
                streaming: false,
                embeddings: false,
            },
        }
    }

    pub fn with_response(self, response: ChatResponse) -> Self {
        self.responses.borrow_mut().push(response);
        self
    }

    pub fn with_responses(self, responses: Vec<ChatResponse>) -> Self {
        *self.responses.borrow_mut() = responses;
        self
    }

    pub fn with_capabilities(mut self, capabilities: ProviderCapabilities) -> Self {
        self.capabilities = capabilities;
        self
    }

    pub fn remaining_responses(&self) -> usize {
        self.responses.borrow().len()
    }
}

impl Provider for MockProvider {
    fn name(&self) -> &str {
        &self.name
    }

    fn capabilities(&self) -> ProviderCapabilities {
        self.capabilities.clone()
    }

    fn chat(
        &self,
        _messages: &[ChatMessage],
        _tools: Option<&[ToolSpec]>,
        _options: &ChatOptions,
    ) -> Result<ChatResponse, ProviderError> {
        let mut responses = self.responses.borrow_mut();
        if responses.is_empty() {
            return Err(ProviderError::RequestFailed(
                "no mock responses remaining".to_string(),
            ));
        }
        Ok(responses.remove(0))
    }
}

// MockProvider uses RefCell which is not Sync, but in single-threaded WASM that's fine.
// For test purposes we implement Send+Sync unsafely since tests are single-threaded.
unsafe impl Send for MockProvider {}
unsafe impl Sync for MockProvider {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mock_provider_returns_responses_in_order() {
        let provider = MockProvider::new("test")
            .with_response(ChatResponse {
                content: "First".to_string(),
                tool_calls: vec![],
                usage: TokenUsage::default(),
                model: "mock".to_string(),
                reasoning_content: None,
            })
            .with_response(ChatResponse {
                content: "Second".to_string(),
                tool_calls: vec![],
                usage: TokenUsage::default(),
                model: "mock".to_string(),
                reasoning_content: None,
            });

        let opts = ChatOptions::default();
        let msgs = [ChatMessage::user("test")];

        let r1 = provider.chat(&msgs, None, &opts).unwrap();
        assert_eq!(r1.content, "First");

        let r2 = provider.chat(&msgs, None, &opts).unwrap();
        assert_eq!(r2.content, "Second");
    }

    #[test]
    fn test_mock_provider_empty_returns_error() {
        let provider = MockProvider::new("test");
        let result = provider.chat(
            &[ChatMessage::user("test")],
            None,
            &ChatOptions::default(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_mock_provider_remaining_count() {
        let provider = MockProvider::new("test")
            .with_response(ChatResponse {
                content: "a".to_string(),
                tool_calls: vec![],
                usage: TokenUsage::default(),
                model: "m".to_string(),
                reasoning_content: None,
            });
        assert_eq!(provider.remaining_responses(), 1);
        let _ = provider.chat(&[ChatMessage::user("x")], None, &ChatOptions::default());
        assert_eq!(provider.remaining_responses(), 0);
    }

    #[test]
    fn test_mock_provider_with_tool_calls() {
        let provider = MockProvider::new("test").with_response(ChatResponse {
            content: String::new(),
            tool_calls: vec![ToolCall {
                id: "tc_1".to_string(),
                name: "file_read".to_string(),
                arguments: r#"{"path": "/test.md"}"#.to_string(),
            }],
            usage: TokenUsage {
                input_tokens: 10,
                output_tokens: 5,
            },
            model: "mock".to_string(),
            reasoning_content: None,
        });

        let result = provider
            .chat(&[ChatMessage::user("read a file")], None, &ChatOptions::default())
            .unwrap();
        assert!(result.content.is_empty());
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].name, "file_read");
    }
}
