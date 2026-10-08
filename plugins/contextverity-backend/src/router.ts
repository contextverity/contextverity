/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  HttpAuthService,
  LoggerService,
  PermissionsService,
} from '@backstage/backend-plugin-api';
import {
  InputError,
  NotAllowedError,
  NotFoundError,
  ServiceUnavailableError,
} from '@backstage/errors';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import express from 'express';
import Router from 'express-promise-router';
import {
  AccessDeniedError,
  ContextVerity,
  InvalidRequestError,
  ReceiptNotFoundError,
  ResolveDeniedError,
} from '@contextverity/core';
import { contextverityReceiptReadPermission } from '@contextverity/plugin-contextverity-common';
import { principalFromCredentials } from '@contextverity/plugin-contextverity-node';
import { PolicyLoadError } from './policies';

/** @internal */
export interface RouterOptions {
  service: ContextVerity;
  httpAuth: HttpAuthService;
  permissions: PermissionsService;
  logger: LoggerService;
  /** Service principal refs allowed to read receipts issued to others. */
  receiptReaders?: string[];
}

/**
 * HTTP API, mounted by Backstage at `/api/contextverity`.
 *
 * - `POST /v1/resolve`                   issue a receipt (caller = consumer)
 * - `POST /v1/receipts/:id/verify`       verify a receipt for reuse (caller must be its consumer)
 * - `GET  /v1/receipts`                  list receipts (own, or all with contextverity.receipt.read)
 * - `GET  /v1/receipts/:id`              receipt detail and verification history
 * - `POST /v1/receipts/:id/inspect`      operator drift view (contextverity.receipt.read)
 *
 * @internal
 */
export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { service, httpAuth, permissions, logger } = options;
  const receiptReaders = (options.receiptReaders ?? []).map(r =>
    r.toLowerCase(),
  );
  const router = Router();
  router.use(express.json({ limit: '64kb' }));

  const principalOf = async (req: express.Request) => {
    const credentials = await httpAuth.credentials(req, {
      allow: ['user', 'service'],
    });
    return { credentials, principal: principalFromCredentials(credentials) };
  };

  /**
   * Whether the caller may read receipts issued to others. Backstage allows
   * every service principal without consulting the permission policy, so a
   * service gets this only when listed in `contextverity.receiptReaders`.
   */
  const canReadAll = async (
    credentials: Awaited<ReturnType<typeof principalOf>>['credentials'],
    principalRef: string,
  ) => {
    if ((credentials.principal as { type?: string }).type === 'service') {
      return receiptReaders.includes(principalRef);
    }
    const [d] = await permissions.authorize(
      [{ permission: contextverityReceiptReadPermission }],
      { credentials },
    );
    return d.result === AuthorizeResult.ALLOW;
  };

  router.post('/v1/resolve', async (req, res) => {
    const { principal } = await principalOf(req);
    try {
      res.status(201).json(await service.resolve(principal, req.body));
    } catch (e) {
      if (e instanceof ResolveDeniedError) {
        res.status(denialStatus(e.code)).json({
          error: { name: 'ResolveDenied', code: e.code, message: e.detail },
        });
        return;
      }
      throw mapError(e);
    }
  });

  router.post('/v1/receipts/:id/verify', async (req, res) => {
    const { principal } = await principalOf(req);
    try {
      res.json(await service.verify(principal, req.params.id, req.body ?? {}));
    } catch (e) {
      throw mapError(e);
    }
  });

  router.get('/v1/receipts', async (req, res) => {
    const { credentials, principal } = await principalOf(req);
    const all = await canReadAll(credentials, principal.ref);
    const limit = Number(req.query.limit ?? 50);
    if (!Number.isFinite(limit)) throw new InputError('limit must be a number');
    const consumer = all
      ? (req.query.consumer as string | undefined)
      : principal.ref;
    res.json({
      items: await service.listReceipts({
        limit,
        consumer,
        subject: req.query.subject as string | undefined,
      }),
    });
  });

  router.get('/v1/receipts/:id', async (req, res) => {
    const { credentials, principal } = await principalOf(req);
    try {
      res.json(
        await service.getReceiptForReader(principal, req.params.id, {
          canReadAll: await canReadAll(credentials, principal.ref),
        }),
      );
    } catch (e) {
      throw mapError(e);
    }
  });

  router.post('/v1/receipts/:id/inspect', async (req, res) => {
    const { credentials, principal } = await principalOf(req);
    if (!(await canReadAll(credentials, principal.ref)))
      throw new NotAllowedError('contextverity.receipt.read is required');
    try {
      res.json(await service.inspect(principal, req.params.id));
    } catch (e) {
      throw mapError(e);
    }
  });

  function mapError(e: unknown): Error {
    if (e instanceof ReceiptNotFoundError) return new NotFoundError(e.message);
    if (e instanceof InvalidRequestError) return new InputError(e.message);
    if (e instanceof AccessDeniedError) return new NotAllowedError(e.message);
    if (e instanceof PolicyLoadError) {
      logger.error(e.message);
      return new ServiceUnavailableError(
        'context policies could not be loaded',
      );
    }
    return e as Error;
  }

  return router;
}

/** 404 for a missing subject, 503 when a source could not be read, else 403. */
function denialStatus(code: string): number {
  if (code === 'SUBJECT_NOT_FOUND') return 404;
  if (code === 'SOURCE_UNAVAILABLE' || code === 'SOURCE_MALFORMED') return 503;
  return 403;
}
