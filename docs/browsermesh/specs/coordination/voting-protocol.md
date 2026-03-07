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

The module also defines two local wire codes not in the canonical registry:

| Name               | Code   | Description                                  |
|--------------------|--------|----------------------------------------------|
| CONSENSUS_CLOSE    | `0xAA` | Close a proposal (author or timeout)         |
| CONSENSUS_RESULT   | `0xAB` | Broadcast final results of a closed proposal |

Note: `0xAA` and `0xAB` overlap with `RESOURCE_CLAIM` and `RESOURCE_RELEASE` in the canonical registry. These local constants are used within the module only.

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
| `constructor({ maxProposals? })`                | --                                       | Default max 1000 active proposals              |
| `propose(authorPodId, title, options, voteType, opts?)` | `Proposal`                       | Create and register a new proposal             |
| `getProposal(proposalId)`                       | `Proposal \| null`                       | Lookup by ID                                   |
| `vote(proposalId, voterPodId, choice, weight?)` | `Ballot`                                 | Cast a vote; throws if not found or invalid    |
| `closeProposal(proposalId)`                     | `{ winner, results }`                    | Close and return final tally                   |
| `getTally(proposalId)`                          | `Tally \| null`                          | Get tally for a proposal                       |
| `listProposals({ status? })`                    | `Proposal[]`                             | List all or filter by status                   |
| `expireAll(now?)`                               | `number`                                 | Expire past-deadline proposals; returns count  |
| `size`                                          | `number`                                 | Getter: total tracked proposals                |

## Implementation Status

**Status: Implemented, not wired to app bootstrap.**

- All classes (`Proposal`, `Ballot`, `Tally`, `ConsensusManager`) are fully implemented with validation, serialization, and deserialization.
- Wire codes are defined but no transport integration exists -- proposals and votes are managed in-memory only.
- No integration with `ClawserPod.initMesh()` or any bootstrap path.
- Test file: `web/test/clawser-mesh-consensus.test.mjs`

## Source File Reference

`web/clawser-mesh-consensus.js` -- 619 lines, pure ES module, no browser-only imports.
