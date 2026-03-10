# ADR: Remote Runtime Policy Precedence

## Status
Accepted

## Decision

Policy precedence is:

1. discovery visibility
2. relay/path permission
3. session admission
4. in-session capability scope

## Consequences

- Trust and ACL can filter/rank candidates early.
- Endpoint auth still decides whether a session is admitted.
- Capability-denied operations remain explainable after a session exists.
