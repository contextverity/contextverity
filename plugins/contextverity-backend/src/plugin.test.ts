/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  mockCredentials,
  mockServices,
  startTestBackend,
} from '@backstage/backend-test-utils';
import { actionsRegistryServiceMock } from '@backstage/backend-test-utils/alpha';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import type { Entity } from '@backstage/catalog-model';
import request from 'supertest';
import { contextverityPlugin } from './plugin';

const payments: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'payments',
    namespace: 'default',
    uid: 'uid-payments',
    annotations: { 'contextverity.github.io/classification': 'INTERNAL' },
  },
  spec: { type: 'service', lifecycle: 'production', owner: 'team-payments' },
  relations: [{ type: 'ownedBy', targetRef: 'group:default/team-payments' }],
};

const identity: Entity = {
  ...payments,
  metadata: {
    ...payments.metadata,
    name: 'identity',
    uid: 'uid-identity',
    annotations: { 'contextverity.github.io/classification': 'RESTRICTED' },
  },
};

const policies = [
  {
    id: 'incident-triage',
    consumers: ['user:default/alex', 'service:incident-agent'],
    purposes: ['incident-triage'],
    subjects: { kinds: ['component'] },
    allowedSourceKinds: ['CATALOG_ENTITY', 'API_DEFINITION'],
    allowedCategories: [
      'identity',
      'ownership',
      'lifecycle',
      'dependencies',
      'apis',
    ],
    sensitivityCeiling: 'INTERNAL',
    maxTtlSeconds: 900,
  },
];

const ALEX = mockCredentials.user.header('user:default/alex');
const BOB = mockCredentials.user.header('user:default/bob');
const RESOLVE = {
  subject: 'component:payments',
  purpose: 'incident-triage',
  categories: ['ownership', 'lifecycle'],
};

