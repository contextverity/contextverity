/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ContextCategory,
  ContextField,
  Sensitivity,
  SourceKind,
  SourceRecord,
} from '@contextverity/plugin-contextverity-common';
import { digestOf } from './canonical';

/** @public */
export interface SourceRecordInput {
  sourceId: string;
  kind: SourceKind;
  provider: string;
  identity?: string;
  required: boolean;
  classification: Sensitivity;
  fields: Record<string, ContextField>;
}

/**
 * Digest over the parts of a record that represent source state. `required`
 * describes how the record is used, not the source, and is excluded.
 *
 * @public
 */
export function sourceRecordDigest(
  input: Omit<SourceRecordInput, 'required'>,
): string {
  return digestOf({
    sourceId: input.sourceId,
    kind: input.kind,
    provider: input.provider,
    identity: input.identity,
    classification: input.classification,
    fields: input.fields,
  });
}

/** @public */
export function createSourceRecord(input: SourceRecordInput): SourceRecord {
  return { ...input, digest: sourceRecordDigest(input) };
}

/**
 * Keeps only fields in the given categories. Providers call this so that a
 * receipt never records context outside its grant.
 *
 * @public
 */
export function filterFields(
  fields: Record<string, ContextField>,
  categories: readonly ContextCategory[],
): Record<string, ContextField> {
  const out: Record<string, ContextField> = {};
  for (const name of Object.keys(fields).sort()) {
    if (categories.includes(fields[name].category)) out[name] = fields[name];
  }
  return out;
}
