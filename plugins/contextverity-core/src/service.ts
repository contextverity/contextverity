/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import {
  ContextCategory,
  ContextReceipt,
  ContextVerification,
  PermissionDecisionRecord,
  ReceiptDetail,
  ReceiptSummary,
  ResolveDenialCode,
  ResolveRequest,
  ResolveResponse,
  SourceRecord,
  VerifyIntent,
  isContextCategory,
  sensitivityRank,
} from '@contextverity/plugin-contextverity-common';
import { checkIntegrityTag, digestOf, integrityTag } from './canonical';
import { SourceObservation, checkBinding, evaluate, verdictOf } from './engine';
import { ContextPolicy, policyDigest, policyMatches } from './policy';
import { isValidRef, normalizeRef } from './refs';
import { ReceiptStore } from './store';
import { ATTR, getInstruments, withSpan } from './telemetry';

/**
 * The caller. `ref` is the stable principal reference bound into receipts;
 * `handle` is an opaque value passed through to the authorizer (for Backstage:
 * the request's credentials).
 *
 * @public
 */
export interface Principal {
  ref: string;
  handle?: unknown;
}

/** @public */
export type ProviderResolution =
  | { status: 'OK'; records: SourceRecord[] }
  | { status: 'NOT_FOUND' }
  | { status: 'UNAVAILABLE'; error: string }
  | { status: 'MALFORMED'; error: string };

/**
 * Supplies normalized source records. Implementations must be deterministic
 * for identical source state.
 *
 * @public
 */
export interface ContextSourceProvider {
  readonly id: string;
  /** Source ID of the record that represents `subject` itself. */
  subjectSourceId(subject: string): string;
  /** Resolves the records that make up context about `subject`. */
  resolve(request: {
    subject: string;
    categories: ContextCategory[];
  }): Promise<ProviderResolution>;
  /** Observes the current state of previously recorded sources. */
  observe(
    sources: SourceRecord[],
    categories: ContextCategory[],
  ): Promise<SourceObservation[]>;
}

/**
 * Evaluates whether a principal may read each source. Must not cache
 * decisions across calls: verification depends on current decisions.
 *
 * @public
 */
export interface ContextAuthorizer {
  authorize(
    principal: Principal,
    sourceIds: string[],
  ): Promise<PermissionDecisionRecord[]>;
}

/** @public */
export interface PolicySource {
  list(): Promise<ContextPolicy[]>;
}

/**
 * `resolve` refused to issue a receipt.
 *
 * @public
 */
export class ResolveDeniedError extends Error {
  constructor(readonly code: ResolveDenialCode, readonly detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'ResolveDeniedError';
  }
}

/**
 * The caller may not see what it asked for.
 *
 * @public
 */
export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

/** @public */
export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

/** @public */
export class ReceiptNotFoundError extends Error {
  constructor(receiptId: string) {
    super(`receipt ${receiptId} not found`);
    this.name = 'ReceiptNotFoundError';
  }
}

/** @public */
export interface ContextVerityOptions {
  /** Identifier of this instance; bound into receipts. */
  issuer: string;
  provider: ContextSourceProvider;
  authorizer: ContextAuthorizer;
  policies: PolicySource;
  store: ReceiptStore;
  /** Optional secret for HMAC-SHA256 receipt integrity tags. */
  integritySecret?: string;
  clock?: () => Date;
  idGenerator?: () => string;
}

/**
 * Orchestrates resolve and verify. All verdict logic lives in the pure
 * engine; this class gathers inputs, persists receipts and emits telemetry.
 *
 * @public
 */
export class ContextVerity {
  private readonly clock: () => Date;
  private readonly newId: () => string;

  constructor(private readonly options: ContextVerityOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.newId = options.idGenerator ?? (() => `cv-${randomUUID()}`);
  }

  get issuer(): string {
    return this.options.issuer;
  }

