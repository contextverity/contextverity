# Design

## Goals

1. Answer, deterministically: _is the context this consumer is about to rely on
   still current, in scope and permitted?_
2. Integrate with Backstage through supported public APIs only.
3. Keep the decision logic independent of Backstage, so other sources can be added.
4. Make every claim testable: code, test, machine-generated result.

## Non-goals

- Deciding whether context is _true_ or _safe_ in natural language.
- Gating actions ContextVerity does not own (no supported Backstage hook exists).
- Replacing Backstage's catalog, permission framework, actions registry or MCP
  backend.

## Key decisions

| Decision              | Choice                                                                                                 | Record                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Receipt authority     | Server-authoritative receipts with an integrity tag; clients get an opaque ID plus a view              | [ADR 0001](adr/0001-receipt-authority-and-integrity.md) |
| Provider architecture | Normalized `SourceRecord`s behind a `ContextSourceProvider` interface; Backstage is the first provider | [ADR 0002](adr/0002-backstage-provider-architecture.md) |
| Verdict semantics     | Three verdicts; verdict = strongest effect; policies may only escalate                                 | [ADR 0003](adr/0003-verdict-semantics.md)               |
| Canonicalization      | RFC 8785 subset, sets sorted, SHA-256                                                                  | [ADR 0004](adr/0004-canonicalization.md)                |
| Storage               | Backstage database service (Knex), insert-only receipts                                                | [ADR 0005](adr/0005-storage.md)                         |
| MCP                   | Register actions; use the official MCP Actions backend; advisory verification                          | [ADR 0006](adr/0006-mcp-integration-boundaries.md)      |
| TOCTOU                | `VALID` is point-in-time; documented, characterized by a scenario                                      | [ADR 0007](adr/0007-toctou-semantics.md)                |

## Why not trust the issue-time decision?

Every input that can change is re-read at verification: the policy, the
consumer's permissions, the classification, and the source fields. Only the
_binding_ (who, what subject, what purpose, which categories, which issuer) is taken
from the receipt, because it describes what was promised, not the world.

## Why a pure engine?

`evaluate()` takes the receipt, the current policy, observations, current
permission decisions, the intent and `now`, and returns a verdict. Given the same
inputs it returns the same output. The scenario harness exploits this: the same 50
scenarios run against an in-process world and against a live Backstage backend, and
their outcomes must agree.

## Fail-closed choices

| Situation                                   | Outcome                                                      |
| ------------------------------------------- | ------------------------------------------------------------ |
| Integrity tag mismatch                      | `DENY`, no source state read                                 |
| Classification annotation not a known level | `SOURCE_MALFORMED` → `DENY`                                  |
| Policy file unreadable or invalid           | resolve/verify fail (HTTP 503), never proceed without policy |
| Permission evaluation throws                | verification fails (error), never `VALID`                    |
| Required source unavailable                 | `REFRESH` (or `DENY` with `denyOn`)                          |
