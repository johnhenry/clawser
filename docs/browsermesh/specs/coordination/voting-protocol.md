# Voting Protocol

## Overview

The voting protocol provides structured consensus-building for BrowserMesh peers. It supports four vote types (simple majority, super majority, unanimous, weighted), enforces quorum requirements, and tracks proposal lifecycle from creation through closure or expiration. The `ConsensusManager` orchestrates the full propose/vote/close workflow.

Source: `web/clawser-mesh-consensus.js`

## Wire Codes

From the canonical registry (`web/packages/mesh-primitives/src/constants.mjs`):

| Name               | Code   | Description                                  |
|--------------------|--------|----------------------------------------------|
| CONSENSUS_PROPOSE  | `0xA8` | Broadcast a new proposal to the mesh         |
| CONSENSUS_VOTE     | `0xA9` | Submit a vote on a proposal                  |
| CONSENSUS_CLOSE    | `0xEB` | Close a proposal (author or timeout)         |
| CONSENSUS_RESULT   | `0xEC` | Broadcast final results of a closed proposal |

All four codes are part of the canonical registry (`MESH_TYPE` in
`browsermesh-primitives`'s `constants.mjs`, `0xC0`-`0xEC` "extended subsystems"
range) — they are not local-only constants, and they do not overlap with
`RESOURCE_CLAIM` (`0xAA`) / `RESOURCE_RELEASE` (`0xAB`), which are separate,
unrelated codes. `clawser-pod.js` wires all four together as
`0xA8/0xA9/0xEB/0xEC` when constructing `ConsensusManager`'s transport.

## API Surface

### VoteType (enum)

Frozen object with four string values:

- `SIMPLE` (`'simple'`) -- passes with > 50% of votes
- `SUPER` (`'super'`) -- passes with > 66.7% of votes
- `UNANIMOUS` (`'unanimous'`) -- passes only with 100% agreement
- `WEIGHTED` (`'weighted'`) -- passes with > 50% of total weight

### Proposal

Represents a votable proposal with lifecycle tracking.

**Constructor fields:** `proposalId`, `authorPodId`, `title`, `description?`, `options` (string[], min 2), `voteType`, `weights?` (Map or object), `quorum` (positive number), `deadline?` (unix ms), `createdAt`, `status` (`'open'` | `'closed'` | `'expired'`).

| Method / Property        | Returns              | Description                               |
|--------------------------|----------------------|-------------------------------------------|
| `isExpired(now?)`        | `boolean`            | True if deadline has passed               |
| `toJSON()`               | `object`             | Serialize to plain object                 |
| `Proposal.fromJSON(data)`| `Proposal`           | Static deserializer                       |

### Ballot

An individual vote cast by a peer.

**Constructor fields:** `proposalId`, `voterPodId`, `choice`, `weight` (default 1), `timestamp`, `signature?`.

| Method                   | Returns   | Description           |
|--------------------------|-----------|-----------------------|
| `toJSON()`               | `object`  | Serialize             |
| `Ballot.fromJSON(data)`  | `Ballot`  | Static deserializer   |

### Tally

Aggregates ballots for a single Proposal and determines the outcome.

| Method / Property        | Returns                                            | Description                                    |
|--------------------------|----------------------------------------------------|------------------------------------------------|
| `cast(ballot)`           | `void`                                             | Record a ballot; throws on duplicate/invalid   |
| `getResults()`           | `Map<string, { votes, weight }>`                   | Per-choice vote and weight totals              |
| `getWinner()`            | `{ choice, votes, weight, passed } \| null`        | Winning choice with pass/fail based on VoteType|
| `totalVotes`             | `number`                                           | Getter: number of ballots cast                 |
| `totalWeight`            | `number`                                           | Getter: sum of all ballot weights              |
| `hasQuorum`              | `boolean`                                          | Getter: true if ballots >= quorum              |
| `voterList`              | `string[]`                                         | Getter: list of voter pod IDs                  |
| `proposal`               | `Proposal`                                         | Getter: the tracked proposal                   |
| `toJSON()` / `fromJSON()`| `object` / `Tally`                                | Serialization round-trip                       |

