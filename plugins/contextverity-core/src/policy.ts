/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CONTEXT_CATEGORIES,
  ContextCategory,
  DriftCode,
  SENSITIVITY_LEVELS,
  SOURCE_KINDS,
  Sensitivity,
  SourceKind,
  isContextCategory,
  isSensitivity,
} from '@contextverity/plugin-contextverity-common';
import { canonicalSet, digestOf } from './canonical';
import { normalizeRef } from './refs';

/**
 * Drift codes whose default `REFRESH` effect a policy may escalate to `DENY`.
 * Policies can only make verification stricter, never weaker.
 *
 * @public
 */
export const ESCALATABLE_DRIFT_CODES = [
  'OWNER_CHANGED',
  'LIFECYCLE_CHANGED',
  'API_CHANGED',
  'API_DEPRECATED',
  'DEPENDENCY_CHANGED',
  'RELATION_CHANGED',
  'DOCUMENTATION_CHANGED',
  'SOURCE_CHANGED',
  'CLASSIFICATION_RAISED',
  'CLASSIFICATION_LOWERED',
  'ENTITY_RECREATED',
  'SOURCE_DELETED',
  'SOURCE_UNAVAILABLE',
] as const satisfies readonly DriftCode[];

/** @public */
export type EscalatableDriftCode = (typeof ESCALATABLE_DRIFT_CODES)[number];

/**
 * A context policy: the maximum context a set of consumers may receive about
 * a set of subjects for a set of purposes.
 *
 * @public
 */
export interface ContextPolicy {
  id: string;
  /** Free text; excluded from the policy digest. */
  description?: string;
  /** Principal refs, e.g. `user:default/alice` or `service:external:triage-agent`. `*` matches any. */
  consumers: string[];
  purposes: string[];
  subjects: {
    /** Lowercase entity kinds, e.g. `component`. Empty or absent matches any. */
    kinds?: string[];
    namespaces?: string[];
    /** Explicit subject refs. Empty or absent matches any. */
    refs?: string[];
  };
  allowedSourceKinds: SourceKind[];
  allowedCategories: ContextCategory[];
  sensitivityCeiling: Sensitivity;
  maxTtlSeconds: number;
  /**
   * Categories whose drift invalidates context (`REFRESH`). Drift in other
   * granted categories is reported with effect `NONE`.
   * Defaults to `allowedCategories`.
   */
  requireFresh?: ContextCategory[];
  /** Escalate selected drift codes from `REFRESH` to `DENY`. */
  denyOn?: EscalatableDriftCode[];
}

/**
 * Thrown for an invalid policy document.
 *
 * @public
 */
export class PolicyValidationError extends Error {
  constructor(readonly policyId: string, readonly problems: string[]) {
    super(`invalid context policy '${policyId}': ${problems.join('; ')}`);
    this.name = 'PolicyValidationError';
  }
}

function stringList(
  value: unknown,
  name: string,
  problems: string[],
  required: boolean,
): string[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
    problems.push(`${name} must be a list of strings`);
    return [];
  }
  if (required && value.length === 0)
    problems.push(`${name} must not be empty`);
  return value as string[];
}

/**
 * Validates and normalizes an untrusted policy document (from YAML/JSON or
 * app-config). Set-like lists are de-duplicated and sorted, refs lowercased.
 *
 * @public
 */
