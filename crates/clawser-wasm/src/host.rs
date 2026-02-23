//! Host imports — functions provided by the JS runtime to the WASM module.
//!
//! On wasm32 targets, these are real extern "C" imports from the host.
//! On native targets (for testing), they are no-op stubs.

#[cfg(target_arch = "wasm32")]
mod ffi {
    unsafe extern "C" {
        pub fn host_log(level: i32, msg_ptr: *const u8, msg_len: u32);
        pub fn host_now() -> f64;
        pub fn host_events_emit(
            topic_ptr: *const u8,
            topic_len: u32,
            payload_ptr: *const u8,
            payload_len: u32,
        );
    }
}

/// Safe wrapper: log a string at a given level.
pub fn log(level: i32, msg: &str) {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        ffi::host_log(level, msg.as_ptr(), msg.len() as u32);
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = (level, msg);
    }
}

/// Safe wrapper: get current time in ms.
pub fn now_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { ffi::host_now() }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        0.0
    }
}

/// Safe wrapper: emit an event.
pub fn emit_event(topic: &str, payload: &str) {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        ffi::host_events_emit(
            topic.as_ptr(),
            topic.len() as u32,
            payload.as_ptr(),
            payload.len() as u32,
        );
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = (topic, payload);
    }
}
