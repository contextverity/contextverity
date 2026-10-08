/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// Measures ContextVerity latency and writes test-results/benchmarks-<tier>.json.
//
//   core       in-process: core engine + Backstage provider mapping + Knex/SQLite
//              store, synthetic in-memory catalog. Isolates ContextVerity's own cost.
//   backstage  end-to-end HTTP against the running lab (real catalog, permission
//              framework, SQLite). Includes Backstage and network-stack cost.
//
// The two tiers are reported separately and must never be combined.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import knexFactory from 'knex';
import type { Entity } from '@backstage/catalog-model';
import type { DatabaseService } from '@backstage/backend-plugin-api';
import type {
  ContextCategory,
  ResolveRequest,
} from '@contextverity/plugin-contextverity-common';
import { ContextVerity, evaluate, parsePolicy } from '@contextverity/core';
import {
  BackstageCatalogProvider,
  KnexReceiptStore,
} from '@contextverity/plugin-contextverity-node';
import { SyntheticCatalog, environment } from '@contextverity/scenarios';

interface Result {
  operation: string;
  sources: number;
  concurrency: number;
  samples: number;
  unit: 'ms';
  p50: number;
  p95: number;
  p99: number | null;
  mean: number;
  min: number;
  max: number;
  throughputPerSec: number;
}

const ROOT = resolve(__dirname, '..');
const SOURCE_COUNTS = [1, 5, 10];
const CATEGORIES_ONE: ContextCategory[] = [
  'identity',
  'ownership',
  'lifecycle',
  'dependencies',
  'apis',
];
const CATEGORIES_MANY: ContextCategory[] = [
  ...CATEGORIES_ONE,
  'api-definition',
];

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function summarize(
  operation: string,
  sources: number,
  concurrency: number,
  samples: number[],
  wallMs: number,
): Result {
  const s = [...samples].sort((a, b) => a - b);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    operation,
    sources,
    concurrency,
    samples: s.length,
    unit: 'ms',
    p50: r3(percentile(s, 50)),
    p95: r3(percentile(s, 95)),
    // p99 is only meaningful with enough samples.
    p99: s.length >= 1000 ? r3(percentile(s, 99)) : null,
    mean: r3(s.reduce((a, b) => a + b, 0) / s.length),
    min: r3(s[0]),
    max: r3(s[s.length - 1]),
    throughputPerSec: Math.round((s.length / wallMs) * 1000 * 10) / 10,
  };
}

async function measure(
  n: number,
  concurrency: number,
  fn: () => Promise<unknown>,
) {
  const samples: number[] = [];
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < n) {
        next++;
        const t = performance.now();
        await fn();
        samples.push(performance.now() - t);
      }
    }),
  );
  return { samples, wallMs: performance.now() - started };
}

/** Synthetic subject `bench-<k>` that yields exactly k source records. */
function benchEntities(k: number): Entity[] {
  const apis = Array.from(
    { length: Math.max(0, k - 1) },
    (_, i) => `bench-${k}-api-${i}`,
  );
  const component: Entity = {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: `bench-${k}`,
      namespace: 'default',
      annotations: { 'contextverity.github.io/classification': 'INTERNAL' },
    },
    spec: {
      type: 'service',
      lifecycle: 'production',
      owner: 'team-platform',
      system: 'platform',
      providesApis: apis,
      dependsOn: ['component:notifications'],
    },
  };
  const apiEntities: Entity[] = apis.map(name => ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'API',
    metadata: { name, namespace: 'default' },
    spec: {
      type: 'openapi',
      lifecycle: 'production',
      owner: 'team-platform',
      system: 'platform',
      definition: `openapi: 3.0.3\ninfo: { title: ${name}, version: 1.0.0 }\npaths: {}\n`,
    },
  }));
  return [component, ...apiEntities];
}

function benchRequest(k: number): ResolveRequest {
  return {
    subject: `component:default/bench-${k}`,
    purpose: 'incident-triage',
    categories: k === 1 ? CATEGORIES_ONE : CATEGORIES_MANY,
  };
}

