/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import knexFactory, { Knex } from 'knex';
import { parse as parseYaml } from 'yaml';
import type { DatabaseService } from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import type { PermissionDecisionRecord } from '@contextverity/plugin-contextverity-common';
import {
  ContextAuthorizer,
  ContextPolicy,
  ContextVerity,
  Principal,
  ResolveDeniedError,
  parsePolicy,
} from '@contextverity/core';
import {
  BackstageCatalogProvider,
  KnexReceiptStore,
  entityRefFromSourceId,
} from '@contextverity/plugin-contextverity-node';
import { SyntheticCatalog } from './SyntheticCatalog';
import {
  Actor,
  Capability,
  EntityPatch,
  Harness,
  ResolveOutcome,
} from './types';

const PRINCIPALS: Record<Actor, string> = {
  alex: 'user:default/alex',
  agent: 'service:incident-agent',
  other: 'service:other-agent',
};

/**
 * Mirrors Backstage semantics: user principals are evaluated by the
 * (synthetic) permission policy; service principals are allowed.
 */
class SyntheticAuthorizer implements ContextAuthorizer {
  readonly revoked = new Map<string, Set<string>>();
  async authorize(
    principal: Principal,
    sourceIds: string[],
  ): Promise<PermissionDecisionRecord[]> {
    const service = principal.ref.startsWith('service:');
    return sourceIds.map(sourceId => {
      const resourceRef = entityRefFromSourceId(sourceId);
      const denied =
        !service &&
        !!resourceRef &&
        !!this.revoked.get(principal.ref)?.has(resourceRef);
      return {
        permission: 'catalog.entity.read',
        resourceRef,
        sourceId,
        result: denied ? 'DENY' : 'ALLOW',
        principal: principal.ref,
        basis: service ? 'service-principal' : 'permission-policy',
      };
    });
  }
}

export interface CoreHarnessOptions {
  rootDir: string;
}

export class CoreHarness implements Harness {
  readonly tier = 'core' as const;
  readonly capabilities: ReadonlySet<Capability> = new Set([
    'clock',
    'outage',
    'restart',
    'issuer',
    'storage-tamper',
  ]);
  private catalog!: SyntheticCatalog;
  private authorizer!: SyntheticAuthorizer;
  private policies: ContextPolicy[] = [];
  private now = Date.parse('2026-01-01T00:00:00.000Z');
  private dir!: string;
  private db!: Knex;
  private store!: KnexReceiptStore;
  private service!: ContextVerity;
  private ids = 0;

  constructor(private readonly options: CoreHarnessOptions) {}

  seedPolicies(): unknown[] {
    return (
      parseYaml(
        readFileSync(
          join(this.options.rootDir, 'examples/lab/policies.yaml'),
          'utf8',
        ),
      ) as { policies: unknown[] }
    ).policies;
  }

  async reset() {
    await this.close();
    this.catalog = SyntheticCatalog.fromFile(
      join(this.options.rootDir, 'examples/lab/catalog.yaml'),
    );
    this.authorizer = new SyntheticAuthorizer();
    this.policies = this.seedPolicies().map(parsePolicy);
    this.now = Date.parse('2026-01-01T00:00:00.000Z');
    this.dir = mkdtempSync(join(tmpdir(), 'cv-core-'));
    await this.openStore();
    this.service = this.build('lab-local');
  }

  private async openStore() {
    this.db = knexFactory({
      client: 'better-sqlite3',
      connection: { filename: join(this.dir, 'contextverity.sqlite') },
      useNullAsDefault: true,
    });
    const database = {
      getClient: async () => this.db,
    } as unknown as DatabaseService;
    this.store = await KnexReceiptStore.create(database);
  }

  private build(issuer: string) {
    return new ContextVerity({
      issuer,
      provider: new BackstageCatalogProvider({
        reader: this.catalog,
        defaultClassification: 'INTERNAL',
      }),
      authorizer: this.authorizer,
      policies: { list: async () => this.policies },
      store: this.store,
      integritySecret: 'core-tier-secret',
      clock: () => new Date(this.now),
      idGenerator: () => `cv-core-${String(++this.ids).padStart(6, '0')}`,
    });
  }

  private principal(actor: Actor): Principal {
    return { ref: PRINCIPALS[actor] };
  }

  async resolve(
    actor: Actor,
    request: Parameters<Harness['resolve']>[1],
  ): Promise<ResolveOutcome> {
    try {
      return {
        ok: true,
        response: await this.service.resolve(this.principal(actor), request),
      };
    } catch (e) {
      if (e instanceof ResolveDeniedError)
        return { ok: false, code: e.code, detail: e.detail };
      throw e;
    }
  }

  verify(actor: Actor, receiptId: string, intent = {}) {
    return this.service.verify(this.principal(actor), receiptId, intent);
  }

  getReceipt(_actor: Actor, receiptId: string) {
    return this.service.getReceipt(receiptId);
  }

  async patchEntity(ref: string, patch: EntityPatch) {
    const e = this.catalog.get(ref);
    if (!e) throw new Error(`no entity ${ref}`);
    e.spec = { ...e.spec, ...patch.spec } as Entity['spec'];
    for (const [k, v] of Object.entries(patch.spec ?? {}))
      if (v === null) delete (e.spec as Record<string, unknown>)[k];
    for (const field of ['annotations', 'labels'] as const) {
      const values = patch[field];
      if (!values) continue;
      const target: Record<string, string> = { ...(e.metadata[field] ?? {}) };
      for (const [k, v] of Object.entries(values)) {
        if (v === null) delete target[k];
        else target[k] = v;
      }
      e.metadata[field] = target;
    }
    Object.assign(e.metadata, patch.metadata ?? {});
    this.catalog.upsert(e);
  }

  async deleteEntity(ref: string) {
    this.catalog.remove(ref);
  }

  async recreateEntity(ref: string) {
    const e = this.catalog.get(ref);
    if (!e) throw new Error(`no entity ${ref}`);
    this.catalog.remove(ref);
    this.catalog.upsert(e);
  }

  async revoke(user: string, entityRef: string) {
    const set = this.authorizer.revoked.get(user) ?? new Set<string>();
    set.add(entityRef);
    this.authorizer.revoked.set(user, set);
  }

  async setPolicies(policies: unknown[]) {
    this.policies = policies.map(parsePolicy);
  }

  async advance(ms: number) {
    this.now += ms;
  }

  setExactNow(iso: string) {
    this.now = Date.parse(iso);
  }

  async setOutage(ref: string, down: boolean) {
    if (down) this.catalog.down.add(ref);
    else this.catalog.down.delete(ref);
  }

  async restart() {
    // Drop every in-memory object and reopen the same database file.
    await this.db.destroy();
    await this.openStore();
    this.service = this.build('lab-local');
  }

  async verifyAtOtherIssuer(actor: Actor, receiptId: string) {
    return this.build('other-environment').verify(
      this.principal(actor),
      receiptId,
      {},
    );
  }

  async tamperStoredReceipt(receiptId: string) {
    const row = await this.db('contextverity_receipts')
      .where({ receipt_id: receiptId })
      .first();
    const body = JSON.parse(row.body);
    body.grant.sensitivityCeiling = 'RESTRICTED';
    await this.db('contextverity_receipts')
      .where({ receipt_id: receiptId })
      .update({ body: JSON.stringify(body) });
  }

  async close() {
    if (this.db) await this.db.destroy();
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
  }
}
