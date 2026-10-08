/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ActionsRegistryService } from '@backstage/backend-plugin-api/alpha';
import { CONTEXT_CATEGORIES } from '@contextverity/plugin-contextverity-common';
import { ContextVerity, ResolveDeniedError } from '@contextverity/core';
import { principalFromCredentials } from '@contextverity/plugin-contextverity-node';

/**
 * Registers ContextVerity operations with the Backstage Actions Registry.
 * With `@backstage/plugin-mcp-actions-backend` installed, they are exposed as
 * MCP tools (`contextverity.resolve-context`, `contextverity.verify-receipt`).
 *
 * This does not gate other plugins' actions: Backstage offers no supported
 * interception point for that. Callers verify explicitly before acting.
 *
 * @internal
 */
export function registerActions(
  actions: ActionsRegistryService,
  service: ContextVerity,
) {
  actions.register({
    name: 'resolve-context',
    title: 'Resolve verifiable context',
    description:
      'Resolve catalog context about a subject for a stated purpose and receive a ContextVerity receipt. ' +
      'Call verify-receipt with the receipt ID before acting on the context.',
    attributes: { readOnly: false, destructive: false, idempotent: false },
    schema: {
      input: z =>
        z.object({
          subject: z
            .string()
            .describe('Entity reference, e.g. component:default/payments'),
          purpose: z
            .string()
            .describe('Declared purpose, e.g. incident-triage'),
          categories: z.array(z.enum(CONTEXT_CATEGORIES)).min(1),
          ttlSeconds: z.number().int().positive().optional(),
          policyId: z.string().optional(),
        }),
      output: z =>
        z.object({
          outcome: z.enum(['ISSUED', 'DENIED']),
          receiptId: z.string().optional(),
          validUntil: z.string().optional(),
          classification: z.string().optional(),
          denialCode: z.string().optional(),
          detail: z.string().optional(),
          context: z
            .array(
              z.object({
                sourceId: z.string(),
                kind: z.string(),
                classification: z.string(),
                fields: z.record(z.unknown()),
              }),
            )
            .optional(),
        }),
    },
    action: async ({ input, credentials }) => {
      try {
        const res = await service.resolve(
          principalFromCredentials(credentials),
          input,
        );
        return {
          output: {
            outcome: 'ISSUED' as const,
            receiptId: res.receipt.receiptId,
            validUntil: res.receipt.validUntil,
            classification: res.receipt.classification,
            context: res.context,
          },
        };
      } catch (e) {
        if (e instanceof ResolveDeniedError) {
          return {
            output: {
              outcome: 'DENIED' as const,
              denialCode: e.code,
              detail: e.detail,
            },
          };
        }
        throw e;
      }
    },
  });

  actions.register({
    name: 'verify-receipt',
    title: 'Verify a context receipt',
    description:
      'Deterministically check whether context from a receipt is still current, in scope and permitted. ' +
      'Returns VALID, REFRESH (re-resolve before acting) or DENY (do not use). VALID holds at verification time only.',
    attributes: { readOnly: false, destructive: false, idempotent: false },
    schema: {
      input: z =>
        z.object({
          receiptId: z.string(),
          subject: z.string().optional(),
          purpose: z.string().optional(),
          categories: z.array(z.enum(CONTEXT_CATEGORIES)).optional(),
        }),
      output: z =>
        z.object({
          verdict: z.enum(['VALID', 'REFRESH', 'DENY']),
          verifiedAt: z.string(),
          drift: z.array(
            z.object({
              code: z.string(),
              effect: z.string(),
              sourceId: z.string().optional(),
              field: z.string().optional(),
              detail: z.string(),
            }),
          ),
        }),
    },
    action: async ({ input, credentials }) => {
      const { receiptId, ...intent } = input;
      const v = await service.verify(
        principalFromCredentials(credentials),
        receiptId,
        intent,
      );
      return {
        output: {
          verdict: v.verdict,
          verifiedAt: v.verifiedAt,
          drift: v.drift.map(d => ({
            code: d.code,
            effect: d.effect,
            sourceId: d.sourceId,
            field: d.field,
            detail: d.detail,
          })),
        },
      };
    },
  });
}