  async resolve(
    principal: Principal,
    request: ResolveRequest,
  ): Promise<ResolveResponse> {
    const req = validateResolveRequest(request);
    const subjectKind = req.subject.split(':')[0];
    return withSpan(
      'contextverity.resolve',
      { [ATTR.purpose]: req.purpose, [ATTR.subjectKind]: subjectKind },
      async span => {
        try {
          const result = await this.doResolve(principal, req);
          span.setAttribute(ATTR.receiptId, result.receipt.receiptId);
          span.setAttribute(ATTR.sourceCount, result.receipt.sources.length);
          return result;
        } catch (e) {
          if (e instanceof ResolveDeniedError)
            span.setAttribute(ATTR.denialCode, e.code);
          throw e;
        }
      },
    );
  }

  private async doResolve(
    principal: Principal,
    req: ResolveRequest,
  ): Promise<ResolveResponse> {
    const now = this.clock();
    const consumer = principal.ref.toLowerCase();
    const policy = await this.selectPolicy(consumer, req);

    const notGranted = req.categories.filter(
      c => !policy.allowedCategories.includes(c),
    );
    if (notGranted.length) {
      throw new ResolveDeniedError(
        'CATEGORY_NOT_GRANTED',
        `policy '${policy.id}' does not allow: ${notGranted.join(', ')}`,
      );
    }

    // Authorize the subject before touching it, so existence is not leaked.
    const subjectSourceId = this.options.provider.subjectSourceId(req.subject);
    const pre = await this.authorize(principal, [subjectSourceId]);
    if (pre.some(p => p.result !== 'ALLOW')) {
      throw new ResolveDeniedError(
        'PERMISSION_DENIED',
        `not permitted to read ${req.subject}`,
      );
    }

    const resolution = await withSpan(
      'contextverity.source.fetch',
      { [ATTR.provider]: this.options.provider.id },
      () =>
        this.timedFetch(() =>
          this.options.provider.resolve({
            subject: req.subject,
            categories: req.categories,
          }),
        ),
    );
    if (resolution.status === 'NOT_FOUND') {
      throw new ResolveDeniedError(
        'SUBJECT_NOT_FOUND',
        `${req.subject} not found`,
      );
    }
    if (resolution.status === 'UNAVAILABLE') {
      throw new ResolveDeniedError('SOURCE_UNAVAILABLE', resolution.error);
    }
    if (resolution.status === 'MALFORMED') {
      throw new ResolveDeniedError('SOURCE_MALFORMED', resolution.error);
    }
    const records = [...resolution.records].sort((a, b) =>
      a.sourceId < b.sourceId ? -1 : 1,
    );

    const kinds = [...new Set(records.map(r => r.kind))].filter(
      k => !policy.allowedSourceKinds.includes(k),
    );
    if (kinds.length) {
      throw new ResolveDeniedError(
        'SOURCE_NOT_PERMITTED',
        `policy '${policy.id}' does not allow source kinds: ${kinds.join(
          ', ',
        )}`,
      );
    }

    const others = records
      .map(r => r.sourceId)
      .filter(id => id !== subjectSourceId);
    const rest = others.length ? await this.authorize(principal, others) : [];
    const denied = rest.filter(p => p.result !== 'ALLOW');
    if (denied.length) {
      throw new ResolveDeniedError(
        'PERMISSION_DENIED',
        `not permitted to read: ${denied
          .map(d => d.sourceId ?? d.resourceRef)
          .join(', ')}`,
      );
    }

    let classification = records[0]?.classification ?? 'PUBLIC';
    for (const r of records) {
      if (sensitivityRank(r.classification) > sensitivityRank(classification))
        classification = r.classification;
    }
    if (
      sensitivityRank(classification) >
      sensitivityRank(policy.sensitivityCeiling)
    ) {
      throw new ResolveDeniedError(
        'CLASSIFICATION_EXCEEDS_GRANT',
        `context is ${classification}; policy '${policy.id}' allows up to ${policy.sensitivityCeiling}`,
      );
    }

    const ttlSeconds = Math.min(
      req.ttlSeconds ?? policy.maxTtlSeconds,
      policy.maxTtlSeconds,
    );
    const grant = {
      policyId: policy.id,
      policyDigest: policyDigest(policy),
      consumer,
      purpose: req.purpose,
      subject: req.subject,
      categories: [...req.categories].sort(),
      sourceKinds: [...new Set(records.map(r => r.kind))].sort(),
      sensitivityCeiling: policy.sensitivityCeiling,
      ttlSeconds,
    };
    const permissions = [...pre, ...rest];
    const issuedAt = now.toISOString();
    const validUntil = new Date(
      now.getTime() + ttlSeconds * 1000,
    ).toISOString();
    const snapshotDigest = digestOf({
      issuer: this.options.issuer,
      consumer,
      subject: req.subject,
      purpose: req.purpose,
      grant,
      sources: records.map(r => ({ sourceId: r.sourceId, digest: r.digest })),
      classification,
    });
    const receipt: ContextReceipt = {
      receiptId: this.newId(),
      issuer: this.options.issuer,
      schemaVersion: 1,
      issuedAt,
      validUntil,
      consumer,
      subject: req.subject,
      purpose: req.purpose,
      grant,
      sources: records,
      permissions,
      classification,
      snapshotDigest,
    };

    await withSpan(
      'contextverity.receipt.issue',
      { [ATTR.receiptId]: receipt.receiptId },
      async () => {
        await this.options.store.insert({
          receipt,
          integrity: integrityTag(receipt, this.options.integritySecret),
        });
      },
    );
    getInstruments().issued.add(1);

    return {
      receipt,
      context: records.map(r => ({
        sourceId: r.sourceId,
        kind: r.kind,
        classification: r.classification,
        fields: Object.fromEntries(
          Object.entries(r.fields).map(([k, f]) => [k, f.value]),
        ),
      })),
    };
  }

