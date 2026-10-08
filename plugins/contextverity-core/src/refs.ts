/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

const REF_PATTERN =
  /^([a-z0-9][a-z0-9._-]*):(?:([a-z0-9][a-z0-9._-]*)\/)?([a-z0-9][a-z0-9._-]*)$/;

/**
 * Normalizes an entity-style reference to `kind:namespace/name`, lowercase,
 * with `default` as the namespace when omitted. Unparseable input is returned
 * trimmed and lowercased so that it never accidentally matches a valid ref.
 *
 * @public
 */
export function normalizeRef(ref: string): string {
  const t = ref.trim().toLowerCase();
  const m = REF_PATTERN.exec(t);
  if (!m) return t;
  return `${m[1]}:${m[2] ?? 'default'}/${m[3]}`;
}

/** @public */
export function isValidRef(ref: string): boolean {
  return REF_PATTERN.test(ref.trim().toLowerCase());
}
