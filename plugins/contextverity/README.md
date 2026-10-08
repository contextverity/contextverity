# @contextverity/plugin-contextverity

Backstage frontend plugin (new frontend system) with a receipts list and a receipt
detail view: current verdict and drift, source provenance, permission decisions and
verification history.

```ts
import contextverityPlugin from '@contextverity/plugin-contextverity';
createApp({ features: [contextverityPlugin] });
```

The page is mounted at `/contextverity`.
