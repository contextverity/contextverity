# Deployment

ContextVerity runs inside your Backstage backend; there is no separate service to
deploy.

1. Add the backend and frontend plugins ([backstage-integration.md](backstage-integration.md)).
2. Configure `contextverity.issuer`, `integritySecret` and policies.
3. Use the Backstage database service as usual. ContextVerity creates two tables in
   its own plugin database through migrations (SQLite in development, PostgreSQL in
   production). Set `backend.database.plugin.contextverity` to override.
4. Optionally load an OpenTelemetry SDK with `node --require ./instrumentation.js`
   ([telemetry.md](telemetry.md)).

## Consistency

- Receipts are inserted once and never updated; verifications are appended.
- A verification reads the receipt, the catalog and the permission backend at
  slightly different instants; it is not a transaction across them.
- Several backend replicas can serve ContextVerity concurrently: receipts are read
  from the shared database, and the retention task is coordinated by the Backstage
  scheduler.

## Kubernetes

Not provided in v0.1. A Helm example is on the [roadmap](../ROADMAP.md) once it has
been validated end to end; it is not required, since ContextVerity is deployed as part
of Backstage.

## Local lab

`make demo-up` runs a development-mode Backstage on `127.0.0.1` with SQLite files in
`.demo/data`, guest sign-in, two static agent tokens (generated into `.demo/env`), the
MCP Actions backend, the demo-only lab and OpenTelemetry. `make demo-down` stops it;
`make clean` also removes `.demo/`. Never expose the lab beyond localhost.
