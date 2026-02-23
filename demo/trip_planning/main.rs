//! # Scenario 3: Trip Co-Planning
//!
//! **Actor**: Planner preparing a Tokyo trip
//! **Duration**: 1-2 weeks (adaptive itinerary with scheduled price checks)
//!
//! Demonstrates:
//! - Scheduled jobs (price monitoring)
//! - Memory-based preference refinement
//! - Multiple artifact versions
//! - Goal lifecycle with user feedback integration

use clawser_core::agent::{Agent, StepResult};
use clawser_core::config::AgentConfig;
use clawser_core::memory::{InMemoryBackend, Memory, MemoryCategory, MemoryEntry, RecallOptions};
use clawser_core::providers::{ChatResponse, MockProvider, ToolCall, TokenUsage};
use clawser_core::scheduler::{JobAction, Schedule, Scheduler};
use clawser_core::tools::{MockTool, ToolRegistry, ToolResult};

fn sep(title: &str) {
    println!("\n{}", "=".repeat(60));
    println!("  {title}");
    println!("{}\n", "=".repeat(60));
}

fn main() {
    println!("==========================================================");
    println!("  SCENARIO 3: Trip Co-Planning");
    println!("  Simulating adaptive Tokyo trip planning with price alerts");
    println!("==========================================================\n");

    let mut memory = InMemoryBackend::new();
    let mut scheduler = Scheduler::new();
    let mut agent = Agent::new(AgentConfig::default());

    agent.set_system_prompt(
        "You are a trip planning assistant. Create adaptive itineraries, \
         track reservations, monitor prices, and adjust based on preferences.",
    );

    let mut tools = ToolRegistry::new();
    tools.register(Box::new(MockTool::new("file_write", ToolResult::success("Written"))));
    tools.register(Box::new(MockTool::new("web_fetch", ToolResult::success(
        r#"{"flights": [{"price": 850, "airline": "ANA"}, {"price": 920, "airline": "JAL"}], "weather": "cherry blossom season, 15-20C"}"#
    ))));

    // ── Session 1: Set goal + initial research ──────────────────
    sep("SESSION 1: Goal setting + initial research");

    let goal_id = agent.add_goal("Plan a 5-day trip to Tokyo in April", 1000);
    println!("[Goal] Created: {goal_id}");

    // Store user preferences
    memory.store(MemoryEntry {
        id: String::new(), key: "trip_dates".to_string(),
        content: "Trip dates: April 5-10, 2026. 5 nights.".to_string(),
        category: MemoryCategory::Core, timestamp: 1000,
        session_id: None, score: None, embedding: None,
    }).unwrap();

    memory.store(MemoryEntry {
        id: String::new(), key: "trip_budget".to_string(),
        content: "Budget: $3000 total. Prefer mid-range hotels, $150-200/night.".to_string(),
        category: MemoryCategory::Core, timestamp: 1000,
        session_id: None, score: None, embedding: None,
    }).unwrap();

    // Research flights and weather
    let provider = MockProvider::new("trip-planner")
        .with_response(ChatResponse {
            content: String::new(),
            tool_calls: vec![ToolCall {
                id: "tc_1".to_string(),
                name: "web_fetch".to_string(),
                arguments: r#"{"url": "https://flights-api.example.com/search?from=SFO&to=NRT&date=2026-04-05"}"#.to_string(),
            }],
            usage: TokenUsage { input_tokens: 200, output_tokens: 60 },
            model: "mock".to_string(),
            reasoning_content: None,
        })
        .with_response(ChatResponse {
            content: "Great news! I found flights and the weather looks perfect:\n\
                      - ANA: $850 roundtrip\n\
                      - JAL: $920 roundtrip\n\
                      - Cherry blossom season, expect 15-20\u{00b0}C\n\n\
                      I've created an initial itinerary.".to_string(),
            tool_calls: vec![],
            usage: TokenUsage { input_tokens: 350, output_tokens: 120 },
            model: "mock".to_string(),
            reasoning_content: None,
        });

    agent.on_message("Plan a 5-day trip to Tokyo in April. Budget is $3000.");
    agent.step(&provider, &tools);
    agent.execute_tools(&tools);
    let _r = agent.step(&provider, &tools);
    let result = agent.step(&provider, &tools);
    if let StepResult::Response(text) = &result {
        println!("[Agent] {text}");
    }

    // Generate v1 itinerary
    let itinerary_v1 = "# Tokyo Trip Itinerary v1\n\n\
        ## Day 1 (Apr 5): Arrival + Shinjuku\n\
        - Arrive NRT 4pm, Narita Express to Shinjuku\n\
        - Check in hotel, evening walk in Kabukicho\n\n\
        ## Day 2 (Apr 6): Traditional Tokyo\n\
        - Senso-ji Temple (morning)\n\
        - Ueno Park cherry blossoms\n\
        - Akihabara afternoon\n\n\
        ## Day 3 (Apr 7): Culture Day\n\
        - Meiji Shrine\n\
        - Harajuku / Omotesando\n\
        - Shibuya evening\n\n\
        ## Day 4 (Apr 8): Day Trip\n\
        - Kamakura (Great Buddha, bamboo grove)\n\n\
        ## Day 5 (Apr 9): Modern Tokyo\n\
        - TeamLab Borderless\n\
        - Tsukiji Outer Market\n\
        - Departure prep\n";
    println!("[Artifact] tokyo-itinerary-v1.md ({} chars)", itinerary_v1.len());

    // Schedule price monitoring
    let price_job = scheduler.add(
        "Check hotel prices",
        Schedule::Every(86_400_000), // Daily
        JobAction::AgentPrompt {
            prompt: "Check current Tokyo hotel prices for April 5-10 and compare with previous".to_string(),
        },
        1000,
    );
    println!("[Scheduler] Price monitoring job: {price_job}");

    // ── Session 2: User feedback → refined itinerary ────────────
    sep("SESSION 2: User feedback + itinerary v2");

    // User provides preferences
    memory.store(MemoryEntry {
        id: String::new(), key: "preference_quiet".to_string(),
        content: "USER PREFERENCE: Prefers quieter neighborhoods. No Kabukicho. \
                  Interested in architecture and food, not shopping.".to_string(),
        category: MemoryCategory::Core, timestamp: 2000,
        session_id: None, score: None, embedding: None,
    }).unwrap();
    println!("[Memory] Stored preference: quieter neighborhoods, architecture, food");

    // Agent recalls preferences to refine
    let prefs = memory.recall("preference", &RecallOptions::new().with_limit(10)).unwrap();
    assert!(!prefs.is_empty());
    println!("[Memory] Recalled {} preferences for refinement", prefs.len());

    // Generate v2 itinerary (adapted)
    let itinerary_v2 = "# Tokyo Trip Itinerary v2 (Revised)\n\n\
        ## Day 1 (Apr 5): Arrival + Yanaka\n\
        - Arrive NRT, train to Yanaka (quiet historic neighborhood)\n\
        - Evening stroll through Yanaka Ginza shotengai\n\n\
        ## Day 2 (Apr 6): Architecture Focus\n\
        - National Art Center (Kisho Kurokawa design)\n\
        - 21_21 DESIGN SIGHT (Tadao Ando)\n\
        - Roppongi Hills Mori Tower observation\n\n\
        ## Day 3 (Apr 7): Food + Temples\n\
        - Tsukiji Outer Market (morning, food tour)\n\
        - Senso-ji Temple\n\
        - Kappabashi kitchen street\n\
        - Ramen Yokocho dinner\n\n\
        ## Day 4 (Apr 8): Quiet Neighborhoods\n\
        - Shimokitazawa (indie cafes, vintage)\n\
        - Todoroki Valley (urban nature walk)\n\
        - Nakameguro cherry blossoms along canal\n\n\
        ## Day 5 (Apr 9): Farewell\n\
        - Nezu Shrine + Nezu neighborhood\n\
        - Last ramen stop\n\
        - Departure\n";
    println!("[Artifact] tokyo-itinerary-v2.md ({} chars)", itinerary_v2.len());
    assert!(!itinerary_v2.contains("Kabukicho"), "v2 should respect quiet preference");
    assert!(itinerary_v2.contains("Architecture"), "v2 should feature architecture");

    // ── Session 3: Price alert fires ────────────────────────────
    sep("SESSION 3: Scheduled price check fires");

    let actions = scheduler.tick(86_400_000);
    assert_eq!(actions.len(), 1);
    println!("[Scheduler] Price check job fired");

    // Simulate price drop discovery
    memory.store(MemoryEntry {
        id: String::new(), key: "price_alert_hotel".to_string(),
        content: "PRICE DROP: Hotel Gracery Shinjuku dropped from $180/night to $145/night. \
                  Saves $175 total. Still available for Apr 5-10.".to_string(),
        category: MemoryCategory::Daily, timestamp: 3000,
        session_id: None, score: None, embedding: None,
    }).unwrap();
    println!("[Alert] Hotel price drop detected: $180 -> $145/night (-$175 total)");

    memory.store(MemoryEntry {
        id: String::new(), key: "price_alert_flight".to_string(),
        content: "FLIGHT UPDATE: ANA roundtrip now $790 (was $850). Save $60.".to_string(),
        category: MemoryCategory::Daily, timestamp: 3000,
        session_id: None, score: None, embedding: None,
    }).unwrap();
    println!("[Alert] Flight price drop: ANA $850 -> $790 (-$60)");

    // Update cost tracking
    let alerts = memory.recall("price", &RecallOptions::new().with_limit(10)).unwrap();
    println!("[Memory] {} price alerts accumulated", alerts.len());
    assert!(alerts.len() >= 2);

    // ── Session 4: Complete goal ────────────────────────────────
    sep("SESSION 4: Finalize and complete");

    assert!(agent.complete_goal(&goal_id, 4000));
    println!("[Goal] Trip planning completed!");

    // Verify all data persisted
    let total = memory.count(None).unwrap();
    println!("[Memory] Total entries: {total}");
    assert!(total >= 5, "Should have dates, budget, preferences, prices, alerts");

    sep("SUMMARY");
    println!("  Demonstrated capabilities:");
    println!("  [x] Goal-driven trip planning");
    println!("  [x] Scheduled daily price monitoring job");
    println!("  [x] Memory-based preference recall and refinement");
    println!("  [x] Itinerary v1 → v2 based on user feedback");
    println!("  [x] Price drop alerts from scheduled jobs");
    println!("  [x] Multiple workspace artifacts (itinerary versions)");
    println!("  [x] Budget tracking via stored preferences");
    println!("\n  All assertions passed!\n");
}
