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

`web/clawser-mesh-swarm.js` also defines four SWIM protocol wire codes as
local module constants (not imported from the canonical registry):

| Name                | Code   | Description                        |
|---------------------|--------|-------------------------------------|
| SWIM_PING           | `0xF0` | SWIM failure-detection ping        |
| SWIM_ACK            | `0xF1` | SWIM ping acknowledgement          |
| SWIM_PING_REQ       | `0xF2` | SWIM indirect ping request         |
| SWIM_PING_ACK       | `0xF3` | SWIM indirect ping acknowledgement |

## API Surface

### Enums

**SwarmRole** -- frozen array: `['leader', 'follower', 'candidate']`

**TaskStrategy** -- frozen array: `['leader-follower', 'round-robin', 'load-balanced', 'redundant', 'pipeline']`

**TASK_STATUSES** -- frozen array: `['pending', 'assigned', 'running', 'completed', 'failed']`

**SWIM_MEMBER_STATES** -- frozen array: `['alive', 'suspect', 'dead', 'left']`

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
Internally tracks *multiple* named swarms (keyed by `swarmId`); a `'local'`
swarm always exists and is the default target when `swarmId` is omitted, which
is what the single-swarm getters below (`election`, `distributor`, `swarmSize`,
`isLeader`) always refer to.

| Method / Property                                      | Returns           | Description                                    |
|----------------------------------------------------------|-------------------|------------------------------------------------|
| `constructor(localPodId, opts?)`                       | --                | Creates the `'local'` swarm (election + distributor, self as first member); `opts.swim` wires an optional `SwimMembership` instance |
| `election`                                             | `LeaderElection`  | Getter: `'local'` swarm's election instance    |
| `distributor`                                          | `TaskDistributor` | Getter: `'local'` swarm's distributor instance |
| `swim`                                                 | `SwimMembership\|null` | Getter: SWIM membership instance, if provided |
| `createSwarm(swarmId)`                                 | `boolean`         | Explicitly create a new (empty) swarm; `false` if it already existed |
| `disbandSwarm(swarmId)`                                | `boolean`         | Remove a swarm's state; throws for `'local'`   |
| `hasSwarm(swarmId)`                                    | `boolean`         | Whether a swarm is tracked                     |
| `listSwarms()`                                         | `object[]`        | `{ swarmId, size, isLeader, leader, taskCount }` per swarm |
| `listMembers(swarmId?)`                                | `string[]`        | Member podIds of a swarm (default `'local'`)   |
| `join(podId, capabilities?, swarmId?)`                 | `SwarmMember`     | Add a member to a swarm (default `'local'`); also registers with SWIM when joining `'local'` |
| `leave(podId, swarmId?)`                               | `boolean`         | Remove a member from a swarm (default `'local'`) |
| `submitTask(description, strategy?, input?, swarmId?)` | `SwarmTask`       | Create, distribute, and store a task in a swarm (default `'local'`) |
| `getTask(taskId)`                                      | `SwarmTask\|null` | Lookup task by ID across all swarms            |
| `completeTask(taskId, output?)`                        | `boolean`         | Mark task completed                            |
| `failTask(taskId, error?)`                              | `boolean`         | Mark task failed                               |
| `cancelTask(taskId)`                                   | `boolean`         | Cancel a pending/assigned task (no-op if already completed/failed) |
| `listTasks({ status?, swarmId? })`                     | `SwarmTask[]`     | List tasks; `swarmId` defaults to `'local'`, pass `'*'` for all swarms |
| `swarmSize`                                            | `number`          | Getter: `'local'` swarm member count           |
| `isLeader`                                             | `boolean`         | Getter: true if local pod is elected leader of `'local'` |

### SwimMembership

Implements the SWIM protocol (Scalable Weakly-consistent Infection-style
Membership) for decentralized failure detection, optionally wired into
`SwarmCoordinator` via `opts.swim`. Each tick, the local node pings a random
member; on timeout it asks `indirectPingCount` random peers to ping
indirectly; if still unresponsive the member is marked `suspect`, then `dead`
after `suspectTimeoutMs`.

| Method / Property                        | Returns        | Description                                    |
|-------------------------------------------|----------------|--------------------------------------------------|
| `constructor({ localId, sendFn, pingIntervalMs?, pingTimeoutMs?, suspectTimeoutMs?, indirectPingCount?, onJoin?, onSuspect?, onDead?, onLeave?, nowFn? })` | -- | `pingIntervalMs` 1000, `pingTimeoutMs` 500, `suspectTimeoutMs` 5000, `indirectPingCount` 3 |
| `localId`                                 | `string`       | Getter: this node's ID                          |
| `size`                                     | `number`       | Getter: total member count                      |
| `aliveCount`                               | `number`       | Getter: count of members in `alive` state        |
| `start()` / `stop()`                       | `void`         | Begin/end periodic ping rounds                   |
| `addMember(podId)`                         | `void`         | Add a member as `alive`; fires `onJoin`          |
| `removeMember(podId)`                      | `void`         | Mark a member `left`; fires `onLeave`            |
| `getState(podId)`                          | `string\|null` | One of `SWIM_MEMBER_STATES`, or `null` if unknown |
| `getMembers()`                              | `Map`          | Copy of the full membership map                  |
| `aliveMembers()`                            | `string[]`     | podIds currently `alive`                         |
| `handleMessage(fromId, msg)`               | `void`         | Dispatch an incoming `SWIM_PING`/`SWIM_ACK`/`SWIM_PING_REQ`/`SWIM_PING_ACK` message |
| `toJSON()`                                 | `object`       | Serialize membership state                       |

`SwarmCoordinator` wires `swim.onJoin`/`swim.onDead` to its own `join()`/`leave()`
for the `'local'` swarm only — SWIM does not track membership for other named
swarms.

## Implementation Status

**Status: Implemented, wired to app bootstrap via `ClawserPod.initMesh()`.**

- All classes fully implemented with validation, serialization, and lifecycle management.
- `SWARM_*` wire codes imported from the canonical registry; `SWIM_*` wire codes are local constants defined in-module.
- `SwarmCoordinator` is instantiated during `ClawserPod.initMesh()` mesh initialization, along with a `SwimMembership` instance passed via `opts.swim`.
- Multi-swarm support (`createSwarm`/`disbandSwarm`/`hasSwarm`/`listSwarms`/`listMembers`, and the `swarmId` parameter on `join`/`leave`/`submitTask`/`listTasks`) is implemented.
- Transport integration uses the wire codes for join/leave/heartbeat/task-assign messages over the mesh.
- Test file: `web/test/clawser-mesh-swarm.test.mjs`

## Source File Reference

`web/clawser-mesh-swarm.js` -- 1440 lines, imports `MESH_TYPE` from `web/packages/mesh-primitives/src/constants.mjs`.
