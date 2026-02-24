# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 0.1.0-beta

### Added
- Gap remediation: router single source of truth, state namespacing (Batch 2)
- Critical security and safety fixes across 7 areas (Batch 1)
- 9 feature module integrations with 36 new agent tools and TDD integration tests
- Panel enhancements and agent loop integration for 3 remaining modules (Batch 3)
- Phase 2: UI, agent loop integration, and cross-block wiring for all 30 feature blocks

### Fixed
- 9 API mismatches in Phase 2 UI/integration code

## Phase 3 — Feature Module Integration

### Added
- Block 28: WASM Tool Sandbox with capability gate, worker/wasm isolation, fuel metering
- Block 18: Browser Automation with page snapshots, element resolution, session management, safety controls
- Block 16: OAuth App Integrations with provider registry, connection lifecycle, auto-refresh
- Block 15: Remote Access Gateway with pairing, tokens, rate limiting, gateway client
- Block 14: Multi-Channel Input with normalized messaging and allowlists
- Block 21: Routines Engine with event-driven automation and guardrails
- Block 29: Heartbeat Checklist with periodic self-checks and silent alerting
- Block 12: Git as Agent with commit convention, branching, episodic memory
- Block 13: Web Hardware with serial, Bluetooth, USB peripheral management

## Phase 2 — Infrastructure Blocks

### Added
- Block 3: Daemon Mode with lifecycle, checkpoints, tab coordination
- Block 0: External Bridge with abstract interface, local server and extension bridges
- Block 25: Undo/Redo with turn-based checkpoint and multi-layer undo
- Block 22: Self-Repair with stuck detection and recovery engine
- Block 27: Intent Router with message classification and pipeline routing
- Block 19: Auth Profiles with multi-account provider credential management
- Block 9: Sub-agent Delegation with isolated context and tool restriction
- Block 8: Goal Artifacts and Sub-goals with tree structure and cascading completion
- Block 2: Local Filesystem Mounting with MountableFs and virtual mount table
- Block 11: Provider Fallback Chains and Model Routing
- Block 10: Observability with MetricsCollector, RingBufferLog, OTLP export
- Block 24: Tool Builder with dynamic tool creation, validation, and versioning
- Block 17: Skill Package Registry

## Phase 1 — Core Systems

### Added
- Block 4: Semantic Memory with BM25 + cosine hybrid search
- Block 7: Identity System with AIEOS v1.1, OpenClaw, and Plain formats
- Block 23: Safety Pipeline with defense-in-depth for agent tool execution
- Block 20: Lifecycle Hooks with HookPipeline and 6 interception points
- Block 6: Autonomy Levels and Cost Limiting
- Block 5: API Key Encryption with SecretVault and Web Crypto
- Block 26: Response Cache with LRU cache and TTL for LLM responses
- Block 1: Browser Shell Emulation Layer

## Phase 0 — Foundation

### Added
- Full Clawser codebase: pure JS agent, modular UI, providers, tools, tests
- Post-modularization fixes and follow-up review fixes
