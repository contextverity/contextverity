/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ContextVerification,
  ResolveRequest,
  ResolveResponse,
} from '@contextverity/plugin-contextverity-common';
import { Actor, Capability, Harness } from './harness/types';

export type Outcome = 'VALID' | 'REFRESH' | 'DENY' | 'RESOLVE_DENIED';

export type ScenarioGroup =
  | 'baseline'
  | 'source-drift'
  | 'classification'
  | 'authorization'
  | 'binding'
  | 'policy'
  | 'time'
  | 'availability'
  | 'integrity'
  | 'false-invalidation'
  | 'determinism'
  | 'resolve'
  | 'ai-catalog'
  | 'toctou';

export interface Expectation {
  outcome: Outcome;
  /** Exact set of drift codes with a REFRESH or DENY effect. */
  codes?: string[];
  /** Drift codes that must be present with effect NONE. */
  informational?: string[];
  denialCode?: string;
}

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface Observation {
  outcome: Outcome;
  codes: string[];
  informational: string[];
  denialCode?: string;
  checks: Check[];
  request?: ResolveRequest;
  actor?: Actor;
  issued?: ResolveResponse;
  verification?: ContextVerification;
  /** Steps that changed the world, for replay. */
  steps: string[];
}

export interface Scenario {
  id: string;
  title: string;
  group: ScenarioGroup;
  /** Whether something relevant to the receipt changed (or is misused). */
  relevantChange: boolean;
  requires?: Capability[];
  expect: Expectation;
  run(h: Harness): Promise<Observation>;
}

export const ALL_CATEGORIES = [
  'identity',
  'ownership',
  'lifecycle',
  'dependencies',
  'apis',
  'api-definition',
  'documentation',
] as const;

export const TRIAGE: ResolveRequest = {
  subject: 'component:default/payments',
  purpose: 'incident-triage',
  categories: [...ALL_CATEGORIES],
};

const PAYMENTS = 'component:default/payments';
const PAYMENTS_API = 'api:default/payments-api';

class Run {
  readonly steps: string[] = [];
  readonly checks: Check[] = [];
  issued?: ResolveResponse;
  request?: ResolveRequest;
  actor?: Actor;
  constructor(readonly h: Harness) {}

  async issue(
    request: ResolveRequest = TRIAGE,
    actor: Actor = 'alex',
  ): Promise<string> {
    const r = await this.h.resolve(actor, request);
    if (!r.ok)
      throw new Error(
        `setup resolve unexpectedly denied: ${r.code} ${r.detail}`,
      );
    this.issued = r.response;
    this.request = request;
    this.actor = actor;
    this.steps.push(
      `resolve ${request.subject} for ${request.purpose} as ${actor}`,
    );
    return r.response.receipt.receiptId;
  }

  step(description: string) {
    this.steps.push(description);
  }

  check(name: string, ok: boolean, detail?: string) {
    this.checks.push({ name, ok, detail });
  }

  observe(v: ContextVerification): Observation {
    return {
      outcome: v.verdict,
      codes: [
        ...new Set(v.drift.filter(d => d.effect !== 'NONE').map(d => d.code)),
      ].sort(),
      informational: [
        ...new Set(v.drift.filter(d => d.effect === 'NONE').map(d => d.code)),
      ].sort(),
      checks: this.checks,
      request: this.request,
      actor: this.actor,
      issued: this.issued,
      verification: v,
      steps: this.steps,
    };
  }

  denied(code: string, request: ResolveRequest, actor: Actor): Observation {
    return {
      outcome: 'RESOLVE_DENIED',
      codes: [],
      informational: [],
      denialCode: code,
      checks: this.checks,
      request,
      actor,
      steps: this.steps,
    };
  }

  async verify(id: string, actor: Actor = this.actor ?? 'alex', intent = {}) {
    this.steps.push(
      `verify as ${actor}${
        Object.keys(intent).length
          ? ` with intent ${JSON.stringify(intent)}`
          : ''
      }`,
    );
    return this.h.verify(actor, id, intent);
  }
}

function policy(h: Harness, id: string, patch: Record<string, unknown>) {
  return h
    .seedPolicies()
    .map(p =>
      (p as { id: string }).id === id ? { ...(p as object), ...patch } : p,
    );
}

