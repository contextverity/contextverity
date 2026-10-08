/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Entity } from '@backstage/catalog-model';
import type {
  ContextCategory,
  Sensitivity,
  SourceRecord,
} from '@contextverity/plugin-contextverity-common';
import {
  ContextSourceProvider,
  ProviderResolution,
  SourceObservation,
  canonicalSet,
  normalizeRef,
} from '@contextverity/core';
import {
  BACKSTAGE_PROVIDER_ID,
  ENTITY_SOURCE_PREFIX,
  MalformedEntityError,
  apiDefinitionRecord,
  entityRecord,
  entityRefFromSourceId,
  entityRefOf,
} from './normalize';

/**
 * Minimal read access to the catalog. Implementations return `undefined`
 * for entities that do not exist and throw when the catalog cannot be
 * reached.
 *
 * @public
 */
export interface CatalogReader {
  getEntitiesByRefs(entityRefs: string[]): Promise<Array<Entity | undefined>>;
}

/** @public */
export interface BackstageCatalogProviderOptions {
  reader: CatalogReader;
  /** Classification used when an entity carries no classification annotation. */
  defaultClassification: Sensitivity;
}

/**
 * Context source provider backed by the Backstage Software Catalog.
 *
 * Source state is read with the ContextVerity plugin's own service
 * credentials, so that a missing entity means "deleted", not "hidden from
 * this caller". Whether the consumer may read it is decided separately by the
 * permission authorizer.
 *
 * @public
 */
export class BackstageCatalogProvider implements ContextSourceProvider {
  readonly id = BACKSTAGE_PROVIDER_ID;

  constructor(private readonly options: BackstageCatalogProviderOptions) {}

  subjectSourceId(subject: string): string {
    return `${ENTITY_SOURCE_PREFIX}${normalizeRef(subject)}`;
  }

  async resolve(request: {
    subject: string;
    categories: ContextCategory[];
  }): Promise<ProviderResolution> {
    const { categories } = request;
    const defaultClassification = this.options.defaultClassification;
    let subject: Entity | undefined;
    try {
      [subject] = await this.options.reader.getEntitiesByRefs([
        normalizeRef(request.subject),
      ]);
    } catch (e) {
      return { status: 'UNAVAILABLE', error: errorMessage(e) };
    }
    if (!subject) return { status: 'NOT_FOUND' };

    try {
      const records: SourceRecord[] = [
        entityRecord(subject, {
          categories,
          required: true,
          defaultClassification,
        }),
      ];
      if (categories.includes('api-definition')) {
        const apiRefs =
          subject.kind.toLowerCase() === 'api'
            ? [entityRefOf(subject)]
            : canonicalSet(
                (subject.relations ?? [])
                  .filter(r => r.type === 'providesApi')
                  .map(r => normalizeRef(r.targetRef)),
              );
        if (apiRefs.length) {
          let apis: Array<Entity | undefined>;
          try {
            apis = await this.options.reader.getEntitiesByRefs(apiRefs);
          } catch (e) {
            return { status: 'UNAVAILABLE', error: errorMessage(e) };
          }
          // A relation can point at an entity that does not exist (yet). Such
          // dangling refs remain visible in `providesApis` but yield no record.
          for (const api of apis) {
            if (api)
              records.push(apiDefinitionRecord(api, { defaultClassification }));
          }
        }
      }
      return { status: 'OK', records };
    } catch (e) {
      if (e instanceof MalformedEntityError)
        return { status: 'MALFORMED', error: e.message };
      throw e;
    }
  }

  async observe(
    sources: SourceRecord[],
    categories: ContextCategory[],
  ): Promise<SourceObservation[]> {
    const refs = canonicalSet(
      sources.map(s => entityRefFromSourceId(s.sourceId) ?? ''),
    );
    let entities: Array<Entity | undefined>;
    try {
      entities = await this.options.reader.getEntitiesByRefs(refs);
    } catch (e) {
      const error = errorMessage(e);
      return sources.map(s => ({
        sourceId: s.sourceId,
        status: 'UNAVAILABLE' as const,
        error,
      }));
    }
    const byRef = new Map<string, Entity | undefined>(
      refs.map((r, i) => [r, entities[i]]),
    );
    const defaultClassification = this.options.defaultClassification;

    return sources.map((s): SourceObservation => {
      const ref = entityRefFromSourceId(s.sourceId);
      const entity = ref ? byRef.get(ref) : undefined;
      if (!entity) return { sourceId: s.sourceId, status: 'NOT_FOUND' };
      try {
        const record =
          s.kind === 'API_DEFINITION'
            ? apiDefinitionRecord(entity, { defaultClassification })
            : entityRecord(entity, {
                categories,
                required: s.required,
                defaultClassification,
              });
        return { sourceId: s.sourceId, status: 'OK', record };
      } catch (e) {
        if (e instanceof MalformedEntityError) {
          return {
            sourceId: s.sourceId,
            status: 'MALFORMED',
            error: e.message,
          };
        }
        return {
          sourceId: s.sourceId,
          status: 'UNAVAILABLE',
          error: errorMessage(e),
        };
      }
    });
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
