# Threat model

Scope: the ContextVerity plugins running inside a Backstage backend, their HTTP API
and actions, their database tables, and their telemetry. The demo lab is out of scope.

**Assets:** the integrity of verdicts; the confidentiality of context (only
authorized consumers learn it); the integrity of receipts; operational metadata in
telemetry.

**Trust assumptions:** the Backstage backend and its configuration are trusted; the
catalog is the source of truth (ContextVerity verifies _that_ it changed, not
_whether it is right_); Backstage authentication correctly identifies callers; the
server clock is reasonably correct; the database is protected by the platform.

Legend: **Mitigated** (implemented and tested), **Partial**, **Not addressed**
(documented limitation).

| Threat                                                                     | Status                                  | How                                                                                                                                                             | Evidence              |
| -------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Stale context reused after a source change                                 | Mitigated                               | field-level comparison on verify                                                                                                                                | S02–S07, S16, S39     |
| Context substitution (receipt reused for another subject)                  | Mitigated                               | `SUBJECT_MISMATCH`                                                                                                                                              | S15                   |
| Receipt tampering by the client                                            | Mitigated                               | server-authoritative receipts; client copies ignored                                                                                                            | design; S30           |
| Receipt tampering in storage                                               | Mitigated with secret / Partial without | HMAC-SHA256 tag (or SHA-256 without a secret); no downgrade                                                                                                     | S30, unit tests       |
| Consumer identity mismatch / receipt theft                                 | Mitigated                               | `CONSUMER_MISMATCH`, checked before any source read                                                                                                             | S11, integration test |
| Permission revocation                                                      | Mitigated                               | permissions re-evaluated on every verify                                                                                                                        | S10, S31              |
| Sensitivity escalation                                                     | Mitigated                               | `CLASSIFICATION_RAISED` → DENY above the ceiling                                                                                                                | S09, S26              |
| Entity deletion                                                            | Mitigated                               | `SOURCE_DELETED`                                                                                                                                                | S16                   |
| Entity recreated under the same ref                                        | Mitigated                               | identity (UID) comparison → `ENTITY_RECREATED`                                                                                                                  | S17                   |
| API definition change                                                      | Mitigated                               | definition digest; MCP remotes digest                                                                                                                           | S04, S49              |
| Ownership change                                                           | Mitigated                               | `OWNER_CHANGED`                                                                                                                                                 | S02, S48              |
| Dependency drift                                                           | Mitigated                               | `DEPENDENCY_CHANGED`                                                                                                                                            | S06, S07              |
| Policy change                                                              | Mitigated                               | semantic digest; narrowed/removed → DENY                                                                                                                        | S18–S20, S41, S42     |
| TTL expiry                                                                 | Mitigated                               | exclusive boundary, server clock                                                                                                                                | S12, S35              |
| Source unavailable / partial failure                                       | Mitigated                               | never VALID; REFRESH or DENY with `denyOn`                                                                                                                      | S21, S22              |
| Malicious or incorrect source metadata                                     | Partial                                 | unknown classification fails closed (S23); a _wrong but well-formed_ value is trusted                                                                           | S23                   |
| Cross-tenant leakage                                                       | Partial                                 | consumer binding; per-caller listing; readers need `contextverity.receipt.read` (users) or an explicit allowlist (services) **and** read access to every source | integration tests     |
| Service principal reads others' receipts via Backstage's permission bypass | Mitigated                               | services need `contextverity.receiptReaders`                                                                                                                    | integration test      |
| History tampering by failed verification attempts                          | Mitigated                               | only bound-consumer verifications are recorded, with the verifying principal                                                                                    | integration test      |
| Replay of an old receipt                                                   | Mitigated                               | every verify re-checks current state; TTL                                                                                                                       | S12, S32              |
| Receipt from another environment                                           | Mitigated                               | `ISSUER_MISMATCH`                                                                                                                                               | S36                   |
| TOCTOU between verify and act                                              | **Not addressed**                       | point-in-time verdict; characterized                                                                                                                            | S40, ADR 0007         |
| Clock skew                                                                 | Partial                                 | only the server clock is used; multi-replica skew shifts expiry by the skew                                                                                     | —                     |
| Provider compromise (catalog returns attacker data)                        | Not addressed                           | source truth is trusted                                                                                                                                         | —                     |
| Telemetry leakage                                                          | Mitigated                               | no context values on spans; bounded metric labels                                                                                                               | telemetry tests       |
| Prompt injection inside context documents                                  | **Not addressed**                       | ContextVerity does not read or judge document content                                                                                                           | —                     |
| Malicious documentation content                                            | Not addressed                           | only the `techdocs-ref` annotation is tracked                                                                                                                   | —                     |
| Static-token agents via MCP lose identity                                  | Partial                                 | refused by default (no policy for `plugin:mcp-actions`)                                                                                                         | demo-mcp, ADR 0006    |
| Service principals bypass permission policies                              | Partial (upstream)                      | recorded as `basis: service-principal`; revoke via policy                                                                                                       | S42, S50              |
| Denial of service via expensive verifies                                   | Partial                                 | one catalog batch read per verify; Backstage auth required; no rate limit in v0.1                                                                               | benchmarks            |

## Out of scope

ContextVerity is not a prompt-injection detector, a content scanner, a data-loss
prevention system or an action firewall, and it does not decide whether any
natural-language content is truthful or safe. It can record the provenance and the
declared classification of a source.
