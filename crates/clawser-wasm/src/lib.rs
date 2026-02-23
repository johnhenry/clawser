mod host;
mod state;

use clawser_core::agent::StepResult;
use clawser_core::checkpoint::Checkpoint;
use clawser_core::config::Config;
use clawser_core::memory::{Memory, MemoryEntry, RecallOptions};
use clawser_core::providers::{
    ChatMessage, ChatOptions, ChatResponse, Provider, ProviderCapabilities, ProviderError,
};
use clawser_core::tools::{ToolResult, ToolSpec};

// ── HostProvider ─────────────────────────────────────────────────────
// A Provider implementation that always returns Err(Pending), signaling
// the host must execute the LLM call and deliver the response back.

struct HostProvider;

impl Provider for HostProvider {
    fn name(&self) -> &str {
        "host"
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            native_tool_calling: true,
            vision: false,
            streaming: true,
            embeddings: false,
        }
    }

    fn chat(
        &self,
        _messages: &[ChatMessage],
        _tools: Option<&[ToolSpec]>,
        _options: &ChatOptions,
    ) -> Result<ChatResponse, ProviderError> {
        // Signal the agent loop to yield to the host.
        Err(ProviderError::Pending)
    }
}

static HOST_PROVIDER: HostProvider = HostProvider;

// ── Helper: read string from WASM memory ─────────────────────────────

fn read_str(ptr: *const u8, len: u32) -> Option<&'static str> {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len as usize) };
    std::str::from_utf8(bytes).ok()
}

fn write_to_buffer(s: &str, out_ptr: *mut u8, max_len: u32) -> u32 {
    let bytes = s.as_bytes();
    let copy_len = bytes.len().min(max_len as usize);
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), out_ptr, copy_len);
    }
    copy_len as u32
}

// ── LIFECYCLE EXPORTS ────────────────────────────────────────────────

/// Initialize the Clawser runtime with a JSON config.
/// Returns 0 on success, negative on error.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_init(config_ptr: *const u8, config_len: u32) -> i32 {
    let config_str = match read_str(config_ptr, config_len) {
        Some(s) => s,
        None => return -1,
    };

    let config = match Config::from_json(config_str) {
        Ok(c) => c,
        Err(_) => return -2,
    };

    if let Err(_) = config.validate() {
        return -3;
    }

    // Initialize the global runtime with agent config
    state::init(config.agent);

    host::log(2, "clawser: runtime initialized");
    0
}

// ── MEMORY MANAGEMENT ────────────────────────────────────────────────

/// Allocate memory in WASM linear memory (for host to write into).
#[unsafe(no_mangle)]
pub extern "C" fn clawser_alloc(size: u32) -> *mut u8 {
    let layout = std::alloc::Layout::from_size_align(size as usize, 1).unwrap();
    unsafe { std::alloc::alloc(layout) }
}

/// Deallocate memory in WASM linear memory.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_dealloc(ptr: *mut u8, size: u32) {
    let layout = std::alloc::Layout::from_size_align(size as usize, 1).unwrap();
    unsafe { std::alloc::dealloc(ptr, layout) }
}

// ── AGENT CONTROL ────────────────────────────────────────────────────

/// Send a user message to the agent.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_on_message(msg_ptr: *const u8, msg_len: u32) {
    let msg = match read_str(msg_ptr, msg_len) {
        Some(s) => s,
        None => return,
    };

    let rt = state::get();
    rt.agent.on_message(msg);
    host::emit_event("agent.message", msg);
}

/// Set the agent's system prompt.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_set_system_prompt(prompt_ptr: *const u8, prompt_len: u32) {
    let prompt = match read_str(prompt_ptr, prompt_len) {
        Some(s) => s,
        None => return,
    };
    let rt = state::get();
    rt.agent.set_system_prompt(prompt);
}

/// Run one step of the agent loop.
/// Returns: 0=idle, 1=has response, 2=has tool calls, 3=needs provider (LLM call), -1=error
#[unsafe(no_mangle)]
pub extern "C" fn clawser_step() -> i32 {
    let rt = state::get();
    let result = rt.agent.step(&HOST_PROVIDER, &rt.tools);

    match result {
        StepResult::Idle => 0,
        StepResult::Response(text) => {
            host::emit_event("agent.response", &text);
            rt.result_buffer = text;
            1
        }
        StepResult::ToolCalls(calls) => {
            let json = serde_json::to_string(&calls).unwrap_or_default();
            rt.result_buffer = json;
            2
        }
        StepResult::NeedsProvider(request) => {
            let json = serde_json::to_string(&request).unwrap_or_default();
            host::emit_event("agent.needs_provider", &json);
            rt.result_buffer = json;
            3
        }
        StepResult::Error(e) => {
            let msg = format!("{e}");
            host::emit_event("agent.error", &msg);
            rt.result_buffer = msg;
            -1
        }
    }
}

/// Read the result buffer from the last step (response text, tool calls JSON, provider request JSON, or error).
#[unsafe(no_mangle)]
pub extern "C" fn clawser_get_result(out_ptr: *mut u8, max_len: u32) -> u32 {
    let rt = state::get();
    write_to_buffer(&rt.result_buffer, out_ptr, max_len)
}

