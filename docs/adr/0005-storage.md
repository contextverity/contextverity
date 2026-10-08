# ADR 0005: Storage

**Status:** accepted (2026-10-08)

## Decision

Use the Backstage database service (`coreServices.database`, Knex) with migrations
shipped in `@contextverity/plugin-contextverity-node`. Two tables:
`contextverity_receipts` (insert-only; body as JSON text, denormalized columns for
listing, integrity tag) and `contextverity_verifications` (append-only). SQLite in
development and tests, PostgreSQL in production — whatever Backstage is configured
with. A scheduled task enforces retention.

## Consequences

- No custom database framework; standard Backstage operations apply.
- Receipts survive restarts (S29).
- Denormalized columns are for listing only; verification uses the integrity-checked
  body.
