/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// DEMO-ONLY lab state shared by the lab catalog provider, the lab permission
// policy and the lab control API. Not part of ContextVerity itself.

import { readFileSync } from 'node:fs';
import { parseAllDocuments } from 'yaml';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';

export type Mutation = (entities: Entity[], removed: Entity[]) => Promise<void>;

class LabState {
  private entities = new Map<string, Entity>();
  /** Revoked `catalog.entity.read`: user entity ref -> set of entity refs. */
  private revoked = new Map<string, Set<string>>();
  private seedFile?: string;
  private apply?: Mutation;

  seed(file: string) {
    this.seedFile = file;
    this.entities.clear();
    for (const doc of parseAllDocuments(readFileSync(file, 'utf8'))) {
      const entity = doc.toJS() as Entity | null;
      if (!entity) continue;
      entity.metadata.namespace ??= 'default';
      this.entities.set(refOf(entity), entity);
    }
  }

  connect(apply: Mutation) {
    this.apply = apply;
  }

  all(): Entity[] {
    return [...this.entities.values()];
  }

  get(ref: string): Entity | undefined {
    return this.entities.get(ref.toLowerCase());
  }

  async reset() {
    if (!this.seedFile) throw new Error('lab not seeded');
    const before = this.all();
    this.seed(this.seedFile);
    this.revoked.clear();
    const keep = new Set(this.all().map(refOf));
    await this.push(
      this.all(),
      before.filter(e => !keep.has(refOf(e))),
    );
  }

  async upsert(entity: Entity) {
    entity.metadata.namespace ??= 'default';
    this.entities.set(refOf(entity), entity);
    await this.push([entity], []);
  }

  async remove(ref: string) {
    const e = this.get(ref);
    if (!e) return;
    this.entities.delete(ref.toLowerCase());
    await this.push([], [e]);
  }

  revoke(user: string, entityRef: string) {
    const set = this.revoked.get(user.toLowerCase()) ?? new Set<string>();
    set.add(entityRef.toLowerCase());
    this.revoked.set(user.toLowerCase(), set);
  }

  grant(user: string, entityRef: string) {
    this.revoked.get(user.toLowerCase())?.delete(entityRef.toLowerCase());
  }

  revokedFor(user: string): string[] {
    return [...(this.revoked.get(user.toLowerCase()) ?? [])].sort();
  }

  private async push(added: Entity[], removed: Entity[]) {
    if (!this.apply)
      throw new Error('lab entity provider is not connected yet');
    await this.apply(added, removed);
  }
}

export function refOf(entity: Entity): string {
  return stringifyEntityRef(entity).toLowerCase();
}

export const labState = new LabState();
