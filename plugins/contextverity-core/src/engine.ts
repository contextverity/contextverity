/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ContextCategory,
  ContextReceipt,
  DriftCode,
  DriftEffect,
  DriftItem,
  PermissionDecisionRecord,
  Sensitivity,
  SourceRecord,
  Verdict,
  VerifyIntent,
  sensitivityRank,
} from '@contextverity/plugin-contextverity-common';
import { canonicalize } from './canonical';
import {
  ContextPolicy,
  EscalatableDriftCode,
  policyDigest,
  policyMatchesConsumer,
  policyMatchesSubject,
} from './policy';
import { normalizeRef } from './refs';

/**
 * Current state of one previously recorded source, as observed by a provider.
 *
 * @public
 */
export type SourceObservation =
  | { sourceId: string; status: 'OK'; record: SourceRecord }
  | { sourceId: string; status: 'NOT_FOUND' }
  | { sourceId: string; status: 'UNAVAILABLE'; error: string }
  | { sourceId: string; status: 'MALFORMED'; error: string };

/**
 * Everything the engine needs to decide a verdict. Gathering these inputs is
 * the orchestrator's job; deciding is purely a function of them.
 *
 * @public
 */
export interface VerificationInputs {
  receipt: ContextReceipt;
  /** Principal asking to reuse the receipt. */
  principal: string;
  intent: VerifyIntent;
  now: Date;
  /** Current policy with the receipt's policy id, if it still exists. */
  policy: ContextPolicy | undefined;
  observations: SourceObservation[];
  /** Permission decisions re-evaluated now for `principal`. */
  permissions: PermissionDecisionRecord[];
}

/** @public */
export interface EngineResult {
  verdict: Verdict;
  drift: DriftItem[];
}

const EFFECT_RANK: Record<DriftEffect, number> = {
  NONE: 0,
  REFRESH: 1,
  DENY: 2,
};

/**
 * Field names whose drift has a more specific code than their category.
 */
const FIELD_CODES: Record<string, DriftCode> = {
  system: 'RELATION_CHANGED',
  partOf: 'RELATION_CHANGED',
};

const CATEGORY_CODES: Record<ContextCategory, DriftCode> = {
  identity: 'SOURCE_CHANGED',
  ownership: 'OWNER_CHANGED',
  lifecycle: 'LIFECYCLE_CHANGED',
  dependencies: 'DEPENDENCY_CHANGED',
  apis: 'API_CHANGED',
  'api-definition': 'API_CHANGED',
  documentation: 'DOCUMENTATION_CHANGED',
};

/** @public */
export function verdictOf(drift: readonly DriftItem[]): Verdict {
  let rank = 0;
  for (const d of drift) rank = Math.max(rank, EFFECT_RANK[d.effect]);
  const verdicts: Verdict[] = ['VALID', 'REFRESH', 'DENY'];
  return verdicts[rank];
}

/**
 * Deterministic order: strongest effect first, then code, source, field.
 *
 * @public
 */
export function sortDrift(drift: DriftItem[]): DriftItem[] {
  return [...drift].sort(
    (a, b) =>
      EFFECT_RANK[b.effect] - EFFECT_RANK[a.effect] ||
      cmp(a.code, b.code) ||
      cmp(a.sourceId ?? '', b.sourceId ?? '') ||
      cmp(a.field ?? '', b.field ?? '') ||
      cmp(a.detail, b.detail),
  );
}

