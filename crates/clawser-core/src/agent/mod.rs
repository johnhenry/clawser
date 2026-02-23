use serde::{Deserialize, Serialize};

use crate::config::AgentConfig;
use crate::providers::{
    ChatMessage, ChatOptions, ChatResponse, Provider, ProviderError, ProviderRequest, Role,
    ToolCall,
};
use crate::tools::{ToolContext, ToolRegistry, ToolResult};

/// Current state of the agent state machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentState {
    Idle,
    Thinking,
    Parsing,
    Executing,
    Checkpointing,
    Responding,
    /// Waiting for host to deliver an LLM response (async trampoline).
    WaitingForProvider,
}

/// Status of a goal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GoalStatus {
    Active,
    Paused,
    Completed,
    Failed,
}

/// A user-defined goal the agent works toward.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Goal {
    pub id: String,
    pub description: String,
    pub status: GoalStatus,
    pub created_at: i64,
    pub updated_at: i64,
    pub sub_goals: Vec<String>,
    pub artifacts: Vec<String>,
}

impl Goal {
    pub fn new(id: impl Into<String>, description: impl Into<String>, now: i64) -> Self {
        Self {
            id: id.into(),
            description: description.into(),
            status: GoalStatus::Active,
            created_at: now,
            updated_at: now,
            sub_goals: Vec::new(),
            artifacts: Vec::new(),
        }
    }

    pub fn complete(&mut self, now: i64) {
        self.status = GoalStatus::Completed;
        self.updated_at = now;
    }

    pub fn fail(&mut self, now: i64) {
        self.status = GoalStatus::Failed;
        self.updated_at = now;
    }

    pub fn pause(&mut self, now: i64) {
        self.status = GoalStatus::Paused;
        self.updated_at = now;
    }

    pub fn is_active(&self) -> bool {
        self.status == GoalStatus::Active
    }
}

/// Result of one agent step.
#[derive(Debug)]
pub enum StepResult {
    /// Agent produced a text response.
    Response(String),
    /// Agent wants to call tools.
    ToolCalls(Vec<ToolCall>),
    /// Agent is idle (no pending work).
    Idle,
    /// Agent encountered an error.
    Error(AgentError),
    /// Agent needs the host to execute an LLM request (async trampoline).
    /// The host should call `deliver_provider_response()` then `step()` again.
    NeedsProvider(ProviderRequest),
}

/// Errors from agent operations.
#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("provider error: {0}")]
    Provider(#[from] ProviderError),
    #[error("tool iteration limit reached ({0})")]
    ToolIterationLimit(u32),
    #[error("context window overflow")]
    ContextOverflow,
    #[error("no provider configured")]
    NoProvider,
    #[error("agent error: {0}")]
    Other(String),
}

/// The core agent that coordinates provider, memory, and tools.
pub struct Agent {
    pub state: AgentState,
    pub history: Vec<ChatMessage>,
    pub goals: Vec<Goal>,
    pub config: AgentConfig,
    tool_iteration_count: u32,
    pending_tool_calls: Vec<ToolCall>,
    pending_tool_results: Vec<(String, ToolResult)>,
}

impl Agent {
    pub fn new(config: AgentConfig) -> Self {
        Self {
            state: AgentState::Idle,
            history: Vec::new(),
            goals: Vec::new(),
            config,
            tool_iteration_count: 0,
            pending_tool_calls: Vec::new(),
            pending_tool_results: Vec::new(),
        }
    }

    /// Add a user message and transition to Thinking state.
    pub fn on_message(&mut self, content: &str) {
        self.history.push(ChatMessage::user(content));
        self.state = AgentState::Thinking;
        self.tool_iteration_count = 0;
    }

    /// Set a system prompt.
    pub fn set_system_prompt(&mut self, prompt: &str) {
        // Remove existing system message if present
        self.history.retain(|m| m.role != Role::System);
        // Insert at beginning
        self.history.insert(0, ChatMessage::system(prompt));
    }

