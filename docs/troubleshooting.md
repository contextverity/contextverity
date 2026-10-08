# Troubleshooting

**`Node version 26 is not a supported LTS version`.** Backstage 1.55 supports Node 22
and 24. Use one of them (`.nvmrc` says 22). The Makefile refuses other versions.

**Native module errors (`NODE_MODULE_VERSION`) for `better-sqlite3`.** It was built
with another Node. Some global `yarn` shims hard-code a Node binary; always use the
repo's Yarn through `make`, or `node .yarn/releases/yarn-4.13.0.cjs rebuild better-sqlite3`.

**`yarn install` fails resolving a `got` patch.** `@yarnpkg/core` 4.9.2 ships a
`patch:` dependency that cannot be resolved outside Yarn's own repository; the root
`package.json` pins `@yarnpkg/core` to 4.9.1.

**Packages are "quarantined" during install.** The repository keeps the Backstage
template's `npmMinimalAgeGate: 3d`, which refuses releases younger than three days.

**Guest sign-in fails in the browser ("Failed to sign in as a guest").** Use
`http://127.0.0.1:3000`, not `localhost` (the lab listens on IPv4 loopback only), and
keep `backend.cors.credentials: true`.

**No `contextverity_*` metrics on `:9464`, only `target_info`.** In development mode
Node runs `--require` preloads in the module-hooks worker as well; a second exporter
there takes the port. Initialize telemetry only when `worker_threads.isMainThread`
(as `packages/backend/src/instrumentation.js` does).

**ContextVerity spans are not under the MCP `tools/call` span.** Enable HTTP server
and `fetch` (undici) instrumentation so trace context propagates between plugins.

**MCP `resolve-context` returns `NO_MATCHING_POLICY` for an agent with a static
token.** Backstage forwards it to actions as `plugin:mcp-actions`. Use a user token,
or call the ContextVerity HTTP API directly with the agent's token.

**Verify returns `REFRESH` with `SOURCE_UNAVAILABLE`.** The catalog could not be read.
Check the catalog backend.

**Resolve returns 503 "context policies could not be loaded".** The policy file is
missing or invalid; the backend log lists every problem. ContextVerity fails closed.

**Lab scenarios time out waiting for the catalog.** The lab waits up to 60 s for the
catalog to reflect a change; check `.demo/backend.log` for processing errors.
