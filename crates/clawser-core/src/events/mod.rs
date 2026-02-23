use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// An event published on the event bus.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub topic: String,
    pub payload: serde_json::Value,
    pub timestamp: i64,
    pub source: String,
}

impl Event {
    pub fn new(
        topic: impl Into<String>,
        payload: serde_json::Value,
        timestamp: i64,
        source: impl Into<String>,
    ) -> Self {
        Self {
            topic: topic.into(),
            payload,
            timestamp,
            source: source.into(),
        }
    }
}

/// Type alias for subscription callback ID.
pub type SubscriptionId = u64;

/// A simple in-process event bus.
pub struct EventBus {
    subscriptions: HashMap<String, Vec<(SubscriptionId, Box<dyn Fn(&Event) + Send + Sync>)>>,
    history: Vec<Event>,
    history_limit: usize,
    next_sub_id: SubscriptionId,
}

impl EventBus {
    pub fn new(history_limit: usize) -> Self {
        Self {
            subscriptions: HashMap::new(),
            history: Vec::new(),
            history_limit,
            next_sub_id: 1,
        }
    }

    /// Subscribe to a topic. Returns a subscription ID for unsubscribing.
    pub fn subscribe(
        &mut self,
        topic: &str,
        callback: Box<dyn Fn(&Event) + Send + Sync>,
    ) -> SubscriptionId {
        let id = self.next_sub_id;
        self.next_sub_id += 1;

        self.subscriptions
            .entry(topic.to_string())
            .or_default()
            .push((id, callback));

        id
    }

    /// Unsubscribe by subscription ID. Returns true if found.
    pub fn unsubscribe(&mut self, sub_id: SubscriptionId) -> bool {
        for subs in self.subscriptions.values_mut() {
            let before = subs.len();
            subs.retain(|(id, _)| *id != sub_id);
            if subs.len() < before {
                return true;
            }
        }
        false
    }

    /// Emit an event to all subscribers of its topic.
    pub fn emit(&mut self, event: Event) {
        // Notify subscribers
        if let Some(subs) = self.subscriptions.get(&event.topic) {
            for (_, callback) in subs {
                callback(&event);
            }
        }

        // Store in history
        self.history.push(event);
        while self.history.len() > self.history_limit {
            self.history.remove(0);
        }
    }

    /// Get event history, optionally filtered by topic.
    pub fn history(&self, topic: Option<&str>) -> Vec<&Event> {
        match topic {
            Some(t) => self.history.iter().filter(|e| e.topic == t).collect(),
            None => self.history.iter().collect(),
        }
    }

    /// Count subscriptions for a topic.
    pub fn subscriber_count(&self, topic: &str) -> usize {
        self.subscriptions
            .get(topic)
            .map(|s| s.len())
            .unwrap_or(0)
    }

    /// Clear all event history.
    pub fn clear_history(&mut self) {
        self.history.clear();
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new(1000)
    }
}

// Well-known event topics
pub mod topics {
    pub const AGENT_STEP: &str = "agent.step";
    pub const AGENT_GOAL_STARTED: &str = "agent.goal.started";
    pub const AGENT_GOAL_COMPLETED: &str = "agent.goal.completed";
    pub const AGENT_GOAL_FAILED: &str = "agent.goal.failed";
    pub const TOOL_INVOKED: &str = "tool.invoked";
    pub const TOOL_COMPLETED: &str = "tool.completed";
    pub const MEMORY_STORED: &str = "memory.stored";
    pub const PROVIDER_REQUEST: &str = "provider.request";
    pub const PROVIDER_RESPONSE: &str = "provider.response";
    pub const CHECKPOINT_SAVED: &str = "checkpoint.saved";
    pub const SCHEDULE_FIRED: &str = "schedule.fired";
    pub const WORKSPACE_CHANGED: &str = "workspace.changed";
    pub const ERROR: &str = "error";
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    #[test]
    fn test_event_creation() {
        let event = Event::new(
            "test.topic",
            serde_json::json!({"key": "value"}),
            1000,
            "test",
        );
        assert_eq!(event.topic, "test.topic");
        assert_eq!(event.timestamp, 1000);
        assert_eq!(event.source, "test");
    }

