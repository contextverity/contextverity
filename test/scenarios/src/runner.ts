/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { arch, cpus, platform, totalmem } from 'node:os';
import { join } from 'node:path';
import type {
  CanonicalValue,
  DriftItem,
} from '@contextverity/plugin-contextverity-common';
import { Harness, Tier, UnsupportedError } from './harness/types';
import {
  Expectation,
  Observation,
  Outcome,
  SCENARIOS,
  Scenario,
} from './scenarios';

export interface ScenarioResult {
  id: string;
  title: string;
  group: string;
  relevantChange: boolean;
  expect: Expectation;
  status: 'PASS' | 'FAIL' | 'UNSUPPORTED';
  unsupportedReason?: string;
  failures?: string[];
  observed?: {
    outcome: Outcome;
    codes: string[];
    informational: string[];
    denialCode?: string;
    checks: Array<{ name: string; ok: boolean; detail?: string }>;
  };
  durationMs: number;
  replay?: Replay;
}

export interface Replay {
  actor?: string;
  subject?: string;
  purpose?: string;
  steps: string[];
  issued?: Array<{
    sourceId: string;
    classification: string;
    fields: Record<string, CanonicalValue>;
  }>;
  current?:
    | {
        ok: true;
        context: Array<{
          sourceId: string;
          classification: string;
          fields: Record<string, CanonicalValue>;
        }>;
      }
    | { ok: false; code: string };
  drift: DriftItem[];
  verdict?: string;
}

export interface Rate {
  numerator: number;
  denominator: number;
  value: number | null;
}

export interface ScenarioReport {
  schemaVersion: 1;
  kind: 'contextverity.scenarios';
  tier: Tier;
  scope: string;
  generatedAt: string;
  environment: Record<string, unknown>;
  summary: {
    total: number;
    executed: number;
    passed: number;
    failed: number;
    unsupported: number;
    observedOutcomes: Record<Outcome, number>;
    metrics: {
      staleDetectionRate: Rate;
      falseInvalidationRate: Rate;
      falseAcceptanceRate: Rate;
      denyCorrectness: Rate;
      refreshCorrectness: Rate;
      resolveRefusalCorrectness: Rate;
    };
  };
  scenarios: ScenarioResult[];
}

function sameSet(a: string[], b: string[]) {
  return (
    a.length === b.length &&
    [...a].sort().every((x, i) => x === [...b].sort()[i])
  );
}

export function judge(expect: Expectation, obs: Observation): string[] {
  const failures: string[] = [];
  if (obs.outcome !== expect.outcome)
    failures.push(`outcome ${obs.outcome} != expected ${expect.outcome}`);
  if (expect.codes && !sameSet(expect.codes, obs.codes)) {
    failures.push(`codes [${obs.codes}] != expected [${expect.codes}]`);
  }
  for (const c of expect.informational ?? []) {
    if (!obs.informational.includes(c))
      failures.push(`missing informational ${c}`);
  }
  if (expect.denialCode && obs.denialCode !== expect.denialCode) {
    failures.push(`denial ${obs.denialCode} != expected ${expect.denialCode}`);
  }
  for (const c of obs.checks)
    if (!c.ok)
      failures.push(
        `check failed: ${c.name}${c.detail ? ` (${c.detail})` : ''}`,
      );
  return failures;
}

export async function runScenario(
  h: Harness,
  s: Scenario,
): Promise<ScenarioResult> {
  const base = {
    id: s.id,
    title: s.title,
    group: s.group,
    relevantChange: s.relevantChange,
    expect: s.expect,
  };
  const missing = (s.requires ?? []).filter(c => !h.capabilities.has(c));
  if (missing.length) {
    return {
      ...base,
      status: 'UNSUPPORTED',
      unsupportedReason: `tier '${h.tier}' lacks: ${missing.join(', ')}`,
      durationMs: 0,
    };
  }
  await h.reset();
  const t = performance.now();
  try {
    const obs = await s.run(h);
    const durationMs = performance.now() - t;
    const failures = judge(s.expect, obs);
    let current: Replay['current'];
    if (obs.request && obs.actor) {
      const again = await h.resolve(obs.actor, obs.request);
      current = again.ok
        ? {
            ok: true,
            context: again.response.context.map(c => ({
              sourceId: c.sourceId,
              classification: c.classification,
              fields: c.fields,
            })),
          }
        : { ok: false, code: again.code };
    }
    return {
      ...base,
      status: failures.length ? 'FAIL' : 'PASS',
      failures: failures.length ? failures : undefined,
      observed: {
        outcome: obs.outcome,
        codes: obs.codes,
        informational: obs.informational,
        denialCode: obs.denialCode,
        checks: obs.checks,
      },
      durationMs: Math.round(durationMs * 100) / 100,
      replay: {
        actor: obs.actor,
        subject: obs.request?.subject,
        purpose: obs.request?.purpose,
        steps: obs.steps,
        issued: obs.issued?.context.map(c => ({
          sourceId: c.sourceId,
          classification: c.classification,
          fields: c.fields,
        })),
        current,
        drift: obs.verification?.drift ?? [],
        verdict: obs.verification?.verdict,
      },
    };
  } catch (e) {
    if (e instanceof UnsupportedError) {
      return {
        ...base,
        status: 'UNSUPPORTED',
        unsupportedReason: e.message,
        durationMs: 0,
      };
    }
    return {
      ...base,
      status: 'FAIL',
      failures: [`error: ${(e as Error).stack ?? e}`],
      durationMs: performance.now() - t,
    };
  }
}

