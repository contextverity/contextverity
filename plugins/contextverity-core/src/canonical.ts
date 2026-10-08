/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { CanonicalValue } from '@contextverity/plugin-contextverity-common';

/**
 * Thrown when a value cannot be represented canonically.
 *
 * @public
 */
export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

/**
 * Serializes a value into canonical JSON.
 *
 * For the JSON subset ContextVerity uses (strings, finite numbers, booleans,
 * null, arrays, plain objects) the output follows RFC 8785 (JSON
 * Canonicalization Scheme): object keys sorted by UTF-16 code units, no
 * insignificant whitespace, ECMAScript number and string serialization.
 *
 * Additional, deliberate rules:
 * - object properties whose value is `undefined` are omitted, so an absent
 *   optional field and an explicitly undefined one canonicalize identically;
 * - `undefined` inside arrays, non-finite numbers, functions, symbols,
 *   bigints, Dates and other non-plain objects are rejected rather than
 *   silently coerced.
 *
 * Array order is significant. Callers that model unordered sets must
 * normalize them first (see {@link canonicalSet}).
 *
 * @public
 */
export function canonicalize(value: unknown): string {
  return serialize(value, '$');
}

function serialize(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(`non-finite number at ${path}`);
      }
      // JSON.stringify(-0) === '0', matching RFC 8785.
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value
          .map((item, i) => {
            if (item === undefined) {
              throw new CanonicalizationError(`undefined at ${path}[${i}]`);
            }
            return serialize(item, `${path}[${i}]`);
          })
          .join(',')}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalizationError(`non-plain object at ${path}`);
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter(k => record[k] !== undefined)
        .sort();
      return `{${keys
        .map(
          k => `${JSON.stringify(k)}:${serialize(record[k], `${path}.${k}`)}`,
        )
        .join(',')}}`;
    }
    default:
      throw new CanonicalizationError(`unsupported ${typeof value} at ${path}`);
  }
}

/**
 * Normalizes a semantically unordered list of strings: trims, drops empty
 * entries, de-duplicates and sorts. Use it for relation targets, dependency
 * sets, tags and similar.
 *
 * @public
 */
export function canonicalSet(values: Iterable<string> | undefined): string[] {
  if (!values) return [];
  const set = new Set<string>();
  for (const v of values) {
    const t = v.trim();
    if (t) set.add(t);
  }
  return [...set].sort();
}

/**
 * SHA-256 over the canonical form of a value, as `sha256:<hex>`.
 * A digest is not a signature: it detects change, not authorship.
 *
 * @public
 */
export function digestOf(value: CanonicalValue | unknown): string {
  return `sha256:${createHash('sha256')
    .update(canonicalize(value), 'utf8')
    .digest('hex')}`;
}

/**
 * Integrity tag for stored receipts. Without a secret this is a plain SHA-256
 * (detects corruption and naive edits). With a secret it is HMAC-SHA256
 * (detects edits by anyone who does not hold the secret).
 *
 * @public
 */
export function integrityTag(value: unknown, secret?: string): string {
  const body = canonicalize(value);
  if (secret) {
    return `hmac-sha256:${createHmac('sha256', secret)
      .update(body, 'utf8')
      .digest('hex')}`;
  }
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

/**
 * Constant-time comparison of an integrity tag against a value.
 *
 * @public
 */
export function checkIntegrityTag(
  value: unknown,
  tag: string,
  secret?: string,
): boolean {
  const isHmac = tag.startsWith('hmac-sha256:');
  // With a secret configured, an unkeyed tag is a downgrade and is rejected.
  // Without one, a keyed tag cannot be checked and is rejected too.
  if (Boolean(secret) !== isHmac) return false;
  let expected: string;
  try {
    expected = integrityTag(value, secret);
  } catch {
    return false;
  }
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(tag, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
