# Swarm Protocol

## Overview

The swarm protocol provides leader election, task distribution, and swarm lifecycle management for BrowserMesh. Peers form a swarm where one node is elected leader via lowest-lexicographic-podId selection. The leader (or any node) can submit tasks that are distributed across members using pluggable strategies: leader-follower, round-robin, load-balanced, redundant, or pipeline.

Source: `web/clawser-mesh-swarm.js`

## Wire Codes

Imported from the canonical registry (`web/packages/mesh-primitives/src/constants.mjs`):

| Name                | Code   | Description                        |
|---------------------|--------|------------------------------------|
| SWARM_JOIN          | `0xC0` | Join a swarm                       |
| SWARM_LEAVE         | `0xC1` | Leave a swarm                      |
| SWARM_HEARTBEAT     | `0xC2` | Swarm heartbeat / liveness         |
| SWARM_TASK_ASSIGN   | `0xC3` | Assign a task within a swarm       |

## API Surface

### Enums

**SwarmRole** -- frozen array: `['leader', 'follower', 'candidate']`

**TaskStrategy** -- frozen array: `['leader-follower', 'round-robin', 'load-balanced', 'redundant', 'pipeline']`

**TASK_STATUSES** -- frozen array: `['pending', 'assigned', 'running', 'completed', 'failed']`

### SwarmMember

Represents a single swarm member. Constructor fields: `podId`, `role` (default `'candidate'`), `load` (0-1), `capabilities` (string[]), `joinedAt`, `lastHeartbeat`. Methods: `isStale(timeoutMs?)`, `toJSON()`, `fromJSON()`.

### SwarmTask

Represents a distributable unit of work. Constructor fields: `taskId?` (auto-generated), `description`, `strategy` (default `'leader-follower'`), `assignedTo` (string[]), `status` (default `'pending'`), `input`, `output`, `createdAt`, `startedAt`, `completedAt`. Methods: `toJSON()`, `fromJSON()`.

### LeaderElection

Deterministic leader election using lowest-lexicographic-podId. Tracks heartbeats for stale leader detection.

| Method / Property                        | Returns        | Description                                    |
|------------------------------------------|----------------|------------------------------------------------|
| `constructor(localPodId, opts?)`         | --             | `heartbeatMs` (5000), `electionTimeoutMs` (15000) |
| `leader`                                 | `string\|null` | Getter: current leader podId                   |
| `role`                                   | `string`       | Getter: `'leader'`, `'follower'`, or `'candidate'` |
| `localPodId`                             | `string`       | Getter: this node's podId                      |
| `candidates`                             | `string[]`     | Getter: sorted candidate list                  |
| `addCandidate(podId)`                    | `void`         | Add a candidate to the pool                    |
| `removeCandidate(podId)`                 | `boolean`      | Remove candidate; clears leader if it was them |
| `elect()`                                | `string`       | Run election; lowest podId wins                |
| `receiveHeartbeat(fromPodId, timestamp?)`| `void`         | Record a heartbeat                             |
| `checkLeaderAlive(now?)`                 | `boolean`      | True if leader heartbeat is fresh              |
| `yieldLeadership()`                      | `string\|null` | Pass leadership to next candidate              |
| `toJSON()` / `fromJSON()`               | `object` / `LeaderElection` | Serialization round-trip         |

### TaskDistributor

Distributes tasks to swarm members using pluggable strategies.

| Method / Property            | Returns          | Description                                    |
|------------------------------|------------------|------------------------------------------------|
| `constructor(members?)`      | --               | Initialize with optional member array          |
| `addMember(member)`          | `void`           | Add a SwarmMember                              |
| `removeMember(podId)`        | `boolean`        | Remove by podId                                |
| `getMember(podId)`           | `SwarmMember\|null` | Lookup by podId                             |
| `members`                    | `SwarmMember[]`  | Getter: all members                            |
| `size`                       | `number`         | Getter: member count                           |
| `distribute(task, strategy?)`| `string[]`       | Assign task to members; returns assigned podIds|

**Strategy behavior:**

- `leader-follower`: assigns to first member (insertion order)
- `round-robin`: rotates through members cyclically
- `load-balanced`: picks member with lowest `load` value
- `redundant`: assigns to ALL members
- `pipeline`: assigns to all members in order (semantically distinct from redundant)

### SwarmCoordinator

High-level facade combining LeaderElection, TaskDistributor, and task lifecycle.

| Method / Property                           | Returns           | Description                                    |
|---------------------------------------------|-------------------|------------------------------------------------|
| `constructor(localPodId, opts?)`            | --                | Creates election + distributor; adds self      |
| `election`                                  | `LeaderElection`  | Getter: underlying election instance           |
| `distributor`                               | `TaskDistributor` | Getter: underlying distributor instance        |
| `join(podId, capabilities?)`                | `SwarmMember`     | Add a member to the swarm                      |
| `leave(podId)`                              | `boolean`         | Remove a member                                |
| `submitTask(description, strategy?, input?)`| `SwarmTask`       | Create, distribute, and store a task           |
| `getTask(taskId)`                           | `SwarmTask\|null` | Lookup task by ID                              |
| `completeTask(taskId, output?)`             | `boolean`         | Mark task completed                            |
| `failTask(taskId, error?)`                  | `boolean`         | Mark task failed                               |
| `listTasks({ status? })`                    | `SwarmTask[]`     | List tasks, optionally filtered                |
| `swarmSize`                                 | `number`          | Getter: member count                           |
| `isLeader`                                  | `boolean`         | Getter: true if local pod is elected leader    |

## Implementation Status

**Status: Implemented, wired to app bootstrap via `ClawserPod.initMesh()`.**

- All classes fully implemented with validation, serialization, and lifecycle management.
- Wire codes imported from the canonical registry.
- `SwarmCoordinator` is instantiated during `ClawserPod.initMesh()` mesh initialization.
- Transport integration uses the wire codes for join/leave/heartbeat/task-assign messages over the mesh.
- Test file: `web/test/clawser-mesh-swarm.test.mjs`

## Source File Reference

`web/clawser-mesh-swarm.js` -- 678 lines, imports `MESH_TYPE` from `web/packages/mesh-primitives/src/constants.mjs`.