  async verify(
    principal: Principal,
    receiptId: string,
    intent: VerifyIntent = {},
  ): Promise<ContextVerification> {
    const started = performance.now();
    return withSpan(
      'contextverity.receipt.verify',
      { [ATTR.receiptId]: receiptId },
      async span => {
        const stored = await this.options.store.get(receiptId);
        if (!stored) throw new ReceiptNotFoundError(receiptId);
        const now = this.clock();
        const receipt = stored.receipt;
        const integrityOk = checkIntegrityTag(
          receipt,
          stored.integrity,
          this.options.integritySecret,
        );

        let verification: ContextVerification;
        const binding = checkBinding({
          receipt,
          integrityOk,
          issuer: this.options.issuer,
          principal: principal.ref,
        });
        if (binding.length) {
          verification = {
            receiptId,
            mode: 'verify',
            verifiedAt: now.toISOString(),
            verdict: verdictOf(binding),
            drift: binding,
            permissions: [],
            sourcesChecked: 0,
          };
        } else {
          const validIntent = validateIntent(intent);
          const policies = await this.options.policies.list();
          const policy = policies.find(p => p.id === receipt.grant.policyId);
          const [observations, permissions] = await Promise.all([
            withSpan(
              'contextverity.source.fetch',
              {
                [ATTR.provider]: this.options.provider.id,
                [ATTR.sourceCount]: receipt.sources.length,
              },
              () =>
                this.timedFetch(() =>
                  this.options.provider.observe(
                    receipt.sources,
                    receipt.grant.categories,
                  ),
                ),
            ),
            this.authorize(
              principal,
              receipt.sources.map(s => s.sourceId),
            ),
          ]);
          const result = await withSpan(
            'contextverity.drift.compare',
            {},
            async () =>
              evaluate({
                receipt,
                principal: principal.ref,
                intent: validIntent,
                now,
                policy,
                observations,
                permissions,
              }),
          );
          verification = {
            receiptId,
            mode: 'verify',
            verifiedAt: now.toISOString(),
            verdict: result.verdict,
            drift: result.drift,
            permissions,
            sourcesChecked: observations.length,
          };
        }

        span.setAttribute(ATTR.verdict, verification.verdict);
        span.setAttribute(ATTR.driftCount, verification.drift.length);
        span.setAttribute(ATTR.driftCodes, [
          ...new Set(verification.drift.map(d => d.code)),
        ]);
        span.addEvent('contextverity.verdict', {
          [ATTR.verdict]: verification.verdict,
        });

        // Only verifications of intact receipts are recorded against them.
        if (integrityOk)
          await this.options.store.appendVerification(verification);

        const inst = getInstruments();
        inst.verifications.add(1, { verdict: verification.verdict });
        for (const d of verification.drift)
          inst.drift.add(1, { drift_type: d.code });
        inst.verifyDuration.record((performance.now() - started) / 1000, {
          verdict: verification.verdict,
        });
        return verification;
      },
    );
  }

