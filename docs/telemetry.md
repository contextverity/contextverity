# Telemetry

ContextVerity instruments itself with the vendor-neutral
[OpenTelemetry](https://opentelemetry.io/) API. The libraries depend only on
`@opentelemetry/api`; with no SDK installed, instrumentation is a no-op. A
deployment chooses exporters.

## Spans

| Span                             | Where                | Key attributes                                                                                                                                       |
| -------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contextverity.resolve`          | resolve              | `contextverity.purpose`, `contextverity.subject.kind`, `contextverity.receipt.id`, `contextverity.source.count`, `contextverity.resolve.denial_code` |
| `contextverity.receipt.issue`    | storing a receipt    | `contextverity.receipt.id`                                                                                                                           |
| `contextverity.receipt.verify`   | verify               | `contextverity.receipt.id`, `contextverity.verdict`, `contextverity.drift.count`, `contextverity.drift.codes`; event `contextverity.verdict`         |
| `contextverity.receipt.inspect`  | operator drift check | `contextverity.receipt.id`, `contextverity.verdict`                                                                                                  |
| `contextverity.source.fetch`     | provider calls       | `contextverity.provider`, `contextverity.source.count`                                                                                               |
| `contextverity.permission.check` | authorizer calls     | `contextverity.permission.count`                                                                                                                     |
| `contextverity.drift.compare`    | the pure engine      | —                                                                                                                                                    |

All attribute keys are project-specific and namespaced under `contextverity.`; no
OpenTelemetry semantic convention covers context receipts. Spans carry IDs, counts,
codes and verdicts — **never** context values, document bodies, tokens or
credentials (asserted in `telemetry.test.ts` and `scripts/check-telemetry.ts`).
Receipt IDs are high-cardinality and appear only on spans.

## Relationship to MCP spans

Backstage's MCP Actions backend creates a `tools/call <tool>` span (attributes
`mcp.method.name`, `gen_ai.tool.name`, `gen_ai.operation.name`, …, following the
OpenTelemetry MCP conventions, which are at _Development_ stability). It then invokes
the action over HTTP. With HTTP server and `fetch` client instrumentation enabled, W3C
trace context propagates and ContextVerity's spans become children of that span:

```
POST /api/mcp-actions/v1
└─ tools/call contextverity.resolve-context      (Backstage)
   └─ POST …/actions/…/invoke                     (HTTP instrumentation)
      └─ contextverity.resolve                    (ContextVerity)
```

ContextVerity adds no trace semantics of its own for this; it relies on standard
propagation. Measured in the lab: see `test-results/telemetry-backstage.json`.

## Metrics

| Instrument (OTel name)                | Type             | Unit | Attributes   | Prometheus name (as exposed by the JS exporter)          |
| ------------------------------------- | ---------------- | ---- | ------------ | -------------------------------------------------------- |
| `contextverity.receipts.issued`       | counter          | —    | —            | `contextverity_receipts_issued_total`                    |
| `contextverity.verifications`         | counter          | —    | `verdict`    | `contextverity_verifications_total`                      |
| `contextverity.drift`                 | counter          | —    | `drift_type` | `contextverity_drift_total`                              |
| `contextverity.verification.duration` | histogram        | `s`  | `verdict`    | `contextverity_verification_duration_{bucket,sum,count}` |
| `contextverity.source.fetch.duration` | histogram        | `s`  | `provider`   | `contextverity_source_fetch_duration_{bucket,sum,count}` |
| `contextverity.receipts.active`       | observable gauge | —    | —            | `contextverity_receipts_active`                          |

All attribute values are bounded (three verdicts, a fixed list of drift codes,
provider IDs). The OpenTelemetry JS Prometheus exporter (0.222) does not append unit
suffixes, so histograms are not named `…_seconds`; the unit is in the `# UNIT` line.

## Lab setup

`packages/backend/src/instrumentation.js` is loaded with
`backstage-cli package start --require ./src/instrumentation.js`, following the
[Backstage OpenTelemetry tutorial](https://backstage.io/docs/tutorials/setup-opentelemetry).
It exposes Prometheus metrics on `127.0.0.1:9464`, exports traces via OTLP when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set, and writes spans to `.demo/traces.jsonl`.

> **Development-mode pitfall.** `backstage-cli package start` registers Node module
> hooks; Node then also runs `--require` preloads in the hooks worker thread. An
> instrumentation file that starts a Prometheus exporter there takes the port with no
> instruments, and the real exporter fails with `EADDRINUSE`. The lab guards setup
> with `worker_threads.isMainThread`. See [troubleshooting.md](troubleshooting.md).