const verifyAfter =
  (
    change: (r: Run) => Promise<void>,
    opts: {
      request?: ResolveRequest;
      actor?: Actor;
      verifyAs?: Actor;
      intent?: object;
    } = {},
  ) =>
  async (h: Harness) => {
    const r = new Run(h);
    const id = await r.issue(opts.request ?? TRIAGE, opts.actor ?? 'alex');
    await change(r);
    return r.observe(
      await r.verify(
        id,
        opts.verifyAs ?? opts.actor ?? 'alex',
        opts.intent ?? {},
      ),
    );
  };

const resolveExpectingDenial =
  (request: ResolveRequest, actor: Actor, before?: (r: Run) => Promise<void>) =>
  async (h: Harness) => {
    const r = new Run(h);
    if (before) await before(r);
    r.step(`resolve ${request.subject} for ${request.purpose} as ${actor}`);
    const res = await h.resolve(actor, request);
    if (res.ok) {
      r.issued = res.response;
      return {
        ...r.observe(await h.verify(actor, res.response.receipt.receiptId)),
        outcome: 'VALID' as const,
      };
    }
    return r.denied(res.code, request, actor);
  };

export const SCENARIOS: Scenario[] = [
  {
    id: 'S01',
    title: 'No change',
    group: 'baseline',
    relevantChange: false,
    expect: { outcome: 'VALID', codes: [] },
    run: verifyAfter(async () => {}),
  },
  {
    id: 'S02',
    title: 'Owner changed',
    group: 'source-drift',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['OWNER_CHANGED'] },
    run: verifyAfter(async r => {
      r.step('owner team-payments -> team-commerce');
      await r.h.patchEntity(PAYMENTS, { spec: { owner: 'team-commerce' } });
    }),
  },
  {
    id: 'S03',
    title: 'Lifecycle changed',
    group: 'source-drift',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['LIFECYCLE_CHANGED'] },
    run: verifyAfter(async r => {
      r.step('lifecycle production -> experimental');
      await r.h.patchEntity(PAYMENTS, { spec: { lifecycle: 'experimental' } });
    }),
  },
  {
    id: 'S04',
    title: 'API definition changed',
    group: 'source-drift',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['API_CHANGED'] },
    run: verifyAfter(async r => {
      r.step('payments-api definition: new required field');
      await r.h.patchEntity(PAYMENTS_API, {
        spec: {
          definition:
            "openapi: 3.0.3\ninfo: { title: Payments API, version: 3.0.0 }\npaths:\n  /payments:\n    post:\n      summary: Authorize a payment (requires idempotency key)\n      responses: { '201': { description: Authorized } }\n",
        },
      });
    }),
  },
  {
    id: 'S05',
    title: 'Provided API deprecated',
    group: 'source-drift',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['API_DEPRECATED'] },
    run: verifyAfter(async r => {
      r.step('payments-api lifecycle production -> deprecated');
      await r.h.patchEntity(PAYMENTS_API, {
        spec: { lifecycle: 'deprecated' },
      });
    }),
  },
  {
    id: 'S06',
    title: 'Dependency added',
    group: 'source-drift',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['DEPENDENCY_CHANGED'] },
    run: verifyAfter(async r => {
      r.step('payments now depends on inventory');
      await r.h.patchEntity(PAYMENTS, {
        spec: {
          dependsOn: [
            'resource:payments-db',
            'component:notifications',
            'component:inventory',
          ],
        },
      });
    }),
  },
  {
    id: 'S07',
    title: 'Dependency removed',
    group: 'source-drift',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['DEPENDENCY_CHANGED'] },
    run: verifyAfter(async r => {
      r.step('payments no longer depends on notifications');
      await r.h.patchEntity(PAYMENTS, {
        spec: { dependsOn: ['resource:payments-db'] },
      });
    }),
  },
  {
    id: 'S08',
    title: 'Classification raised within the grant ceiling',
    group: 'classification',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['CLASSIFICATION_RAISED'] },
    run: verifyAfter(
      async r => {
        r.step(
          'inventory classification PUBLIC -> INTERNAL (ceiling INTERNAL)',
        );
        await r.h.patchEntity('component:default/inventory', {
          annotations: { 'contextverity.github.io/classification': 'INTERNAL' },
        });
      },
      { request: { ...TRIAGE, subject: 'component:default/inventory' } },
    ),
  },
  {
    id: 'S09',
    title: 'Classification raised above the grant ceiling',
    group: 'classification',
    relevantChange: true,
    expect: { outcome: 'DENY', codes: ['CLASSIFICATION_RAISED'] },
    run: verifyAfter(async r => {
      r.step(
        'payments classification INTERNAL -> RESTRICTED (ceiling INTERNAL)',
      );
      await r.h.patchEntity(PAYMENTS, {
        annotations: { 'contextverity.github.io/classification': 'RESTRICTED' },
      });
    }),
  },
  {
    id: 'S10',
    title: "Consumer's catalog read permission revoked",
    group: 'authorization',
    relevantChange: true,
    expect: { outcome: 'DENY', codes: ['PERMISSION_REVOKED'] },
    run: verifyAfter(async r => {
      r.step(
        'permission policy: deny catalog.entity.read on payments for alex',
      );
      await r.h.revoke('user:default/alex', PAYMENTS);
    }),
  },
  {
    id: 'S11',
    title: 'Receipt presented by a different consumer',
    group: 'binding',
    relevantChange: true,
    expect: { outcome: 'DENY', codes: ['CONSUMER_MISMATCH'] },
    run: verifyAfter(async () => {}, { verifyAs: 'agent' }),
  },
  {
    id: 'S12',
    title: 'TTL expired',
    group: 'time',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['TTL_EXPIRED'] },
    run: verifyAfter(
      async r => {
        r.step('wait past validUntil (ttl 2s)');
        await r.h.advance(2_100);
      },
      { request: { ...TRIAGE, ttlSeconds: 2 } },
    ),
  },
  {
    id: 'S13',
    title: 'Unrelated entity changed',
    group: 'false-invalidation',
    relevantChange: false,
    expect: { outcome: 'VALID', codes: [] },
    run: verifyAfter(async r => {
      r.step('inventory owner and lifecycle changed (no relation to payments)');
      await r.h.patchEntity('component:default/inventory', {
        spec: { owner: 'team-platform', lifecycle: 'experimental' },
      });
    }),
  },
  {
    id: 'S14',
    title: 'Unrelated annotation and label added to the subject',
    group: 'false-invalidation',
    relevantChange: false,
    expect: { outcome: 'VALID', codes: [] },
    run: verifyAfter(async r => {
      r.step('add annotation example.com/oncall-rotation and label tier=gold');
      await r.h.patchEntity(PAYMENTS, {
        annotations: { 'example.com/oncall-rotation': 'weekly' },
        labels: { tier: 'gold' },
      });
    }),
  },
  {
    id: 'S15',
    title: 'Receipt reused for a different subject',
    group: 'binding',
    relevantChange: true,
    expect: { outcome: 'DENY', codes: ['SUBJECT_MISMATCH'] },
    run: verifyAfter(async () => {}, {
      intent: { subject: 'component:default/checkout' },
    }),
  },
  {
    id: 'S16',
    title: 'Subject entity deleted',
    group: 'source-drift',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['SOURCE_DELETED'] },
    run: verifyAfter(async r => {
      r.step('delete payments from the catalog');
      await r.h.deleteEntity(PAYMENTS);
    }),
  },
  {
    id: 'S17',
    title: 'Entity recreated under the same ref (new UID)',
    group: 'source-drift',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['ENTITY_RECREATED'] },
    run: verifyAfter(async r => {
      r.step('delete and re-add payments with identical content');
      await r.h.recreateEntity(PAYMENTS);
    }),
  },
  {
    id: 'S18',
    title: 'Policy rewritten, semantically equivalent',
    group: 'policy',
    relevantChange: false,
    expect: { outcome: 'VALID', codes: [] },
    run: verifyAfter(async r => {
      r.step('reorder lists, duplicate a consumer, reword description');
      const seed = r.h.seedPolicies() as Array<Record<string, any>>;
      await r.h.setPolicies(
        seed.map(p =>
          p.id === 'incident-triage'
            ? {
                ...p,
                description: 'Reworded',
                consumers: [...p.consumers]
                  .reverse()
                  .concat(p.consumers[0].toUpperCase()),
                allowedCategories: [...p.allowedCategories].reverse(),
              }
            : p,
        ),
      );
    }),
  },
  {
    id: 'S19',
    title: 'Policy narrowed below the receipt',
    group: 'policy',
    relevantChange: true,
    expect: { outcome: 'DENY', codes: ['POLICY_NARROWED'] },
    run: verifyAfter(async r => {
      r.step("remove 'dependencies' from allowedCategories");
      await r.h.setPolicies(
        policy(r.h, 'incident-triage', {
          allowedCategories: [
            'identity',
            'ownership',
            'lifecycle',
            'apis',
            'api-definition',
            'documentation',
          ],
        }),
      );
    }),
  },
  {
    id: 'S20',
    title: 'Policy broadened: receipt keeps its original grant',
    group: 'policy',
    relevantChange: false,
    expect: { outcome: 'VALID', codes: [], informational: ['POLICY_CHANGED'] },
    run: async h => {
      const r = new Run(h);
      const id = await r.issue({ ...TRIAGE, categories: ['ownership'] });
      r.step('raise ceiling to RESTRICTED');
      await h.setPolicies(
        policy(h, 'incident-triage', { sensitivityCeiling: 'RESTRICTED' }),
      );
      const v = await r.verify(id);
      const detail = await h.getReceipt('alex', id);
      r.check(
        'grant ceiling unchanged',
        detail.receipt.grant.sensitivityCeiling === 'INTERNAL',
        detail.receipt.grant.sensitivityCeiling,
      );
      const wider = await h.verify('alex', id, {
        categories: ['ownership', 'dependencies'],
      });
      r.check(
        'wider intent still SCOPE_EXCEEDED',
        wider.verdict === 'DENY' &&
          wider.drift.some(d => d.code === 'SCOPE_EXCEEDED'),
      );
      return r.observe(v);
    },
  },
  {
    id: 'S21',
    title: 'Required source unavailable',
    group: 'availability',
    relevantChange: true,
    requires: ['outage'],
    expect: { outcome: 'REFRESH', codes: ['SOURCE_UNAVAILABLE'] },
    run: verifyAfter(async r => {
      r.step('catalog unavailable');
      await r.h.setOutage('*', true);
    }),
  },
  {
    id: 'S22',
    title: 'Source unavailable under a strict policy (denyOn)',
    group: 'availability',
    relevantChange: true,
    requires: ['outage'],
    expect: { outcome: 'DENY', codes: ['SOURCE_UNAVAILABLE'] },
    run: async h => {
      const r = new Run(h);
      await h.setPolicies(
        policy(h, 'incident-triage', { denyOn: ['SOURCE_UNAVAILABLE'] }),
      );
      const id = await r.issue();
      r.step('catalog unavailable');
      await h.setOutage('*', true);
      return r.observe(await r.verify(id));
    },
  },
  {
    id: 'S23',
    title: 'Malformed classification on the subject',
    group: 'availability',
    relevantChange: true,
    expect: { outcome: 'DENY', codes: ['SOURCE_MALFORMED'] },
    run: verifyAfter(async r => {
      r.step("classification annotation set to 'SECRET' (not a known level)");
      await r.h.patchEntity(PAYMENTS, {
        annotations: { 'contextverity.github.io/classification': 'SECRET' },
      });
    }),
  },
  {
    id: 'S24',
    title: 'Category not granted by the policy',
    group: 'resolve',
    relevantChange: true,
    expect: { outcome: 'RESOLVE_DENIED', denialCode: 'CATEGORY_NOT_GRANTED' },
    run: resolveExpectingDenial(
      {
        subject: 'component:default/inventory',
        purpose: 'docs-lookup',
        categories: ['ownership', 'dependencies'],
      },
      'alex',
    ),
  },
  {
    id: 'S25',
    title: 'Source kind not permitted by the policy',
    group: 'resolve',
    relevantChange: true,
    expect: { outcome: 'RESOLVE_DENIED', denialCode: 'SOURCE_NOT_PERMITTED' },
    run: async h => {
      await h.setPolicies(
        policy(h, 'incident-triage', {
          allowedSourceKinds: ['CATALOG_ENTITY'],
        }),
      );
      return resolveExpectingDenial(TRIAGE, 'alex')(h);
    },
  },
  {
    id: 'S26',
    title: 'Related API classification raised above the ceiling',
    group: 'classification',
    relevantChange: true,
    expect: { outcome: 'DENY', codes: ['CLASSIFICATION_RAISED'] },
    run: verifyAfter(async r => {
      r.step('payments-api classification INTERNAL -> RESTRICTED');
      await r.h.patchEntity(PAYMENTS_API, {
        annotations: { 'contextverity.github.io/classification': 'RESTRICTED' },
      });
    }),
  },
  {
    id: 'S27',
    title: 'Classification lowered: receipt stays bounded by its grant',
    group: 'classification',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['CLASSIFICATION_LOWERED'] },
    run: async h => {
      const r = new Run(h);
      const id = await r.issue();
      r.step('payments classification INTERNAL -> PUBLIC');
      await h.patchEntity(PAYMENTS, {
        annotations: { 'contextverity.github.io/classification': 'PUBLIC' },
      });
      const v = await r.verify(id);
      const d = await h.getReceipt('alex', id);
      r.check(
        'receipt classification unchanged',
        d.receipt.classification === 'INTERNAL',
      );
      return r.observe(v);
    },
  },
  {
    id: 'S28',
    title: 'Concurrent verification of the same receipt',
    group: 'determinism',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['OWNER_CHANGED'] },
    run: async h => {
      const r = new Run(h);
      const id = await r.issue();
      await h.patchEntity(PAYMENTS, { spec: { owner: 'team-commerce' } });
      r.step('owner changed; 25 verifications in parallel');
      const results = await Promise.all(
        Array.from({ length: 25 }, () => h.verify('alex', id)),
      );
      const shapes = new Set(
        results.map(v =>
          JSON.stringify([
            v.verdict,
            v.drift.map(d => [
              d.code,
              d.effect,
              d.sourceId,
              d.field,
              d.before,
              d.after,
            ]),
          ]),
        ),
      );
      r.check(
        'all 25 results identical',
        shapes.size === 1,
        `${shapes.size} distinct`,
      );
      return r.observe(results[0]);
    },
  },
  {
    id: 'S29',
    title: 'Service restart: authoritative receipt survives',
    group: 'integrity',
    relevantChange: false,
    requires: ['restart'],
    expect: { outcome: 'VALID', codes: [] },
    run: verifyAfter(async r => {
      r.step('restart ContextVerity (same database)');
      await r.h.restart();
    }),
  },
  {
    id: 'S30',
    title: 'Stored receipt tampered with',
    group: 'integrity',
    relevantChange: true,
    requires: ['storage-tamper'],
    expect: { outcome: 'DENY', codes: ['RECEIPT_INTEGRITY_FAILED'] },
    run: async h => {
      const r = new Run(h);
      const id = await r.issue();
      r.step('edit stored receipt body: ceiling INTERNAL -> RESTRICTED');
      await h.tamperStoredReceipt(id);
      const v = await r.verify(id);
      r.check('no source state disclosed', v.sourcesChecked === 0);
      return r.observe(v);
    },
  },
  {
    id: 'S31',
    title: 'Permission revoked on a related API only',
    group: 'authorization',
    relevantChange: true,
    expect: { outcome: 'DENY', codes: ['PERMISSION_REVOKED'] },
    run: verifyAfter(async r => {
      r.step('deny catalog.entity.read on payments-api for alex');
      await r.h.revoke('user:default/alex', PAYMENTS_API);
    }),
  },
  {
    id: 'S32',
    title: 'Source changed and changed back',
    group: 'false-invalidation',
    relevantChange: false,
    expect: { outcome: 'VALID', codes: [] },
    run: verifyAfter(async r => {
      r.step('owner -> team-commerce -> team-payments');
      await r.h.patchEntity(PAYMENTS, { spec: { owner: 'team-commerce' } });
      await r.h.patchEntity(PAYMENTS, { spec: { owner: 'team-payments' } });
    }),
  },
  {
    id: 'S33',
    title: 'Relation order changed only',
    group: 'false-invalidation',
    relevantChange: false,
    expect: { outcome: 'VALID', codes: [] },
    run: verifyAfter(async r => {
      r.step('dependsOn listed in reverse order');
      await r.h.patchEntity(PAYMENTS, {
        spec: {
          dependsOn: ['component:notifications', 'resource:payments-db'],
        },
      });
    }),
  },
  {
    id: 'S34',
    title: 'Irrelevant metadata changed (title, description, tags)',
    group: 'false-invalidation',
    relevantChange: false,
    expect: { outcome: 'VALID', codes: [] },
    run: verifyAfter(async r => {
      r.step('title, description and tags changed');
      await r.h.patchEntity(PAYMENTS, {
        metadata: {
          title: 'Payments Service',
          description: 'Card payments (reworded)',
          tags: ['java', 'pci', 'tier-1'],
        },
      });
    }),
  },
  {
    id: 'S35',
    title: 'Clock exactly at validUntil',
    group: 'time',
    relevantChange: true,
    requires: ['clock'],
    expect: { outcome: 'REFRESH', codes: ['TTL_EXPIRED'] },
    run: async h => {
      const r = new Run(h);
      const id = await r.issue({ ...TRIAGE, ttlSeconds: 60 });
      const until = r.issued!.receipt.validUntil;
      h.setExactNow!(new Date(Date.parse(until) - 1).toISOString());
      const before = await h.verify('alex', id);
      r.check('1 ms before validUntil is VALID', before.verdict === 'VALID');
      r.step(`clock set to validUntil (${until})`);
      h.setExactNow!(until);
      return r.observe(await r.verify(id));
    },
  },
  {
    id: 'S36',
    title: 'Receipt presented to another issuer',
    group: 'binding',
    relevantChange: true,
    requires: ['issuer'],
    expect: { outcome: 'DENY', codes: ['ISSUER_MISMATCH'] },
    run: async h => {
      const r = new Run(h);
      const id = await r.issue();
      r.step('verify at an instance with issuer other-environment');
      return r.observe(await h.verifyAtOtherIssuer('alex', id));
    },
  },
  {
    id: 'S37',
    title: 'Receipt reused for a different purpose',
    group: 'binding',
    relevantChange: true,
    expect: { outcome: 'DENY', codes: ['PURPOSE_MISMATCH'] },
    run: verifyAfter(async () => {}, { intent: { purpose: 'deploy' } }),
  },
  {
    id: 'S38',
    title: 'Requested context expands beyond the receipt',
    group: 'binding',
    relevantChange: true,
    expect: { outcome: 'DENY', codes: ['SCOPE_EXCEEDED'] },
    run: verifyAfter(async () => {}, {
      request: { ...TRIAGE, categories: ['ownership'] },
      intent: { categories: ['ownership', 'dependencies'] },
    }),
  },
  {
    id: 'S39',
    title: 'TechDocs reference annotation changed',
    group: 'source-drift',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['DOCUMENTATION_CHANGED'] },
    run: verifyAfter(async r => {
      r.step(
        'backstage.io/techdocs-ref dir:. -> url:https://example.invalid/payments-docs',
      );
      await r.h.patchEntity(PAYMENTS, {
        annotations: {
          'backstage.io/techdocs-ref':
            'url:https://example.invalid/payments-docs',
        },
      });
    }),
  },
  {
    id: 'S40',
    title: 'TOCTOU: change between a VALID verdict and the action',
    group: 'toctou',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['OWNER_CHANGED'] },
    run: async h => {
      const r = new Run(h);
      const id = await r.issue();
      const first = await r.verify(id);
      r.check('first verification VALID', first.verdict === 'VALID');
      r.step('owner changes after the VALID verdict, before the agent acts');
      await h.patchEntity(PAYMENTS, { spec: { owner: 'team-commerce' } });
      r.check(
        'the earlier VALID verdict is now stale (characterized, not prevented)',
        true,
      );
      return r.observe(await r.verify(id));
    },
  },
  {
    id: 'S41',
    title: 'Policy removed',
    group: 'policy',
    relevantChange: true,
    expect: { outcome: 'DENY', codes: ['POLICY_REMOVED'] },
    run: verifyAfter(async r => {
      r.step('delete policy incident-triage');
      await r.h.setPolicies(
        r.h
          .seedPolicies()
          .filter(p => (p as { id: string }).id !== 'incident-triage'),
      );
    }),
  },
  {
    id: 'S42',
    title: 'Service consumer removed from the policy',
    group: 'authorization',
    relevantChange: true,
    expect: { outcome: 'DENY', codes: ['POLICY_NARROWED'] },
    run: verifyAfter(
      async r => {
        r.step('remove service:incident-agent from consumers');
        await r.h.setPolicies(
          policy(r.h, 'incident-triage', { consumers: ['user:default/alex'] }),
        );
      },
      { actor: 'agent' },
    ),
  },
  {
    id: 'S43',
    title: 'Drift in a category the policy does not require fresh',
    group: 'policy',
    relevantChange: false,
    expect: {
      outcome: 'VALID',
      codes: [],
      informational: ['DOCUMENTATION_CHANGED'],
    },
    run: verifyAfter(
      async r => {
        r.step(
          'inventory techdocs-ref added (docs-lookup requires only ownership fresh)',
        );
        await r.h.patchEntity('component:default/inventory', {
          annotations: { 'backstage.io/techdocs-ref': 'dir:.' },
        });
      },
      {
        request: {
          subject: 'component:default/inventory',
          purpose: 'docs-lookup',
          categories: ['ownership', 'documentation'],
        },
      },
    ),
  },
  {
    id: 'S44',
    title: 'Policy escalates a drift code to DENY',
    group: 'policy',
    relevantChange: true,
    expect: { outcome: 'DENY', codes: ['OWNER_CHANGED'] },
    run: async h => {
      const r = new Run(h);
      await h.setPolicies(
        policy(h, 'incident-triage', { denyOn: ['OWNER_CHANGED'] }),
      );
      const id = await r.issue();
      r.step('owner changed under denyOn: [OWNER_CHANGED]');
      await h.patchEntity(PAYMENTS, { spec: { owner: 'team-commerce' } });
      return r.observe(await r.verify(id));
    },
  },
  {
    id: 'S45',
    title: 'Resolve above the classification ceiling',
    group: 'resolve',
    relevantChange: true,
    expect: {
      outcome: 'RESOLVE_DENIED',
      denialCode: 'CLASSIFICATION_EXCEEDS_GRANT',
    },
    run: resolveExpectingDenial(
      { ...TRIAGE, subject: 'component:default/identity' },
      'alex',
    ),
  },
  {
    id: 'S46',
    title: 'Consumer without any policy',
    group: 'resolve',
    relevantChange: true,
    expect: { outcome: 'RESOLVE_DENIED', denialCode: 'NO_MATCHING_POLICY' },
    run: resolveExpectingDenial(TRIAGE, 'other'),
  },
  {
    id: 'S47',
    title: 'Resolve without catalog read permission',
    group: 'resolve',
    relevantChange: true,
    expect: { outcome: 'RESOLVE_DENIED', denialCode: 'PERMISSION_DENIED' },
    run: resolveExpectingDenial(TRIAGE, 'alex', async r => {
      r.step('deny catalog.entity.read on payments for alex');
      await r.h.revoke('user:default/alex', PAYMENTS);
    }),
  },
  {
    id: 'S48',
    title: 'AiResource owner changed',
    group: 'ai-catalog',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['OWNER_CHANGED'] },
    run: verifyAfter(
      async r => {
        r.step('incident-triage-skill owner team-platform -> team-commerce');
        await r.h.patchEntity('airesource:default/incident-triage-skill', {
          spec: { owner: 'team-commerce' },
        });
      },
      {
        request: {
          subject: 'airesource:default/incident-triage-skill',
          purpose: 'incident-triage',
          categories: ['ownership', 'lifecycle', 'dependencies'],
        },
      },
    ),
  },
  {
    id: 'S49',
    title: 'MCP server API remote endpoint changed',
    group: 'ai-catalog',
    relevantChange: true,
    expect: { outcome: 'REFRESH', codes: ['API_CHANGED'] },
    run: verifyAfter(
      async r => {
        r.step('platform-mcp remotes url changed');
        await r.h.patchEntity('api:default/platform-mcp', {
          spec: {
            remotes: [
              {
                type: 'streamable-http',
                url: 'http://localhost:7008/api/mcp-actions/v1',
              },
            ],
          },
        });
      },
      {
        request: {
          subject: 'api:default/platform-mcp',
          purpose: 'incident-triage',
          categories: ['ownership', 'api-definition'],
        },
      },
    ),
  },
  {
    id: 'S50',
    title: 'Service principal: permission basis recorded',
    group: 'authorization',
    relevantChange: false,
    expect: { outcome: 'VALID', codes: [] },
    run: async h => {
      const r = new Run(h);
      const id = await r.issue(TRIAGE, 'agent');
      const v = await r.verify(id, 'agent');
      r.check(
        "issue-time decisions recorded with basis 'service-principal'",
        r.issued!.receipt.permissions.every(
          p => p.basis === 'service-principal' && p.result === 'ALLOW',
        ),
      );
      r.check(
        "verify-time decisions recorded with basis 'service-principal'",
        v.permissions.every(p => p.basis === 'service-principal'),
      );
      return r.observe(v);
    },
  },
];
