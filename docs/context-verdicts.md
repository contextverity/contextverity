# Verdict semantics

This page is the contract. The implementation is `evaluate()` and `checkBinding()` in
`plugins/contextverity-core/src/engine.ts`; every rule below is exercised by at least
one scenario in `test/scenarios/src/scenarios.ts`.

## The three verdicts

- **`VALID`** — at verification time, the receipt's context matched the source state,
  the consumer's permissions, the policy and the TTL. It is **not** a guarantee that
  nothing changes before the consumer acts ([ADR 0007](adr/0007-toctou-semantics.md)).
- **`REFRESH`** — the context is no longer current (or could not be checked), but
  nothing indicates the consumer is prohibited from it. Resolve fresh context before
  acting.
- **`DENY`** — current authorization, classification, binding or policy no longer
  permits this context for the stated use. Do not use it.

## Algorithm

1. **Integrity.** If the stored receipt fails its integrity tag →
   `RECEIPT_INTEGRITY_FAILED` (DENY). Stop.
2. **Binding.** Issuer differs → `ISSUER_MISMATCH`; caller is not the consumer →
   `CONSUMER_MISMATCH`. Either → DENY. Stop **without reading any source**, so a
   non-consumer learns nothing about current state.
3. **Intent** (each optional in the request body): different `subject` →
   `SUBJECT_MISMATCH`; different `purpose` → `PURPOSE_MISMATCH`; `categories` outside
   the receipt → `SCOPE_EXCEEDED`. All DENY.
4. **Policy.** Missing → `POLICY_REMOVED` (DENY). Digest changed: if it no longer
   covers the receipt → `POLICY_NARROWED` (DENY), else `POLICY_CHANGED` (NONE). The
   effective ceiling is the lower of the grant's and the current policy's; the
   effective TTL uses the current `maxTtlSeconds`.
5. **Time.** `now ≥ min(validUntil, issuedAt + maxTtlSeconds)` → `TTL_EXPIRED`
   (REFRESH). The boundary is exclusive: at exactly `validUntil` the context is
   expired; 1 ms earlier it is not (S35). Only the server clock is used.
6. **Permissions.** Re-evaluated now for the consumer; any DENY →
   `PERMISSION_REVOKED` (DENY). The issue-time decision is never reused.
7. **Sources.** For each recorded source, the provider's observation:
   - unavailable → `SOURCE_UNAVAILABLE` (REFRESH if required, NONE if optional);
   - not found → `SOURCE_DELETED` (REFRESH);
   - malformed → `SOURCE_MALFORMED` (DENY);
   - otherwise, if identity or digest differ: identity → `ENTITY_RECREATED`;
     classification up → `CLASSIFICATION_RAISED` (DENY above the effective ceiling,
     else REFRESH); down → `CLASSIFICATION_LOWERED` (REFRESH); each changed field in a
     granted category → its code (REFRESH if the category is in `requireFresh`, else
     NONE). A digest change with no recorded field change → `SOURCE_CHANGED`.
8. **denyOn** escalates listed codes from REFRESH to DENY.
9. **Verdict** = DENY if any item is DENY, else REFRESH if any is REFRESH, else VALID.
   Items are sorted by effect (DENY first), code, source and field, so identical
   inputs produce identical output (S28: 25 concurrent verifications, one result).

## Choices worth knowing

| Situation                            | Verdict          | Why                                                                                                                     |
| ------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Entity deleted                       | REFRESH          | Not an authorization signal; a fresh resolve will report `SUBJECT_NOT_FOUND`. Escalate with `denyOn: [SOURCE_DELETED]`. |
| Entity recreated (new UID)           | REFRESH          | Same ref, different object; escalate with `denyOn: [ENTITY_RECREATED]`.                                                 |
| Classification raised within ceiling | REFRESH          | Still permitted, but the context changed.                                                                               |
| Classification lowered               | REFRESH          | The source changed; the receipt keeps its original ceiling.                                                             |
| Source unavailable                   | REFRESH          | Cannot confirm; never VALID. Escalate with `denyOn: [SOURCE_UNAVAILABLE]`.                                              |
| Unknown classification value         | DENY             | Cannot check the ceiling, so fail closed.                                                                               |
| Permission check throws              | error (HTTP 5xx) | No verdict is better than a guessed one.                                                                                |

## Resolve refusals

`POST /v1/resolve` refuses with a typed code instead of issuing a receipt:
`NO_MATCHING_POLICY`, `AMBIGUOUS_POLICY`, `CATEGORY_NOT_GRANTED`,
`SOURCE_NOT_PERMITTED`, `CLASSIFICATION_EXCEEDS_GRANT`, `PERMISSION_DENIED` (403),
`SUBJECT_NOT_FOUND` (404), `SOURCE_UNAVAILABLE`, `SOURCE_MALFORMED` (503).