  /**
   * Operator view of drift for someone else's receipt. Source state, policy
   * and TTL are evaluated; the consumer's permissions cannot be (that needs
   * the consumer's credentials), so `permissions` is empty and the result is
   * not recorded as a verification. The operator must be allowed to read
   * every source, otherwise nothing about current state is revealed.
   */
  async inspect(
    operator: Principal,
    receiptId: string,
  ): Promise<ContextVerification> {
    return withSpan(
      'contextverity.receipt.inspect',
      { [ATTR.receiptId]: receiptId },
      async span => {
        const stored = await this.options.store.get(receiptId);
        if (!stored) throw new ReceiptNotFoundError(receiptId);
        const now = this.clock();
        const receipt = stored.receipt;
        const integrityOk = checkIntegrityTag(
          receipt,
          stored.integrity,
          this.options.integritySecret,
        );
        const binding = checkBinding({
          receipt,
          integrityOk,
          issuer: this.options.issuer,
          principal: receipt.consumer,
        });
        if (binding.length) {
          return {
            receiptId,
            mode: 'inspect',
            verifiedAt: now.toISOString(),
            verdict: verdictOf(binding),
            drift: binding,
            permissions: [],
            sourcesChecked: 0,
          };
        }
        const access = await this.authorize(
          operator,
          receipt.sources.map(s => s.sourceId),
        );
        if (access.some(a => a.result !== 'ALLOW')) {
          throw new AccessDeniedError(
            'operator may not read every source of this receipt',
          );
        }
        const policy = (await this.options.policies.list()).find(
          p => p.id === receipt.grant.policyId,
        );
        const observations = await withSpan(
          'contextverity.source.fetch',
          {
            [ATTR.provider]: this.options.provider.id,
            [ATTR.sourceCount]: receipt.sources.length,
          },
          () =>
            this.timedFetch(() =>
              this.options.provider.observe(
                receipt.sources,
                receipt.grant.categories,
              ),
            ),
        );
        const result = evaluate({
          receipt,
          principal: receipt.consumer,
          intent: {},
          now,
          policy,
          observations,
          permissions: [],
        });
        span.setAttribute(ATTR.verdict, result.verdict);
        return {
          receiptId,
          mode: 'inspect',
          verifiedAt: now.toISOString(),
          verdict: result.verdict,
          drift: result.drift,
          permissions: [],
          sourcesChecked: observations.length,
        };
      },
    );
  }

  async getReceipt(
    receiptId: string,
    verificationLimit = 20,
  ): Promise<ReceiptDetail> {
    const stored = await this.options.store.get(receiptId);
    if (!stored) throw new ReceiptNotFoundError(receiptId);
    const ok = checkIntegrityTag(
      stored.receipt,
      stored.integrity,
      this.options.integritySecret,
    );
    return {
      receipt: stored.receipt,
      integrity: ok ? 'OK' : 'FAILED',
      verifications: await this.options.store.listVerifications(
        receiptId,
        verificationLimit,
      ),
    };
  }

