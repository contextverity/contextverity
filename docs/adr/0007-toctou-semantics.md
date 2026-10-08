# ADR 0007: TOCTOU semantics

**Status:** accepted (2026-10-08)

## Context

Verification and action are separate steps. Anything can change between them.

## Decision

Define `VALID` as "matched at verification time" and document the gap. We looked for
supported Backstage precondition mechanisms that could make verify-and-act atomic for
arbitrary actions: the catalog exposes `metadata.etag`, but actions in general accept
no precondition, so a generic verify-and-execute would be a false promise. We do not
implement one in v0.1.

Scenario S40 characterizes the gap: a VALID verdict, then a change, then REFRESH on
the next verify. Callers should verify as late as possible and keep TTLs short for
high-impact purposes.

## Consequences

- No overclaiming. A future per-action precondition integration (for actions that
  support optimistic concurrency) is on the roadmap.