    #[test]
    fn test_event_serialization() {
        let event = Event::new("t", serde_json::json!(42), 1000, "src");
        let json = serde_json::to_string(&event).unwrap();
        let parsed: Event = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.topic, "t");
    }

    #[test]
    fn test_event_bus_subscribe_and_emit() {
        let mut bus = EventBus::new(100);
        let counter = Arc::new(AtomicU32::new(0));
        let counter_clone = counter.clone();

        bus.subscribe(
            "test",
            Box::new(move |_| {
                counter_clone.fetch_add(1, Ordering::SeqCst);
            }),
        );

        bus.emit(Event::new("test", serde_json::json!(null), 1000, "src"));
        bus.emit(Event::new("test", serde_json::json!(null), 1001, "src"));
        bus.emit(Event::new("other", serde_json::json!(null), 1002, "src"));

        assert_eq!(counter.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn test_event_bus_unsubscribe() {
        let mut bus = EventBus::new(100);
        let counter = Arc::new(AtomicU32::new(0));
        let counter_clone = counter.clone();

        let sub_id = bus.subscribe(
            "test",
            Box::new(move |_| {
                counter_clone.fetch_add(1, Ordering::SeqCst);
            }),
        );

        bus.emit(Event::new("test", serde_json::json!(null), 1000, "src"));
        assert_eq!(counter.load(Ordering::SeqCst), 1);

        assert!(bus.unsubscribe(sub_id));
        bus.emit(Event::new("test", serde_json::json!(null), 1001, "src"));
        assert_eq!(counter.load(Ordering::SeqCst), 1); // No increment
    }

    #[test]
    fn test_event_bus_unsubscribe_not_found() {
        let mut bus = EventBus::new(100);
        assert!(!bus.unsubscribe(999));
    }

    #[test]
    fn test_event_bus_history() {
        let mut bus = EventBus::new(100);
        bus.emit(Event::new("a", serde_json::json!(1), 1000, "src"));
        bus.emit(Event::new("b", serde_json::json!(2), 1001, "src"));
        bus.emit(Event::new("a", serde_json::json!(3), 1002, "src"));

        assert_eq!(bus.history(None).len(), 3);
        assert_eq!(bus.history(Some("a")).len(), 2);
        assert_eq!(bus.history(Some("b")).len(), 1);
        assert_eq!(bus.history(Some("c")).len(), 0);
    }

    #[test]
    fn test_event_bus_history_limit() {
        let mut bus = EventBus::new(3);
        for i in 0..5 {
            bus.emit(Event::new("t", serde_json::json!(i), 1000 + i, "src"));
        }
        assert_eq!(bus.history(None).len(), 3);
        // Oldest events pruned
        assert_eq!(bus.history(None)[0].payload, serde_json::json!(2));
    }

    #[test]
    fn test_event_bus_clear_history() {
        let mut bus = EventBus::new(100);
        bus.emit(Event::new("t", serde_json::json!(1), 1000, "src"));
        assert_eq!(bus.history(None).len(), 1);
        bus.clear_history();
        assert_eq!(bus.history(None).len(), 0);
    }

    #[test]
    fn test_event_bus_subscriber_count() {
        let mut bus = EventBus::new(100);
        assert_eq!(bus.subscriber_count("test"), 0);

        bus.subscribe("test", Box::new(|_| {}));
        bus.subscribe("test", Box::new(|_| {}));
        bus.subscribe("other", Box::new(|_| {}));

        assert_eq!(bus.subscriber_count("test"), 2);
        assert_eq!(bus.subscriber_count("other"), 1);
    }

    #[test]
    fn test_topics_constants() {
        assert_eq!(topics::AGENT_STEP, "agent.step");
        assert_eq!(topics::ERROR, "error");
        assert_eq!(topics::CHECKPOINT_SAVED, "checkpoint.saved");
    }
}