    /// Run one step of the agent loop.
    pub fn step(
        &mut self,
        provider: &dyn Provider,
        tools: &ToolRegistry,
    ) -> StepResult {
        match self.state {
            AgentState::Idle => StepResult::Idle,

            AgentState::Thinking => {
                let tool_specs = if tools.is_empty() {
                    None
                } else {
                    Some(tools.list_specs())
                };

                let options = ChatOptions::default();
                let result = provider.chat(
                    &self.history,
                    tool_specs.as_deref(),
                    &options,
                );

                match result {
                    Ok(response) => {
                        self.state = AgentState::Parsing;
                        self.parse_response(response)
                    }
                    Err(ProviderError::Pending) => {
                        // Async trampoline: host must deliver the response later.
                        self.state = AgentState::WaitingForProvider;
                        StepResult::NeedsProvider(ProviderRequest {
                            messages: self.history.clone(),
                            tools: tool_specs.map(|s| s.to_vec()),
                            options,
                        })
                    }
                    Err(e) => {
                        self.state = AgentState::Idle;
                        StepResult::Error(AgentError::Provider(e))
                    }
                }
            }

            AgentState::WaitingForProvider => {
                // Still waiting — host hasn't delivered the response yet.
                StepResult::Idle
            }

            AgentState::Parsing => {
                // Should not normally be stepped in parsing state directly
                // This is handled within step when state is Thinking
                StepResult::Idle
            }

            AgentState::Executing => {
                if self.pending_tool_calls.is_empty() {
                    // All tools executed, feed results back
                    self.feed_tool_results();
                    self.state = AgentState::Thinking;
                    self.tool_iteration_count += 1;

                    if self.tool_iteration_count >= self.config.max_tool_iterations {
                        self.state = AgentState::Idle;
                        return StepResult::Error(AgentError::ToolIterationLimit(
                            self.config.max_tool_iterations,
                        ));
                    }

                    // Continue thinking
                    StepResult::ToolCalls(vec![]) // Signal that tools were processed
                } else {
                    let calls = self.pending_tool_calls.clone();
                    StepResult::ToolCalls(calls)
                }
            }

            AgentState::Checkpointing => {
                self.state = AgentState::Responding;
                StepResult::Idle
            }

            AgentState::Responding => {
                self.state = AgentState::Idle;
                StepResult::Idle
            }
        }
    }

    /// Execute pending tool calls using the registry.
    pub fn execute_tools(&mut self, tools: &ToolRegistry) {
        let calls: Vec<ToolCall> = self.pending_tool_calls.drain(..).collect();
        let context = ToolContext {
            workspace_path: "/workspace".to_string(),
            session_id: None,
        };

        for call in calls {
            let params: serde_json::Value =
                serde_json::from_str(&call.arguments).unwrap_or(serde_json::json!({}));

            let result = match tools.execute(&call.name, params, &context) {
                Ok(r) => r,
                Err(e) => ToolResult::failure(e.to_string()),
            };

            self.pending_tool_results.push((call.id.clone(), result));
        }
    }

    /// Feed tool results back into conversation history.
    fn feed_tool_results(&mut self) {
        let results: Vec<(String, ToolResult)> = self.pending_tool_results.drain(..).collect();
        for (call_id, result) in results {
            let content = if result.success {
                result.output
            } else {
                format!(
                    "Error: {}",
                    result.error.unwrap_or_else(|| "unknown error".to_string())
                )
            };
            self.history.push(ChatMessage::tool_result(call_id, content));
        }
    }

    /// Deliver externally-computed tool results (from JS browser tools or MCP).
    /// Pushes results and removes corresponding pending calls.
    /// After all results are delivered, the next step() will feed them to history.
    pub fn deliver_tool_results(&mut self, results: Vec<(String, ToolResult)>) {
        for (id, result) in results {
            self.pending_tool_calls.retain(|c| c.id != id);
            self.pending_tool_results.push((id, result));
        }
    }

    /// Parse a provider response into the appropriate next state.
    fn parse_response(&mut self, response: ChatResponse) -> StepResult {
        if !response.tool_calls.is_empty() {
            // Provider wants to call tools
            self.history.push(ChatMessage::assistant(&response.content));
            self.pending_tool_calls = response.tool_calls.clone();
            self.state = AgentState::Executing;
            StepResult::ToolCalls(response.tool_calls)
        } else {
            // Provider produced a text response
            self.history.push(ChatMessage::assistant(&response.content));
            self.state = AgentState::Idle;
            StepResult::Response(response.content)
        }
    }

    /// Deliver an LLM response from the host (async trampoline completion).
    /// Returns the StepResult from processing the response.
    pub fn deliver_provider_response(&mut self, response: ChatResponse) -> StepResult {
        if self.state != AgentState::WaitingForProvider {
            return StepResult::Error(AgentError::Other(
                "deliver_provider_response called but agent is not waiting".to_string(),
            ));
        }
        self.state = AgentState::Parsing;
        self.parse_response(response)
    }

