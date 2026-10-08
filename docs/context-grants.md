# Context grants and policies

A **context policy** says which consumers may receive which context about which
subjects, for which purposes, for how long, and how strictly it is verified. The
**grant** is the policy as it applied to one receipt; it is stored in the receipt and
never widened.

## Policy schema

```yaml
policies:
  - id: incident-triage # [a-z0-9._-], 1–64 chars
    description: Free text (not part of the policy digest)
    consumers: # principal refs, or "*"
      - user:default/alex
      - service:incident-agent
    purposes: [incident-triage]
    subjects: # all optional; empty means any
      kinds: [component, api, resource, airesource]
      namespaces: [default]
      refs: [] # explicit entity refs
    allowedSourceKinds: [CATALOG_ENTITY, API_DEFINITION]
    allowedCategories:
      [
        identity,
        ownership,
        lifecycle,
        dependencies,
        apis,
        api-definition,
        documentation,
      ]
    sensitivityCeiling: INTERNAL # PUBLIC | INTERNAL | RESTRICTED
    maxTtlSeconds: 900 # 1 .. 2592000
    requireFresh: [ownership] # optional; default = allowedCategories
    denyOn: [OWNER_CHANGED] # optional; escalate REFRESH codes to DENY
```

Policies come from `contextverity.policies` (inline, static) and/or
`contextverity.policyFile` (YAML, re-read on change). Duplicate IDs, unknown kinds,
categories or codes, and invalid values are rejected with every problem listed.
Validation is in `plugins/contextverity-core/src/policy.ts`.

## Selecting a policy at resolve

The policies whose `consumers`, `purposes` and `subjects` all match the request are
candidates (optionally restricted by `policyId`). Zero → `NO_MATCHING_POLICY`; more
than one → `AMBIGUOUS_POLICY` (pass `policyId`). Then:

- requested categories must be within `allowedCategories` (`CATEGORY_NOT_GRANTED`);
- resolved source kinds must be within `allowedSourceKinds` (`SOURCE_NOT_PERMITTED`);
- the context's classification must be at most `sensitivityCeiling`
  (`CLASSIFICATION_EXCEEDS_GRANT`);
- the TTL is `min(requested, maxTtlSeconds)`.

## Policy revision

The policy revision is a SHA-256 over its _semantic_ content: lists treated as sets,
refs lowercased, `requireFresh` defaulted, `description` excluded. Reformatting or
reordering a policy does not change its digest (scenario S18).

## Policy change after issue

| Current policy                                                                                              | Effect on an existing receipt                                               |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Same digest                                                                                                 | nothing                                                                     |
| Changed but still covers the receipt (consumer, purpose, subject, categories, source kinds, classification) | `POLICY_CHANGED`, effect `NONE`; the receipt keeps its original grant (S20) |
| No longer covers the receipt                                                                                | `POLICY_NARROWED` → `DENY` (S19, S42)                                       |
| Removed                                                                                                     | `POLICY_REMOVED` → `DENY` (S41)                                             |

A broader policy never widens an existing receipt: verifying with intent categories
outside the receipt is `SCOPE_EXCEEDED` → `DENY`. A lower `maxTtlSeconds` shortens
existing receipts (effective expiry is `min(validUntil, issuedAt + maxTtlSeconds)`).

## requireFresh and denyOn

- **requireFresh** lists the categories whose drift invalidates context. Drift in
  other granted categories is reported with effect `NONE` (S43).
- **denyOn** escalates selected REFRESH codes to DENY (S22, S44). Policies can only
  make verification stricter; DENY rules such as `PERMISSION_REVOKED` cannot be
  weakened.

## Revoking a service principal

Backstage does not consult permission policies for service principals, so the
Permission Framework cannot revoke a static-token agent's catalog access. Remove the
agent from the policy's `consumers` instead: its existing receipts then verify as
`POLICY_NARROWED` → `DENY` (S42). External-access `accessRestrictions` are the
Backstage-native alternative.
