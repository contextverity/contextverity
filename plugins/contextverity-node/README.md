# @contextverity/plugin-contextverity-node

Backstage adapters for `@contextverity/core`:

- `BackstageCatalogProvider` — catalog entities → normalized source records
- `BackstagePermissionAuthorizer` — `catalog.entity.read` through the Permission Framework
- `KnexReceiptStore` — receipts on the Backstage database service (migrations included)
- `principalFromCredentials` — Backstage credentials → principal refs

See [docs/backstage-integration.md](../../docs/backstage-integration.md).
