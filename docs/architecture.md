# Architecture

ContextVerity sits between consumers of developer-platform context (agents, users,
scripts) and the sources of that context. In v0.1 the only source is the Backstage
Software Catalog and the only authorization system is the Backstage Permission
Framework. Everything runs inside a Backstage backend.

![Architecture](assets/architecture.svg)

## Components

| Package                                       | Kind            | Depends on Backstage? | Responsibility                                                                                                                                                                                                        |
| --------------------------------------------- | --------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@contextverity/plugin-contextverity-common`  | common library  | permission types only | Shared types (`ContextReceipt`, `DriftItem`, …), drift codes, the classification annotation key, the `contextverity.receipt.read` permission.                                                                         |
| `@contextverity/core`                         | node library    | **no**                | Canonical JSON and digests, the policy model, the pure verdict engine, the `ContextVerity` service that orchestrates resolve/verify, the provider/authorizer/store interfaces, and OpenTelemetry API instrumentation. |
| `@contextverity/plugin-contextverity-node`    | node library    | yes                   | `BackstageCatalogProvider` (catalog entity → normalized source records), `BackstagePermissionAuthorizer` (Permission Framework), `KnexReceiptStore` (Backstage database service) and its migrations.                  |
| `@contextverity/plugin-contextverity-backend` | backend plugin  | yes                   | Wires the above with Backstage core services, serves the HTTP API, loads policies, schedules retention, registers Actions Registry actions.                                                                           |
| `@contextverity/plugin-contextverity`         | frontend plugin | yes                   | Receipts list and receipt detail pages (new frontend system, `@backstage/ui`).                                                                                                                                        |

The repository also contains a demo Backstage app (`packages/app`,
`packages/backend`) with a **demo-only lab** (`packages/backend/src/lab`): a catalog
entity provider fed from `examples/lab/catalog.yaml`, a permission policy that can
revoke a user's read access to specific entities, and a control API used by the
scenarios and the demo. The lab is not part of ContextVerity.

## Resolve

```
consumer ──POST /v1/resolve──► router ──► ContextVerity.resolve
                                            │ 1. select the one policy matching consumer, purpose, subject
                                            │ 2. check requested categories ⊆ policy
                                            │ 3. authorize the subject (Permission Framework, caller's credentials)
                                            │ 4. provider.resolve(subject, categories)   (plugin's own credentials)
                                            │ 5. check source kinds ⊆ policy; authorize related sources
                                            │ 6. check classification ≤ policy ceiling
                                            │ 7. build receipt (grant, records, permissions, digests)
                                            │ 8. store.insert(receipt, integrity tag)
                                            ▼
                                     201 { receipt, context }
```

Source state is read with the plugin's own service credentials, so that "not found"
means deleted rather than hidden from this caller. The caller's access is evaluated
separately and explicitly (see [permissions.md](permissions.md)).

## Verify

```
consumer ──POST /v1/receipts/:id/verify──► ContextVerity.verify
   1. load the authoritative receipt; check its integrity tag
   2. binding: issuer, consumer            ── fails ─► DENY, no source state read
   3. intent: subject, purpose, categories
   4. policy: removed / narrowed / changed
   5. time: now ≥ min(validUntil, issuedAt + current policy maxTtl)
   6. permissions re-evaluated for the consumer, now
   7. provider.observe(recorded sources) → compare identity, classification, fields
   8. verdict = strongest effect; record the verification
```

Steps 4–7 gather inputs; the decision itself is the pure function
`evaluate()` in `plugins/contextverity-core/src/engine.ts`, which has no I/O, no
clock of its own and no randomness. Rules: [context-verdicts.md](context-verdicts.md).

## Integration points (all supported public APIs)

| Backstage API                                                                 | Used for                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `createBackendPlugin`, `coreServices.*`                                       | Plugin lifecycle, router, auth, database, scheduler, logger, config |
| `catalogServiceRef` (`@backstage/plugin-catalog-node`)                        | Reading entities by ref                                             |
| `coreServices.permissions` + `catalogEntityReadPermission`                    | Evaluating the consumer's access                                    |
| `coreServices.permissionsRegistry`                                            | Registering `contextverity.receipt.read`                            |
| `actionsRegistryServiceRef` (`@backstage/backend-plugin-api/alpha`)           | Registering `resolve-context` and `verify-receipt`                  |
| `@backstage/plugin-mcp-actions-backend` (unchanged)                           | Exposing those actions as MCP tools                                 |
| New frontend system (`createFrontendPlugin`, `PageBlueprint`, `ApiBlueprint`) | The receipts UI                                                     |

ContextVerity does not patch, wrap or replace any Backstage service. The Actions
Registry API is marked alpha upstream; see [upstream-compatibility.md](upstream-compatibility.md).

## Data

Two tables in the plugin's own database (`contextverity_receipts`,
`contextverity_verifications`), created by Knex migrations shipped in the node
package. Receipts are insert-only. See [context-receipts.md](context-receipts.md)
and [ADR 0005](adr/0005-storage.md).

## Telemetry

`@contextverity/core` depends only on `@opentelemetry/api`. Deployments choose
exporters (the lab uses Prometheus and a JSON-lines span file). Spans propagate
through Backstage's inter-plugin HTTP calls when HTTP instrumentation is enabled, so
ContextVerity spans appear under the MCP Actions backend's `tools/call` span. See
[telemetry.md](telemetry.md).
