/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// Builds test-results/summary.json from the per-tier result files and
// validates their shape. `--check` only validates.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'test-results');
const read = f =>
  existsSync(join(dir, f))
    ? JSON.parse(readFileSync(join(dir, f), 'utf8'))
    : undefined;

const files = {
  scenariosCore: read('scenarios-core.json'),
  scenariosBackstage: read('scenarios-backstage.json'),
  benchmarksCore: read('benchmarks-core.json'),
  benchmarksBackstage: read('benchmarks-backstage.json'),
  telemetryBackstage: read('telemetry-backstage.json'),
};

const problems = [];
for (const [name, f] of Object.entries(files)) {
  if (!f) continue;
  if (f.schemaVersion !== 1) problems.push(`${name}: schemaVersion must be 1`);
  if (!f.environment?.commit)
    problems.push(`${name}: environment.commit missing`);
}
if (!files.scenariosCore) problems.push('scenarios-core.json is required');
if (files.scenariosCore && files.scenariosCore.summary.total < 30)
  problems.push('fewer than 30 scenarios');

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
if (process.argv.includes('--check')) {
  console.log('test-results OK');
  process.exit(0);
}

const tier = s =>
  s && {
    tier: s.tier,
    scope: s.scope,
    generatedAt: s.generatedAt,
    commit: s.environment.commit,
    summary: s.summary,
  };
const summary = {
  schemaVersion: 1,
  kind: 'contextverity.summary',
  generatedAt: new Date().toISOString(),
  contextverityVersion: files.scenariosCore.environment.contextverityVersion,
  backstageRelease: files.scenariosCore.environment.backstageRelease,
  scenarios: {
    core: tier(files.scenariosCore),
    backstage: tier(files.scenariosBackstage),
  },
  benchmarks: {
    core: files.benchmarksCore && {
      scope: files.benchmarksCore.scope,
      results: files.benchmarksCore.results,
    },
    backstage: files.benchmarksBackstage && {
      scope: files.benchmarksBackstage.scope,
      results: files.benchmarksBackstage.results,
    },
  },
  telemetry: files.telemetryBackstage && {
    pass: files.telemetryBackstage.pass,
    traces: files.telemetryBackstage.traces,
    metrics: files.telemetryBackstage.metrics,
  },
  note: 'Synthetic data on a single machine. Core and live-lab results are separate measurements and must not be combined.',
};
writeFileSync(
  join(dir, 'summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
);
console.log('wrote test-results/summary.json');
