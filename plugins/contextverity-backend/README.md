# @contextverity/plugin-contextverity-backend

Backstage backend plugin that issues and verifies context receipts.

```ts
backend.add(import('@contextverity/plugin-contextverity-backend'));
```

Provides the `/api/contextverity/v1` HTTP API, loads context policies, runs the
retention task and registers the `contextverity:resolve-context` and
`contextverity:verify-receipt` actions. Configuration: [`config.d.ts`](config.d.ts) and
[docs/backstage-integration.md](../../docs/backstage-integration.md).
