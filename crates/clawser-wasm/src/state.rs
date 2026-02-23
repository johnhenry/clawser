//! Global WASM state — singleton runtime holding the agent, memory, scheduler, etc.
//!
//! WASM is single-threaded, so we use a raw pointer to avoid Rust 2024's
//! `static_mut_refs` restrictions. Access is always safe in single-threaded WASM.

use clawser_core::agent::Agent;
use clawser_core::checkpoint::CheckpointManager;
use clawser_core::config::AgentConfig;
use clawser_core::memory::InMemoryBackend;
use clawser_core::scheduler::Scheduler;
use clawser_core::tools::ToolRegistry;

/// The complete runtime state.
pub struct Runtime {
    pub agent: Agent,
    pub memory: InMemoryBackend,
    pub scheduler: Scheduler,
    pub tools: ToolRegistry,
    pub checkpoint_mgr: CheckpointManager,
    /// JSON buffer for the last result (response text, provider request, etc.)
    pub result_buffer: String,
}

/// Raw pointer to the heap-allocated runtime. WASM is single-threaded so this is safe.
static mut RT_PTR: *mut Runtime = std::ptr::null_mut();

/// Initialize the global runtime. Replaces any existing runtime.
pub fn init(config: AgentConfig) {
    let rt = Box::new(Runtime {
        agent: Agent::new(config),
        memory: InMemoryBackend::new(),
        scheduler: Scheduler::new(),
        tools: ToolRegistry::new(),
        checkpoint_mgr: CheckpointManager::new(20),
        result_buffer: String::new(),
    });
    unsafe {
        // Drop previous runtime if any
        if !RT_PTR.is_null() {
            drop(Box::from_raw(RT_PTR));
        }
        RT_PTR = Box::into_raw(rt);
    }
}

/// Get a mutable reference to the runtime. Panics if not initialized.
pub fn get() -> &'static mut Runtime {
    unsafe {
        if RT_PTR.is_null() {
            panic!("clawser runtime not initialized — call clawser_init first");
        }
        &mut *RT_PTR
    }
}
