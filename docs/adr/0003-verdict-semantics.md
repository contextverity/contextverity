# ADR 0003: Verdict semantics

**Status:** accepted (2026-10-08)

## Decision

Three verdicts — VALID, REFRESH, DENY — with every drift item carrying an effect
(NONE, REFRESH, DENY); the verdict is the strongest effect. DENY is reserved for
authorization, classification above the ceiling, binding, integrity, policy and
fail-closed malformed sources. Staleness (field changes, deletion, recreation, TTL,
unavailability) is REFRESH. Policies may escalate REFRESH codes to DENY (`denyOn`) or
mark categories as not requiring freshness (`requireFresh`), but cannot weaken DENY
rules. Binding failures stop evaluation before any source is read. The full rules are
in [context-verdicts.md](../context-verdicts.md).

## Consequences

- Callers have a simple contract: act on VALID, re-resolve on REFRESH, stop on DENY.
- Choices such as "deletion is REFRESH" are explicit and configurable.
- Deterministic ordering of drift items makes results comparable across runs.
