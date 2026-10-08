/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// DEMO-ONLY control API for the lab, mounted at /api/lab. It changes the
// synthetic world (catalog entities, permission revocations, context
// policies) and waits until the real catalog reflects the change.

import { writeFile } from 'node:fs/promises';
import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { Entity } from '@backstage/catalog-model';
import { InputError, NotFoundError } from '@backstage/errors';
import express from 'express';
import Router from 'express-promise-router';
import { stringify as toYaml } from 'yaml';
import { labState, refOf } from './state';

export const labPlugin = createBackendPlugin({
  pluginId: 'lab',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        auth: coreServices.auth,
        catalog: catalogServiceRef,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ httpRouter, httpAuth, auth, catalog, config, logger }) {
        const policyFile = config.getString('contextverity.policyFile');
        const router = Router();
        router.use(express.json({ limit: '1mb' }));
        router.use(async (req, _res, next) => {
          await httpAuth.credentials(req, { allow: ['user', 'service'] });
          next();
        });

        const current = async (ref: string) => {
          const { items } = await catalog.getEntitiesByRefs(
            { entityRefs: [ref] },
            { credentials: await auth.getOwnServiceCredentials() },
          );
          return items[0] ?? undefined;
        };

        /** Polls the catalog until `check` holds for the stitched entity. */
        const settle = async (
          ref: string,
          check: (e: Entity | undefined) => boolean,
        ) => {
          const started = Date.now();
          while (Date.now() - started < 60_000) {
            const e = await current(ref);
            if (check(e))
              return {
                settledMs: Date.now() - started,
                uid: e?.metadata.uid,
                etag: e?.metadata.etag,
              };
            await new Promise(r => setTimeout(r, 100));
          }
          throw new Error(`catalog did not settle for ${ref} within 60s`);
        };

        const sameSpec = (want: Entity) => (e: Entity | undefined) =>
          !!e &&
          stable(e.spec ?? {}) === stable(want.spec ?? {}) &&
          stable(e.metadata.labels ?? {}) ===
            stable(want.metadata.labels ?? {}) &&
          stable([
            e.metadata.title,
            e.metadata.description,
            e.metadata.tags ?? [],
          ]) ===
            stable([
              want.metadata.title,
              want.metadata.description,
              want.metadata.tags ?? [],
            ]) &&
          Object.entries(want.metadata.annotations ?? {}).every(
            ([k, v]) => e.metadata.annotations?.[k] === v,
          ) &&
          Object.keys(e.metadata.annotations ?? {})
            .filter(k => !k.startsWith('backstage.io/'))
            .every(k => k in (want.metadata.annotations ?? {})) &&
          // Relations are stitched asynchronously; wait until they reflect spec.
          relationsSettled(e, want);

        router.get('/state', async (_req, res) => {
          res.json({ entities: labState.all().map(refOf) });
        });

        router.post('/reset', async (_req, res) => {
          await labState.reset();
          const settled = [];
          for (const e of labState.all())
            settled.push(await settle(refOf(e), sameSpec(e)));
          res.json({
            ok: true,
            maxSettledMs: Math.max(...settled.map(s => s.settledMs)),
          });
        });

        router.put('/entities', async (req, res) => {
          const entity = req.body as Entity;
          if (!entity?.kind || !entity?.metadata?.name)
            throw new InputError('entity required');
          await labState.upsert(entity);
          res.json(await settle(refOf(entity), sameSpec(entity)));
        });

        router.patch('/entities/:kind/:namespace/:name', async (req, res) => {
          const ref =
            `${req.params.kind}:${req.params.namespace}/${req.params.name}`.toLowerCase();
          const e = labState.get(ref);
          if (!e) throw new NotFoundError(ref);
          const patch = req.body as {
            spec?: Record<string, unknown>;
            annotations?: Record<string, string | null>;
            labels?: Record<string, string | null>;
            metadata?: {
              title?: string;
              description?: string;
              tags?: string[];
            };
          };
          const next: Entity = JSON.parse(JSON.stringify(e));
          const { title, description, tags } = patch.metadata ?? {};
          Object.assign(
            next.metadata,
            JSON.parse(JSON.stringify({ title, description, tags })),
          );
          next.spec = { ...next.spec, ...patch.spec } as Entity['spec'];
          for (const [k, v] of Object.entries(patch.spec ?? {}))
            if (v === null) delete (next.spec as Record<string, unknown>)[k];
          for (const [field, values] of [
            ['annotations', patch.annotations],
            ['labels', patch.labels],
          ] as const) {
            if (!values) continue;
            const target: Record<string, string> = {
              ...(next.metadata[field] ?? {}),
            };
            for (const [k, v] of Object.entries(values)) {
              if (v === null) delete target[k];
              else target[k] = v;
            }
            next.metadata[field] = target;
          }
          await labState.upsert(next);
          res.json(await settle(ref, sameSpec(next)));
        });

        router.delete('/entities/:kind/:namespace/:name', async (req, res) => {
          const ref =
            `${req.params.kind}:${req.params.namespace}/${req.params.name}`.toLowerCase();
          await labState.remove(ref);
          res.json(await settle(ref, e => !e));
        });

        router.post(
          '/entities/:kind/:namespace/:name/recreate',
          async (req, res) => {
            const ref =
              `${req.params.kind}:${req.params.namespace}/${req.params.name}`.toLowerCase();
            const e = labState.get(ref);
            if (!e) throw new NotFoundError(ref);
            const before = await current(ref);
            await labState.remove(ref);
            await settle(ref, x => !x);
            await labState.upsert(e);
            res.json({
              before: before?.metadata.uid,
              ...(await settle(ref, x => !!x && sameSpec(e)(x))),
            });
          },
        );

        router.post('/permissions/revoke', async (req, res) => {
          const { user, entityRef } = req.body as {
            user: string;
            entityRef: string;
          };
          labState.revoke(user, entityRef);
          res.json({ revoked: labState.revokedFor(user) });
        });

        router.post('/permissions/grant', async (req, res) => {
          const { user, entityRef } = req.body as {
            user: string;
            entityRef: string;
          };
          labState.grant(user, entityRef);
          res.json({ revoked: labState.revokedFor(user) });
        });

        router.put('/policies', async (req, res) => {
          const { policies } = req.body as { policies: unknown[] };
          if (!Array.isArray(policies))
            throw new InputError('policies must be a list');
          await writeFile(policyFile, toYaml({ policies }), 'utf8');
          res.json({ ok: true });
        });

        httpRouter.use(router);
        logger.warn(
          'ContextVerity LAB control API is enabled at /api/lab (demo only)',
        );
      },
    });
  },
});

/**
 * Order-insensitive comparison form. The catalog does not preserve the order
 * of string lists such as spec.dependsOn, so they are compared as sets.
 */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (Array.isArray(v) && v.every(x => typeof x === 'string'))
      return [...v].sort();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    }
    return v;
  });
}

function relationsSettled(e: Entity, want: Entity): boolean {
  const spec = (want.spec ?? {}) as Record<string, unknown>;
  const count = (t: string) =>
    (e.relations ?? []).filter(r => r.type === t).length;
  const len = (k: string) =>
    Array.isArray(spec[k]) ? (spec[k] as unknown[]).length : 0;
  return (
    count('dependsOn') === len('dependsOn') &&
    count('providesApi') === len('providesApis') &&
    count('consumesApi') === len('consumesApis') &&
    (typeof spec.owner !== 'string' ||
      (e.relations ?? []).some(
        r =>
          r.type === 'ownedBy' &&
          r.targetRef.endsWith(`/${ownerName(spec.owner as string)}`),
      ))
  );
}

function ownerName(owner: string): string {
  return owner.split(':').pop()!.split('/').pop()!.toLowerCase();
}
