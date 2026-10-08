/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { parseAllDocuments } from 'yaml';
import type { Entity } from '@backstage/catalog-model';
import type { CatalogReader } from '@contextverity/plugin-contextverity-node';

/**
 * In-memory stand-in for the Backstage catalog used by the core tier.
 * Emulates what the real catalog adds during processing: `metadata.uid`
 * (new on recreate), `metadata.etag`, and the built-in relations with their
 * inverses. The backstage tier runs the same scenarios against the real
 * catalog, which cross-checks this emulation.
 */
export class SyntheticCatalog implements CatalogReader {
  private entities = new Map<string, Entity>();
  private uids = new Map<string, string>();
  private seq = 0;
  /** Simulated outages: refs (or '*') whose fetch fails. */
  readonly down = new Set<string>();
  /** Number of getEntitiesByRefs calls (for benchmarks). */
  calls = 0;

  static fromFile(file: string): SyntheticCatalog {
    const c = new SyntheticCatalog();
    for (const doc of parseAllDocuments(readFileSync(file, 'utf8'))) {
      const e = doc.toJS() as Entity | null;
      if (e) c.upsert(e);
    }
    return c;
  }

  upsert(entity: Entity) {
    const e: Entity = JSON.parse(JSON.stringify(entity));
    e.metadata.namespace ??= 'default';
    const ref = refOf(e);
    if (!this.uids.has(ref)) this.uids.set(ref, `uid-${++this.seq}`);
    this.entities.set(ref, e);
  }

  remove(ref: string) {
    this.entities.delete(ref);
    this.uids.delete(ref);
  }

  get(ref: string): Entity | undefined {
    const e = this.entities.get(ref);
    return e ? JSON.parse(JSON.stringify(e)) : undefined;
  }

  async getEntitiesByRefs(refs: string[]): Promise<Array<Entity | undefined>> {
    this.calls++;
    if (this.down.has('*') || refs.some(r => this.down.has(r))) {
      throw new Error('synthetic catalog unavailable');
    }
    const relations = this.computeRelations();
    return refs.map(ref => {
      const e = this.entities.get(ref);
      if (!e) return undefined;
      const out: Entity = JSON.parse(JSON.stringify(e));
      out.metadata.uid = this.uids.get(ref);
      out.relations = relations.get(ref) ?? [];
      out.metadata.etag = String(JSON.stringify(out).length);
      return out;
    });
  }

  private computeRelations(): Map<
    string,
    Array<{ type: string; targetRef: string }>
  > {
    const rel = new Map<string, Array<{ type: string; targetRef: string }>>();
    const add = (src: string, type: string, target: string) => {
      const list = rel.get(src) ?? [];
      if (!list.some(r => r.type === type && r.targetRef === target))
        list.push({ type, targetRef: target });
      rel.set(src, list);
    };
    for (const [ref, e] of this.entities) {
      const ns = e.metadata.namespace ?? 'default';
      const spec = (e.spec ?? {}) as Record<string, unknown>;
      const emit = (
        values: unknown,
        defaultKind: string | undefined,
        fwd: string,
        inv: string,
      ) => {
        const list: unknown[] = Array.isArray(values)
          ? values
          : [values].filter(Boolean);
        for (const v of list) {
          const target = toRef(String(v), defaultKind, ns);
          if (!target) continue;
          add(ref, fwd, target);
          add(target, inv, ref);
        }
      };
      emit(spec.owner, 'group', 'ownedBy', 'ownerOf');
      emit(spec.system, 'system', 'partOf', 'hasPart');
      emit(spec.domain, 'domain', 'partOf', 'hasPart');
      emit(spec.providesApis, 'api', 'providesApi', 'apiProvidedBy');
      emit(spec.consumesApis, 'api', 'consumesApi', 'apiConsumedBy');
      emit(spec.dependsOn, undefined, 'dependsOn', 'dependencyOf');
      emit(spec.dependencyOf, undefined, 'dependencyOf', 'dependsOn');
      emit(spec.memberOf, 'group', 'memberOf', 'hasMember');
    }
    return rel;
  }
}

export function refOf(e: Entity): string {
  return `${e.kind}:${e.metadata.namespace ?? 'default'}/${
    e.metadata.name
  }`.toLowerCase();
}

function toRef(
  value: string,
  defaultKind: string | undefined,
  ns: string,
): string | undefined {
  const m = /^(?:([^:]+):)?(?:([^/]+)\/)?(.+)$/.exec(value.trim());
  if (!m) return undefined;
  const kind = m[1] ?? defaultKind;
  if (!kind) return undefined;
  return `${kind}:${m[2] ?? ns}/${m[3]}`.toLowerCase();
}
