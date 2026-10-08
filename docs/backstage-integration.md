# Backstage integration

Tested with Backstage **1.55.0** (new backend system, new frontend system), Node 22.

## Install

```ts
// packages/backend/src/index.ts
backend.add(import('@contextverity/plugin-contextverity-backend'));
```

```ts
// packages/app/src/App.tsx
import contextverityPlugin from '@contextverity/plugin-contextverity';
export default createApp({
  features: [catalogPlugin, contextverityPlugin /* … */],
});
```

Install from npm (published with provenance):

```sh
yarn --cwd packages/backend add @contextverity/plugin-contextverity-backend
yarn --cwd packages/app add @contextverity/plugin-contextverity
```

## Configure

```yaml
contextverity:
  issuer: acme-backstage-prod # required; bound into receipts
  defaultClassification: INTERNAL # for entities without the annotation
  integritySecret: ${CONTEXTVERITY_INTEGRITY_SECRET} # optional, enables HMAC tags
  retention:
    days: 30
  receiptReaders: [] # service principals allowed to read others' receipts
  policyFile: /etc/backstage/context-policies.yaml # and/or inline `policies:`

backend:
  actions:
    pluginSources: [catalog, contextverity] # expose ContextVerity actions to MCP
```

Policy format: [context-grants.md](context-grants.md). Config schema:
`plugins/contextverity-backend/config.d.ts`.

## Catalog annotation

```yaml
metadata:
  annotations:
    contextverity.github.io/classification: RESTRICTED # PUBLIC | INTERNAL | RESTRICTED
```

This is the only annotation ContextVerity defines. Its key uses the
`contextverity.github.io` prefix because that is the DNS name the project controls.
Values are case-insensitive; anything else makes the entity `SOURCE_MALFORMED` (fail
closed). ContextVerity does not infer classification from content.

## HTTP API

Mounted at `/api/contextverity`. All endpoints require a Backstage user or service
token.

| Method | Path                       | Who                                                                        | Body / result                                                                                                                                        |
| ------ | -------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/resolve`              | consumer                                                                   | `{subject, purpose, categories, ttlSeconds?, policyId?}` → `201 {receipt, context}` or `403/404/503 {error: {name: "ResolveDenied", code, message}}` |
| POST   | `/v1/receipts/:id/verify`  | consumer                                                                   | `{subject?, purpose?, categories?}` → `ContextVerification`                                                                                          |
| GET    | `/v1/receipts`             | anyone (own receipts) / `contextverity.receipt.read` (all)                 | `?limit&consumer&subject` → `{items}`                                                                                                                |
| GET    | `/v1/receipts/:id`         | consumer, or `contextverity.receipt.read` plus read access to every source | `ReceiptDetail` (others get 404)                                                                                                                     |
| POST   | `/v1/receipts/:id/inspect` | `contextverity.receipt.read` and read access to every source               | `ContextVerification` with `mode: inspect`                                                                                                           |

Backstage's own readiness endpoint (`/.backstage/health/v1/readiness`) covers health.

## Actions and MCP

Two actions are registered with the Actions Registry:

| Action ID                       | MCP tool (via MCP Actions backend) | Purpose                                  |
| ------------------------------- | ---------------------------------- | ---------------------------------------- | ------- |
| `contextverity:resolve-context` | `contextverity.resolve-context`    | Resolve context; output `outcome: ISSUED | DENIED` |
| `contextverity:verify-receipt`  | `contextverity.verify-receipt`     | Verify; output verdict and drift         |

The caller's credentials are passed to the action, so receipts bind to the caller.
Two upstream behaviors matter:

- **User tokens** keep their identity through the MCP Actions backend (Backstage
  forwards a limited user token).
- **Static-token service callers** are forwarded to actions as
  `plugin:mcp-actions` (`DefaultAuthService.getPluginRequestToken`), so ContextVerity
  sees the MCP backend, not the individual agent. No default policy grants context to
  that shared identity, so such calls are refused with `NO_MATCHING_POLICY`. Call the
  HTTP API directly with the agent's token to bind receipts per agent.

ContextVerity cannot intercept other actions; see
[ADR 0006](adr/0006-mcp-integration-boundaries.md) and `scripts/demo/mcp-client.ts`
for the explicit pattern.

## Frontend

The frontend plugin adds a page at `/contextverity` (route ref `rootRouteRef`) with
a receipts list and a receipt detail view: current verdict and drift (before → after),
receipt fields, source provenance, permission decisions with their basis, and history.
Operators with `contextverity.receipt.read` can run a drift check.

## AI catalog kinds

With `@backstage/plugin-catalog-backend-module-ai-model`, `AiResource` entities and
`mcp-server` APIs work as subjects like any other kind. For `mcp-server` APIs the
`definitionDigest` covers `spec.remotes` (scenarios S48, S49).
