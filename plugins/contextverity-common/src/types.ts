/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Classification levels, ordered from least to most restrictive.
 *
 * ContextVerity does not infer classification from content. A catalog owner
 * declares it explicitly (see `CLASSIFICATION_ANNOTATION`), or the configured
 * default applies.
 *
 * @public
 */
export const SENSITIVITY_LEVELS = ['PUBLIC', 'INTERNAL', 'RESTRICTED'] as const;

/** @public */
export type Sensitivity = (typeof SENSITIVITY_LEVELS)[number];

/** @public */
export const VERDICTS = ['VALID', 'REFRESH', 'DENY'] as const;

/**
 * - `VALID`: at verification time the context matched the relevant source,
 *   permission and policy state. It is NOT a guarantee about the future.
 * - `REFRESH`: the context is no longer current, but nothing indicates the
 *   consumer is prohibited from it. Obtain fresh context before acting.
 * - `DENY`: current authorization, classification, binding or policy no
 *   longer permits this context for the stated use.
 *
 * @public
 */
export type Verdict = (typeof VERDICTS)[number];

/** @public */
export const SOURCE_KINDS = [
  'CATALOG_ENTITY',
  'API_DEFINITION',
  'DOCUMENTATION',
  'RELATION',
  'POLICY',
  'CUSTOM',
] as const;

/** @public */
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * Coarse context categories a grant can allow. Every normalized field belongs
 * to exactly one category.
 *
 * @public
 */
export const CONTEXT_CATEGORIES = [
  'identity',
  'ownership',
  'lifecycle',
  'dependencies',
  'apis',
  'api-definition',
  'documentation',
] as const;

/** @public */
export type ContextCategory = (typeof CONTEXT_CATEGORIES)[number];

/**
 * Typed drift reason codes.
 *
 * @public
 */
export const DRIFT_CODES = [
  // source-state drift
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
  'SOURCE_MALFORMED',
  // authorization / policy drift
  'PERMISSION_REVOKED',
  'POLICY_CHANGED',
  'POLICY_NARROWED',
  'POLICY_REMOVED',
  // time
  'TTL_EXPIRED',
  // binding checks (who / what / why the receipt is being reused for)
  'CONSUMER_MISMATCH',
  'SUBJECT_MISMATCH',
  'PURPOSE_MISMATCH',
  'SCOPE_EXCEEDED',
  'ISSUER_MISMATCH',
  'RECEIPT_INTEGRITY_FAILED',
] as const;

/** @public */
export type DriftCode = (typeof DRIFT_CODES)[number];

/**
 * What a drift item does to the verdict.
 * `NONE` items are reported for transparency but do not invalidate context.
 *
 * @public
 */
export type DriftEffect = 'NONE' | 'REFRESH' | 'DENY';

/**
 * Reasons `resolve` can refuse to issue a receipt.
 *
 * @public
 */
export const RESOLVE_DENIAL_CODES = [
  'NO_MATCHING_POLICY',
  'AMBIGUOUS_POLICY',
  'CATEGORY_NOT_GRANTED',
  'SOURCE_NOT_PERMITTED',
  'CLASSIFICATION_EXCEEDS_GRANT',
  'PERMISSION_DENIED',
  'SUBJECT_NOT_FOUND',
  'SOURCE_UNAVAILABLE',
  'SOURCE_MALFORMED',
] as const;

/** @public */
export type ResolveDenialCode = (typeof RESOLVE_DENIAL_CODES)[number];

/**
 * A JSON value that can be canonicalized deterministically.
 *
 * @public
 */
export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

/**
 * A normalized fact taken from a source.
 *
 * @public
 */
export interface ContextField {
  category: ContextCategory;
  value: CanonicalValue;
}

/**
 * A normalized, provider-independent source record.
 *
 * Providers translate their native objects (for example a Backstage catalog
 * entity) into this shape. Only fields in granted categories are kept.
 *
 * @public
 */
export interface SourceRecord {
  /** Stable source identifier, e.g. `catalog:component:default/payments`. */
  sourceId: string;
  kind: SourceKind;
  /** Provider that produced the record, e.g. `backstage-catalog`. */
  provider: string;
  /**
   * Authoritative identity of the underlying object, if the source has one
   * (for the Backstage catalog: `metadata.uid`). A change of identity under
   * the same `sourceId` means the object was deleted and recreated.
   */
  identity?: string;
  /** Whether context is unusable without this source. */
  required: boolean;
  classification: Sensitivity;
  /** Normalized fields, keyed by field name. */
  fields: Record<string, ContextField>;
  /** SHA-256 over the canonical form of the record (see core canonicalize). */
  digest: string;
}

/**
 * The permission check evaluated for a source at issue or verify time.
 *
 * @public
 */
