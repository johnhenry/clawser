# ADR: Remote Runtime Route Selection

## Status
Accepted

## Decision

Route selection is deterministic and intent-aware.

Base order:

1. direct host PTY
2. reverse host PTY through relay
3. mesh-direct runtime route
4. browser virtual shell through relay
5. VM console through relay
6. mesh-relay fallback

## Consequences

- Humans and automation get the same route choice for the same target and intent.
- Browser shells never outrank real host PTYs for terminal work.
- Future VM peers have a clear, bounded place in the ordering.
