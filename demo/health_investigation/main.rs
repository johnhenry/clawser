//! # Scenario 1: Health Investigation Companion
//!
//! **Actor**: Knowledge worker with recurring headaches
//! **Duration**: Multi-week (simulated as multiple "sessions")
//! **Goal**: Track symptoms, identify patterns, prepare doctor briefing
//!
//! Demonstrates:
//! - Persistent memory across sessions (tab close → reopen)
//! - Goal lifecycle (active → completed)
//! - Workspace artifact creation via tool calls
//! - Memory recall for pattern detection
//! - Checkpoint / restore cycle
//! - Scheduled reminder jobs

use clawser_core::agent::{Agent, GoalStatus, StepResult};
use clawser_core::checkpoint::{Checkpoint, CheckpointManager};
use clawser_core::config::AgentConfig;
use clawser_core::events::{Event, EventBus, topics};
use clawser_core::memory::{InMemoryBackend, Memory, MemoryCategory, MemoryEntry, RecallOptions};
use clawser_core::providers::{ChatResponse, MockProvider, ToolCall, TokenUsage};
use clawser_core::scheduler::{JobAction, Schedule, Scheduler};
use clawser_core::session::Session;
use clawser_core::tools::{MockTool, ToolRegistry, ToolResult};

fn separator(title: &str) {
    println!("\n{}", "=".repeat(60));
    println!("  {title}");
    println!("{}\n", "=".repeat(60));
}