describe('contextverity backend plugin', () => {
  /** Decision returned for catalog.entity.read and contextverity.receipt.read. */
  type Decision = typeof AuthorizeResult.ALLOW | typeof AuthorizeResult.DENY;
  let catalogRead: Decision = AuthorizeResult.ALLOW;
  let receiptRead: Decision = AuthorizeResult.DENY;
  const permissions = mockServices.permissions.mock({
    authorize: async requests =>
      requests.map(r => ({
        result:
          r.permission.name === 'contextverity.receipt.read'
            ? receiptRead
            : catalogRead,
      })) as any,
  });
  const actions = actionsRegistryServiceMock.mock();

  const start = () =>
    startTestBackend({
      features: [
        contextverityPlugin,
        mockServices.rootConfig.factory({
          data: { contextverity: { issuer: 'test', policies } },
        }),
        catalogServiceMock.factory({ entities: [payments, identity] }),
        permissions.factory,
        actions.factory,
      ],
    });

  beforeEach(() => {
    catalogRead = AuthorizeResult.ALLOW;
    receiptRead = AuthorizeResult.DENY;
  });

  it('issues a receipt and verifies it as VALID', async () => {
    const { server } = await start();
    const res = await request(server)
      .post('/api/contextverity/v1/resolve')
      .set('Authorization', ALEX)
      .send(RESOLVE);
    expect(res.status).toBe(201);
    const { receipt, context } = res.body;
    expect(receipt).toMatchObject({
      issuer: 'test',
      consumer: 'user:default/alex',
      subject: 'component:default/payments',
      classification: 'INTERNAL',
    });
    expect(receipt.permissions[0]).toMatchObject({
      permission: 'catalog.entity.read',
      result: 'ALLOW',
      basis: 'permission-policy',
    });
    expect(context[0].fields).toEqual({
      owner: 'group:default/team-payments',
      lifecycle: 'production',
    });

    const v = await request(server)
      .post(`/api/contextverity/v1/receipts/${receipt.receiptId}/verify`)
      .set('Authorization', ALEX)
      .send({});
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({
      verdict: 'VALID',
      drift: [],
      mode: 'verify',
      sourcesChecked: 1,
    });
  });

  it('denies verification after permission revocation', async () => {
    const { server } = await start();
    const { body } = await request(server)
      .post('/api/contextverity/v1/resolve')
      .set('Authorization', ALEX)
      .send(RESOLVE);
    catalogRead = AuthorizeResult.DENY;
    const v = await request(server)
      .post(`/api/contextverity/v1/receipts/${body.receipt.receiptId}/verify`)
      .set('Authorization', ALEX)
      .send({});
    expect(v.body.verdict).toBe('DENY');
    expect(v.body.drift.map((d: any) => d.code)).toEqual([
      'PERMISSION_REVOKED',
    ]);
  });

  it('binds receipts to their consumer without revealing source state', async () => {
    const { server } = await start();
    const { body } = await request(server)
      .post('/api/contextverity/v1/resolve')
      .set('Authorization', ALEX)
      .send(RESOLVE);
    const v = await request(server)
      .post(`/api/contextverity/v1/receipts/${body.receipt.receiptId}/verify`)
      .set('Authorization', BOB)
      .send({});
    expect(v.body).toMatchObject({ verdict: 'DENY', sourcesChecked: 0 });
    expect(v.body.drift.map((d: any) => d.code)).toEqual(['CONSUMER_MISMATCH']);
    // Another user cannot read the receipt (looks like it does not exist).
    expect(
      (
        await request(server)
          .get(`/api/contextverity/v1/receipts/${body.receipt.receiptId}`)
          .set('Authorization', BOB)
      ).status,
    ).toBe(404);
    receiptRead = AuthorizeResult.ALLOW;
    expect(
      (
        await request(server)
          .get(`/api/contextverity/v1/receipts/${body.receipt.receiptId}`)
          .set('Authorization', BOB)
      ).status,
    ).toBe(200);
  });

  it('returns structured resolve denials', async () => {
    const { server } = await start();
    const above = await request(server)
      .post('/api/contextverity/v1/resolve')
      .set('Authorization', ALEX)
      .send({ ...RESOLVE, subject: 'component:identity' });
    expect(above.status).toBe(403);
    expect(above.body.error).toMatchObject({
      name: 'ResolveDenied',
      code: 'CLASSIFICATION_EXCEEDS_GRANT',
    });
    const missing = await request(server)
      .post('/api/contextverity/v1/resolve')
      .set('Authorization', ALEX)
      .send({ ...RESOLVE, subject: 'component:nope' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('SUBJECT_NOT_FOUND');
    const noPolicy = await request(server)
      .post('/api/contextverity/v1/resolve')
      .set('Authorization', BOB)
      .send(RESOLVE);
    expect(noPolicy.body.error.code).toBe('NO_MATCHING_POLICY');
  });

  it('rejects malformed requests and unknown receipts', async () => {
    const { server } = await start();
    const bad = await request(server)
      .post('/api/contextverity/v1/resolve')
      .set('Authorization', ALEX)
      .send({ subject: 'not a ref', purpose: 'x', categories: [] });
    expect(bad.status).toBe(400);
    const unknown = await request(server)
      .post('/api/contextverity/v1/receipts/cv-missing/verify')
      .set('Authorization', ALEX)
      .send({});
    expect(unknown.status).toBe(404);
    const anon = await request(server)
      .post('/api/contextverity/v1/resolve')
      .send(RESOLVE);
    expect([401, 403]).toContain(anon.status);
  });

  it('does not record verifications that fail binding', async () => {
    const { server } = await start();
    const { body } = await request(server)
      .post('/api/contextverity/v1/resolve')
      .set('Authorization', ALEX)
      .send(RESOLVE);
    const id = body.receipt.receiptId;
    await request(server)
      .post(`/api/contextverity/v1/receipts/${id}/verify`)
      .set('Authorization', ALEX)
      .send({});
    await request(server)
      .post(`/api/contextverity/v1/receipts/${id}/verify`)
      .set('Authorization', BOB)
      .send({});
    const detail = await request(server)
      .get(`/api/contextverity/v1/receipts/${id}`)
      .set('Authorization', ALEX);
    expect(detail.body.verifications).toHaveLength(1);
    expect(detail.body.verifications[0]).toMatchObject({
      verdict: 'VALID',
      principal: 'user:default/alex',
    });
  });

  it("never lets service principals read others' receipts through the permission bypass", async () => {
    const { server } = await start();
    const { body } = await request(server)
      .post('/api/contextverity/v1/resolve')
      .set('Authorization', ALEX)
      .send(RESOLVE);
    // Backstage allows services without consulting the policy; emulate that.
    receiptRead = AuthorizeResult.ALLOW;
    const service = mockCredentials.service.header(); // external:test-service
    const list = await request(server)
      .get('/api/contextverity/v1/receipts')
      .set('Authorization', service);
    expect(list.body.items).toHaveLength(0);
    const id = body.receipt.receiptId;
    const detail = await request(server)
      .get(`/api/contextverity/v1/receipts/${id}`)
      .set('Authorization', service);
    expect(detail.status).toBe(404);
    const inspect = await request(server)
      .post(`/api/contextverity/v1/receipts/${id}/inspect`)
      .set('Authorization', service);
    expect(inspect.status).toBe(403);
  });

  it('hides a receipt from a reader who may not read its sources', async () => {
    const { server } = await start();
    const { body } = await request(server)
      .post('/api/contextverity/v1/resolve')
      .set('Authorization', ALEX)
      .send(RESOLVE);
    receiptRead = AuthorizeResult.ALLOW;
    catalogRead = AuthorizeResult.DENY;
    const detail = await request(server)
      .get(`/api/contextverity/v1/receipts/${body.receipt.receiptId}`)
      .set('Authorization', BOB);
    expect(detail.status).toBe(404);
  });

  it("lists only the caller's receipts without contextverity.receipt.read", async () => {
    const { server } = await start();
    await request(server)
      .post('/api/contextverity/v1/resolve')
      .set('Authorization', ALEX)
      .send(RESOLVE);
    const mine = await request(server)
      .get('/api/contextverity/v1/receipts')
      .set('Authorization', ALEX);
    expect(mine.body.items).toHaveLength(1);
    const theirs = await request(server)
      .get('/api/contextverity/v1/receipts')
      .set('Authorization', BOB);
    expect(theirs.body.items).toHaveLength(0);
  });

  it('registers resolve and verify actions that use the caller identity', async () => {
    await start();
    const registered = Object.fromEntries(
      actions.register.mock.calls.map(([opts]) => [opts.name, opts]),
    );
    expect(Object.keys(registered).sort()).toEqual([
      'resolve-context',
      'verify-receipt',
    ]);
    const credentials = mockCredentials.user('user:default/alex');
    const logger = mockServices.logger.mock();
    const issued: any = await registered['resolve-context'].action({
      input: RESOLVE,
      credentials,
      logger,
    } as any);
    expect(issued.output.outcome).toBe('ISSUED');
    const verified: any = await registered['verify-receipt'].action({
      input: { receiptId: issued.output.receiptId },
      credentials,
      logger,
    } as any);
    expect(verified.output.verdict).toBe('VALID');
    const other: any = await registered['verify-receipt'].action({
      input: { receiptId: issued.output.receiptId },
      credentials: mockCredentials.service('external:other'),
      logger,
    } as any);
    expect(other.output.verdict).toBe('DENY');
  });
});