  async listReceipts(
    options: { limit?: number; consumer?: string; subject?: string } = {},
  ): Promise<ReceiptSummary[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    return this.options.store.list({
      limit,
      consumer: options.consumer?.toLowerCase(),
      subject: options.subject ? normalizeRef(options.subject) : undefined,
    });
  }

  private async selectPolicy(
    consumer: string,
    req: ResolveRequest,
  ): Promise<ContextPolicy> {
    const all = await this.options.policies.list();
    const matching = all
      .filter(p => !req.policyId || p.id === req.policyId)
      .filter(p => policyMatches(p, consumer, req.purpose, req.subject));
    if (matching.length === 0) {
      throw new ResolveDeniedError(
        'NO_MATCHING_POLICY',
        `no policy grants '${req.purpose}' context about ${req.subject} to this consumer`,
      );
    }
    if (matching.length > 1) {
      throw new ResolveDeniedError(
        'AMBIGUOUS_POLICY',
        `multiple policies match (${matching
          .map(p => p.id)
          .sort()
          .join(', ')}); pass policyId`,
      );
    }
    return matching[0];
  }

  private authorize(
    principal: Principal,
    sourceIds: string[],
  ): Promise<PermissionDecisionRecord[]> {
    return withSpan(
      'contextverity.permission.check',
      { [ATTR.permissionCount]: sourceIds.length },
      () => this.options.authorizer.authorize(principal, sourceIds),
    );
  }

  private async timedFetch<T>(fn: () => Promise<T>): Promise<T> {
    const t = performance.now();
    try {
      return await fn();
    } finally {
      getInstruments().fetchDuration.record((performance.now() - t) / 1000, {
        provider: this.options.provider.id,
      });
    }
  }
}

function validateResolveRequest(input: ResolveRequest): ResolveRequest {
  const body = (input ?? {}) as Partial<ResolveRequest>;
  if (typeof body.subject !== 'string' || !isValidRef(body.subject)) {
    throw new InvalidRequestError(
      'subject must be an entity reference like component:default/payments',
    );
  }
  if (
    typeof body.purpose !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(body.purpose)
  ) {
    throw new InvalidRequestError('purpose must match [a-z0-9._-], 1-64 chars');
  }
  if (
    !Array.isArray(body.categories) ||
    body.categories.length === 0 ||
    !body.categories.every(isContextCategory)
  ) {
    throw new InvalidRequestError(
      'categories must be a non-empty list of context categories',
    );
  }
  if (
    body.ttlSeconds !== undefined &&
    (!Number.isInteger(body.ttlSeconds) || body.ttlSeconds < 1)
  ) {
    throw new InvalidRequestError('ttlSeconds must be a positive integer');
  }
  if (body.policyId !== undefined && typeof body.policyId !== 'string') {
    throw new InvalidRequestError('policyId must be a string');
  }
  return {
    subject: normalizeRef(body.subject),
    purpose: body.purpose,
    categories: [...new Set(body.categories)].sort() as ContextCategory[],
    ttlSeconds: body.ttlSeconds,
    policyId: body.policyId,
  };
}

function validateIntent(input: VerifyIntent): VerifyIntent {
  const intent = (input ?? {}) as VerifyIntent;
  if (intent.subject !== undefined && typeof intent.subject !== 'string') {
    throw new InvalidRequestError('subject must be a string');
  }
  if (intent.purpose !== undefined && typeof intent.purpose !== 'string') {
    throw new InvalidRequestError('purpose must be a string');
  }
  if (
    intent.categories !== undefined &&
    (!Array.isArray(intent.categories) ||
      !intent.categories.every(isContextCategory))
  ) {
    throw new InvalidRequestError(
      'categories must be a list of context categories',
    );
  }
  return intent;
}