export interface PermissionDecisionRecord {
  /** Permission name, e.g. `catalog.entity.read`. */
  permission: string;
  /** Resource the permission was evaluated against, if any. */
  resourceRef?: string;
  /** Source the decision applies to, if any. */
  sourceId?: string;
  result: 'ALLOW' | 'DENY';
  /** Principal the decision was evaluated for. */
  principal: string;
  /**
   * How the decision was reached.
   * - `permission-policy`: the platform's permission policy evaluated it.
   * - `service-principal`: the caller is a service; the platform does not
   *   consult its permission policy for services (Backstage behavior), so
   *   only service access restrictions could have denied it.
   */
  basis: 'permission-policy' | 'service-principal';
}

/**
 * The maximum context a consumer may receive for a purpose, as it applied to
 * one specific receipt. Stored inside the receipt and never widened later.
 *
 * @public
 */
export interface ContextGrant {
  policyId: string;
  /** Canonical digest of the policy's semantic content at issue time. */
  policyDigest: string;
  consumer: string;
  purpose: string;
  subject: string;
  categories: ContextCategory[];
  sourceKinds: SourceKind[];
  sensitivityCeiling: Sensitivity;
  ttlSeconds: number;
}

/**
 * Immutable, server-authoritative record of exactly what context was issued.
 * Contains references, normalized decision inputs and digests; never secrets
 * or document bodies.
 *
 * @public
 */
export interface ContextReceipt {
  receiptId: string;
  /** Identifier of the ContextVerity instance that issued the receipt. */
  issuer: string;
  schemaVersion: 1;
  issuedAt: string;
  validUntil: string;
  consumer: string;
  subject: string;
  purpose: string;
  grant: ContextGrant;
  sources: SourceRecord[];
  permissions: PermissionDecisionRecord[];
  /** Highest classification across sources at issue time. */
  classification: Sensitivity;
  /** SHA-256 over the canonical snapshot (sources + grant + bindings). */
  snapshotDigest: string;
}

/** @public */
export interface DriftItem {
  code: DriftCode;
  effect: DriftEffect;
  sourceId?: string;
  field?: string;
  before?: CanonicalValue;
  after?: CanonicalValue;
  detail: string;
}

/** @public */
export interface ContextVerification {
  receiptId: string;
  /**
   * `verify`: the bound consumer asked to reuse the receipt; permissions were
   * re-evaluated for that consumer.
   * `inspect`: an operator looked at drift; source, policy and TTL were
   * checked but the consumer's permissions could not be re-evaluated.
   */
  mode: 'verify' | 'inspect';
  /** Principal that requested this verification or inspection. */
  principal: string;
  verifiedAt: string;
  verdict: Verdict;
  /** Sorted deterministically: effect (DENY first), code, sourceId, field. */
  drift: DriftItem[];
  /** Permission decisions re-evaluated at verification time. */
  permissions: PermissionDecisionRecord[];
  /** Number of sources re-fetched. */
  sourcesChecked: number;
}

/**
 * What the caller intends to reuse a receipt for. Every field is optional;
 * when present it is compared against the receipt's binding.
 *
 * @public
 */
export interface VerifyIntent {
  subject?: string;
  purpose?: string;
  categories?: ContextCategory[];
}

/**
 * Request body for `POST /v1/resolve`.
 *
 * @public
 */
export interface ResolveRequest {
  subject: string;
  purpose: string;
  categories: ContextCategory[];
  ttlSeconds?: number;
  policyId?: string;
}

/** @public */
export interface ResolveResponse {
  receipt: ContextReceipt;
  /**
   * The resolved context, flattened per source for the consumer. This is
   * returned to the caller but stored only as digests inside the receipt.
   */
  context: Array<{
    sourceId: string;
    kind: SourceKind;
    classification: Sensitivity;
    fields: Record<string, CanonicalValue>;
  }>;
}

/** @public */
export interface ResolveDenial {
  code: ResolveDenialCode;
  detail: string;
}

/** @public */
export interface ReceiptSummary {
  receiptId: string;
  issuedAt: string;
  validUntil: string;
  consumer: string;
  subject: string;
  purpose: string;
  classification: Sensitivity;
  lastVerdict?: Verdict;
  lastVerifiedAt?: string;
}

/** @public */
export interface ReceiptDetail {
  receipt: ContextReceipt;
  integrity: 'OK' | 'FAILED';
  verifications: ContextVerification[];
}

/** @public */
export function sensitivityRank(level: Sensitivity): number {
  return SENSITIVITY_LEVELS.indexOf(level);
}

/** @public */
export function isSensitivity(value: unknown): value is Sensitivity {
  return (
    typeof value === 'string' &&
    (SENSITIVITY_LEVELS as readonly string[]).includes(value)
  );
}

/** @public */
export function isContextCategory(value: unknown): value is ContextCategory {
  return (
    typeof value === 'string' &&
    (CONTEXT_CATEGORIES as readonly string[]).includes(value)
  );
}
