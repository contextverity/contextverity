# @contextverity/core

Deterministic context receipt and verification engine. No Backstage dependency.

- `canonicalize`, `digestOf`, `integrityTag` — RFC 8785-style canonical JSON, SHA-256, HMAC-SHA256
- `parsePolicy`, `policyDigest`, `policyMatches` — the context policy model
- `evaluate`, `checkBinding` — the pure verdict engine
- `ContextVerity` — resolve / verify / inspect orchestration over `ContextSourceProvider`, `ContextAuthorizer`, `PolicySource` and `ReceiptStore`
- OpenTelemetry API instrumentation (`contextverity.*` spans and metrics)

See the [verdict semantics](../../docs/context-verdicts.md) and [architecture](../../docs/architecture.md).
