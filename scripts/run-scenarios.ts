/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// Runs the context-drift scenarios and writes test-results/scenarios-<tier>.json.
// Usage: node --require @backstage/cli/config/nodeTransform.cjs scripts/run-scenarios.ts --tier core|backstage

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  BackstageHarness,
  CoreHarness,
  Harness,
  KubernetesHarness,
  runAll,
} from '@contextverity/scenarios';

async function main() {
  const tier = process.argv.includes('--tier')
    ? process.argv[process.argv.indexOf('--tier') + 1]
    : 'core';
  const rootDir = resolve(__dirname, '..');
  let harness: Harness;
  let scope: string;
  let extra: Record<string, unknown> = {};
  if (tier === 'core') {
    harness = new CoreHarness({ rootDir });
    scope =
      'In-process: ContextVerity core + Backstage provider mapping + Knex/SQLite store, against a synthetic in-memory catalog that emulates Backstage relation stitching. Controllable clock. Synthetic data only.';
  } else if (tier === 'backstage') {
    const env = (k: string) => {
      const v = process.env[k];
      if (!v) throw new Error(`${k} is not set; source .demo/env first`);
      return v;
    };
    harness = new BackstageHarness({
      rootDir,
      baseUrl: env('CV_BACKEND_URL'),
      agentToken: env('CV_AGENT_TOKEN'),
      otherAgentToken: env('CV_OTHER_AGENT_TOKEN'),
      dataDir: env('CV_DATA_DIR'),
    });
    scope =
      'Live: a local Backstage backend (catalog, permission framework, MCP actions, ContextVerity) on SQLite, driven over HTTP. Catalog changes go through a demo-only entity provider and are awaited until the real catalog reflects them. Synthetic data only; single machine.';
    const health = await fetch(
      `${env('CV_BACKEND_URL')}/.backstage/health/v1/readiness`,
    );
    if (!health.ok)
      throw new Error('Backstage lab is not ready; run make demo-up');
    extra = {
      backstageBackend: env('CV_BACKEND_URL').replace(
        /\/\/[^/]+/,
        '//127.0.0.1',
      ),
    };
  } else if (tier === 'kubernetes') {
    const kubeContext = process.env.CV_KUBE_CONTEXT ?? 'kind-contextverity';
    const namespace = process.env.CV_KUBE_NAMESPACE ?? 'contextverity';
    harness = await KubernetesHarness.create({
      rootDir,
      kubeContext,
      namespace,
      release: process.env.CV_HELM_RELEASE ?? 'lab',
      localPort: Number(process.env.CV_KUBE_PORT ?? 7017),
    });
    scope =
      'Live on Kubernetes: the lab image (built with Podman) deployed by the Helm chart to a single-node kind cluster running on Podman; non-root, read-only root filesystem, NetworkPolicy, SQLite on a persistent volume. Driven over kubectl port-forward. Restarts delete the pod; storage tampering edits the row inside the pod. Synthetic data only; single machine.';
    const version = (cmd: string[]) => {
      try {
        return execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf8' }).trim();
      } catch {
        return 'unknown';
      }
    };
    extra = {
      kubernetes: serverVersion(
        version(['kubectl', '--context', kubeContext, 'version', '-o', 'json']),
      ),
      kind: version(['kind', 'version']).split(' ')[1] ?? 'unknown',
      podman: version(['podman', '--version']).replace('podman version ', ''),
      helmChart: 'deploy/helm/contextverity-lab 0.1.0',
    };
  } else {
    throw new Error(`unknown tier ${tier}`);
  }

  const report = await runAll(harness, rootDir, scope, extra);
  const outDir = join(rootDir, 'test-results');
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `scenarios-${tier}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);

  const s = report.summary;
  for (const r of report.scenarios) {
    const mark =
      r.status === 'PASS' ? 'PASS' : r.status === 'FAIL' ? 'FAIL' : 'N/A ';
    console.log(
      `${mark} ${r.id} ${r.title.padEnd(58)} ${
        r.observed
          ? r.observed.denialCode ?? r.observed.outcome
          : r.unsupportedReason ?? ''
      }`,
    );
    for (const f of r.failures ?? []) console.log(`       ${f.split('\n')[0]}`);
  }
  const pct = (x: {
    value: number | null;
    numerator: number;
    denominator: number;
  }) =>
    x.value === null
      ? 'n/a'
      : `${(x.value * 100).toFixed(1)}% (${x.numerator}/${x.denominator})`;
  console.log(
    `\n${tier}: ${s.passed} passed, ${s.failed} failed, ${s.unsupported} unsupported of ${s.total}`,
  );
  console.log(
    `stale detection ${pct(
      s.metrics.staleDetectionRate,
    )}, false invalidation ${pct(
      s.metrics.falseInvalidationRate,
    )}, false acceptance ${pct(s.metrics.falseAcceptanceRate)}`,
  );
  console.log(`wrote ${file}`);
  if (s.failed) process.exitCode = 1;
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

function serverVersion(json: string): string {
  try {
    return JSON.parse(json).serverVersion?.gitVersion ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
