/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CanonicalizationError,
  canonicalSet,
  canonicalize,
  checkIntegrityTag,
  digestOf,
  integrityTag,
} from './canonical';

describe('canonicalize', () => {
  it('sorts object keys and removes whitespace', () => {
    expect(canonicalize({ b: 1, a: { d: true, c: null } })).toBe(
      '{"a":{"c":null,"d":true},"b":1}',
    );
  });

  it('matches RFC 8785 number and string serialization', () => {
    // Values from RFC 8785 section 3.2.2 and appendix B.
    expect(canonicalize([1e21, 1e-7, -0, 333333333.3333333, 4.5])).toBe(
      '[1e+21,1e-7,0,333333333.3333333,4.5]',
    );
    expect(canonicalize('\u20ac$\u000f\nA\'B"\\\\"/')).toBe(
      '"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"',
    );
  });

  it('sorts keys by UTF-16 code units', () => {
    expect(canonicalize({ '\u20ac': 1, '\r': 2, '1': 3, '\u0080': 4 })).toBe(
      '{"\\r":2,"1":3,"\u0080":4,"€":1}',
    );
  });

  it('treats absent and undefined properties identically', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });

  it('keeps array order significant', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it.each([
    ['NaN', { a: NaN }],
    ['Infinity', [Infinity]],
    ['undefined in array', [1, undefined]],
    ['Date', { a: new Date(0) }],
    ['bigint', { a: BigInt(1) }],
    ['function', { a: () => 1 }],
    ['class instance', new (class X {})()],
  ])('rejects %s', (_, value) => {
    expect(() => canonicalize(value)).toThrow(CanonicalizationError);
  });
});

describe('canonicalSet', () => {
  it('dedupes, trims, drops empties and sorts', () => {
    expect(canonicalSet([' b', 'a', 'b', '', 'a '])).toEqual(['a', 'b']);
    expect(canonicalSet(undefined)).toEqual([]);
  });
});

describe('digestOf', () => {
  it('is stable across key order and differs on value change', () => {
    const a = digestOf({ x: 1, y: ['p', 'q'] });
    expect(digestOf({ y: ['p', 'q'], x: 1 })).toBe(a);
    expect(digestOf({ x: 2, y: ['p', 'q'] })).not.toBe(a);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('integrity tags', () => {
  const body = { receiptId: 'cv-1', owner: 'group:default/team-a' };

  it('verifies an unkeyed tag and detects edits', () => {
    const tag = integrityTag(body);
    expect(checkIntegrityTag(body, tag)).toBe(true);
    expect(
      checkIntegrityTag({ ...body, owner: 'group:default/team-b' }, tag),
    ).toBe(false);
  });

  it('verifies an HMAC tag only with the right secret', () => {
    const tag = integrityTag(body, 's3cret');
    expect(tag).toMatch(/^hmac-sha256:/);
    expect(checkIntegrityTag(body, tag, 's3cret')).toBe(true);
    expect(checkIntegrityTag(body, tag, 'other')).toBe(false);
    expect(checkIntegrityTag(body, tag)).toBe(false);
  });

  it('rejects an unkeyed tag when a secret is configured (no downgrade)', () => {
    const edited = { ...body, owner: 'group:default/attacker' };
    expect(checkIntegrityTag(edited, integrityTag(edited), 's3cret')).toBe(
      false,
    );
  });

  it('rejects garbage tags', () => {
    expect(checkIntegrityTag(body, 'sha256:00')).toBe(false);
    expect(checkIntegrityTag(body, '')).toBe(false);
  });
});
