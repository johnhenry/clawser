use serde::{Deserialize, Serialize};

/// Type of schedule.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum Schedule {
    /// Standard 5-field cron expression.
    Cron(String),
    /// One-shot at a specific Unix timestamp (seconds).
    At(i64),
    /// Recurring interval in milliseconds.
    Every(u64),
    /// One-shot delay in milliseconds from creation.
    Delay(u64),
}

/// Action to perform when a job fires.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum JobAction {
    /// Send a prompt to the agent.
    AgentPrompt { prompt: String },
    /// Invoke a tool directly.
    ToolInvocation {
        tool: String,
        args: serde_json::Value,
    },
}

/// How to deliver job results.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryMode {
    Always,
    OnError,
    OnSuccess,
    None,
}

/// A scheduled job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledJob {
    pub id: String,
    pub name: String,
    pub schedule: Schedule,
    pub action: JobAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    pub delivery: DeliveryMode,
    pub delete_after_run: bool,
    pub paused: bool,
    pub last_run: Option<i64>,
    pub next_run: Option<i64>,
    pub run_count: u64,
    pub created_at: i64,
}

impl ScheduledJob {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        schedule: Schedule,
        action: JobAction,
        now: i64,
    ) -> Self {
        let mut job = Self {
            id: id.into(),
            name: name.into(),
            schedule,
            action,
            timezone: None,
            delivery: DeliveryMode::Always,
            delete_after_run: false,
            paused: false,
            last_run: None,
            next_run: None,
            run_count: 0,
            created_at: now,
        };
        job.next_run = job.compute_next_run(now);
        job
    }

    /// Compute the next run time based on current time.
    pub fn compute_next_run(&self, now: i64) -> Option<i64> {
        if self.paused {
            return None;
        }
        match &self.schedule {
            Schedule::Cron(_expr) => {
                // In real impl, parse cron expression and compute next occurrence.
                // For now, return a placeholder.
                Some(now + 60)
            }
            Schedule::At(timestamp) => {
                if *timestamp > now {
                    Some(*timestamp)
                } else {
                    None // Already past
                }
            }
            Schedule::Every(interval_ms) => {
                let interval_secs = (*interval_ms / 1000) as i64;
                Some(now + interval_secs)
            }
            Schedule::Delay(delay_ms) => {
                let delay_secs = (*delay_ms / 1000) as i64;
                if self.run_count == 0 {
                    Some(self.created_at + delay_secs)
                } else {
                    None // One-shot, already ran
                }
            }
        }
    }

    /// Check if this job should fire now.
    pub fn should_fire(&self, now: i64) -> bool {
        if self.paused {
            return false;
        }
        self.next_run.is_some_and(|next| now >= next)
    }

    /// Record that the job fired.
    pub fn record_run(&mut self, now: i64) {
        self.last_run = Some(now);
        self.run_count += 1;
        self.next_run = self.compute_next_run(now);
    }

    /// Pause the job.
    pub fn pause(&mut self) {
        self.paused = true;
        self.next_run = None;
    }

    /// Resume the job.
    pub fn resume(&mut self, now: i64) {
        self.paused = false;
        self.next_run = self.compute_next_run(now);
    }
}

/// The scheduler manages all scheduled jobs.
pub struct Scheduler {
    jobs: Vec<ScheduledJob>,
    next_id: u64,
}

impl Scheduler {
    pub fn new() -> Self {
        Self {
            jobs: Vec::new(),
            next_id: 1,
        }
    }

    /// Add a new job.
    pub fn add(&mut self, name: &str, schedule: Schedule, action: JobAction, now: i64) -> String {
        let id = format!("job_{}", self.next_id);
        self.next_id += 1;
        let job = ScheduledJob::new(&id, name, schedule, action, now);
        self.jobs.push(job);
        id
    }