/// Deliver an LLM response from the host (completes the async trampoline).
/// Returns: 0=idle, 1=has response, 2=has tool calls, -1=error
#[unsafe(no_mangle)]
pub extern "C" fn clawser_deliver_provider_response(resp_ptr: *const u8, resp_len: u32) -> i32 {
    let json = match read_str(resp_ptr, resp_len) {
        Some(s) => s,
        None => return -1,
    };

    let response: ChatResponse = match serde_json::from_str(json) {
        Ok(r) => r,
        Err(_) => return -1,
    };

    let rt = state::get();
    let result = rt.agent.deliver_provider_response(response);

    match result {
        StepResult::Idle => 0,
        StepResult::Response(text) => {
            host::emit_event("agent.response", &text);
            rt.result_buffer = text;
            1
        }
        StepResult::ToolCalls(calls) => {
            let json = serde_json::to_string(&calls).unwrap_or_default();
            rt.result_buffer = json;
            2
        }
        StepResult::NeedsProvider(_) => 3,
        StepResult::Error(e) => {
            rt.result_buffer = format!("{e}");
            -1
        }
    }
}

/// Execute pending tool calls using the internal tool registry.
/// Only executes non-external tools. External tools should be handled by the host.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_execute_tools() {
    let rt = state::get();
    rt.agent.execute_tools(&rt.tools);
}

/// Register an external tool spec (for tools that execute in the JS host).
/// Input is JSON-encoded ToolSpec. Returns 0 on success, -1 on error.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_register_tool_spec(json_ptr: *const u8, json_len: u32) -> i32 {
    let json = match read_str(json_ptr, json_len) {
        Some(s) => s,
        None => return -1,
    };

    let spec: ToolSpec = match serde_json::from_str(json) {
        Ok(s) => s,
        Err(_) => return -1,
    };

    let rt = state::get();
    host::log(2, &format!("clawser: registered external tool '{}'", spec.name));
    rt.tools.register_external(spec);
    0
}

/// Deliver a single external tool result.
/// call_id is the tool call ID, result_json is a JSON-encoded ToolResult.
/// Returns 0 on success, -1 on error.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_deliver_tool_result(
    id_ptr: *const u8,
    id_len: u32,
    result_ptr: *const u8,
    result_len: u32,
) -> i32 {
    let id = match read_str(id_ptr, id_len) {
        Some(s) => s,
        None => return -1,
    };

    let result_json = match read_str(result_ptr, result_len) {
        Some(s) => s,
        None => return -1,
    };

    let result: ToolResult = match serde_json::from_str(result_json) {
        Ok(r) => r,
        Err(_) => return -1,
    };

    let rt = state::get();
    rt.agent
        .deliver_tool_results(vec![(id.to_string(), result)]);
    0
}

/// Check if a tool is external (should be executed by host, not WASM).
/// Returns 1 if external, 0 if internal, -1 on error.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_is_tool_external(name_ptr: *const u8, name_len: u32) -> i32 {
    let name = match read_str(name_ptr, name_len) {
        Some(s) => s,
        None => return -1,
    };

    let rt = state::get();
    if rt.tools.is_external(name) {
        1
    } else {
        0
    }
}

// ── GOALS ────────────────────────────────────────────────────────────

/// Add a goal. Returns the length of the goal ID written to out_ptr.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_add_goal(
    desc_ptr: *const u8,
    desc_len: u32,
    out_ptr: *mut u8,
    max_len: u32,
) -> u32 {
    let desc = match read_str(desc_ptr, desc_len) {
        Some(s) => s,
        None => return 0,
    };

    let now = host::now_ms() as i64;
    let rt = state::get();
    let id = rt.agent.add_goal(desc, now);
    host::emit_event("agent.goal.started", &id);
    write_to_buffer(&id, out_ptr, max_len)
}

/// Complete a goal by ID. Returns 1 if found, 0 if not.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_complete_goal(id_ptr: *const u8, id_len: u32) -> i32 {
    let id = match read_str(id_ptr, id_len) {
        Some(s) => s,
        None => return 0,
    };

    let now = host::now_ms() as i64;
    let rt = state::get();
    if rt.agent.complete_goal(id, now) {
        host::emit_event("agent.goal.completed", id);
        1
    } else {
        0
    }
}

// ── SCHEDULER ────────────────────────────────────────────────────────

/// Tick the scheduler. Returns the number of fired jobs.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_tick(now_ms: f64) -> i32 {
    let rt = state::get();
    let actions = rt.scheduler.tick(now_ms as i64);
    let count = actions.len() as i32;

    // Process agent prompt actions
    for (_job_id, action) in actions {
        if let clawser_core::scheduler::JobAction::AgentPrompt { prompt } = action {
            rt.agent.on_message(&prompt);
            host::emit_event("scheduler.fired", &prompt);
        }
    }

    count
}

// ── MEMORY ───────────────────────────────────────────────────────────

