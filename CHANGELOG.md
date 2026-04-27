# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- 2 error categories: `timeout` and `content_filter`
- Kernel integration: wired up steps 23, 25, 26, 29, 30 of kernel roadmap
- Memory system tests (78 tests)
- UI module tests (185 tests across 6 files)
- Data-driven documentation: YAML data layer, doc generator, 22 screenshots, 21-page guide

### Fixed
- `ext_screenshot` overflow bug
- Terminal `cd` with dotfiles
- 2 pre-existing test failures (TabWatcher, WSH roadmap consistency)

## [0.1.0-beta] — Phase 10: Package Extraction

### Changed
- All core packages extracted to standalone npm repos, published, and deployed
- All test imports rewritten to use npm packages via bridge modules
- `web/packages-*.js` bridge files re-export from npm packages

## Phase 9.11 — Subsystem Wiring

### Added
- Wire code collision fix (21 codes migrated)
- 11 subsystems wired into bootstrap
- SW mesh routing, WebTransport bridge, cross-origin comms, WebRTC mesh
- Mesh DevTools inspector (5 new modules, 139 new tests)

## OpenClaw Final — Channel Gateway

### Added
- `clawser-gateway.js` — scheduler/routine lane through gateway
- Kernel tenantId threading, per-channel serialized queues, virtual channel keys
- 105 gateway tests

## Phase 9 — BrowserMesh Integration

### Added
- 30 new modules for decentralized mesh: identity, trust, CRDT sync, P2P transport, naming, real transports, resource scheduling, payments, consensus, swarm coordination

## Phase 8 — Remote Runtime Access (wsh)

### Added
- Canonical runtime registry, session broker, reverse host parity
- VM console peers, route policy, remote filesystems, audit convergence

## Phase 7 — Virtual Server Subsystem

### Added
- SW fetch intercept, ServerManager, function/static/proxy handlers
- 8 agent tools, FetchTool auto-routing, kernel svc:// integration, Servers UI panel

## 0.1.0-beta — Feature Module Integrations

### Added
- 9 feature module integrations with 36 new agent tools
- Phase 2 UI/agent loop wiring for all 30 blocks

## Batch 3 — Panel Enhancements

### Fixed
- 9 API mismatch fixes
- Panel enhancements and agent loop integration

## Batch 2 — Router & State

### Changed
- Router single source of truth
- State namespacing

## Batch 1 — Security Fixes

### Fixed
- Critical security and safety fixes across 7 areas

## Phase 3 — Feature Modules

### Added
- Blocks 12 (git), 13 (hardware), 14 (channels), 15 (remote), 16 (OAuth), 18 (browser auto), 21 (routines), 28 (sandbox), 29 (heartbeat)

## Phase 2 — Infrastructure

### Added
- Blocks 0 (bridge→wsh), 2 (mount), 3 (daemon), 8 (goals), 9 (delegation), 10 (metrics), 11 (fallback), 17 (skills registry), 19 (auth), 22 (self-repair), 24 (tool builder), 25 (undo), 27 (intent)

## Phase 1 — Core Systems

### Added
- Blocks 1 (shell), 4 (memory), 5 (vault), 6 (autonomy), 7 (identity), 20 (hooks), 23 (safety), 26 (cache)

## Phase 0 — Initial Release

### Added
- Full codebase: pure JS agent, modular UI, providers, tools, tests
- Post-modularization fixes
