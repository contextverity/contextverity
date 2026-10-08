# Security model

## Principals

| Principal                                       | Ref bound into receipts   | Permission policy consulted?                                   |
| ----------------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| Backstage user                                  | `user:<namespace>/<name>` | yes                                                            |
| Service via external access (static/JWKS token) | `service:<subject>`       | no (Backstage allows services; only `accessRestrictions` deny) |
| Backstage plugin calling on its own             | `service:plugin:<id>`     | no                                                             |

## Guarantees (and their limits)

1. **Only the consumer verifies.** Verification by anyone else returns
   `CONSUMER_MISMATCH` without reading source state.
2. **No context outside the grant.** Resolve refuses categories, source kinds or
   classifications beyond the matching policy; receipts record only granted
   categories; a broader policy later does not widen a receipt.
3. **Current authorization wins.** Every verify re-evaluates permissions and policy.
4. **Receipts are authoritative server-side.** Integrity-tagged; HMAC with a
   configured secret.
5. **Point-in-time.** `VALID` describes verification time only.

## Configuration guidance

- Set a unique `contextverity.issuer` per environment.
- Set `contextverity.integritySecret` from a secret store; rotate by deploying a new
  secret (existing receipts then fail integrity and verify as DENY — re-resolve).
- Keep policies least-privilege: narrow `consumers`, `subjects`, `allowedCategories`
  and `maxTtlSeconds`; use `denyOn` where acting on changed context is dangerous.
- Use user tokens (or direct HTTP calls with per-agent tokens) for agents, not shared
  static tokens through the MCP backend.
- Never enable the demo lab (`packages/backend/src/lab`) outside local development.

## Privacy

Receipts store references, normalized decision inputs (owner refs, lifecycle,
dependency refs, classifications) and digests. They do not store API definitions,
documents, secrets, tokens or user PII beyond principal refs. The retention task
deletes receipts after `retention.days`. The demo uses synthetic data only.

## Cryptography

ContextVerity uses SHA-256 and HMAC-SHA256 from Node's `crypto` module and
`crypto.randomUUID()` for IDs, and constant-time comparison for tags. A digest is not
a signature; receipts are not portable proofs. Portable signed receipts are on the
[roadmap](../ROADMAP.md).