async function core(): Promise<{ results: Result[]; scope: string }> {
  const N = 2000;
  const WARMUP = 200;
  const catalog = SyntheticCatalog.fromFile(
    join(ROOT, 'examples/lab/catalog.yaml'),
  );
  for (const k of SOURCE_COUNTS)
    for (const e of benchEntities(k)) catalog.upsert(e);
  const dir = mkdtempSync(join(tmpdir(), 'cv-bench-'));
  const db = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'bench.sqlite') },
    useNullAsDefault: true,
  });
  const store = await KnexReceiptStore.create({
    getClient: async () => db,
  } as unknown as DatabaseService);
  const policies = [
    parsePolicy({
      id: 'incident-triage',
      consumers: ['user:default/alex'],
      purposes: ['incident-triage'],
      subjects: { kinds: ['component'] },
      allowedSourceKinds: ['CATALOG_ENTITY', 'API_DEFINITION'],
      allowedCategories: CATEGORIES_MANY,
      sensitivityCeiling: 'INTERNAL',
      maxTtlSeconds: 900,
    }),
  ];
  const provider = new BackstageCatalogProvider({
    reader: catalog,
    defaultClassification: 'INTERNAL',
  });
  const service = new ContextVerity({
    issuer: 'bench',
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
    policies: { list: async () => policies },
    store,
    integritySecret: 'bench',
  });
  const alex = { ref: 'user:default/alex' };
  const results: Result[] = [];

  for (const k of SOURCE_COUNTS) {
    const req = benchRequest(k);
    for (let i = 0; i < WARMUP; i++) await service.resolve(alex, req);
    let m = await measure(N, 1, () => service.resolve(alex, req));
    results.push(summarize('receipt.issue', k, 1, m.samples, m.wallMs));

    const { receipt } = await service.resolve(alex, req);
    if (receipt.sources.length !== k)
      throw new Error(`bench-${k} produced ${receipt.sources.length} sources`);
    for (let i = 0; i < WARMUP; i++)
      await service.verify(alex, receipt.receiptId);
    m = await measure(N, 1, () => service.verify(alex, receipt.receiptId));
    results.push(summarize('receipt.verify', k, 1, m.samples, m.wallMs));

    m = await measure(N, 1, () =>
      provider.observe(receipt.sources, receipt.grant.categories),
    );
    results.push(summarize('source.fetch', k, 1, m.samples, m.wallMs));

    const observations = await provider.observe(
      receipt.sources,
      receipt.grant.categories,
    );
    const permissions = receipt.permissions;
    const now = new Date();
    m = await measure(N, 1, async () =>
      evaluate({
        receipt,
        principal: alex.ref,
        intent: {},
        now,
        policy: policies[0],
        observations,
        permissions,
      }),
    );
    results.push(summarize('drift.compare', k, 1, m.samples, m.wallMs));

    // Same comparison when every source differs (no digest fast path).
    const changed = observations.map(o =>
      o.status === 'OK'
        ? {
            ...o,
            record: {
              ...o.record,
              digest: `${o.record.digest}x`,
              fields: {
                ...o.record.fields,
                owner: {
                  category: 'ownership' as const,
                  value: 'group:default/other',
                },
              },
            },
          }
        : o,
    );
    m = await measure(N, 1, async () =>
      evaluate({
        receipt,
        principal: alex.ref,
        intent: {},
        now,
        policy: policies[0],
        observations: changed,
        permissions,
      }),
    );
    results.push(summarize('drift.compare.changed', k, 1, m.samples, m.wallMs));
  }

  const { receipt } = await service.resolve(alex, benchRequest(5));
  for (const c of [1, 10, 50, 100]) {
    const m = await measure(N, c, () =>
      service.verify(alex, receipt.receiptId),
    );
    results.push(summarize('receipt.verify', 5, c, m.samples, m.wallMs));
  }
  await db.destroy();
  rmSync(dir, { recursive: true, force: true });
  return {
    results,
    scope: `In-process, single Node.js process. ${N} measured samples per row after ${WARMUP} warm-up calls. Knex + better-sqlite3 file store with HMAC integrity tags; synthetic in-memory catalog; allow-all synthetic authorizer. Excludes HTTP, Backstage catalog and permission-backend cost. Concurrency rows use 5-source receipts.`,
  };
}

