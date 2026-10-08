# Development

## Prerequisites

Node.js 22 or 24, `make`, `git`, `curl`. Yarn 4.13 is committed in `.yarn/releases`.

## Layout

```
plugins/contextverity-common     shared types, codes, permission
plugins/contextverity-core       engine, service, interfaces (no Backstage dependency)
plugins/contextverity-node       Backstage provider, authorizer, Knex store, migrations
plugins/contextverity-backend    backend plugin (router, policies, actions, retention)
plugins/contextverity            frontend plugin
packages/app, packages/backend   demo Backstage app; demo-only lab in packages/backend/src/lab
test/scenarios                   scenario definitions and the two harnesses
examples/lab                     synthetic catalog and seed policies
scripts/                         scenario runner, benchmarks, telemetry check, demo, generators
test-results/                    machine-generated results (committed)
docs/                            documentation, ADRs, assets
```

## Common tasks

```sh
make install          # yarn install --immutable
make verify           # format-check, lint, typecheck, unit + integration tests
make demo-up          # start the lab (backend + frontend)
make test-e2e         # live-tier scenarios
make test-results     # regenerate test-results/, docs/results.md, README block
node scripts/dependencies.mjs   # regenerate DEPENDENCIES.md
make demo-down
```

TypeScript scripts run with Backstage's own require hook:
`node --require @backstage/cli/config/nodeTransform.cjs scripts/<file>.ts`.

## Adding a source provider

Implement `ContextSourceProvider` from `@contextverity/core`:
`subjectSourceId(subject)`, `resolve({subject, categories})` → records, and
`observe(records, categories)` → one observation per record (`OK`, `NOT_FOUND`,
`UNAVAILABLE`, `MALFORMED`). Use `createSourceRecord` and `filterFields`; normalize
unordered lists with `canonicalSet`. Add scenarios for the new provider.