export function parsePolicy(input: unknown): ContextPolicy {
  const problems: string[] = [];
  const doc = (input ?? {}) as Record<string, unknown>;
  const id = typeof doc.id === 'string' && doc.id.trim() ? doc.id.trim() : '';
  if (!id) problems.push('id is required');
  if (id && !/^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/.test(id)) {
    problems.push('id must match [a-z0-9._-], 1-64 chars');
  }

  const consumers = stringList(doc.consumers, 'consumers', problems, true);
  const purposes = stringList(doc.purposes, 'purposes', problems, true);
  const subjectsDoc = (doc.subjects ?? {}) as Record<string, unknown>;
  const kinds = stringList(
    subjectsDoc.kinds,
    'subjects.kinds',
    problems,
    false,
  );
  const namespaces = stringList(
    subjectsDoc.namespaces,
    'subjects.namespaces',
    problems,
    false,
  );
  const refs = stringList(subjectsDoc.refs, 'subjects.refs', problems, false);

  const allowedSourceKinds = stringList(
    doc.allowedSourceKinds,
    'allowedSourceKinds',
    problems,
    true,
  );
  for (const k of allowedSourceKinds) {
    if (!(SOURCE_KINDS as readonly string[]).includes(k)) {
      problems.push(
        `unknown source kind '${k}' (allowed: ${SOURCE_KINDS.join(', ')})`,
      );
    }
  }
  const allowedCategories = stringList(
    doc.allowedCategories,
    'allowedCategories',
    problems,
    true,
  );
  const requireFresh =
    doc.requireFresh === undefined
      ? undefined
      : stringList(doc.requireFresh, 'requireFresh', problems, false);
  for (const c of [...allowedCategories, ...(requireFresh ?? [])]) {
    if (!isContextCategory(c)) {
      problems.push(
        `unknown category '${c}' (allowed: ${CONTEXT_CATEGORIES.join(', ')})`,
      );
    }
  }
  for (const c of requireFresh ?? []) {
    if (!allowedCategories.includes(c)) {
      problems.push(`requireFresh category '${c}' is not in allowedCategories`);
    }
  }
  if (!isSensitivity(doc.sensitivityCeiling)) {
    problems.push(
      `sensitivityCeiling must be one of ${SENSITIVITY_LEVELS.join(', ')}`,
    );
  }
  const maxTtl = doc.maxTtlSeconds;
  if (
    typeof maxTtl !== 'number' ||
    !Number.isInteger(maxTtl) ||
    maxTtl < 1 ||
    maxTtl > 86400 * 30
  ) {
    problems.push('maxTtlSeconds must be an integer between 1 and 2592000');
  }
  const denyOn = stringList(doc.denyOn, 'denyOn', problems, false);
  for (const c of denyOn) {
    if (!(ESCALATABLE_DRIFT_CODES as readonly string[]).includes(c)) {
      problems.push(`denyOn code '${c}' cannot be configured`);
    }
  }
  if (problems.length)
    throw new PolicyValidationError(id || '<missing id>', problems);

  return {
    id,
    description:
      typeof doc.description === 'string' ? doc.description : undefined,
    consumers: canonicalSet(
      consumers.map(c => (c === '*' ? c : c.toLowerCase())),
    ),
    purposes: canonicalSet(purposes),
    subjects: {
      kinds: canonicalSet(kinds.map(k => k.toLowerCase())),
      namespaces: canonicalSet(namespaces.map(n => n.toLowerCase())),
      refs: canonicalSet(refs.map(normalizeRef)),
    },
    allowedSourceKinds: canonicalSet(allowedSourceKinds) as SourceKind[],
    allowedCategories: canonicalSet(allowedCategories) as ContextCategory[],
    sensitivityCeiling: doc.sensitivityCeiling as Sensitivity,
    maxTtlSeconds: maxTtl as number,
    requireFresh: requireFresh
      ? (canonicalSet(requireFresh) as ContextCategory[])
      : undefined,
    denyOn: canonicalSet(denyOn) as EscalatableDriftCode[],
  };
}

/**
 * Digest of a policy's semantic content. Formatting, key order, list order,
 * duplicates and `description` do not affect it; any change to who, what,
 * how long or how strict does.
 *
 * @public
 */
export function policyDigest(policy: ContextPolicy): string {
  const p = parsePolicy(policy);
  return digestOf({
    id: p.id,
    consumers: p.consumers,
    purposes: p.purposes,
    subjects: p.subjects,
    allowedSourceKinds: p.allowedSourceKinds,
    allowedCategories: p.allowedCategories,
    sensitivityCeiling: p.sensitivityCeiling,
    maxTtlSeconds: p.maxTtlSeconds,
    requireFresh: p.requireFresh ?? p.allowedCategories,
    denyOn: p.denyOn ?? [],
  });
}

/** @public */
export function policyMatchesConsumer(
  policy: ContextPolicy,
  principal: string,
): boolean {
  const p = principal.toLowerCase();
  return policy.consumers.some(c => c === '*' || c === p);
}

/** @public */
export function policyMatchesSubject(
  policy: ContextPolicy,
  subjectRef: string,
): boolean {
  const ref = normalizeRef(subjectRef);
  const m = /^([^:]+):([^/]+)\/(.+)$/.exec(ref);
  if (!m) return false;
  const [, kind, namespace] = m;
  const { kinds, namespaces, refs } = policy.subjects;
  if (kinds?.length && !kinds.includes(kind)) return false;
  if (namespaces?.length && !namespaces.includes(namespace)) return false;
  if (refs?.length && !refs.includes(ref)) return false;
  return true;
}

/** @public */
export function policyMatches(
  policy: ContextPolicy,
  principal: string,
  purpose: string,
  subjectRef: string,
): boolean {
  return (
    policyMatchesConsumer(policy, principal) &&
    policy.purposes.includes(purpose) &&
    policyMatchesSubject(policy, subjectRef)
  );
}
