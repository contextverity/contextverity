/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { Entity } from '@backstage/catalog-model';
import {
  CLASSIFICATION_ANNOTATION,
  ContextCategory,
  ContextField,
  Sensitivity,
  SourceRecord,
  isSensitivity,
} from '@contextverity/plugin-contextverity-common';
import {
  canonicalSet,
  canonicalize,
  createSourceRecord,
  digestOf,
  filterFields,
  normalizeRef,
} from '@contextverity/core';

/** @public */
export const BACKSTAGE_PROVIDER_ID = 'backstage-catalog';

/** Source ID prefix for catalog entity records. @public */
export const ENTITY_SOURCE_PREFIX = 'catalog:';
/** Source ID prefix for API definition records. @public */
export const API_DEFINITION_SOURCE_PREFIX = 'apidef:';

const TECHDOCS_REF_ANNOTATION = 'backstage.io/techdocs-ref';

/**
 * Thrown when an entity cannot be normalized safely.
 *
 * @public
 */
export class MalformedEntityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedEntityError';
  }
}

/** @public */
export function entityRefOf(entity: Entity): string {
  return normalizeRef(
    `${entity.kind}:${entity.metadata.namespace ?? 'default'}/${
      entity.metadata.name
    }`,
  );
}

/**
 * Maps a source ID back to the catalog entity it was derived from.
 *
 * @public
 */
export function entityRefFromSourceId(sourceId: string): string | undefined {
  for (const prefix of [ENTITY_SOURCE_PREFIX, API_DEFINITION_SOURCE_PREFIX]) {
    if (sourceId.startsWith(prefix)) return sourceId.slice(prefix.length);
  }
  return undefined;
}

/**
 * Reads the declared classification. A missing annotation falls back to the
 * configured default; an unrecognized value is malformed (fail closed).
 *
 * @public
 */
export function classificationOf(
  entity: Entity,
  fallback: Sensitivity,
): Sensitivity {
  const raw = entity.metadata.annotations?.[CLASSIFICATION_ANNOTATION];
  if (raw === undefined) return fallback;
  const value = raw.trim().toUpperCase();
  if (!isSensitivity(value)) {
    throw new MalformedEntityError(
      `${entityRefOf(
        entity,
      )} has invalid ${CLASSIFICATION_ANNOTATION} '${raw}'`,
    );
  }
  return value;
}

function relationTargets(entity: Entity, type: string): string[] {
  return canonicalSet(
    (entity.relations ?? [])
      .filter(r => r.type === type)
      .map(r => normalizeRef(r.targetRef)),
  );
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * sha256 over a definition body; the body itself is never stored.
 *
 * @public
 */
export function definitionDigest(definition: unknown): string | null {
  if (typeof definition !== 'string') return null;
  // Normalize line endings only; any other byte change is a definition change.
  const body = definition.replace(/\r\n/g, '\n');
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

/**
 * Extracts every candidate context field from an entity. Labels, tags, title,
 * description, links and annotations other than the ones listed here are
 * deliberately excluded: changing them does not invalidate context.
 *
 * @public
 */
export function entityFields(entity: Entity): Record<string, ContextField> {
  const spec = (entity.spec ?? {}) as Record<string, unknown>;
  const owners = relationTargets(entity, 'ownedBy');
  const fields: Record<string, ContextField> = {
    type: { category: 'identity', value: str(spec.type) },
    owner: {
      category: 'ownership',
      value: owners.length <= 1 ? owners[0] ?? null : owners,
    },
    lifecycle: { category: 'lifecycle', value: str(spec.lifecycle) },
    system: {
      category: 'dependencies',
      value:
        relationTargets(entity, 'partOf').find(r => r.startsWith('system:')) ??
        null,
    },
    dependsOn: {
      category: 'dependencies',
      value: relationTargets(entity, 'dependsOn'),
    },
    dependencyOf: {
      category: 'dependencies',
      value: relationTargets(entity, 'dependencyOf'),
    },
    consumesApis: {
      category: 'dependencies',
      value: relationTargets(entity, 'consumesApi'),
    },
    providesApis: {
      category: 'apis',
      value: relationTargets(entity, 'providesApi'),
    },
    techdocsRef: {
      category: 'documentation',
      value: str(entity.metadata.annotations?.[TECHDOCS_REF_ANNOTATION]),
    },
  };
  return fields;
}

/** @public */
export function entityRecord(
  entity: Entity,
  options: {
    categories: ContextCategory[];
    required: boolean;
    defaultClassification: Sensitivity;
  },
): SourceRecord {
  return createSourceRecord({
    sourceId: `${ENTITY_SOURCE_PREFIX}${entityRefOf(entity)}`,
    kind: 'CATALOG_ENTITY',
    provider: BACKSTAGE_PROVIDER_ID,
    identity: entity.metadata.uid,
    required: options.required,
    classification: classificationOf(entity, options.defaultClassification),
    fields: filterFields(entityFields(entity), options.categories),
  });
}

/**
 * Record for an API entity's definition: its type, lifecycle and a digest of
 * `spec.definition`. Emitted for APIs the subject provides (or the subject
 * itself, when it is an API) when `api-definition` is requested.
 *
 * @public
 */
export function apiDefinitionRecord(
  api: Entity,
  options: { defaultClassification: Sensitivity },
): SourceRecord {
  const spec = (api.spec ?? {}) as Record<string, unknown>;
  return createSourceRecord({
    sourceId: `${API_DEFINITION_SOURCE_PREFIX}${entityRefOf(api)}`,
    kind: 'API_DEFINITION',
    provider: BACKSTAGE_PROVIDER_ID,
    identity: api.metadata.uid,
    required: true,
    classification: classificationOf(api, options.defaultClassification),
    fields: {
      apiType: { category: 'api-definition', value: str(spec.type) },
      lifecycle: { category: 'api-definition', value: str(spec.lifecycle) },
      definitionDigest: {
        category: 'api-definition',
        value: apiContractDigest(spec),
      },
    },
  });
}

/**
 * Digest of what defines an API's contract: `spec.definition` for classic
 * APIs, or the `spec.remotes` endpoints for `mcp-server` APIs (which carry
 * no definition). Remotes are treated as an unordered set.
 *
 * @public
 */
export function apiContractDigest(
  spec: Record<string, unknown>,
): string | null {
  if (typeof spec.definition === 'string')
    return definitionDigest(spec.definition);
  if (Array.isArray(spec.remotes)) {
    const remotes = spec.remotes
      .filter(
        (r): r is Record<string, unknown> =>
          typeof r === 'object' && r !== null,
      )
      .map(r => JSON.parse(JSON.stringify(r)))
      .sort((a, b) => (canonicalize(a) < canonicalize(b) ? -1 : 1));
    return digestOf(remotes);
  }
  return null;
}