    /// Add a goal.
    pub fn add_goal(&mut self, description: &str, now: i64) -> String {
        let id = format!("goal_{}", self.goals.len() + 1);
        let goal = Goal::new(&id, description, now);
        self.goals.push(goal);
        id
    }

    /// Complete a goal by ID.
    pub fn complete_goal(&mut self, id: &str, now: i64) -> bool {
        if let Some(goal) = self.goals.iter_mut().find(|g| g.id == id) {
            goal.complete(now);
            true
        } else {
            false
        }
    }

    /// Get active goals.
    pub fn active_goals(&self) -> Vec<&Goal> {
        self.goals.iter().filter(|g| g.is_active()).collect()
    }

    /// Get conversation history length.
    pub fn history_len(&self) -> usize {
        self.history.len()
    }

    /// Estimate total tokens in history.
    pub fn estimate_history_tokens(&self, provider: &dyn Provider) -> usize {
        self.history
            .iter()
            .map(|m| provider.token_count(&m.content))
            .sum()
    }

    /// Check if context window is approaching limit.
    pub fn needs_compaction(&self, provider: &dyn Provider) -> bool {
        let tokens = self.estimate_history_tokens(provider);
        tokens > (self.config.token_limit as usize * 4 / 5)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{MockProvider, TokenUsage};
    use crate::tools::{MockTool, ToolRegistry};

    fn default_agent() -> Agent {
        Agent::new(AgentConfig::default())
    }

    fn make_response(content: &str) -> ChatResponse {
        ChatResponse {
            content: content.to_string(),
            tool_calls: vec![],
            usage: TokenUsage::default(),
            model: "mock".to_string(),
            reasoning_content: None,
        }
    }

    fn make_tool_response(tool_calls: Vec<ToolCall>) -> ChatResponse {
        ChatResponse {
            content: String::new(),
            tool_calls,
            usage: TokenUsage::default(),
            model: "mock".to_string(),
            reasoning_content: None,
        }
    }

    #[test]
    fn test_agent_initial_state() {
        let agent = default_agent();
        assert_eq!(agent.state, AgentState::Idle);
        assert!(agent.history.is_empty());
        assert!(agent.goals.is_empty());
    }

    #[test]
    fn test_agent_on_message_transitions_to_thinking() {
        let mut agent = default_agent();
        agent.on_message("Hello");
        assert_eq!(agent.state, AgentState::Thinking);
        assert_eq!(agent.history.len(), 1);
        assert_eq!(agent.history[0].role, Role::User);
        assert_eq!(agent.history[0].content, "Hello");
    }

    #[test]
    fn test_agent_step_idle() {
        let mut agent = default_agent();
        let provider = MockProvider::new("test");
        let tools = ToolRegistry::new();
        let result = agent.step(&provider, &tools);
        assert!(matches!(result, StepResult::Idle));
    }

    #[test]
    fn test_agent_step_text_response() {
        let mut agent = default_agent();
        let provider = MockProvider::new("test").with_response(make_response("Hi there!"));
        let tools = ToolRegistry::new();

        agent.on_message("Hello");
        let result = agent.step(&provider, &tools);

        assert!(matches!(result, StepResult::Response(ref s) if s == "Hi there!"));
        assert_eq!(agent.state, AgentState::Idle);
        // History should have user + assistant messages
        assert_eq!(agent.history.len(), 2);
    }

    #[test]
    fn test_agent_step_tool_calls() {
        let mut agent = default_agent();
        let provider = MockProvider::new("test").with_response(make_tool_response(vec![
            ToolCall {
                id: "tc_1".to_string(),
                name: "file_read".to_string(),
                arguments: r#"{"path": "/test.md"}"#.to_string(),
            },
        ]));
        let tools = ToolRegistry::new();

        agent.on_message("Read a file");
        let result = agent.step(&provider, &tools);

        assert!(matches!(result, StepResult::ToolCalls(ref calls) if calls.len() == 1));
        assert_eq!(agent.state, AgentState::Executing);
    }

    #[test]
    fn test_agent_execute_tools() {
        let mut agent = default_agent();
        let provider = MockProvider::new("test").with_response(make_tool_response(vec![
            ToolCall {
                id: "tc_1".to_string(),
                name: "echo".to_string(),
                arguments: "{}".to_string(),
            },
        ]));

        let mut tools = ToolRegistry::new();
        tools.register(Box::new(MockTool::new(
            "echo",
            ToolResult::success("echoed"),
        )));

        agent.on_message("Echo something");
        agent.step(&provider, &tools);

        // Now execute the pending tools
        agent.execute_tools(&tools);

        // Pending tool calls should be drained
        assert!(agent.pending_tool_calls.is_empty());
        assert_eq!(agent.pending_tool_results.len(), 1);
    }

    #[test]
    fn test_agent_tool_iteration_limit() {
        let mut config = AgentConfig::default();
        config.max_tool_iterations = 2;
        let mut agent = Agent::new(config);

        // Simulate reaching the iteration limit
        agent.tool_iteration_count = 2;
        agent.state = AgentState::Executing;

        let provider = MockProvider::new("test");
        let tools = ToolRegistry::new();
        let result = agent.step(&provider, &tools);

        assert!(matches!(result, StepResult::Error(AgentError::ToolIterationLimit(2))));
    }

    #[test]
    fn test_agent_set_system_prompt() {
        let mut agent = default_agent();
        agent.set_system_prompt("You are helpful");
        assert_eq!(agent.history.len(), 1);
        assert_eq!(agent.history[0].role, Role::System);
        assert_eq!(agent.history[0].content, "You are helpful");

        // Setting again should replace
        agent.set_system_prompt("You are very helpful");
        assert_eq!(agent.history.len(), 1);
        assert_eq!(agent.history[0].content, "You are very helpful");
    }

    #[test]
    fn test_agent_goal_lifecycle() {
        let mut agent = default_agent();

        let id = agent.add_goal("Research topic X", 1000);
        assert_eq!(agent.goals.len(), 1);
        assert_eq!(agent.active_goals().len(), 1);

        assert!(agent.complete_goal(&id, 2000));
        assert_eq!(agent.active_goals().len(), 0);
        assert_eq!(agent.goals[0].status, GoalStatus::Completed);
    }

    #[test]
    fn test_agent_goal_not_found() {
        let mut agent = default_agent();
        assert!(!agent.complete_goal("nonexistent", 1000));
    }

    #[test]
    fn test_agent_multiple_goals() {
        let mut agent = default_agent();
        let g1 = agent.add_goal("Goal 1", 1000);
        let g2 = agent.add_goal("Goal 2", 1001);
        let _g3 = agent.add_goal("Goal 3", 1002);

        assert_eq!(agent.active_goals().len(), 3);

        agent.complete_goal(&g1, 2000);
        assert_eq!(agent.active_goals().len(), 2);

        if let Some(goal) = agent.goals.iter_mut().find(|g| g.id == g2) {
            goal.pause(2001);
        }
        assert_eq!(agent.active_goals().len(), 1);
    }

    #[test]
    fn test_goal_states() {
        let mut goal = Goal::new("g1", "Test", 100);
        assert!(goal.is_active());

        goal.pause(200);
        assert_eq!(goal.status, GoalStatus::Paused);
        assert!(!goal.is_active());

        goal.fail(300);
        assert_eq!(goal.status, GoalStatus::Failed);
    }

    #[test]
    fn test_agent_history_tracking() {
        let mut agent = default_agent();
        assert_eq!(agent.history_len(), 0);

        agent.set_system_prompt("sys");
        assert_eq!(agent.history_len(), 1);

        agent.on_message("hello");
        assert_eq!(agent.history_len(), 2);
    }

    #[test]
    fn test_agent_provider_error() {
        let mut agent = default_agent();
        let provider = MockProvider::new("test"); // No responses = error
        let tools = ToolRegistry::new();

        agent.on_message("Hello");
        let result = agent.step(&provider, &tools);
        assert!(matches!(result, StepResult::Error(AgentError::Provider(_))));
        assert_eq!(agent.state, AgentState::Idle);
    }

    #[test]
    fn test_agent_state_serialization() {
        let json = serde_json::to_string(&AgentState::Thinking).unwrap();
        let parsed: AgentState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, AgentState::Thinking);
    }

    #[test]
    fn test_goal_serialization() {
        let goal = Goal::new("g1", "Do something", 1000);
        let json = serde_json::to_string(&goal).unwrap();
        let parsed: Goal = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "g1");
        assert_eq!(parsed.status, GoalStatus::Active);
    }

    #[test]
    fn test_needs_compaction() {
        let mut config = AgentConfig::default();
        config.token_limit = 100; // Very low for testing
        let mut agent = Agent::new(config);

        let provider = MockProvider::new("test");
        assert!(!agent.needs_compaction(&provider));

        // Add enough messages to exceed 80% of 100 tokens
        for _ in 0..30 {
            agent.history.push(ChatMessage::user("This is a moderately long message for testing purposes"));
        }
        assert!(agent.needs_compaction(&provider));
    }
}
