/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Attributes,
  Span,
  SpanStatusCode,
  metrics,
  trace,
} from '@opentelemetry/api';

/**
 * Instrumentation scope name for spans and metrics.
 *
 * @public
 */
export const INSTRUMENTATION_SCOPE = '@contextverity/core';

/**
 * Project-specific span attribute keys. They are namespaced under
 * `contextverity.` because no OpenTelemetry semantic convention covers
 * context receipts. Receipt IDs appear on spans (high cardinality is fine on
 * traces) but never on metrics. No context values or document bodies are
 * recorded.
 *
 * @public
 */
export const ATTR = {
  receiptId: 'contextverity.receipt.id',
  purpose: 'contextverity.purpose',
  subjectKind: 'contextverity.subject.kind',
  verdict: 'contextverity.verdict',
  driftCount: 'contextverity.drift.count',
  driftCodes: 'contextverity.drift.codes',
  sourceCount: 'contextverity.source.count',
  sourceKind: 'contextverity.source.kind',
  provider: 'contextverity.provider',
  permissionCount: 'contextverity.permission.count',
  denialCode: 'contextverity.resolve.denial_code',
} as const;

const tracer = () => trace.getTracer(INSTRUMENTATION_SCOPE);
const meter = () => metrics.getMeter(INSTRUMENTATION_SCOPE);

let instruments:
  | {
      issued: ReturnType<ReturnType<typeof meter>['createCounter']>;
      verifications: ReturnType<ReturnType<typeof meter>['createCounter']>;
      drift: ReturnType<ReturnType<typeof meter>['createCounter']>;
      verifyDuration: ReturnType<ReturnType<typeof meter>['createHistogram']>;
      fetchDuration: ReturnType<ReturnType<typeof meter>['createHistogram']>;
    }
  | undefined;

/**
 * Lazily created metric instruments. Names use OpenTelemetry dot notation;
 * a Prometheus exporter renders them as e.g.
 * `contextverity_receipts_issued_total` and
 * `contextverity_verification_duration_seconds`.
 *
 * Only bounded attributes are used: verdict, drift code, source kind.
 *
 * @public
 */
export function getInstruments() {
  if (!instruments) {
    const m = meter();
    const buckets = [
      0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5,
    ];
    instruments = {
      issued: m.createCounter('contextverity.receipts.issued', {
        description: 'Context receipts issued',
      }),
      verifications: m.createCounter('contextverity.verifications', {
        description: 'Receipt verifications by verdict',
      }),
      drift: m.createCounter('contextverity.drift', {
        description: 'Drift items detected by drift code',
      }),
      verifyDuration: m.createHistogram('contextverity.verification.duration', {
        description: 'Receipt verification duration',
        unit: 's',
        advice: { explicitBucketBoundaries: buckets },
      }),
      fetchDuration: m.createHistogram('contextverity.source.fetch.duration', {
        description: 'Source fetch duration',
        unit: 's',
        advice: { explicitBucketBoundaries: buckets },
      }),
    };
  }
  return instruments;
}

/**
 * Runs `fn` inside an active span, recording exceptions and status.
 *
 * @public
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(name, { attributes }, async span => {
    try {
      return await fn(span);
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (e as Error).message,
      });
      throw e;
    } finally {
      span.end();
    }
  });
}