fn main() {
    println!("==========================================================");
    println!("  SCENARIO 1: Health Investigation Companion");
    println!("  Simulating multi-week symptom tracking & pattern analysis");
    println!("==========================================================\n");

    // ── Initialize core systems ─────────────────────────────────
    let mut memory = InMemoryBackend::new();
    let mut scheduler = Scheduler::new();
    let mut event_bus = EventBus::new(100);
    let mut checkpoint_mgr = CheckpointManager::new(5);
    let mut session = Session::new("sess_health_1", 1000, 1800);

    let config = AgentConfig {
        max_tool_iterations: 10,
        ..AgentConfig::default()
    };
    let mut agent = Agent::new(config);
    agent.set_system_prompt(
        "You are a health investigation assistant. Track symptom reports, \
         identify patterns, and prepare structured briefings for doctors.",
    );

    // ── Register tools ──────────────────────────────────────────
    let mut tools = ToolRegistry::new();
    tools.register(Box::new(MockTool::new(
        "file_write",
        ToolResult::success("File written successfully"),
    )));
    tools.register(Box::new(MockTool::new(
        "memory_store",
        ToolResult::success("Memory stored"),
    )));
    tools.register(Box::new(MockTool::new(
        "web_fetch",
        ToolResult::success(r#"{"results": ["Tension headaches linked to screen time and dehydration"]}"#),
    )));

    // ═══════════════════════════════════════════════════════════
    separator("WEEK 1, SESSION 1: Initial goal + first symptom report");

    // User sets the goal
    let goal_id = agent.add_goal(
        "Track and research my recurring headaches – identify triggers and prepare doctor briefing",
        1000,
    );
    println!("[Goal created] id={goal_id}");
    assert_eq!(agent.active_goals().len(), 1);

    // Provider returns a tool call to create workspace structure
    let provider = MockProvider::new("health-assistant")
        .with_response(ChatResponse {
            content: String::new(),
            tool_calls: vec![ToolCall {
                id: "tc_1".to_string(),
                name: "file_write".to_string(),
                arguments: serde_json::json!({
                    "path": "/workspace/goals/active/headache-research.md",
                    "content": "# Headache Investigation\n\nStatus: Active\nStarted: Week 1\n"
                })
                .to_string(),
            }],
            usage: TokenUsage { input_tokens: 150, output_tokens: 80 },
            model: "mock".to_string(),
            reasoning_content: None,
        })
        .with_response(ChatResponse {
            content: "I've set up your headache investigation workspace. \
                      Please describe your first symptom episode."
                .to_string(),
            tool_calls: vec![],
            usage: TokenUsage { input_tokens: 100, output_tokens: 40 },
            model: "mock".to_string(),
            reasoning_content: None,
        });

    agent.on_message("Help me track and research my recurring headaches");
    let result = agent.step(&provider, &tools);
    assert!(matches!(result, StepResult::ToolCalls(_)));
    println!("[Agent] Creating workspace files via file_write tool");

    agent.execute_tools(&tools);
    let _result = agent.step(&provider, &tools);
    // After tool results fed back, agent should think again then respond
    let result = agent.step(&provider, &tools);
    match &result {
        StepResult::Response(text) => println!("[Agent] {text}"),
        other => println!("[Agent] Step result: {other:?}"),
    }

    // User reports first symptom
    let symptom_1 = MemoryEntry {
        id: String::new(),
        key: "symptom_report_week1".to_string(),
        content: "Headache: throbbing, right temple, 6/10 severity. \
                  Onset 3pm after 5h screen time. Had 1 coffee, low water intake."
            .to_string(),
        category: MemoryCategory::Core,
        timestamp: 1001,
        session_id: Some("sess_health_1".to_string()),
        score: None,
        embedding: None,
    };
    let id = memory.store(symptom_1).unwrap();
    println!("[Memory] Stored symptom report: {id}");

    event_bus.emit(Event::new(
        topics::MEMORY_STORED,
        serde_json::json!({"entry_id": id, "key": "symptom_report_week1"}),
        1001,
        "agent",
    ));

    // ── Checkpoint after session 1 ──────────────────────────────
    let mut ckpt = Checkpoint::new(checkpoint_mgr.next_id(), 1001);
    ckpt.session_history = agent.history.clone();
    ckpt.active_goals = agent.goals.clone();
    let (ckpt_id, data) = checkpoint_mgr.save(&ckpt).unwrap();
    println!("[Checkpoint] Saved: {ckpt_id} ({} bytes)", data.len());

    // ═══════════════════════════════════════════════════════════
    separator("WEEK 1, SESSION 2: Second symptom + pattern emerging");

    session.touch(2000);

    let symptom_2 = MemoryEntry {
        id: String::new(),
        key: "symptom_report_week1b".to_string(),
        content: "Headache: throbbing, right temple, 7/10 severity. \
                  Onset 4pm after 6h screen time. Had 2 coffees, moderate water."
            .to_string(),
        category: MemoryCategory::Core,
        timestamp: 2000,
        session_id: Some("sess_health_1".to_string()),
        score: None,
        embedding: None,
    };
    memory.store(symptom_2).unwrap();
    println!("[Memory] Stored second symptom report");

    // Agent recalls previous symptoms to find patterns
    let recalled = memory
        .recall("headache screen time", &RecallOptions::new().with_limit(10))
        .unwrap();
    println!(
        "[Memory] Recalled {} entries matching 'headache screen time'",
        recalled.len()
    );
    assert!(recalled.len() >= 2, "Should find both symptom reports");

    // Pattern detection: both episodes involve long screen time
    let pattern_match = recalled
        .iter()
        .all(|e| e.content.contains("screen time"));
    assert!(pattern_match, "All recalled entries should mention screen time");
    println!("[Analysis] Pattern detected: all episodes correlate with extended screen time");

    // Store the pattern as a core memory
    memory
        .store(MemoryEntry {
            id: String::new(),
            key: "pattern_screen_time".to_string(),
            content: "PATTERN: Headaches consistently occur after 5+ hours of screen time. \
                      Right temple location. Possibly tension-type headache triggered by eye strain."
                .to_string(),
            category: MemoryCategory::Core,
            timestamp: 2001,
            session_id: None,
            score: None,
            embedding: None,
        })
        .unwrap();
    println!("[Memory] Stored identified pattern");

    // ═══════════════════════════════════════════════════════════
    separator("WEEK 2: Scheduled research job fires");

    // Schedule a research task
    let job_id = scheduler.add(
        "Research headache triggers",
        Schedule::Delay(3600_000), // 1 hour
        JobAction::AgentPrompt {
            prompt: "Research tension headaches related to screen time and dehydration".to_string(),
        },
        2000,
    );
    println!("[Scheduler] Created job: {job_id}");

    // Simulate time passing – job fires
    let actions = scheduler.tick(3_600_000);
    assert_eq!(actions.len(), 1, "Research job should fire");
    println!(
        "[Scheduler] Job fired: {:?}",
        match &actions[0].1 {
            JobAction::AgentPrompt { prompt } => prompt.as_str(),
            _ => "unknown",
        }
    );

    // Agent performs web research
    let research_provider = MockProvider::new("researcher")
        .with_response(ChatResponse {
            content: String::new(),
            tool_calls: vec![ToolCall {
                id: "tc_2".to_string(),
                name: "web_fetch".to_string(),
                arguments: serde_json::json!({
                    "url": "https://health-api.example.com/search?q=tension+headache+screen+time"
                })
                .to_string(),
            }],
            usage: TokenUsage { input_tokens: 200, output_tokens: 50 },
            model: "mock".to_string(),
            reasoning_content: None,
        })
        .with_response(ChatResponse {
            content: "Research findings: Tension headaches are strongly correlated with \
                      prolonged screen time (>4 hours) and dehydration. The 20-20-20 rule \
                      (every 20 min, look 20 feet away for 20 seconds) is recommended."
                .to_string(),
            tool_calls: vec![],
            usage: TokenUsage { input_tokens: 300, output_tokens: 120 },
            model: "mock".to_string(),
            reasoning_content: None,
        });

    let mut research_agent = Agent::new(AgentConfig::default());
    research_agent.on_message("Research tension headaches related to screen time and dehydration");
    research_agent.step(&research_provider, &tools);
    research_agent.execute_tools(&tools);
    let _result = research_agent.step(&research_provider, &tools);
    let result = research_agent.step(&research_provider, &tools);
    match &result {
        StepResult::Response(text) => {
            println!("[Research] {text}");
            memory
                .store(MemoryEntry {
                    id: String::new(),
                    key: "research_tension_headaches".to_string(),
                    content: text.clone(),
                    category: MemoryCategory::Core,
                    timestamp: 3000,
                    session_id: None,
                    score: None,
                    embedding: None,
                })
                .unwrap();
        }
        _ => {}
    }

    // ═══════════════════════════════════════════════════════════
    separator("WEEK 3: Doctor briefing preparation");

    // Recall all relevant memories
    let all_findings = memory
        .recall("headache", &RecallOptions::new().with_limit(20))
        .unwrap();
    println!(
        "[Memory] Total entries for briefing: {}",
        all_findings.len()
    );
    assert!(
        all_findings.len() >= 3,
        "Should have symptoms + pattern + research"
    );

    // Build the doctor briefing artifact
    let mut briefing = String::from("# Doctor Briefing: Recurring Headaches\n\n");
    briefing.push_str("## Symptom Timeline\n\n");
    for entry in all_findings.iter().filter(|e| e.key.starts_with("symptom")) {
        briefing.push_str(&format!("- **{}**: {}\n", entry.key, entry.content));
    }
    briefing.push_str("\n## Identified Patterns\n\n");
    for entry in all_findings.iter().filter(|e| e.key.starts_with("pattern")) {
        briefing.push_str(&format!("- {}\n", entry.content));
    }
    briefing.push_str("\n## Research Findings\n\n");
    for entry in all_findings.iter().filter(|e| e.key.starts_with("research")) {
        briefing.push_str(&format!("- {}\n", entry.content));
    }
    briefing.push_str("\n## Questions for Doctor\n\n");
    briefing.push_str("1. Could this be tension-type headache from eye strain?\n");
    briefing.push_str("2. Should I get an eye exam?\n");
    briefing.push_str("3. Are there preventive medications worth considering?\n");

    println!("[Artifact] Generated doctor briefing ({} chars)", briefing.len());
    assert!(briefing.contains("Symptom Timeline"));
    assert!(briefing.contains("Identified Patterns"));
    assert!(briefing.contains("Research Findings"));

    // ═══════════════════════════════════════════════════════════
    separator("WEEK 4: Goal completion after doctor visit");

    // User returns with diagnosis
    memory
        .store(MemoryEntry {
            id: String::new(),
            key: "diagnosis".to_string(),
            content: "Doctor confirmed tension-type headache. Prescribed: 20-20-20 rule, \
                      hydration tracking, blue-light glasses. Follow-up in 4 weeks."
                .to_string(),
            category: MemoryCategory::Core,
            timestamp: 4000,
            session_id: None,
            score: None,
            embedding: None,
        })
        .unwrap();
    println!("[Memory] Stored diagnosis from doctor visit");

    // Complete the goal
    assert!(agent.complete_goal(&goal_id, 4000));
    assert_eq!(agent.active_goals().len(), 0);
    println!("[Goal] Completed: headache investigation");

    // ── Final checkpoint ────────────────────────────────────────
    let mut final_ckpt = Checkpoint::new(checkpoint_mgr.next_id(), 4000);
    final_ckpt.session_history = agent.history.clone();
    final_ckpt.active_goals = agent.goals.clone();
    let (final_id, final_data) = checkpoint_mgr.save(&final_ckpt).unwrap();
    println!("[Checkpoint] Final saved: {final_id} ({} bytes)", final_data.len());

    // ── Verify checkpoint restore ───────────────────────────────
    let restored = Checkpoint::from_bytes(&final_data).unwrap();
    assert_eq!(restored.active_goals.len(), 1);
    assert_eq!(restored.active_goals[0].status, GoalStatus::Completed);
    println!("[Checkpoint] Restore verified: goal status = Completed");

    // ── Verify memory persistence ───────────────────────────────
    let total = memory.count(None).unwrap();
    let core = memory.count(Some(&MemoryCategory::Core)).unwrap();
    println!("[Memory] Total entries: {total}, Core entries: {core}");
    assert!(total >= 5, "Should have symptom reports + patterns + research + diagnosis");

    // ═══════════════════════════════════════════════════════════
    separator("SUMMARY");

    println!("  Demonstrated capabilities:");
    println!("  [x] Goal lifecycle (active -> completed)");
    println!("  [x] Persistent memory across 4 simulated weeks");
    println!("  [x] Tool calls (file_write, web_fetch, memory_store)");
    println!("  [x] Memory recall for pattern detection");
    println!("  [x] Scheduled research job");
    println!("  [x] Workspace artifact generation (doctor briefing)");
    println!("  [x] Checkpoint save/restore with goal state");
    println!("  [x] Multi-session continuity");
    println!("\n  All assertions passed!\n");
}
