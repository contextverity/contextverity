# ADR 0002: Provider architecture with Backstage first

**Status:** accepted (2026-10-08)

## Context

The receipt schema must not be coupled to Backstage entity JSON, but v0.1 should
integrate Backstage properly rather than spread across many sources.

## Decision

`@contextverity/core` defines a provider-neutral `SourceRecord` (source ID, kind,
provider, identity, classification, categorized fields, digest) and interfaces
`ContextSourceProvider`, `ContextAuthorizer` and `ReceiptStore`. The core has no
Backstage dependency. `@contextverity/plugin-contextverity-node` implements them for
the Backstage catalog, the Permission Framework and the Backstage database service.

The Backstage provider reads source state with the plugin's own credentials (so "not
found" means deleted) and maps a fixed set of fields; everything else on an entity is
ignored to avoid false invalidation.

## Consequences

- The same engine runs against a synthetic catalog (core tier) and real Backstage.
- New providers implement three methods; no engine change.
- Only one provider exists in v0.1.