async function live(): Promise<{
  results: Result[];
  scope: string;
  extra: Record<string, unknown>;
}> {
  const N = 300;
  const base = process.env.CV_BACKEND_URL;
  if (!base)
    throw new Error('CV_BACKEND_URL is not set; source .demo/env first');
  const tokenRes = await fetch(`${base}/api/auth/guest/refresh`);
  const token = ((await tokenRes.json()) as any).backstageIdentity
    .token as string;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok)
      throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  for (const k of SOURCE_COUNTS)
    for (const e of benchEntities(k)) await call('PUT', '/api/lab/entities', e);

  const results: Result[] = [];
  try {
    for (const k of SOURCE_COUNTS) {
      const req = benchRequest(k);
      for (let i = 0; i < 20; i++)
        await call('POST', '/api/contextverity/v1/resolve', req);
      let m = await measure(N, 1, () =>
        call('POST', '/api/contextverity/v1/resolve', req),
      );
      results.push(summarize('receipt.issue', k, 1, m.samples, m.wallMs));
      const { receipt } = await call(
        'POST',
        '/api/contextverity/v1/resolve',
        req,
      );
      if (receipt.sources.length !== k)
        throw new Error(
          `bench-${k} produced ${receipt.sources.length} sources`,
        );
      for (let i = 0; i < 20; i++)
        await call(
          'POST',
          `/api/contextverity/v1/receipts/${receipt.receiptId}/verify`,
          {},
        );
      m = await measure(N, 1, () =>
        call(
          'POST',
          `/api/contextverity/v1/receipts/${receipt.receiptId}/verify`,
          {},
        ),
      );
      results.push(summarize('receipt.verify', k, 1, m.samples, m.wallMs));
    }
    const { receipt } = await call(
      'POST',
      '/api/contextverity/v1/resolve',
      benchRequest(5),
    );
    for (const c of [1, 10, 50, 100]) {
      const m = await measure(N, c, () =>
        call(
          'POST',
          `/api/contextverity/v1/receipts/${receipt.receiptId}/verify`,
          {},
        ),
      );
      results.push(summarize('receipt.verify', 5, c, m.samples, m.wallMs));
    }
  } finally {
    await call('POST', '/api/lab/reset');
  }
  return {
    results,
    scope: `End-to-end HTTP from a client on the same machine to a local Backstage backend in development mode (SQLite, real catalog and permission framework, guest user principal, logging enabled). ${N} measured samples per row after 20 warm-up calls; p99 omitted below 1000 samples. Concurrency rows use 5-source receipts.`,
    extra: {
      backstageBackend:
        'local development backend (backstage-cli package start)',
    },
  };
}

async function main() {
  const tier = process.argv.includes('--tier')
    ? process.argv[process.argv.indexOf('--tier') + 1]
    : 'core';
  const out =
    tier === 'core'
      ? { ...(await core()), extra: {} }
      : tier === 'backstage'
      ? await live()
      : undefined;
  if (!out) throw new Error(`unknown tier ${tier}`);
  const report = {
    schemaVersion: 1,
    kind: 'contextverity.benchmarks',
    tier,
    scope: out.scope,
    generatedAt: new Date().toISOString(),
    environment: environment(ROOT, out.extra),
    results: out.results,
  };
  mkdirSync(join(ROOT, 'test-results'), { recursive: true });
  const file = join(ROOT, 'test-results', `benchmarks-${tier}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `${'operation'.padEnd(16)} ${'src'.padStart(3)} ${'conc'.padStart(
      4,
    )} ${'n'.padStart(5)} ${'p50'.padStart(8)} ${'p95'.padStart(
      8,
    )} ${'p99'.padStart(8)} ms`,
  );
  for (const r of out.results) {
    console.log(
      `${r.operation.padEnd(16)} ${String(r.sources).padStart(3)} ${String(
        r.concurrency,
      ).padStart(4)} ${String(r.samples).padStart(5)} ${r.p50
        .toFixed(3)
        .padStart(8)} ${r.p95.toFixed(3).padStart(8)} ${(r.p99 === null
        ? '-'
        : r.p99.toFixed(3)
      ).padStart(8)}`,
    );
  }
  console.log(`wrote ${file}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