### ConsensusManager

Top-level orchestrator managing multiple proposals.

| Method / Property                               | Returns                                  | Description                                    |
|-------------------------------------------------|------------------------------------------|------------------------------------------------|
| `constructor({ maxProposals?, validators? })`   | --                                       | Default max 1000 active proposals; optional initial validator podId set (empty = open membership) |
| `addValidator(podId)`                           | `void`                                    | Add a podId to the validator set; once non-empty, `propose`/`vote` are gated to validators only |
| `removeValidator(podId)`                        | `boolean`                                 | Remove a podId from the validator set          |
| `listValidators()`                              | `string[]`                                | List registered validator podIds               |
| `isValidator(podId)`                            | `boolean`                                 | Always `true` when the validator set is empty (open membership) |
| `propose(authorPodId, title, options, voteType, opts?)` | `Proposal`                       | Create and register a new proposal; throws if `authorPodId` is not a validator |
| `getProposal(proposalId)`                       | `Proposal \| null`                       | Lookup by ID                                   |
| `vote(proposalId, voterPodId, choice, weight?)` | `Ballot`                                 | Cast a vote; throws if not found, invalid, or `voterPodId` is not a validator |
| `closeProposal(proposalId)`                     | `{ winner, results }`                    | Close and return final tally                   |
| `getTally(proposalId)`                          | `Tally \| null`                          | Get tally for a proposal                       |
| `listProposals({ status? })`                    | `Proposal[]`                             | List all or filter by status                   |
| `expireAll(now?)`                               | `number`                                 | Expire past-deadline proposals; returns count  |
| `size`                                          | `number`                                 | Getter: total tracked proposals                |
| `wireTransport(broadcastFn, subscribeFn)`       | `void`                                    | Wire the four `CONSENSUS_*` wire codes to a mesh transport (subscribes to incoming propose/vote/close/result and exposes `broadcastProposal`/`broadcastVote`/`broadcastClose`/`broadcastResult`) |

The validator set is a membership gate on who may `propose`/`vote` — it is not
a Byzantine-fault-tolerant consensus protocol. This class implements plain
majority/super-majority/unanimous/weighted voting only (no pre-prepare/
prepare/commit rounds, no view changes, no 3f+1 quorum guarantee). A separate,
opt-in PBFT implementation (`raijin-consensus` package) is wired in
`ClawserPod.initMesh({ enablePBFT: true, ... })` using its own wire codes
(`PBFT_PRE_PREPARE`, `PBFT_PREPARE`, `PBFT_COMMIT`, `PBFT_VIEW_CHANGE`,
`PBFT_NEW_VIEW`) — that protocol is out of scope for this document.

## Implementation Status

**Status: Implemented and wired to app bootstrap.**

- All classes (`Proposal`, `Ballot`, `Tally`, `ConsensusManager`) are fully implemented with validation, serialization, and deserialization.
- `ConsensusManager` is instantiated in `ClawserPod.initMesh()` and exposed via the pod's `consensusManager` getter.
- Wire codes (`CONSENSUS_PROPOSE`, `CONSENSUS_VOTE`, `CONSENSUS_CLOSE`, `CONSENSUS_RESULT`) are defined and used at runtime, wired via `wireTransport()`.
- Pod-level helpers `propose()`, `voteOnProposal()`, and `closeProposal()` expose the protocol to consumers.
- Validator-set gating (`addValidator`/`removeValidator`/`listValidators`/`isValidator`) is implemented.
- Test file: `web/test/clawser-mesh-consensus.test.mjs`

## Source File Reference

`web/clawser-mesh-consensus.js` -- 784 lines, pure ES module, no browser-only imports.