function rate(numerator: number, denominator: number): Rate {
  return {
    numerator,
    denominator,
    value: denominator ? numerator / denominator : null,
  };
}

export function summarize(
  results: ScenarioResult[],
): ScenarioReport['summary'] {
  const ran = results.filter(r => r.status !== 'UNSUPPORTED' && r.observed);
  const observedOutcomes: Record<Outcome, number> = {
    VALID: 0,
    REFRESH: 0,
    DENY: 0,
    RESOLVE_DENIED: 0,
  };
  for (const r of ran) observedOutcomes[r.observed!.outcome]++;
  const verifyStale = ran.filter(
    r => r.expect.outcome === 'REFRESH' || r.expect.outcome === 'DENY',
  );
  const verifyValid = ran.filter(r => r.expect.outcome === 'VALID');
  const expDeny = ran.filter(r => r.expect.outcome === 'DENY');
  const expRefresh = ran.filter(r => r.expect.outcome === 'REFRESH');
  const expResolveDenied = ran.filter(
    r => r.expect.outcome === 'RESOLVE_DENIED',
  );
  return {
    total: results.length,
    executed: results.filter(r => r.status !== 'UNSUPPORTED').length,
    passed: results.filter(r => r.status === 'PASS').length,
    failed: results.filter(r => r.status === 'FAIL').length,
    unsupported: results.filter(r => r.status === 'UNSUPPORTED').length,
    observedOutcomes,
    metrics: {
      staleDetectionRate: rate(
        verifyStale.filter(r => r.observed!.outcome !== 'VALID').length,
        verifyStale.length,
      ),
      falseInvalidationRate: rate(
        verifyValid.filter(r => r.observed!.outcome !== 'VALID').length,
        verifyValid.length,
      ),
      falseAcceptanceRate: rate(
        verifyStale.filter(r => r.observed!.outcome === 'VALID').length,
        verifyStale.length,
      ),
      denyCorrectness: rate(
        expDeny.filter(r => r.observed!.outcome === 'DENY').length,
        expDeny.length,
      ),
      refreshCorrectness: rate(
        expRefresh.filter(r => r.observed!.outcome === 'REFRESH').length,
        expRefresh.length,
      ),
      resolveRefusalCorrectness: rate(
        expResolveDenied.filter(
          r =>
            r.observed!.outcome === 'RESOLVE_DENIED' &&
            r.observed!.denialCode === r.expect.denialCode,
        ).length,
        expResolveDenied.length,
      ),
    },
  };
}

export function environment(
  rootDir: string,
  extra: Record<string, unknown> = {},
) {
  const git = (cmd: string) => {
    try {
      return execSync(`git ${cmd}`, {
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
    } catch {
      return undefined;
    }
  };
  const pkg = (p: string) => JSON.parse(readFileSync(join(rootDir, p), 'utf8'));
  return {
    contextverityVersion: pkg('plugins/contextverity-core/package.json')
      .version,
    commit: git('rev-parse HEAD') ?? 'uncommitted',
    // Generated outputs are excluded: they change while results are produced.
    dirtyWorkingTree: git(
      "status --porcelain -- . ':!test-results' ':!docs/results.md' ':!README.md'",
    )
      ? true
      : false,
    backstageRelease: pkg('backstage.json').version,
    node: process.version,
    platform: `${platform()} ${arch()}`,
    cpu: cpus()[0]?.model,
    cpuCount: cpus().length,
    memoryGiB: Math.round(totalmem() / 2 ** 30),
    ...extra,
  };
}

export async function runAll(
  h: Harness,
  rootDir: string,
  scope: string,
  extra: Record<string, unknown> = {},
  filter?: (s: Scenario) => boolean,
): Promise<ScenarioReport> {
  const results: ScenarioResult[] = [];
  for (const s of SCENARIOS.filter(filter ?? (() => true))) {
    results.push(await runScenario(h, s));
  }
  await h.close();
  return {
    schemaVersion: 1,
    kind: 'contextverity.scenarios',
    tier: h.tier,
    scope,
    generatedAt: new Date().toISOString(),
    environment: environment(rootDir, extra),
    summary: summarize(results),
    scenarios: results,
  };
}
