/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { context, metrics, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import type { SourceRecord } from '@contextverity/plugin-contextverity-common';
import { ContextVerity, ContextSourceProvider } from './service';
import { InMemoryReceiptStore } from './store';
import { createSourceRecord } from './records';
import { parsePolicy } from './policy';

const spans = new InMemorySpanExporter();
const metricExporter = new InMemoryMetricExporter(
  AggregationTemporality.CUMULATIVE,
);
const reader = new PeriodicExportingMetricReader({
  exporter: metricExporter,
  exportIntervalMillis: 60_000,
});

beforeAll(() => {
  const cm = new AsyncHooksContextManager().enable();
  context.setGlobalContextManager(cm);
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spans)],
    }),
  );
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
});

afterAll(async () => {
  await reader.shutdown();
  trace.disable();
  metrics.disable();
  context.disable();
});

const SECRET_OWNER = 'group:default/very-specific-owner-value';

function record(owner: string): SourceRecord {
  return createSourceRecord({
    sourceId: 'catalog:component:default/payments',
    kind: 'CATALOG_ENTITY',
    provider: 'test',
    identity: 'u1',
    required: true,
    classification: 'INTERNAL',
    fields: { owner: { category: 'ownership', value: owner } },
  });
}

describe('telemetry', () => {
  it('emits the documented spans and bounded metrics without context values', async () => {
    let owner = SECRET_OWNER;
    const provider: ContextSourceProvider = {
      id: 'test',
      subjectSourceId: s => `catalog:${s}`,
      resolve: async () => ({ status: 'OK', records: [record(owner)] }),
      observe: async sources =>
        sources.map(s => ({
          sourceId: s.sourceId,
          status: 'OK' as const,
          record: record(owner),
        })),
    };
    const service = new ContextVerity({
      issuer: 'test',
      provider,
      authorizer: {
        authorize: async (p, ids) =>
          ids.map(sourceId => ({
            permission: 'catalog.entity.read',
            sourceId,
            result: 'ALLOW' as const,
            principal: p.ref,
            basis: 'permission-policy' as const,
          })),
      },
      policies: {
        list: async () => [
          parsePolicy({
            id: 'p',
            consumers: ['user:default/alex'],
            purposes: ['incident-triage'],
            subjects: {},
            allowedSourceKinds: ['CATALOG_ENTITY'],
            allowedCategories: ['ownership'],
            sensitivityCeiling: 'INTERNAL',
            maxTtlSeconds: 60,
          }),
        ],
      },
      store: new InMemoryReceiptStore(),
    });
    const alex = { ref: 'user:default/alex' };
    const { receipt } = await service.resolve(alex, {
      subject: 'component:payments',
      purpose: 'incident-triage',
      categories: ['ownership'],
    });
    await service.verify(alex, receipt.receiptId);
    owner = 'group:default/other';
    const v = await service.verify(alex, receipt.receiptId);
    expect(v.verdict).toBe('REFRESH');

    const finished = spans.getFinishedSpans();
    const names = new Set(finished.map(s => s.name));
    for (const n of [
      'contextverity.resolve',
      'contextverity.receipt.issue',
      'contextverity.receipt.verify',
      'contextverity.source.fetch',
      'contextverity.permission.check',
      'contextverity.drift.compare',
    ]) {
      expect(names).toContain(n);
    }
    const verifySpan = finished
      .filter(s => s.name === 'contextverity.receipt.verify')
      .at(-1)!;
    expect(verifySpan.attributes['contextverity.verdict']).toBe('REFRESH');
    expect(verifySpan.attributes['contextverity.drift.codes']).toEqual([
      'OWNER_CHANGED',
    ]);
    expect(verifySpan.events.map(e => e.name)).toContain(
      'contextverity.verdict',
    );
    // No span carries context values.
    const serialized = JSON.stringify(
      finished.map(s => ({ a: s.attributes, e: s.events })),
    );
    expect(serialized).not.toContain('very-specific-owner-value');
    for (const s of finished) {
      for (const key of Object.keys(s.attributes))
        expect(key.startsWith('contextverity.')).toBe(true);
    }

    await reader.forceFlush();
    const exported = metricExporter
      .getMetrics()
      .flatMap(rm => rm.scopeMetrics.flatMap(sm => sm.metrics));
    const byName = new Map(exported.map(m => [m.descriptor.name, m]));
    for (const n of [
      'contextverity.receipts.issued',
      'contextverity.verifications',
      'contextverity.drift',
      'contextverity.verification.duration',
      'contextverity.source.fetch.duration',
    ]) {
      expect(byName.has(n)).toBe(true);
    }
    expect(
      byName.get('contextverity.verification.duration')!.descriptor.unit,
    ).toBe('s');
    const labelKeys = new Set(
      exported.flatMap(m =>
        m.dataPoints.flatMap(dp => Object.keys(dp.attributes)),
      ),
    );
    expect([...labelKeys].sort()).toEqual([
      'drift_type',
      'provider',
      'verdict',
    ]);
    const labelValues = JSON.stringify(
      exported.flatMap(m => m.dataPoints.map(dp => dp.attributes)),
    );
    expect(labelValues).not.toContain(receipt.receiptId);
  });
});