    /// Remove a job by ID.
    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.jobs.len();
        self.jobs.retain(|j| j.id != id);
        self.jobs.len() < before
    }

    /// Get a job by ID.
    pub fn get(&self, id: &str) -> Option<&ScheduledJob> {
        self.jobs.iter().find(|j| j.id == id)
    }

    /// Get a mutable job by ID.
    pub fn get_mut(&mut self, id: &str) -> Option<&mut ScheduledJob> {
        self.jobs.iter_mut().find(|j| j.id == id)
    }

    /// List all jobs.
    pub fn list(&self) -> &[ScheduledJob] {
        &self.jobs
    }

    /// Get all jobs that should fire at the given time.
    pub fn due_jobs(&self, now: i64) -> Vec<&ScheduledJob> {
        self.jobs.iter().filter(|j| j.should_fire(now)).collect()
    }

    /// Process all due jobs, returning their actions.
    pub fn tick(&mut self, now: i64) -> Vec<(String, JobAction)> {
        let due_ids: Vec<String> = self
            .jobs
            .iter()
            .filter(|j| j.should_fire(now))
            .map(|j| j.id.clone())
            .collect();

        let mut actions = Vec::new();
        let mut to_remove = Vec::new();

        for id in &due_ids {
            if let Some(job) = self.jobs.iter_mut().find(|j| &j.id == id) {
                actions.push((job.id.clone(), job.action.clone()));
                job.record_run(now);
                if job.delete_after_run && job.next_run.is_none() {
                    to_remove.push(job.id.clone());
                }
            }
        }

        for id in &to_remove {
            self.jobs.retain(|j| j.id != *id);
        }

        actions
    }

    /// Count of active (non-paused) jobs.
    pub fn active_count(&self) -> usize {
        self.jobs.iter().filter(|j| !j.paused).count()
    }

    /// Total job count.
    pub fn len(&self) -> usize {
        self.jobs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.jobs.is_empty()
    }
}

