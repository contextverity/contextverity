# Context model

ContextVerity uses a small set of concepts. Types live in
`plugins/contextverity-common/src/types.ts`.

| Concept             | What it is                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ContextRequest**  | `ResolveRequest`: subject (entity ref), purpose, categories, optional TTL and policy ID. The consumer is the authenticated caller.                                                          |
| **ContextSnapshot** | The normalized source records resolved for a request, with their digests, the permission decisions and the overall classification. Captured inside the receipt; `snapshotDigest` covers it. |
| **ContextGrant**    | What the matching policy allowed for this receipt: consumer, purpose, subject, categories, source kinds, sensitivity ceiling, TTL, policy ID and digest. Never widened later.               |
| **ContextReceipt**  | The immutable, server-authoritative record of what was issued. See [context-receipts.md](context-receipts.md).                                                                              |
| **ContextDrift**    | Typed differences between receipt time and now (`DriftItem`).                                                                                                                               |
| **ContextVerdict**  | `VALID`, `REFRESH` or `DENY`. See [context-verdicts.md](context-verdicts.md).                                                                                                               |
| **ContextSource**   | A provider of normalized records (`ContextSourceProvider`).                                                                                                                                 |
| **ContextPolicy**   | Who may receive which context for what purpose. See [context-grants.md](context-grants.md).                                                                                                 |

## Source records

A `SourceRecord` is provider-neutral:

| Field            | Meaning                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `sourceId`       | Stable ID, e.g. `catalog:component:default/payments`, `apidef:api:default/payments-api`                                              |
| `kind`           | `CATALOG_ENTITY`, `API_DEFINITION` (also defined: `DOCUMENTATION`, `RELATION`, `POLICY`, `CUSTOM` for future providers)              |
| `provider`       | e.g. `backstage-catalog`                                                                                                             |
| `identity`       | Authoritative identity of the object — Backstage `metadata.uid`. Changes when an entity is deleted and recreated under the same ref. |
| `required`       | Whether the context is unusable without this source (all Backstage records are required in v0.1).                                    |
| `classification` | `PUBLIC` < `INTERNAL` < `RESTRICTED`                                                                                                 |
| `fields`         | Normalized values, each with a category                                                                                              |
| `digest`         | SHA-256 over the canonical record (excluding `required`)                                                                             |

## Categories and fields (Backstage provider)

| Category         | Fields                                                                         | Source                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `identity`       | `type`                                                                         | `spec.type`                                                                                                           |
| `ownership`      | `owner`                                                                        | `ownedBy` relations                                                                                                   |
| `lifecycle`      | `lifecycle`                                                                    | `spec.lifecycle`                                                                                                      |
| `dependencies`   | `system`, `dependsOn`, `dependencyOf`, `consumesApis`                          | `partOf`, `dependsOn`, `dependencyOf`, `consumesApi` relations                                                        |
| `apis`           | `providesApis`                                                                 | `providesApi` relations                                                                                               |
| `api-definition` | `apiType`, `lifecycle`, `definitionDigest` (separate `API_DEFINITION` records) | API entities: `spec.type`, `spec.lifecycle`, SHA-256 of `spec.definition`, or of `spec.remotes` for `mcp-server` APIs |
| `documentation`  | `techdocsRef`                                                                  | `backstage.io/techdocs-ref` annotation                                                                                |

Relation lists are normalized to sorted, de-duplicated, lowercase refs. Labels,
tags, title, description, links, `metadata.etag` and annotations other than the two
listed are **ignored**: changing them does not invalidate context (scenarios S14,
S34).

Only fields in the requested (and granted) categories are recorded. A receipt never
contains context outside its grant.

## Drift

Each `DriftItem` has a typed `code`, an `effect` (`NONE`, `REFRESH`, `DENY`), and
optionally `sourceId`, `field`, `before`, `after`, plus a human-readable `detail`.

| Code                       | Default effect                                | When                                                                    |
| -------------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `OWNER_CHANGED`            | REFRESH                                       | `owner` changed                                                         |
| `LIFECYCLE_CHANGED`        | REFRESH                                       | `lifecycle` changed                                                     |
| `API_CHANGED`              | REFRESH                                       | `providesApis`, `apiType` or `definitionDigest` changed                 |
| `API_DEPRECATED`           | REFRESH                                       | an API record's lifecycle became `deprecated`                           |
| `DEPENDENCY_CHANGED`       | REFRESH                                       | `dependsOn`, `dependencyOf` or `consumesApis` changed                   |
| `RELATION_CHANGED`         | REFRESH                                       | `system` changed                                                        |
| `DOCUMENTATION_CHANGED`    | REFRESH                                       | `techdocsRef` changed                                                   |
| `SOURCE_CHANGED`           | REFRESH                                       | `type` changed, or the digest changed without a recorded field changing |
| `CLASSIFICATION_RAISED`    | REFRESH within the ceiling, **DENY** above it | classification increased                                                |
| `CLASSIFICATION_LOWERED`   | REFRESH                                       | classification decreased (the receipt keeps its original grant)         |
| `ENTITY_RECREATED`         | REFRESH                                       | `identity` (UID) changed under the same ref                             |
| `SOURCE_DELETED`           | REFRESH                                       | source no longer exists                                                 |
| `SOURCE_UNAVAILABLE`       | REFRESH (required) / NONE (optional)          | source could not be read                                                |
| `SOURCE_MALFORMED`         | **DENY**                                      | source could not be normalized (e.g. unknown classification)            |
| `PERMISSION_REVOKED`       | **DENY**                                      | a current permission decision is DENY                                   |
| `POLICY_CHANGED`           | NONE                                          | policy digest changed but still covers the receipt                      |
| `POLICY_NARROWED`          | **DENY**                                      | current policy no longer covers the receipt                             |
| `POLICY_REMOVED`           | **DENY**                                      | policy no longer exists                                                 |
| `TTL_EXPIRED`              | REFRESH                                       | `now ≥` effective expiry                                                |
| `CONSUMER_MISMATCH`        | **DENY**                                      | caller is not the bound consumer                                        |
| `SUBJECT_MISMATCH`         | **DENY**                                      | intent names another subject                                            |
| `PURPOSE_MISMATCH`         | **DENY**                                      | intent names another purpose                                            |
| `SCOPE_EXCEEDED`           | **DENY**                                      | intent asks for categories outside the receipt                          |
| `ISSUER_MISMATCH`          | **DENY**                                      | receipt issued by another instance                                      |
| `RECEIPT_INTEGRITY_FAILED` | **DENY**                                      | stored receipt does not match its integrity tag                         |

A policy's `requireFresh` turns drift in categories it does not list into `NONE`;
`denyOn` escalates listed REFRESH codes to DENY. See [context-grants.md](context-grants.md).