/// Store a memory entry. Input is JSON-encoded MemoryEntry. Returns ID length written.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_memory_store(
    json_ptr: *const u8,
    json_len: u32,
    out_ptr: *mut u8,
    max_len: u32,
) -> u32 {
    let json = match read_str(json_ptr, json_len) {
        Some(s) => s,
        None => return 0,
    };

    let entry: MemoryEntry = match serde_json::from_str(json) {
        Ok(e) => e,
        Err(_) => return 0,
    };

    let rt = state::get();
    match rt.memory.store(entry) {
        Ok(id) => write_to_buffer(&id, out_ptr, max_len),
        Err(_) => 0,
    }
}

/// Recall memories by query. Empty query returns all. Returns JSON array length written to out_ptr.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_memory_recall(
    query_ptr: *const u8,
    query_len: u32,
    out_ptr: *mut u8,
    max_len: u32,
) -> u32 {
    let query = match read_str(query_ptr, query_len) {
        Some(s) => s,
        None => return 0,
    };

    let rt = state::get();
    // Use higher limit for empty queries (list all) vs search queries
    let limit = if query.trim().is_empty() { 1000 } else { 20 };
    match rt.memory.recall(query, &RecallOptions::new().with_limit(limit)) {
        Ok(entries) => {
            let json = serde_json::to_string(&entries).unwrap_or_else(|_| "[]".to_string());
            write_to_buffer(&json, out_ptr, max_len)
        }
        Err(_) => 0,
    }
}

/// Delete a memory entry by ID. Returns 1=deleted, 0=not found, -1=error.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_memory_forget(id_ptr: *const u8, id_len: u32) -> i32 {
    let id = match read_str(id_ptr, id_len) {
        Some(s) => s,
        None => return -1,
    };

    let rt = state::get();
    match rt.memory.forget(id) {
        Ok(true) => 1,
        Ok(false) => 0,
        Err(_) => -1,
    }
}

// ── CHECKPOINT ───────────────────────────────────────────────────────

/// Serialize agent state to a checkpoint. Returns bytes written to out_ptr.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_checkpoint(out_ptr: *mut u8, max_len: u32) -> u32 {
    let rt = state::get();
    let now = host::now_ms() as i64;
    let mut ckpt = Checkpoint::new(rt.checkpoint_mgr.next_id(), now);
    ckpt.session_history = rt.agent.history.clone();
    ckpt.active_goals = rt.agent.goals.clone();

    match ckpt.to_bytes() {
        Ok(bytes) => {
            let copy_len = bytes.len().min(max_len as usize);
            unsafe {
                std::ptr::copy_nonoverlapping(bytes.as_ptr(), out_ptr, copy_len);
            }
            host::emit_event("checkpoint.saved", &ckpt.id);
            copy_len as u32
        }
        Err(_) => 0,
    }
}

/// Restore agent state from a checkpoint. Returns 0 on success.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_restore(data_ptr: *const u8, data_len: u32) -> i32 {
    let bytes = unsafe { std::slice::from_raw_parts(data_ptr, data_len as usize) };

    let ckpt = match Checkpoint::from_bytes(bytes) {
        Ok(c) => c,
        Err(_) => return -1,
    };

    let rt = state::get();
    rt.agent.history = ckpt.session_history;
    rt.agent.goals = ckpt.active_goals;
    host::emit_event("checkpoint.restored", &ckpt.id);
    0
}

// ── QUERY ────────────────────────────────────────────────────────────

/// Get the agent's current state as a JSON string. Returns bytes written.
#[unsafe(no_mangle)]
pub extern "C" fn clawser_get_state(out_ptr: *mut u8, max_len: u32) -> u32 {
    let rt = state::get();
    let state = serde_json::json!({
        "agent_state": format!("{:?}", rt.agent.state),
        "history_len": rt.agent.history.len(),
        "goals": rt.agent.goals,
        "memory_count": rt.memory.count(None).unwrap_or(0),
        "scheduler_jobs": rt.scheduler.active_count(),
    });
    let json = state.to_string();
    write_to_buffer(&json, out_ptr, max_len)
}

// ── TESTS ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clawser_init_valid_config() {
        let config = b"{}";
        let result = clawser_init(config.as_ptr(), config.len() as u32);
        assert_eq!(result, 0);
    }

    #[test]
    fn test_clawser_init_invalid_json() {
        let config = b"not json";
        let result = clawser_init(config.as_ptr(), config.len() as u32);
        assert_eq!(result, -2);
    }

    #[test]
    fn test_clawser_init_invalid_utf8() {
        let config: &[u8] = &[0xFF, 0xFE];
        let result = clawser_init(config.as_ptr(), config.len() as u32);
        assert_eq!(result, -1);
    }

    #[test]
    fn test_clawser_alloc_dealloc() {
        let ptr = clawser_alloc(1024);
        assert!(!ptr.is_null());
        unsafe {
            std::ptr::write(ptr, 42u8);
            assert_eq!(std::ptr::read(ptr), 42u8);
        }
        clawser_dealloc(ptr, 1024);
    }
}