impl Default for Scheduler {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_schedule_serialization() {
        let cron = Schedule::Cron("0 9 * * 1-5".to_string());
        let json = serde_json::to_string(&cron).unwrap();
        let parsed: Schedule = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, Schedule::Cron(ref s) if s == "0 9 * * 1-5"));

        let at = Schedule::At(1700000000);
        let json = serde_json::to_string(&at).unwrap();
        let parsed: Schedule = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, Schedule::At(1700000000)));
    }

    #[test]
    fn test_job_action_serialization() {
        let action = JobAction::AgentPrompt {
            prompt: "Check for updates".to_string(),
        };
        let json = serde_json::to_string(&action).unwrap();
        let parsed: JobAction = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, JobAction::AgentPrompt { ref prompt } if prompt == "Check for updates"));
    }

    #[test]
    fn test_scheduled_job_creation() {
        let job = ScheduledJob::new(
            "j1",
            "Test Job",
            Schedule::Every(60_000),
            JobAction::AgentPrompt {
                prompt: "hello".to_string(),
            },
            1000,
        );
        assert_eq!(job.id, "j1");
        assert!(!job.paused);
        assert_eq!(job.run_count, 0);
        assert!(job.next_run.is_some());
    }

    #[test]
    fn test_job_should_fire() {
        let job = ScheduledJob::new(
            "j1",
            "Test",
            Schedule::At(1000),
            JobAction::AgentPrompt {
                prompt: "go".to_string(),
            },
            500,
        );
        assert!(!job.should_fire(999));
        assert!(job.should_fire(1000));
        assert!(job.should_fire(1500));
    }

    #[test]
    fn test_job_pause_resume() {
        let mut job = ScheduledJob::new(
            "j1",
            "Test",
            Schedule::Every(60_000),
            JobAction::AgentPrompt {
                prompt: "go".to_string(),
            },
            1000,
        );
        assert!(!job.paused);
        assert!(job.next_run.is_some());

        job.pause();
        assert!(job.paused);
        assert!(job.next_run.is_none());
        assert!(!job.should_fire(9999));

        job.resume(2000);
        assert!(!job.paused);
        assert!(job.next_run.is_some());
    }

    #[test]
    fn test_job_record_run() {
        let mut job = ScheduledJob::new(
            "j1",
            "Test",
            Schedule::Every(60_000),
            JobAction::AgentPrompt {
                prompt: "go".to_string(),
            },
            1000,
        );
        assert_eq!(job.run_count, 0);

        job.record_run(1060);
        assert_eq!(job.run_count, 1);
        assert_eq!(job.last_run, Some(1060));
    }

    #[test]
    fn test_delay_one_shot() {
        let job = ScheduledJob::new(
            "j1",
            "One Shot",
            Schedule::Delay(5000),
            JobAction::AgentPrompt {
                prompt: "fire once".to_string(),
            },
            1000,
        );
        // Should fire at created_at + 5 seconds = 1005
        assert_eq!(job.next_run, Some(1005));
        assert!(!job.should_fire(1004));
        assert!(job.should_fire(1005));
    }

    #[test]
    fn test_at_past_timestamp() {
        let job = ScheduledJob::new(
            "j1",
            "Past",
            Schedule::At(500),
            JobAction::AgentPrompt {
                prompt: "late".to_string(),
            },
            1000,
        );
        // Already past, next_run should be None
        assert_eq!(job.next_run, None);
    }

    #[test]
    fn test_scheduler_add_and_list() {
        let mut sched = Scheduler::new();
        assert!(sched.is_empty());

        let id = sched.add(
            "Job 1",
            Schedule::Every(60_000),
            JobAction::AgentPrompt {
                prompt: "go".to_string(),
            },
            1000,
        );
        assert!(!sched.is_empty());
        assert_eq!(sched.len(), 1);
        assert!(sched.get(&id).is_some());
    }

    #[test]
    fn test_scheduler_remove() {
        let mut sched = Scheduler::new();
        let id = sched.add(
            "Job",
            Schedule::Every(60_000),
            JobAction::AgentPrompt {
                prompt: "x".to_string(),
            },
            1000,
        );
        assert!(sched.remove(&id));
        assert!(sched.is_empty());
        assert!(!sched.remove(&id)); // Already removed
    }

    #[test]
    fn test_scheduler_tick() {
        let mut sched = Scheduler::new();
        sched.add(
            "Job 1",
            Schedule::At(1050),
            JobAction::AgentPrompt {
                prompt: "fire1".to_string(),
            },
            1000,
        );
        sched.add(
            "Job 2",
            Schedule::At(2000),
            JobAction::AgentPrompt {
                prompt: "fire2".to_string(),
            },
            1000,
        );

        // At t=1050, only job 1 should fire
        let actions = sched.tick(1050);
        assert_eq!(actions.len(), 1);

        // At t=2000, job 2 should fire
        let actions = sched.tick(2000);
        assert_eq!(actions.len(), 1);
    }

    #[test]
    fn test_scheduler_tick_delete_after_run() {
        let mut sched = Scheduler::new();
        let id = sched.add(
            "One-Shot",
            Schedule::At(1050),
            JobAction::AgentPrompt {
                prompt: "once".to_string(),
            },
            1000,
        );
        // Mark as delete after run
        sched.get_mut(&id).unwrap().delete_after_run = true;

        let actions = sched.tick(1050);
        assert_eq!(actions.len(), 1);
        // Job should be removed
        assert!(sched.is_empty());
    }

    #[test]
    fn test_scheduler_active_count() {
        let mut sched = Scheduler::new();
        let id1 = sched.add(
            "A",
            Schedule::Every(60_000),
            JobAction::AgentPrompt {
                prompt: "a".to_string(),
            },
            1000,
        );
        sched.add(
            "B",
            Schedule::Every(60_000),
            JobAction::AgentPrompt {
                prompt: "b".to_string(),
            },
            1000,
        );
        assert_eq!(sched.active_count(), 2);

        sched.get_mut(&id1).unwrap().pause();
        assert_eq!(sched.active_count(), 1);
    }

    #[test]
    fn test_scheduler_due_jobs() {
        let mut sched = Scheduler::new();
        sched.add(
            "Due",
            Schedule::At(1000),
            JobAction::AgentPrompt {
                prompt: "now".to_string(),
            },
            500,
        );
        sched.add(
            "Later",
            Schedule::At(2000),
            JobAction::AgentPrompt {
                prompt: "later".to_string(),
            },
            500,
        );

        let due = sched.due_jobs(1000);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].name, "Due");
    }

    #[test]
    fn test_delivery_mode_serialization() {
        let json = serde_json::to_string(&DeliveryMode::Always).unwrap();
        assert_eq!(json, "\"always\"");
        let json = serde_json::to_string(&DeliveryMode::OnError).unwrap();
        assert_eq!(json, "\"on_error\"");
    }
}