function cmp(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Binding checks that must pass before any source is re-fetched. If one
 * fails, the caller learns nothing about current source state.
 *
 * @public
 */
export function checkBinding(args: {
  receipt: ContextReceipt;
  integrityOk: boolean;
  issuer: string;
  principal: string;
}): DriftItem[] {
  const { receipt, integrityOk, issuer, principal } = args;
  if (!integrityOk) {
    return [
      {
        code: 'RECEIPT_INTEGRITY_FAILED',
        effect: 'DENY',
        detail: 'stored receipt does not match its integrity tag',
      },
    ];
  }
  const out: DriftItem[] = [];
  if (receipt.issuer !== issuer) {
    out.push({
      code: 'ISSUER_MISMATCH',
      effect: 'DENY',
      before: receipt.issuer,
      after: issuer,
      detail: 'receipt was issued by a different ContextVerity instance',
    });
  }
  if (receipt.consumer !== principal.toLowerCase()) {
    out.push({
      code: 'CONSUMER_MISMATCH',
      effect: 'DENY',
      detail: 'receipt is bound to a different consumer',
    });
  }
  return sortDrift(out);
}

/**
 * Decides the verdict for a receipt that passed {@link checkBinding}.
 *
 * @public
 */
export function evaluate(inputs: VerificationInputs): EngineResult {
  const { receipt, intent, now, policy, observations, permissions } = inputs;
  const grant = receipt.grant;
  const drift: DriftItem[] = [];
  const denyOn = new Set<EscalatableDriftCode>(policy?.denyOn ?? []);
  const escalate = (code: EscalatableDriftCode): DriftEffect =>
    denyOn.has(code) ? 'DENY' : 'REFRESH';

  // 1. What is the receipt being reused for?
  if (
    intent.subject !== undefined &&
    normalizeRef(intent.subject) !== receipt.subject
  ) {
    drift.push({
      code: 'SUBJECT_MISMATCH',
      effect: 'DENY',
      before: receipt.subject,
      after: normalizeRef(intent.subject),
      detail: 'receipt describes a different subject',
    });
  }
  if (intent.purpose !== undefined && intent.purpose !== receipt.purpose) {
    drift.push({
      code: 'PURPOSE_MISMATCH',
      effect: 'DENY',
      before: receipt.purpose,
      after: intent.purpose,
      detail: 'receipt was issued for a different purpose',
    });
  }
  const extra = (intent.categories ?? []).filter(
    c => !grant.categories.includes(c),
  );
  if (extra.length) {
    drift.push({
      code: 'SCOPE_EXCEEDED',
      effect: 'DENY',
      before: grant.categories,
      after: [...new Set(extra)].sort(),
      detail:
        'requested categories are outside this receipt; resolve a new receipt',
    });
  }

  // 2. Policy: still present, unchanged or at least not narrower?
  let ceiling: Sensitivity = grant.sensitivityCeiling;
  let maxTtl = grant.ttlSeconds;
  let requireFresh: ContextCategory[] = grant.categories;
  if (!policy) {
    drift.push({
      code: 'POLICY_REMOVED',
      effect: 'DENY',
      before: grant.policyId,
      detail: `policy '${grant.policyId}' no longer exists`,
    });
  } else {
    if (sensitivityRank(policy.sensitivityCeiling) < sensitivityRank(ceiling)) {
      ceiling = policy.sensitivityCeiling;
    }
    maxTtl = Math.min(maxTtl, policy.maxTtlSeconds);
    requireFresh = (policy.requireFresh ?? policy.allowedCategories).filter(c =>
      grant.categories.includes(c),
    );
    const digest = policyDigest(policy);
    if (digest !== grant.policyDigest) {
      const narrowed = narrowingReasons(receipt, policy);
      drift.push(
        narrowed.length
          ? {
              code: 'POLICY_NARROWED',
              effect: 'DENY',
              before: grant.policyDigest,
              after: digest,
              detail: `current policy no longer covers this receipt: ${narrowed.join(
                '; ',
              )}`,
            }
          : {
              code: 'POLICY_CHANGED',
              effect: 'NONE',
              before: grant.policyDigest,
              after: digest,
              detail:
                'policy changed but still covers this receipt; the receipt keeps its original grant',
            },
      );
    }
  }

  // 3. Time. Valid strictly before the effective expiry.
  const issued = Date.parse(receipt.issuedAt);
  const expiry = Math.min(
    Date.parse(receipt.validUntil),
    issued + maxTtl * 1000,
  );
  if (now.getTime() >= expiry) {
    drift.push({
      code: 'TTL_EXPIRED',
      effect: 'REFRESH',
      before: receipt.validUntil,
      after: now.toISOString(),
      detail: `context expired at ${new Date(expiry).toISOString()}`,
    });
  }

  // 4. Permissions are re-evaluated; the issue-time decision is never trusted.
  for (const p of permissions) {
    if (p.result === 'DENY') {
      drift.push({
        code: 'PERMISSION_REVOKED',
        effect: 'DENY',
        sourceId: p.sourceId,
        field: p.permission,
        before: 'ALLOW',
        after: 'DENY',
        detail: `${p.permission} is now denied for ${p.principal}`,
      });
    }
  }

  // 5. Source state.
  const byId = new Map(observations.map(o => [o.sourceId, o]));
  for (const recorded of receipt.sources) {
    const obs = byId.get(recorded.sourceId);
    drift.push(
      ...compareSource(recorded, obs, {
        ceiling,
        requireFresh,
        grant: grant.categories,
        escalate,
      }),
    );
  }

  const sorted = sortDrift(drift);
  return { verdict: verdictOf(sorted), drift: sorted };
}

function narrowingReasons(
  receipt: ContextReceipt,
  policy: ContextPolicy,
): string[] {
  const reasons: string[] = [];
  if (!policyMatchesConsumer(policy, receipt.consumer))
    reasons.push('consumer no longer allowed');
  if (!policy.purposes.includes(receipt.purpose))
    reasons.push('purpose no longer allowed');
  if (!policyMatchesSubject(policy, receipt.subject))
    reasons.push('subject no longer in scope');
  const cats = receipt.grant.categories.filter(
    c => !policy.allowedCategories.includes(c),
  );
  if (cats.length)
    reasons.push(`categories no longer allowed: ${cats.join(', ')}`);
  const kinds = [...new Set(receipt.sources.map(s => s.kind))]
    .filter(k => !policy.allowedSourceKinds.includes(k))
    .sort();
  if (kinds.length)
    reasons.push(`source kinds no longer allowed: ${kinds.join(', ')}`);
  if (
    sensitivityRank(receipt.classification) >
    sensitivityRank(policy.sensitivityCeiling)
  ) {
    reasons.push(
      `classification ${receipt.classification} exceeds new ceiling ${policy.sensitivityCeiling}`,
    );
  }
  return reasons;
}

function compareSource(
  recorded: SourceRecord,
  obs: SourceObservation | undefined,
  ctx: {
    ceiling: Sensitivity;
    requireFresh: ContextCategory[];
    grant: ContextCategory[];
    escalate: (code: EscalatableDriftCode) => DriftEffect;
  },
): DriftItem[] {
  const sourceId = recorded.sourceId;
  if (!obs || obs.status === 'UNAVAILABLE') {
    return [
      {
        code: 'SOURCE_UNAVAILABLE',
        effect: recorded.required ? ctx.escalate('SOURCE_UNAVAILABLE') : 'NONE',
        sourceId,
        detail: recorded.required
          ? `required source could not be checked${obs ? `: ${obs.error}` : ''}`
          : `optional source could not be checked; its context is unverified${
              obs ? `: ${obs.error}` : ''
            }`,
      },
    ];
  }
  if (obs.status === 'NOT_FOUND') {
    return [
      {
        code: 'SOURCE_DELETED',
        effect: ctx.escalate('SOURCE_DELETED'),
        sourceId,
        detail: 'source no longer exists',
      },
    ];
  }
  if (obs.status === 'MALFORMED') {
    return [
      {
        code: 'SOURCE_MALFORMED',
        effect: 'DENY',
        sourceId,
        detail: `source could not be normalized, so classification and scope cannot be checked: ${obs.error}`,
      },
    ];
  }

  const current = obs.record;
  if (
    current.digest === recorded.digest &&
    current.identity === recorded.identity
  )
    return [];

  const out: DriftItem[] = [];
  if (
    recorded.identity &&
    current.identity &&
    recorded.identity !== current.identity
  ) {
    out.push({
      code: 'ENTITY_RECREATED',
      effect: ctx.escalate('ENTITY_RECREATED'),
      sourceId,
      before: recorded.identity,
      after: current.identity,
      detail:
        'same reference now points to a different object (deleted and recreated)',
    });
  }

  const before = sensitivityRank(recorded.classification);
  const after = sensitivityRank(current.classification);
  if (after > before) {
    const aboveCeiling = after > sensitivityRank(ctx.ceiling);
    out.push({
      code: 'CLASSIFICATION_RAISED',
      effect: aboveCeiling ? 'DENY' : ctx.escalate('CLASSIFICATION_RAISED'),
      sourceId,
      before: recorded.classification,
      after: current.classification,
      detail: aboveCeiling
        ? `classification ${current.classification} exceeds the grant ceiling ${ctx.ceiling}`
        : `classification raised within the grant ceiling ${ctx.ceiling}`,
    });
  } else if (after < before) {
    out.push({
      code: 'CLASSIFICATION_LOWERED',
      effect: ctx.escalate('CLASSIFICATION_LOWERED'),
      sourceId,
      before: recorded.classification,
      after: current.classification,
      detail:
        'classification lowered; the receipt stays bounded by its original grant',
    });
  }

  const names = [
    ...new Set([
      ...Object.keys(recorded.fields),
      ...Object.keys(current.fields),
    ]),
  ].sort();
  for (const name of names) {
    const a = recorded.fields[name];
    const b = current.fields[name];
    const category = (a ?? b).category;
    if (!ctx.grant.includes(category)) continue;
    const av = a === undefined ? undefined : canonicalize(a.value);
    const bv = b === undefined ? undefined : canonicalize(b.value);
    if (av === bv) continue;
    let code = FIELD_CODES[name] ?? CATEGORY_CODES[category];
    if (
      name === 'lifecycle' &&
      recorded.kind === 'API_DEFINITION' &&
      b?.value === 'deprecated'
    ) {
      code = 'API_DEPRECATED';
    }
    const fresh = ctx.requireFresh.includes(category);
    out.push({
      code,
      effect: fresh ? ctx.escalate(code as EscalatableDriftCode) : 'NONE',
      sourceId,
      field: name,
      before: a?.value ?? null,
      after: b?.value ?? null,
      detail: fresh
        ? `${name} changed`
        : `${name} changed; category '${category}' is not required to be fresh by policy`,
    });
  }

  if (out.length === 0) {
    // Digest differs but no recorded field did: state outside the granted
    // fields changed in a way the provider still considers part of the source.
    out.push({
      code: 'SOURCE_CHANGED',
      effect: ctx.escalate('SOURCE_CHANGED'),
      sourceId,
      before: recorded.digest,
      after: current.digest,
      detail: 'source digest changed',
    });
  }
  return out;
}
