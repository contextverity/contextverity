/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  PolicyValidationError,
  parsePolicy,
  policyDigest,
  policyMatches,
} from './policy';

const base = {
  id: 'incident-triage',
  description: 'Incident triage agents',
  consumers: ['service:incident-agent', 'user:default/alex'],
  purposes: ['incident-triage'],
  subjects: { kinds: ['component', 'api'], namespaces: ['default'] },
  allowedSourceKinds: ['CATALOG_ENTITY', 'API_DEFINITION'],
  allowedCategories: [
    'ownership',
    'lifecycle',
    'dependencies',
    'apis',
    'api-definition',
  ],
  sensitivityCeiling: 'INTERNAL',
  maxTtlSeconds: 900,
};

describe('parsePolicy', () => {
  it('normalizes set-like lists and refs', () => {
    const p = parsePolicy({
      ...base,
      consumers: [
        'User:Default/Alex',
        'service:incident-agent',
        'user:default/alex',
      ],
    });
    expect(p.consumers).toEqual([
      'service:incident-agent',
      'user:default/alex',
    ]);
  });

  it('collects every problem', () => {
    const bad = {
      id: 'Bad Id',
      consumers: [],
      sensitivityCeiling: 'SECRET',
      maxTtlSeconds: 0,
      allowedCategories: ['nope'],
      allowedSourceKinds: ['X'],
      purposes: ['p'],
      denyOn: ['PERMISSION_REVOKED'],
    };
    let error: unknown;
    try {
      parsePolicy(bad);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PolicyValidationError);
    const problems = (error as PolicyValidationError).problems.join('\n');
    for (const fragment of [
      'id must match',
      'consumers must not be empty',
      'unknown source kind',
      'unknown category',
      'sensitivityCeiling',
      'maxTtlSeconds',
      "denyOn code 'PERMISSION_REVOKED'",
    ]) {
      expect(problems).toContain(fragment);
    }
  });

  it('rejects requireFresh outside allowedCategories', () => {
    expect(() =>
      parsePolicy({ ...base, requireFresh: ['documentation'] }),
    ).toThrow(/requireFresh/);
  });
});

describe('policyDigest', () => {
  it('ignores description, ordering, duplicates and case of refs', () => {
    const reordered = {
      ...base,
      description: 'reworded',
      consumers: [
        'USER:default/alex',
        'service:incident-agent',
        'service:incident-agent',
      ],
      allowedCategories: [...base.allowedCategories].reverse(),
      subjects: { namespaces: ['default'], kinds: ['api', 'component'] },
    };
    expect(policyDigest(parsePolicy(reordered))).toBe(
      policyDigest(parsePolicy(base)),
    );
  });

  it('treats an explicit requireFresh equal to allowedCategories as the default', () => {
    expect(
      policyDigest(
        parsePolicy({ ...base, requireFresh: base.allowedCategories }),
      ),
    ).toBe(policyDigest(parsePolicy(base)));
  });

  it.each([
    ['ceiling', { sensitivityCeiling: 'RESTRICTED' }],
    ['ttl', { maxTtlSeconds: 60 }],
    ['consumers', { consumers: ['service:incident-agent'] }],
    ['categories', { allowedCategories: ['ownership'] }],
    ['denyOn', { denyOn: ['OWNER_CHANGED'] }],
  ])('changes when %s changes', (_, patch) => {
    expect(policyDigest(parsePolicy({ ...base, ...patch }))).not.toBe(
      policyDigest(parsePolicy(base)),
    );
  });
});

describe('policyMatches', () => {
  const p = parsePolicy(base);
  it('matches consumer, purpose and subject scope', () => {
    expect(
      policyMatches(
        p,
        'service:incident-agent',
        'incident-triage',
        'component:payments',
      ),
    ).toBe(true);
    expect(
      policyMatches(
        p,
        'service:other',
        'incident-triage',
        'component:payments',
      ),
    ).toBe(false);
    expect(
      policyMatches(
        p,
        'service:incident-agent',
        'deploy',
        'component:payments',
      ),
    ).toBe(false);
    expect(
      policyMatches(
        p,
        'service:incident-agent',
        'incident-triage',
        'resource:default/db',
      ),
    ).toBe(false);
    expect(
      policyMatches(
        p,
        'service:incident-agent',
        'incident-triage',
        'component:other/payments',
      ),
    ).toBe(false);
  });
  it('supports wildcard consumers', () => {
    expect(
      policyMatches(
        parsePolicy({ ...base, consumers: ['*'] }),
        'user:x/y',
        'incident-triage',
        'api:default/a',
      ),
    ).toBe(true);
  });
});
