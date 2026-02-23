use std::collections::VecDeque;

/// Trait for observability backends.
pub trait Observer: Send + Sync {
    fn record_event(&mut self, event: ObserveEvent);
    fn record_metric(&mut self, metric: Metric);
    fn flush(&mut self);
    fn name(&self) -> &str;
}

/// An observability event.
#[derive(Debug, Clone)]
pub struct ObserveEvent {
    pub kind: EventKind,
    pub timestamp: i64,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventKind {
    AgentStart,
    AgentStep,
    AgentEnd,
    ProviderRequest,
    ProviderResponse,
    ToolInvocation,
    ToolResult,
    MemoryOperation,
    CheckpointSave,
    Error,
}

/// A metric measurement.
#[derive(Debug, Clone)]
pub struct Metric {
    pub name: String,
    pub value: f64,
    pub timestamp: i64,
}

/// No-op observer that discards everything (zero overhead).
pub struct NoopObserver;

impl Observer for NoopObserver {
    fn record_event(&mut self, _event: ObserveEvent) {}
    fn record_metric(&mut self, _metric: Metric) {}
    fn flush(&mut self) {}
    fn name(&self) -> &str {
        "noop"
    }
}

/// Ring buffer observer that keeps the last N events/metrics.
pub struct RingBufferObserver {
    events: VecDeque<ObserveEvent>,
    metrics: VecDeque<Metric>,
    max_events: usize,
    max_metrics: usize,
}

impl RingBufferObserver {
    pub fn new(max_events: usize, max_metrics: usize) -> Self {
        Self {
            events: VecDeque::new(),
            metrics: VecDeque::new(),
            max_events,
            max_metrics,
        }
    }

    pub fn events(&self) -> &VecDeque<ObserveEvent> {
        &self.events
    }

    pub fn metrics(&self) -> &VecDeque<Metric> {
        &self.metrics
    }

    pub fn event_count(&self) -> usize {
        self.events.len()
    }

    pub fn metric_count(&self) -> usize {
        self.metrics.len()
    }
}

impl Observer for RingBufferObserver {
    fn record_event(&mut self, event: ObserveEvent) {
        self.events.push_back(event);
        while self.events.len() > self.max_events {
            self.events.pop_front();
        }
    }

    fn record_metric(&mut self, metric: Metric) {
        self.metrics.push_back(metric);
        while self.metrics.len() > self.max_metrics {
            self.metrics.pop_front();
        }
    }

    fn flush(&mut self) {}

    fn name(&self) -> &str {
        "ring_buffer"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_noop_observer() {
        let mut obs = NoopObserver;
        obs.record_event(ObserveEvent {
            kind: EventKind::AgentStart,
            timestamp: 1000,
            data: serde_json::json!(null),
        });
        obs.record_metric(Metric {
            name: "test".to_string(),
            value: 1.0,
            timestamp: 1000,
        });
        obs.flush();
        assert_eq!(obs.name(), "noop");
    }

    #[test]
    fn test_ring_buffer_observer_events() {
        let mut obs = RingBufferObserver::new(3, 3);

        for i in 0..5 {
            obs.record_event(ObserveEvent {
                kind: EventKind::AgentStep,
                timestamp: 1000 + i,
                data: serde_json::json!(i),
            });
        }

        assert_eq!(obs.event_count(), 3);
        assert_eq!(obs.events()[0].timestamp, 1002); // Oldest two pruned
    }

    #[test]
    fn test_ring_buffer_observer_metrics() {
        let mut obs = RingBufferObserver::new(10, 2);

        obs.record_metric(Metric {
            name: "latency".to_string(),
            value: 10.0,
            timestamp: 1000,
        });
        obs.record_metric(Metric {
            name: "latency".to_string(),
            value: 20.0,
            timestamp: 1001,
        });
        obs.record_metric(Metric {
            name: "latency".to_string(),
            value: 30.0,
            timestamp: 1002,
        });

        assert_eq!(obs.metric_count(), 2);
        assert!((obs.metrics()[0].value - 20.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_ring_buffer_name() {
        let obs = RingBufferObserver::new(10, 10);
        assert_eq!(obs.name(), "ring_buffer");
    }

    #[test]
    fn test_event_kind_equality() {
        assert_eq!(EventKind::AgentStart, EventKind::AgentStart);
        assert_ne!(EventKind::AgentStart, EventKind::AgentEnd);
    }
}
