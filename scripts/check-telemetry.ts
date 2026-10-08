/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// Verifies, against the running lab, that ContextVerity telemetry is exported
// and correlated with Backstage's MCP Actions spans. Drives the reference MCP
// client, then reads the lab's JSON-lines span file and Prometheus endpoint.
// Writes test-results/telemetry-backstage.json.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { environment } from '@contextverity/scenarios';

const ROOT = resolve(__dirname, '..');

async function main() {
  const traceFile = process.env.CV_TRACE_FILE;
  if (!traceFile) throw new Error('CV_TRACE_FILE is not set; source .demo/env');
  const before = safeRead(traceFile).length;
  execFileSync(
    process.execPath,
    [
      '--require',
      '@backstage/cli/config/nodeTransform.cjs',
      join(ROOT, 'scripts/demo/mcp-client.ts'),
    ],
    {
      cwd: ROOT,
      stdio: 'ignore',
      env: process.env,
    },
  );
  await new Promise(r => setTimeout(r, 1500));
  const spans = safeRead(traceFile)
    .slice(before)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
  const byId = new Map(spans.map(s => [s.spanId, s]));
  const roots = spans.filter(s =>
    ['contextverity.resolve', 'contextverity.receipt.verify'].includes(s.name),
  );
  let underToolsCall = 0;
  let example: string[] = [];
  for (const s of roots) {
    const chain = [s.name];
    let p = byId.get(s.parentSpanId);
    for (let i = 0; p && i < 50; i++) {
      chain.push(p.name);
      p = byId.get(p.parentSpanId);
    }
    if (chain.some(n => n.startsWith('tools/call contextverity.'))) {
      underToolsCall++;
      if (!example.length) example = chain;
    }
  }
  const leakedValues = spans
    .filter(s => s.name.startsWith('contextverity.'))
    .some(s => JSON.stringify(s.attributes).includes('team-payments'));
  const metricsText = await (
    await fetch('http://127.0.0.1:9464/metrics')
  ).text();
  const metricNames = [
    ...new Set(
      metricsText
        .split('\n')
        .filter(l => l.startsWith('contextverity_'))
        .map(l => l.split(/[{ ]/)[0]),
    ),
  ].sort();
  const labelKeys = [
    ...new Set(
      metricsText
        .split('\n')
        .filter(l => l.startsWith('contextverity_'))
        .flatMap(l =>
          [...(l.match(/\{(.*)\}/)?.[1] ?? '').matchAll(/(\w+)="/g)].map(
            m => m[1],
          ),
        ),
    ),
  ].sort();
  const report = {
    schemaVersion: 1,
    kind: 'contextverity.telemetry',
    tier: 'backstage',
    scope:
      'Live lab with the OpenTelemetry Node SDK loaded via --require (HTTP + undici instrumentation, Prometheus exporter, JSON-lines span file). One run of the reference MCP client.',
    generatedAt: new Date().toISOString(),
    environment: environment(ROOT),
    traces: {
      contextverityRootSpans: roots.length,
      nestedUnderMcpToolsCall: underToolsCall,
      exampleChain: example,
      spanNames: [
        ...new Set(
          spans
            .filter(s => s.name.startsWith('contextverity.'))
            .map(s => s.name),
        ),
      ].sort(),
      contextValuesInSpanAttributes: leakedValues,
    },
    metrics: { exposedNames: metricNames, labelKeys },
    pass:
      roots.length > 0 &&
      underToolsCall === roots.length &&
      !leakedValues &&
      !labelKeys.some(k => /receipt/i.test(k)),
  };
  writeFileSync(
    join(ROOT, 'test-results/telemetry-backstage.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    `telemetry: ${underToolsCall}/${roots.length} ContextVerity spans nested under MCP tools/call; metrics ${metricNames.length}; pass=${report.pass}`,
  );
  if (!report.pass) process.exitCode = 1;
}

function safeRead(f: string): string {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return '';
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
