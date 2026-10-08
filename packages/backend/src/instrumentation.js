/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// OpenTelemetry SDK for the ContextVerity lab, loaded with `--require` before
// Backstage starts (see https://backstage.io/docs/tutorials/setup-opentelemetry).
// ContextVerity itself depends only on @opentelemetry/api; this file is how a
// deployment chooses exporters.
//
//   metrics  Prometheus text format on http://127.0.0.1:9464/metrics
//   traces   OTLP/HTTP when OTEL_EXPORTER_OTLP_ENDPOINT is set, and/or a local
//            JSON-lines file when CV_TRACE_FILE is set (no collector needed)

const fs = require('node:fs');
const { isMainThread } = require('node:worker_threads');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus');
const {
  OTLPTraceExporter,
} = require('@opentelemetry/exporter-trace-otlp-http');
const {
  BatchSpanProcessor,
  SimpleSpanProcessor,
} = require('@opentelemetry/sdk-trace-base');
const { MeterProvider } = require('@opentelemetry/sdk-metrics');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { metrics } = require('@opentelemetry/api');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const {
  UndiciInstrumentation,
} = require('@opentelemetry/instrumentation-undici');

/** Writes finished spans as JSON lines: names, ids, attributes and events only. */
class JsonLinesSpanExporter {
  constructor(file) {
    this.file = file;
  }
  export(spans, done) {
    const lines = spans.map(s =>
      JSON.stringify({
        name: s.name,
        traceId: s.spanContext().traceId,
        spanId: s.spanContext().spanId,
        parentSpanId: s.parentSpanContext?.spanId ?? s.parentSpanId,
        kind: s.kind,
        startTime: s.startTime,
        durationMs: s.duration[0] * 1e3 + s.duration[1] / 1e6,
        attributes: s.attributes,
        events: s.events.map(e => ({ name: e.name, attributes: e.attributes })),
      }),
    );
    fs.appendFile(this.file, `${lines.join('\n')}\n`, err =>
      done({ code: err ? 1 : 0, error: err }),
    );
  }
  shutdown() {
    return Promise.resolve();
  }
}

// Node also runs --require preloads inside the module-hooks worker thread that
// `backstage-cli package start` registers. Initializing there would start a
// second exporter that takes the metrics port with no instruments, so only the
// main thread sets up telemetry.
if (isMainThread) setup();

function setup() {
  const spanProcessors = [];
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    spanProcessors.push(new BatchSpanProcessor(new OTLPTraceExporter()));
  }
  if (process.env.CV_TRACE_FILE) {
    spanProcessors.push(
      new SimpleSpanProcessor(
        new JsonLinesSpanExporter(process.env.CV_TRACE_FILE),
      ),
    );
  }

  const serviceName = 'contextverity-lab-backend';

  // Metrics: an explicit MeterProvider registered globally. (NodeSDK's
  // deprecated single `metricReader` option did not export instruments here.)
  metrics.setGlobalMeterProvider(
    new MeterProvider({
      resource: resourceFromAttributes({ 'service.name': serviceName }),
      readers: [
        new PrometheusExporter({
          host: '127.0.0.1',
          port: Number(process.env.CV_METRICS_PORT ?? 9464),
        }),
      ],
    }),
  );

  // Traces (and context propagation) through the Node SDK.
  // HTTP server + fetch client instrumentation propagate W3C trace context, so
  // ContextVerity spans nest under the MCP Actions backend's tools/call span
  // even though actions are invoked over HTTP between plugins.
  new NodeSDK({
    serviceName,
    spanProcessors,
    instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation()],
  }).start();
}
